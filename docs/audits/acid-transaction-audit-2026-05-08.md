# Memory Lane ACID Transaction Audit - 2026-05-08

## 1. Executive Summary

- Overall ACID safety rating: 6.9 / 10
- Overall verdict: Partial
- Top 5 ACID risks:
  - Public POF replay can delete the winning signed files from storage after the database already says the request is signed.
  - Public care plan replay can do the same thing to the winning caregiver-signed files.
  - Enrollment packet completion still finalizes the packet before finalized artifacts, member-file linkage, and downstream mapping finish.
  - Lead conversion can still relink the wrong existing member if a privileged caller supplies an invalid `p_existing_member_id`.
  - Care plan caregiver finalization still uses one shared `document_source` for all final signed care plans, which can block a second signed care plan for the same member.
- Strongest workflows:
  - Signed POF downstream MHP/MCC/MAR sync is much stronger than earlier audits because it now uses one RPC-backed post-sign boundary with retry-safe queue handling.
  - MAR documentation is one of the safest areas in scope because scheduled and PRN flows use RPC boundaries, advisory locking, and duplicate guards.
  - Intake -> draft POF creation is materially safer because it keeps committed-but-unverified outcomes in follow-up-needed state instead of pretending they are ready.
  - Core lead -> member conversion is much stronger than older direct-write patterns because the main stage transition, member upsert, and required shell creation are inside one database function.
- Short founder summary:
  - The codebase improved in several important places since the older April ACID audit, especially around follow-up truth, idempotency, and downstream clinical sync. The biggest remaining launch blockers are now two replay-driven file deletion bugs in public signing, plus the still-unresolved enrollment packet split-commit.

## 2. Atomicity Violations

### Finding A1
- severity: Critical
- workflow name: Public POF signature completion replay
- exact files/functions/modules:
  - `lib/services/pof-esign-public.ts` -> `submitPublicPofSignature`
  - `supabase/migrations/0053_artifact_drift_replay_hardening.sql` -> `rpc_finalize_pof_signature`
- what should happen:
  - If a token replay loses the race, it should return the already-committed signed result without touching the winning signature artifact or signed PDF.
- what currently happens:
  - The public flow uploads deterministic storage paths first, calls the finalize RPC, and then deletes those same paths when `was_already_signed` is returned.
- how partial failure could occur:
  - One request can win and commit the signed state, while a replaying request deletes the committed signature image and signed PDF from storage afterward.
- recommended fix:
  - Do not delete canonical signed artifacts on replay-safe `was_already_signed` results. Either upload to unique temporary paths before finalize, or skip cleanup entirely unless verification proves this request created orphaned paths that are not the canonical committed paths.
- whether it blocks launch: Yes

### Finding A2
- severity: Critical
- workflow name: Public care plan caregiver signing replay
- exact files/functions/modules:
  - `lib/services/care-plan-esign-public.ts` -> `submitPublicCarePlanSignature`
  - `supabase/migrations/0053_artifact_drift_replay_hardening.sql` -> `rpc_finalize_care_plan_caregiver_signature`
- what should happen:
  - A replay should reuse the committed signed care plan result without deleting the winning caregiver signature or final signed PDF.
- what currently happens:
  - The flow uploads deterministic caregiver signature and final PDF paths before finalize, then deletes those same paths when `wasAlreadySigned` is returned.
- how partial failure could occur:
  - The signed care plan can stay committed in Supabase while the replaying request deletes the committed artifact files from storage.
- recommended fix:
  - Mirror the POF fix: use unique temporary upload paths or treat `wasAlreadySigned` as a no-cleanup replay path unless the flow can prove the files are orphaned and not the canonical committed artifacts.
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
  - Packet completion, finalized packet artifacts, member-file linkage, and downstream member mapping should complete as one durable truth boundary, or there should be one explicit repair boundary that owns the whole post-commit recovery.
- what currently happens:
  - The finalize RPC marks the packet `completed` first. Artifact persistence, member-file linkage, lead activity sync, sender notification, and downstream mapping all run afterward in post-commit code.
- how partial failure could occur:
  - The packet can be durably completed while the completed packet artifact, linked files, or downstream mapping are still missing or only partially finished.
- recommended fix:
  - Move more of the required artifact/linkage work into the transactional boundary, or create one explicit repair-owner record and wire real artifact cleanup into the failure path before returning success.
- whether it blocks launch: Yes

### Finding A4
- severity: Medium
- workflow name: Lead conversion + conversion activity logging
- exact files/functions/modules:
  - `lib/services/sales-lead-activities.ts` -> `createSalesLeadActivity`
  - `lib/services/sales-lead-conversion-supabase.ts` -> `applyLeadStageTransitionWithMemberUpsertSupabase`
  - `app/sales-lead-actions.ts` -> `createSalesLeadActivityAction`
- what should happen:
  - Conversion and its canonical conversion activity should succeed together, or the caller should get committed conversion truth plus an explicit follow-up outcome.
- what currently happens:
  - The conversion RPC commits first. The follow-on `lead_activities` insert happens afterward and can still fail.
- how partial failure could occur:
  - The lead is already converted to a member, but the conversion activity write can still degrade after commit.
- recommended fix:
  - Move the conversion activity into the conversion RPC, or keep the current committed-truth UI behavior but add one explicit repair path for missing conversion activities.
- whether it blocks launch: No

## 3. Consistency Gaps

### Finding C1
- severity: High
- affected schema/business rule:
  - Lead conversion must not relink an unrelated existing member.
- exact files/migrations/services involved:
  - `supabase/migrations/0158_lead_conversion_shell_success_guard.sql` -> `apply_lead_stage_transition_with_member_upsert`
- what invariant is not enforced:
  - The `p_existing_member_id` branch updates whichever member id is supplied and sets `source_lead_id = p_lead_id` without asserting that the supplied member is already linked to that lead or is safely unlinked.
- why it matters:
  - The app path usually resolves canonical identity first, but the database boundary itself still trusts the caller too much. A privileged bad call could relink the wrong person.
- recommended DB/service fix:
  - Add a database assertion that `p_existing_member_id` must already belong to this lead, or be null, or be an explicitly allowed unlinked row. Fail closed otherwise.
- whether it blocks launch: Yes

### Finding C2
- severity: High
- affected schema/business rule:
  - Final signed care plan files should support more than one signed care plan per member when the platform allows multiple care-plan tracks.
- exact files/migrations/services involved:
  - `supabase/migrations/0053_artifact_drift_replay_hardening.sql` -> `rpc_finalize_care_plan_caregiver_signature`
  - `supabase/migrations/0091_member_files_document_source_unique.sql`
- what invariant is not enforced:
  - The finalization RPC hardcodes `document_source = 'Care Plan Final Signed'`, but the schema enforces unique `(member_id, document_source)`.
- why it matters:
  - A member with more than one signed care plan can hit a durable collision and fail the second finalization.
- recommended DB/service fix:
  - Make care plan final signed `document_source` unique per care plan id or track, not one shared label across the whole member.
- whether it blocks launch: Yes

### Finding C3
- severity: Medium
- affected schema/business rule:
  - Positive POF notifications should not claim readiness before downstream sync is actually done.
- exact files/migrations/services involved:
  - `lib/services/notification-content.ts`
  - `lib/services/physician-order-post-sign-service.ts`
  - `lib/services/physician-order-clinical-sync.ts`
- what invariant is not enforced:
  - Notification wording still says clinical documents are ready for review even when the post-sign flow explicitly keeps the order in queued/degraded follow-up state.
- why it matters:
  - The stored workflow truth and the user-facing notification truth can disagree.
- recommended DB/service fix:
  - Generate POF-signed notification content from the same readiness resolver used by the post-sign workflow, and only claim readiness when post-sign sync is actually complete.
- whether it blocks launch: No

## 4. Isolation Risks

### Finding I1
- severity: Critical
- workflow name: Public POF signing replay
- concurrency/replay scenario:
  - Two near-simultaneous submissions of the same signing token, or one retry after the winner already committed.
- exact files/functions involved:
  - `lib/services/pof-esign-public.ts`
  - `supabase/migrations/0053_artifact_drift_replay_hardening.sql`
- what duplicate/conflicting state could happen:
  - The row-level replay guard prevents duplicate finalization, but the losing request can still delete the winning storage artifacts.
- recommended protection:
  - Treat replay-safe finalize results as read-only; never cleanup deterministic canonical paths on `was_already_signed`.
- whether it blocks launch: Yes

### Finding I2
- severity: Critical
- workflow name: Public care plan caregiver signing replay
- concurrency/replay scenario:
  - Two submissions of the same care plan token close together, or one retry after the winning request commits first.
- exact files/functions involved:
  - `lib/services/care-plan-esign-public.ts`
  - `supabase/migrations/0053_artifact_drift_replay_hardening.sql`
- what duplicate/conflicting state could happen:
  - The losing replay request can remove the winning signed files from storage even though the DB replay guard keeps the row in signed state.
- recommended protection:
  - Same protection as POF: no canonical-path cleanup on replay-safe signed results, or move uploads to temporary paths first.
- whether it blocks launch: Yes

### Finding I3
- severity: Low
- workflow name: Enrollment packet public token replay
- concurrency/replay scenario:
  - Double-submit or consumed-token retry during packet completion.
- exact files/functions involved:
  - `lib/services/enrollment-packets-public-runtime-context.ts`
  - `lib/services/enrollment-packets-public-runtime.ts`
  - `supabase/migrations/0180_enrollment_completion_follow_up_state.sql`
- what duplicate/conflicting state could happen:
  - Current evidence is comparatively strong here. The finalize RPC row-locks the request and uses the consumed submission token hash to return replay-safe committed truth.
- recommended protection:
  - Keep the current row-lock + consumed-token pattern and add regression coverage whenever the public token flow changes.
- whether it blocks launch: No

## 5. Durability Risks

### Finding D1
- severity: High
- workflow name: Enrollment packet completion follow-up truth
- exact files/functions involved:
  - `lib/services/enrollment-packets-public-runtime-cascade.ts`
  - `lib/services/enrollment-packets-public-runtime-follow-up.ts`
- what success currently means:
  - The main path now correctly fails closed if follow-up state persistence fails.
- what may fail underneath:
  - The fallback post-commit failure builder still tries to persist `action_required` state, logs failure if that write fails, and still returns a follow-up-needed result to the caller.
- why that is unsafe:
  - The founder-facing result can still say one thing while `completion_follow_up_status` on the root packet row never actually changed.
- recommended correction:
  - Make fallback result building fail closed too, or persist one durable repair record that becomes the canonical source of truth when the root row cannot be updated.
- whether it blocks launch: No

### Finding D2
- severity: Medium
- workflow name: Lead conversion observability and audit trail
- exact files/functions involved:
  - `lib/services/sales-lead-conversion-supabase.ts`
  - `app/sales-lead-actions.ts`
- what success currently means:
  - Core conversion data persists through the shared RPC.
- what may fail underneath:
  - System-event logging and follow-on audit logging still happen after the conversion RPC and are allowed to degrade.
- why that is unsafe:
  - Canonical data durability is good, but the audit trail around the business event is still not fully guaranteed by the same success boundary.
- recommended correction:
  - Move the highest-value event write inside the conversion RPC or add one durable repair queue for missing conversion telemetry.
- whether it blocks launch: No

### Finding D3
- severity: Medium
- workflow name: Care plan nurse signature finalization
- exact files/functions involved:
  - `lib/services/clinical-esign-artifacts.ts`
  - `lib/services/care-plan-nurse-esign.ts`
- what success currently means:
  - The nurse-signature artifact can already be uploaded and upserted before finalization finishes.
- what may fail underneath:
  - If finalization fails after the artifact reused an existing member-file row, the flow records a split-brain alert instead of rolling the artifact back.
- why that is unsafe:
  - Storage and member-file artifacts can survive a failed finalize boundary.
- recommended correction:
  - Use a temporary artifact path until finalize succeeds, or add deterministic rollback for reused artifact rows instead of leaving them as split-brain alerts.
- whether it blocks launch: No

## 6. ACID Hardening Plan

1. Fix the two replay-delete bugs in public POF and public care plan signing first. They are the clearest launch blockers because they can remove committed clinical files.
2. Fix enrollment packet split-commit next. Either widen the transactional boundary or add one real repair owner plus artifact cleanup path.
3. Add a DB assertion to block wrong-member relinking in lead conversion.
4. Fix care plan final signed `document_source` so multiple signed care plans for one member do not collide.
5. Make enrollment packet fallback follow-up truth fail closed the same way the primary path now does.
6. Align positive notifications with readiness truth, especially signed POF messaging.
7. After the above, tighten remaining audit durability gaps such as conversion telemetry and nurse-signature split-brain cleanup.

## 7. Suggested Codex Prompts

- Fix Memory Lane POF replay artifact deletion. In `lib/services/pof-esign-public.ts`, the `was_already_signed` replay branch still calls cleanup on deterministic canonical paths (`provider-signature.png` and `signed.pdf`). Change the flow so replay-safe finalize results never delete the winning committed artifacts, and add regression tests for near-simultaneous token replays.
- Fix Memory Lane care plan replay artifact deletion. In `lib/services/care-plan-esign-public.ts`, the `wasAlreadySigned` branch still deletes deterministic caregiver-signature and final PDF paths. Prevent replay cleanup from deleting committed canonical files and add regression coverage.
- Fix Memory Lane enrollment packet split-commit. `rpc_finalize_enrollment_packet_submission` marks the packet completed before `completeCommittedPublicEnrollmentPacketPostCommitWork` persists finalized artifacts and downstream mapping. Either move the required artifact/linkage work under the transactional boundary or add one canonical repair owner with real artifact cleanup and durable post-commit state.
- Fix Memory Lane lead conversion member relink safety. Add a DB assertion inside `apply_lead_stage_transition_with_member_upsert` so `p_existing_member_id` must already belong to the same lead or an explicitly allowed unlinked member, otherwise fail closed.
- Fix Memory Lane care plan final signed document source collisions. Replace the shared `document_source = 'Care Plan Final Signed'` contract with a per-care-plan source so members can have multiple signed care plans without violating the unique `(member_id, document_source)` index.

## 8. Fix First Tonight

- Remove replay cleanup of deterministic canonical files in public POF signing.
- Remove replay cleanup of deterministic canonical files in public care plan signing.
- Add a failing regression test for both replay-delete bugs before patching.
- Add a DB assertion for `p_existing_member_id` inside the lead conversion function.
- Make the enrollment packet fallback follow-up builder fail closed if the root follow-up state cannot be persisted.

## 9. Automate Later

- Nightly check for signed POF rows whose signed PDF or signature image is missing from storage.
- Nightly check for signed care plans whose final PDF or caregiver signature image is missing from storage.
- Nightly check for completed enrollment packets with no completed packet artifact or missing member-file linkage.
- Nightly check for `completion_follow_up_status` drift versus queued enrollment follow-up tasks and alerts.
- Regression suite for public token double-submit races across enrollment packet, POF, and care plan flows.
- Schema guard test that rejects reused `p_existing_member_id` values linked to a different lead.

## 10. Founder Summary: What changed since the last run

- Better:
  - Enrollment packet follow-up truth is safer than the older April audit baseline. The main path now fails closed if it cannot persist `completion_follow_up_status`.
  - Lead activity replay protection improved. The new `idempotency_key` migration and updated sales/enrollment packet activity writes reduce duplicate activity risk.
  - Enrollment packet public token handling improved. Expired active tokens are now rejected before the completed replay path is considered.
  - Signed POF downstream clinical sync is stronger. The queue and RPC-backed post-sign boundary now make queued/degraded truth much more explicit.
  - Member-file persistence truth is safer. Several flows now return follow-up-needed instead of pretending file persistence was verified.
- Still unresolved:
  - Enrollment packet split-commit is still the main non-clinical ACID architecture problem.
  - Positive POF notification text can still overstate readiness when downstream sync is only queued.
- Newly surfaced tonight:
  - Public POF replay can delete committed signed artifacts from storage.
  - Public care plan replay can delete committed signed artifacts from storage.
  - Care plan final signed files still have a document-source collision risk for members with multiple care plans.
