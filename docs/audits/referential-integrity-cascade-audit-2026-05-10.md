# Memory Lane Referential Integrity & Cascade Audit

Date: 2026-05-10
Scope: Static repo/schema audit of the canonical `lead -> enrollment packet -> member -> intake assessment -> physician order (POF) -> member health profile (MHP) -> care plan -> medications -> MAR` chain
Method: Reviewed current Supabase migrations, generated schema types, canonical services, tests, automation memory, and current in-progress worktree diffs. This was not a live Supabase row scan, so findings below describe structural protections and structural gaps rather than live production row counts.

Change since last run:

- No new material referential-integrity regression was introduced by the current in-progress worktree.
- Enrollment-packet public runtime truth handling is stricter in [`/D:/Memory Lane App/lib/services/enrollment-packets-public-runtime.ts`](/D:/Memory Lane App/lib/services/enrollment-packets-public-runtime.ts), [`/D:/Memory Lane App/lib/services/enrollment-packets-public-runtime-context.ts`](/D:/Memory Lane App/lib/services/enrollment-packets-public-runtime-context.ts), and [`/D:/Memory Lane App/lib/services/enrollment-packets-public-runtime-cascade.ts`](/D:/Memory Lane App/lib/services/enrollment-packets-public-runtime-cascade.ts): expired links are rejected earlier and completion follow-up persistence now fails loudly instead of silently degrading.
- Enrollment-packet-generated lead activities are now more replay-safe in [`/D:/Memory Lane App/lib/services/enrollment-packet-mapping-runtime.ts`](/D:/Memory Lane App/lib/services/enrollment-packet-mapping-runtime.ts) through DB-backed `lead_activities.idempotency_key` writes.
- The main structural gaps from 2026-05-09 remain open: missing cross-member composite lineage constraints at intake and POF boundaries, queue-backed partial lifecycle truth, and downstream sync RPCs that still recreate missing `member_health_profiles` shells.

## 1 Orphan Records Detected

None structurally confirmed in the audited canonical chain.

The prompted orphan examples still look protected where composite lineage constraints already exist:

- `intake_assessments.member_id -> members.id` remains enforced in [`/D:/Memory Lane App/supabase/migrations/0006_intake_pof_mhp_supabase.sql`](/D:/Memory Lane App/supabase/migrations/0006_intake_pof_mhp_supabase.sql).
- `care_plan_diagnoses.(care_plan_id, member_id) -> care_plans.(id, member_id)` and `care_plan_diagnoses.(member_diagnosis_id, member_id) -> member_diagnoses.(id, member_id)` remain enforced in [`/D:/Memory Lane App/supabase/migrations/0085_care_plan_diagnosis_relation.sql`](/D:/Memory Lane App/supabase/migrations/0085_care_plan_diagnosis_relation.sql).
- Canonical MAR lineage still runs through `pof_medications -> mar_schedules -> mar_administrations` with composite lineage enforcement in [`/D:/Memory Lane App/supabase/migrations/0127_clinical_lineage_enforcement.sql`](/D:/Memory Lane App/supabase/migrations/0127_clinical_lineage_enforcement.sql).
- Enrollment packet child tables still inherit packet/member lineage through the composite constraints in [`/D:/Memory Lane App/supabase/migrations/0140_enrollment_packet_lineage_enforcement.sql`](/D:/Memory Lane App/supabase/migrations/0140_enrollment_packet_lineage_enforcement.sql).

Important caveat:

- This audit did not query the live Supabase project, so it cannot prove whether historical orphan rows already exist in production.

## 2 Missing Lifecycle Cascades

1. Enrollment packet `completed` still does not mean downstream member conversion and follow-up are finished.
   Evidence:
   [`/D:/Memory Lane App/supabase/migrations/0180_enrollment_completion_follow_up_state.sql`](/D:/Memory Lane App/supabase/migrations/0180_enrollment_completion_follow_up_state.sql) still finalizes packets with `status = 'completed'` while separately setting `mapping_sync_status = 'pending'` and `completion_follow_up_status = 'pending'`.
   Impact:
   "Enrollment packet completed without member creation" remains a structurally valid persisted intermediate state until downstream mapping and follow-up finish.

2. Signed POF is still not equivalent to completed downstream clinical sync.
   Evidence:
   [`/D:/Memory Lane App/supabase/migrations/0037_shared_rpc_standardization_lead_pof.sql`](/D:/Memory Lane App/supabase/migrations/0037_shared_rpc_standardization_lead_pof.sql) and [`/D:/Memory Lane App/lib/services/physician-order-post-sign-service.ts`](/D:/Memory Lane App/lib/services/physician-order-post-sign-service.ts) still preserve a durable `pof_post_sign_sync_queue` retry state after signature success.
   Impact:
   "POF signed without downstream MHP sync" remains a valid persisted state whenever queue execution is pending, stuck, or failed.

3. Public MHP -> MCC sync still recreates an MHP shell instead of failing on missing upstream lifecycle state.
   Evidence:
   [`/D:/Memory Lane App/supabase/migrations/0194_member_command_center_shell_write_path_hardening.sql`](/D:/Memory Lane App/supabase/migrations/0194_member_command_center_shell_write_path_hardening.sql) required missing `member_health_profiles` shells to fail loudly.
   [`/D:/Memory Lane App/supabase/migrations/0206_fix_mhp_sync_member_id_ambiguity.sql`](/D:/Memory Lane App/supabase/migrations/0206_fix_mhp_sync_member_id_ambiguity.sql) still begins by inserting into `public.member_health_profiles ... on conflict do nothing`.
   Impact:
   Downstream sync can hide upstream provisioning drift instead of surfacing a missing canonical MHP shell for repair.

4. Signed-POF clinical sync still recreates an MHP shell instead of requiring canonical shell provisioning first.
   Evidence:
   [`/D:/Memory Lane App/supabase/migrations/0205_fix_signed_pof_sync_member_id_ambiguity.sql`](/D:/Memory Lane App/supabase/migrations/0205_fix_signed_pof_sync_member_id_ambiguity.sql) still inserts into `public.member_health_profiles` before updating downstream clinical state.
   Impact:
   A signed physician order can backfill a missing MHP shell during downstream sync, which weakens the canonical lifecycle boundary between member provisioning and clinical updates.

## 3 Duplicate Canonical Records

None newly detected in the audited canonical chain.

The main duplicate guards for the focused entities remain present:

- `members.source_lead_id` remains unique via [`/D:/Memory Lane App/supabase/migrations/0049_workflow_hardening_constraints.sql`](/D:/Memory Lane App/supabase/migrations/0049_workflow_hardening_constraints.sql).
- Active enrollment packets remain limited to one active root per member via [`/D:/Memory Lane App/supabase/migrations/0049_workflow_hardening_constraints.sql`](/D:/Memory Lane App/supabase/migrations/0049_workflow_hardening_constraints.sql) and lifecycle refinements in [`/D:/Memory Lane App/supabase/migrations/0152_enrollment_packet_lifecycle_and_voiding.sql`](/D:/Memory Lane App/supabase/migrations/0152_enrollment_packet_lifecycle_and_voiding.sql).
- `member_health_profiles.member_id` remains one-to-one with the canonical member root in [`/D:/Memory Lane App/supabase/migrations/0006_intake_pof_mhp_supabase.sql`](/D:/Memory Lane App/supabase/migrations/0006_intake_pof_mhp_supabase.sql).
- Care-plan roots remain unique per `member_id + track` via [`/D:/Memory Lane App/supabase/migrations/0049_workflow_hardening_constraints.sql`](/D:/Memory Lane App/supabase/migrations/0049_workflow_hardening_constraints.sql).
- POF medication source rows remain lineage-deduped per order/member in [`/D:/Memory Lane App/supabase/migrations/0127_clinical_lineage_enforcement.sql`](/D:/Memory Lane App/supabase/migrations/0127_clinical_lineage_enforcement.sql).
- Enrollment-packet-generated lead activities are now additionally guarded by DB-backed replay-key uniqueness in [`/D:/Memory Lane App/supabase/migrations/0222_lead_activity_idempotency_hardening.sql`](/D:/Memory Lane App/supabase/migrations/0222_lead_activity_idempotency_hardening.sql) and [`/D:/Memory Lane App/lib/services/enrollment-packet-mapping-runtime.ts`](/D:/Memory Lane App/lib/services/enrollment-packet-mapping-runtime.ts).

This static audit cannot prove whether historical duplicates already exist in the live Supabase project.

## 4 Lifecycle State Violations

1. Public MHP sync still violates the stricter fail-loud shell contract.
   Evidence:
   [`/D:/Memory Lane App/supabase/migrations/0194_member_command_center_shell_write_path_hardening.sql`](/D:/Memory Lane App/supabase/migrations/0194_member_command_center_shell_write_path_hardening.sql) requires missing MHP shells to fail.
   [`/D:/Memory Lane App/supabase/migrations/0206_fix_mhp_sync_member_id_ambiguity.sql`](/D:/Memory Lane App/supabase/migrations/0206_fix_mhp_sync_member_id_ambiguity.sql) silently inserts a shell first.
   Impact:
   Runtime can claim successful downstream sync even when upstream lifecycle provisioning was incomplete.

2. Signed-POF clinical sync still violates the same shell-provisioning contract.
   Evidence:
   [`/D:/Memory Lane App/supabase/migrations/0205_fix_signed_pof_sync_member_id_ambiguity.sql`](/D:/Memory Lane App/supabase/migrations/0205_fix_signed_pof_sync_member_id_ambiguity.sql) inserts an MHP row before applying signed-POF clinical sync.
   Impact:
   The clinical sync path doubles as a hidden repair path, which makes lifecycle truth less auditable.

3. Signed POF rows can remain durable while downstream sync is still incomplete.
   Evidence:
   Queue-backed follow-up still exists in [`/D:/Memory Lane App/supabase/migrations/0037_shared_rpc_standardization_lead_pof.sql`](/D:/Memory Lane App/supabase/migrations/0037_shared_rpc_standardization_lead_pof.sql) and [`/D:/Memory Lane App/lib/services/physician-order-post-sign-service.ts`](/D:/Memory Lane App/lib/services/physician-order-post-sign-service.ts).
   Impact:
   Signature completion alone is still not a safe operational-readiness signal.

4. Enrollment packet `completed` remains a partial truth without follow-up completion.
   Evidence:
   `mapping_sync_status` and `completion_follow_up_status` remain separate persisted truth fields in [`/D:/Memory Lane App/supabase/migrations/0180_enrollment_completion_follow_up_state.sql`](/D:/Memory Lane App/supabase/migrations/0180_enrollment_completion_follow_up_state.sql).
   Impact:
   Any UI, export, or automation that keys only on `enrollment_packet_requests.status = 'completed'` is still vulnerable to false-ready interpretation.

## 5 Missing Constraints

1. `assessment_responses(assessment_id, member_id) -> intake_assessments(id, member_id)` is still missing.
   Current state:
   [`/D:/Memory Lane App/supabase/migrations/0006_intake_pof_mhp_supabase.sql`](/D:/Memory Lane App/supabase/migrations/0006_intake_pof_mhp_supabase.sql) defines independent foreign keys to `intake_assessments.id` and `members.id`.
   Risk:
   An assessment response can be relationally valid while pointing to an intake assessment owned by a different member.

2. `physician_orders(intake_assessment_id, member_id) -> intake_assessments(id, member_id)` is still missing.
   Current state:
   [`/D:/Memory Lane App/supabase/migrations/0006_intake_pof_mhp_supabase.sql`](/D:/Memory Lane App/supabase/migrations/0006_intake_pof_mhp_supabase.sql) only adds `intake_assessment_id uuid references public.intake_assessments(id)`.
   Risk:
   A physician order can remain relationally valid while pointing to another member's intake assessment.

3. `member_health_profiles(active_physician_order_id, member_id) -> physician_orders(id, member_id)` is still missing.
   Current state:
   [`/D:/Memory Lane App/supabase/migrations/0006_intake_pof_mhp_supabase.sql`](/D:/Memory Lane App/supabase/migrations/0006_intake_pof_mhp_supabase.sql) only adds `active_physician_order_id uuid references public.physician_orders(id)`.
   Risk:
   An MHP can still point at a physician order owned by a different member if application logic drifts.

4. `pof_requests(physician_order_id, member_id) -> physician_orders(id, member_id)` is still missing.
   Current state:
   [`/D:/Memory Lane App/supabase/migrations/0019_pof_esign_workflow.sql`](/D:/Memory Lane App/supabase/migrations/0019_pof_esign_workflow.sql) defines independent single-column foreign keys.
   Risk:
   A POF request row can remain relationally valid while storing the wrong member/order pairing.

5. `pof_post_sign_sync_queue(physician_order_id, member_id) -> physician_orders(id, member_id)` is still missing.
   Current state:
   [`/D:/Memory Lane App/supabase/migrations/0037_shared_rpc_standardization_lead_pof.sql`](/D:/Memory Lane App/supabase/migrations/0037_shared_rpc_standardization_lead_pof.sql) defines separate single-column foreign keys and a unique constraint on `physician_order_id`.
   Risk:
   Queue rows can drift into cross-member order pairings while still satisfying independent foreign keys.

6. `member_medications` still has no durable source-lineage FK back to the signed physician order or canonical `pof_medications` source row that produced it.
   Current state:
   [`/D:/Memory Lane App/supabase/migrations/0205_fix_signed_pof_sync_member_id_ambiguity.sql`](/D:/Memory Lane App/supabase/migrations/0205_fix_signed_pof_sync_member_id_ambiguity.sql) still deletes all member medications for the member and reinserts them from signed POF payload state.
   Risk:
   Reconciliation, dedupe, audit, and MAR debugging still cannot prove which signed POF produced a member medication row.

7. Legacy `mar_entries` still has no medication FK-backed lineage.
   Current state:
   [`/D:/Memory Lane App/supabase/migrations/0001_initial_schema.sql`](/D:/Memory Lane App/supabase/migrations/0001_initial_schema.sql) defines `public.mar_entries` with medication text instead of a medication FK root.
   Risk:
   Future code could accidentally treat a non-canonical table as authoritative medication administration storage.

## 6 Suggested Fix Prompts

1. `Add a forward-only Supabase migration that enforces composite intake lineage for assessment_responses(assessment_id, member_id) -> intake_assessments(id, member_id) and physician_orders(intake_assessment_id, member_id) -> intake_assessments(id, member_id). Preflight mismatched historical rows, repair them deterministically when safe, and fail loudly if unresolved mismatches remain before constraint validation. Add supporting composite unique/index coverage where needed.`

2. `Audit supabase/migrations/0206_fix_mhp_sync_member_id_ambiguity.sql and supabase/migrations/0205_fix_signed_pof_sync_member_id_ambiguity.sql. Preserve the member_id ambiguity fixes, but remove runtime auto-insert of member_health_profiles shells from downstream sync RPCs. Missing MHP shells must fail explicitly and point operators to canonical lead conversion, enrollment mapping, or explicit repair flows instead of silently recreating rows during sync.`

3. `Add a forward-only Supabase migration that enforces composite physician-order lineage for member_health_profiles(active_physician_order_id, member_id), pof_requests(physician_order_id, member_id), and pof_post_sign_sync_queue(physician_order_id, member_id) back to physician_orders(id, member_id). Preflight existing mismatches, repair or fail loudly before validation, and add supporting composite indexes for production safety.`

4. `Design the smallest production-safe lineage hardening for member_medications so every row can be traced back to the signed physician order or canonical pof_medications row that generated it. Prefer source_physician_order_id and source_pof_medication_id with foreign keys and indexes, then update the signed-POF clinical sync RPC to populate them deterministically instead of relying on member-level delete/reinsert as the only lineage link.`

5. `Audit public.mar_entries versus the canonical MAR lineage built on pof_medications, mar_schedules, and mar_administrations. If mar_entries is truly legacy, either deprecate it clearly and prevent new runtime use or migrate any remaining legitimate use cases onto canonical MAR tables. Do not leave a medication-administration table in schema that looks canonical but cannot enforce medication lineage.`

6. `Create a deterministic Supabase SQL audit pack for the canonical lead -> enrollment -> member -> intake -> POF -> MHP -> care plan -> medications -> MAR chain. Include counts and sample IDs for orphan rows, cross-member assessment/POF lineage mismatches, duplicate canonical roots, signed POF rows with stale post-sign queue state, enrollment packets whose status is completed but mapping_sync_status or completion_follow_up_status is not completed, and any lingering runtime use of legacy mar_entries. Output should be founder-readable and safe for recurring automation use.`

## 7 Founder Summary

The good news is that today’s worktree did not introduce a new structural break in the main lead-to-MAR chain. The most meaningful improvement since the May 9, 2026 audit is around enrollment-packet truth handling: expired public links are blocked earlier, and follow-up-state persistence now fails loudly instead of quietly letting a packet look healthier than it is.

The main production risk is still that some lifecycle states can look complete before their downstream work is actually complete. A packet can be marked `completed` while member conversion and follow-up are still pending. A POF can be signed while downstream clinical sync is still queued or failed. That is operationally survivable if every consumer respects the secondary status fields, but it is still easy to misread if a screen, report, or automation keys off the top-level status alone.

The deeper architecture issue is still at the intake and physician-order boundaries. Several tables point at valid parent rows, but the database still does not guarantee that those parent rows belong to the same member. That means the schema still relies on application logic for some of the most important cross-entity identity checks. The next safe move is to add those missing composite lineage constraints first, then re-lock the MHP sync RPCs so missing shells fail loudly instead of being silently recreated downstream.
