# Referential Integrity & Cascade Audit

Date: 2026-04-04
Scope: static repo audit against Supabase migrations and canonical services for leads -> enrollment packets -> members -> intake assessments -> physician orders (POF) -> member health profiles -> care plans -> medications -> MAR
Limit: no live Supabase row access was available in this run, so orphan and duplicate findings are limited to schema guarantees, canonical services, and committed runtime/readiness logic rather than current production row counts.

## 1. Orphan Records Detected

None detected in the current static schema/runtime audit for the direct canonical relationships in scope.

Confirmed schema-backed lineage remains in place for:
- enrollment packet child rows through composite packet/member constraints in `supabase/migrations/0140_enrollment_packet_lineage_enforcement.sql`
- intake signature and follow-up queue lineage through composite assessment/member constraints in `supabase/migrations/0127_clinical_lineage_enforcement.sql`
- POF medication lineage through composite physician-order/member constraints in `supabase/migrations/0127_clinical_lineage_enforcement.sql`
- MAR schedule and administration lineage through composite medication/member and schedule/medication/member constraints in `supabase/migrations/0127_clinical_lineage_enforcement.sql`
- care plan diagnosis lineage through composite care-plan/member and diagnosis/member constraints in `supabase/migrations/0085_care_plan_diagnosis_relation.sql`

Static note:
- because no live production rows were inspected, this run cannot prove that historical orphaned records do not already exist outside the canonical write paths

## 2. Missing Lifecycle Cascades

1. Enrollment packet completion is still intentionally staged and does not mean downstream readiness is finished.
Evidence:
- `supabase/migrations/0180_enrollment_completion_follow_up_state.sql` formalizes `completion_follow_up_status`
- `supabase/migrations/0152_enrollment_packet_lifecycle_and_voiding.sql` still finalizes packets with `mapping_sync_status = 'pending'`
- `lib/services/enrollment-packet-readiness.ts` only treats the packet as operationally ready when mapping sync reaches `completed`
Impact:
- a packet can be `completed` while downstream mapping/follow-up is still pending or failed

2. Intake signature is still intentionally staged and does not guarantee draft POF and member-file follow-up are complete.
Evidence:
- `lib/services/intake-post-sign-readiness.ts` returns `signed_pending_draft_pof`, `signed_pending_draft_pof_readback`, or `signed_pending_member_file_pdf` until follow-up converges
Impact:
- a signed intake can still need downstream work before the clinical chain is truly ready

3. POF signature is still intentionally staged and does not guarantee MHP/MCC and MAR convergence.
Evidence:
- `lib/services/physician-order-clinical-sync.ts` explicitly treats signed orders as `queued` or `failed` until downstream sync completes
- `lib/services/physician-orders-supabase.ts` and `lib/services/pof-post-sign-runtime.ts` surface `postSignStatus: "queued" | "synced"`
Impact:
- a POF can be signed while MHP sync, MCC sync, or MAR generation is still queued or retrying

4. Canonical member shells remain explicit repair work, not read-time self-healing.
Evidence:
- `lib/services/member-command-center-runtime.ts` throws when canonical `member_command_centers` or `member_attendance_schedules` rows are missing
- lead conversion and enrollment mapping migrations backfill shells, but reads no longer repair drift silently
Impact:
- historical drift still blocks downstream visibility until explicit repair is run

## 3. Duplicate Canonical Records

None newly exposed in the current static audit.

Confirmed uniqueness and duplicate-prevention guards still in place:
- one member per lead via `supabase/migrations/0049_workflow_hardening_constraints.sql`
- one active enrollment packet per member and one active lead-scoped packet per lead via `supabase/migrations/0152_enrollment_packet_lifecycle_and_voiding.sql`
- one MHP per member via `supabase/migrations/0006_intake_pof_mhp_supabase.sql`
- one care-plan root per member/track via `supabase/migrations/0049_workflow_hardening_constraints.sql`
- one active POF request per physician order and one draft/sent order per intake via `supabase/migrations/0038_acid_uniqueness_guards.sql`
- scheduled MAR administration replay safety via `supabase/migrations/0121_document_scheduled_mar_administration_rpc.sql`

April 4 improvement:
- `supabase/migrations/0181_physician_order_save_rpc_atomicity.sql` now locks member and intake rows, rejects cross-member mismatches in the canonical RPC path, and resolves unique-race retries more cleanly for draft/sent physician orders

Static note:
- without live row inspection, this run cannot prove whether old production duplicates already exist outside the guarded canonical write paths

## 4. Lifecycle State Violations

1. Raw terminal states are still not sufficient readiness truth on their own.
- enrollment packet `completed` still requires `mapping_sync_status = completed` before it is operationally ready
- intake `signed` still requires post-sign draft-POF and member-file follow-up convergence
- POF `signed` still requires downstream MHP/MCC and MAR sync convergence

2. POF signed without downstream MHP sync is still representable by design.
Evidence:
- `lib/services/physician-order-clinical-sync.ts` labels this as `queued` or `failed`, not `synced`
Assessment:
- this is not silent corruption, but it is a lifecycle state that must not be mistaken for operational readiness

3. Enrollment packet completed without member creation was not detected as a canonical schema/runtime violation in the current design.
Evidence:
- `enrollment_packet_requests.member_id` is part of the canonical workflow contract, and lead conversion/member shell creation is expected upstream before packet completion
Assessment:
- the real remaining risk is downstream mapping/readiness lag after completion, not packet completion without any canonical member shell

4. Care plan and MAR state enforcement still look strong on canonical paths.
Evidence:
- `supabase/migrations/0085_care_plan_diagnosis_relation.sql`
- `supabase/migrations/0111_care_plan_caregiver_status_compare_and_set.sql`
- `supabase/migrations/0118_care_plan_caregiver_status_terminality_hardening.sql`
- `lib/services/mar-workflow.ts` rejects missing schedules, inactive schedules, missing medications, inactive medications, and missing scheduled-dose configuration

## 5. Missing Constraints

1. `members.latest_assessment_id` still references only `intake_assessments.id`, not `(id, member_id)` lineage.
Evidence:
- `supabase/migrations/0011_member_command_center_aux_schema.sql:6`
Risk:
- a member row can point at another member's assessment if a non-canonical write drifts

2. `member_command_centers.source_assessment_id` still references only `intake_assessments.id`, not `(id, member_id)` lineage.
Evidence:
- `supabase/migrations/0011_member_command_center_aux_schema.sql:53`
Risk:
- MCC can point at another member's assessment

3. `member_health_profiles.source_assessment_id` still references only `intake_assessments.id`, not `(id, member_id)` lineage.
Evidence:
- `supabase/migrations/0016_member_health_profile_flat_fields.sql:65`
Risk:
- MHP can carry the wrong source assessment across members

4. `member_health_profiles.active_physician_order_id` still references only `physician_orders.id`, not `(id, member_id)` lineage.
Evidence:
- `supabase/migrations/0006_intake_pof_mhp_supabase.sql:135`
Risk:
- MHP can point at another member's physician order

5. `physician_orders.intake_assessment_id` still references only `intake_assessments.id`, not `(id, member_id)` lineage.
Evidence:
- `supabase/migrations/0006_intake_pof_mhp_supabase.sql:83`
- `supabase/migrations/0181_physician_order_save_rpc_atomicity.sql` adds service-layer mismatch checks, but not a DB composite FK
Risk:
- a non-canonical write can attach a physician order to another member's intake assessment while still satisfying the simple FK

6. `pof_post_sign_sync_queue(physician_order_id, member_id)` is still not composite-linked back to `physician_orders(id, member_id)`.
Evidence:
- `supabase/migrations/0037_shared_rpc_standardization_lead_pof.sql`
Risk:
- queue rows can carry mismatched member/order lineage and rely on app discipline to stay clean

7. `pof_requests(physician_order_id, member_id)` is still not composite-linked back to `physician_orders(id, member_id)`.
Evidence:
- `supabase/migrations/0019_pof_esign_workflow.sql`
Risk:
- request rows can drift into cross-member linkage if a non-canonical write appears

8. `document_events(document_id, member_id)` is still not composite-linked back to `pof_requests(id, member_id)`.
Evidence:
- `supabase/migrations/0019_pof_esign_workflow.sql`
Risk:
- document event history can record a valid request id and a valid member id that do not belong to the same request

9. `care_plan_signature_events(care_plan_id, member_id)` is still not composite-linked back to `care_plans(id, member_id)`.
Evidence:
- `supabase/migrations/0020_care_plan_canonical_esign.sql`
Risk:
- care-plan signature history can record a valid plan id and a valid member id that do not belong to the same plan

10. `supabase/migrations/0175_fk_covering_indexes_hardening.sql` improves lookup/index coverage around these tables, but it does not close the remaining lineage gaps.
Risk:
- query performance is better, but cross-member drift is still prevented mainly by application discipline in the unresolved areas above

## 6. Suggested Fix Prompts

### Prompt 1. Add composite lineage FKs for assessment and physician-order snapshot columns

Add a forward-only Supabase migration that hardens the remaining cross-member snapshot lineage gaps on:
- `members.latest_assessment_id`
- `member_command_centers.source_assessment_id`
- `member_health_profiles.source_assessment_id`
- `member_health_profiles.active_physician_order_id`
- `physician_orders.intake_assessment_id`

Requirements:
- preflight for mismatched rows and repair or null them deterministically before adding constraints
- add composite foreign keys so the referenced assessment/order must belong to the same member:
  - `(latest_assessment_id, id)` -> `intake_assessments(id, member_id)`
  - `(source_assessment_id, member_id)` -> `intake_assessments(id, member_id)`
  - `(intake_assessment_id, member_id)` -> `intake_assessments(id, member_id)`
  - `(active_physician_order_id, member_id)` -> `physician_orders(id, member_id)`
- add supporting uniqueness only where required for FK shape
- validate the constraints after cleanup
- keep the fix migration-backed; do not rely on RPC/service guards as a substitute

Manual retest:
- try to save member, MCC, MHP, and physician-order rows that point at another member's assessment or physician order and confirm Postgres rejects them

### Prompt 2. Harden POF queue, request, and document-event lineage

Add a forward-only migration that enforces canonical member/order lineage on:
- `pof_post_sign_sync_queue`
- `pof_requests`
- `document_events`

Requirements:
- preflight rows where `member_id` does not match canonical physician-order or request lineage
- repair safe rows deterministically from canonical parent records where possible
- add composite foreign keys:
  - `pof_post_sign_sync_queue(physician_order_id, member_id)` -> `physician_orders(id, member_id)`
  - `pof_requests(physician_order_id, member_id)` -> `physician_orders(id, member_id)`
  - `document_events(document_id, member_id)` -> `pof_requests(id, member_id)`
- preserve retry-safe queue semantics and existing request replay protections

Manual retest:
- attempt to insert queue/request/event rows with mismatched parent/member pairs and confirm the writes fail

### Prompt 3. Harden care-plan signature event lineage

Add a forward-only migration that enforces same-member lineage on `care_plan_signature_events`.

Requirements:
- preflight rows where `member_id` does not match the plan's `member_id`
- repair safe rows from the canonical care plan when possible
- add any required supporting unique constraint on `care_plans(id, member_id)`
- add composite FK:
  - `care_plan_signature_events(care_plan_id, member_id)` -> `care_plans(id, member_id)`
- validate the constraint after cleanup

Manual retest:
- attempt to insert a care-plan signature event with the wrong member id for a valid plan and confirm Postgres rejects it

### Prompt 4. Keep enrollment, intake, and POF readiness truthful in shared readers

Audit all shared read paths and screens that report lifecycle completion for enrollment packets, intake assessments, and physician orders. Replace any raw-status-only truth with canonical readiness helpers.

Requirements:
- enrollment packet readers must use `resolveEnrollmentPacketOperationalReadiness`
- intake readers must use `resolveIntakePostSignReadiness`
- POF readers must treat signed orders as not operationally ready until clinical sync resolves to `synced`
- keep the logic in shared read/service layers, not per-screen duplication
- add regression coverage that prevents drift back to raw terminal-state checks

Manual retest:
- force mapping or post-sign follow-up failure and confirm UI/reporting stays truthful about pending downstream work

### Prompt 5. Run explicit historical drift repair before enforcing new lineage constraints

Run the existing historical drift repair workflow in dry-run mode, then capture any rows that still cannot be repaired safely before adding new FK hardening.

Requirements:
- use the explicit repair tooling already present in the repo
- record missing `member_command_centers`, missing `member_attendance_schedules`, and any rows with mismatched assessment/order lineage
- do not restore read-time self-healing
- output concrete member ids or record ids for any rows that need manual remediation

Manual retest:
- after repair, confirm missing-shell reads fail only for unrepaired rows and no longer silently create shells

## 7. Founder Summary

The system still looks structurally safer than the older audit runs. The direct child-table lineage that would cause obvious clinical corruption remains well protected: intake follow-up rows, POF medications, MAR schedules and administrations, care-plan diagnoses, and enrollment packet child rows all still have real database-backed lineage enforcement.

The remaining problem is narrower and more architectural. A small set of snapshot and sidecar tables still allow cross-member drift because they only prove the parent `id`, not that the parent belongs to the same member. Today’s new point is that this also still applies to `physician_orders.intake_assessment_id`: the April 4 RPC hardening checks the member match in the canonical write path, but Postgres still will not stop a bad non-canonical write by itself.

Production impact:
- low immediate evidence of new regressions in canonical paths
- medium residual risk from unresolved composite-FK gaps if any side-channel or future bug bypasses the canonical RPC/service layer
- workflow truth is safer than before, but operators still must rely on readiness helpers rather than raw `completed` or `signed` states

Safest next action:
- add the remaining composite lineage foreign keys, especially `physician_orders.intake_assessment_id`
- then run the explicit historical drift repair in dry-run mode against a real environment before enforcing the new constraints in production
