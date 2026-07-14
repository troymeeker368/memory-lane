# Memory Lane ACID Transaction Audit - 2026-05-12

## 1. Executive Summary

- Overall ACID safety rating: 7.4 / 10
- Overall verdict: Partial
- Top 5 ACID risks:
  - Public POF replay losers can still overwrite and then delete the winning signed artifacts after the database already says the request is signed.
  - Public care plan replay losers can still overwrite and then delete the winning caregiver signature and final signed PDF.
  - Enrollment packet completion is still split between the finalize RPC and later post-commit artifact/mapping work.
  - Lead conversion still lets `p_existing_member_id` relink an existing member without proving it belongs to the same lead.
  - Care plan final signed files still share one `document_source`, which can block a second signed care plan for the same member.
- Strongest workflows:
  - Intake -> draft POF creation is materially safer because `rpc_create_draft_physician_order_from_intake` uses row locking, an advisory member lock, and draft reuse instead of parallel duplicate creation. Evidence: `supabase/migrations/0181_physician_order_save_rpc_atomicity.sql`.
  - Generated member PDFs are safer because the system now reuses the canonical `document_source` row and only deletes superseded storage after verified persistence. Evidence: `lib/services/member-files.ts`, `app/(portal)/health/physician-orders/actions.ts`, `app/(portal)/members/[memberId]/diet-card/actions.ts`, `app/(portal)/members/[memberId]/name-badge/actions.ts`.
  - Enrollment packet replay handling is better because active expired tokens are rejected before the completed replay branch, and near-simultaneous replay losers can return before upload bytes are materialized. Evidence: `lib/services/enrollment-packets-public-runtime.ts`, `lib/services/enrollment-packets-public-runtime-context.ts`, `tests/enrollment-packet-expired-completed-token-guard.test.ts`, `tests/finalize-commit-verification-regressions.test.ts`.
  - Enrollment packet main follow-up truth is stricter because the main cascade now throws if `completion_follow_up_status` persistence fails. Evidence: `lib/services/enrollment-packets-public-runtime-cascade.ts`, `lib/services/enrollment-packets-public-runtime-follow-up.ts`.
- Short founder summary:
  - The platform got better at telling the truth about degraded workflows, and generated member-file replacements are safer. The launch blockers are still the same core ones: replay-safe public signing is not actually safe yet, enrollment completion is still a split commit, and lead conversion still has a member relink gap.

## 2. Atomicity Violations

### Finding A1
- Severity: Critical
- Workflow name: Public POF signature completion replay
- Exact files/functions/modules:
  - `lib/services/pof-esign-public.ts` -> `submitPublicPofSignature`
  - `lib/services/pof-esign-public.ts` -> `cleanupFailedPofSignatureArtifacts`
  - `supabase/migrations/0053_artifact_drift_replay_hardening.sql` -> `rpc_finalize_pof_signature`
- What should happen:
  - If one request already won, any replay loser should return the already-committed result without touching the committed signature image or signed PDF.
- What currently happens:
  - The app uploads `provider-signature.png` and `signed.pdf` to deterministic canonical paths before calling the replay-aware RPC. If the RPC returns `was_already_signed`, the app still calls cleanup on those same canonical paths.
- How partial failure could occur:
  - Request A commits signed state. Request B retries or arrives almost at the same time, overwrites the same storage paths, then deletes them in cleanup. The database stays signed while the committed artifacts disappear.
- Recommended fix:
  - Treat `was_already_signed` as read-only. Do not upload or clean up deterministic canonical signed paths in that replay branch, or move replay-safe artifact writes behind a staging path that is only promoted on the winning commit.
- Whether it blocks launch: Yes

### Finding A2
- Severity: Critical
- Workflow name: Public care plan caregiver signing replay
- Exact files/functions/modules:
  - `lib/services/care-plan-esign-public.ts` -> `submitPublicCarePlanSignature`
  - `lib/services/care-plan-esign-public.ts` -> `cleanupFailedCarePlanCaregiverArtifacts`
  - `supabase/migrations/0053_artifact_drift_replay_hardening.sql` -> `rpc_finalize_care_plan_caregiver_signature`
- What should happen:
  - A replay loser should return the already-committed signed care plan result without touching the winning caregiver signature or final PDF.
- What currently happens:
  - The app uploads `caregiver-signature.png` and `final-signed.pdf` to deterministic canonical paths before the RPC runs, then still cleans those paths up when `wasAlreadySigned` is true.
- How partial failure could occur:
  - One request wins the DB transition, a second request loses the race, but the loser can still overwrite and then delete the winning artifacts.
- Recommended fix:
  - Mirror the POF fix. Replay-safe results must never clean up canonical committed artifact paths.
- Whether it blocks launch: Yes

### Finding A3
- Severity: High
- Workflow name: Enrollment packet public completion
- Exact files/functions/modules:
  - `supabase/migrations/0180_enrollment_completion_follow_up_state.sql` -> `rpc_finalize_enrollment_packet_submission`
  - `lib/services/enrollment-packets-public-runtime.ts` -> `submitPublicEnrollmentPacketWithDeps`
  - `lib/services/enrollment-packets-public-runtime-post-commit.ts` -> `completeCommittedPublicEnrollmentPacketPostCommitWork`
  - `lib/services/enrollment-packets-public-runtime-artifacts.ts` -> `persistFinalizedPublicEnrollmentPacketArtifacts`
  - `lib/services/enrollment-packets-public-runtime-cascade.ts` -> `runEnrollmentPacketCascadeAndBuildResult`
- What should happen:
  - Completion, finalized artifacts, member-file linkage, notifications, and downstream mapping should either finish together or be owned by one durable repair record.
- What currently happens:
  - The RPC marks the packet `completed`, finalizes staged upload rows, and sets `mapping_sync_status = 'pending'` and `completion_follow_up_status = 'pending'`. After that, the app still has to build artifacts, link member files, send notifications, and run downstream mapping.
- How partial failure could occur:
  - The packet can be durably completed while the completed-packet PDF, linked uploads, sender notification, lead activity, or downstream MCC/MHP/POF handoff is still missing or degraded.
- Recommended fix:
  - Either widen the transactional owner, or create one explicit durable repair-owner record that becomes the truth boundary for all post-commit recovery work.
- Whether it blocks launch: Yes

### Finding A4
- Severity: Medium
- Workflow name: Lead conversion plus lead activity logging
- Exact files/functions/modules:
  - `supabase/migrations/0158_lead_conversion_shell_success_guard.sql` -> `apply_lead_stage_transition_with_member_upsert`
  - `lib/services/sales-lead-activities.ts` -> `createSalesLeadActivity`
  - `app/sales-lead-actions.ts` -> `createSalesLeadActivityAction`
- What should happen:
  - Conversion and its canonical conversion activity should commit as one business event, or one durable repair owner should exist.
- What currently happens:
  - Conversion commits first. Lead activity logging still happens afterward, although the UI now correctly returns `follow_up_required` truth when that second write fails.
- How partial failure could occur:
  - A lead becomes a member but the canonical activity trail can still be missing until staff repair it.
- Recommended fix:
  - Move conversion activity logging into the conversion transaction, or create one durable repair queue owned by the service layer.
- Whether it blocks launch: No

### Finding A5
- Severity: Medium
- Workflow name: Intake signed -> draft POF and intake artifact follow-up
- Exact files/functions/modules:
  - `app/intake-actions.ts` -> `createAssessmentAction`
  - `lib/services/intake-pof-mhp-cascade.ts` -> `completeIntakeAssessmentPostSignWorkflow`
  - `supabase/migrations/0181_physician_order_save_rpc_atomicity.sql` -> `rpc_create_draft_physician_order_from_intake`
- What should happen:
  - Signed intake should only imply downstream readiness when draft POF creation and required follow-up are durably complete.
- What currently happens:
  - Intake signing commits first, then draft POF creation and member-file verification happen in a staged post-sign workflow. The good news is the readiness model now honestly keeps degraded outcomes out of the clean success path.
- How partial failure could occur:
  - A signed intake can exist while draft POF creation or PDF/member-file verification still needs repair.
- Recommended fix:
  - Keep the staged model, but continue treating intake as signed-not-ready until the canonical post-sign readiness state clears.
- Whether it blocks launch: No

## 3. Consistency Gaps

### Finding C1
- Severity: High
- Affected schema/business rule:
  - Lead conversion must not relink an unrelated existing member.
- Exact files/migrations/services involved:
  - `supabase/migrations/0158_lead_conversion_shell_success_guard.sql` -> `apply_lead_stage_transition_with_member_upsert`
  - `lib/services/sales-lead-conversion-supabase.ts`
- What invariant is not enforced:
  - When `p_existing_member_id` is supplied, the DB function updates that member and sets `source_lead_id = p_lead_id` without proving the member already belongs to the same lead or is an explicitly allowed unlinked shell.
- Why it matters:
  - A privileged caller can accidentally steal or relink the wrong member record during conversion.
- Recommended DB/service fix:
  - Add a fail-closed DB assertion: supplied `p_existing_member_id` must already belong to the same lead or be a clearly allowed unlinked shell, otherwise raise an error.
- Whether it blocks launch: Yes

### Finding C2
- Severity: High
- Affected schema/business rule:
  - Final signed care plan files must support more than one signed care plan per member.
- Exact files/migrations/services involved:
  - `supabase/migrations/0053_artifact_drift_replay_hardening.sql` -> `rpc_finalize_care_plan_caregiver_signature`
  - `supabase/migrations/0091_member_files_document_source_unique.sql`
- What invariant is not enforced:
  - The finalize RPC still writes `document_source = 'Care Plan Final Signed'`, while the schema enforces unique `(member_id, document_source)`.
- Why it matters:
  - A second valid signed care plan for the same member can fail for storage/record reasons even though the care plan itself is legitimate.
- Recommended DB/service fix:
  - Make final signed `document_source` unique per care plan, such as `Care Plan Final Signed:<care_plan_id>`, and backfill safely.
- Whether it blocks launch: Yes

### Finding C3
- Severity: Medium
- Affected schema/business rule:
  - Staff notifications should not claim readiness when downstream work is still queued or degraded.
- Exact files/migrations/services involved:
  - `lib/services/notification-content.ts`
  - `lib/services/pof-post-sign-runtime.ts`
  - `lib/services/care-plan-esign-public.ts`
- What invariant is not enforced:
  - Notification text still says `Clinical documents are ready for review` for signed POFs and `Final clinical document is ready` for signed care plans, even though the runtime truth model distinguishes ready, queued, and follow-up-required states.
- Why it matters:
  - Staff can act on a false operational signal even when legal signing is complete but downstream sync is not.
- Recommended DB/service fix:
  - Generate signed notifications from the same readiness resolver family used by the runtime flows, and only say `ready` when readiness is actually ready.
- Whether it blocks launch: No

## 4. Isolation Risks

### Finding I1
- Severity: Critical
- Workflow name: Public POF signing replay
- Concurrency/replay scenario:
  - Two near-simultaneous submissions of the same signing token, or one retry after the first request already committed.
- Exact files/functions involved:
  - `lib/services/pof-esign-public.ts` -> `submitPublicPofSignature`
  - `supabase/migrations/0053_artifact_drift_replay_hardening.sql` -> `rpc_finalize_pof_signature`
- What duplicate/conflicting state could happen:
  - The database prevents duplicate finalization, but the losing request can still overwrite and then delete the winning storage artifacts.
- Recommended protection:
  - Make replay-safe `already signed` handling strictly read-only and add a regression test that fails if committed artifact paths are touched.
- Whether it blocks launch: Yes

### Finding I2
- Severity: Critical
- Workflow name: Public care plan caregiver signing replay
- Concurrency/replay scenario:
  - Two close submissions of the same caregiver token, or one retry after the winner already committed.
- Exact files/functions involved:
  - `lib/services/care-plan-esign-public.ts` -> `submitPublicCarePlanSignature`
  - `supabase/migrations/0053_artifact_drift_replay_hardening.sql` -> `rpc_finalize_care_plan_caregiver_signature`
- What duplicate/conflicting state could happen:
  - The database keeps one signed row, but the losing request can still overwrite and then delete the committed caregiver artifacts.
- Recommended protection:
  - Same fix as POF: no cleanup of canonical committed paths on replay-safe results.
- Whether it blocks launch: Yes

## 5. Durability Risks

### Finding D1
- Severity: Medium
- Workflow name: Enrollment packet post-commit fallback truth
- Exact files/functions involved:
  - `lib/services/enrollment-packets-public-runtime-follow-up.ts` -> `buildEnrollmentPacketPostCommitFailureResult`
- What success currently means:
  - The caller can still receive an `action_required` result after a committed packet hits post-commit failure.
- What may fail underneath:
  - If the fallback attempt to persist `completion_follow_up_status = 'action_required'` fails, the function logs the error and still returns the `action_required` result.
- Why that is unsafe:
  - The UI can tell staff that follow-up is required while the packet row never durably recorded that fact.
- Recommended correction:
  - Make the fallback builder fail closed too, or persist one separate durable repair record and use that as the canonical truth.
- Whether it blocks launch: No

### Finding D2
- Severity: Medium
- Workflow name: Care plan nurse signature finalize failure after reused signature artifact row
- Exact files/functions involved:
  - `lib/services/care-plan-nurse-esign.ts` -> `cleanupCarePlanNurseSignatureArtifactAfterFinalizeFailure`
- What success currently means:
  - The flow can reuse an existing nurse-signature artifact member-file row during finalization.
- What may fail underneath:
  - If finalization later fails and the artifact row was reused instead of newly created, cleanup stops at a `care_plan_nurse_signature_finalize_split_brain` alert instead of rolling the artifact back.
- Why that is unsafe:
  - Storage/member-file truth can survive a failed finalize boundary and require manual reconciliation.
- Recommended correction:
  - Use temporary artifact paths until finalize succeeds, or add deterministic rollback rules for reused artifact rows.
- Whether it blocks launch: No

### Finding D3
- Severity: Medium
- Workflow name: Signed POF downstream sync runner dependency
- Exact files/functions involved:
  - `lib/services/physician-order-post-sign-service.ts`
  - `app/api/internal/pof-post-sign-sync/route.ts`
  - `lib/services/internal-runner-health.ts`
- What success currently means:
  - The order can be durably signed while downstream MHP/MCC/MAR sync is still queued.
- What may fail underneath:
  - If the retry runner is not configured or stops processing queued rows, post-sign sync can sit in queued or failed state.
- Why that is unsafe:
  - This is safer than false success because the readiness model warns staff, but it still creates a real operational durability dependency on the runner.
- Recommended correction:
  - Keep the queue/readiness truth, and add visible aged-queue monitoring with alerts for stuck rows.
- Whether it blocks launch: No

## 6. ACID Hardening Plan

1. Remove replay cleanup of canonical signed files in public POF signing.
2. Remove replay cleanup of canonical signed files in public care plan signing.
3. Add regression tests that fail if replay-safe `already signed` branches write to or delete canonical committed artifact paths.
4. Add a DB fail-closed assertion for `p_existing_member_id` inside `apply_lead_stage_transition_with_member_upsert`.
5. Change care plan final signed `document_source` from a shared constant to a per-care-plan value and backfill safely.
6. Fix enrollment packet split-commit by widening the transaction owner or adding one durable repair-owner record for all post-commit recovery.
7. Make the enrollment packet fallback builder fail closed if it cannot persist `action_required` truth.
8. Move conversion activity logging into the conversion transaction, or add one canonical durable repair queue for missing activity trails.
9. Keep staged workflows staged, but make every staff-facing “ready” message come from the same canonical readiness resolvers.

## 7. Suggested Codex Prompts

- Fix Memory Lane POF replay artifact deletion. In `lib/services/pof-esign-public.ts`, the `finalized.was_already_signed` branch still calls `cleanupFailedPofSignatureArtifacts(...)` on deterministic canonical signed paths. Prevent replay losers from touching committed artifacts and add a regression test.
- Fix Memory Lane care plan replay artifact deletion. In `lib/services/care-plan-esign-public.ts`, the `finalized.wasAlreadySigned` branch still deletes deterministic caregiver signature and final PDF paths. Make replay-safe results read-only and add regression coverage.
- Fix Memory Lane enrollment packet split-commit. `rpc_finalize_enrollment_packet_submission` still marks the packet completed before finalized artifacts, member-file linkage, notifications, and downstream mapping are fully durable. Move more required work under one canonical transaction owner, or add one durable repair-owner record for all post-commit recovery.
- Fix Memory Lane lead conversion relink safety. Add a DB assertion inside `apply_lead_stage_transition_with_member_upsert` so `p_existing_member_id` must already belong to the same lead or an explicitly allowed unlinked shell, otherwise fail closed.
- Fix Memory Lane care plan final signed document-source collisions. Replace the shared `document_source = 'Care Plan Final Signed'` contract with a per-care-plan value and add a migration-safe backfill.
- Fix Memory Lane enrollment packet fallback truth. In `lib/services/enrollment-packets-public-runtime-follow-up.ts`, `buildEnrollmentPacketPostCommitFailureResult` still returns `action_required` even if persisting that status fails. Make it fail closed or write one durable repair record first.
- Fix Memory Lane signed notification truth. Update `lib/services/notification-content.ts` so POF and care plan signed notifications reflect canonical readiness instead of always saying `ready`.

## 8. Fix First Tonight

- Remove replay cleanup in public POF signing.
- Remove replay cleanup in public care plan signing.
- Add the lead-conversion DB assertion for `p_existing_member_id`.
- Change care plan final signed `document_source` to include the care-plan id.
- Make enrollment packet fallback `action_required` persistence fail closed.

## 9. Automate Later

- Nightly check for signed POF rows whose signature image or signed PDF is missing from storage.
- Nightly check for signed care plans whose caregiver signature or final PDF is missing from storage.
- Nightly check for completed enrollment packets with no completed-packet artifact or missing member-file linkage.
- Nightly check for enrollment packets whose returned follow-up result does not match durable `completion_follow_up_status`.
- Nightly check for aged `pof_post_sign_sync_queue` rows and missing runner configuration.
- Schema guard test that rejects `p_existing_member_id` values already owned by another lead.
- Regression test that rejects replay-safe public signing branches if they touch committed canonical storage paths.
- Notification/readiness matrix tests so `ready` language cannot drift away from canonical readiness resolvers.

## 10. Founder Summary: What changed since the last run

- Better in the current worktree:
  - Enrollment packet active expired tokens are now rejected before the completed replay branch unless the token was already consumed by the committed submission. Evidence: `lib/services/enrollment-packets-public-runtime.ts`, `lib/services/enrollment-packets-public-runtime-context.ts`, `tests/enrollment-packet-expired-completed-token-guard.test.ts`.
  - Enrollment packet main follow-up truth is stricter because the main cascade now throws if `completion_follow_up_status` persistence fails. Evidence: `lib/services/enrollment-packets-public-runtime-cascade.ts`, `lib/services/enrollment-packets-public-runtime-follow-up.ts`.
  - Lead conversion follow-up truth is safer for staff because post-conversion activity failure now returns committed `follow_up_required` truth instead of generic failure, and lead activities now have a DB-backed idempotency key contract. Evidence: `app/sales-lead-actions.ts`, `lib/services/sales-lead-activities.ts`, `supabase/migrations/0222_lead_activity_idempotency_hardening.sql`, `lib/services/enrollment-packet-mapping-runtime.ts`.
  - Intake assessment writes now require explicit `health` edit permission in addition to signer-role gating. Evidence: `app/intake-actions.ts`.
  - Generated member PDFs now replace canonical `document_source` rows and only delete superseded storage after verified persistence. Evidence: `lib/services/member-files.ts`, `app/(portal)/health/physician-orders/actions.ts`, `app/(portal)/members/[memberId]/diet-card/actions.ts`, `app/(portal)/members/[memberId]/name-badge/actions.ts`.
- Still unresolved:
  - The public POF replay-delete launch blocker is still present.
  - The public care plan replay-delete launch blocker is still present.
  - Enrollment packet completion is still a split commit.
  - Lead conversion still trusts `p_existing_member_id` too much in the DB layer.
  - Care plan final signed files still have a `document_source` collision risk.
  - The enrollment packet fallback builder can still fail open when persisting `action_required` truth.
  - Signed notification copy still overstates readiness in queued or degraded paths.
- Newly surfaced tonight:
  - No new critical ACID blocker was found beyond the existing blocker set.
  - The clearest new improvement is better degraded-truth handling, not a closure of the core launch blockers.

## Validation Notes

- This was a read-only audit. No application code or migrations were changed.
- I attempted targeted `node --test` runs for the relevant regression files, but this environment blocked execution with `spawn EPERM`, so the conclusions are source-based rather than runtime-verified.
