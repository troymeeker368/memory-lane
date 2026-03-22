# Referential Integrity & Cascade Audit

Date: 2026-03-22
Scope: leads -> enrollment packets -> members -> intake assessments -> physician orders (POF) -> member health profiles -> care plans -> medications -> MAR records
Method: static repo audit of Supabase migrations, shared services, and shared read-model/status resolvers. Live Supabase row inspection was not available in this run, so deployed-row orphan and duplicate confirmation remains blocked.

## 1. Orphan Records Detected

None in the repo-defined schema for the audited primary parent-child relationships.

Confirmed FK-backed core links still include:

- `members.source_lead_id -> leads.id`
- `enrollment_packet_requests.lead_id -> leads.id`
- `enrollment_packet_requests.member_id -> members.id`
- `intake_assessments.member_id -> members.id`
- `physician_orders.member_id -> members.id`
- `physician_orders.intake_assessment_id -> intake_assessments.id`
- `member_health_profiles.member_id -> members.id`
- `member_health_profiles.active_physician_order_id -> physician_orders.id`
- `care_plans.member_id -> members.id`
- `care_plan_diagnoses(care_plan_id, member_id) -> care_plans(id, member_id)`
- `care_plan_diagnoses(member_diagnosis_id, member_id) -> member_diagnoses(id, member_id)`
- `pof_medications.physician_order_id -> physician_orders.id`
- `mar_schedules.pof_medication_id -> pof_medications.id`
- `mar_administrations.pof_medication_id -> pof_medications.id`

Examples requested by this audit that are structurally blocked in the repo schema:

- intake referencing nonexistent member
- MAR referencing nonexistent medication
- care plan referencing nonexistent diagnosis
- enrollment packet completed without member creation

Live orphan-row detection in the actual database is still blocked without direct Supabase access.

## 2. Missing Lifecycle Cascades

1. Signed intake still allows post-sign follow-up work to fail after signature finalization.
   Evidence: [`app/intake-actions.ts`](D:/Memory%20Lane%20App/app/intake-actions.ts#L273) signs first, then separately attempts draft POF creation and intake PDF persistence. Failed follow-up is queued in [`supabase/migrations/0106_enrollment_atomicity_and_intake_follow_up_queue.sql`](D:/Memory%20Lane%20App/supabase/migrations/0106_enrollment_atomicity_and_intake_follow_up_queue.sql#L1).
   Current mitigation: shared readiness resolver in [`lib/services/intake-draft-pof-readiness.ts`](D:/Memory%20Lane%20App/lib/services/intake-draft-pof-readiness.ts#L19) prevents downstream readers from treating every signed intake as draft-POF-ready.
   Remaining risk: signature truth is durable, but required downstream artifacts can still lag and need queue-driven repair.

2. Filed enrollment packets still allow downstream mapping to complete later.
   Evidence: mapping completion is written after filing in [`supabase/migrations/0106_enrollment_atomicity_and_intake_follow_up_queue.sql`](D:/Memory%20Lane%20App/supabase/migrations/0106_enrollment_atomicity_and_intake_follow_up_queue.sql#L611).
   Current mitigation: shared readiness resolver in [`lib/services/enrollment-packet-readiness.ts`](D:/Memory%20Lane%20App/lib/services/enrollment-packet-readiness.ts#L21) and public submit action in [`app/sign/enrollment-packet/[token]/actions.ts`](D:/Memory%20Lane%20App/app/sign/enrollment-packet/%5Btoken%5D/actions.ts#L289) now return `mappingSyncStatus` and `operationalReadinessStatus`.
   Remaining risk: filing and operational readiness are still separate lifecycle milestones, so staff-facing consumers must keep using the readiness resolver rather than raw packet status.

3. Signed POF still allows downstream clinical sync to complete later.
   Evidence: post-commit follow-up can return queued status in [`lib/services/pof-post-sign-runtime.ts`](D:/Memory%20Lane%20App/lib/services/pof-post-sign-runtime.ts#L241).
   Current mitigation: shared read path computes `clinicalSyncStatus` from queue state in [`lib/services/physician-orders-read.ts`](D:/Memory%20Lane%20App/lib/services/physician-orders-read.ts#L110).
   Remaining risk: legal signature can be complete while MHP, medication sync, and MAR schedule generation still need retry completion.

## 3. Duplicate Canonical Records

None in the current repo-defined schema for the audited canonical duplicate classes.

Current duplicate guards still present:

- one canonical member per lead via `idx_members_source_lead_id_unique`
- one active enrollment packet per member via `idx_enrollment_packet_requests_active_member_unique`
- one care-plan root per member and track via `idx_care_plans_member_track_unique`
- one active signed physician order per member via `uniq_physician_orders_active_signed`
- one active POF request per physician order via `idx_pof_requests_active_per_order_unique`
- one `pof_medications` row per order/source medication via `uniq_pof_medications_order_source`
- one `mar_schedules` row per member/medication/time via `uniq_mar_schedule_expected_dose`
- one care-plan diagnosis link per plan/diagnosis via `care_plan_diagnoses_unique`

Live duplicate-row detection in the deployed database is still blocked without direct Supabase access.

## 4. Lifecycle State Violations

None confirmed in the currently audited shared read paths.

Important nuance:

- raw upstream statuses still allow partial downstream completion states
- those partial states are now explicitly surfaced by shared readiness/status resolvers for intake, enrollment packets, and signed POFs

This is an improvement from the previous run: the public enrollment packet submit action now returns downstream readiness instead of plain success.

## 5. Missing Foreign Key Constraints

1. `assessment_responses` does not enforce that `(assessment_id, member_id)` belongs to the same intake row.
   Current state: separate FKs to `intake_assessments(id)` and `members(id)` in [`supabase/migrations/0006_intake_pof_mhp_supabase.sql`](D:/Memory%20Lane%20App/supabase/migrations/0006_intake_pof_mhp_supabase.sql#L66).
   Expected hardening: composite FK from `(assessment_id, member_id)` to `(intake_assessments.id, intake_assessments.member_id)`.
   Risk: response rows can remain non-orphaned while attached to the wrong member.

2. `intake_assessment_signatures` and `intake_post_sign_follow_up_queue` do not enforce assessment/member lineage.
   Current state: each table stores `assessment_id` and `member_id` as separate FKs in [`supabase/migrations/0022_intake_assessment_esign.sql`](D:/Memory%20Lane%20App/supabase/migrations/0022_intake_assessment_esign.sql#L1) and [`supabase/migrations/0106_enrollment_atomicity_and_intake_follow_up_queue.sql`](D:/Memory%20Lane%20App/supabase/migrations/0106_enrollment_atomicity_and_intake_follow_up_queue.sql#L1).
   Expected hardening: composite FKs from `(assessment_id, member_id)` to `(intake_assessments.id, intake_assessments.member_id)`.
   Risk: signature evidence and repair queue tasks can drift to the wrong member while still passing single-column integrity checks.

3. `pof_requests` and `document_events` do not enforce member consistency against the linked physician order / request lineage.
   Current state: separate FKs in [`supabase/migrations/0019_pof_esign_workflow.sql`](D:/Memory%20Lane%20App/supabase/migrations/0019_pof_esign_workflow.sql#L1) and [`supabase/migrations/0019_pof_esign_workflow.sql`](D:/Memory%20Lane%20App/supabase/migrations/0019_pof_esign_workflow.sql#L48).
   Expected hardening: composite FKs tying `(physician_order_id, member_id)` to `physician_orders(id, member_id)` and `(document_id, member_id)` to `(pof_requests.id, pof_requests.member_id)` after adding any needed parent-side unique constraints.
   Risk: POF requests and their event history can cross member lineage without becoming database orphans.

4. `enrollment_packet_uploads`, `enrollment_packet_mapping_runs`, `enrollment_packet_mapping_records`, `enrollment_packet_field_conflicts`, and `enrollment_packet_pof_staging` do not enforce packet/member lineage.
   Current state: packet and member are independent FKs in [`supabase/migrations/0024_enrollment_packet_workflow.sql`](D:/Memory%20Lane%20App/supabase/migrations/0024_enrollment_packet_workflow.sql#L97) and [`supabase/migrations/0027_enrollment_packet_intake_mapping.sql`](D:/Memory%20Lane%20App/supabase/migrations/0027_enrollment_packet_intake_mapping.sql#L33).
   Expected hardening: composite FKs from `(packet_id, member_id)` to `(enrollment_packet_requests.id, enrollment_packet_requests.member_id)`.
   Risk: uploads and mapping artifacts can remain non-orphaned while attached to the wrong member episode.

5. `care_plan_signature_events` does not enforce that event member matches care-plan member.
   Current state: separate FKs in [`supabase/migrations/0020_care_plan_canonical_esign.sql`](D:/Memory%20Lane%20App/supabase/migrations/0020_care_plan_canonical_esign.sql#L58).
   Expected hardening: composite FK from `(care_plan_id, member_id)` to `(care_plans.id, care_plans.member_id)`.
   Risk: care-plan signature history can drift away from the canonical member owner.

6. `pof_medications`, `mar_schedules`, and `mar_administrations` still do not fully enforce same-member lineage through the medication cascade.
   Current state: separate FKs in [`supabase/migrations/0028_pof_seeded_mar_workflow.sql`](D:/Memory%20Lane%20App/supabase/migrations/0028_pof_seeded_mar_workflow.sql#L1).
   Expected hardening: composite FKs for `(physician_order_id, member_id)`, `(pof_medication_id, member_id)`, and `(mar_schedule_id, member_id)` after adding any needed parent-side composite unique constraints.
   Risk: medication and MAR rows can remain non-orphaned while still crossing member lineage boundaries.

## 6. Suggested Fix Prompts

1. Fix this Memory Lane issue with the smallest production-safe change.

   Issue:
   Cross-member lineage is still possible across intake, enrollment packet, POF, care plan, and MAR child tables because many relationships rely on separate single-column FKs instead of composite lineage constraints.

   Scope:
   - Domain/workflow: lead -> enrollment -> intake -> POF -> care plan -> MAR referential integrity
   - Canonical entities/tables: `intake_assessments`, `assessment_responses`, `intake_assessment_signatures`, `intake_post_sign_follow_up_queue`, `enrollment_packet_requests`, `enrollment_packet_uploads`, `enrollment_packet_mapping_runs`, `enrollment_packet_mapping_records`, `enrollment_packet_field_conflicts`, `enrollment_packet_pof_staging`, `physician_orders`, `pof_requests`, `document_events`, `care_plans`, `care_plan_signature_events`, `pof_medications`, `mar_schedules`, `mar_administrations`
   - Expected canonical write path: UI -> Server Action -> Service Layer -> Supabase

   Required approach:
   1. Inspect current migrations and add any missing parent-side composite unique constraints first.
   2. Add one forward-only Supabase migration with preflight SQL that surfaces existing lineage mismatches before constraints apply.
   3. Add composite FKs so each child row proves it belongs to the same canonical member as its parent.
   4. Preserve current shared service boundaries and do not add runtime fallbacks.
   5. Fail explicitly if existing data violates the new constraints.
   6. Report cleanup requirements and downstream workflows affected.

2. Fix this Memory Lane issue with the smallest production-safe change.

   Issue:
   Signed intake still returns durable signature truth before draft POF creation and intake PDF persistence are guaranteed complete.

   Scope:
   - Domain/workflow: intake signature -> draft POF creation -> member-file artifact persistence
   - Canonical entities/tables: `intake_assessments`, `intake_assessment_signatures`, `intake_post_sign_follow_up_queue`, `physician_orders`, `member_files`
   - Expected canonical write path: UI -> Server Action -> Service Layer -> Supabase

   Required approach:
   1. Inspect `app/intake-actions.ts`, `lib/services/intake-pof-mhp-cascade.ts`, and the intake post-sign queue flow.
   2. Preserve the current explicit queue/failure model.
   3. Add one canonical readiness contract that treats intake as operationally complete only when signature, draft POF, and required artifact persistence are all converged.
   4. Update any remaining downstream readers that still over-trust raw signed state.
   5. Keep all failure states auditable and explicit.

3. Fix this Memory Lane issue with the smallest production-safe change.

   Issue:
   Signed POFs can still exist while clinical sync is queued, so downstream MHP, medication, and MAR data can lag behind legal signature completion.

   Scope:
   - Domain/workflow: POF signature -> MHP sync -> medication sync -> MAR schedule generation
   - Canonical entities/tables: `physician_orders`, `pof_post_sign_sync_queue`, `member_health_profiles`, `pof_medications`, `mar_schedules`
   - Expected canonical write path: UI -> Server Action -> Service Layer -> Supabase

   Required approach:
   1. Inspect `lib/services/pof-post-sign-runtime.ts`, `lib/services/physician-orders-read.ts`, and the queue retry runtime.
   2. Preserve the queue-backed retry path.
   3. Add or standardize one canonical "clinically synced" resolver contract that all downstream readers use instead of raw signed status.
   4. Confirm alerts and operator follow-up paths remain explicit when sync is queued or failed.
   5. Do not duplicate this logic in UI pages.

## 7. Founder Summary

The core referential chain is still in decent shape at the obvious parent/child level: the schema blocks the classic orphans you called out, and the main duplicate classes are still guarded.

Today’s strongest improvement is that enrollment packet submission now returns downstream readiness instead of plain success. That removes one misleading success path from the last run.

The main remaining production risk is cross-member drift inside child tables that carry both `member_id` and another parent key but only enforce them separately. In plain English: the database is good at proving "this parent exists" but still not good enough at proving "this parent belongs to the same member." The other remaining risk is intentional asynchronous follow-up after intake signing, enrollment filing, and POF signing. Those flows are safer than before because shared readiness/status resolvers now expose partial completion, but they still depend on every consumer honoring those resolvers instead of raw upstream statuses.

Next safe action: harden composite member-lineage FKs first, then standardize any remaining downstream readers on the existing intake, enrollment, and POF readiness/status resolvers.
