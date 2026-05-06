# Memory Lane ACID Transaction Audit - 2026-04-24

## 1. Executive Summary

- Overall ACID safety rating: 7.6 / 10
- Overall verdict: Partial
- Important scope note:
  - This audit reflects the current local workspace on April 24, 2026. Some improvements are present in dirty, uncommitted files and should not be treated as deployed production fixes yet.
- Top 5 ACID risks:
  - Public enrollment packet completion still finalizes the packet before finalized artifacts and downstream cascade work finish.
  - Lead -> member conversion is still split from lead activity logging, so conversion can commit and the user can still get an error afterward.
  - Enrollment packet completion follow-up truth is still allowed to fail persistence after the workflow already built a return result.
  - Enrollment packet lead-activity sync still relies on app-layer replay checks instead of a database-enforced uniqueness contract.
  - Lead activity idempotency is improved for the sales activity path, but that protection depends on migration `0222_lead_activity_idempotency_hardening.sql` being applied and does not yet cover every lead-activity insert path.
- Strongest workflows:
  - Public POF signing remains one of the strongest public token workflows because it verifies commit state after RPC ambiguity and preserves committed truth when post-sign follow-up degrades.
  - Intake -> draft POF creation remains comparatively strong because it downgrades to explicit follow-up-needed states when downstream PDF/member-file persistence is not verified.
  - Care plan create/review is stronger than yesterday because the shared write-boundary now correctly accepts `signed_pending_caregiver_dispatch`.
  - MAR monthly documentation is stronger than yesterday because unverified member-file persistence is surfaced as follow-up-needed instead of silent success.
- Short founder summary:
  - Two important founder-facing false-truth bugs from yesterday are fixed in the current workspace: care-plan false failure and command-center member-file false success. The biggest unresolved ACID problem is still enrollment packet split-commit after finalization. Lead conversion is safer than yesterday, but it still is not one end-to-end atomic business event.

## 2. Atomicity Violations

### Finding A1
- severity: Critical
- workflow name: Public enrollment packet completion
- exact files/functions/modules:
  - `lib/services/enrollment-packets-public-runtime.ts` -> `submitPublicEnrollmentPacketWithDeps`
  - `lib/services/enrollment-packets-public-runtime-post-commit.ts` -> `completeCommittedPublicEnrollmentPacketPostCommitWork`
  - `lib/services/enrollment-packets-public-runtime-artifacts.ts` -> `cleanupFinalizedPublicEnrollmentPacketArtifacts`
  - `supabase/migrations/0180_enrollment_completion_follow_up_state.sql` -> `rpc_finalize_enrollment_packet_submission`
- what should happen:
  - Packet completion, finalized artifacts, member-file linkage, and downstream cascade truth should either succeed together or leave one durable repair boundary that owns cleanup.
- what currently happens:
  - `submitPublicEnrollmentPacketWithDeps` calls `invokeFinalizeEnrollmentPacketCompletionRpc` first, then hands off to post-commit artifact persistence and cascade work.
  - On post-commit failure, the flow returns follow-up-needed truth, but the cleanup helper for finalized artifacts is still defined and unused.
- how partial failure could occur:
  - The packet can be durably marked completed while finalized files, upload linkage, or downstream mapping only partially land.
- recommended fix:
  - Either move required finalized artifact writes under the same transactional/RPC boundary, or wire `cleanupFinalizedPublicEnrollmentPacketArtifacts` into the failure path and persist one canonical repair batch owner.
- whether it blocks launch: Yes

### Finding A2
- severity: High
- workflow name: Lead -> member conversion with sales activity logging
- exact files/functions/modules:
  - `lib/services/sales-lead-activities.ts` -> `createSalesLeadActivity`
  - `lib/services/sales-lead-conversion-supabase.ts` -> `applyLeadStageTransitionWithMemberUpsertSupabase`
  - `supabase/migrations/0156_lead_conversion_wrapper_shell_assertions.sql` -> `rpc_convert_lead_to_member`
- what should happen:
  - Conversion and its canonical conversion-complete activity should succeed or fail as one business event, or the caller should get durable committed identifiers even when the activity step degrades.
- what currently happens:
  - The old ordering bug is fixed: conversion now runs before the `lead_activities` insert.
  - But the activity insert is still outside the RPC boundary, and the service now throws `Lead/member conversion committed, but lead activity persistence failed (...)` if the second step fails.
- how partial failure could occur:
  - A member conversion can commit and the user can still see an error, leaving a missing activity/audit trail and inviting retry confusion.
- recommended fix:
  - Move the conversion activity write into the shared conversion RPC, or return explicit committed conversion identifiers plus follow-up-needed state instead of a generic error once the conversion has already committed.
- whether it blocks launch: No

## 3. Consistency Gaps

### Finding C1
- severity: Medium
- affected schema/business rule:
  - Lead activity idempotency is only partially enforced across write paths.
- exact files/migrations/services involved:
  - `lib/services/sales-lead-activities.ts`
  - `lib/services/enrollment-packet-mapping-runtime.ts` -> `addLeadActivityStrict`
  - `supabase/migrations/0222_lead_activity_idempotency_hardening.sql`
- what invariant is not enforced:
  - The sales activity path now writes `idempotency_key`, but the enrollment-packet lead activity sync path still inserts without that key and without a packet-specific unique constraint.
- why it matters:
  - The repo now has two different durability stories for duplicate lead activities. One path has DB-backed idempotency if migration `0222` is applied; another still depends on race-prone query checks.
- recommended DB/service fix:
  - Extend DB-backed idempotency to all canonical lead-activity insert paths, especially `addLeadActivityStrict`, using either `idempotency_key` or a unique constraint tied to `enrollment_packet_request_id`.
- whether it blocks launch: No

### Finding C2
- severity: Medium
- affected schema/business rule:
  - Runtime/schema alignment for sales lead activity writes now depends on migration `0222`.
- exact files/migrations/services involved:
  - `lib/services/sales-lead-activities.ts`
  - `supabase/migrations/0222_lead_activity_idempotency_hardening.sql`
- what invariant is not enforced:
  - The runtime now assumes `lead_activities.idempotency_key` exists and throws an explicit migration-required error if it does not.
- why it matters:
  - This is better than silent drift, but it means the local code improvement is not real in production until the migration is deployed with it.
- recommended DB/service fix:
  - Treat `0222` as part of the same deployment unit as the service change and verify the target Supabase project has the column/index before rollout.
- whether it blocks launch: No

## 4. Isolation Risks

### Finding I1
- severity: High
- workflow name: Enrollment packet completion -> lead activity sync
- concurrency/replay scenario:
  - A retry, queue replay, or near-simultaneous duplicate follow-up can attempt the same lead activity insert twice.
- exact files/functions involved:
  - `lib/services/enrollment-packet-mapping-runtime.ts` -> `addLeadActivityStrict`, `syncEnrollmentPacketLeadActivityOrQueue`
  - `supabase/migrations/0215_lead_activity_enrollment_packet_link.sql`
- what duplicate/conflicting state could happen:
  - Duplicate lead activities for the same enrollment packet can still slip through because the current path checks first and inserts second without a DB uniqueness guard for that business event.
- recommended protection:
  - Add a unique constraint or canonical `idempotency_key` for enrollment-packet lead activity writes and convert the insert to upsert/replay-safe semantics.
- whether it blocks launch: No

### Finding I2
- severity: Low
- workflow name: Public token signing flows
- concurrency/replay scenario:
  - Near-simultaneous reuse of public POF or care-plan tokens.
- exact files/functions involved:
  - `lib/services/pof-esign-public.ts`
  - `lib/services/care-plan-esign-public.ts`
  - `supabase/migrations/0053_artifact_drift_replay_hardening.sql`
- what duplicate/conflicting state could happen:
  - Current evidence still looks comparatively strong here because both flows keep consumed-token checks and post-finalize verification paths.
- recommended protection:
  - Keep the existing replay verification coverage and add regression tests whenever these public token flows change.
- whether it blocks launch: No

## 5. Durability Risks

### Finding D1
- severity: Critical
- workflow name: Enrollment packet completion follow-up truth
- exact files/functions involved:
  - `lib/services/enrollment-packets-public-runtime-cascade.ts` -> `runEnrollmentPacketCascadeAndBuildResult`
  - `lib/services/enrollment-packets-public-runtime-follow-up.ts` -> `persistEnrollmentPacketCompletionFollowUpState`
- what success currently means:
  - The workflow can build and return a completion result with `completionFollowUpStatus`.
- what may fail underneath:
  - Persisting that follow-up state can still fail and is only logged/alerted.
- why that is unsafe:
  - The returned founder/staff truth can temporarily say one thing while Supabase still stores older follow-up state.
- recommended correction:
  - Make follow-up-state persistence part of the returned truth boundary, or explicitly downgrade the returned result if the state write fails.
- whether it blocks launch: No

### Finding D2
- severity: High
- workflow name: Lead conversion activity logging after committed conversion
- exact files/functions involved:
  - `lib/services/sales-lead-activities.ts` -> `createSalesLeadActivity`
  - `app/sales-lead-actions.ts` -> `createSalesLeadActivityAction`
- what success currently means:
  - The conversion RPC can already commit the lead/member transition.
- what may fail underneath:
  - The follow-on `lead_activities` insert can fail, and the action still returns a plain error to the caller.
- why that is unsafe:
  - Staff can be told the workflow failed even though the canonical conversion already happened, which invites confused retries and leaves audit/logging incomplete.
- recommended correction:
  - Return committed conversion identifiers plus follow-up-needed state once conversion has committed, and queue or repair the missing activity separately.
- whether it blocks launch: No

## 6. ACID Hardening Plan

1. Fix enrollment packet split-commit first.
2. Make enrollment packet follow-up-state persistence part of returned truth.
3. Make lead conversion activity logging replay-safe and commit-aware after conversion RPC success.
4. Apply migration `0222` with the sales lead activity hardening before rollout.
5. Extend DB-backed lead activity idempotency to the enrollment-packet lead activity sync path.
6. Keep adding explicit follow-up-needed responses anywhere member-file verification can remain pending.

## 7. Suggested Codex Prompts

- Fix Memory Lane enrollment packet finalization atomicity. `submitPublicEnrollmentPacketWithDeps` finalizes the packet before `completeCommittedPublicEnrollmentPacketPostCommitWork` persists finalized artifacts and downstream cascade work, and `cleanupFinalizedPublicEnrollmentPacketArtifacts` is still unused. Add one canonical repair boundary or move more of the required finalized artifact work under the transactional/RPC boundary.
- Fix Memory Lane enrollment packet follow-up durability. `runEnrollmentPacketCascadeAndBuildResult` can return a completion-follow-up state even if `persistEnrollmentPacketCompletionFollowUpState` fails. Make the returned result match persisted truth or downgrade to follow-up-needed when the state write fails.
- Fix Memory Lane lead conversion post-commit false failure. `createSalesLeadActivity` now converts first and inserts into `lead_activities` second. Preserve the safer ordering, but stop returning a plain failure once conversion already committed. Return committed conversion truth and queue/repair the missing activity instead.
- Finish Memory Lane lead activity idempotency hardening. Apply `0222_lead_activity_idempotency_hardening.sql` and extend the same DB-backed idempotency contract to `addLeadActivityStrict` in `enrollment-packet-mapping-runtime.ts`.

## 8. Fix First Tonight

- Wire `cleanupFinalizedPublicEnrollmentPacketArtifacts` into a real post-commit repair path.
- Stop returning plain errors after committed lead conversion.
- Apply migration `0222` anywhere the current workspace hardening is expected to work.
- Add DB-backed replay protection to enrollment-packet lead activity sync.

## 9. Automate Later

- Nightly query for completed enrollment packets missing one or more finalized artifacts in the expected batch.
- Nightly query for enrollment packets whose returned follow-up state disagrees with persisted `completion_follow_up_status`.
- Regression test for lead conversion where the member conversion commits but the follow-on lead activity insert fails.
- Regression test for duplicate enrollment-packet lead activity sync under retry/replay conditions.

## 10. Founder Summary: What changed since the last run

- The care-plan false-failure bug from 2026-04-23 is fixed in the current workspace. The shared write-boundary now accepts the valid pending state `signed_pending_caregiver_dispatch`.
- The command-center member-file false-success bug from 2026-04-23 is fixed in the current workspace. Unverified persistence now returns an error/follow-up-needed result instead of success.
- Lead conversion hardening improved in the current workspace. The old “activity inserted before conversion” problem is gone, and a real `idempotency_key` migration was added, but the conversion plus activity log still is not one atomic business event.
- Enrollment packet split-commit is still the biggest unresolved ACID problem and did not materially improve since the last run.
- Public POF signing remains stable and comparatively strong. I did not find a new ACID regression there.
