# Memory Lane Referential Integrity & Cascade Audit

Date: 2026-04-17
Scope: Static repo/schema audit of canonical lead -> enrollment packet -> member -> intake -> POF -> MHP -> care plan -> medications -> MAR lineage
Method: Reviewed Supabase migrations, canonical services, workflow assertions, and current dirty-worktree runtime changes. This was not a live Supabase row scan, so findings below identify structural protections and structural gaps rather than current production row counts.

## 1. Orphan Records Detected

None structurally detected in the audited canonical schema contract for the prompt's core orphan risks:

- `intake_assessments.member_id -> members.id` via `supabase/migrations/0006_intake_pof_mhp_supabase.sql`
- `care_plan_diagnoses.(care_plan_id, member_id) -> care_plans.(id, member_id)` and `care_plan_diagnoses.(member_diagnosis_id, member_id) -> member_diagnoses.(id, member_id)` via `supabase/migrations/0085_care_plan_diagnosis_relation.sql`
- `pof_medications.(physician_order_id, member_id) -> physician_orders.(id, member_id)`, `mar_schedules.(pof_medication_id, member_id) -> pof_medications.(id, member_id)`, and `mar_administrations.(mar_schedule_id, pof_medication_id, member_id) -> mar_schedules.(id, pof_medication_id, member_id)` via `supabase/migrations/0127_clinical_lineage_enforcement.sql`
- Enrollment packet lineage children back to `enrollment_packet_requests.(id, member_id)` via `supabase/migrations/0140_enrollment_packet_lineage_enforcement.sql`

This means the specific example failures below still look structurally blocked by the current schema contract:

- intake referencing nonexistent member
- MAR referencing nonexistent medication
- care plan referencing nonexistent diagnosis

Note: this static audit cannot prove there are zero historical orphan rows already present in a live Supabase project.

## 2. Missing Lifecycle Cascades

1. `rpc_sync_member_health_profile_to_command_center` still silently recreates the MHP root instead of failing explicit repair.
   Evidence: `supabase/migrations/0206_fix_mhp_sync_member_id_ambiguity.sql:26-40` inserts `member_health_profiles` with `on conflict do nothing` before syncing MCC.
   Why it matters: downstream sync can mask an upstream lifecycle hole by recreating an MHP shell outside the canonical lead conversion or enrollment shell path.

2. Signed POF -> MHP/MCC/MAR remains a durable-but-not-ready cascade.
   Evidence: `lib/services/physician-order-clinical-sync.ts:41-48` and `:75-109` explicitly model signed physician orders as `pending`, `queued`, or `failed` until the post-sign queue finishes.
   Why it matters: "POF signed without downstream MHP sync" is still a valid committed state if queue health degrades or stalls.

3. Enrollment packet completion still commits before all downstream follow-up is complete.
   Evidence: `lib/services/enrollment-packet-completion-cascade.ts:367-428` records the completion milestone even when downstream mapping resolves to `failed`, operational shells are still missing, or lead activity still needs follow-up.
   Why it matters: "completed" does not always mean fully operationally ready, even though the member root is expected to exist.

## 3. Duplicate Canonical Records

None newly detected in the audited canonical chain. The main duplicate guards for the focused entities are still present:

- one member root per `source_lead_id` via `supabase/migrations/0049_workflow_hardening_constraints.sql:85-87`
- one active enrollment packet per member and per lead via `supabase/migrations/0152_enrollment_packet_lifecycle_and_voiding.sql:42-49`
- one MHP root per member via `supabase/migrations/0006_intake_pof_mhp_supabase.sql:132-135`
- one care-plan root per `member_id + track` via `supabase/migrations/0049_workflow_hardening_constraints.sql:93-94`
- one active POF request per physician order via `supabase/migrations/0038_acid_uniqueness_guards.sql:237-239`

Note: this was not a live row scan, so the audit cannot prove there are zero historical duplicates already persisted in production.

## 4. Lifecycle State Violations

1. Care-plan post-sign finalization is still internally contradictory when caregiver dispatch is pending.
   Evidence:
   - `lib/services/care-plans-supabase.ts:350-379` sets readiness to `signed_pending_caregiver_dispatch` and returns that pending state after auto-send.
   - `lib/services/care-plans-supabase.ts:578-579` still throws unless the reloaded row is already `ready`.
   - `lib/services/care-plans-supabase.ts:703-707` and `:844-847` still run that boundary assertion immediately after create/review completion.
   Impact: valid signed care plans with caregiver follow-up can still be treated as false failures even when the caregiver request was successfully sent.

2. Signed POF without completed downstream clinical sync remains a valid committed state.
   Evidence: `lib/services/physician-order-clinical-sync.ts:41-48` and `:91-109`.
   Assessment: intentional but still a lifecycle risk because downstream canonical readiness depends on queue completion after signature durability.

3. Completed enrollment packet without completed follow-up remains a valid committed state.
   Evidence: `lib/services/enrollment-packet-completion-cascade.ts:389-428`.
   Assessment: also intentional, but staff and downstream consumers must treat readiness separately from completion timestamp.

## 5. Missing Foreign Key Constraints

1. `member_health_profiles(active_physician_order_id, member_id) -> physician_orders(id, member_id)` is still missing.
   Current state: `supabase/migrations/0006_intake_pof_mhp_supabase.sql:132-153` only links `active_physician_order_id -> physician_orders.id`.
   Risk: an MHP row can point at an order from another member if application logic regresses.

2. `pof_requests(physician_order_id, member_id) -> physician_orders(id, member_id)` is still missing.
   Current state: `supabase/migrations/0019_pof_esign_workflow.sql:1-32` stores both columns but only enforces separate single-column foreign keys.
   Risk: a request row can preserve a cross-member mismatch while still satisfying independent FKs.

3. `pof_post_sign_sync_queue(physician_order_id, member_id) -> physician_orders(id, member_id)` is still missing.
   Current state: `supabase/migrations/0037_shared_rpc_standardization_lead_pof.sql:1-22` stores both columns but only enforces separate single-column foreign keys.
   Risk: queue rows can drift into a wrong member/order pairing while still looking relationally valid.

4. `member_medications` still has no durable FK or source columns back to the signed physician order or canonical `pof_medications` rows that produced it.
   Current state:
   - base table in `supabase/migrations/0012_legacy_operational_health_alignment.sql:79-97` stores only member-level medication fields
   - signed POF sync still does wholesale `delete` + `insert` by member in `supabase/migrations/0205_fix_signed_pof_sync_member_id_ambiguity.sql:180-219`
   Risk: downstream audits and repairs cannot prove which signed POF produced a medication row, which weakens reconciliation, dedupe, and MAR lineage debugging.

## 6. Suggested Fix Prompts

1. Fix the care-plan post-sign readiness contradiction.
   Prompt:
   `Audit lib/services/care-plans-supabase.ts and make the write-boundary assertion align with the intended caregiver-dispatch lifecycle. If caregiver dispatch is still pending after nurse signature, do not require post_sign_readiness_status to be ready in the same completion path. Preserve the committed-but-not-ready model, keep explicit action-required logging for true failures, and add regression coverage for create/review flows with caregiver contact.`

2. Restore strict MHP shell blocking in the MHP -> MCC sync RPC.
   Prompt:
   `Audit rpc_sync_member_health_profile_to_command_center in supabase/migrations/0206_fix_mhp_sync_member_id_ambiguity.sql and remove the runtime auto-insert of member_health_profiles rows. Keep the member_id ambiguity fix, but fail explicitly when the canonical MHP root is missing so downstream MCC sync cannot silently repair an upstream lifecycle hole. Add a regression test proving missing MHP shells raise an explicit error.`

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

The core relational chain is still mostly intact. The prompt's concrete orphan examples are structurally blocked by the current schema, and the main duplicate-root protections for members, enrollment packets, MHPs, care plans, and active POF requests are still in place.

The real production risks remain lifecycle and composite-lineage gaps, not obvious missing base FKs. The most urgent bug is still the care-plan post-sign contradiction: the code now treats caregiver dispatch as pending, but the same write path still insists readiness must already be `ready`, which can turn valid signed care plans into false failures. After that, the main architecture debt is still on the physician-order side: MHP sync can silently recreate a missing shell, `pof_requests` and post-sign queue rows still lack composite member/order enforcement, and `member_medications` still cannot be traced back to the signed POF rows that created them. The next safe step is to fix the care-plan contradiction first, then add the composite physician-order lineage constraints and medication source lineage in a focused migration pass.
