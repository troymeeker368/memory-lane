# Memory Lane ACID Transaction Audit

## 1. Executive Summary

- Overall ACID safety rating: 8/10
- Overall verdict: Partial
- Top 5 ACID risks:
  - Care plan public caregiver links still use blind status updates. A stale public page load can overwrite a newer committed care-plan signature state back to `viewed` or `expired`.
  - Care plan create/review flows still sign first and persist version history / caregiver dispatch afterward. The code is explicit about failure, but it is still a staged workflow rather than one atomic unit.
  - Member-file delete is now safer than before, but storage cleanup still happens after the row delete, so failed cleanup can leave orphaned storage objects.
  - Scheduled MAR documentation still uses a read-then-insert service path and relies on the database uniqueness rule to stop duplicate dose rows under concurrency.
  - The new intake follow-up queue is durable, but it still uses read-then-insert/update service code rather than one canonical upsert, so concurrent retries can still produce noisy queue-write conflicts.
- Strongest workflows:
  - Lead -> member conversion through `rpc_convert_lead_to_member`
  - Enrollment packet completion and downstream mapping after `0106_enrollment_atomicity_and_intake_follow_up_queue.sql`
  - Public enrollment packet submit response now surfacing `mappingSyncStatus` and readiness messaging
  - Signed intake follow-up now backed by `intake_post_sign_follow_up_queue`
  - POF public signing plus claimed retry queue and post-sign sync outcome reporting
  - PRN MAR administration idempotency and scheduled MAR uniqueness
- Short founder summary:
  - The biggest March 21 blockers are materially improved. Enrollment packet downstream mapping is now much safer, intake follow-up is now durably queued, and lead conversion no longer treats optional audit logging as workflow failure. The main remaining launch-blocking ACID issue is now the care plan public caregiver link state machine.

## 2. Atomicity Violations

### Finding A1

- severity: Medium
- workflow name: Care plan create/review -> nurse sign -> version snapshot -> caregiver dispatch
- exact files/functions/modules:
  - `lib/services/care-plans-supabase.ts`
  - `createCarePlan`
  - `reviewCarePlan`
- what should happen:
  - Once a care plan is treated as finalized for operations, required version history and required next-step dispatch should either already be durable or be represented as a clearly staged, durable follow-up workflow.
- what currently happens:
  - The care plan core record and nurse signature are saved first.
  - Version snapshot persistence and caregiver dispatch happen afterward in later steps.
  - If those later steps fail, the code throws an explicit repair message and records action-required follow-up.
- how partial failure could occur:
  - The care plan can already be created and nurse-signed while version history or caregiver dispatch is still incomplete.
  - This is explicit, not silent, but it is still a partial-commit workflow.
- recommended fix:
  - Keep the current explicit staged design, but formalize it as a durable state machine such as `signed_pending_snapshot` and `signed_pending_caregiver_dispatch`, or move snapshot creation into the same RPC/write boundary as nurse signature finalization if that can be done safely.
- whether it blocks launch: No

## 3. Consistency Gaps

### Finding C1

- severity: High
- affected schema/business rule: `caregiver_signature_status` should never move backward from a newer committed public-signature state because of a stale public page load
- exact files/migrations/services involved:
  - `lib/services/care-plan-esign-public.ts`
  - `markExpiredIfNeeded`
  - `getPublicCarePlanSigningContext`
  - `lib/services/care-plan-esign.ts`
  - `transitionCarePlanCaregiverStatus`
  - `supabase/migrations/0073_delivery_and_member_file_rpc_hardening.sql`
- what invariant is not enforced:
  - The care plan caregiver status transition RPC updates `caregiver_signature_status` blindly by `care_plan_id` and does not verify the current state before applying `viewed` or `expired`.
- why it matters:
  - A care plan can have committed signed artifacts and signature timestamps, but a stale public open/expiry path can still rewrite the status to an older state.
  - That creates contradictory legal / operational truth.
- recommended DB/service fix:
  - Add compare-and-set protection to `rpc_transition_care_plan_caregiver_status`, similar to the POF open hardening.
  - Require the caller to pass allowed current statuses for `viewed` and `expired` transitions, and refuse backward state moves once the care plan is already signed or otherwise advanced.
- whether it blocks launch: Yes

## 4. Isolation Risks

### Finding I1

- severity: High
- workflow name: Care plan public caregiver link open / expiry
- concurrency/replay scenario:
  - One browser tab or stale request loads the care plan in `sent`, while another request signs it or another path marks it expired. The stale request then writes `viewed` or `expired` afterward.
- exact files/functions involved:
  - `lib/services/care-plan-esign-public.ts`
  - `markExpiredIfNeeded`
  - `getPublicCarePlanSigningContext`
  - `lib/services/care-plan-esign.ts`
  - `transitionCarePlanCaregiverStatus`
  - `supabase/migrations/0073_delivery_and_member_file_rpc_hardening.sql`
- what duplicate/conflicting state could happen:
  - The care plan can move backward from a newer committed state to `viewed` or `expired`, even though the caregiver signature may already be final and the signed member-file artifact already exists.
- recommended protection:
  - Use compare-and-set / expected-current-status guards in the care plan caregiver transition RPC.
  - Treat `signed` as terminal for public-link state updates.
- whether it blocks launch: Yes

### Finding I2

- severity: Low
- workflow name: Scheduled MAR dose documentation
- concurrency/replay scenario:
  - Two users try to document the same scheduled dose at nearly the same time.
- exact files/functions involved:
  - `lib/services/mar-workflow.ts`
  - `documentScheduledMarAdministration`
  - `supabase/migrations/0028_pof_seeded_mar_workflow.sql`
- what duplicate/conflicting state could happen:
  - The service does a pre-read for an existing `mar_administrations` row and then inserts.
  - The database unique index on `mar_schedule_id` still protects canonical integrity, so this is not a corruption risk, but one caller can still lose the race with a late DB conflict instead of a cleaner replay-safe response.
- recommended protection:
  - Keep the DB uniqueness rule, but optionally move scheduled-dose documentation behind one RPC or normalize unique-violation handling into the same "already documented" response path.
- whether it blocks launch: No

## 5. Durability Risks

### Finding D1

- severity: Medium
- workflow name: Care plan finalize / sign follow-up
- exact files/functions involved:
  - `lib/services/care-plans-supabase.ts`
  - `createCarePlan`
  - `reviewCarePlan`
- what success currently means:
  - Core care-plan persistence and nurse signature can already be durable.
- what may fail underneath:
  - Version snapshot persistence or caregiver dispatch can still fail afterward.
- why that is unsafe:
  - The workflow is explicit about the repair path, but downstream operational completeness is still not durable at the same moment the signature is.
- recommended correction:
  - Preserve the current action-required repair model, but represent these as durable staged states and surface them clearly in care-plan readiness views.
- whether it blocks launch: No

### Finding D2

- severity: Low
- workflow name: Member-file delete and cleanup
- exact files/functions involved:
  - `lib/services/member-files.ts`
  - `deleteMemberFileRecordAndStorage`
- what success currently means:
  - The row is deleted first, then storage cleanup is attempted.
- what may fail underneath:
  - Storage deletion can still fail after the database row is already gone.
- why that is unsafe:
  - This no longer leaves a dangling database row, which is safer than before, but it can leave orphaned files in storage and require manual cleanup.
- recommended correction:
  - Keep the safer row-first ordering, then add a durable orphan-storage cleanup queue or nightly reconciliation job for failed deletes.
- whether it blocks launch: No

## 6. ACID Hardening Plan

1. Harden care plan caregiver public-link transitions with compare-and-set guards so stale `viewed` or `expired` writes cannot overwrite a newer state.
2. Formalize care plan post-sign follow-up as explicit staged readiness states, especially snapshot persistence and caregiver dispatch.
3. Normalize scheduled MAR duplicate-race handling so concurrent dose documentation returns a clean "already documented" result instead of relying on a raw unique-violation race.
4. Add a durable orphan-storage cleanup process for member-file delete failures.
5. Convert intake follow-up queue writes to one canonical upsert path so concurrent retries cannot produce noisy queue insert conflicts.

## 7. Suggested Codex Prompts

1. `Harden care plan caregiver public-link state transitions. Add compare-and-set protection to rpc_transition_care_plan_caregiver_status so stale public open or expiry requests cannot overwrite a newer committed signed state. Treat signed as terminal and keep Supabase as the canonical source of truth.`
2. `Make care plan finalize/review follow-up states explicit. Keep the current repair-friendly behavior, but add durable staged readiness states for signed_pending_snapshot and signed_pending_caregiver_dispatch so staff can tell the difference between legally signed and fully operationally complete.`
3. `Normalize scheduled MAR duplicate-dose handling. Preserve the existing unique constraint on mar_schedule_id, but make concurrent duplicate submissions return the same canonical already-documented result instead of a raw late insert conflict.`
4. `Add durable orphan-storage cleanup for member-file deletes. Keep deleting the database row first, but queue failed storage deletes for reconciliation so orphaned files do not accumulate silently.`

## 8. Fix First Tonight

- Add compare-and-set guards to care plan caregiver `viewed` and `expired` transitions.
- Treat `signed` care plans as terminal in the care plan caregiver transition RPC.
- Add clear staged readiness labels for care plans that are signed but still missing version snapshot or caregiver dispatch follow-up.

## 9. Automate Later

- Nightly audit for care plans where `caregiver_signature_status` is not `signed` but signed caregiver artifacts or signed timestamps already exist.
- Nightly audit for orphaned storage objects left behind by member-file delete failures.
- Replay-safety audit for scheduled MAR documentation to count unique-violation races and confirm they never create duplicate rows.
- Queue-health audit for `intake_post_sign_follow_up_queue` to detect repeated task insert/update conflicts or tasks stuck in `action_required`.

## 10. Founder Summary: What changed since the last run

- The biggest March 21 enrollment packet blocker is materially improved:
  - `lib/services/enrollment-packet-intake-mapping.ts` now passes `p_contacts: preparedContacts` into the conversion RPC.
  - `supabase/migrations/0106_enrollment_atomicity_and_intake_follow_up_queue.sql` now moves member contact writes and payor assignment into `convert_enrollment_packet_to_member`.
  - That means the old “mapping completed before contacts/payor finished” issue is no longer the top risk.
- The public enrollment packet response is now much more honest:
  - `app/sign/enrollment-packet/[token]/actions.ts` now returns `mappingSyncStatus`, `operationalReadinessStatus`, and `actionNeededMessage`.
  - Staff no longer have to treat a plain `ok: true` as if downstream MCC/MHP/POF handoff definitely succeeded.
- Signed intake follow-up is materially safer than the March 21 run:
  - `0106` adds `intake_post_sign_follow_up_queue`.
  - `app/intake-actions.ts` now queues failed draft-POF and member-file-PDF follow-up work instead of relying only on manual memory.
  - `app/(portal)/health/assessment/[assessmentId]/actions.ts` now resolves those queued tasks when the retry succeeds.
- Lead conversion false-failure risk is lower in the current code:
  - `lib/services/workflow-observability.ts` now writes workflow events through optional `logSystemEvent(..., { required: false })`.
  - `app/sales-lead-actions.ts` now logs and alerts on audit-log failure after conversion instead of failing the conversion result itself.
- The new top confirmed ACID issue is now the care plan caregiver public-link state machine:
  - `lib/services/care-plan-esign-public.ts` still marks `viewed` and `expired` through `transitionCarePlanCaregiverStatus`.
  - `rpc_transition_care_plan_caregiver_status` in `0073_delivery_and_member_file_rpc_hardening.sql` still updates status blindly with no expected-current-state guard.
  - That is now the main launch-blocking race left from this audit pass.
- Audit context:
  - This was a static code-and-migration audit against a dirty worktree.
  - Lightweight targeted Node tests were attempted, but the current sandbox blocked them with `spawn EPERM`, so this report is based on code evidence rather than executed tests.
