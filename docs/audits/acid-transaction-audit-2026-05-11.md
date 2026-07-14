# Memory Lane ACID Transaction Audit - 2026-05-11

## 1. Executive Summary

- Overall ACID safety rating: 7.3 / 10
- Overall verdict: Partial
- Top 5 ACID risks:
  - Public POF replay can still delete the winning signed files from storage after the database already says the request is signed.
  - Public care plan replay can still delete the winning caregiver signature and final PDF after the database already says the care plan is signed.
  - Enrollment packet completion still marks the packet completed before finalized artifacts, member-file linkage, and downstream handoff are durably finished.
  - Lead conversion still trusts `p_existing_member_id` too much inside the DB function and can relink the wrong member.
  - Care plan final signed files still use one shared `document_source`, which can block a second signed care plan for the same member.
- Strongest workflows:
  - Generated member-file PDFs are safer because canonical replacement now reuses the same `document_source` row and only deletes superseded storage after persistence is verified.
  - Intake post-sign truth is more honest: signed intake can now return explicit follow-up-needed truth instead of falsely looking fully complete when draft POF or PDF verification still needs repair.
  - MAR monthly report and care plan PDF generation now return follow-up-needed truth when member-file verification is not durable instead of pretending the file save fully succeeded.
  - Signed POF readiness still distinguishes legally signed from operationally ready through the queue/readiness model instead of silently collapsing them together.
- Short founder summary:
  - The platform got better at telling the truth and better at protecting generated member-file replacements, but the same core launch blockers are still open. The biggest remaining risks are still replay-driven artifact deletion, enrollment split-commit behavior, and the lead-conversion member relink gap.

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
  - The finalize RPC is replay-aware, but the app still calls `cleanupFailedPofSignatureArtifacts(...)` when `finalized.was_already_signed` is true.
- how partial failure could occur:
  - One request wins the DB race and commits signed state. A second request loses the DB race but still deletes the winning `provider-signature.png` or `signed.pdf` from storage.
- recommended fix:
  - Treat replay-safe committed results as read-only. Never clean up deterministic canonical signed paths on `was_already_signed`.
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
  - The finalize RPC is replay-aware, but the app still calls `cleanupFailedCarePlanCaregiverArtifacts(...)` when `finalized.wasAlreadySigned` is true.
- how partial failure could occur:
  - The database stays signed while the losing replay request removes `caregiver-signature.png` or `final-signed.pdf` from storage.
- recommended fix:
  - Mirror the POF fix: replay-safe committed results must not clean up canonical committed artifact paths.
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
  - Packet completion, finalized artifacts, member-file linkage, notifications, and downstream mapping should succeed together or have one durable repair owner.
- what currently happens:
  - The finalize RPC first marks the packet `completed`, sets `mapping_sync_status = 'pending'`, and sets `completion_follow_up_status = 'pending'`. Finalized artifacts and downstream work happen later in post-commit code.
- how partial failure could occur:
  - The packet can be durably completed while the completed-packet PDF, linked uploads, notifications, or downstream mapping are still missing or degraded.
- recommended fix:
  - Move more required artifact/linkage work under one transactional owner, or add one canonical durable repair-owner record that becomes the truth boundary for all post-commit recovery.
- whether it blocks launch: Yes

### Finding A4
- severity: Medium
- workflow name: Intake signed -> draft POF + intake PDF persistence
- exact files/functions/modules:
  - `app/intake-actions.ts` -> `createAssessmentAction`
  - `lib/services/intake-pof-mhp-cascade.ts` -> `completeIntakeAssessmentPostSignWorkflow`
- what should happen:
  - Intake signing, draft POF creation, and required PDF/member-file persistence should either complete as one staged truth contract or clearly remain incomplete.
- what currently happens:
  - Intake signing commits first. Draft POF creation and generated PDF persistence happen afterward in a separate workflow stage.
- how partial failure could occur:
  - A signed intake can exist while draft POF creation or member-file persistence still needs repair.
- recommended fix:
  - Keep the current staged model, but keep enforcing one canonical post-sign readiness state and never let signed intake imply downstream readiness before follow-up clears.
- whether it blocks launch: No

### Finding A5
- severity: Medium
- workflow name: Lead conversion plus lead activity logging
- exact files/functions/modules:
  - `lib/services/sales-lead-conversion-supabase.ts` -> `applyLeadStageTransitionWithMemberUpsertSupabase`
  - `lib/services/sales-lead-activities.ts` -> `createSalesLeadActivity`
  - `app/sales-lead-actions.ts` -> `createSalesLeadActivityAction`
- what should happen:
  - Conversion and its canonical conversion activity should commit as one business event, or one durable repair owner should exist.
- what currently happens:
  - The conversion RPC commits first. Lead activity logging still happens afterward, although the UI now returns committed `follow_up_required` truth if the second step fails.
- how partial failure could occur:
  - A lead becomes a member, but the canonical activity trail can still be missing until staff repair it.
- recommended fix:
  - Move conversion activity logging into the conversion RPC, or create one durable repair queue owned by the service layer.
- whether it blocks launch: No

### Finding A6
- severity: Medium
- workflow name: POF signed -> MHP/MCC/MAR cascade
- exact files/functions/modules:
  - `supabase/migrations/0053_artifact_drift_replay_hardening.sql` -> `rpc_finalize_pof_signature`
  - `lib/services/pof-post-sign-runtime.ts` -> `runBestEffortCommittedPofSignatureFollowUp`
  - `lib/services/physician-orders-supabase.ts` -> `runCommittedPhysicianOrderPostSignSyncSafely`
- what should happen:
  - Legal signing and downstream clinical sync should have one clear staged truth boundary.
- what currently happens:
  - The signed request commits first and downstream MHP/MCC/MAR sync runs afterward through the queue/follow-up path.
- how partial failure could occur:
  - The order is durably signed while downstream clinical sync is still queued or degraded.
- recommended fix:
  - Keep the queue boundary, but continue treating `signed` as legally complete and not operationally ready until queue status is `completed`.
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
  - When `p_existing_member_id` is supplied, the DB function updates that member row and sets `source_lead_id = p_lead_id` without proving the member already belongs to that lead or is an explicitly safe unlinked shell.
- why it matters:
  - A privileged caller could accidentally or incorrectly steal an existing member from another lead relationship.
- recommended DB/service fix:
  - Add a DB assertion that `p_existing_member_id` must already belong to the same lead, or be an explicitly allowed unlinked shell, otherwise fail closed.
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
  - Staff notifications should not claim readiness when downstream work is still queued or degraded.
- exact files/migrations/services involved:
  - `lib/services/notification-content.ts`
  - `lib/services/pof-post-sign-runtime.ts`
  - `lib/services/care-plan-esign-public.ts`
- what invariant is not enforced:
  - Notification text still says `Clinical documents are ready for review` and `Final clinical document is ready` even though runtime truth supports queued and degraded outcomes.
- why it matters:
  - Staff-facing workflow truth can drift away from the canonical readiness model and encourage premature action.
- recommended DB/service fix:
  - Generate signed notifications from the same readiness resolver family used by the public completion flows, and only say `ready` when readiness is actually ready.
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
  - The database replay guard prevents duplicate finalization, but the loser can still delete the winner's files from storage.
- recommended protection:
  - Treat `was_already_signed` as strictly read-only and never clean up deterministic canonical signed paths.
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
  - The DB replay guard keeps one signed row, but the losing request can still delete the winning caregiver artifacts.
- recommended protection:
  - Same as POF: do not clean up canonical committed paths on replay-safe results.
- whether it blocks launch: Yes

### Finding I3
- severity: Low
- workflow name: Enrollment packet public token replay
- concurrency/replay scenario:
  - Double-submit or retry while the packet is completed or the active token has expired.
- exact files/functions involved:
  - `lib/services/enrollment-packets-public-runtime.ts`
  - `lib/services/enrollment-packets-public-runtime-context.ts`
  - `tests/enrollment-packet-expired-completed-token-guard.test.ts`
- what duplicate/conflicting state could happen:
  - Current evidence here is better than yesterday's risk set. Expired active tokens now fail before the completed replay branch unless the token was already consumed by the committed submission.
- recommended protection:
  - Keep the current consumed-token plus expiry ordering and keep the regression test in place.
- whether it blocks launch: No

### Finding I4
- severity: Low
- workflow name: Create-and-convert lead replay
- concurrency/replay scenario:
  - Duplicate create-and-convert attempts for the same lead conversion root event.
- exact files/functions involved:
  - `lib/services/sales-lead-conversion-supabase.ts`
  - `supabase/migrations/0165_idempotency_write_roots_and_dedupe_contracts.sql`
- what duplicate/conflicting state could happen:
  - I did not confirm a current blocker here. The create-and-convert path now uses a root idempotency key and DB uniqueness contract.
- recommended protection:
  - Keep the root idempotency contract and continue nightly checks for duplicate lead/member conversion roots.
- whether it blocks launch: No

### Finding I5
- severity: Low
- workflow name: Intake draft POF replay
- concurrency/replay scenario:
  - Repeated intake post-sign processing could previously create duplicate draft POF attempts.
- exact files/functions involved:
  - `lib/services/intake-pof-mhp-cascade.ts`
  - `supabase/migrations/0181_physician_order_save_rpc_atomicity.sql`
  - `supabase/migrations/0038_acid_uniqueness_guards.sql`
- what duplicate/conflicting state could happen:
  - Current evidence looks improved. The draft-Pof RPC now uses row locking, an advisory member lock, and the unique intake draft/sent guard.
- recommended protection:
  - Keep the current locking and uniqueness model and preserve regression coverage.
- whether it blocks launch: No

## 5. Durability Risks

### Finding D1
- severity: Medium
- workflow name: Enrollment packet post-commit failure fallback
- exact files/functions involved:
  - `lib/services/enrollment-packets-public-runtime-follow-up.ts` -> `buildEnrollmentPacketPostCommitFailureResult`
- what success currently means:
  - The caller can still receive an `action_required` result after a committed packet hits post-commit failure.
- what may fail underneath:
  - The fallback builder still logs and continues if its own `completion_follow_up_status = 'action_required'` persistence write fails.
- why that is unsafe:
  - The UI can still say `action required` while the root packet row never durably recorded that state in the fallback path.
- recommended correction:
  - Make the fallback builder fail closed too, or persist one separate durable repair record that becomes the canonical fallback truth.
- whether it blocks launch: No

### Finding D2
- severity: Medium
- workflow name: Care plan nurse signature finalize failure after reused artifact row
- exact files/functions involved:
  - `lib/services/care-plan-nurse-esign.ts` -> `cleanupCarePlanNurseSignatureArtifactAfterFinalizeFailure`
  - `lib/services/clinical-esign-artifacts.ts`
- what success currently means:
  - The flow can reuse an existing signature artifact member-file row during nurse-sign finalization.
- what may fail underneath:
  - If finalization later fails and the artifact row was reused instead of newly created, the code raises a split-brain alert and stops instead of rolling the artifact back.
- why that is unsafe:
  - Storage/member-file artifact truth can survive a failed finalize boundary and require manual reconciliation.
- recommended correction:
  - Use temporary artifact paths until finalize succeeds, or add deterministic rollback rules for reused artifact rows.
- whether it blocks launch: No

### Finding D3
- severity: Medium
- workflow name: Signed POF downstream sync runner dependency
- exact files/functions involved:
  - `app/api/internal/pof-post-sign-sync/route.ts`
  - `lib/services/internal-runner-health.ts`
  - `lib/services/physician-order-clinical-sync.ts`
- what success currently means:
  - The order can be durably signed while downstream sync still depends on the queue runner staying configured and healthy.
- what may fail underneath:
  - If the runner route is not configured or stops processing queued rows, signed POF follow-up can remain queued/degraded.
- why that is unsafe:
  - This is safer than false success because readiness remains queued, but it still creates an operational durability dependency.
- recommended correction:
  - Keep runner health monitoring visible and alert on aged `pof_post_sign_sync_queue` rows until the queue path is proven reliable in production.
- whether it blocks launch: No

## 6. ACID Hardening Plan

1. Remove replay cleanup of canonical signed files in public POF signing.
2. Remove replay cleanup of canonical signed files in public care plan signing.
3. Add regression tests that fail if replay-safe `already signed` branches delete canonical committed artifacts.
4. Add a DB fail-closed assertion for `p_existing_member_id` inside `apply_lead_stage_transition_with_member_upsert`.
5. Change care plan final signed `document_source` to a per-care-plan value and backfill safely.
6. Fix enrollment packet split-commit by widening the transactional owner or adding one durable repair-owner record for all post-commit recovery.
7. Make the enrollment packet fallback builder fail closed if its `action_required` write cannot be persisted.
8. Keep staged workflows staged, but make every signed-vs-ready message derive from the canonical readiness resolvers instead of generic ready wording.
9. Reuse the new verified-replacement member-file pattern for any remaining generated artifact flows that still overwrite files without post-write verification.

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
- Add the lead-conversion DB assertion for `p_existing_member_id`.
- Change care plan final signed `document_source` to include the care-plan id.
- Make the enrollment packet fallback builder fail closed if its `action_required` write cannot be persisted.

## 9. Automate Later

- Nightly check for signed POF rows whose signature image or signed PDF is missing from storage.
- Nightly check for signed care plans whose caregiver signature or final PDF is missing from storage.
- Nightly check for completed enrollment packets with no completed-packet artifact or missing member-file linkage.
- Nightly check for enrollment packets whose returned readiness result does not match durable `completion_follow_up_status`.
- Nightly check for aged `pof_post_sign_sync_queue` rows and missing runner configuration.
- Schema guard test that rejects `p_existing_member_id` values already owned by another lead.
- Notification/readiness matrix tests so `ready` language cannot drift away from canonical readiness resolvers.
- Regression tests around generated member-file replacement so superseded storage is only deleted after verified persistence.

## 10. Founder Summary: What changed since the last run

- Better in the current worktree:
  - Enrollment packet active expired tokens are now rejected before the completed replay branch unless the token was already consumed by the committed submission. Evidence: `lib/services/enrollment-packets-public-runtime.ts`, `lib/services/enrollment-packets-public-runtime-context.ts`, and `tests/enrollment-packet-expired-completed-token-guard.test.ts`.
  - Enrollment packet main follow-up truth is stricter because the main cascade now throws if `completion_follow_up_status` persistence fails. Evidence: `lib/services/enrollment-packets-public-runtime-cascade.ts` and `lib/services/enrollment-packets-public-runtime-follow-up.ts`.
  - Lead conversion follow-up truth is safer for staff because post-conversion activity failure now returns committed `follow_up_required` truth instead of a generic failure. Evidence: `app/sales-lead-actions.ts`, `lib/services/sales-lead-activities.ts`, and `tests/sales-lead-activity-committed-truth.test.ts`.
  - Intake assessment writes now require explicit `health` edit permission in addition to signer-role gating. Evidence: `app/intake-actions.ts` and `tests/intake-assessment-readiness-ui.test.ts`.
  - Generated member PDFs now replace canonical `document_source` rows and only delete superseded storage after verified persistence. Evidence: `lib/services/member-files.ts`, `app/(portal)/health/physician-orders/actions.ts`, `app/(portal)/members/[memberId]/diet-card/actions.ts`, `app/(portal)/members/[memberId]/name-badge/actions.ts`, and `tests/generated-member-pdf-idempotency.test.ts`.
- Still unresolved:
  - The public POF replay-delete launch blocker is still present.
  - The public care plan replay-delete launch blocker is still present.
  - Enrollment packet completion is still a split commit.
  - Lead conversion still trusts `p_existing_member_id` too much in the DB layer.
  - Care plan final signed files still have a document-source collision risk.
  - The enrollment packet fallback builder can still fail open when persisting `action_required` truth.
  - Signed notification copy still overstates readiness in queued or degraded paths.
- Newly surfaced tonight:
  - No new critical ACID blocker was found beyond the existing blocker set.
  - The clearest new improvement area is member-file durability for generated PDFs, not deeper transaction-boundary hardening.

## Validation Notes

- This was a read-only audit. No repo code or migrations were changed.
- I inspected current code, migrations, diffs, and source-level regression tests.
- I did not run `npm run typecheck` or `npm run build` because there were no code edits in this audit pass.
