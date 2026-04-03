# Referential Integrity & Cascade Audit

Date: 2026-04-03
Scope: static repo audit against Supabase migrations and canonical services for leads -> enrollment packets -> members -> intake assessments -> physician orders (POF) -> member health profiles -> care plans -> medications -> MAR
Limit: no live Supabase data was available in this run, so orphan and duplicate findings are limited to schema guarantees, canonical services, and committed runtime/readiness logic rather than current production row counts.

## 1. Orphan Records Detected

None detected in the current static schema/runtime audit for the direct canonical relationships in scope.

Confirmed schema-backed lineage remains in place for:
- enrollment packet child rows through composite packet/member constraints in `supabase/migrations/0140_enrollment_packet_lineage_enforcement.sql`
- intake signature and follow-up queue lineage through composite assessment/member constraints in `supabase/migrations/0127_clinical_lineage_enforcement.sql`
- POF medication lineage through composite physician-order/member constraints in `supabase/migrations/0127_clinical_lineage_enforcement.sql`
- MAR schedule and administration lineage through composite medication/member and schedule/medication/member constraints in `supabase/migrations/0127_clinical_lineage_enforcement.sql`
- care plan diagnosis lineage through composite care-plan/member and diagnosis/member constraints in `supabase/migrations/0085_care_plan_diagnosis_relation.sql`

Examples still blocked by schema hardening:
- intake referencing nonexistent member
- MAR referencing nonexistent medication
- care plan referencing nonexistent diagnosis
- enrollment packet child rows referencing nonexistent packet/member pairs

## 2. Missing Lifecycle Cascades

1. Enrollment packet completed can still exist before downstream mapping or member convergence is fully operationally ready.
Evidence:
- `supabase/migrations/0180_enrollment_completion_follow_up_state.sql` now formalizes `completion_follow_up_status`, which is safer than raw status checks
- `lib/services/enrollment-packet-readiness.ts` and `lib/services/enrollment-packets-public-runtime.ts` still separate committed packet completion from downstream readiness truth
Risk:
- `completed` or `filed` is still not proof that mapping finished cleanly or that downstream member-facing operational shells are fully converged

2. Intake signed can still exist before draft POF and member-file PDF follow-up work is complete.
Evidence:
- `lib/services/intake-post-sign-readiness.ts` still distinguishes pending draft-POF and member-file follow-up states
- `lib/services/intake-post-sign-follow-up.ts` still models this as explicit queued follow-up work
Risk:
- staff or downstream readers using raw signature state can still overstate clinical onboarding readiness

3. POF signed can still exist before downstream MHP, MCC, and MAR sync is complete.
Evidence:
- `lib/services/pof-post-sign-runtime.ts` still emits `postSignStatus: "queued" | "synced"`
- `app/sign/pof/[token]/actions.ts` and physician-order pages now surface that distinction more honestly
- `lib/services/physician-orders-supabase.ts` still queues retry when downstream sync does not fully converge on the first signed transition
Risk:
- a signed physician order can be durably committed while clinical downstream state is not yet fully live

4. Canonical member shells are now explicit drift, not self-healed read-time cascades.
Evidence:
- `lib/services/member-command-center-runtime.ts` throws when canonical `member_command_centers` or `member_attendance_schedules` rows are missing
- explicit repair remains outside the read path
Risk:
- this is safer than silent backfill, but historical drift still blocks downstream lifecycle visibility until repaired

## 3. Duplicate Canonical Records

None newly exposed in the current static audit.

Confirmed uniqueness guards still in place:
- one member per lead via `supabase/migrations/0049_workflow_hardening_constraints.sql`
- one active enrollment packet per member and one active lead-scoped packet per lead via `supabase/migrations/0152_enrollment_packet_lifecycle_and_voiding.sql`
- one MHP per member via `supabase/migrations/0006_intake_pof_mhp_supabase.sql`
- one care-plan root per member/track via `supabase/migrations/0049_workflow_hardening_constraints.sql`
- replay-safe scheduled MAR administration via `supabase/migrations/0121_document_scheduled_mar_administration_rpc.sql`

Static limitation:
- without live row inspection, this run cannot prove whether old production duplicates already exist outside the guarded canonical write paths

## 4. Lifecycle State Violations

1. Raw terminal states are still not sufficient readiness truth on their own.

- Enrollment packet: `completed` or `filed` can still coexist with `mapping_sync_status = pending|failed` and a non-final `completion_follow_up_status`
- Intake: `signed` can still coexist with open draft-POF or member-file follow-up tasks
- POF: `signed` can still coexist with `postSignStatus = queued`

2. Care plan lineage and state enforcement still look strong on canonical paths.
Evidence:
- `supabase/migrations/0111_care_plan_caregiver_status_compare_and_set.sql`
- `supabase/migrations/0118_care_plan_caregiver_status_terminality_hardening.sql`
- `supabase/migrations/0160_care_plan_caregiver_status_rpc_ambiguity_fix.sql`
- `supabase/migrations/0085_care_plan_diagnosis_relation.sql`
Status:
- no new care-plan-specific invalid transition was exposed in this run

3. MAR administration against inactive or invalid scheduled medication still appears blocked in the shared service path.
Evidence:
- `lib/services/mar-workflow.ts` explicitly rejects missing schedules, inactive schedules, missing medications, inactive medications, and missing scheduled-dose configuration
Status:
- no new static state-violation gap was exposed for the canonical MAR documentation path

## 5. Missing Foreign Key Constraints

1. `members.latest_assessment_id` still references only `intake_assessments.id`, not `(id, member_id)` lineage.
Evidence:
- `supabase/migrations/0011_member_command_center_aux_schema.sql:6`
Risk:
- a member record can point at another member's assessment if a non-canonical write path drifts

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

5. `pof_post_sign_sync_queue(physician_order_id, member_id)` is still not composite-linked back to `physician_orders(id, member_id)`.
Evidence:
- `supabase/migrations/0037_shared_rpc_standardization_lead_pof.sql:3`
Risk:
- queue rows can carry mismatched member/order lineage and rely on app discipline to stay clean

6. `pof_requests(physician_order_id, member_id)` is still not composite-linked back to `physician_orders(id, member_id)`.
Evidence:
- `supabase/migrations/0019_pof_esign_workflow.sql:3`
Risk:
- request rows can drift into cross-member linkage if a non-canonical write appears

7. `document_events(document_id, member_id)` is still not composite-linked back to `pof_requests(id, member_id)`.
Evidence:
- `supabase/migrations/0019_pof_esign_workflow.sql:51`
Risk:
- document event history can record a valid request id and a valid member id that do not belong to the same request

8. `care_plan_signature_events(care_plan_id, member_id)` is still not composite-linked back to `care_plans(id, member_id)`.
Evidence:
- `supabase/migrations/0020_care_plan_canonical_esign.sql:58`
Risk:
- care-plan signature history can record a valid plan id and a valid member id that do not belong to the same plan

9. `supabase/migrations/0175_fk_covering_indexes_hardening.sql` improves lookup/index support around these tables, but it does not close the remaining lineage gaps.
Evidence:
- `0175` adds supporting indexes for `care_plan_signature_events`, `document_events`, `pof_post_sign_sync_queue`, `pof_requests`, `member_command_centers.source_assessment_id`, and `members.latest_assessment_id`
Risk:
- query performance is better, but cross-member drift is still prevented mainly by application discipline in the unresolved areas above

## 6. Suggested Fix Prompts

### Prompt 1. Add composite lineage FKs for assessment and physician-order snapshot columns

Add a forward-only Supabase migration that hardens the remaining cross-member snapshot lineage gaps on:
- `members.latest_assessment_id`
- `member_command_centers.source_assessment_id`
- `member_health_profiles.source_assessment_id`
- `member_health_profiles.active_physician_order_id`

Requirements:
- preflight for mismatched rows and repair or null them deterministically before adding constraints
- add composite foreign keys so the referenced assessment/order must belong to the same member:
  - `(latest_assessment_id, id)` -> `intake_assessments(id, member_id)`
  - `(source_assessment_id, member_id)` -> `intake_assessments(id, member_id)`
  - `(active_physician_order_id, member_id)` -> `physician_orders(id, member_id)`
- add supporting uniqueness only where required for FK shape
- validate the constraints after cleanup
- keep the fix migration-backed; do not rely on service guards as a substitute

Manual retest:
- try to save member, MCC, and MHP rows that point at another member's assessment or physician order and confirm Postgres rejects them

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

### Prompt 4. Remove raw-status readiness drift from enrollment, intake, and POF readers

Audit all shared read paths and screens that report lifecycle completion for enrollment packets, intake assessments, and physician orders. Replace any raw-status-only truth with canonical readiness helpers.

Requirements:
- enrollment packet readers must use `resolveEnrollmentPacketOperationalReadiness` or equivalent shared readiness truth
- intake readers must use `resolveIntakePostSignReadiness`
- POF readers must treat `postSignStatus = queued` as not fully operationally ready
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

The system is still materially safer than the older audit runs. The direct clinical child-table lineage that matters most for obvious corruption is still protected: intake child rows, POF medications, MAR schedules and administrations, care plan diagnoses, and enrollment packet child rows all still have real database-backed lineage protections.

The main remaining risk is narrower and more architectural. A small set of snapshot and sidecar tables still allow cross-member drift because they only point at a parent `id` without also proving it belongs to the same member. Separately, the major workflows are more honest now about staged readiness, but they are still staged: a packet can be completed before mapping is fully ready, an intake can be signed before draft POF follow-up finishes, and a POF can be signed before MHP and MAR are fully synced.

Safest next action:
- add the remaining composite lineage foreign keys for the assessment/order snapshot and sidecar tables
- then run the explicit historical drift repair in dry-run mode against a real environment before enforcing the new constraints in production
