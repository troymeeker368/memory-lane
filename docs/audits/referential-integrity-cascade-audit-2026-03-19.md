# Referential Integrity & Cascade Audit

Date: 2026-03-19
Scope: leads -> enrollment packets -> members -> intake assessments -> physician orders (POF) -> member health profiles -> care plans -> medications -> MAR records
Method: static repo audit of Supabase migrations, shared services, RPC boundaries, and current lifecycle code paths. Live Supabase row inspection was not available in this run, so deployed-row orphan and duplicate confirmation remains blocked.

## 1. Orphan Records Detected

None in the repo-defined schema for the audited primary parent-child relationships.

Confirmed FK-backed core links include:

- `members.source_lead_id -> leads.id` in `supabase/migrations/0007_sales_backend_alignment.sql` and uniqueness hardening in `supabase/migrations/0049_workflow_hardening_constraints.sql`
- `enrollment_packet_requests.member_id -> members.id` and `enrollment_packet_requests.lead_id -> leads.id` in `supabase/migrations/0024_enrollment_packet_workflow.sql`
- `intake_assessments.member_id -> members.id` and `intake_assessments.lead_id -> leads.id` in `supabase/migrations/0006_intake_pof_mhp_supabase.sql`
- `physician_orders.member_id -> members.id` and `physician_orders.intake_assessment_id -> intake_assessments.id` in `supabase/migrations/0006_intake_pof_mhp_supabase.sql`
- `member_health_profiles.member_id -> members.id` and `member_health_profiles.active_physician_order_id -> physician_orders.id` in `supabase/migrations/0006_intake_pof_mhp_supabase.sql`
- `member_command_centers.member_id -> members.id` in `supabase/migrations/0011_member_command_center_aux_schema.sql`
- `care_plans.member_id -> members.id` in `supabase/migrations/0013_care_plans_and_billing_execution.sql`
- `care_plan_diagnoses` composite links to both `care_plans(id, member_id)` and `member_diagnoses(id, member_id)` in `supabase/migrations/0085_care_plan_diagnosis_relation.sql`
- `pof_medications.physician_order_id -> physician_orders.id`, `mar_schedules.pof_medication_id -> pof_medications.id`, and `mar_administrations.pof_medication_id -> pof_medications.id` in `supabase/migrations/0028_pof_seeded_mar_workflow.sql`

Examples requested by this audit that are schema-protected in the repo:

- intake referencing nonexistent member: blocked by `intake_assessments.member_id`
- MAR referencing nonexistent medication: blocked by `mar_administrations.pof_medication_id`
- care plan referencing nonexistent diagnosis: now blocked by `care_plan_diagnoses.member_diagnosis_id` in `0085`
- enrollment packet completed without member creation: structurally blocked because `enrollment_packet_requests.member_id` is `not null` and FK-backed

Live orphan-row detection in the actual database is still blocked without direct Supabase access.

## 2. Missing Lifecycle Cascades

1. Signed intake can still exist before a draft POF is successfully created.
   Evidence: `app/intake-actions.ts` signs the intake first, then separately calls `autoCreateDraftPhysicianOrderFromIntake`. If the second step fails, the code explicitly writes `draft_pof_status = 'failed'`.
   Impact: intake can look clinically complete while the downstream physician-order handoff still failed.

2. Enrollment packet filing still completes before downstream mapping is guaranteed.
   Evidence: `lib/services/enrollment-packets.ts` finalizes the packet first, then runs downstream mapping afterward. The filing RPC in `supabase/migrations/0076_rpc_returns_table_ambiguity_hardening.sql` persists `status = 'filed'` together with `mapping_sync_status = 'pending'`.
   Impact: MCC, MHP, and POF staging can remain incomplete after a packet is already treated as filed.

3. Signed POF still allows deferred downstream sync.
   Evidence: `lib/services/physician-orders-supabase.ts` returns `postSignStatus: "queued"` when post-sign cascade steps fail, and `supabase/migrations/0037_shared_rpc_standardization_lead_pof.sql` models queue rows with `status in ('queued', 'completed')`.
   Impact: a legally signed physician order can exist before MHP sync, medication sync, and MAR schedule generation have converged.

## 3. Duplicate Canonical Records

None in the current repo-defined schema for the audited canonical duplicate classes.

Current duplicate guards still present:

- one canonical member per lead via `idx_members_source_lead_id_unique` in `supabase/migrations/0049_workflow_hardening_constraints.sql`
- one active enrollment packet per member via `idx_enrollment_packet_requests_active_member_unique` in `supabase/migrations/0049_workflow_hardening_constraints.sql`
- one care-plan root per member and track via `idx_care_plans_member_track_unique` in `supabase/migrations/0049_workflow_hardening_constraints.sql`
- one active signed physician order per member via `uniq_physician_orders_active_signed` in `supabase/migrations/0006_intake_pof_mhp_supabase.sql`
- one active POF request per physician order via `idx_pof_requests_active_per_order_unique` in `supabase/migrations/0038_acid_uniqueness_guards.sql`
- one `pof_medications` row per order/source medication and one `mar_schedules` row per member/medication/time in `supabase/migrations/0028_pof_seeded_mar_workflow.sql`
- one care-plan diagnosis link per plan/diagnosis via `care_plan_diagnoses_unique` in `supabase/migrations/0085_care_plan_diagnosis_relation.sql`

Live duplicate-row detection in the deployed database is still blocked without direct Supabase access.

## 4. Lifecycle State Violations

1. `intake_assessments.signature_status = 'signed'` can still coexist with `draft_pof_status = 'pending'` or `'failed'`.
   Evidence: `app/intake-actions.ts` persists the signed intake before draft POF creation and explicitly records failed POF creation separately.
   Risk: downstream consumers can over-read signed intake as fully handed off to the physician-order workflow.

2. `enrollment_packet_requests.status = 'filed'` can still coexist with `mapping_sync_status = 'pending'` or `'failed'`.
   Evidence: `supabase/migrations/0076_rpc_returns_table_ambiguity_hardening.sql` sets `status = 'filed'` and `mapping_sync_status = 'pending'`, while `lib/services/enrollment-packets.ts` runs mapping after filing.
   Risk: packet filing can overstate operational completion.

3. `physician_orders.status = 'signed'` can still coexist with `pof_post_sign_sync_queue.status = 'queued'`.
   Evidence: `lib/services/physician-orders-supabase.ts` explicitly re-queues failed post-sign cascade work and returns `postSignStatus: "queued"`.
   Risk: MHP, medication, and MAR surfaces can lag behind the signed physician-order state.

## 5. Missing Foreign Key Constraints

1. `assessment_responses` does not enforce that `assessment_id` and `member_id` belong to the same intake.
   Current state: separate FKs to `intake_assessments(id)` and `members(id)` in `supabase/migrations/0006_intake_pof_mhp_supabase.sql`.
   Expected hardening: composite FK from `(assessment_id, member_id)` to `(intake_assessments.id, intake_assessments.member_id)`.
   Risk: response rows can be attached to a real assessment and a real member, but not the same member.

2. `pof_requests` and `document_events` do not enforce member consistency against the linked physician order/request.
   Current state: `pof_requests.physician_order_id` and `pof_requests.member_id` are independent FKs in `supabase/migrations/0019_pof_esign_workflow.sql`. `document_events` separately references `document_id`, `member_id`, and `physician_order_id`.
   Expected hardening: composite FK from `pof_requests(physician_order_id, member_id)` to `physician_orders(id, member_id)`, plus matching composite constraints for `document_events`.
   Risk: POF e-sign rows and document events can drift across members while remaining individually valid.

3. `enrollment_packet_uploads` does not enforce member consistency against the linked packet.
   Current state: `packet_id` and `member_id` are independent FKs in `supabase/migrations/0024_enrollment_packet_workflow.sql`.
   Expected hardening: composite FK from `(packet_id, member_id)` to `(enrollment_packet_requests.id, enrollment_packet_requests.member_id)`.
   Risk: uploaded packet artifacts can be attached to the wrong member while still passing current FK checks.

4. `pof_medications`, `mar_schedules`, and `mar_administrations` do not fully enforce same-member lineage across the cascade.
   Current state: `pof_medications` stores both `physician_order_id` and `member_id`, `mar_schedules` stores both `pof_medication_id` and `member_id`, and `mar_administrations` stores `member_id`, `pof_medication_id`, and optional `mar_schedule_id`, but only single-column FKs exist in `supabase/migrations/0028_pof_seeded_mar_workflow.sql`.
   Expected hardening: composite FKs tying `(physician_order_id, member_id)`, `(pof_medication_id, member_id)`, and `(mar_schedule_id, member_id)` to their parents.
   Risk: MAR rows can remain non-orphaned while still pointing across the wrong member’s medication or schedule lineage.

5. `care_plan_signature_events` does not enforce that the event member matches the linked care plan member.
   Current state: `care_plan_id` and `member_id` are independent FKs in `supabase/migrations/0020_care_plan_canonical_esign.sql`.
   Expected hardening: composite FK from `(care_plan_id, member_id)` to `(care_plans.id, care_plans.member_id)`.
   Risk: signature audit history can drift away from the canonical care-plan owner.

## 6. Suggested Fix Prompts

1. Add a forward-only Supabase migration that hardens cross-member referential integrity for the lead-to-MAR lifecycle. Start by adding composite unique constraints where needed on parent tables, then add composite foreign keys for `assessment_responses`, `pof_requests`, `document_events`, `enrollment_packet_uploads`, `care_plan_signature_events`, `pof_medications`, `mar_schedules`, and `mar_administrations` so child rows cannot legally point at a parent record from one member and a `member_id` from another. Keep all current single-column FKs unless they become redundant, backfill or fail loudly on mismatches, and include preflight queries that surface existing drift before applying constraints.

2. Tighten intake-to-POF lifecycle truth so a signed intake is not treated as fully handed off until draft POF creation succeeds. Keep Supabase as source of truth. Either move nurse signature finalization and draft POF creation behind one RPC-backed transaction boundary, or add one canonical readiness resolver that requires both `signature_status = 'signed'` and `draft_pof_status = 'created'`. Update downstream reads to use that readiness contract instead of raw intake signature state.

3. Harden enrollment packet completion semantics so `filed` does not imply downstream sync is done. Preserve the existing filing RPC, but add one canonical operational-readiness resolver that only returns ready when `status = 'filed'` and `mapping_sync_status = 'completed'`. Update packet dashboards, MCC/MHP downstream consumers, and retry tooling to use that readiness contract and surface action-required alerts when mapping fails.

4. Tighten signed-POF cascade readiness so a physician order is not treated as clinically converged until post-sign sync finishes. Keep the existing retry queue, but add one canonical resolver for “signed and clinically synced” that requires both `physician_orders.status = 'signed'` and `pof_post_sign_sync_queue.status = 'completed'`. Update MHP, medication, and MAR consumers to rely on that resolver instead of raw POF signed status.

5. Add a production-safe integrity audit SQL pack for Supabase that detects current cross-member drift before new constraints are applied. Include queries for mismatched `(assessment_id, member_id)`, `(packet_id, member_id)`, `(physician_order_id, member_id)`, `(pof_medication_id, member_id)`, `(mar_schedule_id, member_id)`, and `(care_plan_id, member_id)` pairs, and return record IDs grouped by violation type so cleanup can happen before migration rollout.

## 7. Founder Summary

The core parent-child chain is still mostly intact, and one major gap from the prior run is now closed: care plans do have a canonical diagnosis relation in `0085`, so “care plan referencing nonexistent diagnosis” is no longer a standing schema hole in the repo.

The main production risk is now twofold. First, several workflows still use honest but split lifecycle states: intake can be signed before draft POF creation succeeds, enrollment packets can be filed before downstream mapping completes, and signed POFs can sit in a retry queue before MHP and MAR sync finish. Second, several child tables repeat `member_id` without composite FKs that prove the parent belongs to the same member. That means the database prevents true orphans, but it still allows certain cross-member drift patterns if application code ever miswrites one of those rows.

Next safe action: harden the composite foreign keys first, then add one canonical readiness resolver each for intake, enrollment packet, and signed POF so downstream readers stop equating “signed/filed” with “fully converged.”
