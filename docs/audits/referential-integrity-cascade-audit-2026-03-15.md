# Referential Integrity & Cascade Audit

Date: 2026-03-15
Scope: leads -> enrollment packets -> members -> intake assessments -> physician orders (POF) -> member health profiles -> care plans -> medications -> MAR
Method: static repo audit of Supabase migrations, shared services, RPC boundaries, and lifecycle code paths. Live Supabase row inspection was not possible from this run.

## 1. Orphan Records Detected

None in repo-defined schema for the audited core relationships. The current migrations already enforce the main parent-child links for:

- `enrollment_packet_requests.member_id -> members.id` and `enrollment_packet_requests.lead_id -> leads.id`
- `intake_assessments.member_id -> members.id`
- `physician_orders.intake_assessment_id -> intake_assessments.id`
- `member_health_profiles.member_id -> members.id` and `active_physician_order_id -> physician_orders.id`
- `care_plans.member_id -> members.id`
- `member_diagnoses.member_id -> members.id`
- `pof_medications.physician_order_id -> physician_orders.id`
- `mar_schedules.pof_medication_id -> pof_medications.id`
- `mar_administrations.pof_medication_id -> pof_medications.id`

Live orphan row detection is blocked without direct Supabase access.

## 2. Missing Lifecycle Cascades

1. POF signed does not guarantee immediate downstream MHP/MCC/MAR durability.
   Evidence: [`/D:/Memory Lane App/lib/services/pof-esign.ts`](D:/Memory%20Lane%20App/lib/services/pof-esign.ts) signs the request and then calls post-sign sync; [`/D:/Memory Lane App/lib/services/physician-orders-supabase.ts`](D:/Memory%20Lane%20App/lib/services/physician-orders-supabase.ts) can leave the workflow in `postSignStatus: "queued"` for retry.
   Impact: a POF can be durably signed while MHP sync, medication propagation, or MAR schedule generation is still pending.

2. Enrollment packet completion depends on service-layer downstream mapping, not one atomic DB boundary.
   Evidence: [`/D:/Memory Lane App/lib/services/enrollment-packets.ts`](D:/Memory%20Lane%20App/lib/services/enrollment-packets.ts) runs `mapEnrollmentPacketToDownstream(...)` before the completion finalization RPC, but the mapping work itself is not wrapped in the same RPC transaction.
   Impact: completion can fail mid-cascade and rely on compensating error handling rather than one database transaction across packet filing + downstream MHP/MCC/POF staging updates.

3. Care plan workflow is not linked to diagnoses at the schema level.
   Evidence: care plans persist by member and sections only in [`/D:/Memory Lane App/supabase/migrations/0013_care_plans_and_billing_execution.sql`](D:/Memory%20Lane%20App/supabase/migrations/0013_care_plans_and_billing_execution.sql); diagnoses live separately in [`/D:/Memory Lane App/supabase/migrations/0012_legacy_operational_health_alignment.sql`](D:/Memory%20Lane%20App/supabase/migrations/0012_legacy_operational_health_alignment.sql).
   Impact: there is no canonical cascade proving which diagnoses a care plan was based on, and no FK-backed protection against stale or missing diagnosis references because no join table exists.

## 3. Duplicate Canonical Records

1. `members.source_lead_id` is not unique.
   Evidence: [`/D:/Memory Lane App/supabase/migrations/0007_sales_backend_alignment.sql`](D:/Memory%20Lane%20App/supabase/migrations/0007_sales_backend_alignment.sql) adds only a non-unique index on `source_lead_id`; canonical resolution in [`/D:/Memory Lane App/lib/services/canonical-person-ref.ts`](D:/Memory%20Lane%20App/lib/services/canonical-person-ref.ts) uses `.maybeSingle()` and logs `duplicate-lead-link` when duplicates exist.
   Impact: one lead can map to multiple members, breaking canonical lead/member identity.

2. Active enrollment packet uniqueness is enforced in service code, not by the database.
   Evidence: [`/D:/Memory Lane App/lib/services/enrollment-packets.ts`](D:/Memory%20Lane%20App/lib/services/enrollment-packets.ts) blocks duplicates via `listActivePacketRows(...)`, but [`/D:/Memory Lane App/supabase/migrations/0024_enrollment_packet_workflow.sql`](D:/Memory%20Lane%20App/supabase/migrations/0024_enrollment_packet_workflow.sql) only has token uniqueness.
   Impact: concurrent sends or bypass paths can create multiple active packets for the same member/lead episode.

3. Care plans do not have a canonical uniqueness guard at the root record level.
   Evidence: [`/D:/Memory Lane App/supabase/migrations/0013_care_plans_and_billing_execution.sql`](D:/Memory%20Lane%20App/supabase/migrations/0013_care_plans_and_billing_execution.sql) enforces uniqueness for sections and versions, but not for `care_plans(member_id, track)` or any "current active plan" rule.
   Impact: multiple concurrent top-level care plans of the same track can exist for the same member.

Live duplicate row detection is blocked without direct Supabase access.

## 4. Lifecycle State Violations

1. Scheduled MAR documentation does not verify the selected schedule is still active before writing an administration.
   Evidence: [`/D:/Memory Lane App/lib/services/mar-workflow.ts`](D:/Memory%20Lane%20App/lib/services/mar-workflow.ts) loads `mar_schedules` by `id` only in `documentScheduledMarAdministration(...)` and does not check `active = true` or current medication state.
   Impact: a stale client can document against a deactivated schedule, creating a valid-looking MAR administration after the schedule should no longer be actionable.

2. Scheduled MAR documentation does not re-check the linked medication is still active center-administered medication.
   Evidence: the same path writes from the schedule row without validating the current `pof_medications.active` state, unlike PRN documentation which explicitly checks `active`, `given_at_center`, and `prn`.
   Impact: the system has stronger guardrails for PRN than scheduled doses, leaving a gap for inactive-medication administrations.

3. Signed POF and fully-cascaded clinical state are separate realities in the current model.
   Evidence: [`/D:/Memory Lane App/supabase/migrations/0037_shared_rpc_standardization_lead_pof.sql`](D:/Memory%20Lane%20App/supabase/migrations/0037_shared_rpc_standardization_lead_pof.sql) persists signing and queues post-sign sync; service code records retry state if sync fails.
   Impact: any downstream consumer that treats `physician_orders.status = signed` as equivalent to "MHP/MAR fully synced" can observe an invalid intermediate state.

## 5. Missing Foreign Key Constraints

1. Missing unique constraint on `members.source_lead_id -> leads.id`.
   Suggested hardening: partial or full unique index on `members(source_lead_id)` where `source_lead_id is not null`.
   Risk: duplicate canonical members per lead and resolver ambiguity.

2. Missing uniqueness constraint for active enrollment packets.
   Suggested hardening: partial unique index covering the canonical episode shape, for example `member_id` plus live statuses (`draft`, `prepared`, `sent`, `opened`, `partially_completed`) and optionally `lead_id`.
   Risk: duplicate active public packets and split-brain completion state.

3. Missing uniqueness constraint for current top-level care plan per member/track.
   Suggested hardening: either `unique (member_id, track)` if one persistent plan per track is the contract, or a partial unique index for whichever status defines the current active plan.
   Risk: multiple canonical care plans for the same member/track.

4. Missing explicit care plan -> diagnosis relation.
   Suggested hardening: add a canonical join table such as `care_plan_diagnoses(care_plan_id, member_diagnosis_id)` with FKs to both parents.
   Risk: no auditable linkage between care plans and the diagnoses they operationalize.

## 6. Suggested Fix Prompts

1. Add a production-safe migration that enforces one canonical member per lead by adding a unique index on `members.source_lead_id` for non-null values, backfilling or flagging duplicates first, and update canonical resolver code to fail explicitly if duplicate lead-member links are found instead of relying on `.maybeSingle()`.

2. Harden enrollment packet canonicality by adding a partial unique index for active packet states per member/lead episode, then update `lib/services/enrollment-packets.ts` to treat unique-constraint conflicts as explicit duplicate-active-packet errors rather than relying only on pre-insert reads.

3. Add a canonical care plan uniqueness rule at the database layer. If the intended model is one current plan per member and track, create a migration with a unique or partial-unique index on `care_plans`, then update care-plan create/review services to use that contract instead of allowing parallel root care plans.

4. Fix MAR lifecycle enforcement by updating `documentScheduledMarAdministration` in `lib/services/mar-workflow.ts` to validate `mar_schedules.active = true` and confirm the linked `pof_medications` row is still active, center-administered, and canonical before inserting `mar_administrations`.

5. Tighten POF post-sign cascade semantics by making downstream consumers check the post-sign sync queue state instead of assuming `physician_orders.status = signed` means MHP/MAR are current, and add an explicit clinical-sync completion marker or resolver for "signed and fully cascaded".

6. If care plans must be tied to diagnoses, add a canonical `care_plan_diagnoses` join table with FKs to `care_plans.id` and `member_diagnoses.id`, migrate existing care plans conservatively, and update care-plan services so diagnosis linkage is stored through the service layer rather than implied in free-text sections.

## 7. Founder Summary

The core entity chain is mostly protected from simple orphaning because the important parent-child FKs are already in migrations. The bigger production risks are canonical duplicates and "signed but not fully cascaded yet" states: one lead can still map to multiple members, one member can still receive multiple active enrollment packets, one member can still end up with multiple top-level care plans of the same track, and a signed POF can still be waiting on downstream MHP/MAR sync.

The safest next pass is to harden the missing database uniqueness rules first, then close the MAR scheduled-dose guard gap, then decide whether POF signed status needs a separate "clinical sync complete" contract for downstream consumers.
