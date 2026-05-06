# Memory Lane Referential Integrity & Cascade Audit

Date: 2026-04-23
Scope: Static repo/schema audit of the canonical lead -> enrollment packet -> member -> intake assessment -> physician order (POF) -> member health profile -> care plan -> medications -> MAR lineage
Method: Reviewed current Supabase migrations, generated schema types, and canonical service/RPC code in the present worktree. This was not a live Supabase row scan, so findings below describe structural protections and structural gaps rather than live production row counts.

## 1. Orphan Records Detected

None structurally confirmed in the current canonical chain.

The direct orphan examples from the prompt still look blocked at the database layer:

- `intake_assessments.member_id -> members.id` remains enforced via `supabase/migrations/0006_intake_pof_mhp_supabase.sql`.
- `care_plan_diagnoses.(care_plan_id, member_id) -> care_plans.(id, member_id)` and `care_plan_diagnoses.(member_diagnosis_id, member_id) -> member_diagnoses.(id, member_id)` remain enforced via `supabase/migrations/0085_care_plan_diagnosis_relation.sql`.
- Canonical MAR lineage still runs through `pof_medications -> mar_schedules -> mar_administrations` with composite lineage enforcement in `supabase/migrations/0127_clinical_lineage_enforcement.sql`.
- Enrollment packet children still cascade from `enrollment_packet_requests` through the packet child tables created in `supabase/migrations/0024_enrollment_packet_workflow.sql` and lineage hardening in `supabase/migrations/0140_enrollment_packet_lineage_enforcement.sql`.

Important caveat:

- The legacy `public.mar_entries` table still exists from `supabase/migrations/0001_initial_schema.sql`, stores only `medication_name text`, and has no foreign key to a medication root. I did not find current runtime reads/writes against `mar_entries`, so I am not treating it as the canonical MAR path, but it remains a schema-level ambiguity risk if any future code starts using it as if it were canonical.

## 2. Missing Lifecycle Cascades

1. The public MHP -> MCC sync RPC regressed back to runtime shell creation.
   Evidence:
   - `supabase/migrations/0194_member_command_center_shell_write_path_hardening.sql` added an explicit failure when `member_health_profiles` is missing.
   - `supabase/migrations/0206_fix_mhp_sync_member_id_ambiguity.sql` later recreates `rpc_sync_member_health_profile_to_command_center` and reintroduces `insert into public.member_health_profiles ... on conflict do nothing`.
   Why it matters:
   - A missing canonical MHP shell can again be silently recreated during downstream sync instead of failing loudly as a lifecycle violation.

2. Signed POF -> downstream clinical sync still allows committed-but-not-ready state.
   Evidence:
   - `supabase/migrations/0205_fix_signed_pof_sync_member_id_ambiguity.sql` still writes the signed order, then deletes/reinserts downstream `member_diagnoses`, `member_medications`, and `member_allergies`.
   - The queue model and runtime in `supabase/migrations/0037_shared_rpc_standardization_lead_pof.sql`, `supabase/migrations/0174_pof_post_sign_queue_outcome_rpc.sql`, and `lib/services/physician-order-post-sign-runtime.ts` still represent downstream sync as queued/retrying/completed work.
   Why it matters:
   - "POF signed without downstream MHP sync" remains a valid persisted state whenever queue execution stalls or fails.

3. Enrollment packet completion still succeeds before full downstream follow-up is done.
   Evidence:
   - `supabase/migrations/0180_enrollment_completion_follow_up_state.sql` marks the packet `status = 'completed'` while separately setting `completion_follow_up_status = 'pending'`.
   - The conversion guard in `supabase/migrations/0194_member_command_center_shell_write_path_hardening.sql` prevents lazy shell creation, but it does not make packet completion itself wait for all downstream work to finish.
   Why it matters:
   - "Enrollment packet completed without member creation" is structurally less likely because conversion now fails if required shells are missing, but "completed while downstream conversion/follow-up is still pending or action_required" remains a real lifecycle state.

4. Care-plan sign flow still contradicts its own post-sign lifecycle.
   Evidence:
   - `lib/services/care-plans-supabase.ts` sets post-sign readiness to `signed_pending_caregiver_dispatch` when caregiver dispatch still must happen.
   - The same file still uses `assertCarePlanWriteBoundaryAligned()` to throw unless the reloaded care plan is already `ready`.
   Why it matters:
   - A valid signed care plan can still be treated as a workflow failure even when the persisted truth is "signed and waiting on caregiver dispatch."

## 3. Duplicate Canonical Records

None newly detected in the audited canonical chain.

The main duplicate guards for the focused entities are still present:

- `members.source_lead_id` remains unique via `supabase/migrations/0049_workflow_hardening_constraints.sql`.
- Active enrollment packets remain limited to one active root per member and per lead via `supabase/migrations/0152_enrollment_packet_lifecycle_and_voiding.sql`.
- `member_health_profiles.member_id` still stays one-to-one with the member root.
- Active POF requests remain guarded by `idx_pof_requests_active_per_order_unique` in `supabase/migrations/0038_acid_uniqueness_guards.sql`.
- Care-plan roots remain unique per `member_id + track` via `supabase/migrations/0049_workflow_hardening_constraints.sql`.
- POF medication source rows remain deduped per order/source medication via `uniq_pof_medications_order_source` in `supabase/migrations/0028_pof_seeded_mar_workflow.sql`.

This static audit cannot prove there are zero historical duplicates already present in the live Supabase project.

## 4. Lifecycle State Violations

1. Care-plan post-sign readiness is still internally contradictory.
   Evidence:
   - `lib/services/care-plans-supabase.ts` persists `signed_pending_caregiver_dispatch`.
   - The same service then throws unless `postSignReadinessStatus === "ready"`.
   Impact:
   - The workflow can report failure for a state the schema and readiness model explicitly allow.

2. The public MHP sync RPC now violates the "missing upstream shell must fail" lifecycle rule.
   Evidence:
   - `supabase/migrations/0206_fix_mhp_sync_member_id_ambiguity.sql` silently inserts a `member_health_profiles` row.
   Impact:
   - Downstream sync can hide an upstream provisioning failure instead of surfacing it for repair.

3. Completed enrollment packets are still not equivalent to fully completed lifecycle cascades.
   Evidence:
   - `supabase/migrations/0180_enrollment_completion_follow_up_state.sql` preserves `completion_follow_up_status` as a separate workflow truth.
   Impact:
   - Any consumer that treats `enrollment_packet_requests.status = 'completed'` as "all downstream work is finished" is still wrong.

4. Signed POF rows can still be durable while downstream medication/MHP/MCC sync is incomplete.
   Evidence:
   - The post-sign queue remains explicit in `pof_post_sign_sync_queue` and its runtime/finalization RPCs.
   Impact:
   - Operational readiness still depends on queue completion, not signature alone.

## 5. Missing Foreign Key Constraints

1. `member_health_profiles(active_physician_order_id, member_id) -> physician_orders(id, member_id)` is still missing.
   Current state:
   - `supabase/migrations/0006_intake_pof_mhp_supabase.sql` only adds `active_physician_order_id uuid references public.physician_orders(id)`.
   Risk:
   - An MHP can still point at an order that belongs to a different member if application logic drifts.

2. `pof_requests(physician_order_id, member_id) -> physician_orders(id, member_id)` is still missing.
   Current state:
   - `supabase/migrations/0019_pof_esign_workflow.sql` uses separate single-column foreign keys.
   - Generated schema types still show `pof_requests_physician_order_id_fkey` and `pof_requests_member_id_fkey`, but no composite member/order FK.
   Risk:
   - Request rows can remain relationally valid while preserving a wrong member/order pairing.

3. `pof_post_sign_sync_queue(physician_order_id, member_id) -> physician_orders(id, member_id)` is still missing.
   Current state:
   - `supabase/migrations/0037_shared_rpc_standardization_lead_pof.sql` uses separate single-column foreign keys.
   - Generated schema types still show `pof_post_sign_sync_queue_physician_order_id_fkey` and `pof_post_sign_sync_queue_member_id_fkey`, but no composite member/order FK.
   Risk:
   - Queue rows can drift into cross-member order pairings while still satisfying independent FKs.

4. `member_medications` still has no durable FK-backed source lineage to the signed physician order or `pof_medications` row that created it.
   Current state:
   - `supabase/migrations/0205_fix_signed_pof_sync_member_id_ambiguity.sql` still deletes all `member_medications` for the member and reinserts them from signed POF JSON.
   - Generated schema types still expose no `source_physician_order_id` or `source_pof_medication_id` columns on `member_medications`.
   Risk:
   - Reconciliation, dedupe, audit, and MAR debugging still cannot prove which signed POF produced a member medication row.

5. The legacy `mar_entries` table has no medication foreign key at all.
   Current state:
   - `supabase/migrations/0001_initial_schema.sql` stores `medication_name text` only.
   - I found no current runtime references to `mar_entries`, which suggests it is legacy rather than canonical.
   Risk:
   - The table can still mislead future code into writing MAR rows with no canonical medication lineage if it is reused accidentally.

## 6. Suggested Fix Prompts

1. Restore the strict missing-shell guard in the public MHP sync RPC.
   Prompt:
   `Audit supabase/migrations/0206_fix_mhp_sync_member_id_ambiguity.sql and remove the runtime auto-insert of member_health_profiles rows inside rpc_sync_member_health_profile_to_command_center. Preserve the member_id ambiguity fix, but make the public RPC keep the 0194 contract: missing MHP or MCC shells must fail explicitly instead of being recreated during sync. Add a regression test that proves a missing shell raises a clear error.`

2. Fix the care-plan post-sign readiness contradiction.
   Prompt:
   `Audit lib/services/care-plans-supabase.ts and align the post-sign write boundary with the intended caregiver-dispatch lifecycle. If caregiver dispatch is still pending after nurse signature, do not require postSignReadinessStatus to already be ready in the same workflow. Preserve committed-but-not-ready truth, keep action-required handling for real failures, and add regression coverage for create/review flows with caregiver dispatch still pending.`

3. Harden physician-order lineage with composite foreign keys.
   Prompt:
   `Add a forward-only Supabase migration that enforces composite physician-order lineage for member_health_profiles(active_physician_order_id, member_id), pof_requests(physician_order_id, member_id), and pof_post_sign_sync_queue(physician_order_id, member_id) back to physician_orders(id, member_id). Preflight existing mismatches, repair or fail loudly before validation, and add supporting composite indexes for production safety.`

4. Add durable source lineage to member medications.
   Prompt:
   `Design the smallest production-safe lineage hardening for member_medications so every row can be traced back to the signed physician order or canonical pof_medications row that generated it. Prefer source_physician_order_id and source_pof_medication_id with foreign keys and indexes, then update the signed-POF clinical sync RPC to populate them deterministically instead of relying on member-level delete/reinsert as the only lineage link.`

5. Decommission or fence off legacy mar_entries.
   Prompt:
   `Audit public.mar_entries versus the canonical MAR lineage built on pof_medications, mar_schedules, and mar_administrations. If mar_entries is truly legacy, either deprecate it clearly and prevent new runtime use or migrate any remaining legitimate use cases onto canonical MAR tables. Do not leave a medication-administration table in schema that looks canonical but cannot enforce medication lineage.`

6. Add a live SQL audit pack for recurring referential-integrity checks.
   Prompt:
   `Create a deterministic Supabase SQL audit pack for the canonical lead -> enrollment -> member -> intake -> POF -> MHP -> care plan -> medications -> MAR chain. Include counts and sample IDs for orphan rows, composite lineage mismatches, duplicate canonical roots, signed POF rows with stale post-sign queue state, completed enrollment packets with incomplete follow-up, care plans stuck in post-sign contradiction states, and any lingering legacy mar_entries usage. Output should be founder-readable and safe for recurring automation use.`

## 7. Founder Summary

The core database shape is still doing a decent job blocking obvious orphan and duplicate-root mistakes in the main lead-to-MAR chain. I did not find a new wave of missing direct foreign keys across the main canonical entities, and the stronger care-plan diagnosis and MAR composite lineage constraints are still present.

The important problem this run found is a real regression at the lifecycle boundary: the public MHP-to-MCC sync RPC appears to have lost the strict "missing shell must fail" protection and can silently recreate an MHP shell again. That weakens your canonical lifecycle contract because downstream sync is now able to mask upstream provisioning drift. The other major open risks remain the same as yesterday: care-plan sign flow still contradicts its own caregiver-dispatch lifecycle, physician-order lineage still depends on app logic in a few member/order pairings instead of composite database enforcement, and member medications still do not retain durable source lineage back to the signed POF row that produced them.

The next safe step is:

1. Re-lock the public MHP sync RPC so missing shells fail instead of auto-healing.
2. Fix the care-plan post-sign readiness contradiction.
3. Add the missing composite physician-order lineage foreign keys.
4. Add source lineage columns for `member_medications`.

This was an audit-only pass. It did not query live Supabase rows, so it cannot prove whether historical bad rows already exist in production.
