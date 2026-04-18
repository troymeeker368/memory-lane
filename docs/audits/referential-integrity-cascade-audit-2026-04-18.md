# Memory Lane Referential Integrity & Cascade Audit

Date: 2026-04-18
Scope: Static repo/schema audit of canonical lead -> enrollment packet -> member -> intake -> POF -> MHP -> care plan -> medications -> MAR lineage
Method: Reviewed Supabase migrations, canonical services, workflow assertions, and current dirty-worktree runtime changes. This was not a live Supabase row scan, so findings below identify structural protections and structural gaps rather than current production row counts.

## 1. Orphan Records Detected

None structurally detected in the audited canonical schema contract for the prompt's core orphan risks:

- `intake_assessments.member_id -> members.id` via `supabase/migrations/0006_intake_pof_mhp_supabase.sql`
- `care_plan_diagnoses.(care_plan_id, member_id) -> care_plans.(id, member_id)` and `care_plan_diagnoses.(member_diagnosis_id, member_id) -> member_diagnoses.(id, member_id)` via `supabase/migrations/0085_care_plan_diagnosis_relation.sql`
- `mar_schedules.(pof_medication_id, member_id) -> pof_medications.(id, member_id)` and `mar_administrations.(mar_schedule_id, pof_medication_id, member_id) -> mar_schedules.(id, pof_medication_id, member_id)` via `supabase/migrations/0127_clinical_lineage_enforcement.sql`
- Enrollment packet lineage children back to `enrollment_packet_requests.(id, member_id)` via `supabase/migrations/0140_enrollment_packet_lineage_enforcement.sql`

This means the specific example failures below still look structurally blocked by the current schema contract:

- intake referencing nonexistent member
- MAR referencing nonexistent medication
- care plan referencing nonexistent diagnosis

Note: this static audit cannot prove there are zero historical orphan rows already present in the live Supabase project.

## 2. Missing Lifecycle Cascades

1. `rpc_sync_member_health_profile_to_command_center` still recreates an MHP shell instead of failing explicit repair.
   Evidence: `supabase/migrations/0206_fix_mhp_sync_member_id_ambiguity.sql` still inserts into `member_health_profiles` with `on conflict do nothing` before syncing MCC.
   Why it matters: downstream MHP -> MCC sync can still mask an upstream lifecycle hole instead of forcing canonical repair.

2. Signed POF -> MHP/MCC/MAR remains a durable-but-not-ready cascade.
   Evidence: `lib/services/physician-order-clinical-sync.ts` explicitly treats signed physician orders as `pending`, `queued`, or `failed` until post-sign sync finishes.
   Why it matters: "POF signed without downstream MHP sync" is still a valid committed state if queue processing stalls or errors.

3. Enrollment packet completion still commits before all downstream follow-up is complete.
   Evidence: `lib/services/enrollment-packet-completion-cascade.ts` records the submitted milestone even when mapping resolves to `failed`, member file linkage is incomplete, or operational shells are still missing.
   Why it matters: "completed" does not always mean fully operationally ready, even though the member root is expected to exist.

## 3. Duplicate Canonical Records

None newly detected in the audited canonical chain. The main duplicate guards for the focused entities are still present:

- one member root per `source_lead_id` via `supabase/migrations/0049_workflow_hardening_constraints.sql`
- one active enrollment packet per member and per lead via `supabase/migrations/0152_enrollment_packet_lifecycle_and_voiding.sql`
- one MHP root per member via `supabase/migrations/0006_intake_pof_mhp_supabase.sql`
- one active signed physician order per member via `supabase/migrations/0006_intake_pof_mhp_supabase.sql`
- one care-plan root per `member_id + track` via `supabase/migrations/0049_workflow_hardening_constraints.sql`

Note: this was not a live row scan, so the audit cannot prove there are zero historical duplicates already persisted in production.

## 4. Lifecycle State Violations

1. Care-plan post-sign finalization still contradicts the caregiver-dispatch state model.
   Evidence:
   - `lib/services/care-plans-supabase.ts` sets readiness to `signed_pending_caregiver_dispatch` when caregiver auto-send is still required.
   - The same file still throws unless the reloaded row is already `ready`.
   Impact: valid signed care plans with caregiver follow-up can still be treated as false failures even after successful dispatch.

2. Signed POF without completed downstream clinical sync remains a valid committed state.
   Evidence: `lib/services/physician-order-clinical-sync.ts`.
   Assessment: intentional, but still a production lifecycle risk because downstream canonical readiness depends on queue completion after provider signature durability.

3. Completed enrollment packet without completed follow-up remains a valid committed state.
   Evidence: `supabase/migrations/0180_enrollment_completion_follow_up_state.sql` and `lib/services/enrollment-packet-completion-cascade.ts`.
   Assessment: also intentional, but downstream consumers must use follow-up readiness rather than completion alone.

4. Caregiver resend hardening improved, but it did not resolve the care-plan readiness contradiction.
   Evidence: `supabase/migrations/0212_care_plan_caregiver_prepare_terminal_guard.sql` blocks invalid caregiver resend resets, while `lib/services/care-plans-supabase.ts` still requires final readiness to be `ready` immediately.
   Impact: the resend path is safer, but the core post-sign boundary mismatch remains open.

## 5. Missing Foreign Key Constraints

1. `member_health_profiles(active_physician_order_id, member_id) -> physician_orders(id, member_id)` is still missing.
   Current state: `supabase/migrations/0006_intake_pof_mhp_supabase.sql` only links `active_physician_order_id -> physician_orders.id`.
   Risk: an MHP row can point at an order from another member if application logic regresses.

2. `pof_requests(physician_order_id, member_id) -> physician_orders(id, member_id)` is still missing.
   Current state: `supabase/migrations/0019_pof_esign_workflow.sql` stores both columns but only enforces separate single-column foreign keys.
   Risk: a request row can preserve a cross-member mismatch while still satisfying independent FKs.

3. `pof_post_sign_sync_queue(physician_order_id, member_id) -> physician_orders(id, member_id)` is still missing.
   Current state: `supabase/migrations/0037_shared_rpc_standardization_lead_pof.sql` stores both columns but only enforces separate single-column foreign keys.
   Risk: queue rows can drift into a wrong member/order pairing while still looking relationally valid.

4. `member_medications` still has no durable FK or source columns back to the signed physician order or canonical `pof_medications` rows that produced it.
   Current state:
   - base table in `supabase/migrations/0012_legacy_operational_health_alignment.sql` stores only member-level medication fields
   - signed POF sync still does wholesale `delete` + `insert` by member in `supabase/migrations/0195_member_command_center_shell_runtime_assertions.sql`
   Risk: downstream audits and repairs cannot prove which signed POF produced a medication row, which weakens reconciliation, dedupe, and MAR lineage debugging.

## 6. Suggested Fix Prompts

1. Fix the care-plan post-sign readiness contradiction.
   Prompt:
   `Audit lib/services/care-plans-supabase.ts and make the write-boundary assertion align with the intended caregiver-dispatch lifecycle. If caregiver dispatch is still pending after nurse signature, do not require post_sign_readiness_status to be ready in the same completion path. Preserve the committed-but-not-ready model, keep explicit action-required logging for true failures, and add regression coverage for create/review flows with caregiver contact.`

2. Restore strict missing-shell failure in the MHP -> MCC sync RPC.
   Prompt:
   `Audit supabase/migrations/0206_fix_mhp_sync_member_id_ambiguity.sql and remove the runtime auto-insert of member_health_profiles rows in rpc_sync_member_health_profile_to_command_center. Keep the member_id ambiguity fix, but fail explicitly when the canonical MHP shell is missing so downstream MCC sync cannot silently repair an upstream lifecycle hole. Add a regression test proving missing MHP shells raise an explicit error.`

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

The core relational chain is still mostly intact. The prompt's concrete orphan examples are structurally blocked by the current schema, and the main duplicate-root protections for members, enrollment packets, MHPs, signed physician orders, and care plans are still in place.

The real production risks are still lifecycle and composite-lineage gaps, not obvious missing base FKs. The most urgent bug remains the care-plan post-sign contradiction: the code now explicitly allows `signed_pending_caregiver_dispatch`, but the same write path still insists the final row must already be `ready`, which can turn valid signed care plans into false failures. After that, the main architecture debt is still on the physician-order side: MHP sync can silently recreate a missing shell, `pof_requests` and post-sign queue rows still lack composite member/order enforcement, and `member_medications` still cannot be traced back to the signed POF rows that created them. The next safe step is to fix the care-plan contradiction first, then add composite physician-order lineage constraints and medication source lineage in a focused migration pass.
