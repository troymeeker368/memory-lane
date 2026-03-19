# Memory Lane ACID Transaction Audit

## 1. Executive Summary

- Overall ACID safety rating: 6/10
- Overall verdict: Partial
- Top 5 ACID risks:
  - Post-commit audit/event writes can still turn a successful workflow into a user-visible failure.
  - Public POF link opens still use a stale-write path that can overwrite a newly voided request back to `opened`.
  - PRN MAR documentation still has no duplicate-submission guard.
  - Canonical member-file upsert still has no general DB uniqueness on `(member_id, document_source)`.
  - Enrollment packet cleanup still leaves staged upload rows behind when finalization fails after files were staged.
- Strongest workflows:
  - Lead -> member core conversion SQL RPC
  - Intake assessment atomic create RPC
  - Draft POF from signed intake RPC
  - POF signature finalization RPC with consumed-token replay handling
  - Care plan caregiver finalization RPC with consumed-token replay handling
- Short founder summary:
  - The core SQL transaction work is materially better than the old app-driven write paths, but there are still several places where the database commit succeeds and the app can still tell staff or a signer that the workflow failed. That is the main pattern still making the platform feel less safe than the underlying SQL now is.

## 2. Atomicity Violations

### Finding A1

- severity: High
- workflow name: Lead -> member conversion and signed POF post-sign cascade
- exact files/functions/modules:
  - `lib/services/sales-lead-conversion-supabase.ts`
  - `applyLeadStageTransitionWithMemberUpsertSupabase`
  - `createLeadWithMemberConversionSupabase`
  - `lib/services/physician-orders-supabase.ts`
  - `processSignedPhysicianOrderPostSignSync`
  - `supabase/migrations/0034_lead_transition_member_upsert_transaction.sql`
  - `supabase/migrations/0037_shared_rpc_standardization_lead_pof.sql`
- what should happen:
  - Once the conversion or signed-POF post-sign update commits, the caller should either get a durable success or a clearly queued follow-up state.
- what currently happens:
  - The SQL commit happens first, then required `system_events` writes run afterward in app code.
- how partial failure could occur:
  - If `system_events` insert fails after the RPC commit, the workflow throws even though the lead was already converted or the POF queue row was already updated. Staff can see a failure message and retry a workflow that already committed.
- recommended fix:
  - Make post-commit observability writes non-blocking for already-committed business events, or move the required audit insert into the same SQL transaction/RPC.
- whether it blocks launch: Yes

### Finding A2

- severity: High
- workflow name: Enrollment packet send, POF send/resend, care plan send
- exact files/functions/modules:
  - `lib/services/enrollment-packets.ts`
  - `prepareEnrollmentPacketRequestForDelivery`
  - `sendEnrollmentPacketRequest`
  - `lib/services/pof-esign.ts`
  - `sendNewPofSignatureRequest`
  - `resendPofSignatureRequest`
  - `lib/services/care-plan-esign.ts`
  - `sendCarePlanToCaregiverForSignature`
  - `supabase/migrations/0073_delivery_and_member_file_rpc_hardening.sql`
- what should happen:
  - Once the request row is prepared or marked sent, later event-log failures should not make the caller think the whole workflow failed.
- what currently happens:
  - The request state is committed first, then required packet/document/signature event inserts run in app code.
- how partial failure could occur:
  - A request can already exist in `prepared`, `draft`, or `sent` state while the caller receives an error because the follow-up event insert failed. That creates false failure, retry confusion, and hidden live links.
- recommended fix:
  - Treat post-commit event inserts as best-effort, or push them into the delivery RPCs so the workflow has one canonical success boundary.
- whether it blocks launch: Yes

## 3. Consistency Gaps

### Finding C1

- severity: High
- affected schema/business rule: One canonical member file per `(member_id, document_source)` for generated artifacts
- exact files/migrations/services involved:
  - `lib/services/member-files.ts`
  - `upsertMemberFileByDocumentSource`
  - `saveGeneratedMemberPdfToFiles`
  - `supabase/migrations/0011_member_command_center_aux_schema.sql`
  - `supabase/migrations/0062_member_file_manual_upload_idempotency.sql`
  - `supabase/migrations/0073_delivery_and_member_file_rpc_hardening.sql`
- what invariant is not enforced:
  - The code treats `document_source` as an upsert key for many generated files, but the database only enforces that uniqueness for manual MCC uploads and some special-case foreign-key paths.
- why it matters:
  - Intake PDFs, care plan PDFs, MAR monthly reports, incident artifacts, and similar generated files can still duplicate under race or retry instead of staying canonical.
- recommended DB/service fix:
  - Add a general unique index on `(member_id, document_source)` where `document_source is not null` after deduplicating existing rows, then keep `rpc_upsert_member_file_by_source` as the only canonical upsert path.
- whether it blocks launch: No

### Finding C2

- severity: Medium
- affected schema/business rule: Post-sign queue failure-step truth
- exact files/migrations/services involved:
  - `lib/services/physician-orders-supabase.ts`
  - `runPostSignSyncCascade`
  - `supabase/migrations/0037_shared_rpc_standardization_lead_pof.sql`
- what invariant is not enforced:
  - The queue schema allows `last_failed_step = 'mar_medications'`, but the current service only records `mhp_mcc` or `mar_schedules`.
- why it matters:
  - The queue can tell operators that a broad sync stage failed without identifying whether the member-medication push failed before MAR schedule generation.
- recommended DB/service fix:
  - Either record the real step boundaries from service code or simplify the enum so queue state matches actual runtime paths.
- whether it blocks launch: No

## 4. Isolation Risks

### Finding I1

- severity: High
- workflow name: Public POF token open flow
- concurrency/replay scenario:
  - Provider opens a POF link while staff voids the request at nearly the same time.
- exact files/functions involved:
  - `lib/services/pof-esign.ts`
  - `getPublicPofSigningContext`
  - `markPofRequestDeliveryState`
  - `supabase/migrations/0073_delivery_and_member_file_rpc_hardening.sql`
  - `rpc_transition_pof_request_delivery_state`
- what duplicate/conflicting state could happen:
  - A request that was just moved to `declined` can be overwritten back to `opened` by the stale public-open path because the transition RPC has no expected-current-state guard.
- recommended protection:
  - Add compare-and-set state validation to the POF delivery transition RPC, matching the safer enrollment-packet pattern.
- whether it blocks launch: Yes

### Finding I2

- severity: High
- workflow name: PRN MAR administration documentation
- concurrency/replay scenario:
  - Staff double-clicks, the browser retries, or two nurses document the same PRN administration nearly simultaneously.
- exact files/functions involved:
  - `lib/services/mar-workflow.ts`
  - `documentPrnMarAdministration`
  - `supabase/migrations/0028_pof_seeded_mar_workflow.sql`
- what duplicate/conflicting state could happen:
  - The system inserts two PRN administration rows because there is no unique guard, no idempotency token, and no duplicate-detection window.
- recommended protection:
  - Add an idempotency key or a narrow duplicate guard such as `(member_id, pof_medication_id, administered_at, source)` plus service-level duplicate detection.
- whether it blocks launch: Yes

### Finding I3

- severity: Medium
- workflow name: POF queued retry worker
- concurrency/replay scenario:
  - Two retry runners pick the same queued row before either one updates it.
- exact files/functions involved:
  - `lib/services/physician-orders-supabase.ts`
  - `retryQueuedPhysicianOrderPostSignSync`
  - `pof_post_sign_sync_queue`
- what duplicate/conflicting state could happen:
  - The same queue row can be processed twice, inflating attempt counts and generating noisy duplicate post-sign side effects or alerts.
- recommended protection:
  - Claim rows first with a transactional status flip or `for update skip locked` pattern before running the cascade.
- whether it blocks launch: No

## 5. Durability Risks

### Finding D1

- severity: High
- workflow name: Member-file deletion
- exact files/functions involved:
  - `lib/services/member-files.ts`
  - `deleteCommandCenterMemberFile`
  - `deleteMemberDocumentObject`
  - `deleteMemberFileRecord`
- what success currently means:
  - The workflow deletes storage first, then deletes the DB row.
- what may fail underneath:
  - If the DB delete fails after storage deletion, the row can remain while the actual file is already gone.
- why that is unsafe:
  - Staff is left with a record that still points to a missing file, which is the wrong failure order for regulated document retention.
- recommended correction:
  - Move deletion behind a canonical RPC that records intent, deletes the row and storage path as one managed workflow, or at minimum soft-delete the row before removing storage.
- whether it blocks launch: Yes

### Finding D2

- severity: Medium
- workflow name: Enrollment packet public submission cleanup
- exact files/functions involved:
  - `lib/services/enrollment-packets.ts`
  - `submitPublicEnrollmentPacket`
  - `lib/services/enrollment-packet-artifacts.ts`
  - `cleanupEnrollmentPacketUploadArtifacts`
  - `supabase/migrations/0053_artifact_drift_replay_hardening.sql`
- what success currently means:
  - Failed finalization cleans storage/member-files when possible.
- what may fail underneath:
  - `enrollment_packet_uploads` rows are not deleted during cleanup, so failed batches can leave staged upload metadata behind even after files were removed.
- why that is unsafe:
  - The packet can accumulate dead upload rows, which weakens audit clarity and can confuse later packet review or cleanup jobs.
- recommended correction:
  - Add a canonical cleanup RPC that removes or marks failed batch upload rows, not just their storage/member-file artifacts.
- whether it blocks launch: No

### Finding D3

- severity: Medium
- workflow name: Intake create/sign -> draft POF -> member-file PDF save
- exact files/functions involved:
  - `app/intake-actions.ts`
  - `createAssessmentAction`
  - `lib/services/member-files.ts`
  - `saveGeneratedMemberPdfToFiles`
- what success currently means:
  - The intake is considered created and signed before its PDF is durably stored in member files.
- what may fail underneath:
  - The member-file PDF save can still fail after the intake and draft POF already committed.
- why that is unsafe:
  - Staff receives a partial-failure message and must manually reconcile whether the clinical record exists but the expected artifact is missing.
- recommended correction:
  - Keep the current explicit failure message, but add a durable action-required record or retry queue so missing intake PDFs do not rely on manual memory.
- whether it blocks launch: No

## 6. ACID Hardening Plan

1. Stop post-commit event/audit writes from throwing after business success.
2. Add compare-and-set protection to POF delivery-state updates before any more public-token traffic.
3. Add PRN MAR idempotency/duplicate protection.
4. Add one canonical DB uniqueness rule for generated member files by `document_source`.
5. Add a claimed-worker pattern for POF post-sign retry rows.
6. Add enrollment-packet failed-batch cleanup for `enrollment_packet_uploads`.
7. Add a retryable durable artifact task for intake/care-plan/member-file follow-up saves.

## 7. Suggested Codex Prompts

1. `Fix Memory Lane false-failure windows by making post-commit audit/event writes non-blocking in lead conversion, enrollment packet send, POF send/resend, and POF post-sign sync. Keep the committed business write as the only success boundary and preserve alerts/logging as best-effort follow-up.`
2. `Harden the POF public token flow with compare-and-set delivery-state transitions. Update the POF delivery RPC and callers so a stale public open cannot overwrite a request that was voided, expired, or otherwise changed after the token was first loaded.`
3. `Add replay-safe duplicate protection for PRN MAR documentation. Prevent accidental duplicate PRN administrations from double-clicks or retries while still allowing legitimate separate administrations at different times.`
4. `Make member_files document_source canonical at the database layer. Add a safe migration to deduplicate existing rows, then create a unique index on (member_id, document_source) where document_source is not null and keep rpc_upsert_member_file_by_source as the only canonical upsert path.`
5. `Add canonical cleanup for failed enrollment packet finalization batches so staged enrollment_packet_uploads rows do not survive after the storage object/member_file cleanup runs.`

## 8. Fix First Tonight

- Make `logSystemEvent` callers in lead conversion and POF post-sign sync non-blocking after the core RPC already committed.
- Make post-send event inserts non-blocking in enrollment packets, POF send/resend, and care plan send.
- Add expected-current-status protection to `rpc_transition_pof_request_delivery_state`.
- Add a duplicate guard to `documentPrnMarAdministration`.

## 9. Automate Later

- Nightly scan for duplicate `member_files` rows sharing the same `(member_id, document_source)`.
- Stale `pof_post_sign_sync_queue` monitor that detects multiple workers touching the same queue row.
- Enrollment packet failed-batch cleanup audit that looks for `finalization_status = 'staged'` after failed submissions.
- PRN MAR duplicate detector for same member, medication, actor, and near-identical timestamp.
- False-failure audit that compares committed entity-state changes against missing/failed post-commit event writes.

## 10. Founder Summary: What changed since the last run

- The repo now has more SQL hardening around POF and enrollment packet edges than it did before. Since the last run, Git history shows new migrations for POF sign ambiguity and enrollment packet progress status handling, especially `0086_fix_pof_sign_rpc_physician_order_ambiguity.sql` and `0088_fix_enrollment_packet_progress_rpc_status_ambiguity.sql`.
- The current dirty worktree is mostly service-splitting and hot-path weight reduction work in enrollment, POF, MAR, billing, incidents, and reporting. That refactor improves maintainability and build weight, but I did not find evidence that it closed the main ACID gaps above.
- The strongest transaction-backed flows remain strong: lead conversion RPC, intake creation RPC, draft POF-from-intake RPC, POF finalization RPC, and care plan caregiver finalization RPC.
- The main risks from the 2026-03-18 run are still here: false-failure windows after committed writes, no claim/lock step in the POF retry runner, and incomplete durability around some artifact/file paths.
- One risk changed shape tonight: I did not re-elevate the old care-plan cleanup concern from the 2026-03-17 memory, but I did confirm a clearer current file-persistence risk in the member-file delete path and a clearer public-token race in the POF open flow.
- Memory note:
  - The automation memory file exists now, so this delta is a true run-to-run comparison, not a baseline reconstruction.
