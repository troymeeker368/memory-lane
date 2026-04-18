# Memory Lane ACID Transaction Audit - 2026-04-18

## 1. Executive Summary

- Overall ACID safety rating: 7.5 / 10
- Overall verdict: Partial
- Top 5 ACID risks:
  - Enrollment packet completion still marks the packet `completed` before finalized artifact persistence is durably finished, so files can partially commit.
  - The dirty workspace introduced a care-plan false-failure path: create/review flows now keep post-sign readiness pending, but the write boundary still requires `ready`, so the request can fail after the care plan already committed.
  - Enrollment packet lead-activity sync now depends on `lead_activities.enrollment_packet_request_id`, but that schema change lives only in untracked migration `0215`, so the runtime and schema can drift immediately if code ships first.
  - The care-plan resend/reset terminal guard exists in workspace migration `0212`, but it is still not production-real until it is committed and applied.
  - Enrollment packet `completion_follow_up_status` persistence is still best-effort, so returned workflow truth can diverge from what Supabase actually stored.
- Strongest workflows:
  - Lead -> member conversion remains strong through `lib/services/sales-lead-conversion-supabase.ts` and the shared RPC conversion boundary.
  - Intake -> draft POF creation remains strong through `lib/services/intake-pof-mhp-cascade.ts`, intake RPC creation, and draft-POF follow-up queueing.
  - Signed POF -> MHP/MCC/MAR sync remains strong through `lib/services/pof-post-sign-runtime.ts` and the shared post-sign queue/RPC flow.
  - Public enrollment packet and public POF links remain replay-safe because both flows check consumed-token state before and after the commit boundary.
  - Scheduled and PRN MAR documentation remain comparatively strong because the write paths use duplicate-safe RPC/idempotency boundaries.
- Short founder summary:
  - The codebase still has strong shared-RPC protection around lead conversion, intake, POF signing, and MAR documentation. The biggest issue that still blocks clean operational truth is enrollment-packet post-commit artifact persistence, and tonight’s new workspace-only blocker is the care-plan flow now failing after commit because its readiness check was not updated alongside the new honest pending state.

## 2. Atomicity Violations

### Finding A1
- severity: High
- workflow name: Public enrollment packet completion -> finalized artifact persistence
- exact files/functions/modules:
  - `lib/services/enrollment-packets-public-runtime-artifacts.ts` -> `persistFinalizedPublicEnrollmentPacketArtifacts`
  - `lib/services/enrollment-packets-public-runtime-post-commit.ts` -> `completeCommittedPublicEnrollmentPacketPostCommitWork`
  - `supabase/migrations/0180_enrollment_completion_follow_up_state.sql` -> `rpc_finalize_enrollment_packet_submission`
- what should happen:
  - The packet completion, finalized uploads, completed packet PDF, and their member-file linkages should either finish together or leave a durable repair record that clearly owns the partial batch.
- what currently happens:
  - `rpc_finalize_enrollment_packet_submission` commits the packet as completed first.
  - After commit, `persistFinalizedPublicEnrollmentPacketArtifacts` writes the signature artifact, uploaded documents, and completed packet artifact one by one.
  - The cleanup helper exists, but the current post-commit path does not call it.
- how partial failure could occur:
  - A caregiver submission can durably complete the packet while only some artifacts exist in storage/member files.
- recommended fix:
  - Add a durable artifact-batch root row before artifact writes start, persist per-artifact completion state, and either make cleanup deterministic or make the batch explicitly repairable/retryable.
- blocks launch: Yes

### Finding A2
- severity: Medium
- workflow name: Care plan caregiver email dispatch
- exact files/functions/modules:
  - `lib/services/care-plan-esign.ts` -> `sendCarePlanToCaregiverForSignature`
  - `lib/services/care-plan-esign.ts` -> `transitionCarePlanCaregiverStatus`
- what should happen:
  - Email delivery and durable sent-state truth should complete together, or the system should use a durable outbox/send record as the source of truth.
- what currently happens:
  - The service prepares the request, sends the email, and only afterward finalizes the durable `sent` transition.
- how partial failure could occur:
  - The caregiver can receive a live link while the database still says `ready_to_send` because the sent-state write failed after email delivery.
- recommended fix:
  - Move the send path to a durable outbox/send reconciliation row and make resend logic depend on that row instead of the email side effect alone.
- blocks launch: No

## 3. Consistency Gaps

### Finding C1
- severity: Critical
- affected schema/business rule:
  - Enrollment packet lead-activity linkage must be backed by a real schema column before runtime code can depend on it.
- exact files/migrations/services involved:
  - `lib/services/enrollment-packet-completion-cascade.ts`
  - `lib/services/enrollment-packet-mapping-runtime.ts`
  - `supabase/migrations/0215_lead_activity_enrollment_packet_link.sql`
  - `tests/enrollment-packet-lead-activity-linkage.test.ts`
- what invariant is not enforced:
  - The dirty workspace now reads and writes `lead_activities.enrollment_packet_request_id`, but the new column and FK only exist in an untracked migration.
- why it matters:
  - If this code ships before `0215` is committed and applied, enrollment packet completion checks and lead-activity inserts can fail against production schema.
- recommended DB/service fix:
  - Ship `0215` before or with the runtime code, and treat the migration plus runtime change as one atomic deploy unit.
- blocks launch: Yes

### Finding C2
- severity: High
- affected schema/business rule:
  - Signed or finalized care plans must not be reset for resend.
- exact files/migrations/services involved:
  - `lib/services/care-plan-esign.ts` -> `prepareCarePlanCaregiverRequest`
  - `supabase/migrations/0212_care_plan_caregiver_prepare_terminal_guard.sql`
  - `tests/care-plan-caregiver-dispatch-readiness.test.ts`
- what invariant is not enforced:
  - The correct DB guard exists in the workspace, but it is still not committed/applied, so production still lacks the schema-level terminal-state protection.
- why it matters:
  - Code-level caution is not enough for a public-signature workflow that must survive retries and operator mistakes.
- recommended DB/service fix:
  - Commit and apply `0212_care_plan_caregiver_prepare_terminal_guard.sql` and keep the paired regression coverage.
- blocks launch: Yes

### Finding C3
- severity: Medium
- affected schema/business rule:
  - Care plan signature events should always belong to the same member as the referenced care plan.
- exact files/migrations/services involved:
  - `lib/services/care-plan-esign.ts`
  - `supabase/migrations/0020_care_plan_canonical_esign.sql`
- what invariant is not enforced:
  - `care_plan_signature_events` still uses separate foreign keys without a composite lineage guarantee tying `(care_plan_id, member_id)` back to the canonical care plan/member pair.
- why it matters:
  - A bad repair or service bug could create contradictory audit history that the database would still accept.
- recommended DB/service fix:
  - Add a composite lineage contract after a read-only drift check.
- blocks launch: No

### Finding C4
- severity: Medium
- affected schema/business rule:
  - MAR schedules and administrations should be structurally tied to the same member lineage as the source medication/schedule rows.
- exact files/migrations/services involved:
  - `lib/services/mar-workflow.ts`
  - `supabase/migrations/0028_pof_seeded_mar_workflow.sql`
  - `supabase/migrations/0121_document_scheduled_mar_administration_rpc.sql`
- what invariant is not enforced:
  - The schema still allows separate single-column references without a full same-member lineage guard.
- why it matters:
  - The canonical service path is careful, but the database still leaves room for cross-member drift if a future write path goes bad.
- recommended DB/service fix:
  - Run a read-only lineage audit, repair any drift, then add composite lineage constraints.
- blocks launch: No

## 4. Isolation Risks

### Finding I1
- severity: Medium
- workflow name: Care plan caregiver resend / duplicate dispatch
- concurrency/replay scenario:
  - Two nearby resend actions, or a resend from `sent`, `viewed`, or `expired`, can still prepare a fresh caregiver request and send another email.
- exact files/functions involved:
  - `lib/services/care-plan-esign.ts` -> `sendCarePlanToCaregiverForSignature`
  - `supabase/migrations/0212_care_plan_caregiver_prepare_terminal_guard.sql`
- what duplicate/conflicting state could happen:
  - A caregiver can receive multiple live links while staff interpret only the latest DB state.
- recommended protection:
  - Add explicit resend sequencing or stale-token invalidation rules for non-terminal resend paths.
- blocks launch: No

### Finding I2
- severity: Low
- workflow name: Public token submission and signing flows
- concurrency/replay scenario:
  - Near-simultaneous retries hit the same public link.
- exact files/functions involved:
  - `lib/services/enrollment-packets-public-runtime.ts`
  - `lib/services/enrollment-packets-public-runtime-finalize.ts`
  - `lib/services/pof-esign-public.ts`
  - `lib/services/care-plan-esign-public.ts`
- what duplicate/conflicting state could happen:
  - Current evidence shows these flows are comparatively well protected: they re-check consumed-token state and use compare-and-set style expected statuses.
- recommended protection:
  - Keep these guards and add regression tests whenever a public-token workflow changes.
- blocks launch: No

## 5. Durability Risks

### Finding D1
- severity: Critical
- workflow name: Care plan create/review after nurse/admin signature
- exact files/functions involved:
  - `lib/services/care-plans-supabase.ts` -> `finalizeCaregiverDispatchAfterNurseSignature`
  - `lib/services/care-plans-supabase.ts` -> `assertCarePlanWriteBoundaryAligned`
  - `lib/services/care-plans-supabase.ts` -> `createCarePlan`
  - `lib/services/care-plans-supabase.ts` -> `reviewCarePlan`
  - `app/care-plan-actions.ts` -> `createCarePlanAction`
- what success currently means:
  - The workflow now intentionally keeps `post_sign_readiness_status = 'signed_pending_caregiver_dispatch'` after the nurse signature when caregiver dispatch still needs to finish.
- what may fail underneath:
  - The later boundary check still throws unless the care plan reloads as `ready`.
  - `createCarePlanAction` only treats a partial commit as recoverable when the thrown error carries `carePlanId`, but this boundary error does not.
- why that is unsafe:
  - The care plan, signature, version snapshot, and caregiver send can already be committed while the UI still receives a failure. Staff may retry a workflow that already saved, which is exactly the kind of false-failure that creates operational confusion.
- recommended correction:
  - Update the boundary check to accept the new legitimate pending readiness state when caregiver follow-up is still outstanding, and ensure partial-commit errors always carry `carePlanId` so actions can return persisted truth instead of a plain failure.
- blocks launch: Yes

### Finding D2
- severity: Medium
- workflow name: Enrollment packet completion follow-up persistence
- exact files/functions involved:
  - `lib/services/enrollment-packets-public-runtime-follow-up.ts` -> `persistEnrollmentPacketCompletionFollowUpState`
  - `lib/services/enrollment-packets-public-runtime-cascade.ts` -> `runEnrollmentPacketCascadeAndBuildResult`
- what success currently means:
  - The caller can receive a follow-up status/result assembled in memory before the durable follow-up row update succeeds.
- what may fail underneath:
  - The actual `completion_follow_up_status` write can fail and the code only logs/alerts.
- why that is unsafe:
  - The user can briefly see a readiness truth that Supabase never durably stored.
- recommended correction:
  - Make the follow-up-state write part of the success boundary or explicitly downgrade the returned result when persistence fails.
- blocks launch: No

### Finding D3
- severity: Medium
- workflow name: Care plan caregiver email delivery state
- exact files/functions involved:
  - `lib/services/care-plan-esign.ts` -> `sendCarePlanToCaregiverForSignature`
- what success currently means:
  - The caregiver may receive a working link even if the durable `sent` state fails to finalize immediately afterward.
- what may fail underneath:
  - The sent-state transition and some follow-up observability writes.
- why that is unsafe:
  - Staff can be left reconciling a live link against stale internal workflow state.
- recommended correction:
  - Persist a durable send reconciliation/outbox row and use that row as the resend and support boundary.
- blocks launch: No

### Finding D4
- severity: Low
- workflow name: Core audit events and milestone breadcrumbs
- exact files/functions involved:
  - `lib/services/intake-pof-mhp-cascade.ts`
  - `lib/services/pof-post-sign-runtime.ts`
  - `lib/services/mar-workflow.ts`
  - `lib/services/member-files.ts`
- what success currently means:
  - Core writes usually commit, but some follow-up observability writes remain best-effort.
- what may fail underneath:
  - Some repair breadcrumbs and staff-facing alerts.
- why that is unsafe:
  - Clinical/operational truth usually survives, but auditability and repair speed degrade.
- recommended correction:
  - Add a small durable repair queue for failed post-commit observability writes.
- blocks launch: No

## 6. ACID Hardening Plan

1. Fix the new care-plan false-failure regression first.
   It is the clearest “committed but returned failure” bug in today’s dirty workspace.
2. Ship schema and runtime together for enrollment packet lead-activity linkage.
   Do not merge the new `enrollment_packet_request_id` runtime dependency without `0215`.
3. Fix enrollment packet finalized-artifact batch atomicity.
   This remains the clearest confirmed partial-commit risk in the requested scope.
4. Commit and apply the care-plan terminal resend guard.
   `0212` should move from “good idea in workspace” to real database enforcement.
5. Make returned readiness truth durable.
   Stop reporting enrollment packet follow-up state changes unless the row update persisted.
6. Close remaining lineage gaps.
   Start with `care_plan_signature_events`, then MAR lineage after a read-only drift audit.

## 7. Suggested Codex Prompts

### Prompt 1
Fix the new care-plan post-sign durability regression in Memory Lane. `finalizeCaregiverDispatchAfterNurseSignature` now correctly leaves readiness at `signed_pending_caregiver_dispatch`, but `assertCarePlanWriteBoundaryAligned` still requires `ready`, which can make create/review flows fail after the care plan already committed. Update the boundary check and partial-commit error handling so the action returns persisted truth instead of a false failure.

### Prompt 2
Finish the enrollment packet lead-activity linkage change safely in Memory Lane. The runtime now reads and writes `lead_activities.enrollment_packet_request_id`, so commit/apply `supabase/migrations/0215_lead_activity_enrollment_packet_link.sql`, verify the backfill, and confirm the runtime never ships ahead of the schema.

### Prompt 3
Fix enrollment packet finalized artifact batch atomicity in Memory Lane. `persistFinalizedPublicEnrollmentPacketArtifacts` still runs after the packet is already durably marked completed and writes finalized artifacts one by one. Add a durable artifact-batch record plus repair-safe state tracking so partial artifact persistence cannot silently drift.

### Prompt 4
Harden enrollment packet follow-up durability in Memory Lane. `completion_follow_up_status` should never be reported as changed unless the DB row actually persisted. Replace the current best-effort update with durable persistence or an explicitly degraded returned state.

### Prompt 5
Finish the care-plan caregiver resend hardening in Memory Lane. Commit and apply `supabase/migrations/0212_care_plan_caregiver_prepare_terminal_guard.sql`, then tighten resend sequencing so duplicate caregiver dispatch is controlled for `sent`, `viewed`, and `expired` states.

## 8. Fix First Tonight

- Fix the care-plan readiness assertion mismatch so create/review no longer fail after a committed save.
- Commit and apply `0215_lead_activity_enrollment_packet_link.sql` before shipping the new lead-activity runtime changes.
- Commit and apply `0212_care_plan_caregiver_prepare_terminal_guard.sql`.
- Add a durable artifact-batch ownership record around finalized enrollment packet artifact persistence.
- Stop returning upgraded enrollment packet follow-up truth when the write-back itself failed.

## 9. Automate Later

- CI check that any newly selected/inserted column in runtime code is backed by a committed forward-only migration.
- Regression test that care-plan create/review with caregiver contact returns success while persisted readiness is `signed_pending_caregiver_dispatch`.
- Nightly read-only check for completed enrollment packets missing any finalized artifact in the expected batch.
- Nightly read-only check for completed enrollment packets where `mapping_sync_status = 'completed'` but `completion_follow_up_status <> 'completed'`.
- Nightly read-only check for care plans whose caregiver request fields changed after `caregiver_signature_status = 'signed'`.
- Nightly lineage drift audit for `care_plan_signature_events`, `mar_schedules`, and `mar_administrations`.

## 10. Founder Summary: What changed since the last run

- Real improvement:
  - Enrollment packet operational readiness is now more honest across shared helpers, listings, and detail pages because code now requires `completion_follow_up_status = completed` before calling a completed packet fully operationally ready.
- Real improvement in progress, but not production-real yet:
  - Enrollment packet lead-activity linkage is moving from fragile notes-text matching to an explicit `enrollment_packet_request_id` relationship.
- New blocker in the dirty workspace:
  - The care-plan workflow now correctly leaves readiness pending after nurse signature, but the later boundary assertion still expects `ready`. That means create/review can fail after the care plan already committed.
- New deployment-order blocker in the dirty workspace:
  - The runtime now depends on `lead_activities.enrollment_packet_request_id`, but the required migration `0215` is still untracked. Do not ship the code before the schema.
- Still not fixed:
  - Enrollment packet finalized artifact persistence is still sequential and post-commit.
- Still not production-real:
  - The care-plan resend/reset guard in `0212` is still only a workspace draft until it is committed and applied.
- No new confirmed regression today in:
  - lead -> member conversion
  - intake -> draft POF creation
  - signed POF -> MHP/MCC/MAR sync
  - public token replay protection
  - MAR scheduled/PRN documentation
