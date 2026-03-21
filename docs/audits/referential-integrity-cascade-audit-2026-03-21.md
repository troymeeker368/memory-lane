# Referential Integrity & Cascade Audit

Date: 2026-03-21
Scope: leads -> enrollment packets -> members -> intake assessments -> physician orders (POF) -> member health profiles -> care plans -> medications -> MAR records
Method: static repo audit of Supabase migrations, generated schema types, shared services, and lifecycle service code. Live Supabase row inspection was not available in this run, so deployed-row orphan and duplicate confirmation remains blocked.

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
   Evidence: [`app/intake-actions.ts`](D:/Memory%20Lane%20App/app/intake-actions.ts) signs and saves the intake, then separately calls `autoCreateDraftPhysicianOrderFromIntake`. On failure it explicitly writes `draft_pof_status = 'failed'`.
   Impact: intake can appear clinically complete while the physician-order handoff is incomplete.

2. Signed intake follow-up still allows missing intake PDF persistence.
   Evidence: [`app/intake-actions.ts`](D:/Memory%20Lane%20App/app/intake-actions.ts) attempts `saveGeneratedMemberPdfToFiles` only after intake creation and draft POF follow-up.
   Impact: a signed intake can exist without its expected member-file artifact.

3. Enrollment packet filing still completes before downstream mapping is guaranteed.
   Evidence: [`lib/services/enrollment-packets.ts`](D:/Memory%20Lane%20App/lib/services/enrollment-packets.ts) finalizes the packet first, then runs downstream mapping. The finalization path still returns `mappingSyncStatus`, which may remain `pending` or become `failed` after filing.
   Impact: packet can be treated as filed while MCC, MHP, contacts, payor linkage, or POF staging are still missing or failed.

4. Enrollment packet downstream mapping is still split after the conversion RPC.
   Evidence: [`lib/services/enrollment-packet-intake-mapping.ts`](D:/Memory%20Lane%20App/lib/services/enrollment-packet-intake-mapping.ts) calls the conversion RPC with `p_contacts: []`, then performs contact/payor work afterward in app code.
   Impact: downstream lifecycle truth can say "completed" before every expected child write is durably aligned.

5. Signed POF still allows deferred downstream clinical sync.
   Evidence: [`lib/services/physician-orders-supabase.ts`](D:/Memory%20Lane%20App/lib/services/physician-orders-supabase.ts) returns `postSignStatus: "queued"` when post-sign sync fails and requeues work in `pof_post_sign_sync_queue`.
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

2. A signed intake can still lack its expected member-file PDF artifact.
   Risk: workflow state can overstate downstream durability even when the document handoff still needs repair.

3. `enrollment_packet_requests.status = 'filed'` can still coexist with `mapping_sync_status = 'pending'` or `'failed'`.
   Risk: packet filing can overstate operational completion.

4. The public enrollment packet submit action still returns plain success instead of the richer mapping truth.
   Evidence: [`app/sign/enrollment-packet/[token]/actions.ts`](D:/Memory%20Lane%20App/app/sign/enrollment-packet/%5Btoken%5D/actions.ts) awaits `submitPublicEnrollmentPacket(...)` and then returns `{ ok: true }`.
   Risk: callers can treat filed-only as downstream-ready even though the service layer already tracks `mappingSyncStatus` and staff-read `operationalReadinessStatus`.

5. `physician_orders.status = 'signed'` can still coexist with queued retry work in `pof_post_sign_sync_queue`.
   Risk: downstream MHP and MAR surfaces can lag behind signed POF state.

## 5. Missing Constraints

1. `assessment_responses` does not enforce that `(assessment_id, member_id)` belongs to the same intake row.
   Current state: separate FKs to `intake_assessments(id)` and `members(id)`.
   Expected hardening: composite FK from `(assessment_id, member_id)` to `(intake_assessments.id, intake_assessments.member_id)`.
   Risk: response rows can remain non-orphaned while attached to the wrong member.

2. `pof_requests` does not enforce member consistency against the linked physician order.
   Current state: `physician_order_id` and `member_id` are independently valid.
   Expected hardening: composite FK tying `(physician_order_id, member_id)` to `physician_orders(id, member_id)`.
   Risk: POF request rows can drift across members while still passing single-column FKs.

3. `document_events` does not enforce member consistency against the linked POF request.
   Current state: `document_id` and `member_id` are independently valid.
   Expected hardening: composite FK tying `(document_id, member_id)` to `(pof_requests.id, pof_requests.member_id)` or an equivalent lineage-safe relation.
   Risk: document audit history can drift across members while still remaining non-orphaned.

4. `enrollment_packet_uploads` does not enforce member consistency against the linked packet.
   Current state: `packet_id` and `member_id` are independent FKs.
   Expected hardening: composite FK from `(packet_id, member_id)` to `(enrollment_packet_requests.id, enrollment_packet_requests.member_id)`.
   Risk: uploaded packet artifacts can be attached to the wrong member.

5. `care_plan_signature_events` does not enforce that event member matches care-plan member.
   Current state: `care_plan_id` and `member_id` are independent FKs.
   Expected hardening: composite FK from `(care_plan_id, member_id)` to `(care_plans.id, care_plans.member_id)`.
   Risk: care-plan signature history can drift away from the canonical care-plan owner.

6. `pof_medications`, `mar_schedules`, and `mar_administrations` do not fully enforce same-member lineage through the medication cascade.
   Current state: each table has valid single-column FKs, but no composite proof that the parent row belongs to the same `member_id`.
   Expected hardening: composite FKs for `(physician_order_id, member_id)`, `(pof_medication_id, member_id)`, and `(mar_schedule_id, member_id)` after adding any needed parent-side composite unique constraints.
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
   Intake assessments can be signed before draft POF creation succeeds, and signed intake follow-up still allows missing intake PDF persistence.

   Scope:
   - Domain/workflow: intake assessment -> physician order handoff -> member file persistence
   - Canonical entities/tables: `intake_assessments`, `physician_orders`, `member_files`, intake signing service / draft-POF creation path
   - Expected canonical write path: UI -> Server Action -> Service Layer -> Supabase

   Required approach:
   1. Inspect the end-to-end flow starting in `app/intake-actions.ts`, `lib/services/intake-assessment-esign.ts`, and `lib/services/intake-pof-mhp-cascade.ts`.
   2. Keep Supabase as source of truth and avoid UI-only patches.
   3. Either move signature finalization and required follow-up behind one RPC-backed transaction boundary, or add one canonical readiness resolver that treats intake as complete only when signature, draft POF creation, and required PDF persistence are satisfied.
   4. Update downstream readers to use the canonical readiness contract instead of raw `signature_status`.
   5. Preserve auditability and explicit failure states.

3. Fix this Memory Lane issue with the smallest production-safe change.

   Issue:
   Enrollment packets can be marked `filed` before downstream mapping completes, and the public submit action still hides that downstream truth.

   Scope:
   - Domain/workflow: enrollment packet completion -> downstream mapping
   - Canonical entities/tables: `enrollment_packet_requests`, `enrollment_packet_mapping_runs`, downstream enrollment mapping services
   - Expected canonical write path: UI -> Server Action -> Service Layer -> Supabase

   Required approach:
   1. Inspect `lib/services/enrollment-packets.ts`, `lib/services/enrollment-packet-intake-mapping.ts`, and the packet finalization RPC.
   2. Preserve the current filing RPC and retryable mapping flow.
   3. Add one canonical readiness resolver or derived status contract that only treats the packet as operationally complete when `status = 'filed'` and `mapping_sync_status = 'completed'`.
   4. Return `packetId`, `status`, `mappingSyncStatus`, and any action-needed message from the public action instead of plain success.
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

This run did not find a new repo-level regression in the audited lead-to-MAR chain. The database schema still blocks the obvious orphans and the main duplicate classes remain guarded.

The remaining production risk is more subtle: several workflows still allow "partial truth" states, and several child tables still prove only that a parent exists, not that the parent belongs to the same canonical member. In plain English, the system is better at preventing missing parents than preventing wrong-member drift or over-claiming that a downstream handoff is already done.

The biggest operational items are still the same ones surfaced by today’s workflow and ACID audits:

- signed intake is ahead of draft POF and PDF durability
- filed enrollment packet is ahead of full downstream mapping truth
- signed POF is ahead of downstream clinical sync truth

Next safe action: harden the composite member-lineage FKs first, then make downstream readiness explicit for intake, enrollment packets, and signed POF flows so staff-facing state matches real persisted completion.
