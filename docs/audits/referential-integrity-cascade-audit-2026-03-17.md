# Referential Integrity & Cascade Audit

Date: 2026-03-17
Scope: leads -> enrollment packets -> members -> intake assessments -> physician orders (POF) -> member health profiles -> care plans -> medications -> MAR records
Method: static repo audit of Supabase migrations, shared services, RPC boundaries, and lifecycle code paths. Live Supabase row inspection was not available in this run, so row-level orphan/duplicate confirmation in the deployed database is still blocked.

## 1. Orphan Records Detected

None in the repo-defined schema for the audited core relationships.

Current migrations enforce the main parent-child links for:

- `members.source_lead_id -> leads.id` with a unique index for non-null values in [`/D:/Memory Lane App/supabase/migrations/0049_workflow_hardening_constraints.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0049_workflow_hardening_constraints.sql)
- `intake_assessments.member_id -> members.id` in [`/D:/Memory Lane App/supabase/migrations/0006_intake_pof_mhp_supabase.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0006_intake_pof_mhp_supabase.sql)
- `physician_orders.intake_assessment_id -> intake_assessments.id` in [`/D:/Memory Lane App/supabase/migrations/0006_intake_pof_mhp_supabase.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0006_intake_pof_mhp_supabase.sql)
- `member_health_profiles.member_id -> members.id` and `active_physician_order_id -> physician_orders.id` in [`/D:/Memory Lane App/supabase/migrations/0006_intake_pof_mhp_supabase.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0006_intake_pof_mhp_supabase.sql)
- `care_plans.member_id -> members.id` in [`/D:/Memory Lane App/supabase/migrations/0013_care_plans_and_billing_execution.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0013_care_plans_and_billing_execution.sql)
- `member_diagnoses.member_id -> members.id` and `member_medications.member_id -> members.id` in [`/D:/Memory Lane App/supabase/migrations/0012_legacy_operational_health_alignment.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0012_legacy_operational_health_alignment.sql)
- `pof_medications.physician_order_id -> physician_orders.id`, `mar_schedules.member_id -> members.id`, `mar_schedules.pof_medication_id -> pof_medications.id`, and `mar_administrations.pof_medication_id -> pof_medications.id` in [`/D:/Memory Lane App/supabase/migrations/0028_pof_seeded_mar_workflow.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0028_pof_seeded_mar_workflow.sql)

Examples requested by the audit that are schema-protected in the repo:

- Intake referencing nonexistent member: blocked by `intake_assessments.member_id` FK
- MAR referencing nonexistent medication: blocked by `mar_administrations.pof_medication_id` FK
- Enrollment packet referencing nonexistent member: blocked by `enrollment_packet_requests.member_id` FK

Live orphan-row detection in the actual database is still blocked without direct Supabase access.

## 2. Missing Lifecycle Cascades

1. Signed intake can still exist without a created draft POF.
   Evidence: [`/D:/Memory Lane App/app/intake-actions.ts#L241`](/D:/Memory%20Lane%20App/app/intake-actions.ts#L241) signs the intake first, then separately calls draft POF creation at [`/D:/Memory Lane App/app/intake-actions.ts#L270`](/D:/Memory%20Lane%20App/app/intake-actions.ts#L270). The split state is explicitly persisted through `draft_pof_status` in [`/D:/Memory Lane App/supabase/migrations/0049_workflow_hardening_constraints.sql#L23`](/D:/Memory%20Lane%20App/supabase/migrations/0049_workflow_hardening_constraints.sql#L23) and the draft-create RPC in [`/D:/Memory Lane App/supabase/migrations/0055_intake_draft_pof_atomic_creation.sql#L48`](/D:/Memory%20Lane%20App/supabase/migrations/0055_intake_draft_pof_atomic_creation.sql#L48).
   Impact: a clinically signed intake can still be left in `draft_pof_status = pending` or `failed` until a retry succeeds.

2. Filed enrollment packet does not guarantee downstream MCC/MHP/contact/POF staging sync is complete.
   Evidence: the finalization RPC sets `status = 'filed'` and `mapping_sync_status = 'pending'` in [`/D:/Memory Lane App/supabase/migrations/0053_artifact_drift_replay_hardening.sql#L904`](/D:/Memory%20Lane%20App/supabase/migrations/0053_artifact_drift_replay_hardening.sql#L904), then the service separately runs `mapEnrollmentPacketToDownstream(...)` in [`/D:/Memory Lane App/lib/services/enrollment-packets.ts#L2148`](/D:/Memory%20Lane%20App/lib/services/enrollment-packets.ts#L2148). Failures are persisted as `mapping_sync_status = failed` in [`/D:/Memory Lane App/lib/services/enrollment-packets.ts#L2172`](/D:/Memory%20Lane%20App/lib/services/enrollment-packets.ts#L2172).
   Impact: caregiver completion and filing can succeed while downstream operational surfaces are still unsynced.

3. Signed POF does not guarantee MHP/MCC/MAR sync completed in the same step.
   Evidence: the post-sign queue explicitly allows `status = 'queued'` in [`/D:/Memory Lane App/supabase/migrations/0037_shared_rpc_standardization_lead_pof.sql#L1`](/D:/Memory%20Lane%20App/supabase/migrations/0037_shared_rpc_standardization_lead_pof.sql#L1), and `processSignedPhysicianOrderPostSignSync(...)` returns `postSignStatus = "queued"` on failure in [`/D:/Memory Lane App/lib/services/physician-orders-supabase.ts#L1610`](/D:/Memory%20Lane%20App/lib/services/physician-orders-supabase.ts#L1610).
   Impact: a POF can be durably signed while downstream MHP sync, medication propagation, or MAR schedule generation is still pending retry.

## 3. Duplicate Canonical Records

None in the current repo-defined schema for the audited canonical duplicate classes.

The March 15 duplicate findings are now hardened in the repo by [`/D:/Memory Lane App/supabase/migrations/0049_workflow_hardening_constraints.sql#L52`](/D:/Memory%20Lane%20App/supabase/migrations/0049_workflow_hardening_constraints.sql#L52):

- one canonical member per lead via `idx_members_source_lead_id_unique`
- one active enrollment packet per member via `idx_enrollment_packet_requests_active_member_unique`
- one care-plan root per member/track via `idx_care_plans_member_track_unique`

Live duplicate-row detection in the deployed database is still blocked without direct Supabase access.

## 4. Lifecycle State Violations

1. `intake_assessments.signature_status = 'signed'` can coexist with `draft_pof_status = 'pending'` or `failed`.
   Evidence: signed state is finalized in [`/D:/Memory Lane App/lib/services/intake-assessment-esign.ts#L221`](/D:/Memory%20Lane%20App/lib/services/intake-assessment-esign.ts#L221), while POF draft creation remains a separate later step in [`/D:/Memory Lane App/app/intake-actions.ts#L270`](/D:/Memory%20Lane%20App/app/intake-actions.ts#L270).
   Risk: any downstream consumer that treats signed intake as equivalent to "POF draft ready" can misread an incomplete clinical handoff.

2. `enrollment_packet_requests.status = 'filed'` can coexist with `mapping_sync_status = 'pending'` or `failed`.
   Evidence: the filing RPC intentionally persists this combination in [`/D:/Memory Lane App/supabase/migrations/0053_artifact_drift_replay_hardening.sql#L904`](/D:/Memory%20Lane%20App/supabase/migrations/0053_artifact_drift_replay_hardening.sql#L904).
   Risk: filed packet status sounds terminal, but downstream member profile hydration may still be incomplete.

3. `physician_orders.status = 'signed'` can coexist with `pof_post_sign_sync_queue.status = 'queued'`.
   Evidence: the queue model in [`/D:/Memory Lane App/supabase/migrations/0037_shared_rpc_standardization_lead_pof.sql#L1`](/D:/Memory%20Lane%20App/supabase/migrations/0037_shared_rpc_standardization_lead_pof.sql#L1) and the service return path in [`/D:/Memory Lane App/lib/services/physician-orders-supabase.ts#L1660`](/D:/Memory%20Lane%20App/lib/services/physician-orders-supabase.ts#L1660) explicitly allow this split state.
   Risk: any consumer that equates signed POF with fully synced MHP/MAR state can observe a false-ready clinical status.

## 5. Missing Constraints

1. Missing canonical care plan -> diagnosis relation.
   Evidence: `care_plans` only references `members` in [`/D:/Memory Lane App/supabase/migrations/0013_care_plans_and_billing_execution.sql#L1`](/D:/Memory%20Lane%20App/supabase/migrations/0013_care_plans_and_billing_execution.sql#L1), while diagnoses exist independently in `member_diagnoses` in [`/D:/Memory Lane App/supabase/migrations/0012_legacy_operational_health_alignment.sql#L62`](/D:/Memory%20Lane%20App/supabase/migrations/0012_legacy_operational_health_alignment.sql#L62). No `care_plan_diagnoses` join table exists in current migrations.
   Risk: the system cannot FK-verify "care plan referencing nonexistent diagnosis" because diagnosis linkage is not modeled canonically at all.
   Suggested hardening: add `care_plan_diagnoses(care_plan_id uuid references care_plans(id) on delete cascade, member_diagnosis_id uuid references member_diagnoses(id) on delete restrict, unique(care_plan_id, member_diagnosis_id))`.

## 6. Suggested Fix Prompts

1. Create a production-safe fix that closes the signed-intake to draft-POF split state. Keep Supabase as source of truth. Either move nurse signature finalization plus draft POF creation behind one canonical RPC-backed service boundary, or add an explicit retry worker/service that guarantees every `intake_assessments.signature_status = 'signed'` record converges to `draft_pof_status = 'created'` or raises a durable alert. Preserve current audit events and make downstream readers rely on the canonical `draft_pof_status` field instead of assuming signed means POF-ready.

2. Harden enrollment packet lifecycle semantics so `filed` does not overstate completion. Keep the existing filing RPC, but add a canonical resolver/service contract for "filed and downstream-mapped" and update downstream consumers to require `mapping_sync_status = 'completed'` before treating the packet as fully operationalized. If feasible, introduce a narrower status or derived readiness field rather than relying on `status = filed` alone.

3. Tighten POF post-sign cascade semantics. Add or expose one canonical clinical-readiness resolver that only returns ready when `physician_orders.status = 'signed'` and the linked `pof_post_sign_sync_queue.status = 'completed'`. Then update MHP/MAR consumers and dashboards to use that canonical readiness contract instead of raw signed status.

4. Add a canonical `care_plan_diagnoses` relation with forward-only Supabase migration, backfill conservatively from current member diagnoses, and update care-plan create/review services to write diagnosis linkage through the service layer. The goal is to make care plans auditable against real diagnosis rows and block stale or nonexistent diagnosis references with FKs.

## 7. Founder Summary

The repo is in better shape than the last run. The biggest duplicate risks from March 15 are now closed in schema by migration `0049`: one lead maps to one member, one member can have only one active enrollment packet, and one member can have only one care-plan root per track.

The remaining risk is lifecycle truthfulness, not basic foreign keys. Three workflows can still look "done" before their downstream cascade finishes: signed intake before draft POF exists, filed enrollment packet before downstream mapping completes, and signed POF before MHP/MAR sync finishes. That means the next safe hardening pass should focus on canonical readiness contracts and retry convergence, not more duplicate/index work.
