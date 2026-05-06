# Memory Lane Referential Integrity & Cascade Audit

Date: 2026-05-06
Scope: Static repo/schema audit of the canonical lead -> enrollment packet -> member -> intake assessment -> physician order (POF) -> member health profile (MHP) -> care plan -> medications -> MAR lineage
Method: Reviewed current Supabase migrations, generated schema types, and canonical service/RPC code in the present worktree. This was not a live Supabase row scan, so findings below describe structural protections and structural gaps rather than live production row counts.

## 1. Orphan Records Detected

None structurally confirmed in the audited canonical chain.

The prompted orphan examples still look protected at the database layer:

- `intake_assessments.member_id -> members.id` remains enforced in [`/D:/Memory Lane App/supabase/migrations/0006_intake_pof_mhp_supabase.sql`](/D:/Memory Lane App/supabase/migrations/0006_intake_pof_mhp_supabase.sql).
- `care_plan_diagnoses.(care_plan_id, member_id) -> care_plans.(id, member_id)` and `care_plan_diagnoses.(member_diagnosis_id, member_id) -> member_diagnoses.(id, member_id)` remain enforced in [`/D:/Memory Lane App/supabase/migrations/0085_care_plan_diagnosis_relation.sql`](/D:/Memory Lane App/supabase/migrations/0085_care_plan_diagnosis_relation.sql).
- Canonical MAR lineage still runs through `pof_medications -> mar_schedules -> mar_administrations` with composite lineage enforcement in [`/D:/Memory Lane App/supabase/migrations/0127_clinical_lineage_enforcement.sql`](/D:/Memory Lane App/supabase/migrations/0127_clinical_lineage_enforcement.sql).
- Enrollment packet child tables still inherit packet/member lineage through the composite constraints in [`/D:/Memory Lane App/supabase/migrations/0140_enrollment_packet_lineage_enforcement.sql`](/D:/Memory Lane App/supabase/migrations/0140_enrollment_packet_lineage_enforcement.sql).

Important caveat:

- Legacy `public.mar_entries` still exists in [`/D:/Memory Lane App/supabase/migrations/0001_initial_schema.sql`](/D:/Memory Lane App/supabase/migrations/0001_initial_schema.sql) and still lacks canonical medication lineage. I did not find current canonical runtime usage of it, so I am not classifying it as a confirmed live orphan bug, but it remains a schema ambiguity risk.

## 2. Missing Lifecycle Cascades

1. Public MHP -> MCC sync still recreates an MHP shell instead of failing on missing upstream lifecycle state.
   Evidence:
   - [`/D:/Memory Lane App/supabase/migrations/0194_member_command_center_shell_write_path_hardening.sql`](/D:/Memory Lane App/supabase/migrations/0194_member_command_center_shell_write_path_hardening.sql) required `rpc_sync_member_health_profile_to_command_center` to fail when `member_health_profiles` is missing.
   - [`/D:/Memory Lane App/supabase/migrations/0206_fix_mhp_sync_member_id_ambiguity.sql`](/D:/Memory Lane App/supabase/migrations/0206_fix_mhp_sync_member_id_ambiguity.sql) now begins by inserting into `public.member_health_profiles ... on conflict do nothing`.
   Why it matters:
   - Downstream sync can hide upstream provisioning drift instead of surfacing a missing canonical MHP shell for repair.

2. Signed POF is still not equivalent to completed downstream clinical sync.
   Evidence:
   - [`/D:/Memory Lane App/supabase/migrations/0155_signed_pof_post_sign_sync_rpc_consolidation.sql`](/D:/Memory Lane App/supabase/migrations/0155_signed_pof_post_sign_sync_rpc_consolidation.sql) still stages follow-up through one replay-safe RPC that separately performs MHP/MCC sync and MAR reconciliation.
   - [`/D:/Memory Lane App/tests/pof-post-sign-rpc-consolidation.test.ts`](/D:/Memory Lane App/tests/pof-post-sign-rpc-consolidation.test.ts) confirms runtime still routes committed follow-up through `rpc_run_signed_pof_post_sign_sync`.
   - `pof_post_sign_sync_queue` still exists as a durable queue root in [`/D:/Memory Lane App/supabase/migrations/0037_shared_rpc_standardization_lead_pof.sql`](/D:/Memory Lane App/supabase/migrations/0037_shared_rpc_standardization_lead_pof.sql).
   Why it matters:
   - "POF signed without downstream MHP sync" remains a valid persisted state whenever queue execution is pending, stuck, or failed.

3. Enrollment packet `completed` still does not mean downstream member conversion and follow-up are finished.
   Evidence:
   - [`/D:/Memory Lane App/supabase/migrations/0180_enrollment_completion_follow_up_state.sql`](/D:/Memory Lane App/supabase/migrations/0180_enrollment_completion_follow_up_state.sql) finalizes packets with `status = 'completed'` while separately setting `mapping_sync_status = 'pending'` and `completion_follow_up_status = 'pending'`.
   - [`/D:/Memory Lane App/tests/enrollment-packet-completion-truth.test.ts`](/D:/Memory Lane App/tests/enrollment-packet-completion-truth.test.ts) confirms listing/read-model logic treats `completion_follow_up_status` as the real readiness signal.
   - The canonical conversion RPC still treats `mapping_sync_status = 'completed'` as the durable member-conversion success marker in [`/D:/Memory Lane App/supabase/migrations/0149_enrollment_packet_contact_replay_idempotency.sql`](/D:/Memory Lane App/supabase/migrations/0149_enrollment_packet_contact_replay_idempotency.sql).
   Why it matters:
   - "Enrollment packet completed without member creation" remains structurally possible as an intermediate persisted state until mapping/follow-up completes.

## 3. Duplicate Canonical Records

None newly detected in the audited canonical chain.

The main duplicate guards for the focused entities remain present:

- `members.source_lead_id` remains unique via [`/D:/Memory Lane App/supabase/migrations/0049_workflow_hardening_constraints.sql`](/D:/Memory Lane App/supabase/migrations/0049_workflow_hardening_constraints.sql).
- Active enrollment packets remain limited to one active root per member and per lead via [`/D:/Memory Lane App/supabase/migrations/0152_enrollment_packet_lifecycle_and_voiding.sql`](/D:/Memory Lane App/supabase/migrations/0152_enrollment_packet_lifecycle_and_voiding.sql).
- `member_health_profiles.member_id` remains one-to-one with the canonical member root in [`/D:/Memory Lane App/supabase/migrations/0006_intake_pof_mhp_supabase.sql`](/D:/Memory Lane App/supabase/migrations/0006_intake_pof_mhp_supabase.sql).
- Care-plan roots remain unique per `member_id + track` via [`/D:/Memory Lane App/supabase/migrations/0049_workflow_hardening_constraints.sql`](/D:/Memory Lane App/supabase/migrations/0049_workflow_hardening_constraints.sql).
- POF medication source rows remain lineage-deduped per order/member in [`/D:/Memory Lane App/supabase/migrations/0127_clinical_lineage_enforcement.sql`](/D:/Memory Lane App/supabase/migrations/0127_clinical_lineage_enforcement.sql).

This static audit cannot prove whether historical duplicates already exist in the live Supabase project.

## 4. Lifecycle State Violations

1. Public MHP sync still violates the stricter canonical shell contract.
   Evidence:
   - [`/D:/Memory Lane App/supabase/migrations/0194_member_command_center_shell_write_path_hardening.sql`](/D:/Memory Lane App/supabase/migrations/0194_member_command_center_shell_write_path_hardening.sql) says missing MHP shells must fail.
   - [`/D:/Memory Lane App/supabase/migrations/0206_fix_mhp_sync_member_id_ambiguity.sql`](/D:/Memory Lane App/supabase/migrations/0206_fix_mhp_sync_member_id_ambiguity.sql) silently inserts the missing shell before syncing.
   Impact:
   - Runtime can report successful downstream sync even when upstream lifecycle provisioning was incomplete.

2. Signed POF rows can remain durable while downstream sync is still incomplete.
   Evidence:
   - The queue-backed follow-up contract still exists in [`/D:/Memory Lane App/supabase/migrations/0037_shared_rpc_standardization_lead_pof.sql`](/D:/Memory Lane App/supabase/migrations/0037_shared_rpc_standardization_lead_pof.sql) and [`/D:/Memory Lane App/supabase/migrations/0174_pof_post_sign_queue_outcome_rpc.sql`](/D:/Memory Lane App/supabase/migrations/0174_pof_post_sign_queue_outcome_rpc.sql).
   Impact:
   - Operational readiness still depends on queue completion, not signature alone.

3. Enrollment packet `completed` remains a partial truth without follow-up completion.
   Evidence:
   - `mapping_sync_status` and `completion_follow_up_status` remain separate persisted truth fields in [`/D:/Memory Lane App/supabase/migrations/0180_enrollment_completion_follow_up_state.sql`](/D:/Memory Lane App/supabase/migrations/0180_enrollment_completion_follow_up_state.sql).
   Impact:
   - Any UI, export, or automation that keys only on `enrollment_packet_requests.status = 'completed'` is still vulnerable to false-ready interpretation.

4. No new care-plan diagnosis lineage violation was found in this pass.
   Evidence:
   - Care plan diagnosis linkage remains member-scoped and composite-FK-backed in [`/D:/Memory Lane App/supabase/migrations/0085_care_plan_diagnosis_relation.sql`](/D:/Memory Lane App/supabase/migrations/0085_care_plan_diagnosis_relation.sql).
   Impact:
   - The prompted example "care plan referencing nonexistent diagnosis" remains structurally blocked at the database layer.

## 5. Missing Foreign Key Constraints

1. `member_health_profiles(active_physician_order_id, member_id) -> physician_orders(id, member_id)` is still missing.
   Current state:
   - [`/D:/Memory Lane App/supabase/migrations/0006_intake_pof_mhp_supabase.sql`](/D:/Memory Lane App/supabase/migrations/0006_intake_pof_mhp_supabase.sql) only adds `active_physician_order_id uuid references public.physician_orders(id)`.
   - [`/D:/Memory Lane App/types/supabase-types.d.ts`](/D:/Memory Lane App/types/supabase-types.d.ts) still exposes only `member_health_profiles_active_physician_order_id_fkey` against `physician_orders.id`.
   Risk:
   - An MHP can still point at a physician order owned by a different member if application logic drifts.

2. `pof_requests(physician_order_id, member_id) -> physician_orders(id, member_id)` is still missing.
   Current state:
   - [`/D:/Memory Lane App/supabase/migrations/0019_pof_esign_workflow.sql`](/D:/Memory Lane App/supabase/migrations/0019_pof_esign_workflow.sql) defines independent single-column foreign keys.
   - [`/D:/Memory Lane App/types/supabase-types.d.ts`](/D:/Memory Lane App/types/supabase-types.d.ts) still exposes only `pof_requests_member_id_fkey` and `pof_requests_physician_order_id_fkey`.
   Risk:
   - A request row can remain relationally valid while storing the wrong member/order pairing.

3. `pof_post_sign_sync_queue(physician_order_id, member_id) -> physician_orders(id, member_id)` is still missing.
   Current state:
   - [`/D:/Memory Lane App/supabase/migrations/0037_shared_rpc_standardization_lead_pof.sql`](/D:/Memory Lane App/supabase/migrations/0037_shared_rpc_standardization_lead_pof.sql) defines separate single-column foreign keys and a unique constraint on `physician_order_id`.
   - [`/D:/Memory Lane App/types/supabase-types.d.ts`](/D:/Memory Lane App/types/supabase-types.d.ts) still exposes separate `member_id` and `physician_order_id` foreign keys.
   Risk:
   - Queue rows can drift into cross-member order pairings while still satisfying independent FKs.

4. `member_medications` still has no durable source-lineage FK back to the signed physician order or canonical `pof_medications` source row that produced it.
   Current state:
   - [`/D:/Memory Lane App/supabase/migrations/0205_fix_signed_pof_sync_member_id_ambiguity.sql`](/D:/Memory Lane App/supabase/migrations/0205_fix_signed_pof_sync_member_id_ambiguity.sql) still deletes all member medications for the member and reinserts them from signed POF payload state.
   - [`/D:/Memory Lane App/types/supabase-types.d.ts`](/D:/Memory Lane App/types/supabase-types.d.ts) still shows no `source_physician_order_id` or `source_pof_medication_id` lineage columns on `member_medications`.
   Risk:
   - Reconciliation, dedupe, audit, and MAR debugging still cannot prove which signed POF produced a member medication row.

5. Legacy `mar_entries` still has no medication FK-backed lineage.
   Current state:
   - [`/D:/Memory Lane App/supabase/migrations/0001_initial_schema.sql`](/D:/Memory Lane App/supabase/migrations/0001_initial_schema.sql) defines `public.mar_entries` with medication text, not a medication FK root.
   - [`/D:/Memory Lane App/types/supabase-types.d.ts`](/D:/Memory Lane App/types/supabase-types.d.ts) still exposes only `mar_entries_member_id_fkey`.
   Risk:
   - Future code could accidentally treat a non-canonical table as authoritative medication administration storage.

## 6. Suggested Fix Prompts

1. Restore strict failure semantics for public MHP sync.
   Prompt:
   `Audit supabase/migrations/0206_fix_mhp_sync_member_id_ambiguity.sql and remove the runtime auto-insert of member_health_profiles rows inside rpc_sync_member_health_profile_to_command_center. Preserve the member_id ambiguity fix, but restore the 0194 contract: missing MHP shells must fail explicitly instead of being recreated during sync. Add a regression test that proves a missing shell raises a clear error.`

2. Add composite physician-order lineage foreign keys.
   Prompt:
   `Add a forward-only Supabase migration that enforces composite physician-order lineage for member_health_profiles(active_physician_order_id, member_id), pof_requests(physician_order_id, member_id), and pof_post_sign_sync_queue(physician_order_id, member_id) back to physician_orders(id, member_id). Preflight existing mismatches, repair or fail loudly before validation, and add supporting composite indexes for production safety.`

3. Add durable source lineage to member medications.
   Prompt:
   `Design the smallest production-safe lineage hardening for member_medications so every row can be traced back to the signed physician order or canonical pof_medications row that generated it. Prefer source_physician_order_id and source_pof_medication_id with foreign keys and indexes, then update the signed-POF clinical sync RPC to populate them deterministically instead of relying on member-level delete/reinsert as the only lineage link.`

4. Fence off or retire legacy `mar_entries`.
   Prompt:
   `Audit public.mar_entries versus the canonical MAR lineage built on pof_medications, mar_schedules, and mar_administrations. If mar_entries is truly legacy, either deprecate it clearly and prevent new runtime use or migrate any remaining legitimate use cases onto canonical MAR tables. Do not leave a medication-administration table in schema that looks canonical but cannot enforce medication lineage.`

5. Add a recurring live SQL lineage audit pack.
   Prompt:
   `Create a deterministic Supabase SQL audit pack for the canonical lead -> enrollment -> member -> intake -> POF -> MHP -> care plan -> medications -> MAR chain. Include counts and sample IDs for orphan rows, composite physician-order lineage mismatches, duplicate canonical roots, signed POF rows with stale post-sign queue state, enrollment packets whose status is completed but mapping_sync_status or completion_follow_up_status is not completed, and any lingering runtime use of legacy mar_entries. Output should be founder-readable and safe for recurring automation use.`

## 7. Founder Summary

The core relational chain is still mostly structurally intact. I did not find new evidence of broken care-plan diagnosis lineage, broken intake/member foreign keys, or duplicate-root regressions in the canonical lead-to-MAR path. The main problems are the same production-readiness gaps from the last run, and they are still real.

The highest-risk issue is that public MHP sync can still silently recreate a missing MHP shell instead of failing. That weakens your lifecycle contract because downstream sync can now hide an upstream provisioning failure. The next biggest gaps are relational enforcement gaps around physician-order/member pairing and missing durable lineage on `member_medications`, which makes auditability and MAR debugging weaker than it should be. Enrollment packets also still use `completed` as a family-completion status before downstream conversion/follow-up is fully done, so that field alone is not safe as an "all clear" signal.

Next safe action:

1. Re-lock `rpc_sync_member_health_profile_to_command_center` so missing MHP shells fail loudly again.
2. Add the missing composite physician-order lineage foreign keys.
3. Add durable source lineage on `member_medications`.
4. Decide whether `mar_entries` should be retired or explicitly fenced as legacy.

This was an audit-only pass. It did not query live Supabase rows, so it cannot confirm whether bad historical records already exist in production.
