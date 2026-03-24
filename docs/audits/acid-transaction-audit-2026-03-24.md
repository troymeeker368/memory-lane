# Memory Lane ACID Transaction Audit

Date: 2026-03-24

## 1. Executive Summary

- Overall ACID safety rating: 8.3/10
- Overall verdict: Partial
- Top 5 ACID risks:
  - The database still does not structurally enforce member-to-parent lineage across several intake, POF, MAR, and follow-up tables.
  - Signed intake still commits before draft POF creation and intake PDF persistence are fully durable.
  - Enrollment packet filing still commits before downstream mapping and some follow-up work are fully durable.
  - Manual repair queues still do not claim work before retries, so overlapping staff retries can repeat the same repair attempts.
  - Member-file delete and artifact cleanup paths can still leave orphaned storage objects behind after the DB row is already gone.
- Strongest workflows:
  - Lead -> member conversion remains strongly hardened through shared RPC `rpc_convert_lead_to_member` with optional post-commit event logging.
  - Public enrollment packet submission is materially safer now: malformed `intakePayload` JSON is rejected, replay-safe consumed-token handling is in place, readiness truth is returned to the UI, and retry work is now claim-based.
  - POF public open/sign remains strong: compare-and-set open protection, consumed-token replay safety, and claim-based post-sign retry processing are all still present.
  - Care plan caregiver public signing remains strong: compare-and-set terminal-state enforcement is in place and caregiver finalization still runs through the canonical RPC.
  - Scheduled MAR documentation is materially improved: the write path now uses `rpc_document_scheduled_mar_administration`, which safely returns the already-committed row on duplicate submissions.
- Short founder summary:
  - Today’s code closed three medium-risk items from the last run. The biggest remaining issues are now one important schema-enforcement gap plus two staged workflows that are explicit but still not fully atomic from the operator’s point of view.

## 2. Atomicity Violations

### Finding A1
- Severity: Medium
- Workflow name: Intake signed -> draft POF + intake PDF persistence
- Exact files/functions/modules:
  - `app/intake-actions.ts` -> `createAssessmentAction`
  - `app/(portal)/health/assessment/[assessmentId]/actions.ts` -> `retryAssessmentDraftPofAction`, `generateAssessmentPdfAction`
  - `lib/services/intake-post-sign-follow-up.ts`
  - `lib/services/intake-pof-mhp-cascade.ts` -> `updateIntakeAssessmentDraftPofStatus`
  - `supabase/migrations/0055_intake_draft_pof_atomic_creation.sql`
  - `supabase/migrations/0106_enrollment_atomicity_and_intake_follow_up_queue.sql`
- What should happen:
  - Once the platform treats an intake as clinically complete, the required downstream draft POF and intake PDF should either already be durable or the intake should clearly move into one shared pending-follow-up state.
- What currently happens:
  - Intake creation and signature finalize first.
  - After that, app code separately attempts draft POF creation and intake PDF persistence.
  - If either follow-up step fails, the system queues repair work and returns an explicit partial-failure message.
- How partial failure could occur:
  - A signed intake can exist without its draft POF or without its intake PDF in Member Files until someone resolves the queued task.
- Recommended fix:
  - Add one canonical intake readiness resolver or field that combines signature state, `draft_pof_status`, and member-file PDF follow-up state so downstream modules stop treating signature alone as completion truth.
- Whether it blocks launch: No

### Finding A2
- Severity: Medium
- Workflow name: Enrollment packet completion -> downstream mapping
- Exact files/functions/modules:
  - `lib/services/enrollment-packets-public-runtime.ts` -> `submitPublicEnrollmentPacket`
  - `lib/services/enrollment-packet-mapping-runtime.ts` -> `runEnrollmentPacketDownstreamMapping`, `retryFailedEnrollmentPacketMappings`
  - `lib/services/enrollment-packet-follow-up.ts`
  - `app/sign/enrollment-packet/[token]/actions.ts` -> `submitPublicEnrollmentPacketAction`
  - `supabase/migrations/0106_enrollment_atomicity_and_intake_follow_up_queue.sql`
  - `supabase/migrations/0110_enrollment_packet_follow_up_queue.sql`
  - `supabase/migrations/0120_enrollment_packet_mapping_retry_claim_rpc.sql`
- What should happen:
  - Filing should either also guarantee downstream mapping and required follow-up work are durable, or the platform should consistently treat filed packets as a staged state instead of the whole truth.
- What currently happens:
  - The packet artifact is finalized and filed first.
  - Downstream mapping then runs after filing.
  - If mapping or follow-up work fails, the workflow returns `mappingSyncStatus`, `operationalReadinessStatus`, and an action-needed message instead of pretending everything is done.
- How partial failure could occur:
  - A packet can be safely filed while MCC/MHP/POF downstream mapping or lead-activity follow-up still needs repair.
- Recommended fix:
  - Keep the staged design, but make every consumer treat `operationalReadinessStatus` as the canonical handoff truth and never treat `filed` alone as operationally ready.
- Whether it blocks launch: No

## 3. Consistency Gaps

### Finding C1
- Severity: High
- Affected schema/business rule:
  - Child rows that carry both a parent ID and `member_id` should be structurally forced to reference the same member.
- Exact files/migrations/services involved:
  - `supabase/migrations/0022_intake_assessment_esign.sql`
  - `supabase/migrations/0028_pof_seeded_mar_workflow.sql`
  - `supabase/migrations/0106_enrollment_atomicity_and_intake_follow_up_queue.sql`
  - `supabase/migrations/0110_enrollment_packet_follow_up_queue.sql`
- What invariant is not enforced:
  - The database allows rows like `intake_assessment_signatures(assessment_id, member_id)`, `intake_post_sign_follow_up_queue(assessment_id, member_id)`, `pof_medications(physician_order_id, member_id)`, `mar_schedules(pof_medication_id, member_id)`, and `mar_administrations(mar_schedule_id, pof_medication_id, member_id)` to point to individually valid parents that could still belong to different members.
- Why it matters:
  - If a service bug, manual repair, or future refactor writes the wrong `member_id`, Supabase can accept contradictory clinical data instead of rejecting it at the schema boundary.
- Recommended DB/service fix:
  - First run a drift-detection query pack to find any existing mismatches.
  - Then add parent-side composite unique constraints like `(id, member_id)` where needed and replace single-column child FKs with composite FKs that enforce lineage.
- Whether it blocks launch: Yes

### Finding C2
- Severity: Medium
- Affected schema/business rule:
  - Intake completion truth is still split across separate fields and follow-up queues instead of one canonical readiness state.
- Exact files/migrations/services involved:
  - `app/intake-actions.ts` -> `createAssessmentAction`
  - `lib/services/intake-pof-mhp-cascade.ts` -> `draft_pof_status`
  - `lib/services/intake-post-sign-follow-up.ts`
- What invariant is not enforced:
  - The system records draft POF state, signature state, and PDF follow-up state separately, but does not expose one canonical “downstream-ready” truth for signed intakes.
- Why it matters:
  - Different modules can interpret the same signed intake differently unless they all remember to inspect multiple follow-up signals.
- Recommended DB/service fix:
  - Add one shared readiness resolver first. Only add a new column if the resolver proves too hard to apply consistently across the product.
- Whether it blocks launch: No

## 4. Isolation Risks

### Finding I1
- Severity: Low
- Workflow name: Manual intake and enrollment repair retries
- Concurrency/replay scenario:
  - Two staff members trigger the same follow-up repair from different tabs at nearly the same time.
- Exact files/functions involved:
  - `app/(portal)/health/assessment/[assessmentId]/actions.ts` -> `retryAssessmentDraftPofAction`, `generateAssessmentPdfAction`
  - `lib/services/intake-post-sign-follow-up.ts`
  - `lib/services/enrollment-packet-follow-up.ts`
- What duplicate/conflicting state could happen:
  - The queue rows themselves do not claim work before retry execution, so the same repair task can be attempted twice and can increment attempt counters or duplicate alert noise.
  - The underlying canonical writes are mostly protected: draft POF creation uses replay-safe RPC behavior on uniqueness, and generated member-file PDFs upsert by `documentSource`.
- Recommended protection:
  - Add a lightweight `in_progress` claim/lease step for manual follow-up queues so only one operator retry owns the repair task at a time.
- Whether it blocks launch: No

## 5. Durability Risks

### Finding D1
- Severity: Low
- Workflow name: Member-file delete and artifact cleanup
- Exact files/functions involved:
  - `lib/services/member-files.ts` -> `deleteMemberFileRecordAndStorage`
  - `lib/services/enrollment-packet-artifacts.ts` -> cleanup paths that call `deleteMemberFileRecordAndStorage`
- What success currently means:
  - The database row is deleted first, and then storage cleanup is attempted second.
- What may fail underneath:
  - Storage deletion can still fail after the row is already gone.
- Why that is unsafe:
  - This no longer leaves broken DB references, but it can leave orphaned files in storage that staff will not see from the app.
- Recommended correction:
  - Add a nightly orphaned-storage reconciliation job for the `member-documents` bucket and log the orphan count as an operational metric.
- Whether it blocks launch: No

### Finding D2
- Severity: Medium
- Workflow name: Signed intake and filed enrollment packet completion truth
- Exact files/functions involved:
  - `app/intake-actions.ts` -> `createAssessmentAction`
  - `lib/services/enrollment-packets-public-runtime.ts` -> `submitPublicEnrollmentPacket`
  - `app/sign/enrollment-packet/[token]/actions.ts` -> `submitPublicEnrollmentPacketAction`
- What success currently means:
  - The critical first-stage record is durable.
  - But some required downstream work may still be queued or pending.
- What may fail underneath:
  - Intake can still need draft POF or PDF repair.
  - Enrollment can still need downstream mapping or follow-up repair after the packet is already filed.
- Why that is unsafe:
  - Staff can have a real committed record while the surrounding operational workflow is not actually ready for the next team yet.
- Recommended correction:
  - Keep returning explicit staged status, and standardize downstream pages/buttons on one shared readiness resolver so operator-facing truth is deterministic everywhere.
- Whether it blocks launch: No

## 6. ACID Hardening Plan

1. Add schema-level lineage enforcement for intake, POF, and MAR child tables after running a preflight drift audit. This is the most important remaining corruption-prevention step.
2. Add one canonical intake downstream-readiness resolver so signed intake is not treated as fully complete until draft POF and intake PDF persistence are resolved.
3. Continue standardizing every downstream consumer of enrollment packets on `operationalReadinessStatus`, not just packet `status`.
4. Add lightweight claim/lease handling for manual repair queues so duplicate retries stop creating noise and racey follow-up behavior.
5. Add nightly orphaned-storage reconciliation for member documents and public-signature artifact cleanup leftovers.

## 7. Suggested Codex Prompts

### Prompt 1
Implement a production-safe lineage-hardening pass for Memory Lane clinical workflows. Focus on intake signatures, intake post-sign follow-up, POF medications, MAR schedules, and MAR administrations. First add a read-only drift audit query pack that finds any rows where parent IDs and `member_id` do not belong to the same member. Then add the smallest clean set of composite unique constraints and composite foreign keys needed to enforce `(parent_id, member_id)` lineage in Supabase. Do not add mock logic or bypasses. Show migrations, affected services, rollout cautions, and manual verification steps.

### Prompt 2
Implement one canonical intake downstream-readiness resolver for Memory Lane. A signed intake should not be treated as operationally complete until draft POF creation and intake PDF persistence are complete or explicitly tracked as action-required follow-up. Reuse the existing `draft_pof_status` field and intake follow-up queue. Keep the fix small, shared, and production-safe. Show changed files, schema impact, and manual retest steps.

### Prompt 3
Harden Memory Lane enrollment packet downstream consumers so `operationalReadinessStatus` is the canonical handoff truth everywhere. Audit current pages, actions, listings, and reports that may still treat `status = filed` as enough. Update only the places that can mislead staff. Do not change the existing staged workflow design. Show the exact screens changed and the downstream effect.

### Prompt 4
Add a lightweight claim/lease model for Memory Lane manual follow-up repair queues. Focus on intake post-sign repair tasks first, then enrollment packet follow-up tasks if the pattern is clean. The goal is to stop overlapping operator retries from processing the same task at the same time while preserving today’s idempotent canonical writes. Include migrations only if truly needed, and show manual concurrency retest steps.

### Prompt 5
Implement a nightly orphaned member-document storage audit for Memory Lane. Scan the `member-documents` bucket for files that no longer have a canonical `member_files` row, plus cleanup leftovers from enrollment packet and care plan failure paths. Log a summary and raise an operational alert only when orphaned artifacts exist. Keep Supabase as source of truth and avoid destructive cleanup until the report is validated.

## 8. Fix First Tonight

- Add the read-only drift audit for parent/member lineage mismatches in intake, POF, and MAR tables.
- Add one canonical intake downstream-readiness resolver.
- Audit any remaining enrollment screens or reports that might still treat `filed` as fully ready.

## 9. Automate Later

- Nightly lineage drift report for `(parent_id, member_id)` mismatches in clinical tables.
- Nightly orphaned-storage scan for `member-documents`.
- Regression test that two staff retrying the same intake repair task do not both take ownership.
- Regression test that enrollment packet UIs never treat `filed` without `operationalReadinessStatus`.

## 10. Founder Summary: What changed since the last run

- Three medium-risk items from the 2026-03-23 run are now genuinely fixed in code:
  - `app/sign/enrollment-packet/[token]/actions.ts` and `lib/services/enrollment-packets-public-runtime.ts` now reject malformed `intakePayload` JSON instead of silently normalizing it.
  - `supabase/migrations/0120_enrollment_packet_mapping_retry_claim_rpc.sql` plus `lib/services/enrollment-packet-mapping-runtime.ts` now claim failed enrollment mapping retries with `FOR UPDATE SKIP LOCKED`.
  - `supabase/migrations/0121_document_scheduled_mar_administration_rpc.sql` plus `lib/services/mar-workflow.ts` now make scheduled MAR documentation replay-safe.
- That means the main March 23 duplicate-submit and malformed-payload concerns are no longer top findings tonight.
- No new code regression was confirmed in lead conversion, POF public signing, care plan public signing, or enrollment packet replay handling.
- The biggest remaining issue I am elevating tonight is structural: the database still does not fully enforce parent/member lineage across several critical intake, POF, and MAR tables.
- The repo is still in a dirty state from unrelated local work, so this audit reflects the actual in-progress code in the workspace rather than a perfectly clean branch.
