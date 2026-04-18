# Memory Lane ACID Transaction Audit - 2026-04-17

## 1. Executive Summary

- Overall ACID safety rating: 8.2 / 10
- Overall verdict: Partial
- Top 5 ACID risks:
  - Enrollment packet artifact persistence can still partially commit after the packet is already durably marked `completed`.
  - The care plan resend/reset guard is drafted in `supabase/migrations/0212_care_plan_caregiver_prepare_terminal_guard.sql`, but it is not production-real until that migration is committed and applied.
  - Care plan caregiver resend still permits duplicate dispatch from `sent`, `viewed`, and `expired` states.
  - `care_plan_signature_events` still lacks a schema-level same-member lineage guarantee.
  - `mar_schedules` and `mar_administrations` still rely on single-column foreign keys instead of full lineage enforcement across member, schedule, and medication.
- Strongest workflows:
  - Lead -> member conversion stays strong through `lib/services/sales-lead-conversion-supabase.ts` and `supabase/migrations/0165_idempotency_write_roots_and_dedupe_contracts.sql`.
  - Intake -> draft POF creation stays strong through `lib/services/physician-orders-supabase.ts` and `supabase/migrations/0181_physician_order_save_rpc_atomicity.sql`.
  - Signed POF -> MHP/MCC/MAR sync stays strong through `lib/services/physician-order-post-sign-runtime.ts` and `supabase/migrations/0155_signed_pof_post_sign_sync_rpc_consolidation.sql`.
  - Scheduled MAR documentation stays strong through `lib/services/mar-workflow.ts` and `supabase/migrations/0121_document_scheduled_mar_administration_rpc.sql`.
  - Public POF and care plan signing links remain replay-safe because the public handlers use consumed-token checks before and after finalization.
- Short founder summary:
  - The dirty workspace made one real safety improvement today: care plans no longer claim they are operationally ready immediately after caregiver dispatch is sent. The main issue I would fix first tonight is still enrollment packet artifact batch atomicity, and the second is shipping the drafted care plan resend/reset migration so the database, not just the code, blocks signed-plan rollback.

## 2. Atomicity Violations

### Finding A1
- severity: High
- workflow name: Public enrollment packet completion -> finalized artifact persistence
- exact files/functions/modules:
  - `lib/services/enrollment-packets-public-runtime-artifacts.ts` -> `persistFinalizedPublicEnrollmentPacketArtifacts`
  - `lib/services/enrollment-packets-public-runtime-post-commit.ts` -> `completeCommittedPublicEnrollmentPacketPostCommitWork`
  - `supabase/migrations/0180_enrollment_completion_follow_up_state.sql` -> `rpc_finalize_enrollment_packet_submission`
- what should happen:
  - The packet completion and its finalized artifact batch should either finish together, or a failed batch should be durably tracked and safely repairable.
- what currently happens:
  - `rpc_finalize_enrollment_packet_submission` commits `status = 'completed'` first.
  - After that, `persistFinalizedPublicEnrollmentPacketArtifacts` writes the signature, uploaded documents, and final completed packet artifact one by one.
- how partial failure could occur:
  - A caregiver can complete the packet and the request can be durably `completed`, while only some of the final artifacts exist in storage/member files.
- recommended fix:
  - Add a durable artifact batch record before writes start, then make the batch cleanup-safe or explicitly repairable if any later write fails.
- blocks launch: Yes

### Finding A2
- severity: Medium
- workflow name: Care plan caregiver email dispatch
- exact files/functions/modules:
  - `lib/services/care-plan-esign.ts` -> `sendCarePlanToCaregiverForSignature`
  - `lib/services/care-plan-esign.ts` -> `transitionCarePlanCaregiverStatus`
- what should happen:
  - If the caregiver email is delivered, the durable `sent` state should be finalized before success is treated as complete.
- what currently happens:
  - The service prepares the request, sends the email, and only then writes the durable `sent` transition.
- how partial failure could occur:
  - The caregiver can receive a live link even if the durable sent-state write fails right after the email is accepted.
- recommended fix:
  - Move this to a durable outbox-style send boundary, or persist a stronger send reconciliation record before returning success.
- blocks launch: No

### Finding A3
- severity: Medium
- workflow name: Enrollment packet completion boundary
- exact files/functions/modules:
  - `supabase/migrations/0180_enrollment_completion_follow_up_state.sql` -> `rpc_finalize_enrollment_packet_submission`
  - `lib/services/enrollment-packets-public-runtime-cascade.ts` -> `runEnrollmentPacketCascadeAndBuildResult`
- what should happen:
  - If completion is intentionally staged, the UI and follow-up systems should clearly separate “completed” from “fully operationally ready.”
- what currently happens:
  - Completion commits first, then mapping, artifact linkage, sender notification, and readiness consensus run after commit.
- how partial failure could occur:
  - The core packet can be correct while downstream readiness still needs staff repair.
- recommended fix:
  - Keep the staged model, but make `completion_follow_up_status` the only truth for “operationally ready” and add durable repair ownership for stuck follow-up states.
- blocks launch: No

## 3. Consistency Gaps

### Finding C1
- severity: High
- affected schema/business rule:
  - Signed or finalized care plans must not be reset for resend.
- exact files/migrations/services involved:
  - `lib/services/care-plans-supabase.ts` -> `finalizeCaregiverDispatchAfterNurseSignature`
  - `supabase/migrations/0212_care_plan_caregiver_prepare_terminal_guard.sql`
  - `tests/care-plan-caregiver-dispatch-readiness.test.ts`
- what invariant is not enforced:
  - The workspace contains the right DB guard, but the migration is still untracked and unapplied, so production does not yet have the database guarantee.
- why it matters:
  - The code now reports readiness more honestly, but the highest-risk resend/reset hole is not fully closed until Supabase actually runs the migration.
- recommended DB/service fix:
  - Commit and apply `0212_care_plan_caregiver_prepare_terminal_guard.sql` and keep the paired regression test.
- blocks launch: Yes

### Finding C2
- severity: Medium
- affected schema/business rule:
  - Care plan signature events should always belong to the same member as the referenced care plan.
- exact files/migrations/services involved:
  - `supabase/migrations/0020_care_plan_canonical_esign.sql`
  - `lib/services/care-plan-esign.ts`
- what invariant is not enforced:
  - `care_plan_signature_events` has separate foreign keys to `care_plans(id)` and `members(id)`, but no composite constraint tying the pair back to the canonical care plan/member relationship.
- why it matters:
  - A bad repair or service bug could write contradictory audit history and the database would still accept it.
- recommended DB/service fix:
  - Add a composite lineage contract so `(care_plan_id, member_id)` must match the canonical care plan/member pair.
- blocks launch: No

### Finding C3
- severity: Medium
- affected schema/business rule:
  - MAR schedules and administrations should be structurally tied to the same member lineage as the source medication and schedule.
- exact files/migrations/services involved:
  - `supabase/migrations/0028_pof_seeded_mar_workflow.sql`
  - `supabase/migrations/0121_document_scheduled_mar_administration_rpc.sql`
  - `lib/services/mar-workflow.ts`
- what invariant is not enforced:
  - `mar_schedules` and `mar_administrations` reference `member_id`, `pof_medication_id`, and `mar_schedule_id` separately, but they do not use composite lineage guards to prove those rows all belong to the same member.
- why it matters:
  - The canonical service path is careful, but the schema still leaves room for cross-member drift if a future bad write slips in.
- recommended DB/service fix:
  - Run a read-only lineage drift audit, repair any existing mismatches, then add forward-only composite constraints.
- blocks launch: No

## 4. Isolation Risks

### Finding I1
- severity: Medium
- workflow name: Care plan caregiver resend / duplicate dispatch
- concurrency/replay scenario:
  - Two nearby staff resend actions, or repeated resend from `sent`, `viewed`, or `expired`, can still mint a fresh request token and send another email.
- exact files/functions involved:
  - `supabase/migrations/0212_care_plan_caregiver_prepare_terminal_guard.sql`
  - `lib/services/care-plan-esign.ts` -> `sendCarePlanToCaregiverForSignature`
- what duplicate/conflicting state could happen:
  - The signed-plan rollback hole is being closed, but duplicate caregiver dispatch is still allowed for non-terminal states without explicit resend sequencing.
- recommended protection:
  - Narrow the allowed resend states, or add explicit resend sequence rules plus stale-token invalidation semantics.
- blocks launch: No

## 5. Durability Risks

### Finding D1
- severity: High
- workflow name: Enrollment packet completion follow-up persistence
- exact files/functions involved:
  - `lib/services/enrollment-packets-public-runtime-follow-up.ts` -> `persistEnrollmentPacketCompletionFollowUpState`
  - `lib/services/enrollment-packets-public-runtime-follow-up.ts` -> `buildEnrollmentPacketPostCommitFailureResult`
- what success currently means:
  - The caller can receive `completed` or `action_required` based on in-memory follow-up evaluation.
- what may fail underneath:
  - The actual `completion_follow_up_status` write back to `enrollment_packet_requests` can fail and the failure is only logged/alerted.
- why that is unsafe:
  - The user can briefly see a follow-up truth that is not durably stored in Supabase.
- recommended correction:
  - Retry until the DB write succeeds, or return an explicitly degraded result that says the follow-up truth itself did not persist.
- blocks launch: No

### Finding D2
- severity: Medium
- workflow name: Care plan caregiver email delivery state
- exact files/functions involved:
  - `lib/services/care-plan-esign.ts` -> `sendCarePlanToCaregiverForSignature`
- what success currently means:
  - The caregiver may receive a valid link even if the durable sent-state write fails immediately afterward.
- what may fail underneath:
  - The durable `sent` transition and some follow-up observability writes.
- why that is unsafe:
  - Staff can be left reconciling a live link against a stale database state.
- recommended correction:
  - Persist a durable outbox/send reconciliation row and make resend decisions depend on that row.
- blocks launch: No

### Finding D3
- severity: Low
- workflow name: Core workflow audit events and milestones
- exact files/functions involved:
  - `lib/services/pof-esign.ts`
  - `lib/services/mar-workflow.ts`
  - `lib/services/mar-prn-workflow.ts`
  - `lib/services/intake-pof-mhp-cascade.ts`
- what success currently means:
  - Core rows commit, but some audit and milestone writes remain best-effort.
- what may fail underneath:
  - Durable operational breadcrumbs and some staff-facing observability history.
- why that is unsafe:
  - Data integrity survives, but repair and auditability are weaker than intended.
- recommended correction:
  - Add a small durable repair queue for post-commit audit writes that fail.
- blocks launch: No

## 6. ACID Hardening Plan

1. Fix enrollment packet artifact batch atomicity first.
   This is still the clearest confirmed partial-commit risk in the requested scope.
2. Finish the care plan resend/reset fix in the database.
   Commit and apply `0212_care_plan_caregiver_prepare_terminal_guard.sql`.
3. Harden follow-up durability truth.
   Stop reporting `completion_follow_up_status` changes unless the DB row actually persisted.
4. Close schema lineage gaps.
   Start with `care_plan_signature_events`, then MAR tables after a read-only drift audit.
5. Add durable post-commit repair records.
   Use them for enrollment artifacts, follow-up write failures, and best-effort audit event failures.

## 7. Suggested Codex Prompts

### Prompt 1
Fix enrollment packet artifact batch atomicity in Memory Lane. `persistFinalizedPublicEnrollmentPacketArtifacts` still writes finalized artifacts one by one after `rpc_finalize_enrollment_packet_submission` already committed. Add a durable batch record plus cleanup-safe or repair-safe failure handling so partial artifact batches cannot silently drift. Preserve Supabase as the source of truth and add regression coverage for mid-batch failure.

### Prompt 2
Finish the care plan caregiver resend hardening in Memory Lane. Commit and apply `supabase/migrations/0212_care_plan_caregiver_prepare_terminal_guard.sql`, verify signed or finalized care plans cannot be reset for resend, and keep the paired readiness regression test green.

### Prompt 3
Harden enrollment packet follow-up durability in Memory Lane. `completion_follow_up_status` should never be reported as changed unless the DB row actually persisted. Replace the current best-effort update path with retryable durable persistence or an explicitly degraded result.

### Prompt 4
Add schema-level lineage enforcement for `care_plan_signature_events`, `mar_schedules`, and `mar_administrations` in Memory Lane. Start with a read-only drift audit, then add forward-only migrations that structurally tie child rows to the canonical member lineage of their parent records.

## 8. Fix First Tonight

- Commit and apply `supabase/migrations/0212_care_plan_caregiver_prepare_terminal_guard.sql`.
- Keep the current `lib/services/care-plans-supabase.ts` readiness change that leaves post-sign readiness at `signed_pending_caregiver_dispatch`.
- Add durable batch ownership or cleanup for `persistFinalizedPublicEnrollmentPacketArtifacts`.
- Stop swallowing failed `completion_follow_up_status` persistence as if it were already durable truth.

## 9. Automate Later

- Nightly read-only check for completed enrollment packets whose finalized artifact batch is incomplete.
- Nightly read-only check for packets stuck in `completion_follow_up_status in ('pending', 'action_required')` beyond the agreed SLA.
- Nightly read-only check for care plans whose caregiver request fields changed after `caregiver_signature_status = 'signed'`.
- Nightly lineage drift audit for `care_plan_signature_events`.
- Nightly lineage drift audit for `mar_schedules` and `mar_administrations`.

## 10. Founder Summary: What changed since the last run

- Real improvement since the April 16, 2026 run:
  - `lib/services/care-plans-supabase.ts` no longer returns `ready` immediately after caregiver dispatch is auto-sent. It now returns `postSignReadinessStatus: "signed_pending_caregiver_dispatch"`, which is materially more honest for operations.
- Real improvement, but not yet shipped:
  - The workspace now contains `supabase/migrations/0212_care_plan_caregiver_prepare_terminal_guard.sql`, which blocks resetting already signed or finalized care plans for resend.
  - Important: this migration is still untracked in the current dirty tree, so I am not counting it as production-fixed yet.
- Real improvement:
  - Enrollment packet readiness truth is now more honest across shared readiness logic, list filtering, and public helpers because `completion_follow_up_status = completed` is now required before treating a packet as operationally ready.
- New top concern tonight:
  - Enrollment packet artifact persistence is still sequential and post-commit. The repo is telling the truth better than yesterday, but the artifact batch itself can still partially commit.
- No new confirmed ACID regression tonight in:
  - lead -> member conversion
  - intake -> draft POF creation
  - signed POF -> MHP/MCC/MAR cascade
  - scheduled MAR documentation
  - member-file persistence
