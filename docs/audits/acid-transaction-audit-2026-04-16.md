# Memory Lane ACID Transaction Audit - 2026-04-16

## 1. Executive Summary

- Overall ACID safety rating: 8.1 / 10
- Overall verdict: Partial
- Top 5 ACID risks:
  - Enrollment packet artifact persistence can partially commit after the packet is already durably marked `completed`.
  - The care plan nurse-sign readiness bug is fixed in the current working tree, but the resend/reset guard is only production-real after `supabase/migrations/0212_care_plan_caregiver_prepare_terminal_guard.sql` is committed and applied.
  - Care plan caregiver resend still allows duplicate dispatch from `sent`, `viewed`, and `expired` states, which can issue a fresh token and email even though the signed-plan rollback hole is being closed.
  - `care_plan_signature_events` still lacks a schema-level same-member lineage constraint.
  - `mar_schedules` and `mar_administrations` still rely on single-column foreign keys instead of full lineage enforcement across member, schedule, and medication.
- Strongest workflows:
  - Lead -> member conversion remains strong through `rpc_convert_lead_to_member` and `rpc_create_lead_with_member_conversion` in `supabase/migrations/0165_idempotency_write_roots_and_dedupe_contracts.sql`.
  - Intake -> draft POF creation remains strong through `rpc_create_draft_physician_order_from_intake` in `supabase/migrations/0181_physician_order_save_rpc_atomicity.sql`.
  - Signed POF -> MHP/MCC/MAR cascade remains strong through `rpc_run_signed_pof_post_sign_sync` in `supabase/migrations/0155_signed_pof_post_sign_sync_rpc_consolidation.sql`.
  - Scheduled MAR documentation remains strong through `rpc_document_scheduled_mar_administration` in `supabase/migrations/0121_document_scheduled_mar_administration_rpc.sql`.
  - Member-file persistence remains strong and honest in `lib/services/member-files.ts`; storage/write drift is treated as degraded truth with alerts, not fake success.
- Short founder summary:
  - The repo is safer than yesterday on care plan readiness truth, and enrollment packet readiness truth is now more honest across read models and pages. The main issue I would move to the top tonight is enrollment packet artifact batch atomicity, while the care plan resend/reset fix should be finished by committing and applying the new migration.

## 2. Atomicity Violations

### Finding A1
- severity: High
- workflow name: Public enrollment packet completion -> finalized artifact persistence
- exact files/functions/modules:
  - `lib/services/enrollment-packets-public-runtime-artifacts.ts` -> `persistFinalizedPublicEnrollmentPacketArtifacts`
  - `lib/services/enrollment-packets-public-runtime-post-commit.ts` -> `completeCommittedPublicEnrollmentPacketPostCommitWork`
  - `supabase/migrations/0180_enrollment_completion_follow_up_state.sql` -> `rpc_finalize_enrollment_packet_submission`
- what should happen:
  - After the packet is marked complete, the signature artifact, uploaded documents, and completed packet artifact should either all persist cleanly or the workflow should durably record and clean up the partial batch.
- what currently happens:
  - The completion RPC commits first.
  - Artifact persistence then runs file-by-file in application code.
  - If one insert or storage write fails midway, earlier artifacts may already be saved and there is no same-boundary rollback of the already-written files.
- how partial failure could occur:
  - A caregiver can complete the packet, the request can be durably `completed`, but only some artifacts or member-file rows may exist for that completion batch.
- recommended fix:
  - Add a durable artifact batch record before writes start, then make the batch either cleanup-safe on failure or explicitly repairable from that recorded batch.
  - Do not rely on best-effort alerts alone for this path.
- blocks launch: Yes

### Finding A2
- severity: Medium
- workflow name: Care plan caregiver email dispatch
- exact files/functions/modules:
  - `lib/services/care-plan-esign.ts` -> `sendCarePlanToCaregiverForSignature`
  - `lib/services/care-plan-esign.ts` -> `transitionCarePlanCaregiverStatus`
- what should happen:
  - If the caregiver email is delivered, the system should durably finalize the `sent` state before the workflow returns success.
- what currently happens:
  - The code prepares the request, sends the email, and only then finalizes the durable `sent` state.
  - If that finalization step fails, the code raises an operational alert and tells the system the link remains active in a non-finalized state.
- how partial failure could occur:
  - A real email can be in the caregiver inbox while the database still says the plan is not durably in the final sent state.
- recommended fix:
  - Move this to a durable outbox-style send boundary, or persist a stronger post-email reconciliation record that prevents ambiguous resend decisions.
- blocks launch: No

### Finding A3
- severity: Medium
- workflow name: Enrollment packet completion boundary
- exact files/functions/modules:
  - `supabase/migrations/0180_enrollment_completion_follow_up_state.sql` -> `rpc_finalize_enrollment_packet_submission`
  - `lib/services/enrollment-packets-public-runtime-cascade.ts` -> `runEnrollmentPacketCascadeAndBuildResult`
- what should happen:
  - If completion is intentionally staged, the system should clearly distinguish “completed” from “fully operationally ready.”
- what currently happens:
  - The packet is durably completed first, then mapping, artifact linkage, sender notification, lead activity sync, and shell consensus are resolved after commit.
- how partial failure could occur:
  - The core packet is correct, but downstream operational setup may still need repair.
- recommended fix:
  - Keep the staged model, but keep `completion_follow_up_status` as the source of truth and add durable repair ownership for stuck follow-up states.
- blocks launch: No

## 3. Consistency Gaps

### Finding C1
- severity: High
- affected schema/business rule:
  - Signed care plans must be immutable once caregiver signature is finalized and a final member-file artifact exists.
- exact files/migrations/services involved:
  - `lib/services/care-plans-supabase.ts` -> `finalizeCaregiverDispatchAfterNurseSignature`
  - `supabase/migrations/0212_care_plan_caregiver_prepare_terminal_guard.sql`
  - `tests/care-plan-caregiver-dispatch-readiness.test.ts`
- what invariant is not enforced:
  - The working tree now contains the right guard, but it is still an untracked migration. Until it is committed and applied, production does not yet have that DB-level protection.
- why it matters:
  - Yesterday's highest-risk care plan reset bug is only partially closed until the migration is real in the runtime environment.
- recommended DB/service fix:
  - Commit the migration and ship it with the paired regression test.
  - Treat the issue as still open until the database function is replaced in Supabase.
- blocks launch: Yes

### Finding C2
- severity: Medium
- affected schema/business rule:
  - Care plan signature events should always belong to the same member as the care plan they reference.
- exact files/migrations/services involved:
  - `supabase/migrations/0020_care_plan_canonical_esign.sql`
  - `lib/services/care-plan-esign.ts`
- what invariant is not enforced:
  - `care_plan_signature_events` has separate foreign keys to `care_plans(id)` and `members(id)`, but no composite guard tying the event row to the canonical care plan/member pair.
- why it matters:
  - A service bug or manual repair could write contradictory audit history and the database would still accept it.
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
  - `mar_schedules` and `mar_administrations` do not yet use full composite lineage guards across member, medication, and schedule.
- why it matters:
  - The canonical service path is careful, but the schema still leaves room for cross-member drift if a bad write slips in.
- recommended DB/service fix:
  - Run a read-only lineage drift audit, repair any drift, then add forward-only composite constraints.
- blocks launch: No

## 4. Isolation Risks

### Finding I1
- severity: Medium
- workflow name: Care plan caregiver resend / duplicate dispatch
- concurrency/replay scenario:
  - A resend from `sent`, `viewed`, or `expired`, or two nearby staff resend actions, can still generate a fresh request token and email.
- exact files/functions involved:
  - `supabase/migrations/0212_care_plan_caregiver_prepare_terminal_guard.sql`
  - `lib/services/care-plan-esign.ts` -> `sendCarePlanToCaregiverForSignature`
- what duplicate/conflicting state could happen:
  - The old signed-plan rollback bug is being closed, but duplicate dispatch is still allowed for some non-terminal states.
- recommended protection:
  - Narrow allowed resend states, or add explicit resend sequencing and stale-token invalidation rules.
  - Make the product decision explicit: are repeated sends from `viewed` and `sent` actually allowed, or should they require staff override?
- blocks launch: No

## 5. Durability Risks

### Finding D1
- severity: High
- workflow name: Enrollment packet completion follow-up persistence
- exact files/functions involved:
  - `lib/services/enrollment-packets-public-runtime-follow-up.ts` -> `persistEnrollmentPacketCompletionFollowUpState`
  - `lib/services/enrollment-packets-public-runtime-follow-up.ts` -> `buildEnrollmentPacketPostCommitFailureResult`
- what success currently means:
  - The submit result can return `action_required` or `completed` based on in-memory follow-up evaluation.
- what may fail underneath:
  - The actual `completion_follow_up_status` write back to `enrollment_packet_requests` can fail and is swallowed after an alert.
- why that is unsafe:
  - The caller can briefly see a truth state that is not actually durable, and a refresh can fall back to stale DB state.
- recommended correction:
  - Retry until the DB state is durably updated, or return an explicitly degraded result that says the follow-up state itself was not persisted.
- blocks launch: No

### Finding D2
- severity: Medium
- workflow name: Care plan caregiver email delivery state
- exact files/functions involved:
  - `lib/services/care-plan-esign.ts` -> `sendCarePlanToCaregiverForSignature`
- what success currently means:
  - The caregiver may receive a valid link even if sent-state persistence fails immediately afterward.
- what may fail underneath:
  - The durable `sent` transition and some follow-up observability writes.
- why that is unsafe:
  - Operational staff can be left reconciling a live link against a stale database state.
- recommended correction:
  - Persist a durable outbox/send reconciliation record and make resend decisions read from that record.
- blocks launch: No

### Finding D3
- severity: Low
- workflow name: Core workflow audit events and milestones
- exact files/functions involved:
  - `lib/services/pof-esign.ts`
  - `lib/services/mar-workflow.ts`
  - `lib/services/mar-prn-workflow.ts`
  - `lib/services/physician-orders-supabase.ts`
  - `lib/services/intake-pof-mhp-cascade.ts`
- what success currently means:
  - Core rows are committed, but some audit or milestone writes remain best-effort.
- what may fail underneath:
  - Durable operational breadcrumbs and some staff-facing observability history.
- why that is unsafe:
  - Data integrity survives, but repair and traceability can be weaker than intended.
- recommended correction:
  - Add a small durable observability repair queue for post-commit audit writes.
- blocks launch: No

## 6. ACID Hardening Plan

1. Fix enrollment packet artifact batch atomicity first.
   - This is now the strongest confirmed partial-commit risk in the requested scope.
2. Finish the care plan resend/reset fix.
   - Commit and apply `0212_care_plan_caregiver_prepare_terminal_guard.sql`.
   - Keep the paired readiness regression test with it.
3. Harden follow-up durability truth.
   - Stop swallowing `completion_follow_up_status` persistence failures as if the truth was already durable.
4. Close schema-level lineage gaps.
   - Start with `care_plan_signature_events`, then MAR tables after a read-only drift audit.
5. Add durable post-commit repair records.
   - Use them for enrollment artifacts, follow-up state failures, and best-effort audit event failures.

## 7. Suggested Codex Prompts

### Prompt 1
Fix enrollment packet artifact batch atomicity in Memory Lane. `persistFinalizedPublicEnrollmentPacketArtifacts` currently writes signature, uploads, and completed-packet artifacts one by one after the completion RPC already committed. Add a durable batch record and cleanup-safe failure handling so partial artifact batches cannot silently drift. Keep Supabase as the source of truth, preserve the staged completion model, and add regression coverage for mid-batch failure.

### Prompt 2
Finish the care plan caregiver resend hardening in Memory Lane. Commit and apply `0212_care_plan_caregiver_prepare_terminal_guard.sql`, confirm `finalizeCaregiverDispatchAfterNurseSignature` keeps readiness at `signed_pending_caregiver_dispatch`, and add regression tests proving a signed/finalized care plan cannot be reset for resend.

### Prompt 3
Harden enrollment packet follow-up durability in Memory Lane. `completion_follow_up_status` should never be reported as changed unless the DB row actually persisted. Replace the current best-effort update path with retryable durable persistence or an explicitly degraded result that tells the UI the follow-up truth itself was not saved.

### Prompt 4
Add schema-level lineage enforcement for `care_plan_signature_events`, `mar_schedules`, and `mar_administrations` in Memory Lane. Start with a read-only drift audit, then add forward-only migrations that structurally tie child rows to the canonical member lineage of their parent records.

## 8. Fix First Tonight

- Commit and apply `supabase/migrations/0212_care_plan_caregiver_prepare_terminal_guard.sql`.
- Keep the current `lib/services/care-plans-supabase.ts` readiness change and make sure the paired care plan regression test stays green.
- Add durable batch ownership or cleanup for `persistFinalizedPublicEnrollmentPacketArtifacts`.
- Stop swallowing failed `completion_follow_up_status` persistence as if it were durable truth.

## 9. Automate Later

- Nightly read-only check for enrollment packets marked `completed` where the finalized artifact batch is incomplete.
- Nightly read-only check for packets stuck in `completion_follow_up_status in ('pending', 'action_required')` past the agreed SLA.
- Nightly read-only check for care plans whose caregiver request fields changed after `caregiver_signature_status = 'signed'`.
- Nightly lineage drift audit for `care_plan_signature_events`.
- Nightly lineage drift audit for `mar_schedules` / `mar_administrations`.

## 10. Founder Summary: What changed since the last run

- Real improvement: the care plan nurse-sign path no longer reports `ready` immediately after caregiver dispatch send.
  - Evidence: `lib/services/care-plans-supabase.ts` now returns `postSignReadinessStatus: "signed_pending_caregiver_dispatch"` during the auto-send path, and the paired check exists in `tests/care-plan-caregiver-dispatch-readiness.test.ts`.
- Real improvement, but still not shipped: the workspace now contains `supabase/migrations/0212_care_plan_caregiver_prepare_terminal_guard.sql`, which blocks resetting already signed/finalized care plans for resend.
  - Important: this is still an untracked migration in the current dirty tree, so I am not counting it as production-fixed yet.
- Real improvement: enrollment packet readiness truth is now more honest across shared readiness logic, list filtering, and packet presentation surfaces.
  - Evidence: `lib/services/enrollment-packet-readiness.ts`, `lib/services/enrollment-packets-listing.ts`, `lib/services/enrollment-packet-list-support.ts`, `lib/services/enrollment-packet-public-helpers.ts`, and the updated tests now require `completion_follow_up_status = completed` before treating a packet as operationally ready.
- New top concern tonight: enrollment packet artifact persistence is still sequential and post-commit.
  - That means the repo is telling the truth better than yesterday, but the artifact batch itself can still partially commit.
- No new confirmed ACID regression tonight in:
  - lead -> member conversion
  - intake -> draft POF creation
  - signed POF -> MHP/MCC/MAR cascade
  - scheduled MAR documentation
  - member-file generated PDF persistence
