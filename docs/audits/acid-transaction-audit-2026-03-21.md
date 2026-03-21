# Memory Lane ACID Transaction Audit

## 1. Executive Summary

- Overall ACID safety rating: 7/10
- Overall verdict: Partial
- Top 5 ACID risks:
  - Enrollment packet downstream mapping is still split across transaction boundaries. The packet can be filed and the mapping RPC can report `completed` before contact and payor writes finish.
  - The public enrollment packet submit action still returns plain `ok: true` and hides `mappingSyncStatus`, so staff can treat a filed packet as operationally ready when MCC/MHP/POF handoff is still pending or failed.
  - Signed intake still depends on later app-side follow-up for draft POF creation and intake-PDF member-file persistence.
  - Enrollment packet contact writes still use read-then-insert/update matching outside the conversion RPC, so concurrent retries can duplicate or drift `member_contacts`.
  - Member-file cleanup is safer than before, but delete and upload workflows still rely on app-side storage cleanup instead of one canonical DB-plus-storage workflow boundary.
- Strongest workflows:
  - Lead -> member conversion core RPC
  - Public POF signature finalization RPC with consumed-token replay handling
  - POF public open path compare-and-set protection
  - POF post-sign retry worker claim RPC
  - PRN MAR documentation idempotency guard
- Short founder summary:
  - The repo is materially safer than the March 19 audit. The biggest race-condition risks from POF open/retry and PRN MAR duplicates are now hardened. The main remaining ACID weakness is enrollment packet completion: the system still says the packet is filed before every downstream contact/payor write is durably done, and the public submit action still does not tell the caller whether that downstream handoff actually finished.

## 2. Atomicity Violations

### Finding A1

- severity: Critical
- workflow name: Enrollment packet completion -> MCC/contact/payor downstream mapping
- exact files/functions/modules:
  - `lib/services/enrollment-packets.ts`
  - `submitPublicEnrollmentPacket`
  - `lib/services/enrollment-packet-intake-mapping.ts`
  - `mapEnrollmentPacketToDownstream`
  - `supabase/migrations/0061_enrollment_packet_conversion_rpc.sql`
  - `supabase/migrations/0076_rpc_returns_table_ambiguity_hardening.sql`
- what should happen:
  - Once an enrollment packet is marked filed and the mapping sync says completed, all required downstream rows for that handoff should already be durably saved.
- what currently happens:
  - `submitPublicEnrollmentPacket` files the packet first through `rpc_finalize_enrollment_packet_submission`, then calls `mapEnrollmentPacketToDownstream`.
  - `mapEnrollmentPacketToDownstream` calls `convert_enrollment_packet_to_member`, but passes `p_contacts: []`.
  - After that RPC returns, the service still performs `member_contacts` updates/inserts and billing-payor assignment in app code.
- how partial failure could occur:
  - The RPC can already set `mapping_sync_status = 'completed'`, then a later `member_contacts` update/insert or payor assignment can fail.
  - That leaves the packet filed and the mapping state looking finished even though the responsible-party/contact/payor handoff is incomplete.
- recommended fix:
  - Move prepared contact writes and payor assignment into the same enrollment conversion RPC, or create a second canonical RPC that owns the whole post-filed handoff and only marks `mapping_sync_status = completed` after every downstream write commits.
- whether it blocks launch: Yes

### Finding A2

- severity: Medium
- workflow name: Intake sign -> draft POF creation -> intake PDF save
- exact files/functions/modules:
  - `app/intake-actions.ts`
  - `createAssessmentAction`
  - `app/(portal)/health/assessment/[assessmentId]/actions.ts`
  - `retryAssessmentDraftPofAction`
  - `lib/services/intake-pof-mhp-cascade.ts`
  - `autoCreateDraftPhysicianOrderFromIntake`
- what should happen:
  - A signed intake should either advance through its required downstream follow-up in one managed workflow, or persist explicit retry state that operations can trust.
- what currently happens:
  - The intake is created and signed first.
  - Draft POF creation and the intake PDF save to member files happen afterward in separate app-side steps.
- how partial failure could occur:
  - The clinical record can already be legally signed while the draft POF or intake PDF is still missing.
  - The current flow is explicit about the failure, but it still depends on manual follow-up.
- recommended fix:
  - Keep the staged design, but add a durable retry queue or action-required record for failed draft-POF and intake-PDF follow-up instead of relying on an error string plus alert.
- whether it blocks launch: No

## 3. Consistency Gaps

### Finding C1

- severity: High
- affected schema/business rule: `mapping_sync_status = completed` should mean all enrollment packet downstream writes are complete
- exact files/migrations/services involved:
  - `lib/services/enrollment-packets.ts`
  - `lib/services/enrollment-packet-intake-mapping.ts`
  - `supabase/migrations/0061_enrollment_packet_conversion_rpc.sql`
  - `supabase/migrations/0076_rpc_returns_table_ambiguity_hardening.sql`
- what invariant is not enforced:
  - The request-level mapping status is treated as canonical handoff truth, but contacts/payor are still written after the RPC that marks the mapping completed.
- why it matters:
  - Operations can read a packet as operationally ready while contact, responsible-party, or billing-payor truth is still missing or only partially applied.
- recommended DB/service fix:
  - Do not allow the mapping RPC to return `completed` until the full downstream handoff is inside the same canonical write boundary.
  - If some writes must stay deferred, use an explicit staged state like `core_completed_contact_sync_pending` rather than `completed`.
- whether it blocks launch: Yes

### Finding C2

- severity: High
- affected schema/business rule: Public enrollment submission success should reflect downstream handoff truth
- exact files/migrations/services involved:
  - `app/sign/enrollment-packet/[token]/actions.ts`
  - `lib/services/enrollment-packets.ts`
  - `submitPublicEnrollmentPacketAction`
  - `submitPublicEnrollmentPacket`
- what invariant is not enforced:
  - The public submit boundary returns plain `ok: true` instead of the canonical downstream state.
- why it matters:
  - A caregiver submission can look fully complete to staff even when `mappingSyncStatus` is still `pending` or `failed`.
  - That is a workflow-truth problem, not just a UI preference.
- recommended DB/service fix:
  - Return `packetId`, `status`, `mappingSyncStatus`, and any follow-up error/action-needed state from the action.
  - Treat only `mappingSyncStatus = completed` as operationally ready for MCC/MHP/POF downstream use.
- whether it blocks launch: Yes

### Finding C3

- severity: Medium
- affected schema/business rule: POF signed is not the same as POF downstream clinical sync complete
- exact files/migrations/services involved:
  - `app/sign/pof/[token]/actions.ts`
  - `lib/services/pof-esign.ts`
  - `runBestEffortCommittedPofSignatureFollowUp`
  - `lib/services/physician-orders-supabase.ts`
  - `processSignedPhysicianOrderPostSignSync`
- what invariant is not enforced:
  - The public sign action returns only `signedPdfUrl`, not the downstream post-sign sync state.
- why it matters:
  - The legal signature can be complete while MHP/MCC/MAR sync is only queued.
  - That creates avoidable confusion about whether downstream clinical surfaces are already current.
- recommended DB/service fix:
  - Return `postSignStatus`, `attemptCount`, and `nextRetryAt` to the caller so the signed workflow truth matches the real downstream state.
- whether it blocks launch: No

## 4. Isolation Risks

### Finding I1

- severity: High
- workflow name: Enrollment packet contact/payor handoff
- concurrency/replay scenario:
  - A packet is retried, replayed, or manually re-run while another process is also repairing the same downstream handoff.
- exact files/functions involved:
  - `lib/services/enrollment-packet-intake-mapping.ts`
  - `mapEnrollmentPacketToDownstream`
  - `supabase/migrations/0011_member_command_center_aux_schema.sql`
  - `supabase/migrations/0068_member_contacts_is_payor_schema_alignment.sql`
- what duplicate/conflicting state could happen:
  - `member_contacts` rows can be duplicated or overwritten based on stale pre-read matching because contact writes happen outside the conversion RPC and there is no general uniqueness rule for a member contact identity.
  - Payor assignment is protected to one payor per member, but the contact rows it points to can still drift under replay.
- recommended protection:
  - Move contact writes into the RPC, or add canonical dedupe keys plus an upsert strategy for responsible-party/emergency-contact identities.
- whether it blocks launch: Yes

### Finding I2

- severity: Low
- workflow name: Manual member-file uploads
- concurrency/replay scenario:
  - A user retries the same manual upload with a new upload token.
- exact files/functions involved:
  - `lib/services/member-files.ts`
  - `saveCommandCenterMemberFileUpload`
  - `buildManualUploadDocumentSource`
  - `supabase/migrations/0091_member_files_document_source_unique.sql`
- what duplicate/conflicting state could happen:
  - Manual upload idempotency is token-based. Reusing the same token is safe, but a new token for the same real-world document creates a second canonical file row.
- recommended protection:
  - Keep the token guard, but later add an optional stronger duplicate detector for manual uploads based on hash, document type, or a short replay window.
- whether it blocks launch: No

## 5. Durability Risks

### Finding D1

- severity: High
- workflow name: Public enrollment packet submission
- exact files/functions involved:
  - `app/sign/enrollment-packet/[token]/actions.ts`
  - `lib/services/enrollment-packets.ts`
  - `submitPublicEnrollmentPacketAction`
  - `submitPublicEnrollmentPacket`
- what success currently means:
  - The public action returns `ok: true`.
- what may fail underneath:
  - The packet may only be filed with downstream sync still `pending` or `failed`.
- why that is unsafe:
  - Staff can move forward as if the packet fully handed off when the downstream operational data is not yet durable.
- recommended correction:
  - Return the downstream sync result to the caller and surface an action-needed state when filing succeeded but mapping did not.
- whether it blocks launch: Yes

### Finding D2

- severity: Medium
- workflow name: Signed intake downstream artifacts
- exact files/functions involved:
  - `app/intake-actions.ts`
  - `createAssessmentAction`
  - `lib/services/member-files.ts`
  - `saveGeneratedMemberPdfToFiles`
- what success currently means:
  - The intake is signed and saved.
- what may fail underneath:
  - Draft POF creation and intake-PDF member-file persistence can still fail afterward.
- why that is unsafe:
  - The workflow truth is explicit, but operations still need manual repair for missing downstream artifacts.
- recommended correction:
  - Add a durable retry queue or action-required task for failed follow-up steps so missing POF/PDF work is not dependent on manual memory.
- whether it blocks launch: No

### Finding D3

- severity: Low
- workflow name: Member-file delete and cleanup
- exact files/functions involved:
  - `lib/services/member-files.ts`
  - `deleteMemberFileRecordAndStorage`
  - `deleteCommandCenterMemberFile`
- what success currently means:
  - The row is deleted first, then storage is deleted.
- what may fail underneath:
  - Storage cleanup can still fail after the DB row is gone, leaving orphaned storage objects.
- why that is unsafe:
  - This is better than the old order because it avoids dangling DB rows, but it still leaves retention cleanup outside one canonical workflow boundary.
- recommended correction:
  - Keep the current safer order, then add a durable orphan-storage cleanup job or tombstone queue for failed storage deletes.
- whether it blocks launch: No

## 6. ACID Hardening Plan

1. Make enrollment packet downstream mapping one canonical transactional boundary, including contacts and payor assignment.
2. Change the public enrollment packet submit action to return the true downstream state instead of plain success.
3. Add a durable retry/action-required mechanism for intake follow-up steps: draft POF creation and intake PDF member-file save.
4. Add canonical dedupe/upsert rules for enrollment-packet contact identities so replay cannot create duplicate contact truth.
5. Add a low-priority cleanup worker for orphaned storage after member-file delete failures.
6. After those changes land, rerun ACID, idempotency, and workflow-simulation audits together to verify the new success boundaries.

## 7. Suggested Codex Prompts

1. `Make enrollment packet downstream mapping truly atomic. Move member contact creation/update and billing-payor assignment into the same canonical RPC boundary as convert_enrollment_packet_to_member, and only mark mapping_sync_status completed after every downstream write commits. Preserve Supabase as source of truth and avoid duplicate write paths.`
2. `Fix the public enrollment packet submit action so it returns the real workflow truth. Have submitPublicEnrollmentPacketAction return packetId, status, mappingSyncStatus, and any action-needed message instead of plain ok:true, and update the caller so filed-but-pending is not treated as operationally ready.`
3. `Harden the signed intake follow-up path. Keep intake signature completion explicit, but add a durable retry/action-required queue for draft POF creation and intake PDF member-file save failures so the workflow does not rely on manual memory after partial success.`
4. `Add canonical dedupe rules for enrollment packet member_contacts handoff. Prevent duplicate responsible-party and emergency-contact rows during retry or replay by using one shared resolver/upsert path backed by schema constraints where appropriate.`

## 8. Fix First Tonight

- Stop reporting plain success from public enrollment packet submission when downstream sync is still pending or failed.
- Move enrollment packet contact/payor writes behind the same canonical write boundary as the conversion RPC.
- Add a durable action-required record for signed intake follow-up failures so missing draft POFs and intake PDFs are queued instead of remembered manually.

## 9. Automate Later

- Nightly audit for filed enrollment packets where `mapping_sync_status = completed` but expected contact/payor downstream data is still missing.
- Replay-safety audit for enrollment-packet contact writes that detects duplicate responsible-party and emergency-contact rows for the same member.
- Orphan-storage cleanup audit for member-file deletes where the DB row is gone but storage cleanup failed.
- Workflow-truth audit that compares public action return payloads against canonical downstream state for enrollment packet and POF public flows.

## 10. Founder Summary: What changed since the last run

- Three previously important ACID risks are now clearly improved in code, not just in theory:
  - POF retry processing now claims queue rows through `rpc_claim_pof_post_sign_sync_queue` (`supabase/migrations/0097_pof_post_sign_retry_claim_rpc.sql` and `lib/services/physician-orders-supabase.ts`), so the old "two retry runners grab the same row" risk dropped.
  - The public POF open path now uses compare-and-set protection with `p_require_opened_at_null` (`supabase/migrations/0098_false_failure_read_path_hardening.sql` and `lib/services/pof-esign.ts`), so the stale-open overwrite risk dropped.
  - PRN MAR documentation now has a real idempotency guard in both schema and service code (`supabase/migrations/0090_mar_prn_idempotency_guard.sql` and `lib/services/mar-workflow.ts`), so the old duplicate-PRN risk dropped.
- Member-file durability is also better than the March 19 report:
  - `(member_id, document_source)` is now enforced as unique in `supabase/migrations/0091_member_files_document_source_unique.sql`.
  - Member-file delete now removes the DB row first and storage second in `lib/services/member-files.ts`, which is a safer failure order than before.
- The biggest unresolved issue is now concentrated in one place:
  - Enrollment packet completion still has a split success boundary. The packet can be filed and the mapping RPC can report completion before contact/payor writes finish, and the public action still hides that downstream status from the caller.
- Intake remains explicit but still operationally manual on follow-up failure:
  - If draft POF creation or intake PDF save fails after signature, the system tells staff clearly, but it still depends on manual repair instead of a durable retry queue.
- Audit context note:
  - This was a static code audit against a dirty working tree. I did not change runtime logic in this run.
