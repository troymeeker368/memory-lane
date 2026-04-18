# Memory Lane Referential Integrity & Cascade Audit

Date: 2026-04-12
Scope: Static repo/schema audit of canonical lead -> enrollment packet -> member -> intake -> POF -> MHP -> care plan -> medications -> MAR lineage
Method: Reviewed Supabase migrations, canonical RPC/service boundaries, and workflow-readiness guards. This was not a live production row scan, so findings below identify structural protections and structural gaps rather than current row counts.

## 1. Orphan Records Detected

None detected in the audited canonical schema contract for:

- `intake_assessments.member_id -> members.id`
- `physician_orders.member_id -> members.id`
- `member_health_profiles.member_id -> members.id`
- `care_plans.member_id -> members.id`
- `care_plan_diagnoses.(care_plan_id, member_id) -> care_plans.(id, member_id)`
- `care_plan_diagnoses.(member_diagnosis_id, member_id) -> member_diagnoses.(id, member_id)`
- `pof_medications.(physician_order_id, member_id) -> physician_orders.(id, member_id)`
- `mar_schedules.(pof_medication_id, member_id) -> pof_medications.(id, member_id)`
- `mar_administrations.(pof_medication_id, member_id) -> pof_medications.(id, member_id)`
- `mar_administrations.(mar_schedule_id, pof_medication_id, member_id) -> mar_schedules.(id, pof_medication_id, member_id)`
- `enrollment_packet` child tables back to `enrollment_packet_requests.(id, member_id)`

High-signal references:

- `supabase/migrations/0006_intake_pof_mhp_supabase.sql`
- `supabase/migrations/0085_care_plan_diagnosis_relation.sql`
- `supabase/migrations/0127_clinical_lineage_enforcement.sql`
- `supabase/migrations/0140_enrollment_packet_lineage_enforcement.sql`

## 2. Missing Lifecycle Cascades

1. `rpc_sync_member_health_profile_to_command_center` can recreate a missing `member_health_profiles` shell instead of failing explicit repair.
   Root cause: `0206_fix_mhp_sync_member_id_ambiguity.sql` reintroduced `insert into public.member_health_profiles ... on conflict do nothing` inside the MHP -> MCC sync path.
   Why it matters: this bypasses the stricter lifecycle rule added in `0194_member_command_center_shell_write_path_hardening.sql`, where downstream sync was supposed to fail if the canonical MHP root did not already exist.
   Impact: a member can look partially repaired downstream even though canonical lead conversion or explicit repair never recreated the missing MHP root correctly.

2. Signed POF -> MHP/MCC/MAR completion is still an asynchronous cascade, not an atomic terminal state.
   Evidence: the queue-backed post-sign flow in `0037_shared_rpc_standardization_lead_pof.sql` and readiness guards in `lib/services/physician-order-clinical-sync.ts` explicitly allow `Signed` POF rows while downstream sync is `pending`, `queued`, or `failed`.
   Impact: "POF signed without downstream MHP sync" is still a reachable committed state. The repo does guard it from being shown as operationally ready, but runner drift or persistent queue failures still leave the cascade incomplete.

3. Enrollment packet completion is durable before all downstream follow-up is complete.
   Evidence: `0180_enrollment_completion_follow_up_state.sql` marks packet completion first, then tracks `completion_follow_up_status` separately; `lib/services/enrollment-packet-readiness.ts` treats completed packets with pending follow-up as `queued_degraded`, not `ready`.
   Impact: "enrollment packet completed" no longer means all mapping/artifact follow-up finished. Member creation itself is structurally present because `enrollment_packet_requests.member_id` is required, but downstream packet-to-clinical readiness can still lag.

4. Intake signature -> draft POF/member-file readiness is still split across post-sign follow-up.
   Evidence: shared readiness tests and `lib/services/intake-post-sign-readiness.ts` explicitly model signed intake rows whose draft POF creation/readback or member-file verification remains pending or failed.
   Impact: signed intake can be durable before downstream physician-order readiness finishes.

## 3. Duplicate Canonical Records

None newly detected in the audited downstream canonical chain. The schema currently enforces the main duplicate guards for the audited entities:

- one member root per `source_lead_id`
- one active enrollment packet per member and per lead
- one MHP root per member
- one active signed POF per member
- one care-plan root per `member_id + track`
- one POF medication row per `physician_order_id + source_medication_id`
- one MAR schedule row per `member_id + pof_medication_id + scheduled_time`
- one scheduled MAR administration per `mar_schedule_id`

High-signal references:

- `supabase/migrations/0049_workflow_hardening_constraints.sql`
- `supabase/migrations/0152_enrollment_packet_lifecycle_and_voiding.sql`
- `supabase/migrations/0006_intake_pof_mhp_supabase.sql`
- `supabase/migrations/0028_pof_seeded_mar_workflow.sql`

Note: this was not a live row scan, so the audit cannot prove production currently has zero historical duplicates. It does confirm the schema contract still blocks broad new duplicate creation in the audited chain.

## 4. Lifecycle State Violations

1. Signed POF without completed downstream clinical sync remains a valid committed state.
   Evidence: `lib/services/physician-order-clinical-sync.ts` explicitly resolves these rows as `queued_degraded` or `follow_up_required`, not `ready`.
   Assessment: this is an intentional transitional state, not silent state spoofing. It is still a production risk if the queue/runner is unhealthy for too long.

2. Completed enrollment packet without fully completed follow-up remains a valid committed state.
   Evidence: `0180_enrollment_completion_follow_up_state.sql` and `lib/services/enrollment-packet-readiness.ts`.
   Assessment: this is also intentional and guarded. It is not a false-success bug for member creation, but it is a readiness/cascade lag that staff must treat as incomplete until follow-up finishes.

3. No structural evidence was found that a care plan can reference a nonexistent diagnosis.
   Evidence: `care_plan_diagnoses` requires both `(care_plan_id, member_id)` and `(member_diagnosis_id, member_id)` lineage, and `rpc_upsert_care_plan_core` rejects diagnosis IDs outside the member.

4. No structural evidence was found that an intake can reference a nonexistent member or that MAR can reference a nonexistent medication in the canonical MAR tables.
   Evidence: direct FKs plus the composite lineage constraints added in `0127_clinical_lineage_enforcement.sql`.

## 5. Missing Foreign Key Constraints

1. `member_health_profiles(active_physician_order_id, member_id) -> physician_orders(id, member_id)` is still missing.
   Current state: only `active_physician_order_id -> physician_orders.id` exists in `0006_intake_pof_mhp_supabase.sql`.
   Risk: an MHP row can point to a physician order from a different member if application logic regresses.

2. `pof_requests(physician_order_id, member_id) -> physician_orders(id, member_id)` is still missing.
   Current state: `pof_requests` links both columns separately in `0019_pof_esign_workflow.sql`, but not as one lineage constraint.
   Risk: request rows can become cross-member mismatched if code or repair scripts drift.

3. `pof_post_sign_sync_queue(physician_order_id, member_id) -> physician_orders(id, member_id)` is still missing.
   Current state: `0037_shared_rpc_standardization_lead_pof.sql` stores both columns, but only single-column FKs.
   Risk: post-sign queue rows can preserve a wrong member/order pairing while still satisfying independent FKs.

4. `member_medications` still has no durable source FK back to the signed POF or canonical POF medication row that produced it.
   Current state: the signed-POF sync rebuilds `member_medications` wholesale, but the table itself still only stores member-facing fields.
   Risk: audits cannot prove which signed POF produced a medication row, and downstream reconciliation/deduping remains weaker than the MAR-side lineage.

## 6. Suggested Fix Prompts

1. Restore strict MHP shell-blocking in the MHP -> MCC sync RPC.
   Prompt:
   `Audit the Supabase function rpc_sync_member_health_profile_to_command_center and remove any runtime auto-insert of member_health_profiles rows. Restore the stricter behavior from 0194_member_command_center_shell_write_path_hardening.sql so the function fails explicitly when the canonical MHP root is missing. Keep member_id ambiguity fixes, but do not allow downstream sync to create shells. Update or add regression tests proving missing MHP roots raise explicit errors instead of being silently recreated.`

2. Add composite lineage FKs for POF-linked tables.
   Prompt:
   `Add a forward-only Supabase migration that hardens physician-order lineage with composite foreign keys: member_health_profiles(active_physician_order_id, member_id) -> physician_orders(id, member_id), pof_requests(physician_order_id, member_id) -> physician_orders(id, member_id), and pof_post_sign_sync_queue(physician_order_id, member_id) -> physician_orders(id, member_id). Backfill or fail loudly on mismatches before validating constraints. Include covering indexes where needed and keep the migration production-safe using NOT VALID then VALIDATE.`

3. Add durable source lineage for member medications.
   Prompt:
   `Design the smallest production-safe lineage hardening for member_medications so every row can be traced back to the signed physician order or canonical POF medication row that generated it. Prefer adding source_physician_order_id and/or source_pof_medication_id plus appropriate foreign keys and indexes, then update the signed-POF sync RPC to populate them deterministically. Do not add fallback behavior; fail explicitly if source lineage cannot be established.`

4. Add a deterministic live-data audit query pack.
   Prompt:
   `Create a deterministic audit script or SQL query pack that can run against Supabase to count live referential-integrity violations for the canonical lead -> enrollment -> member -> intake -> POF -> MHP -> care plan -> medications -> MAR chain. Include checks for composite lineage mismatches, missing downstream artifacts, duplicate roots, and queued/failed post-sign cascades older than the operational threshold. Output should be founder-readable and safe for recurring automation use.`

## 7. Founder Summary

The good news is the core database lineage is still mostly solid. Intake, care-plan diagnosis links, POF medications, MAR schedules, MAR administrations, and enrollment-packet child tables all have meaningful FK coverage, and the main duplicate-root protections are still in place.

The biggest current risk is not broad orphaning. It is cascade integrity. Signed POFs and completed enrollment packets can still be durable before all downstream work is done, and that is acceptable only because the app now labels those states as not operationally ready. The most important regression is that the MHP -> MCC sync path can once again create a missing MHP shell instead of forcing an explicit repair. That weakens your canonical lifecycle contract and is the first fix I would make.
