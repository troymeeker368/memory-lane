# Memory Lane Referential Integrity & Cascade Audit

Date: 2026-04-22
Scope: Static repo/schema audit of canonical lead -> enrollment packet -> member -> intake -> POF -> MHP -> care plan -> medications -> MAR lineage
Method: Reviewed Supabase migrations, generated schema types, and canonical service/readiness code in the current worktree. This was not a live Supabase row scan, so findings below identify structural protections and structural gaps rather than current production row counts.

## 1. Orphan Records Detected

None structurally detected for the prompt's core orphan risks.

The audited schema still blocks these examples at the database layer:

- `intake_assessments.member_id -> members.id` via `supabase/migrations/0006_intake_pof_mhp_supabase.sql`
- `care_plan_diagnoses.(care_plan_id, member_id) -> care_plans.(id, member_id)` and `care_plan_diagnoses.(member_diagnosis_id, member_id) -> member_diagnoses.(id, member_id)` via `supabase/migrations/0085_care_plan_diagnosis_relation.sql`
- `pof_medications.(physician_order_id, member_id) -> physician_orders.(id, member_id)` and MAR lineage constraints through `supabase/migrations/0127_clinical_lineage_enforcement.sql`
- enrollment packet lineage children back to `enrollment_packet_requests.(id, member_id)` via `supabase/migrations/0140_enrollment_packet_lineage_enforcement.sql`

That means these specific structural orphan examples still look blocked:

- intake referencing nonexistent member
- MAR referencing nonexistent medication
- care plan referencing nonexistent diagnosis

This static audit cannot prove there are zero historical orphan rows already present in the live Supabase project.

## 2. Missing Lifecycle Cascades

1. `rpc_sync_member_health_profile_to_command_center` still recreates an MHP shell instead of failing explicit repair.
   Evidence: `supabase/migrations/0206_fix_mhp_sync_member_id_ambiguity.sql` still inserts into `public.member_health_profiles` with `on conflict do nothing` before syncing MCC.
   Why it matters: MHP -> MCC sync can still mask an upstream lifecycle hole instead of forcing canonical shell repair.

2. Signed POF -> MHP/MCC/MAR remains a committed-but-not-ready cascade.
   Evidence: `lib/services/physician-order-clinical-sync.ts` still models signed POF state as `pending`, `queued`, `failed`, or `synced`, and explicitly says not to treat queued/failed sync as operationally ready.
   Why it matters: "POF signed without downstream MHP sync" remains a valid persisted state whenever queue processing stalls or fails.

3. Enrollment packet completion still commits before all follow-up is complete.
   Evidence: `supabase/migrations/0180_enrollment_completion_follow_up_state.sql` keeps `completion_follow_up_status` separate from packet completion, and `lib/services/enrollment-packet-completion-cascade.ts` still drives queued/action-required follow-up after the packet is already completed/filed.
   Why it matters: "enrollment packet completed without member creation" looks structurally less likely now because member lineage is enforced, but "completed and not fully downstream-ready" is still valid.

## 3. Duplicate Canonical Records

None newly detected in the audited canonical chain.

The main duplicate guards for the focused entities are still present:

- one member root per `members.source_lead_id` via `supabase/migrations/0049_workflow_hardening_constraints.sql`
- one active enrollment packet per lead/member episode via `supabase/migrations/0152_enrollment_packet_lifecycle_and_voiding.sql`
- one MHP root per member via `supabase/migrations/0006_intake_pof_mhp_supabase.sql`
- one active signed physician order per member via `supabase/migrations/0006_intake_pof_mhp_supabase.sql`
- one care-plan root per `member_id + track` via `supabase/migrations/0049_workflow_hardening_constraints.sql`

This static audit cannot prove there are zero historical duplicates already persisted in the live Supabase project.

## 4. Lifecycle State Violations

1. Care-plan post-sign finalization still contradicts the caregiver-dispatch lifecycle.
   Evidence:
   - `lib/services/care-plans-supabase.ts` sets `post_sign_readiness_status` to `signed_pending_caregiver_dispatch` when caregiver auto-send is still required.
   - The same file still throws unless the reloaded row is already `ready`.
   Impact: valid signed care plans can still be treated as failures even when the record correctly persisted and only caregiver follow-up remains.

2. Signed POF without completed downstream clinical sync remains a valid committed state.
   Evidence: `lib/services/physician-order-clinical-sync.ts`.
   Impact: provider signature durability is real, but downstream MHP/MCC/MAR readiness is still deferred and can require follow-up.

3. Completed enrollment packet without completed follow-up remains a valid committed state.
   Evidence: `supabase/migrations/0180_enrollment_completion_follow_up_state.sql` and `lib/services/enrollment-packet-completion-cascade.ts`.
   Impact: downstream consumers must not treat packet completion alone as lifecycle completion.

4. MHP -> MCC sync still allows silent shell recreation.
   Evidence: `supabase/migrations/0206_fix_mhp_sync_member_id_ambiguity.sql`.
   Impact: a missing canonical MHP shell can still be auto-repaired inside sync instead of failing loudly as a lifecycle violation.

## 5. Missing Foreign Key Constraints

1. `member_health_profiles(active_physician_order_id, member_id) -> physician_orders(id, member_id)` is still missing.
   Current state: `supabase/migrations/0006_intake_pof_mhp_supabase.sql` only links `active_physician_order_id -> physician_orders.id`.
   Risk: an MHP row can still point at an order belonging to a different member if application logic regresses.

2. `pof_requests(physician_order_id, member_id) -> physician_orders(id, member_id)` is still missing.
   Current state: `supabase/migrations/0019_pof_esign_workflow.sql` enforces separate single-column foreign keys only.
   Risk: a request row can preserve a cross-member mismatch while still satisfying independent FKs.

3. `pof_post_sign_sync_queue(physician_order_id, member_id) -> physician_orders(id, member_id)` is still missing.
   Current state: `supabase/migrations/0037_shared_rpc_standardization_lead_pof.sql` enforces separate single-column foreign keys only.
   Risk: queue rows can drift into a wrong member/order pairing while still appearing relationally valid.

4. `member_medications` still has no durable source lineage back to the physician order or `pof_medications` row that produced it.
   Current state:
   - `supabase/migrations/0195_member_command_center_shell_runtime_assertions.sql` still deletes and reinserts `member_medications` by `member_id`
   - generated schema types do not show source columns like `source_physician_order_id` or `source_pof_medication_id`
   Risk: downstream audits and repairs cannot prove which signed POF produced a medication row, which weakens reconciliation, dedupe, and MAR debugging.

## 6. Suggested Fix Prompts

1. Fix the care-plan post-sign readiness contradiction.
   Prompt:
   `Audit lib/services/care-plans-supabase.ts and make the post-sign write boundary match the intended caregiver-dispatch lifecycle. If caregiver dispatch is still pending after nurse signature, do not require post_sign_readiness_status to already be ready in the same completion path. Preserve committed-but-not-ready truth, keep explicit action-needed handling for real failures, and add regression coverage for create/review flows with caregiver contact.`

2. Restore strict missing-shell failure in the MHP -> MCC sync RPC.
   Prompt:
   `Audit supabase/migrations/0206_fix_mhp_sync_member_id_ambiguity.sql and remove the runtime auto-insert of member_health_profiles rows in rpc_sync_member_health_profile_to_command_center. Keep the member_id ambiguity fix, but fail explicitly when the canonical MHP shell is missing so downstream MCC sync cannot silently repair an upstream lifecycle hole. Add regression coverage proving missing MHP shells raise an explicit error.`

3. Add composite physician-order lineage foreign keys.
   Prompt:
   `Add a forward-only Supabase migration that hardens physician-order lineage with composite foreign keys: member_health_profiles(active_physician_order_id, member_id) -> physician_orders(id, member_id), pof_requests(physician_order_id, member_id) -> physician_orders(id, member_id), and pof_post_sign_sync_queue(physician_order_id, member_id) -> physician_orders(id, member_id). Backfill or fail loudly on mismatches before validating the constraints, and add any supporting composite indexes needed for production safety.`

4. Add durable source lineage to member medications.
   Prompt:
   `Design the smallest production-safe lineage hardening for member_medications so every row can be traced back to the signed physician order or canonical pof_medications row that generated it. Prefer adding source_physician_order_id and source_pof_medication_id with foreign keys and indexes, then update the signed-POF sync RPC to populate them deterministically. Do not keep member-level delete/reinsert behavior as the only lineage link.`

5. Add a live SQL audit pack for this automation.
   Prompt:
   `Create a deterministic Supabase SQL audit pack for the canonical lead -> enrollment -> member -> intake -> POF -> MHP -> care plan -> medications -> MAR chain. Include counts and sample IDs for orphan rows, composite lineage mismatches, duplicate canonical roots, signed POF rows with stale post-sign queue state, completed enrollment packets with incomplete follow-up, and care plans stuck in post-sign contradiction states. Output should be founder-readable and safe for recurring automation use.`

## 7. Founder Summary

The good news is that the obvious relational breakages in the core chain are still mostly blocked by the schema. The concrete orphan examples from the prompt still look structurally prevented: intake must point to a real member, care-plan diagnoses must belong to the same member/care-plan pair, and MAR rows still inherit medication/member lineage through composite constraints.

The remaining production risk is not "missing every foreign key." It is that several high-risk workflows are still allowed to be committed before the full downstream cascade is operationally ready, and some physician-order relationships still rely on app logic instead of composite database enforcement. The most urgent bug is still the care-plan post-sign contradiction. After that, the main architecture debt is physician-order lineage hardening: composite member/order FKs are still missing on MHP active order, POF requests, and the post-sign sync queue, and `member_medications` still cannot be traced back to the signed POF source row that created it. The next safe step is to fix the care-plan contradiction first, then harden the physician-order composite lineage and medication-source lineage in a focused migration pass.
