# Memory Lane ACID Transaction Audit - 2026-05-10

## 1. Executive Summary

- Overall ACID safety rating: 7.2 / 10
- Overall verdict: Partial
- Top 5 ACID risks:
  - Public POF replay can still delete the winning signed artifacts from storage after the database already says the request is signed.
  - Public care plan replay can still delete the winning caregiver signature and final PDF after the database already says the plan is signed.
  - Enrollment packet completion still commits `status = completed` before finalized artifacts, member-file linkage, notifications, and downstream mapping all finish.
  - Lead conversion still trusts `p_existing_member_id` too much inside the database function and can relink the wrong member if a privileged caller supplies a bad id.
  - Care plan final signed files still use one shared `document_source`, which can block a second signed care plan for the same member.
- Strongest workflows:
  - Member-file delete and generated-file write paths now fail more honestly and preserve durable repair state instead of silently pretending cleanup worked.
  - MAR monthly report generation now returns `follow-up-needed` or hard failure when member-file persistence cannot be verified, instead of fake success.
  - Intake -> draft POF follow-up is explicit about committed-but-unverified outcomes and keeps staff in a repair flow.
  - Enrollment packet expired-token handling is safer because expired active tokens are rejected before the completed replay branch unless the token was already consumed by a committed submission.
- Short founder summary:
  - The platform is better at telling the truth when downstream work is only partially done, but the biggest launch blockers are still open. Today’s visible progress is mostly around safer guardrails and clearer follow-up truth, not deeper transaction-boundary fixes.

## 2. Atomicity Violations

### Finding A1
- severity: Critical
- workflow name: Public POF signature completion replay
- exact files/functions/modules:
  - `lib/services/pof-esign-public.ts` -> `submitPublicPofSignature`
  - `supabase/migrations/0053_artifact_drift_replay_hardening.sql` -> `rpc_finalize_pof_signature`
- what should happen:
  - A replay loser should return the already-committed signed result without touching the committed signature image or signed PDF.
- what currently happens:
  - The flow still calls `cleanupFailedPofSignatureArtifacts(...)` when `finalized.was_already_signed` is true.
- how partial failure could occur:
  - One request wins the DB race and commits signed state. A second replay loses the DB race but still deletes `provider-signature.png` and `signed.pdf` from storage afterward.
- recommended fix:
  - Treat `was_already_signed` as read-only. Do not delete deterministic canonical signed paths on replay-safe results.
- whether it blocks launch: Yes

### Finding A2
- severity: Critical
- workflow name: Public care plan caregiver signing replay
- exact files/functions/modules:
  - `lib/services/care-plan-esign-public.ts` -> `submitPublicCarePlanSignature`
  - `supabase/migrations/0053_artifact_drift_replay_hardening.sql` -> `rpc_finalize_care_plan_caregiver_signature`
- what should happen:
  - A replay loser should return the already-committed signed care plan result without deleting the winning caregiver signature or final PDF.
- what currently happens:
  - The flow still calls `cleanupFailedCarePlanCaregiverArtifacts(...)` when `finalized.wasAlreadySigned` is true.
- how partial failure could occur:
  - The database remains signed while the replay loser removes the canonical caregiver signature or final signed PDF from storage.
- recommended fix:
  - Mirror the POF fix: replay-safe results must not clean up canonical committed artifact paths.
- whether it blocks launch: Yes

### Finding A3
- severity: High
- workflow name: Enrollment packet public completion
- exact files/functions/modules:
  - `supabase/migrations/0180_enrollment_completion_follow_up_state.sql` -> `rpc_finalize_enrollment_packet_submission`
  - `lib/services/enrollment-packets-public-runtime.ts` -> `submitPublicEnrollmentPacketWithDeps`
  - `lib/services/enrollment-packets-public-runtime-post-commit.ts` -> `completeCommittedPublicEnrollmentPacketPostCommitWork`
  - `lib/services/enrollment-packets-public-runtime-artifacts.ts` -> `persistFinalizedPublicEnrollmentPacketArtifacts`
- what should happen:
  - Packet completion, finalized artifacts, member-file linkage, sender notification, lead activity sync, and downstream mapping should succeed together or have one durable repair owner.
- what currently happens:
  - The finalize RPC first marks the packet `completed` and `completion_follow_up_status = 'pending'`. Artifact persistence and downstream work happen later in post-commit code.
- how partial failure could occur:
  - The packet can be durably completed while the completed packet PDF, linked uploads, notifications, or downstream MCC/MHP/POF mapping are still missing or degraded.
- recommended fix:
  - Move more of the required artifact/linkage work under one transactional owner, or add one canonical durable repair record that becomes the truth boundary for all post-commit recovery.
- whether it blocks launch: Yes

### Finding A4
- severity: Medium
- workflow name: Lead conversion plus activity logging
- exact files/functions/modules:
  - `lib/services/sales-lead-conversion-supabase.ts` -> `applyLeadStageTransitionWithMemberUpsertSupabase`
  - `lib/services/sales-lead-activities.ts` -> `createSalesLeadActivity`
  - `app/sales-lead-actions.ts` -> `createSalesLeadActivityAction`
- what should happen:
  - Conversion and its canonical conversion activity should commit as one business event, or the system should own one durable repair path.
- what currently happens:
  - The conversion RPC commits first. Activity logging still happens afterward, although the UI now returns committed `follow_up_required` truth if that second step fails.
- how partial failure could occur:
  - A lead becomes a member, but the canonical activity trail can still be missing until staff repair it.
- recommended fix:
  - Move conversion activity logging into the conversion RPC, or create one durable repair queue owned by the service layer.
- whether it blocks launch: No

## 3. Consistency Gaps

### Finding C1
- severity: High
- affected schema/business rule:
  - Lead conversion must not relink an unrelated existing member.
- exact files/migrations/services involved:
  - `supabase/migrations/0158_lead_conversion_shell_success_guard.sql` -> `apply_lead_stage_transition_with_member_upsert`
  - `lib/services/sales-lead-conversion-supabase.ts`
- what invariant is not enforced:
  - When `p_existing_member_id` is supplied, the DB function updates that member and sets `source_lead_id = p_lead_id` without proving the member already belongs to that lead or is explicitly safe to claim.
- why it matters:
  - The app may usually resolve this correctly, but the database boundary itself still trusts the caller too much.
- recommended DB/service fix:
  - Add a DB assertion that the supplied member already belongs to the same lead or is an explicitly allowed unlinked shell; otherwise fail closed.
- whether it blocks launch: Yes

### Finding C2
- severity: High
- affected schema/business rule:
  - Final signed care plan files must support more than one signed care plan per member.
- exact files/migrations/services involved:
  - `supabase/migrations/0053_artifact_drift_replay_hardening.sql` -> `rpc_finalize_care_plan_caregiver_signature`
  - `supabase/migrations/0091_member_files_document_source_unique.sql`
- what invariant is not enforced:
  - The RPC still writes `document_source = 'Care Plan Final Signed'`, while the schema enforces unique `(member_id, document_source)`.
- why it matters:
  - A second signed care plan for the same member can fail even when the care plan itself is valid.
- recommended DB/service fix:
  - Make the final signed `document_source` unique per care plan, for example by embedding the care-plan id.
- whether it blocks launch: Yes

### Finding C3
- severity: Medium
- affected schema/business rule:
  - Staff notifications should not claim readiness when downstream work is only queued or degraded.
- exact files/migrations/services involved:
  - `lib/services/notification-content.ts`
  - `lib/services/pof-post-sign-runtime.ts`
  - `lib/services/care-plan-esign-public.ts`
- what invariant is not enforced:
  - Notification text still says `Clinical documents are ready for review` and `Final clinical document is ready` even though runtime truth supports queued and degraded post-sign states.
- why it matters:
  - Staff-facing workflow truth can drift away from the canonical readiness model and encourage premature action.
- recommended DB/service fix:
  - Emit readiness-aware signed notifications from the same resolver family used by the public completion flows, and only say `ready` when readiness is actually ready.
- whether it blocks launch: No

## 4. Isolation Risks

### Finding I1
- severity: Critical
- workflow name: Public POF signing replay
- concurrency/replay scenario:
  - Two near-simultaneous submissions of the same token, or one retry after the winning request already committed.
- exact files/functions involved:
  - `lib/services/pof-esign-public.ts`
  - `supabase/migrations/0053_artifact_drift_replay_hardening.sql`
- what duplicate/conflicting state could happen:
  - The DB replay guard prevents duplicate finalization, but the loser can still delete the winner’s storage artifacts.
- recommended protection:
  - Treat replay-safe committed results as strictly read-only and never clean up deterministic canonical signed paths.
- whether it blocks launch: Yes

### Finding I2
- severity: Critical
- workflow name: Public care plan caregiver signing replay
- concurrency/replay scenario:
  - Two close submissions of the same caregiver token, or one retry after the winner already committed.
- exact files/functions involved:
  - `lib/services/care-plan-esign-public.ts`
  - `supabase/migrations/0053_artifact_drift_replay_hardening.sql`
- what duplicate/conflicting state could happen:
  - The DB replay guard keeps one signed row, but the loser can still delete the winning caregiver artifacts.
- recommended protection:
  - Same as POF: do not clean up canonical committed paths on replay-safe results.
- whether it blocks launch: Yes

### Finding I3
- severity: Low
- workflow name: Enrollment packet public token replay
- concurrency/replay scenario:
  - Double-submit or retry while the packet is already completed or the active token has expired.
- exact files/functions involved:
  - `lib/services/enrollment-packets-public-runtime.ts`
  - `lib/services/enrollment-packets-public-runtime-context.ts`
  - `tests/enrollment-packet-expired-completed-token-guard.test.ts`
- what duplicate/conflicting state could happen:
  - Current evidence here is better than yesterday’s risk set. Expired active tokens now fail before the completed replay branch unless the token was already consumed by the committed submission.
- recommended protection:
  - Keep the current consumed-token plus expiry ordering and keep the regression test in place.
- whether it blocks launch: No

## 5. Durability Risks

### Finding D1
- severity: Medium
- workflow name: Enrollment packet post-commit failure fallback
- exact files/functions involved:
  - `lib/services/enrollment-packets-public-runtime-cascade.ts`
  - `lib/services/enrollment-packets-public-runtime-follow-up.ts` -> `buildEnrollmentPacketPostCommitFailureResult`
- what success currently means:
  - The caller can still receive an `action_required` result after a committed packet hits post-commit failure.
- what may fail underneath:
  - The main cascade path is safer now because it throws if follow-up state persistence fails, but the fallback builder still only logs if its own `action_required` persistence write fails.
- why that is unsafe:
  - The UI can still say `action required` while the root packet row never durably recorded that state in the fallback path.
- recommended correction:
  - Make the fallback builder fail closed too, or persist one separate durable repair record that becomes the canonical fallback source of truth.
- whether it blocks launch: No

### Finding D2
- severity: Medium
- workflow name: Care plan nurse signature finalize failure after reused artifact row
- exact files/functions involved:
  - `lib/services/care-plan-nurse-esign.ts` -> `cleanupCarePlanNurseSignatureArtifactAfterFinalizeFailure`
- what success currently means:
  - The flow can reuse an existing signature artifact member-file row during nurse-sign finalization.
- what may fail underneath:
  - If finalization later fails and the artifact row was reused instead of newly created, the code records a split-brain alert and stops instead of rolling the artifact back.
- why that is unsafe:
  - Storage/member-file artifact truth can survive a failed finalize boundary and require manual reconciliation.
- recommended correction:
  - Use temporary artifact paths until finalize succeeds, or add deterministic rollback rules for reused artifact rows.
- whether it blocks launch: No

### Finding D3
- severity: Medium
- workflow name: Signed workflow notifications versus durable readiness truth
- exact files/functions involved:
  - `lib/services/notification-content.ts`
  - `lib/services/care-plan-esign-public.ts`
  - `lib/services/pof-post-sign-runtime.ts`
- what success currently means:
  - Users can receive `signed` notifications immediately after the signature event is recorded.
- what may fail underneath:
  - Care plan post-sign readiness can still fail after the sign event, and POF post-sign can still be queued rather than fully synced even though the generic message sounds done.
- why that is unsafe:
  - Operational staff can act on a workflow as if it is fully ready when the durable readiness model says otherwise.
- recommended correction:
  - Separate `signed` from `ready` notifications, or generate signed-notification copy from the readiness resolver.
- whether it blocks launch: No

## 6. ACID Hardening Plan

1. Fix the two replay-delete bugs in public POF and public care plan signing first.
2. Add regression tests that fail if replay-safe `already signed` branches call cleanup on canonical signed paths.
3. Fix enrollment packet split-commit by widening the transactional owner or adding one durable repair-owner record that becomes the canonical truth boundary for post-commit work.
4. Add a DB assertion for `p_existing_member_id` inside the lead conversion RPC.
5. Change care plan final signed `document_source` to a per-care-plan value and backfill safely.
6. Make enrollment packet fallback follow-up truth fail closed if the fallback persistence write itself fails.
7. Move signed notification language onto readiness-aware outcomes instead of generic `ready` copy.
8. Clean up the nurse-sign split-brain case after the launch blockers are closed.

## 7. Suggested Codex Prompts

- Fix Memory Lane POF replay artifact deletion. In `lib/services/pof-esign-public.ts`, the `finalized.was_already_signed` branch still calls `cleanupFailedPofSignatureArtifacts(...)` on deterministic canonical signed paths. Prevent replay losers from deleting committed artifacts and add a regression test.
- Fix Memory Lane care plan replay artifact deletion. In `lib/services/care-plan-esign-public.ts`, the `finalized.wasAlreadySigned` branch still deletes deterministic caregiver signature and final PDF paths. Make replay-safe results read-only and add regression coverage.
- Fix Memory Lane enrollment packet split-commit. `rpc_finalize_enrollment_packet_submission` still marks the packet completed before finalized artifacts, member-file linkage, and downstream mapping are fully durable. Move more required work under one canonical transaction owner, or add one durable repair-owner record for all post-commit recovery.
- Fix Memory Lane lead conversion member relink safety. Add a DB assertion inside `apply_lead_stage_transition_with_member_upsert` so `p_existing_member_id` must already belong to the same lead or an explicitly allowed unlinked shell, otherwise fail closed.
- Fix Memory Lane care plan final signed document-source collisions. Replace the shared `document_source = 'Care Plan Final Signed'` contract with a per-care-plan source and add a migration-safe backfill.
- Fix Memory Lane signed notification truth. Update `lib/services/notification-content.ts` and the emitting workflows so POF and care plan notifications reflect canonical readiness state instead of always saying `ready`.

## 8. Fix First Tonight

- Remove replay cleanup of canonical signed files in public POF signing.
- Remove replay cleanup of canonical signed files in public care plan signing.
- Add regression tests for both replay-delete bugs before patching.
- Add the lead-conversion DB assertion for `p_existing_member_id`.
- Change care plan final signed `document_source` to include the care-plan id.
- Make the enrollment packet fallback builder fail closed if its `action_required` write cannot be persisted.

## 9. Automate Later

- Nightly check for signed POF rows whose signature image or signed PDF is missing from storage.
- Nightly check for signed care plans whose caregiver signature or final PDF is missing from storage.
- Nightly check for completed enrollment packets with no completed-packet artifact or missing member-file linkage.
- Nightly check for enrollment packets whose UI-ready result does not match durable `completion_follow_up_status`.
- Schema guard test that rejects `p_existing_member_id` values already owned by another lead.
- Notification/readiness matrix tests so `ready` language cannot drift away from canonical readiness resolvers.

## 10. Founder Summary: What changed since the last run

- Better in the current worktree:
  - Enrollment packet active expired tokens now fail before the completed replay branch unless the token was already consumed by the winning completion. Evidence: `lib/services/enrollment-packets-public-runtime.ts`, `lib/services/enrollment-packets-public-runtime-context.ts`, and `tests/enrollment-packet-expired-completed-token-guard.test.ts`.
  - Enrollment packet main follow-up truth is stricter because the main cascade now throws if `completion_follow_up_status` persistence fails. Evidence: `lib/services/enrollment-packets-public-runtime-cascade.ts` and `lib/services/enrollment-packets-public-runtime-follow-up.ts`.
  - Lead conversion follow-up truth is safer for staff because post-conversion activity failure now returns committed `follow_up_required` truth instead of a generic failure. Evidence: `app/sales-lead-actions.ts`, `lib/services/sales-lead-activities.ts`, and `tests/sales-lead-activity-committed-truth.test.ts`.
  - Intake assessment writes now require explicit `health` edit permission in addition to the signer-role gate. Evidence: `app/intake-actions.ts`, `app/(portal)/health/assessment/page.tsx`, and `tests/intake-assessment-readiness-ui.test.ts`.
  - Member Command Center index reads now use the same privileged canonical read boundary as the detail path after app authorization, which reduces read split-brain risk. Evidence: `app/(portal)/operations/member-command-center/page.tsx`, `lib/services/member-command-center-runtime.ts`, and `tests/member-command-center-privileged-read.test.ts`.
- Still unresolved:
  - The public POF replay-delete launch blocker is still present.
  - The public care plan replay-delete launch blocker is still present.
  - Enrollment packet completion is still a split commit.
  - Lead conversion still trusts `p_existing_member_id` too much in the DB layer.
  - Care plan final signed files still have a document-source collision risk.
  - Signed notification copy still overstates readiness in queued or degraded paths.
- Newly surfaced tonight:
  - No new critical ACID issue was found beyond the existing blocker set. Today’s movement is mostly stronger truthfulness and safer authorization/read boundaries, not deeper transactional hardening.
