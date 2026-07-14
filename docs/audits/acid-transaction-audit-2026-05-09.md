# Memory Lane ACID Transaction Audit - 2026-05-09

## 1. Executive Summary

- Overall ACID safety rating: 7.0 / 10
- Overall verdict: Partial
- Top 5 ACID risks:
  - Public POF replay can still delete the winning signed files from storage after the database already says the request is signed.
  - Public care plan replay can still delete the winning caregiver-signed files from storage after the database already says the care plan is signed.
  - Enrollment packet completion still marks the packet completed before finalized artifacts, member-file linkage, notifications, and downstream mapping finish.
  - Lead conversion still trusts `p_existing_member_id` too much inside the DB function and can relink the wrong member if a privileged caller supplies a bad id.
  - Care plan final signed files still use one shared `document_source`, which can block a second signed care plan for the same member.
- Strongest workflows:
  - Signed POF downstream MHP/MCC/MAR follow-up is materially safer because the post-sign boundary keeps queued and failed downstream work out of the clean-ready state.
  - Intake -> draft POF is safer because committed-but-unverified draft creation now stays in queued/degraded truth instead of pretending the workflow is done.
  - MAR monthly report generation now fails closed on member-file persistence and returns follow-up-needed instead of fake success.
  - Enrollment packet public token replay handling is stronger than older baselines because completed replay losers can short-circuit before upload work.
- Short founder summary:
  - The platform is better at telling the truth when downstream work is only partially done, but the biggest launch blockers from the last run are still open. The most urgent problems remain replay-driven file deletion in public signing and the enrollment packet split-commit architecture.

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
  - The flow uploads deterministic canonical paths first, then on `finalized.was_already_signed` it still calls `cleanupFailedPofSignatureArtifacts(...)` against those same canonical paths.
- how partial failure could occur:
  - One request wins and commits the signed row. A replaying request loses the DB race but still deletes `provider-signature.png` and `signed.pdf` from storage afterward.
- recommended fix:
  - Never run cleanup against canonical signed paths on `was_already_signed`. Either upload to unique temporary paths before finalize, or only delete files that this request can prove are orphaned and non-canonical.
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
  - The flow uploads deterministic canonical caregiver artifact paths first, then on `finalized.wasAlreadySigned` it still calls `cleanupFailedCarePlanCaregiverArtifacts(...)`.
- how partial failure could occur:
  - The DB stays signed while the replay loser removes `caregiver-signature.png` and `final-signed.pdf` from storage.
- recommended fix:
  - Mirror the POF fix: no cleanup on replay-safe committed results unless the flow can prove the files are not the canonical committed artifacts.
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
  - Packet completion, completed packet artifact persistence, member-file linkage, follow-up truth, and downstream handoff should succeed together or fail together.
- what currently happens:
  - The finalize RPC sets the packet to `completed` and `completion_follow_up_status = 'pending'` first. Artifact persistence, notification truth, and mapping run later in post-commit code.
- how partial failure could occur:
  - The packet can be durably completed while the completed packet PDF, linked uploads, sender notification, or downstream mapping is still missing or only partially finished.
- recommended fix:
  - Move more required artifact/linkage work under one transactional owner, or add one explicit repair-owner record that becomes the canonical truth boundary for all post-commit recovery.
- whether it blocks launch: Yes

### Finding A4
- severity: Medium
- workflow name: Lead conversion + conversion activity logging
- exact files/functions/modules:
  - `lib/services/sales-lead-conversion-supabase.ts` -> `applyLeadStageTransitionWithMemberUpsertSupabase`
  - `lib/services/sales-lead-activities.ts` -> `createSalesLeadActivity`
  - `app/sales-lead-actions.ts` -> `createSalesLeadActivityAction`
- what should happen:
  - Conversion and the canonical conversion activity should commit as one business event, or the system should own one durable repair path.
- what currently happens:
  - The conversion RPC commits first. The lead activity insert still happens afterward. The new code now returns committed-follow-up-needed truth if that insert fails, which is safer for staff, but it is still a split commit.
- how partial failure could occur:
  - A lead becomes a member, but the conversion activity row can still fail to persist.
- recommended fix:
  - Move the conversion activity write into the conversion RPC, or add one durable repair queue for missing conversion activity rows.
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
  - When `p_existing_member_id` is supplied, the DB function updates that member row and sets `source_lead_id = p_lead_id` without proving the supplied member already belongs to that lead or is explicitly safe to claim.
- why it matters:
  - App-side resolution may usually be correct, but the database boundary itself still trusts the caller too much.
- recommended DB/service fix:
  - Add a DB assertion that `p_existing_member_id` must already belong to the same lead, or be an explicitly allowed unlinked row, otherwise fail closed.
- whether it blocks launch: Yes

### Finding C2
- severity: High
- affected schema/business rule:
  - Final signed care plan files should support more than one signed care plan per member.
- exact files/migrations/services involved:
  - `supabase/migrations/0053_artifact_drift_replay_hardening.sql` -> `rpc_finalize_care_plan_caregiver_signature`
  - `supabase/migrations/0091_member_files_document_source_unique.sql`
- what invariant is not enforced:
  - The RPC writes `document_source = 'Care Plan Final Signed'`, while the schema enforces unique `(member_id, document_source)`.
- why it matters:
  - A second signed care plan for the same member can collide even if the care plan itself is valid.
- recommended DB/service fix:
  - Make `document_source` unique per care-plan id or track, not one shared label per member.
- whether it blocks launch: Yes

### Finding C3
- severity: Medium
- affected schema/business rule:
  - Staff notifications should not overstate readiness when downstream work is still queued or degraded.
- exact files/migrations/services involved:
  - `lib/services/notification-content.ts`
  - `lib/services/pof-post-sign-runtime.ts`
  - `lib/services/physician-order-clinical-sync.ts`
  - `lib/services/care-plan-esign-public.ts`
- what invariant is not enforced:
  - Notification content still says `POF signed... Clinical documents are ready for review.` and `Care Plan signed... Final clinical document is ready.` even though runtime truth now supports queued/degraded and action-needed outcomes.
- why it matters:
  - Staff-facing workflow truth can disagree with the canonical readiness model and encourage premature downstream action.
- recommended DB/service fix:
  - Generate signed notifications from the same readiness resolver used by the public completion flows, and only say “ready” when the downstream readiness state is actually ready.
- whether it blocks launch: No

## 4. Isolation Risks

### Finding I1
- severity: Critical
- workflow name: Public POF signing replay
- concurrency/replay scenario:
  - Two near-simultaneous submissions of the same token, or one retry after the winner already committed.
- exact files/functions involved:
  - `lib/services/pof-esign-public.ts`
  - `supabase/migrations/0053_artifact_drift_replay_hardening.sql`
- what duplicate/conflicting state could happen:
  - The DB replay guard blocks duplicate finalization, but the loser can still delete the winner’s files from storage.
- recommended protection:
  - Treat `was_already_signed` results as strictly read-only and never clean up deterministic canonical signed paths.
- whether it blocks launch: Yes

### Finding I2
- severity: Critical
- workflow name: Public care plan caregiver signing replay
- concurrency/replay scenario:
  - Two submissions of the same caregiver token close together, or one retry after the winner already committed.
- exact files/functions involved:
  - `lib/services/care-plan-esign-public.ts`
  - `supabase/migrations/0053_artifact_drift_replay_hardening.sql`
- what duplicate/conflicting state could happen:
  - The DB replay guard keeps one signed row, but the loser can still delete the winning final artifacts from storage.
- recommended protection:
  - Same fix as POF: do not clean up canonical signed paths on replay-safe results.
- whether it blocks launch: Yes

### Finding I3
- severity: Low
- workflow name: Enrollment packet public token replay
- concurrency/replay scenario:
  - Double-submit or retry while the packet is already completed.
- exact files/functions involved:
  - `lib/services/enrollment-packets-public-runtime.ts`
  - `lib/services/enrollment-packets-public-runtime-context.ts`
  - `supabase/migrations/0180_enrollment_completion_follow_up_state.sql`
- what duplicate/conflicting state could happen:
  - Current evidence here is relatively strong. Replay losers can short-circuit before upload work, and consumed completed tokens still return committed truth.
- recommended protection:
  - Keep the current row-lock + consumed-token pattern and keep regression tests around the expired-vs-consumed ordering.
- whether it blocks launch: No

## 5. Durability Risks

### Finding D1
- severity: Medium
- workflow name: Enrollment packet post-commit failure fallback
- exact files/functions involved:
  - `lib/services/enrollment-packets-public-runtime-follow-up.ts` -> `buildEnrollmentPacketPostCommitFailureResult`
- what success currently means:
  - The caller gets an `action_required` result after a committed packet encounters post-commit follow-up failure.
- what may fail underneath:
  - The fallback builder still tries to persist `completion_follow_up_status = 'action_required'`, logs if that write fails, and still returns follow-up-needed truth.
- why that is unsafe:
  - The UI truth can still say follow-up-required while the root packet row never durably recorded that state.
- recommended correction:
  - Make the fallback builder fail closed too, or persist one separate durable repair record that becomes the canonical fallback source of truth.
- whether it blocks launch: No

### Finding D2
- severity: Medium
- workflow name: Care plan nurse signature finalization failure after reused artifact row
- exact files/functions involved:
  - `lib/services/care-plan-nurse-esign.ts` -> `cleanupCarePlanNurseSignatureArtifactAfterFinalizeFailure`
- what success currently means:
  - The flow can reuse an existing signature artifact member-file row during nurse-sign finalization.
- what may fail underneath:
  - If finalization later fails and the artifact row was reused instead of newly created, the code records a split-brain alert and stops instead of rolling the artifact back.
- why that is unsafe:
  - Storage/member-file artifact truth can survive a failed finalize boundary and require manual reconciliation.
- recommended correction:
  - Use a temporary artifact path until finalize succeeds, or add deterministic rollback rules for reused artifact rows.
- whether it blocks launch: No

### Finding D3
- severity: Medium
- workflow name: Signed workflow notifications versus durable readiness truth
- exact files/functions involved:
  - `lib/services/notification-content.ts`
  - `lib/services/care-plan-esign-public.ts`
  - `lib/services/pof-post-sign-runtime.ts`
- what success currently means:
  - Users can receive “signed” notifications immediately after the signature event is logged.
- what may fail underneath:
  - Care plan post-sign readiness can still fail after `care_plan_signed` is emitted, and POF post-sign may still be queued or degraded even though the generic notification text sounds ready.
- why that is unsafe:
  - Operational staff can act on a workflow as if it is fully ready when the durable readiness model says otherwise.
- recommended correction:
  - Only emit “ready” language from readiness-aware events, or include readiness-specific notification templates for queued/degraded outcomes.
- whether it blocks launch: No

## 6. ACID Hardening Plan

1. Fix the two replay-delete bugs in public POF and public care plan signing first. These are the clearest launch blockers because they can remove committed clinical artifacts.
2. Add regression tests that fail if replay-safe `was_already_signed` branches call cleanup on canonical signed paths.
3. Add a DB assertion for `p_existing_member_id` in the lead conversion function.
4. Fix care plan final signed `document_source` so more than one signed care plan per member is structurally allowed.
5. Fix enrollment packet split-commit by widening the transactional owner or adding one canonical repair-owner record for all post-commit work.
6. Make notification truth readiness-aware for signed POF and signed care plan workflows.
7. After those changes, clean up remaining durability gaps such as care plan nurse-sign split-brain handling and enrollment fallback follow-up persistence.

## 7. Suggested Codex Prompts

- Fix Memory Lane POF replay artifact deletion. In `lib/services/pof-esign-public.ts`, the `finalized.was_already_signed` branch still calls `cleanupFailedPofSignatureArtifacts(...)` on deterministic canonical signed paths. Prevent replay losers from deleting committed artifacts and add a regression test for near-simultaneous token replays.
- Fix Memory Lane care plan replay artifact deletion. In `lib/services/care-plan-esign-public.ts`, the `finalized.wasAlreadySigned` branch still deletes deterministic caregiver signature and final PDF paths. Make replay-safe results read-only and add regression coverage.
- Fix Memory Lane lead conversion member relink safety. Add a DB assertion inside `apply_lead_stage_transition_with_member_upsert` so `p_existing_member_id` must already belong to the same lead or an explicitly allowed unlinked member, otherwise fail closed.
- Fix Memory Lane care plan final signed document-source collisions. Replace the shared `document_source = 'Care Plan Final Signed'` contract with a per-care-plan source and add a migration-safe backfill.
- Fix Memory Lane enrollment packet split-commit. `rpc_finalize_enrollment_packet_submission` still marks the packet completed before finalized artifacts and downstream handoff finish. Move required artifact/linkage work under the canonical transactional owner, or add one explicit durable repair-owner record for all post-commit recovery.
- Fix Memory Lane signed-notification truth. Update `lib/services/notification-content.ts` and the emitting workflows so POF and care plan notifications reflect canonical readiness state instead of always saying “ready.”

## 8. Fix First Tonight

- Remove replay cleanup of canonical signed files in public POF signing.
- Remove replay cleanup of canonical signed files in public care plan signing.
- Add failing regression tests for both replay-delete bugs before patching.
- Add a DB assertion for `p_existing_member_id`.
- Change care plan final signed `document_source` to include the care-plan id.
- Update signed POF and care plan notification text so queued/degraded work is not described as ready.

## 9. Automate Later

- Nightly check for signed POF rows whose signature image or signed PDF is missing from storage.
- Nightly check for signed care plans whose caregiver signature or final PDF is missing from storage.
- Nightly check for completed enrollment packets with no completed packet artifact or missing member-file linkage.
- Nightly check for packets where `completion_follow_up_status` says one thing but no durable repair or follow-up record exists.
- Regression suite for public token replay across enrollment packet, POF, and care plan flows.
- Schema guard test that rejects `p_existing_member_id` values linked to another lead.
- Notification/readiness matrix test so “ready” language cannot drift away from canonical readiness resolvers.

## 10. Founder Summary: What changed since the last run

- Better:
  - Enrollment packet expired-token handling is safer. `lib/services/enrollment-packets-public-runtime.ts` and `lib/services/enrollment-packets-public-runtime-context.ts` now reject expired active tokens before the completed replay branch unless the token was already consumed by a committed completion.
  - Enrollment packet main follow-up truth got safer. `lib/services/enrollment-packets-public-runtime-cascade.ts` now fails closed if the final `completion_follow_up_status` write cannot be persisted.
  - Lead conversion follow-up truth got safer for staff. `lib/services/sales-lead-activities.ts` and `app/sales-lead-actions.ts` now return committed-follow-up-needed truth when conversion activity logging fails after the conversion already committed.
  - Intake assessment write access got stricter. `app/intake-actions.ts` now requires explicit `health` module edit permission in addition to signer-role checks.
- Still unresolved:
  - The two replay-delete launch blockers in public POF and public care plan signing are still present.
  - Enrollment packet completion is still a split commit.
  - The DB still trusts `p_existing_member_id` too much during lead conversion.
  - Care plan final signed files still have a document-source collision risk.
  - Signed notification text still overstates readiness in some queued/degraded paths.
- Newly surfaced tonight:
  - No new critical ACID issue was found beyond the current blocker set. The new changes mainly improved truthfulness and guardrails, not the core atomicity boundaries.
