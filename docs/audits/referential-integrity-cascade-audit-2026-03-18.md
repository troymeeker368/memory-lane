# Referential Integrity & Cascade Audit

Date: 2026-03-18
Scope: leads -> enrollment packets -> members -> intake assessments -> physician orders (POF) -> member health profiles -> care plans -> medications -> MAR records
Method: static repo audit of Supabase migrations, shared services, RPC boundaries, and lifecycle code paths. Live Supabase row inspection was not available in this run, so row-level orphan and duplicate confirmation in the deployed database remains blocked.

## 1. Orphan Records Detected

None in the repo-defined schema for the audited core relationships.

Current migrations still enforce the main parent-child links for:

- `members.source_lead_id -> leads.id` in [`/D:/Memory Lane App/supabase/migrations/0007_sales_backend_alignment.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0007_sales_backend_alignment.sql)
- `enrollment_packet_requests.member_id -> members.id` and `enrollment_packet_requests.lead_id -> leads.id` in [`/D:/Memory Lane App/supabase/migrations/0024_enrollment_packet_workflow.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0024_enrollment_packet_workflow.sql)
- `intake_assessments.member_id -> members.id` and `intake_assessments.lead_id -> leads.id` in [`/D:/Memory Lane App/supabase/migrations/0006_intake_pof_mhp_supabase.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0006_intake_pof_mhp_supabase.sql)
- `physician_orders.member_id -> members.id` and `physician_orders.intake_assessment_id -> intake_assessments.id` in [`/D:/Memory Lane App/supabase/migrations/0006_intake_pof_mhp_supabase.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0006_intake_pof_mhp_supabase.sql)
- `member_health_profiles.member_id -> members.id` and `member_health_profiles.active_physician_order_id -> physician_orders.id` in [`/D:/Memory Lane App/supabase/migrations/0006_intake_pof_mhp_supabase.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0006_intake_pof_mhp_supabase.sql)
- `member_command_centers.member_id -> members.id` in [`/D:/Memory Lane App/supabase/migrations/0011_member_command_center_aux_schema.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0011_member_command_center_aux_schema.sql)
- `care_plans.member_id -> members.id` in [`/D:/Memory Lane App/supabase/migrations/0013_care_plans_and_billing_execution.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0013_care_plans_and_billing_execution.sql)
- `member_diagnoses.member_id -> members.id` and `member_medications.member_id -> members.id` in [`/D:/Memory Lane App/supabase/migrations/0012_legacy_operational_health_alignment.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0012_legacy_operational_health_alignment.sql)
- `pof_medications.physician_order_id -> physician_orders.id`, `mar_schedules.pof_medication_id -> pof_medications.id`, and `mar_administrations.pof_medication_id -> pof_medications.id` in [`/D:/Memory Lane App/supabase/migrations/0028_pof_seeded_mar_workflow.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0028_pof_seeded_mar_workflow.sql)

Examples requested by this audit that are schema-protected in the repo:

- Intake referencing nonexistent member: blocked by `intake_assessments.member_id` FK
- MAR referencing nonexistent medication: blocked by `mar_administrations.pof_medication_id` FK
- Enrollment packet completed without member creation: blocked structurally because `enrollment_packet_requests.member_id` is `not null` and FK-backed

Live orphan-row detection in the actual database is still blocked without direct Supabase access.

## 2. Missing Lifecycle Cascades

1. Signed intake can still exist without a created draft POF.
   Evidence: [`/D:/Memory Lane App/app/intake-actions.ts`](/D:/Memory%20Lane%20App/app/intake-actions.ts) finalizes the intake signature first, then separately calls draft POF creation. The split state remains explicitly modeled by `draft_pof_status` in [`/D:/Memory Lane App/supabase/migrations/0049_workflow_hardening_constraints.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0049_workflow_hardening_constraints.sql) and the RPC in [`/D:/Memory Lane App/supabase/migrations/0055_intake_draft_pof_atomic_creation.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0055_intake_draft_pof_atomic_creation.sql).
   Impact: a clinically signed intake can still be left in `draft_pof_status = 'pending'` or `'failed'` until a retry succeeds.

2. Filed enrollment packet does not guarantee downstream mapping is complete.
   Evidence: the finalization RPC persists `status = 'filed'` together with `mapping_sync_status = 'pending'` in [`/D:/Memory Lane App/supabase/migrations/0053_artifact_drift_replay_hardening.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0053_artifact_drift_replay_hardening.sql), while the shared service runs downstream mapping afterward in [`/D:/Memory Lane App/lib/services/enrollment-packets.ts`](/D:/Memory%20Lane%20App/lib/services/enrollment-packets.ts).
   Impact: packet completion can succeed while MCC, MHP, and related downstream packet mapping is still pending or failed.

3. Signed POF does not guarantee downstream MHP, MCC, medication, and MAR sync completed in the same step.
   Evidence: the post-sign queue still allows `status = 'queued'` in [`/D:/Memory Lane App/supabase/migrations/0037_shared_rpc_standardization_lead_pof.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0037_shared_rpc_standardization_lead_pof.sql), and the service still returns queued retry state from [`/D:/Memory Lane App/lib/services/physician-orders-supabase.ts`](/D:/Memory%20Lane%20App/lib/services/physician-orders-supabase.ts). Migrations [`/D:/Memory Lane App/supabase/migrations/0083_fix_signed_pof_clinical_sync_rpc_ambiguity.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0083_fix_signed_pof_clinical_sync_rpc_ambiguity.sql) and [`/D:/Memory Lane App/supabase/migrations/0084_fix_signed_pof_clinical_sync_rpc_conflict_targets.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0084_fix_signed_pof_clinical_sync_rpc_conflict_targets.sql) remove upsert ambiguity, but they do not change this queued-after-sign lifecycle model.
   Impact: a legally signed POF can still exist before its downstream clinical surfaces have converged.

## 3. Duplicate Canonical Records

None in the current repo-defined schema for the audited canonical duplicate classes.

The main duplicate guards from the prior audit are still present in [`/D:/Memory Lane App/supabase/migrations/0049_workflow_hardening_constraints.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0049_workflow_hardening_constraints.sql):

- one canonical member per lead via unique index on `members.source_lead_id`
- one active enrollment packet per member via unique partial index on `enrollment_packet_requests(member_id)`
- one care-plan root per member and track via unique index on `care_plans(member_id, track)`
- one `pof_medications` row per order/source medication and one `mar_schedules` row per member/medication/time in [`/D:/Memory Lane App/supabase/migrations/0028_pof_seeded_mar_workflow.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0028_pof_seeded_mar_workflow.sql)

Live duplicate-row detection in the deployed database is still blocked without direct Supabase access.

## 4. Lifecycle State Violations

1. `intake_assessments.signature_status = 'signed'` can still coexist with `draft_pof_status = 'pending'` or `'failed'`.
   Evidence: intake e-sign finalization and draft POF creation are still separate operations in [`/D:/Memory Lane App/app/intake-actions.ts`](/D:/Memory%20Lane%20App/app/intake-actions.ts).
   Risk: downstream readers can falsely interpret signed intake as clinically handoff-ready.

2. `enrollment_packet_requests.status = 'filed'` can still coexist with `mapping_sync_status = 'pending'` or `'failed'`.
   Evidence: the filing RPC intentionally persists that combination in [`/D:/Memory Lane App/supabase/migrations/0053_artifact_drift_replay_hardening.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0053_artifact_drift_replay_hardening.sql).
   Risk: `filed` sounds terminal, but downstream operational hydration may still be incomplete.

3. `physician_orders.status = 'signed'` can still coexist with `pof_post_sign_sync_queue.status = 'queued'`.
   Evidence: the post-sign sync service still marks failed downstream sync attempts back to queued retry state in [`/D:/Memory Lane App/lib/services/physician-orders-supabase.ts`](/D:/Memory%20Lane%20App/lib/services/physician-orders-supabase.ts).
   Risk: dashboards or services that treat raw POF signed status as "fully synced" can show false-ready clinical state.

4. Care plan diagnosis truth is still not enforceable because diagnosis linkage is not canonically modeled.
   Evidence: `care_plans` only links to `members` in [`/D:/Memory Lane App/supabase/migrations/0013_care_plans_and_billing_execution.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0013_care_plans_and_billing_execution.sql), while diagnoses live independently in [`/D:/Memory Lane App/supabase/migrations/0012_legacy_operational_health_alignment.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0012_legacy_operational_health_alignment.sql).
   Risk: the system cannot prove whether a care plan references a real current diagnosis row.

## 5. Missing Foreign Key Constraints

1. Missing canonical care plan -> diagnosis relation.
   Evidence: no `care_plan_diagnoses` join table exists in current migrations, and no care-plan schema object references `member_diagnoses`.
   Expected constraint: `care_plan_diagnoses.care_plan_id -> care_plans.id` and `care_plan_diagnoses.member_diagnosis_id -> member_diagnoses.id`.
   Risk if left unenforced: diagnosis references stay unauditable, stale, and impossible to FK-validate.

## 6. Suggested Fix Prompts

1. Create a production-safe fix that closes the signed-intake to draft-POF split state. Keep Supabase as source of truth. Either move nurse signature finalization plus draft POF creation behind one canonical RPC-backed service boundary, or add a canonical retry/alert worker that guarantees every `intake_assessments.signature_status = 'signed'` record converges to `draft_pof_status = 'created'` or raises a durable operational alert. Preserve current audit events and make downstream readers rely on `draft_pof_status`, not raw signed status.

2. Harden enrollment packet lifecycle semantics so `status = 'filed'` does not overstate completion. Keep the existing filing RPC, but add one canonical readiness contract for "filed and downstream mapped" and update downstream consumers to require `mapping_sync_status = 'completed'` before treating the packet as fully operationalized. Prefer a canonical derived readiness field or resolver over duplicated UI logic.

3. Tighten POF post-sign cascade semantics. Keep the new 0083/0084 RPC ambiguity fixes, but add one canonical clinical-readiness resolver that only returns ready when `physician_orders.status = 'signed'` and the linked `pof_post_sign_sync_queue.status = 'completed'`. Then update MHP, MCC, medication, and MAR readers to use that readiness contract instead of raw signed status.

4. Add a forward-only Supabase migration for a canonical `care_plan_diagnoses` table with foreign keys to `care_plans` and `member_diagnoses`, plus a uniqueness guard on `(care_plan_id, member_diagnosis_id)`. Backfill conservatively, then update canonical care-plan create/review services so diagnosis linkage is written through the service layer and can be audited.

## 7. Founder Summary

The repo’s basic parent-child integrity is still mostly solid. I did not find a new FK regression in the audited lead-to-MAR chain, and the earlier duplicate-canonical-record risks are still covered by database uniqueness guards.

The remaining production risk is still lifecycle truthfulness. Three workflows can still look complete before their downstream cascade has actually finished: signed intake before draft POF exists, filed enrollment packet before mapping finishes, and signed POF before MHP/MAR sync completes. The other structural gap is care plans: diagnosis linkage is still not modeled canonically, so that relationship cannot be audited or FK-enforced yet.

Net: today’s run is stable versus 2026-03-17. The new 0082-0084 migrations remove POF RPC upsert ambiguity, which is good hardening, but they do not close the remaining split-state lifecycle risks.
