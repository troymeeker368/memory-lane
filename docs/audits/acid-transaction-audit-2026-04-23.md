# Memory Lane ACID Transaction Audit - 2026-04-23

## 1. Executive Summary

- Overall ACID safety rating: 7.1 / 10
- Overall verdict: Partial
- Top 5 ACID risks:
  - Public enrollment packet completion still commits the packet before finalized artifact persistence and downstream cascade work are durably finished.
  - Care plan create/review still has a false-failure path after commit because the write boundary still hard-requires `ready` even when the workflow intentionally persists `signed_pending_caregiver_dispatch`.
  - Manual member-file uploads can still return success and show "File uploaded." even when Supabase persistence verification explicitly failed.
  - Lead activity creation still writes the `lead_activities` row before lead -> member conversion runs, so a failed conversion can leave an "Enrollment completed" activity behind.
  - Lead activity replay protection is still mostly app-layer matching with no database uniqueness guard on `lead_activities`.
- Strongest workflows:
  - Lead -> member conversion itself is still strong once the shared RPC boundary is entered.
  - Intake -> draft POF creation remains comparatively strong because it uses the draft-creation RPC and returns explicit follow-up-needed states when downstream work fails.
  - Public POF signing remains one of the strongest public flows because it verifies commit state after RPC errors and cleans up artifacts on non-commit paths.
  - MAR scheduled documentation remains strong because the write path runs through duplicate-safe RPC boundaries.
- Short founder summary:
  - The codebase still has good shared-RPC protection around conversion, POF signing, intake draft POF creation, and MAR documentation. The biggest remaining founder-facing risks are still false success or false failure around enrollment packets, care plans, member files, and sales conversion activity logging.

## 2. Atomicity Violations

### Finding A1
- severity: Critical
- workflow name: Public enrollment packet completion
- exact files/functions/modules:
  - `lib/services/enrollment-packets-public-runtime.ts` -> `submitPublicEnrollmentPacketWithDeps`
  - `lib/services/enrollment-packets-public-runtime-finalize.ts` -> `invokeFinalizeEnrollmentPacketCompletionRpc`
  - `lib/services/enrollment-packets-public-runtime-post-commit.ts` -> `completeCommittedPublicEnrollmentPacketPostCommitWork`
  - `lib/services/enrollment-packets-public-runtime-artifacts.ts` -> `cleanupFinalizedPublicEnrollmentPacketArtifacts`
  - `supabase/migrations/0180_enrollment_completion_follow_up_state.sql` -> `rpc_finalize_enrollment_packet_submission`
- what should happen:
  - Packet completion, finalized artifacts, and downstream cascade truth should either finish together or leave one durable repair boundary that owns the whole partial batch.
- what currently happens:
  - `rpc_finalize_enrollment_packet_submission` commits first, then artifact persistence and cascade run afterward.
  - The cleanup helper exists, but the current post-commit failure path does not call it.
- how partial failure could occur:
  - The packet can be durably marked completed while finalized files, member-file links, or downstream mapping only partially land.
- recommended fix:
  - Add a durable post-commit artifact batch owner and wire `cleanupFinalizedPublicEnrollmentPacketArtifacts` into the failure path, or move more of the required finalization under one transactional boundary.
- blocks launch: Yes

### Finding A2
- severity: High
- workflow name: Lead activity -> lead/member conversion
- exact files/functions/modules:
  - `lib/services/sales-lead-activities.ts` -> `createSalesLeadActivity`
  - `lib/services/sales-lead-conversion-supabase.ts` -> `applyLeadStageTransitionWithMemberUpsertSupabase`
  - `supabase/migrations/0037_shared_rpc_standardization_lead_pof.sql` -> `rpc_convert_lead_to_member`
- what should happen:
  - The "Enrollment completed" activity and the lead -> member conversion should succeed or fail as one business event.
- what currently happens:
  - The activity row is inserted first, then conversion runs afterward.
- how partial failure could occur:
  - A failed conversion can still leave a committed activity that says enrollment completed even though the member conversion did not finish.
- recommended fix:
  - Move the activity write behind the conversion RPC success path, or create one shared conversion RPC that also records the winning activity within the same transaction.
- blocks launch: Yes

## 3. Consistency Gaps

### Finding C1
- severity: High
- affected schema/business rule:
  - Lead activity replay safety for conversion-related activities
- exact files/migrations/services involved:
  - `lib/services/sales-activity-idempotency.ts`
  - `lib/services/sales-lead-activities.ts`
  - `supabase/migrations/0001_initial_schema.sql` -> `lead_activities`
- what invariant is not enforced:
  - The database still does not enforce uniqueness for replay-equivalent lead activities.
- why it matters:
  - A double-submit or retry can still create contradictory duplicate canonical activities if app-layer timing checks miss.
- recommended DB/service fix:
  - Add a real DB-backed idempotency key or uniqueness contract for lead activities, especially conversion-completion outcomes.
- blocks launch: Yes

### Finding C2
- severity: High
- affected schema/business rule:
  - Care plan post-sign readiness truth
- exact files/migrations/services involved:
  - `lib/services/care-plans-supabase.ts` -> `finalizeCaregiverDispatchAfterNurseSignature`
  - `lib/services/care-plans-supabase.ts` -> `assertCarePlanWriteBoundaryAligned`
  - `supabase/migrations/0112_care_plan_post_sign_readiness.sql`
- what invariant is not enforced:
  - The service now treats `signed_pending_caregiver_dispatch` as a legitimate persisted state, but the boundary assertion still insists the saved row must already be `ready`.
- why it matters:
  - The same workflow has two conflicting definitions of "correct final state," which creates false failure after commit.
- recommended DB/service fix:
  - Update the shared boundary assertion to accept the legitimate pending readiness state and reserve `ready` only for flows that are actually fully complete.
- blocks launch: Yes

## 4. Isolation Risks

### Finding I1
- severity: High
- workflow name: Lead activity double-submit / replay
- concurrency/replay scenario:
  - Two close submissions record the same conversion-related activity.
- exact files/functions involved:
  - `lib/services/sales-activity-idempotency.ts` -> `findExistingLeadActivityReplayId`
  - `lib/services/sales-lead-activities.ts` -> `createSalesLeadActivity`
  - `supabase/migrations/0001_initial_schema.sql` -> `lead_activities`
- what duplicate/conflicting state could happen:
  - Duplicate lead activities can be recorded because protection is based on query matching and a 15-second window, not a database uniqueness guard.
- recommended protection:
  - Add a persisted idempotency key and uniqueness index for replay-equivalent activity submissions.
- blocks launch: Yes

### Finding I2
- severity: Low
- workflow name: Public token submission flows
- concurrency/replay scenario:
  - Near-simultaneous reuse of the same public token.
- exact files/functions involved:
  - `lib/services/enrollment-packets-public-runtime.ts`
  - `lib/services/enrollment-packets-public-runtime-finalize.ts`
  - `lib/services/pof-esign-public.ts`
- what duplicate/conflicting state could happen:
  - Current evidence still looks comparatively strong here because both flows re-check committed state and verify whether the commit actually landed before deciding whether to replay or fail.
- recommended protection:
  - Keep the current compare-and-set and replay verification coverage; add regression tests when these public flows change.
- blocks launch: No

## 5. Durability Risks

### Finding D1
- severity: Critical
- workflow name: Care plan create/review after nurse signature
- exact files/functions involved:
  - `lib/services/care-plans-supabase.ts` -> `createCarePlan`, `reviewCarePlan`, `assertCarePlanWriteBoundaryAligned`
  - `app/care-plan-actions.ts` -> `createCarePlanAction`, `reviewCarePlanAction`
- what success currently means:
  - The workflow can already persist the care plan, signature, snapshot, and caregiver dispatch state.
- what may fail underneath:
  - The post-write assertion still throws if readiness is `signed_pending_caregiver_dispatch`, and that error is not converted into durable persisted truth.
- why that is unsafe:
  - Staff can see failure even though the record already committed, which invites retries against already-saved clinical data.
- recommended correction:
  - Treat `signed_pending_caregiver_dispatch` as a legitimate committed outcome and make every post-commit boundary error carry the saved `carePlanId`.
- blocks launch: Yes

### Finding D2
- severity: High
- workflow name: Manual member-file upload persistence
- exact files/functions involved:
  - `lib/services/member-files.ts` -> `loadPersistedMemberFileOrReturnVerificationPending`, `saveCommandCenterMemberFileUpload`
  - `app/(portal)/operations/member-command-center/_actions/files.ts` -> `addMemberFileAction`, `addMemberFileFormAction`
  - `components/forms/member-command-center-file-manager.tsx` -> `onUpload`
- what success currently means:
  - The action returns `{ ok: true, row: created }` and the UI shows "File uploaded."
- what may fail underneath:
  - The same returned row can explicitly carry `verifiedPersisted: false`, meaning the canonical Supabase readback did not verify.
- why that is unsafe:
  - Staff can trust a file upload that the system itself could not confirm in canonical storage/record state.
- recommended correction:
  - Downgrade the server action and UI outcome to follow-up-needed whenever `verifiedPersisted` is false.
- blocks launch: Yes

### Finding D3
- severity: Medium
- workflow name: Enrollment packet completion follow-up state
- exact files/functions involved:
  - `lib/services/enrollment-packets-public-runtime-cascade.ts` -> `runEnrollmentPacketCascadeAndBuildResult`
  - `lib/services/enrollment-packets-public-runtime-follow-up.ts` -> `persistEnrollmentPacketCompletionFollowUpState`
- what success currently means:
  - The returned result can say the packet is completed with a specific follow-up state.
- what may fail underneath:
  - The actual persistence of `completion_follow_up_status` can fail and is only logged/alerted.
- why that is unsafe:
  - The user-facing result can temporarily overstate what Supabase actually stored.
- recommended correction:
  - Make follow-up-state persistence part of the returned truth boundary, or explicitly downgrade the returned status when the write fails.
- blocks launch: No

## 6. ACID Hardening Plan

1. Fix the care-plan false-failure boundary first.
2. Stop member-file uploads from reporting success when verification failed.
3. Move lead conversion activity logging behind the conversion commit boundary.
4. Add database-backed idempotency for `lead_activities`.
5. Add durable ownership and cleanup for enrollment packet finalized artifact batches.
6. Tighten returned truth so enrollment packet follow-up state is only reported when it was durably stored.

## 7. Suggested Codex Prompts

- Fix Memory Lane care-plan post-sign durability. `lib/services/care-plans-supabase.ts` intentionally persists `signed_pending_caregiver_dispatch`, but `assertCarePlanWriteBoundaryAligned` still hard-requires `ready`. Update the shared write boundary and action handling so create/review return persisted truth instead of false failure after commit.
- Fix Memory Lane member-file upload false success. `saveCommandCenterMemberFileUpload` can return `verifiedPersisted: false`, but `app/(portal)/operations/member-command-center/_actions/files.ts` still returns `{ ok: true }` and the UI still shows "File uploaded." Downgrade this to follow-up-needed and preserve the verification details for staff.
- Fix Memory Lane lead conversion atomicity. `lib/services/sales-lead-activities.ts` inserts the `lead_activities` row before calling `applyLeadStageTransitionWithMemberUpsertSupabase`. Move the conversion-completion activity behind the shared conversion commit boundary or fold it into a shared RPC.
- Harden Memory Lane lead-activity idempotency. Replace the current query-window replay check with a DB-enforced idempotency key or unique constraint for replay-equivalent lead activities, especially conversion-related outcomes.
- Fix Memory Lane enrollment packet finalized artifact durability. The packet is committed before finalized artifacts and downstream cascade work complete, and the cleanup helper is not wired into the failure path. Add durable batch ownership plus deterministic cleanup or repair.

## 8. Fix First Tonight

- Care-plan readiness assertion mismatch
- Member-file upload false-success path
- Lead activity inserted before conversion commit
- Lead-activity DB uniqueness/idempotency guard

## 9. Automate Later

- Nightly query for `lead_activities` duplicates on replay-equivalent conversion outcomes
- Nightly query for completed enrollment packets missing one or more finalized artifacts in the expected batch
- Regression test for care-plan create/review returning a persisted follow-up-needed state when caregiver dispatch is still pending
- Regression test for member-file uploads that return `verifiedPersisted: false`

## 10. Founder Summary: What changed since the last run

- No meaningful ACID blocker was fixed since the 2026-04-22 run.
- The visible dirty-workspace work is still mostly permission/read-boundary hardening around care plans and member files, not transaction-boundary hardening.
- The same four high-priority problems are still live:
  - enrollment packet split-commit after finalize
  - care-plan false failure after committed `signed_pending_caregiver_dispatch`
  - member-file upload false success when verification fails
  - sales lead activity ordering/idempotency gaps around lead -> member conversion
- I did not find a new critical regression in POF public signing, intake -> draft POF creation, or MAR documentation. Those remain the strongest transaction boundaries in the current codebase.
