# Memory Lane ACID Transaction Audit - 2026-04-15

## 1. Executive Summary

- Overall ACID safety rating: 8.0 / 10
- Overall verdict: Partial
- Top 5 ACID risks:
  - Care plan nurse-sign -> caregiver-send flow can still report `ready` too early and can still reset a signed plan back to `ready_to_send`.
  - Enrollment packet completion is still a staged workflow: the packet can be durably completed before downstream mapping, artifact linkage, and notification consensus are fully done.
  - `care_plan_signature_events` still does not enforce that its `care_plan_id` and `member_id` belong to the same canonical member.
  - `mar_schedules` and `mar_administrations` still do not structurally enforce full lineage back to the same member across schedule, medication, and administration rows.
  - Some follow-up alerts and observability writes are still best-effort after commit, which is safer than false failure but still not fully durable operations telemetry.
- Strongest workflows:
  - Lead -> member conversion is still one of the safest paths. The shared RPC wrapper still enforces canonical shell creation and idempotency checks in `lib/services/sales-lead-conversion-supabase.ts` and `supabase/migrations/0165_idempotency_write_roots_and_dedupe_contracts.sql`.
  - Intake -> draft POF creation remains strong. `rpc_create_draft_physician_order_from_intake` still locks the intake/member rows, takes an advisory lock per member, and converts duplicate attempts into replay-safe reuse.
  - POF signed -> MHP/MCC/MAR cascade remains strong. `rpc_run_signed_pof_post_sign_sync` still uses `for update` plus a member-scoped advisory lock before syncing MHP/MCC and MAR reconciliation.
  - Scheduled MAR documentation remains strong. `rpc_document_scheduled_mar_administration` still uses an advisory lock plus `on conflict (mar_schedule_id) do nothing` to make double-submit safe.
  - Member-file persistence remains honest. The service still treats storage-write + missing DB-readback as a degraded committed state with alerts, not fake success.
- Short founder summary:
  - The repo is still materially safer than earlier March audits. The main launch-blocking ACID issue is still the care plan caregiver state machine, not lead conversion, not intake, and not signed POF sync.

## 2. Atomicity Violations

### Finding A1
- severity: Critical
- workflow name: Care plan nurse signature -> caregiver dispatch -> final readiness
- exact files/functions/modules:
  - `lib/services/care-plans-supabase.ts` -> `finalizeCaregiverDispatchAfterNurseSignature`
  - `lib/services/care-plan-esign.ts` -> `sendCarePlanToCaregiverForSignature`
  - `supabase/migrations/0073_delivery_and_member_file_rpc_hardening.sql` -> `rpc_prepare_care_plan_caregiver_request`
- what should happen:
  - After the nurse signs, the care plan should remain in a clear pending caregiver state until the caregiver actually signs and the final signed member-file record exists.
- what currently happens:
  - The service first sets `signed_pending_caregiver_dispatch`, but after sending the caregiver email it immediately calls `markCarePlanPostSignReady` and returns `postSignReadinessStatus: "ready"`.
  - The caregiver-request RPC also resets `caregiver_signature_status` to `ready_to_send` and clears `final_member_file_id`.
- how partial failure could occur:
  - A plan can look fully ready before caregiver signature and final-file completion.
  - A resend or retry can clear the durable final-file reference from a previously signed care plan.
- recommended fix:
  - Keep post-sign readiness at `signed_pending_caregiver_dispatch` until the caregiver finalization RPC succeeds.
  - Add a terminal-state guard inside `rpc_prepare_care_plan_caregiver_request` so signed/finalized plans cannot be reset.
  - Make resend use explicit compare-and-set rules on current status instead of unconditional reset behavior.
- blocks launch: Yes

### Finding A2
- severity: High
- workflow name: Public enrollment packet completion
- exact files/functions/modules:
  - `lib/services/enrollment-packets-public-runtime.ts` -> `submitPublicEnrollmentPacketWithDeps`
  - `lib/services/enrollment-packets-public-runtime-cascade.ts` -> `runEnrollmentPacketCascadeAndBuildResult`
  - `lib/services/enrollment-packets-public-runtime-follow-up.ts` -> `resolveEnrollmentPacketCompletionFollowUp`
  - `supabase/migrations/0180_enrollment_completion_follow_up_state.sql` -> `rpc_finalize_enrollment_packet_submission`
- what should happen:
  - If packet completion is intentionally staged, the system must say "completed but not operationally ready" until downstream work agrees.
- what currently happens:
  - The RPC durably marks the request `completed` and `completion_follow_up_status = 'pending'`, then mapping, artifact linkage, notification delivery, and shell-readiness checks happen after commit.
- how partial failure could occur:
  - The packet can be truthfully completed while MHP/MCC/POF downstream setup still needs repair.
- recommended fix:
  - Keep the staged model, but treat the follow-up queue as first-class operations work: durable retry ownership, repair tooling, and explicit staff dashboards.
  - Do not collapse this back into a fake "all good" status.
- blocks launch: No

## 3. Consistency Gaps

### Finding C1
- severity: High
- affected schema/business rule:
  - Signed care plans should not be reset back into an unsigned caregiver-send state.
- exact files/migrations/services involved:
  - `supabase/migrations/0073_delivery_and_member_file_rpc_hardening.sql` lines around `943-964`
  - `lib/services/care-plan-esign.ts`
  - `lib/services/care-plans-supabase.ts`
- what invariant is not enforced:
  - The database does not prevent `rpc_prepare_care_plan_caregiver_request` from clearing caregiver signature fields and `final_member_file_id` on an already-signed plan.
- why it matters:
  - A signed clinical document can be structurally reopened by retry logic instead of staying immutable.
- recommended DB/service fix:
  - In the RPC, refuse updates when `caregiver_signature_status = 'signed'` or when `final_member_file_id` is already populated.
  - Add a regression test that proves a signed plan cannot be re-queued for caregiver send.
- blocks launch: Yes

### Finding C2
- severity: Medium
- affected schema/business rule:
  - Care plan signature events should always belong to the same member as the care plan they reference.
- exact files/migrations/services involved:
  - `supabase/migrations/0020_care_plan_canonical_esign.sql`
  - `lib/services/care-plan-esign.ts`
- what invariant is not enforced:
  - `care_plan_signature_events` has separate foreign keys to `care_plans(id)` and `members(id)`, but no composite guard tying them together.
- why it matters:
  - If a service bug or manual repair ever writes the wrong `member_id`, the database will still accept contradictory audit history.
- recommended DB/service fix:
  - Add a composite uniqueness/foreign-key contract so `(care_plan_id, member_id)` must match the canonical care plan/member pair.
- blocks launch: No

### Finding C3
- severity: Medium
- affected schema/business rule:
  - MAR schedules and MAR administrations should be structurally tied to the same member lineage as the source medication and schedule.
- exact files/migrations/services involved:
  - `supabase/migrations/0028_pof_seeded_mar_workflow.sql`
  - `lib/services/mar-workflow.ts`
- what invariant is not enforced:
  - `mar_schedules` and `mar_administrations` still rely on single-column foreign keys instead of composite lineage checks across `member_id`, `pof_medication_id`, and `mar_schedule_id`.
- why it matters:
  - The canonical RPC/service path is careful, but the schema still leaves room for cross-member drift if a bad write slips in.
- recommended DB/service fix:
  - Add composite lineage constraints after running a read-only drift audit and backfill/repair of any mismatches.
- blocks launch: No

## 4. Isolation Risks

### Finding I1
- severity: Critical
- workflow name: Care plan caregiver resend / retry
- concurrency/replay scenario:
  - Two staff actions, or one late resend after the caregiver already signed, can both hit the caregiver-send preparation path.
- exact files/functions involved:
  - `lib/services/care-plan-esign.ts` -> `sendCarePlanToCaregiverForSignature`
  - `supabase/migrations/0073_delivery_and_member_file_rpc_hardening.sql` -> `rpc_prepare_care_plan_caregiver_request`
- what duplicate/conflicting state could happen:
  - The plan can move from signed back to `ready_to_send`, rotate to a new token, and lose the previous `final_member_file_id`.
- recommended protection:
  - Move the status guard into the RPC itself, not just service code.
  - Require compare-and-set behavior on allowed current statuses.
  - Add a "signed means immutable" rule for caregiver request fields and final-file linkage.
- blocks launch: Yes

### Finding I2
- severity: Low
- workflow name: Enrollment packet public submit / upload replay
- concurrency/replay scenario:
  - Caregiver double-clicks submit or resubmits after a slow network response.
- exact files/functions involved:
  - `lib/services/enrollment-packets-public-runtime.ts`
  - `lib/services/enrollment-packet-artifacts.ts`
  - `supabase/migrations/0165_idempotency_write_roots_and_dedupe_contracts.sql`
- what duplicate/conflicting state could happen:
  - I did not find a new confirmed duplicate-write bug here tonight. The path now has replay checks, consumed-token handling, and upload fingerprints.
- recommended protection:
  - Keep the current fingerprint/index guard and replay checks.
  - Add one more regression test covering "finalize committed before upload follow-up" plus double-submit with identical files.
- blocks launch: No

## 5. Durability Risks

### Finding D1
- severity: Critical
- workflow name: Care plan readiness truth after nurse signature
- exact files/functions involved:
  - `lib/services/care-plans-supabase.ts` -> `finalizeCaregiverDispatchAfterNurseSignature`
  - `lib/services/care-plan-post-sign-readiness.ts`
- what success currently means:
  - The workflow can return `ready` immediately after dispatch send succeeds.
- what may fail underneath:
  - Caregiver signature and final signed member-file persistence have not happened yet.
- why that is unsafe:
  - Staff or downstream workflows can treat a still-pending care plan as fully finalized.
- recommended correction:
  - Only return `ready` from the caregiver finalization boundary, not from dispatch send.
- blocks launch: Yes

### Finding D2
- severity: High
- workflow name: Enrollment packet completed state versus post-commit follow-up
- exact files/functions involved:
  - `lib/services/enrollment-packets-public-runtime.ts`
  - `lib/services/enrollment-packets-public-runtime-follow-up.ts`
  - `lib/services/enrollment-packet-public-helpers.ts`
- what success currently means:
  - The packet is durably completed, but operational readiness may still be pending or action-required.
- what may fail underneath:
  - Mapping, completed-packet artifact linkage, sender notification, lead activity sync, or operational shell consensus.
- why that is unsafe:
  - It would be unsafe if the UI still implied "fully done," but tonight's code now surfaces pending/action-required truth more consistently.
- recommended correction:
  - Keep using `completion_follow_up_status` as the truth boundary.
  - Add a repair runner for stuck `pending` packets and alert on stale follow-up states.
- blocks launch: No

### Finding D3
- severity: Medium
- workflow name: Follow-up alerts and observability after committed writes
- exact files/functions involved:
  - `lib/services/enrollment-packets-public-runtime-follow-up.ts`
  - `lib/services/care-plan-esign-public.ts`
- what success currently means:
  - Core records can be committed even if some post-commit alerts or workflow event writes fail.
- what may fail underneath:
  - Durable operational breadcrumbs can be partially missing.
- why that is unsafe:
  - The data survives, but staff repair work becomes easier to miss.
- recommended correction:
  - Add a small durable "repair needed" queue for post-commit failures instead of relying only on best-effort alerts/logging.
- blocks launch: No

## 6. ACID Hardening Plan

1. Fix the care plan caregiver state machine first.
   - Stop returning `ready` from the dispatch-send step.
   - Add terminal-state guards inside `rpc_prepare_care_plan_caregiver_request`.
   - Add compare-and-set enforcement for allowed resend states.
2. Add care plan regression coverage second.
   - Signed plan cannot be resent.
   - Signed plan cannot lose `final_member_file_id`.
   - Nurse-sign path stays pending until caregiver finalization.
3. Keep enrollment packet staging, but harden repair operations.
   - Add a durable retry/repair job for `completion_follow_up_status = 'pending'` or `action_required`.
   - Alert on packets stuck in pending follow-up beyond a defined age.
4. Close schema-level lineage gaps.
   - Add composite lineage constraints for `care_plan_signature_events`.
   - Add composite lineage constraints for MAR schedule/administration tables after drift checks.
5. Add a small durable post-commit repair queue.
   - Use it for enrollment/care-plan follow-up failures where the core record already committed.

## 7. Suggested Codex Prompts

### Prompt 1
Fix the care plan caregiver dispatch/sign state machine in Memory Lane. `rpc_prepare_care_plan_caregiver_request` must refuse to reset signed care plans or clear `final_member_file_id`, and `finalizeCaregiverDispatchAfterNurseSignature` must stop marking post-sign readiness `ready` before the caregiver actually signs. Preserve the current architecture: service layer calling canonical RPCs, no mock fallbacks, and explicit follow-up-needed states when post-commit work is incomplete. Add regression tests for resend-after-signed, double-send race safety, and correct readiness truth.

### Prompt 2
Harden enrollment packet completion follow-up operations without pretending the workflow is fully atomic. Keep the current `completion_follow_up_status` truth model, but add a durable retry/repair path for packets stuck in `pending` or `action_required`, plus a small operational read model for staff to review those packets. Do not collapse staged completion into fake success.

### Prompt 3
Add schema-level lineage enforcement for `care_plan_signature_events`, `mar_schedules`, and `mar_administrations` so their member lineage cannot drift from the parent care plan / medication / schedule records. First add a read-only drift check, then add forward-only migrations with composite keys or equivalent canonical constraints, and update any tests that currently assume single-column foreign keys are enough.

## 8. Fix First Tonight

- Add a terminal-state guard to `rpc_prepare_care_plan_caregiver_request`.
- Remove the early `markCarePlanPostSignReady` step from `finalizeCaregiverDispatchAfterNurseSignature`.
- Add one focused regression test proving a signed care plan cannot be reset or lose its final file.
- Add one focused regression test proving nurse-sign returns a pending caregiver state, not `ready`.

## 9. Automate Later

- Nightly check for care plans where `caregiver_signature_status = 'signed'` but resend-prep fields changed afterward.
- Nightly check for care plans with `post_sign_readiness_status = 'ready'` but missing caregiver signature or missing `final_member_file_id`.
- Nightly check for enrollment packets with `status = 'completed'` and `completion_follow_up_status <> 'completed'` older than the agreed SLA.
- Read-only lineage drift audits for care-plan signature events and MAR tables before adding composite constraints.

## 10. Founder Summary: What changed since the last run

- One real improvement landed in the current dirty workspace: enrollment packet operational readiness is now more honest across list/readiness consumers, not just deep service code.
  - `lib/services/enrollment-packet-readiness.ts` now treats `mapping_sync_status = completed` plus `completion_follow_up_status != completed` as still `filed_pending_mapping`.
  - `lib/services/enrollment-packets-listing.ts` now filters "operationally ready" packets by both `mapping_sync_status` and `completion_follow_up_status`.
  - `lib/services/enrollment-packet-list-support.ts` now passes follow-up status into readiness/presentation.
  - The matching tests were updated in `tests/enrollment-packet-completion-truth.test.ts` and `tests/workflow-readiness-resolvers.test.ts`.
- That change reduces false-ready enrollment packet screens and lists. It is a real trust improvement for founders and staff.
- The biggest blocker from the last run did not move: the care plan caregiver dispatch/sign state machine is still the highest-risk confirmed ACID problem in scope.
- I did not find a new confirmed ACID regression tonight in:
  - lead -> member conversion
  - intake -> draft POF creation
  - signed POF -> MHP/MCC/MAR cascade
  - scheduled MAR documentation
  - member-file persistence
- New untracked migrations `0209`, `0210`, and `0211` are mostly sales/query/holds hardening and did not change tonight's core ACID verdict for the requested workflows.
