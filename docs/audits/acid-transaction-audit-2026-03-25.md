# Memory Lane ACID Transaction Audit

Date: 2026-03-25

## 1. Executive Summary

- Overall ACID safety rating: 8.9/10
- Overall verdict: Partial
- Top 5 ACID risks:
  - Enrollment packet child tables still do not fully enforce packet-to-member lineage at the database boundary.
  - Signed intake still commits before draft POF creation and intake PDF persistence are fully durable.
  - Enrollment packet filing still commits before downstream MCC/MHP/POF mapping and lead-activity follow-up are fully durable.
  - Care plan create/review/sign flows can partially commit before version snapshot and caregiver dispatch are complete.
  - Member-file delete cleanup can still leave orphaned storage objects after the database row is already gone.
- Strongest workflows:
  - Lead -> member conversion remains strong through shared RPC `rpc_convert_lead_to_member`, and the March 24 lead-stage RPC hardening did not introduce a new ACID regression.
  - Public POF signing remains strong: consumed-token replay handling, compare-and-set open protection, and queued post-sign follow-up are all still present.
  - Care plan caregiver public signing remains strong: consumed-token replay handling and canonical RPC finalization are still intact.
  - Scheduled MAR documentation remains strong: `rpc_document_scheduled_mar_administration` now uses transaction-scoped locking and duplicate-safe replay behavior.
  - Manual intake and enrollment repair retries are materially safer now because the queue claims were added and the retry actions use them.
- Short founder summary:
  - The biggest March 24 launch-blocking issue is genuinely closed. Clinical lineage is now enforced for intake, POF, and MAR tables. The main remaining concerns tonight are staged workflow boundaries and one smaller remaining schema-enforcement gap in enrollment packet child tables.

## 2. Atomicity Violations

### Finding A1
- Severity: Medium
- Workflow name: Intake signed -> draft POF + intake PDF persistence
- Exact files/functions/modules:
  - `app/intake-actions.ts` -> `createAssessmentAction`
  - `app/(portal)/health/assessment/[assessmentId]/actions.ts` -> `retryAssessmentDraftPofAction`, `generateAssessmentPdfAction`
  - `lib/services/intake-post-sign-follow-up.ts`
  - `lib/services/intake-post-sign-readiness.ts`
  - `lib/services/assessment-detail-read-model.ts` -> `getAssessmentDetail`
- What should happen:
  - A signed intake should either already have its draft POF and Member Files PDF, or the system should treat it as an explicit staged follow-up state everywhere.
- What currently happens:
  - Intake creation and nurse/admin signature commit first.
  - Draft POF creation and intake PDF persistence happen after that.
  - If either follow-up step fails, the system queues repair work and exposes `post_sign_readiness_status` instead of pretending the intake is fully ready.
- How partial failure could occur:
  - A signed intake can still exist without a durable draft POF or without its intake PDF saved to Member Files until staff resolve the queued task.
- Recommended fix:
  - Keep the staged design, but finish auditing downstream consumers so they all gate on `post_sign_ready` or `post_sign_readiness_status`, not signature alone.
- Whether it blocks launch: No

### Finding A2
- Severity: Medium
- Workflow name: Enrollment packet completion -> downstream mapping and lead follow-up
- Exact files/functions/modules:
  - `lib/services/enrollment-packets-public-runtime.ts` -> `submitPublicEnrollmentPacket`
  - `lib/services/enrollment-packet-mapping-runtime.ts` -> `runEnrollmentPacketDownstreamMapping`, `syncEnrollmentPacketLeadActivityOrQueue`
  - `lib/services/enrollment-packet-public-helpers.ts` -> `buildPublicEnrollmentPacketSubmitResult`
  - `lib/services/enrollment-packet-follow-up.ts`
- What should happen:
  - A filed enrollment packet should either already be operationally ready downstream or be treated everywhere as a staged handoff that still needs repair.
- What currently happens:
  - The caregiver packet artifact is finalized and the packet is filed first.
  - MCC/MHP/POF mapping and lead-activity sync run after filing.
  - If those later steps fail, the workflow returns `operationalReadinessStatus`, queues follow-up tasks, and records action-required alerts.
- How partial failure could occur:
  - A packet can be safely filed while downstream setup still needs repair.
- Recommended fix:
  - Keep `operationalReadinessStatus` as the only operator-facing handoff truth anywhere staff decide whether a packet is really complete.
- Whether it blocks launch: No

### Finding A3
- Severity: Medium
- Workflow name: Care plan create/review/sign -> snapshot persistence and caregiver dispatch
- Exact files/functions/modules:
  - `lib/services/care-plans-supabase.ts` -> `createCarePlan`, `reviewCarePlan`, `signCarePlanAsNurseAdmin`, `finalizeCaregiverDispatchAfterNurseSignature`
  - `app/care-plan-actions.ts` -> `createCarePlanAction`, `reviewCarePlanAction`, `signCarePlanAction`
  - `app/(portal)/health/care-plans/[carePlanId]/page.tsx`
- What should happen:
  - Once a care plan is treated as signed, version history and caregiver-dispatch readiness should be tracked and surfaced deterministically.
- What currently happens:
  - Core care plan persistence and nurse/admin signature commit first.
  - Snapshot persistence and caregiver dispatch happen after.
  - On failure, the service sets `post_sign_readiness_status`, raises action-required alerts, and returns an error with the saved care-plan id.
- How partial failure could occur:
  - Staff can receive a failure response even though the care plan already exists and may already be signed, because later follow-up work failed.
- Recommended fix:
  - Keep the staged model, but make `post_sign_readiness_status` more prominent anywhere the app routes staff back after a failed create/review/sign action so duplicate retries do not create confusion.
- Whether it blocks launch: No

## 3. Consistency Gaps

### Finding C1
- Severity: Medium
- Affected schema/business rule:
  - Enrollment packet child rows that carry both `packet_id` and `member_id` should be structurally forced to reference the same packet/member lineage.
- Exact files/migrations/services involved:
  - `supabase/migrations/0027_enrollment_packet_intake_mapping.sql`
  - `supabase/migrations/0110_enrollment_packet_follow_up_queue.sql`
  - `lib/services/enrollment-packet-follow-up.ts` -> `loadEnrollmentPacketLineage`, `queueEnrollmentPacketFollowUpTask`
  - `supabase/migrations/0106_enrollment_atomicity_and_intake_follow_up_queue.sql` -> `convert_enrollment_packet_to_member`
- What invariant is not enforced:
  - Tables such as `enrollment_packet_pof_staging`, `enrollment_packet_mapping_runs`, `enrollment_packet_mapping_records`, `enrollment_packet_field_conflicts`, and `enrollment_packet_follow_up_queue` each reference the packet and the member separately, but the database does not yet require those values to belong to the same enrollment packet.
- Why it matters:
  - Today the service layer checks lineage before writing many of these rows, but Supabase would still accept a split-brain row if a future bug, manual repair, or direct SQL write passed the wrong `member_id`.
- Recommended DB/service fix:
  - Extend the `0127_clinical_lineage_enforcement.sql` pattern to enrollment packet child tables:
  - Add parent-side uniqueness on `(id, member_id)` for `enrollment_packet_requests`.
  - Add composite child foreign keys `(packet_id, member_id)` where the child rows already carry both values.
  - Keep the service-level lead checks for nullable `lead_id`, and add a stricter DB pattern for lead parity only if it can be done cleanly.
- Whether it blocks launch: No

## 4. Isolation Risks

- No new confirmed isolation risks in the audited priority workflows tonight.
- Evidence checked:
  - `supabase/migrations/0128_intake_follow_up_retry_claims.sql` now uses `FOR UPDATE SKIP LOCKED` claim RPCs for intake and enrollment follow-up queues.
  - `app/(portal)/health/assessment/[assessmentId]/actions.ts` now claims intake repair tasks before retrying draft POF or PDF saves.
  - `lib/services/enrollment-packet-mapping-runtime.ts` still claims mapping retries before processing them.
  - `lib/services/pof-esign-public.ts`, `lib/services/care-plan-esign-public.ts`, and `lib/services/enrollment-packets-public-runtime.ts` still use consumed-token replay handling and compare-and-set style state guards.
  - `supabase/migrations/0121_document_scheduled_mar_administration_rpc.sql` still uses transaction-scoped locking and duplicate-safe replay behavior for scheduled MAR documentation.

## 5. Durability Risks

### Finding D1
- Severity: Medium
- Workflow name: Care plan create/review/sign user-facing completion boundary
- Exact files/functions involved:
  - `lib/services/care-plans-supabase.ts` -> `createCarePlan`, `reviewCarePlan`, `signCarePlanAsNurseAdmin`
  - `app/care-plan-actions.ts`
- What success currently means:
  - The UI only returns success once the later post-sign work also succeeds.
- What may fail underneath:
  - The core care plan and nurse signature can already be durably saved before snapshot persistence or caregiver dispatch fails.
- Why that is unsafe:
  - This is a false-failure window, not a false-success window. Staff can believe the action failed completely even though a real care plan record was already committed.
- Recommended correction:
  - Preserve the existing explicit error text, but route operators back into the saved care plan with its `post_sign_readiness_status` visibly highlighted and a clear “resume follow-up” path.
- Whether it blocks launch: No

### Finding D2
- Severity: Low
- Workflow name: Member-file delete and artifact cleanup
- Exact files/functions involved:
  - `lib/services/member-files.ts` -> `deleteMemberFileRecordAndStorage`
  - `lib/services/enrollment-packet-artifacts.ts` cleanup callers
- What success currently means:
  - The database row is deleted first, and storage cleanup is attempted second.
- What may fail underneath:
  - Storage deletion can still fail after the row is already gone.
- Why that is unsafe:
  - This avoids broken database references, but it can still leave orphaned files in storage that staff cannot see from the app.
- Recommended correction:
  - Add a nightly orphaned-storage reconciliation job for the `member-documents` bucket and record the orphan count as an operational metric.
- Whether it blocks launch: No

## 6. ACID Hardening Plan

1. Extend the new `0127` lineage-enforcement pattern to enrollment packet child tables so packet/member lineage is structurally enforced, not only service-checked.
2. Finish auditing all intake, enrollment, and care plan consumers so they gate operator handoff on staged readiness fields, not on first-stage commit markers alone.
3. Improve the care-plan partial-commit operator experience so false-failure states immediately land staff on the saved record with a clear next action.
4. Add nightly orphaned-storage reconciliation for `member-documents`.
5. Keep replay and claim-based protections covered by regression tests so future refactors do not reopen the race conditions fixed on March 24.

## 7. Suggested Codex Prompts

### Prompt 1
Implement a production-safe lineage-hardening pass for Memory Lane enrollment packet child tables. Focus on `enrollment_packet_pof_staging`, `enrollment_packet_mapping_runs`, `enrollment_packet_mapping_records`, `enrollment_packet_field_conflicts`, and `enrollment_packet_follow_up_queue`. Reuse the same pattern used in `0127_clinical_lineage_enforcement.sql`: add a read-only drift audit first, repair any mismatches deterministically, then add the smallest clean set of composite unique constraints and composite foreign keys so `(packet_id, member_id)` lineage is enforced in Supabase. Do not add alternate write paths or runtime fallbacks. Show migrations, rollout cautions, and manual verification queries.

### Prompt 2
Audit Memory Lane intake, enrollment packet, and care plan screens for staged-readiness truth. The goal is to ensure no page, list, CTA, or workflow handoff treats signature, `filed`, or nurse-signature state alone as final completion when a shared readiness field already exists. Reuse `post_sign_readiness_status`, `post_sign_ready`, and `operationalReadinessStatus`. Keep the fix small and production-safe. Show the exact screens changed and the downstream effect.

### Prompt 3
Harden the care plan partial-commit user experience in Memory Lane. Today a care plan can already be saved and signed before snapshot persistence or caregiver dispatch fails, which returns an error even though the core record is real. Keep the current canonical write path, but make the UI route staff back into the saved care plan with clear post-sign readiness messaging and an explicit follow-up action instead of a generic failure state. Show changed files and manual retest steps.

### Prompt 4
Implement a nightly orphaned-storage audit for Memory Lane `member-documents`. Detect files that no longer have a canonical `member_files` row, plus artifacts left behind after enrollment packet, POF, care plan, or member-file cleanup failures. Log a concise summary and raise an alert only when orphaned artifacts exist. Keep Supabase as source of truth and do not auto-delete until the report is validated.

## 8. Fix First Tonight

- Extend schema lineage enforcement to enrollment packet child tables.
- Audit any remaining operator-facing screens or buttons that could still treat first-stage commit as final readiness for intake, enrollment packets, or care plans.
- Make care plan partial-commit failures route more cleanly back into the saved record.

## 9. Automate Later

- Nightly enrollment-packet lineage drift report for `(packet_id, member_id)` mismatches.
- Nightly orphaned-storage scan for `member-documents`.
- Regression test that intake repair retries cannot be processed by two operators at once.
- Regression test that enrollment packet and care plan UIs respect readiness fields before showing “done” states.

## 10. Founder Summary: What changed since the last run

- The previous launch-blocking lineage issue is genuinely fixed in today’s codebase:
  - `supabase/migrations/0127_clinical_lineage_enforcement.sql` now repairs and then enforces parent/member lineage for `intake_assessment_signatures`, `intake_post_sign_follow_up_queue`, `pof_medications`, `mar_schedules`, and `mar_administrations`.
  - `docs/audits/clinical-lineage-drift-audit.sql` adds a read-only drift query pack so the same checks can be rerun safely.
- The previous manual-retry race is also genuinely fixed:
  - `supabase/migrations/0128_intake_follow_up_retry_claims.sql` adds claim RPCs for intake and enrollment follow-up queues using `FOR UPDATE SKIP LOCKED`.
  - `app/(portal)/health/assessment/[assessmentId]/actions.ts` now claims intake follow-up work before retrying it.
  - `lib/services/enrollment-packet-follow-up.ts` and `lib/services/intake-post-sign-follow-up.ts` now expose canonical claim/release helpers.
- Lead conversion was hardened further after the last run, and no new ACID regression was found there:
  - `supabase/migrations/0135_lead_conversion_member_shell_backfill.sql`
  - `supabase/migrations/0136_lead_conversion_member_shell_rls_fix.sql`
  - `supabase/migrations/0137_fix_rpc_transition_lead_stage_status_cast.sql`
  - `supabase/migrations/0138_rpc_transition_lead_stage_patch_guardrails.sql`
  - `supabase/migrations/0139_rpc_transition_lead_stage_v2.sql`
- No new regression was confirmed in public POF signing, public care plan signing, enrollment packet replay handling, or scheduled MAR documentation.
- Because the old top issue is now closed, the highest remaining concern tonight is narrower:
  - enrollment packet child tables still need the same kind of schema-enforced lineage that intake/POF/MAR now have.
