# Referential Integrity & Cascade Audit

Date: 2026-03-30
Scope: static repo audit against Supabase migrations and canonical services for leads -> enrollment packets -> members -> intake assessments -> physician orders (POF) -> member health profiles -> care plans -> medications -> MAR
Limit: no live Supabase data was available in this run, so orphan/duplicate findings are limited to schema and canonical runtime guarantees rather than current production row counts.

## 1. Orphan Records Detected

None detected in the current static schema/runtime audit for the core direct relationships.

Confirmed hardening still exists for:
- intake -> member and intake child lineage via composite uniqueness/FKs: `supabase/migrations/0127_clinical_lineage_enforcement.sql`
- POF -> member and POF-medication lineage via composite uniqueness/FKs: `supabase/migrations/0127_clinical_lineage_enforcement.sql`
- MAR schedule/administration -> medication/member lineage via composite uniqueness/FKs: `supabase/migrations/0127_clinical_lineage_enforcement.sql`
- care plan -> diagnosis/member lineage via composite uniqueness/FKs: `supabase/migrations/0085_care_plan_diagnosis_relation.sql`
- enrollment packet child tables -> packet/member lineage via composite uniqueness/FKs: `supabase/migrations/0140_enrollment_packet_lineage_enforcement.sql`

Examples covered by current schema hardening:
- intake referencing nonexistent member
- MAR referencing nonexistent medication
- care plan referencing nonexistent diagnosis
- enrollment packet child records referencing nonexistent packet/member pairs

## 2. Missing Lifecycle Cascades

1. POF signed can still exist before downstream MHP/MCC/MAR sync is fully complete.
Evidence:
- `pof_post_sign_sync_queue` remains the follow-up queue after signature finalization: `supabase/migrations/0037_shared_rpc_standardization_lead_pof.sql`
- public/runtime truth explicitly distinguishes `postSignStatus: "queued"` from `"synced"` and warns staff not to treat queued work as fully synced: `lib/services/pof-post-sign-runtime.ts`
Risk:
- any reader that treats raw `physician_orders.status = 'signed'` or `pof_requests.status = 'signed'` as final completion can overstate downstream clinical readiness.

2. Enrollment packet completed can still exist before downstream mapping/member handoff is operationally ready.
Evidence:
- readiness helper maps completed/filed status plus `mapping_sync_status` into `filed_pending_mapping`, `mapping_failed`, or `operationally_ready`: `lib/services/enrollment-packet-readiness.ts`
- lifecycle/status hardening enforces status metadata, but not "completed means mapping finished": `supabase/migrations/0152_enrollment_packet_lifecycle_and_voiding.sql`, `supabase/migrations/0162_enrollment_packet_status_coupled_constraints.sql`
Risk:
- enrollment packet completed without member creation is reduced on canonical RPC paths, but raw packet status alone is still not sufficient proof that downstream mapping completed.

3. Intake signed can still exist before all post-sign follow-up work is complete.
Evidence:
- readiness helper distinguishes `signed_pending_draft_pof`, `signed_pending_draft_pof_readback`, `draft_pof_failed`, and `signed_pending_member_file_pdf`: `lib/services/intake-post-sign-readiness.ts`
- workflow hardening tracks `draft_pof_status`, but signed intake is not equivalent to fully ready intake: `supabase/migrations/0049_workflow_hardening_constraints.sql`
Risk:
- any consumer that keys off `signature_status = 'signed'` alone can mark intake as complete while draft POF or member-file persistence is still pending.

4. Lead/member conversion shell cascade remains dependent on staying on the canonical RPC boundary.
Evidence:
- duplicate member-per-lead prevention exists: `supabase/migrations/0049_workflow_hardening_constraints.sql`
- prior hardening/backfill work continues to rely on canonical conversion/mapping paths to create member shell/MCC/MHP context.
Risk:
- if a non-canonical conversion path reappears, enrollment packet completion could again diverge from member shell creation even though the current migration set materially reduced that risk.

## 3. Duplicate Canonical Records

None newly exposed in the current static audit.

Confirmed uniqueness guards:
- one member per lead: `supabase/migrations/0049_workflow_hardening_constraints.sql`
- one active enrollment packet per member and one active lead-scoped packet per lead: `supabase/migrations/0152_enrollment_packet_lifecycle_and_voiding.sql`
- one care-plan root per member/track: `supabase/migrations/0049_workflow_hardening_constraints.sql`
- one active signed POF per member and one POF version per member/version: `supabase/migrations/0006_intake_pof_mhp_supabase.sql`
- one MHP per member: `supabase/migrations/0006_intake_pof_mhp_supabase.sql`
- one MAR schedule lineage row per schedule/medication/member chain and one administration row per idempotent schedule path: `supabase/migrations/0127_clinical_lineage_enforcement.sql`, `supabase/migrations/0107_prn_medication_orders_and_logs.sql`

## 4. Lifecycle State Violations

1. Raw terminal states are still not sufficient truth by themselves.
This is a residual state-truth risk, not a broken canonical write path.

- POF:
  `signed` can still mean signature committed while post-sign sync remains queued.
- Enrollment packet:
  `completed` can still mean mapping is pending or failed unless `mapping_sync_status` is also checked.
- Intake:
  `signed` can still mean follow-up work remains open.

2. Care plan caregiver signature transition enforcement appears strong.
Evidence:
- caregiver signature finalization only allows transition from `sent` or `viewed`, and rejects already-signed rows: `supabase/migrations/0044_atomic_billing_and_completion_finalization.sql`
- post-sign readiness status is explicit and constrained: `supabase/migrations/0112_care_plan_post_sign_readiness.sql`
Status:
- no new care-plan state violation was exposed in this run.

3. MAR administration against inactive/non-center/non-scheduled medications is explicitly blocked in the service layer.
Evidence:
- scheduled MAR documentation rejects inactive schedules and non-active/non-center/non-scheduled linked medications before the RPC write: `lib/services/mar-workflow.ts`
Status:
- no new "MAR entry recorded for inactive medication" gap was exposed in the current canonical service path.

## 5. Missing Foreign Key Constraints

1. `members.latest_assessment_id` points only to `intake_assessments.id`, not `(assessment_id, member_id)` lineage.
Evidence:
- `supabase/migrations/0011_member_command_center_aux_schema.sql`
Risk:
- a member can point at another member's intake assessment if application logic drifts.

2. `member_command_centers.source_assessment_id` points only to `intake_assessments.id`, not `(assessment_id, member_id)` lineage.
Evidence:
- `supabase/migrations/0011_member_command_center_aux_schema.sql`
Risk:
- MCC can carry an assessment reference that belongs to a different member.

3. `member_health_profiles.source_assessment_id` points only to `intake_assessments.id`, not `(assessment_id, member_id)` lineage.
Evidence:
- `supabase/migrations/0016_member_health_profile_flat_fields.sql`
Risk:
- MHP can carry the wrong source assessment across members.

4. `member_health_profiles.active_physician_order_id` points only to `physician_orders.id`, not `(pof_id, member_id)` lineage.
Evidence:
- `supabase/migrations/0006_intake_pof_mhp_supabase.sql`
Risk:
- MHP can reference a physician order belonging to another member.

5. `pof_post_sign_sync_queue` stores `physician_order_id` and `member_id` with only simple foreign keys.
Evidence:
- `supabase/migrations/0037_shared_rpc_standardization_lead_pof.sql`
Risk:
- queued post-sign sync work can carry a mismatched member/order pair even though the main clinical tables are composite-lineage hardened.

6. `pof_requests` stores `physician_order_id` and `member_id` with only simple foreign keys.
Evidence:
- `supabase/migrations/0019_pof_esign_workflow.sql`
Risk:
- signature requests can drift into cross-member linkage if a non-canonical write path ever appears.

## 6. Suggested Fix Prompts

### Prompt 1. Add composite lineage FKs for assessment/order snapshot columns

Add a forward-only Supabase migration that hardens the remaining cross-member lineage gaps in the member snapshot columns.

Scope:
- `members.latest_assessment_id`
- `member_command_centers.source_assessment_id`
- `member_health_profiles.source_assessment_id`
- `member_health_profiles.active_physician_order_id`

Requirements:
- preflight for mismatched rows and repair or null them out before adding constraints
- add composite foreign keys so the referenced assessment/order must belong to the same member:
  - `(latest_assessment_id, id)` -> `intake_assessments(id, member_id)`
  - `(source_assessment_id, member_id)` -> `intake_assessments(id, member_id)`
  - `(active_physician_order_id, member_id)` -> `physician_orders(id, member_id)`
- add supporting unique constraints only if required by FK shape
- validate constraints after cleanup
- do not rely on UI guards as a substitute for DB enforcement

Manual retest:
- try to save a member/MCC/MHP row pointing at another member's assessment or physician order and confirm Postgres rejects it

### Prompt 2. Harden sidecar POF queue/request lineage

Add a forward-only migration that enforces canonical member/order lineage on `pof_post_sign_sync_queue` and `pof_requests`.

Requirements:
- preflight rows where `member_id` does not match `physician_orders.member_id`
- repair safe rows deterministically from the canonical physician order when possible
- add composite foreign keys:
  - `pof_post_sign_sync_queue(physician_order_id, member_id)` -> `physician_orders(id, member_id)`
  - `pof_requests(physician_order_id, member_id)` -> `physician_orders(id, member_id)`
- keep existing replay-safe/idempotent behavior intact

Manual retest:
- attempt to insert a queue/request row with a mismatched member/order pair and confirm the write fails

### Prompt 3. Remove raw-status truth drift from enrollment, intake, and POF readers

Audit all read paths that report enrollment packet, intake, and POF completion, and replace any raw-status-only completion logic with canonical readiness truth.

Requirements:
- enrollment packet readers must use `resolveEnrollmentPacketOperationalReadiness` or equivalent shared truth instead of treating raw `completed` as operationally done
- intake readers must use `resolveIntakePostSignReadiness` instead of signature state alone
- POF readers must expose post-sign sync truth and not treat raw `signed` as fully synced unless queue/read-model truth confirms sync completion
- keep this logic centralized in shared read/service layers rather than duplicating it in pages/components
- add regression coverage so consumers cannot silently regress back to raw terminal-state checks

Manual retest:
- force mapping or post-sign sync follow-up failure and confirm the UI/reporting remains truthful about pending downstream work

## 7. Founder Summary

The repo still looks materially stronger than the earlier audit runs. The core direct lineage chain for enrollment packet children, intake children, POF medications, MAR schedules, MAR administrations, and care plan diagnosis links is now protected by concrete database constraints instead of mostly trusting application code.

The remaining risk is narrower and more operationally subtle. A few member snapshot columns and POF sidecar tables still allow cross-member drift because they only use simple foreign keys, and several workflows still have a gap between "signature/status committed" and "all downstream work is really done." That means the main production risk is false completion truth, not obvious missing parent-child wiring in the core child tables.

Safest next action:
- add the remaining composite lineage foreign keys for member snapshot columns and POF sidecar tables
- then do a focused reader audit so no screen, report, or downstream workflow treats raw `signed` or `completed` status as full completion truth without the readiness helpers
