# Referential Integrity & Cascade Audit - 2026-04-11

Scope: static repo audit of schema, migrations, services, and tests for leads, enrollment packets, members, intake assessments, physician orders (POF), member health profiles, care plans, medications, and MAR records.

Limit: this run did not query live Supabase data, so "None" below means no structural regression was found in the repo contract, not that production tables were row-scanned.

## 1. Orphan Records Detected

None.

Why:
- Clinical lineage hardening enforces intake -> signatures/follow-up queue, POF -> pof_medications, and pof_medications -> MAR lineage with composite constraints in [`supabase/migrations/0127_clinical_lineage_enforcement.sql`](D:/Memory%20Lane%20App/supabase/migrations/0127_clinical_lineage_enforcement.sql).
- Enrollment packet downstream lineage is similarly enforced across mapping runs, uploads, conflicts, and follow-up queue in [`supabase/migrations/0140_enrollment_packet_lineage_enforcement.sql`](D:/Memory%20Lane%20App/supabase/migrations/0140_enrollment_packet_lineage_enforcement.sql).
- Care plan diagnosis lineage is enforced by composite FKs in [`supabase/migrations/0085_care_plan_diagnosis_relation.sql`](D:/Memory%20Lane%20App/supabase/migrations/0085_care_plan_diagnosis_relation.sql).

## 2. Missing Lifecycle Cascades

1. Enrollment packets can be durably marked `completed` before downstream mapping, artifact linkage, lead activity sync, and shell verification are complete.
   Evidence:
   - Public completion finalizes first with `mappingSyncStatus: "pending"` in [`lib/services/enrollment-packets-public-runtime.ts`](D:/Memory%20Lane%20App/lib/services/enrollment-packets-public-runtime.ts:187).
   - The post-commit cascade then repairs/creates the downstream work in [`lib/services/enrollment-packet-completion-cascade.ts`](D:/Memory%20Lane%20App/lib/services/enrollment-packet-completion-cascade.ts:330).
   - Repair candidates are explicitly re-queued for already-completed packets in [`lib/services/enrollment-packet-completion-cascade.ts`](D:/Memory%20Lane%20App/lib/services/enrollment-packet-completion-cascade.ts:499).
   Impact:
   - "Enrollment packet completed without full downstream member handoff" remains a supported degraded state, not a hard failure.

2. Signed POF can be durable while downstream MHP/MCC/MAR sync is only queued or retrying.
   Evidence:
   - The public post-sign outcome explicitly returns `postSignStatus: "queued"` when sync is not complete in [`lib/services/pof-post-sign-runtime.ts`](D:/Memory%20Lane%20App/lib/services/pof-post-sign-runtime.ts:121) and [`lib/services/pof-post-sign-runtime.ts`](D:/Memory%20Lane%20App/lib/services/pof-post-sign-runtime.ts:271).
   - Readiness logic says signed POF is not operationally ready while downstream sync is queued in [`lib/services/physician-order-clinical-sync.ts`](D:/Memory%20Lane%20App/lib/services/physician-order-clinical-sync.ts:91).
   Impact:
   - "POF signed without downstream MHP sync" is still a valid durable interim state.

3. Signed intake can be durable while draft POF creation/readback or member-file PDF persistence still needs follow-up.
   Evidence:
   - Intake post-sign workflow explicitly queues follow-up instead of failing the signed assessment in [`lib/services/intake-pof-mhp-cascade.ts`](D:/Memory%20Lane%20App/lib/services/intake-pof-mhp-cascade.ts:397).
   - Readiness logic marks these states as `queued_degraded` in [`lib/services/intake-post-sign-readiness.ts`](D:/Memory%20Lane%20App/lib/services/intake-post-sign-readiness.ts:50).
   Impact:
   - "Intake signed" does not always mean "intake -> draft POF -> member file cascade complete."

## 3. Duplicate Canonical Records

None found as new structural regressions.

Current duplicate guards still look correct:
- One member per `source_lead_id` and one care-plan root per `(member_id, track)` in [`supabase/migrations/0049_workflow_hardening_constraints.sql`](D:/Memory%20Lane%20App/supabase/migrations/0049_workflow_hardening_constraints.sql:85).
- One active enrollment packet per member and per lead episode in [`supabase/migrations/0152_enrollment_packet_lifecycle_and_voiding.sql`](D:/Memory%20Lane%20App/supabase/migrations/0152_enrollment_packet_lifecycle_and_voiding.sql:42).
- One draft/sent physician order per intake and one active POF request per order in [`supabase/migrations/0038_acid_uniqueness_guards.sql`](D:/Memory%20Lane%20App/supabase/migrations/0038_acid_uniqueness_guards.sql:237) and [`supabase/migrations/0181_physician_order_save_rpc_atomicity.sql`](D:/Memory%20Lane%20App/supabase/migrations/0181_physician_order_save_rpc_atomicity.sql:64).
- One MAR schedule per `(member_id, pof_medication_id, scheduled_time)` in [`supabase/migrations/0028_pof_seeded_mar_workflow.sql`](D:/Memory%20Lane%20App/supabase/migrations/0028_pof_seeded_mar_workflow.sql:35).

## 4. Lifecycle State Violations

None found as direct schema/service contradictions in the audited path.

Important nuance:
- The repo intentionally models several "durable but not ready" states for intake, enrollment completion, and POF post-sign sync. Those are not invalid transitions in code today, but they are operationally degraded states and should not be treated as fully complete.

## 5. Missing Constraints

1. `member_health_profiles.active_physician_order_id` is only constrained to `physician_orders(id)`, not `(active_physician_order_id, member_id) -> physician_orders(id, member_id)`.
   Evidence:
   - Base schema adds only the single-column FK in [`supabase/migrations/0006_intake_pof_mhp_supabase.sql`](D:/Memory%20Lane%20App/supabase/migrations/0006_intake_pof_mhp_supabase.sql:132).
   - Generated types confirm the relationship is only `active_physician_order_id -> physician_orders.id` in [`types/supabase-types.d.ts`](D:/Memory%20Lane%20App/types/supabase-types.d.ts:6411).
   Risk:
   - A bad write could point an MHP row at another member's physician order and the database would not block it.

2. `pof_requests` still constrains `physician_order_id` and `member_id` separately, but not as a composite lineage FK back to the same member-owned physician order.
   Evidence:
   - Table definition uses independent FKs in [`supabase/migrations/0019_pof_esign_workflow.sql`](D:/Memory%20Lane%20App/supabase/migrations/0019_pof_esign_workflow.sql:1).
   Risk:
   - A request row could theoretically pair a valid member with a valid physician order owned by a different member.

3. `member_medications` has no persisted source FK back to `physician_orders` or `pof_medications`, even though signed POF sync rebuilds it from physician-order data.
   Evidence:
   - Table shape only stores `member_id` lineage in [`supabase/migrations/0012_legacy_operational_health_alignment.sql`](D:/Memory%20Lane%20App/supabase/migrations/0012_legacy_operational_health_alignment.sql:79).
   - Signed POF sync repopulates member medications from the order payload in [`supabase/migrations/0043_delivery_state_and_pof_post_sign_sync_rpc.sql`](D:/Memory%20Lane%20App/supabase/migrations/0043_delivery_state_and_pof_post_sign_sync_rpc.sql:198).
   Risk:
   - Medication shell lineage is auditable only indirectly. The DB cannot prove which signed POF produced a given member-medication row.

## 6. Suggested Fix Prompts

1. Composite MHP active-order lineage
   Prompt:
   "Audit and harden the `member_health_profiles.active_physician_order_id` relationship so the active physician order must belong to the same member as the MHP row. Add the smallest forward-only Supabase migration that introduces any prerequisite unique constraint and then a composite FK from `(active_physician_order_id, member_id)` to `physician_orders(id, member_id)`. Update any affected write paths so signed-POF sync and MHP writes continue to pass cleanly. Do not add fallbacks. If preflight data cleanup is required, make the migration fail explicitly with a clear message."

2. Composite POF request lineage
   Prompt:
   "Harden `pof_requests` so a request cannot reference a physician order owned by a different member. Add a forward-only migration that backfills/validates existing rows, introduces any required supporting unique constraint, and adds a composite FK from `(physician_order_id, member_id)` to `physician_orders(id, member_id)`. Keep the existing canonical service/RPC flow intact and fail explicitly if mismatched historical rows exist."

3. Medication shell lineage from signed POF
   Prompt:
   "Make member-medication lineage auditable from signed physician orders without changing user-facing behavior. Add the smallest production-safe migration and service/RPC updates needed to persist a canonical source reference on `member_medications` back to the signed POF or canonical POF medication row that generated it. Preserve current MAR behavior, avoid duplicate write paths, and add regression tests proving the source linkage survives post-sign sync."

4. Enrollment completion hard guarantee review
   Prompt:
   "Review the enrollment packet completion workflow and determine whether `completed` should remain a durable-but-degraded state or whether completion should be blocked until downstream mapping, completed-packet artifact linkage, and shell verification succeed. If the current deferred model remains, add one canonical release-safety surface that clearly marks these packets as not operationally ready and tighten any missing system alerts/tests. If you change behavior, do it in the smallest safe way and preserve replay/idempotency."

5. Signed POF operational readiness contract
   Prompt:
   "Review the signed POF workflow and tighten the readiness contract so downstream MHP/MCC/MAR sync status is impossible to misread. Keep provider signature durable, but ensure canonical read models and UI state consistently distinguish `signed-but-queued` from `signed-and-operationally-ready`. Add or tighten tests around queued, failed, and synced post-sign states without introducing new write paths."

## 7. Founder Summary

The core parent/child schema is still materially stronger than it was before the lineage hardening work. I did not find a new broad regression that would obviously let intake rows point at missing members, MAR rows point at missing medications, or care-plan diagnoses point at missing parents inside the repo contract.

The real production risk is different: several workflows still allow upstream success before downstream handoff is fully complete. Today, a packet can be `completed` while mapping and artifact repair are still pending, a POF can be signed while MHP/MCC/MAR sync is queued, and an intake can be signed while draft POF or member-file follow-up is still open. That is survivable if operators and read models treat those states as degraded, but it is not the same as end-to-end completion.

The clean next step is to harden the remaining lineage anchors, especially:
- MHP active physician order -> same member
- POF request -> same member-owned physician order
- member_medications -> auditable source lineage from the signed POF
