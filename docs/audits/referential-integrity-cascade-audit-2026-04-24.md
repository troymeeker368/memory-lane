# Memory Lane Referential Integrity & Cascade Audit

Date: 2026-04-24
Scope: Static repo/schema audit of the canonical lead -> enrollment packet -> member -> intake assessment -> physician order (POF) -> member health profile (MHP) -> care plan -> medications -> MAR lineage
Method: Reviewed current Supabase migrations, generated schema types, and canonical service/RPC code in the present worktree. This was not a live Supabase row scan, so findings below describe structural protections and structural gaps rather than live production row counts.

## 1. Orphan Records Detected

None structurally confirmed in the current canonical chain.

The direct orphan examples from the prompt still look blocked at the database layer:

- `intake_assessments.member_id -> members.id` remains enforced through the intake/POF/MHP schema in `supabase/migrations/0006_intake_pof_mhp_supabase.sql`.
- `care_plan_diagnoses.(care_plan_id, member_id) -> care_plans.(id, member_id)` and `care_plan_diagnoses.(member_diagnosis_id, member_id) -> member_diagnoses.(id, member_id)` remain enforced in `supabase/migrations/0085_care_plan_diagnosis_relation.sql`.
- Canonical MAR lineage still runs through `pof_medications -> mar_schedules -> mar_administrations` with composite lineage enforcement in `supabase/migrations/0127_clinical_lineage_enforcement.sql`.
- Enrollment packet child tables still inherit packet/member lineage through the constraints added in `supabase/migrations/0140_enrollment_packet_lineage_enforcement.sql`.

Important caveat:

- The legacy `public.mar_entries` table still exists in `supabase/migrations/0001_initial_schema.sql` and stores medication text instead of a canonical medication FK. I did not find current canonical runtime usage of this table, so I am not classifying it as a live orphan bug, but it remains a schema ambiguity risk.

## 2. Missing Lifecycle Cascades

1. Public MHP -> MCC sync can recreate an MHP shell instead of failing on missing upstream lifecycle state.
   Evidence:
   - `supabase/migrations/0194_member_command_center_shell_write_path_hardening.sql` explicitly required MHP sync to fail when `member_health_profiles` is missing.
   - `supabase/migrations/0206_fix_mhp_sync_member_id_ambiguity.sql` now starts `rpc_sync_member_health_profile_to_command_center` with `insert into public.member_health_profiles ... on conflict do nothing`.
   Why it matters:
   - Downstream sync can hide upstream provisioning drift instead of surfacing the missing shell for repair.

2. Signed POF is still not equivalent to completed downstream clinical sync.
   Evidence:
   - `tests/pof-post-sign-rpc-consolidation.test.ts` confirms the system now routes retries through one RPC boundary, but that boundary still stages downstream work through `rpc_run_signed_pof_post_sign_sync`.
   - `supabase/migrations/0037_shared_rpc_standardization_lead_pof.sql` and generated types still keep `pof_post_sign_sync_queue` as a durable queue root.
   Why it matters:
   - "POF signed without downstream MHP sync" remains a valid persisted state whenever queue execution is pending, stuck, or failed.

3. Enrollment packet `completed` still does not mean all downstream follow-up finished.
   Evidence:
   - `supabase/migrations/0180_enrollment_completion_follow_up_state.sql` finalizes the packet with `status = 'completed'` while separately setting `mapping_sync_status = 'pending'` and `completion_follow_up_status = 'pending'`.
   - `tests/enrollment-packet-completion-truth.test.ts` confirms the listing/read-model logic now treats `completion_follow_up_status` as the real readiness signal.
   Why it matters:
   - "Enrollment packet completed without member creation" is better protected than before, but `completed` still cannot be treated as "all downstream cascades finished."

## 3. Duplicate Canonical Records

None newly detected in the audited canonical chain.

The main duplicate guards for the focused entities are still present:

- `members.source_lead_id` remains unique via `supabase/migrations/0049_workflow_hardening_constraints.sql`.
- Active enrollment packets remain limited to one active root per member and per lead via `supabase/migrations/0152_enrollment_packet_lifecycle_and_voiding.sql`.
- `member_health_profiles.member_id` still remains one-to-one with the canonical member root.
- Active POF request issuance still has uniqueness guards through the POF request indexes and post-sign queue uniqueness.
- Care-plan roots remain unique per `member_id + track` via `supabase/migrations/0049_workflow_hardening_constraints.sql`.
- POF medication source rows remain deduped per order/source medication in `supabase/migrations/0028_pof_seeded_mar_workflow.sql`.

This static audit cannot prove whether historical duplicate rows already exist in the live Supabase project.

## 4. Lifecycle State Violations

1. Public MHP sync now violates the stricter canonical shell contract.
   Evidence:
   - `supabase/migrations/0194_member_command_center_shell_write_path_hardening.sql` says missing MHP shells must fail.
   - `supabase/migrations/0206_fix_mhp_sync_member_id_ambiguity.sql` silently inserts an MHP shell before sync.
   Impact:
   - Runtime can report successful downstream sync even when upstream lifecycle provisioning was incomplete.

2. Signed POF records can remain durable while downstream sync is still incomplete.
   Evidence:
   - `pof_post_sign_sync_queue` still exists as the durable boundary for follow-up work.
   - The consolidated runtime proves the queue path is canonical, not eliminated.
   Impact:
   - Operational readiness still depends on queue completion, not signature alone.

3. Enrollment packet `completed` remains only a partial truth without follow-up completion.
   Evidence:
   - `completion_follow_up_status` and `mapping_sync_status` remain separate persisted state dimensions after finalization.
   Impact:
   - Any UI/report/export that keys only on `enrollment_packet_requests.status = 'completed'` is still vulnerable to false-ready interpretation.

Note:

- The care-plan post-sign contradiction flagged on 2026-04-23 is no longer a current finding. `lib/services/care-plans-supabase.ts` now allows both `ready` and `signed_pending_caregiver_dispatch` in `assertCarePlanWriteBoundaryAligned`, which aligns the write boundary with the intended caregiver-dispatch lifecycle.

## 5. Missing Foreign Key Constraints

1. `member_health_profiles(active_physician_order_id, member_id) -> physician_orders(id, member_id)` is still missing.
   Current state:
   - `supabase/migrations/0006_intake_pof_mhp_supabase.sql` only adds `active_physician_order_id uuid references public.physician_orders(id)`.
   Risk:
   - An MHP can still point at a physician order owned by another member if application logic drifts.

2. `pof_requests(physician_order_id, member_id) -> physician_orders(id, member_id)` is still missing.
   Current state:
   - `supabase/migrations/0019_pof_esign_workflow.sql` uses independent single-column foreign keys.
   - `types/supabase-types.d.ts` still exposes only `pof_requests_member_id_fkey` and `pof_requests_physician_order_id_fkey`.
   Risk:
   - A request row can remain relationally valid while storing the wrong member/order pairing.

3. `pof_post_sign_sync_queue(physician_order_id, member_id) -> physician_orders(id, member_id)` is still missing.
   Current state:
   - `supabase/migrations/0037_shared_rpc_standardization_lead_pof.sql` uses separate single-column foreign keys and a unique constraint on `physician_order_id`.
   - `types/supabase-types.d.ts` still exposes separate `member_id` and `physician_order_id` foreign keys.
   Risk:
   - Queue rows can drift into cross-member order pairings while still satisfying independent FKs.

4. `member_medications` still has no durable source lineage FK back to the signed physician order or canonical `pof_medications` source row that created it.
   Current state:
   - `supabase/migrations/0205_fix_signed_pof_sync_member_id_ambiguity.sql` still deletes member medications for the member and reinserts them from the signed POF state.
   - `types/supabase-types.d.ts` still shows no `source_physician_order_id` or `source_pof_medication_id` fields on `member_medications`.
   Risk:
   - Reconciliation, dedupe, audit, and MAR debugging still cannot prove which signed POF produced a member medication row.

5. Legacy `mar_entries` still has no medication FK-backed lineage.
   Current state:
   - `supabase/migrations/0001_initial_schema.sql` defines `public.mar_entries` with medication text, not a medication FK root.
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
   `Create a deterministic Supabase SQL audit pack for the canonical lead -> enrollment -> member -> intake -> POF -> MHP -> care plan -> medications -> MAR chain. Include counts and sample IDs for orphan rows, composite physician-order lineage mismatches, duplicate canonical roots, signed POF rows with stale post-sign queue state, enrollment packets whose status is completed but follow-up is not completed, and any lingering runtime use of legacy mar_entries. Output should be founder-readable and safe for recurring automation use.`

## 7. Founder Summary

The main chain is still structurally healthier than it used to be. I did not find a new wave of obvious orphan risks or duplicate-root regressions in the canonical lead-to-MAR path, and yesterday's care-plan readiness contradiction appears to be fixed in the current worktree.

The highest-risk issue today is a real regression in the public MHP sync RPC: it can silently recreate a missing MHP shell instead of failing. That weakens your canonical lifecycle contract because downstream sync can now hide an upstream provisioning failure. The other open structural gaps are mostly about database enforcement, not UI logic: a few physician-order relationships still rely on separate single-column foreign keys instead of one composite member/order constraint, and member medications still do not retain durable lineage back to the signed POF source that created them.

The next safe move is:

1. Re-lock the public MHP sync RPC so missing shells fail loudly.
2. Add the missing composite physician-order lineage foreign keys.
3. Add durable source lineage on `member_medications`.
4. Decide whether `mar_entries` should be retired or explicitly fenced as legacy.

This was an audit-only pass. It did not query live Supabase rows, so it cannot confirm whether bad historical records already exist in production.
