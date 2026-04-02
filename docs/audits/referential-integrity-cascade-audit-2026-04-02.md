# Referential Integrity & Cascade Audit

Date: 2026-04-02
Scope: static repo audit against Supabase migrations and canonical services for leads -> enrollment packets -> members -> intake assessments -> physician orders (POF) -> member health profiles -> care plans -> medications -> MAR
Limit: no live Supabase data was available in this run, so orphan/duplicate findings are limited to schema guarantees, canonical services, and committed runtime/readiness logic rather than current production row counts.

## 1. Orphan Records Detected

None detected in the current static schema/runtime audit for the core direct relationships.

Confirmed hardening still exists for:
- enrollment packet child lineage via composite packet/member foreign keys in `supabase/migrations/0140_enrollment_packet_lineage_enforcement.sql`
- intake signature and follow-up queue lineage via composite assessment/member foreign keys in `supabase/migrations/0127_clinical_lineage_enforcement.sql`
- POF medication lineage via composite physician-order/member foreign keys in `supabase/migrations/0127_clinical_lineage_enforcement.sql`
- MAR schedule and administration lineage via composite medication/member and schedule/medication/member foreign keys in `supabase/migrations/0127_clinical_lineage_enforcement.sql`
- care plan diagnosis lineage via composite care-plan/member and diagnosis/member foreign keys in `supabase/migrations/0085_care_plan_diagnosis_relation.sql`

Examples still covered by schema hardening:
- intake referencing nonexistent member
- MAR referencing nonexistent medication
- care plan referencing nonexistent diagnosis
- enrollment packet child rows referencing nonexistent packet/member pairs

## 2. Missing Lifecycle Cascades

1. POF signed can still exist before downstream MHP/MCC/MAR sync is fully complete.
Evidence:
- signed POF post-sign sync still runs through queued follow-up state and explicit outcome truth in `supabase/migrations/0155_signed_pof_post_sign_sync_rpc_consolidation.sql`, `supabase/migrations/0174_pof_post_sign_queue_outcome_rpc.sql`, and `lib/services/pof-post-sign-runtime.ts`
- public/provider follow-up now surfaces the queued-vs-synced distinction more clearly, but it still confirms the cascade is asynchronous rather than same-transaction complete
Risk:
- any consumer that treats raw `physician_orders.status = 'signed'` or raw `pof_requests.status = 'signed'` as full clinical completion can still overstate readiness

2. Enrollment packet completed can still exist before downstream mapping/member handoff is operationally ready.
Evidence:
- packet lifecycle still separates `status` from `mapping_sync_status`, with readiness truth resolved in `lib/services/enrollment-packet-readiness.ts`
- the follow-up queue and mapping runtime remain the second-stage cascade after packet completion
Risk:
- enrollment packet completed without member creation is materially reduced on canonical RPC paths, but raw completed/filed status still is not proof that downstream mapping and member shell convergence finished

3. Intake signed can still exist before draft POF and member-file follow-up work is fully ready.
Evidence:
- post-sign readiness still distinguishes `signed_pending_draft_pof`, `signed_pending_draft_pof_readback`, `draft_pof_failed`, and `signed_pending_member_file_pdf` in `lib/services/intake-post-sign-readiness.ts`
- intake follow-up remains intentionally explicit rather than hidden behind raw signature state
Risk:
- any consumer using `signature_status = 'signed'` alone can still mark the intake as finished before the downstream artifacts are actually ready

4. Member operational shells remain repairable, but missing shells are now treated as explicit drift instead of silent read-time backfill.
Evidence:
- `lib/services/member-command-center-runtime.ts` now throws when canonical `member_command_centers` or `member_attendance_schedules` rows are missing
- `scripts/repair-historical-drift.ts` provides an explicit repair path instead of silently creating shells on reads
Risk:
- this is safer than before because false-success reads were removed, but historical data drift still requires explicit repair work if missing shells exist in real data

## 3. Duplicate Canonical Records

None newly exposed in the current static audit.

Confirmed uniqueness guards still in place:
- one member per lead via `supabase/migrations/0049_workflow_hardening_constraints.sql`
- one active enrollment packet per member / one active lead-scoped packet per lead via `supabase/migrations/0152_enrollment_packet_lifecycle_and_voiding.sql`
- one MHP per member via `supabase/migrations/0006_intake_pof_mhp_supabase.sql`
- one care-plan root per member/track via `supabase/migrations/0049_workflow_hardening_constraints.sql`
- one active signed POF per member and replay-safe POF request protection via `supabase/migrations/0006_intake_pof_mhp_supabase.sql`, `lib/services/pof-esign-core.ts`
- one MAR administration per replay-safe scheduled path via `supabase/migrations/0121_document_scheduled_mar_administration_rpc.sql`

## 4. Lifecycle State Violations

1. Raw terminal states still are not sufficient truth by themselves.

- POF:
  `signed` can still coexist with queued post-sign sync work
- Enrollment packet:
  `completed`/`filed` can still coexist with `mapping_sync_status = pending` or `failed`
- Intake:
  `signed` can still coexist with draft-POF/member-file follow-up work

2. Care plan state enforcement still looks strong on canonical paths.
Evidence:
- caregiver transition compare-and-set and terminal-state hardening remain in `supabase/migrations/0111_care_plan_caregiver_status_compare_and_set.sql`, `supabase/migrations/0118_care_plan_caregiver_status_terminality_hardening.sql`, and `supabase/migrations/0160_care_plan_caregiver_status_rpc_ambiguity_fix.sql`
- diagnosis lineage remains tied to canonical member diagnoses through `supabase/migrations/0085_care_plan_diagnosis_relation.sql`
Status:
- no new care-plan-specific state violation was exposed in this run

3. MAR administration against inactive/non-scheduled medication still appears blocked in the canonical service path.
Evidence:
- canonical MAR workflow guards remain in `lib/services/mar-workflow.ts`
Status:
- no new static gap was exposed for "MAR recorded for inactive medication" on the shared service path

## 5. Missing Foreign Key Constraints

1. `members.latest_assessment_id` still points only to `intake_assessments.id`, not `(id, member_id)` lineage.
Evidence:
- `supabase/migrations/0011_member_command_center_aux_schema.sql`
Risk:
- a member can point at another member's assessment if application logic drifts

2. `member_command_centers.source_assessment_id` still points only to `intake_assessments.id`, not `(id, member_id)` lineage.
Evidence:
- `supabase/migrations/0011_member_command_center_aux_schema.sql`
Risk:
- MCC can reference an assessment belonging to another member

3. `member_health_profiles.source_assessment_id` still points only to `intake_assessments.id`, not `(id, member_id)` lineage.
Evidence:
- `supabase/migrations/0016_member_health_profile_flat_fields.sql`
Risk:
- MHP can carry the wrong source assessment across members

4. `member_health_profiles.active_physician_order_id` still points only to `physician_orders.id`, not `(id, member_id)` lineage.
Evidence:
- `supabase/migrations/0006_intake_pof_mhp_supabase.sql`
Risk:
- MHP can reference another member's physician order

5. `pof_post_sign_sync_queue(physician_order_id, member_id)` is still not composite-linked back to `physician_orders(id, member_id)`.
Evidence:
- queue lineage still relies on simple foreign keys and runtime discipline in `supabase/migrations/0037_shared_rpc_standardization_lead_pof.sql`
Risk:
- queued post-sign sync rows can carry mismatched member/order pairs

6. `pof_requests(physician_order_id, member_id)` is still not composite-linked back to `physician_orders(id, member_id)`.
Evidence:
- `supabase/migrations/0019_pof_esign_workflow.sql`
Risk:
- request rows can drift into cross-member linkage if a non-canonical write path appears

7. `document_events(document_id, member_id)` is still not composite-linked back to `pof_requests(id, member_id)`.
Evidence:
- `supabase/migrations/0019_pof_esign_workflow.sql`
Risk:
- POF event history can record a valid request id and a valid member id that do not belong to the same request

8. `care_plan_signature_events(care_plan_id, member_id)` is still not composite-linked back to `care_plans(id, member_id)`.
Evidence:
- `supabase/migrations/0020_care_plan_canonical_esign.sql`
Risk:
- care-plan signature history can record a valid care plan id and a valid member id that do not belong to the same plan

9. New migration `supabase/migrations/0175_fk_covering_indexes_hardening.sql` adds FK-supporting indexes, not missing lineage constraints.
Evidence:
- the migration adds covering indexes for existing FK columns, including several audit-sensitive tables, but does not add new composite foreign keys
Risk:
- performance is better, but the remaining cross-member lineage holes from the April 1 audit are still open

## 6. Suggested Fix Prompts

### Prompt 1. Add composite lineage FKs for member snapshot columns

Add a forward-only Supabase migration that hardens the remaining cross-member lineage gaps on member snapshot columns.

Scope:
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
- add any supporting unique constraints only if required for FK shape
- validate the constraints after cleanup
- keep the patch additive and migration-backed only; do not rely on read/service guards as a substitute

Manual retest:
- attempt to save member, MCC, and MHP rows that point at another member's assessment/order and confirm Postgres rejects them

### Prompt 2. Harden POF queue, request, and event lineage

Add a forward-only migration that enforces canonical member/order lineage on `pof_post_sign_sync_queue`, `pof_requests`, and `document_events`.

Requirements:
- preflight rows where `member_id` does not match the canonical physician order or request lineage
- repair safe rows deterministically from canonical parent records where possible
- add composite foreign keys:
  - `pof_post_sign_sync_queue(physician_order_id, member_id)` -> `physician_orders(id, member_id)`
  - `pof_requests(physician_order_id, member_id)` -> `physician_orders(id, member_id)`
  - `document_events(document_id, member_id)` -> `pof_requests(id, member_id)`
- preserve replay-safe and queue semantics

Manual retest:
- attempt to insert queue/request/event rows with mismatched parent/member pairs and confirm the writes fail

### Prompt 3. Harden care-plan signature event lineage

Add a forward-only migration that enforces same-member lineage on `care_plan_signature_events`.

Requirements:
- add a composite unique constraint on `care_plans(id, member_id)` only if required for FK shape
- preflight for event rows where `member_id` does not match the plan's `member_id`
- repair safe rows from the canonical care plan when possible
- add composite FK:
  - `care_plan_signature_events(care_plan_id, member_id)` -> `care_plans(id, member_id)`
- validate the constraint after cleanup

Manual retest:
- attempt to insert a care-plan signature event with the wrong member id for a valid plan and confirm Postgres rejects it

### Prompt 4. Remove raw-status truth drift from enrollment, intake, and POF readers

Audit all read paths that report enrollment packet, intake, and POF completion, and replace any raw-status-only completion logic with canonical readiness truth.

Requirements:
- enrollment packet readers must use `resolveEnrollmentPacketOperationalReadiness`
- intake readers must use `resolveIntakePostSignReadiness`
- POF readers must expose post-sign sync truth and not treat raw `signed` as fully synced unless the queue/read model confirms completion
- keep the logic centralized in shared read/service layers
- add regression coverage that prevents drift back to raw terminal-state checks

Manual retest:
- force mapping or post-sign follow-up failure and confirm UI/reporting stays truthful about pending downstream work

### Prompt 5. Run explicit historical drift repair and capture real-data exceptions

Run the explicit repair workflow for historical shell drift and missing legacy member-file storage paths, then capture any rows that still cannot be repaired safely.

Requirements:
- use `scripts/repair-historical-drift.ts` in dry-run mode first
- record missing `member_command_centers`, missing `member_attendance_schedules`, missing `operations_settings`, and pending legacy `member_files` storage backfill counts
- only apply repairs explicitly; do not restore read-time self-healing
- if any rows remain unrepaired, output concrete member ids / file ids for manual remediation

Manual retest:
- after repair, confirm MCC reads fail only for unrepaired rows and no longer create shells implicitly

## 7. Founder Summary

The repo is still in a better place than the older audit runs. The core child-table lineage for enrollment packet children, intake signatures/follow-up, POF medications, MAR schedules/administrations, and care-plan diagnoses remains schema-backed, so the obvious orphan cases are still blocked at the database layer.

The remaining problems are the same narrow but important ones from yesterday. A handful of snapshot and sidecar tables still allow cross-member drift because they only use simple foreign keys, and the big workflows still have a deliberate gap between "status/signature committed" and "all downstream work really finished." The good change since yesterday is that missing member shells are now treated as explicit drift instead of being silently backfilled on reads, which is safer operationally. The main thing that did land today, `0175`, improves FK lookup performance but does not close the remaining lineage holes.

Safest next action:
- add the remaining composite lineage foreign keys for snapshot and sidecar tables
- then run the explicit historical drift repair in dry-run mode against a real environment so you can see whether any existing production rows already violate those assumptions before enforcing the new constraints
