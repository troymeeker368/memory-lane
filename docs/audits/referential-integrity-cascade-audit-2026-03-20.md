# Referential Integrity & Cascade Audit

Date: 2026-03-20
Scope: leads -> enrollment packets -> members -> intake assessments -> physician orders (POF) -> member health profiles -> care plans -> medications -> MAR records
Method: static repo audit of Supabase migrations, shared services, and lifecycle service code. Live Supabase row inspection was not available in this run, so deployed-row orphan and duplicate confirmation remains blocked.

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

1. Signed intake can still exist before draft POF creation succeeds.
   Evidence: `app/intake-actions.ts` signs the intake first, then separately calls `autoCreateDraftPhysicianOrderFromIntake`. On failure it explicitly saves `draft_pof_status = 'failed'`.
   Impact: intake can appear complete while the physician-order handoff is incomplete.

2. Enrollment packet filing still completes before downstream mapping is guaranteed.
   Evidence: `lib/services/enrollment-packets.ts` finalizes the packet first, then runs downstream mapping. The filing RPC sets `status = 'filed'` and `mapping_sync_status = 'pending'`.
   Impact: packet can be treated as filed while MCC, MHP, or POF staging is still missing or failed.

3. Signed POF still allows deferred downstream clinical sync.
   Evidence: `lib/services/physician-orders-supabase.ts` returns `postSignStatus: "queued"` when post-sign sync fails and requeues work in `pof_post_sign_sync_queue`.
   Impact: a legally signed physician order can exist before MHP sync, medication sync, and MAR schedule generation are converged.

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

1. `intake_assessments.signature_status = 'signed'` can still coexist with `draft_pof_status = 'pending'` or `'failed'`.
   Risk: downstream readers can over-read intake signature as a fully handed-off intake.

2. `enrollment_packet_requests.status = 'filed'` can still coexist with `mapping_sync_status = 'pending'` or `'failed'`.
   Risk: packet filing can overstate operational completion.

3. `physician_orders.status = 'signed'` can still coexist with queued retry work in `pof_post_sign_sync_queue`.
   Risk: downstream MHP and MAR surfaces can lag behind signed POF state.

## 5. Missing Foreign Key Constraints

1. `assessment_responses` does not enforce that `(assessment_id, member_id)` belongs to the same intake row.
   Current state: separate FKs to `intake_assessments(id)` and `members(id)`.
   Expected hardening: composite FK from `(assessment_id, member_id)` to `(intake_assessments.id, intake_assessments.member_id)`.
   Risk: response rows can remain non-orphaned while attached to the wrong member.

2. `pof_requests` and `document_events` do not enforce member consistency against the linked physician order / POF request.
   Current state: `physician_order_id`, `document_id`, and `member_id` are independently valid.
   Expected hardening: composite FKs tying `(physician_order_id, member_id)` to `physician_orders(id, member_id)`, plus equivalent lineage checks for `document_events`.
   Risk: POF request and document-event audit history can drift across members while still passing single-column FKs.

3. `enrollment_packet_uploads` does not enforce member consistency against the linked packet.
   Current state: `packet_id` and `member_id` are independent FKs.
   Expected hardening: composite FK from `(packet_id, member_id)` to `(enrollment_packet_requests.id, enrollment_packet_requests.member_id)`.
   Risk: uploaded packet artifacts can be attached to the wrong member.

4. `care_plan_signature_events` does not enforce that event member matches care-plan member.
   Current state: `care_plan_id` and `member_id` are independent FKs.
   Expected hardening: composite FK from `(care_plan_id, member_id)` to `(care_plans.id, care_plans.member_id)`.
   Risk: care-plan signature history can drift away from the canonical care-plan owner.

5. `pof_medications`, `mar_schedules`, and `mar_administrations` do not fully enforce same-member lineage through the medication cascade.
   Current state: each table has valid single-column FKs, but no composite proof that the parent row belongs to the same `member_id`.
   Expected hardening: composite FKs for `(physician_order_id, member_id)`, `(pof_medication_id, member_id)`, and `(mar_schedule_id, member_id)`.
   Risk: MAR rows can remain non-orphaned while still crossing member lineage boundaries.

## 6. Suggested Fix Prompts

1. Fix this Memory Lane issue with the smallest production-safe change.

   Issue:
   Cross-member lineage is still possible in `assessment_responses`, `pof_requests`, `document_events`, `enrollment_packet_uploads`, `care_plan_signature_events`, `pof_medications`, `mar_schedules`, and `mar_administrations` because those tables rely on separate single-column FKs instead of composite member-lineage constraints.

   Scope:
   - Domain/workflow: lead -> enrollment -> intake -> POF -> care plan -> MAR referential integrity
   - Canonical entities/tables: discover current parent keys first, then harden the child tables above
   - Expected canonical write path: UI -> Server Action -> Service Layer -> Supabase

   Required approach:
   1. Inspect current migrations and confirm which parent tables need `(id, member_id)` unique constraints added first.
   2. Add one forward-only Supabase migration with preflight drift queries that surface existing mismatches before new constraints apply.
   3. Add composite FKs so each child row proves it belongs to the same canonical member as its parent.
   4. Preserve current runtime behavior and single canonical service paths.
   5. Fail explicitly if existing data violates the new constraints; do not add fallback bypasses.
   6. Report schema impact, backfill/cleanup requirements, and downstream workflows affected.

2. Fix this Memory Lane issue with the smallest production-safe change.

   Issue:
   Intake assessments can be signed before draft POF creation succeeds, so `signature_status = 'signed'` can coexist with `draft_pof_status = 'failed'` or `'pending'`.

   Scope:
   - Domain/workflow: intake assessment -> physician order handoff
   - Canonical entities/tables: `intake_assessments`, `physician_orders`, intake signing service / draft-POF creation path
   - Expected canonical write path: UI -> Server Action -> Service Layer -> Supabase

   Required approach:
   1. Inspect the end-to-end flow starting in `app/intake-actions.ts`, `lib/services/intake-assessment-esign.ts`, and `lib/services/intake-pof-mhp-cascade.ts`.
   2. Keep Supabase as source of truth and avoid UI-only patches.
   3. Either move signature finalization and draft POF creation behind one RPC-backed transaction boundary, or add one canonical readiness resolver that treats intake as complete only when both signature and draft POF creation are satisfied.
   4. Update downstream readers to use the canonical readiness contract instead of raw `signature_status`.
   5. Preserve auditability and explicit failure states.

3. Fix this Memory Lane issue with the smallest production-safe change.

   Issue:
   Enrollment packets can be marked `filed` before downstream mapping completes, so packet status can overstate MCC/MHP/POF readiness.

   Scope:
   - Domain/workflow: enrollment packet completion -> downstream mapping
   - Canonical entities/tables: `enrollment_packet_requests`, `enrollment_packet_mapping_runs`, downstream enrollment mapping services
   - Expected canonical write path: UI -> Server Action -> Service Layer -> Supabase

   Required approach:
   1. Inspect `lib/services/enrollment-packets.ts`, `lib/services/enrollment-packet-intake-mapping.ts`, and the packet finalization RPC.
   2. Preserve the current filing RPC and retryable mapping flow.
   3. Add one canonical readiness resolver or derived status contract that only treats the packet as operationally complete when `status = 'filed'` and `mapping_sync_status = 'completed'`.
   4. Update dashboards and downstream consumers to use that readiness contract instead of raw packet status.
   5. Surface explicit action-required signals when mapping fails; do not synthesize success.

4. Fix this Memory Lane issue with the smallest production-safe change.

   Issue:
   Signed POFs can exist while post-sign sync is still queued, so MHP, medication, and MAR data can lag behind `physician_orders.status = 'signed'`.

   Scope:
   - Domain/workflow: POF signature -> MHP sync -> medication sync -> MAR generation
   - Canonical entities/tables: `physician_orders`, `pof_post_sign_sync_queue`, `member_health_profiles`, `pof_medications`, `mar_schedules`
   - Expected canonical write path: UI -> Server Action -> Service Layer -> Supabase

   Required approach:
   1. Inspect `lib/services/physician-orders-supabase.ts`, `lib/services/pof-esign.ts`, and `lib/services/mar-workflow.ts`.
   2. Keep the retry queue and current service-layer orchestration.
   3. Add one canonical resolver for "signed and clinically synced" so downstream readers stop treating raw signed status as fully converged state.
   4. Ensure alerts and retries remain explicit and auditable.
   5. Do not duplicate business rules in UI pages.

## 7. Founder Summary

The core parent-child chain still looks structurally intact in the repo, and the prior care-plan diagnosis gap remains fixed. I did not find a new repo-level orphan or duplicate regression in the audited lead-to-MAR chain.

The real risk is still split lifecycle truth plus missing composite lineage constraints. Several workflows honestly record partial failure states, but downstream code can still over-read `signed` or `filed` as if the next stage is already complete. Separately, a handful of child tables repeat `member_id` without composite FKs that prove the linked parent belongs to that same member. That means the database blocks true orphans, but it can still allow wrong-member drift if a service ever miswrites those rows.

Today’s workflow simulation report marked the handoffs as strong. That is not a contradiction. The simulation pass mainly verified that canonical services and downstream writes are wired up; this referential-integrity pass is narrower and stricter about whether lifecycle states and cross-member lineage are enforced at the database level.

Next safe action: harden the composite member-lineage FKs first, then add canonical readiness resolvers for intake completion, enrollment packet operational completion, and signed-POF clinical convergence.
