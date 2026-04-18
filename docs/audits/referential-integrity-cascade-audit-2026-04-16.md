# Memory Lane Referential Integrity & Cascade Audit

Date: 2026-04-16
Scope: Static repo/schema audit of canonical lead -> enrollment packet -> member -> intake -> POF -> MHP -> care plan -> medications -> MAR lineage
Method: Reviewed Supabase migrations, canonical RPC/service boundaries, and current dirty-worktree service changes. This was not a live production row scan, so findings below identify structural protections and structural gaps rather than current row counts.

## 1. Orphan Records Detected

None structurally detected in the audited canonical schema contract for:

- `intake_assessments.member_id -> members.id` via `supabase/migrations/0006_intake_pof_mhp_supabase.sql`
- `care_plan_diagnoses.(care_plan_id, member_id) -> care_plans.(id, member_id)` and `care_plan_diagnoses.(member_diagnosis_id, member_id) -> member_diagnoses.(id, member_id)` via `supabase/migrations/0085_care_plan_diagnosis_relation.sql`
- `pof_medications.(physician_order_id, member_id) -> physician_orders.(id, member_id)`, `mar_schedules.(pof_medication_id, member_id) -> pof_medications.(id, member_id)`, and `mar_administrations.(mar_schedule_id, pof_medication_id, member_id) -> mar_schedules.(id, pof_medication_id, member_id)` via `supabase/migrations/0127_clinical_lineage_enforcement.sql`
- Enrollment packet child tables back to `enrollment_packet_requests.(id, member_id)` via `supabase/migrations/0140_enrollment_packet_lineage_enforcement.sql`

This means the specific failure examples in the prompt still look structurally blocked:

- intake referencing nonexistent member
- MAR referencing nonexistent medication
- care plan referencing nonexistent diagnosis

Note: this was not a live Supabase row scan, so it cannot prove production currently has zero historical orphan rows.

## 2. Missing Lifecycle Cascades

1. `rpc_sync_member_health_profile_to_command_center` still recreates a missing MHP shell instead of failing explicit repair.
   Evidence: `supabase/migrations/0206_fix_mhp_sync_member_id_ambiguity.sql:26-40` inserts `member_health_profiles` with `on conflict do nothing` before syncing MCC.
   Why it matters: downstream sync can mask an upstream lifecycle hole by silently re-creating the MHP root.
   Impact: member lineage can look partially repaired downstream even when canonical lead conversion or explicit repair did not restore the missing MHP root deliberately.

2. Signed POF -> MHP/MCC/MAR remains a committed-but-not-ready cascade.
   Evidence: `lib/services/physician-order-clinical-sync.ts:40-48` and `:91-109` explicitly model `Signed` physician orders as `pending`, `queued`, or `failed` until the post-sign queue completes.
   Impact: "POF signed without downstream MHP sync" remains a reachable committed state. The UI labels it as not ready, but the lifecycle cascade is still incomplete until the queue finishes.

3. Enrollment packet completion still commits before all downstream follow-up is complete.
   Evidence: `lib/services/enrollment-packet-completion-cascade.ts:370-429` treats mapping, completed-packet artifact linkage, operational-shell readiness, notification delivery, and lead-activity sync as follow-up work after the packet is already in a completed/filed state.
   Impact: "enrollment packet completed" does not guarantee all downstream operational artifacts have finished, even though the member root itself is expected to exist.

## 3. Duplicate Canonical Records

None newly detected in the audited canonical chain. The schema still preserves the main duplicate guards for the audited entities:

- one member root per `source_lead_id` via `supabase/migrations/0049_workflow_hardening_constraints.sql:85-87`
- one active enrollment packet per member and per lead via `supabase/migrations/0152_enrollment_packet_lifecycle_and_voiding.sql:42-49`
- one MHP root per member via `supabase/migrations/0006_intake_pof_mhp_supabase.sql:132-135`
- one care-plan root per `member_id + track` via `supabase/migrations/0049_workflow_hardening_constraints.sql:93-94`
- one POF medication row per `physician_order_id + source_medication_id` and one MAR schedule row per `member_id + pof_medication_id + scheduled_time` via `supabase/migrations/0028_pof_seeded_mar_workflow.sql:1-27` and `:35-52`

Note: this was not a live row scan, so the audit cannot prove production currently has zero historical duplicates. It does confirm the schema contract still blocks broad new duplicate creation in the audited chain.

## 4. Lifecycle State Violations

1. Care-plan nurse-sign completion now appears internally inconsistent when caregiver contact exists.
   Evidence:
   - `lib/services/care-plans-supabase.ts:350-379` explicitly sets post-sign readiness to `signed_pending_caregiver_dispatch` and returns that pending state after auto-send.
   - `lib/services/care-plans-supabase.ts:578-579` then asserts the reloaded care plan must already be `ready`.
   Why this is a real regression: the same write path now says caregiver dispatch is still pending and also requires the row to be terminally ready. Those conditions cannot both be true for a plan with caregiver follow-up still open.
   Impact: care-plan create/review flows with caregiver contact are likely to throw a post-sign workflow error even when the care plan was committed and the caregiver request was actually sent.

2. Signed POF without completed downstream clinical sync remains a valid committed state.
   Evidence: `lib/services/physician-order-clinical-sync.ts:40-48` and `:75-109`.
   Assessment: this is intentional but still a lifecycle risk if queue health degrades or retries stall.

3. Completed enrollment packet without fully completed follow-up remains a valid committed state.
   Evidence: `lib/services/enrollment-packet-completion-cascade.ts:389-429`.
   Assessment: this is also intentional and guarded, but it means staff must treat follow-up readiness separately from the completion timestamp.

## 5. Missing Foreign Key Constraints

1. `member_health_profiles(active_physician_order_id, member_id) -> physician_orders(id, member_id)` is still missing.
   Current state: `supabase/migrations/0006_intake_pof_mhp_supabase.sql:132-153` only links `active_physician_order_id -> physician_orders.id`.
   Risk: an MHP row can point at an order from a different member if application logic regresses.

2. `pof_requests(physician_order_id, member_id) -> physician_orders(id, member_id)` is still missing.
   Current state: `supabase/migrations/0019_pof_esign_workflow.sql:1-32` stores both columns with separate single-column FKs only.
   Risk: a request row can preserve a cross-member mismatch while still satisfying independent foreign keys.

3. `pof_post_sign_sync_queue(physician_order_id, member_id) -> physician_orders(id, member_id)` is still missing.
   Current state: `supabase/migrations/0037_shared_rpc_standardization_lead_pof.sql:1-20` stores both columns with separate single-column FKs only.
   Risk: queue rows can drift into a wrong member/order pairing while still looking relationally valid.

4. `member_medications` still has no durable source FK back to the signed physician order or canonical `pof_medications` row that produced it.
   Current state: the signed-POF sync rewrites `member_medications`, but the table still lacks deterministic source lineage columns.
   Risk: audits and repairs cannot prove which signed POF produced a medication row, so downstream reconciliation and dedupe remain weaker than the MAR-side lineage.

## 6. Suggested Fix Prompts

1. Fix the care-plan post-sign readiness contradiction.
   Prompt:
   `Audit the care-plan nurse-sign completion path in lib/services/care-plans-supabase.ts and make the final boundary assertion match the intended caregiver-dispatch lifecycle. If caregiver dispatch is still pending after nurse signature, do not require post_sign_readiness_status to be ready in the same transaction. Preserve the committed-but-not-ready model, add a regression test for create/review flows with caregiver contact, and fail only on true state drift instead of expected intermediate status.`

2. Restore strict MHP shell-blocking in the MHP -> MCC sync RPC.
   Prompt:
   `Audit the Supabase function rpc_sync_member_health_profile_to_command_center and remove any runtime auto-insert of member_health_profiles rows. Keep the member_id ambiguity fix, but restore the stricter lifecycle behavior so the function fails explicitly when the canonical MHP root is missing. Add a regression test proving missing MHP roots raise explicit errors instead of being silently recreated during MCC sync.`

3. Add composite physician-order lineage FKs.
   Prompt:
   `Add a forward-only Supabase migration that hardens physician-order lineage with composite foreign keys: member_health_profiles(active_physician_order_id, member_id) -> physician_orders(id, member_id), pof_requests(physician_order_id, member_id) -> physician_orders(id, member_id), and pof_post_sign_sync_queue(physician_order_id, member_id) -> physician_orders(id, member_id). Backfill or fail loudly on mismatches before validating constraints. Use NOT VALID then VALIDATE for production safety and add the supporting composite indexes needed for query performance.`

4. Add durable source lineage to member medications.
   Prompt:
   `Design the smallest production-safe lineage hardening for member_medications so every row can be traced back to the signed physician order or canonical pof_medications row that generated it. Prefer adding source_physician_order_id and/or source_pof_medication_id plus foreign keys and indexes, then update the signed-POF sync RPC to populate them deterministically. Do not allow fallback inserts without lineage.`

5. Add a recurring live-data audit query pack for this automation.
   Prompt:
   `Create a deterministic Supabase SQL audit pack for the canonical lead -> enrollment -> member -> intake -> POF -> MHP -> care plan -> medications -> MAR chain. Include counts and sample IDs for orphan rows, composite lineage mismatches, duplicate canonical roots, signed POF rows with stale post-sign queue state, completed enrollment packets with incomplete follow-up, and care plans stuck in post-sign contradiction states. Output should be founder-readable and safe for recurring automation use.`

## 7. Founder Summary

The core lineage is still mostly intact. Intake, care-plan diagnosis links, POF medications, MAR schedules, MAR administrations, and enrollment-packet child tables still have meaningful FK coverage, and the main duplicate-root protections are still in place.

The highest-risk issue in this run is a new care-plan state contradiction. The current care-plan service now correctly treats caregiver dispatch as a pending post-sign step, but the same write path still asserts the plan must already be terminally ready. That likely turns valid committed care-plan writes into false failures whenever caregiver contact exists. After that, the biggest standing architecture gap is still cascade integrity: signed POFs and completed enrollment packets can remain durable while downstream work is still catching up, and MHP->MCC sync can still silently recreate a missing MHP shell instead of forcing an explicit repair.
