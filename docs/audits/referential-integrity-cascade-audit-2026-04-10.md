# Referential Integrity & Cascade Audit
Generated: 2026-04-10T05:08:00-04:00
Repository: D:\Memory Lane App
Mode: Static schema + canonical service audit

## 1. Orphan Records Detected

None confirmed in this repo-only audit.

Static evidence reviewed:
- `intake_assessments.member_id -> members.id` is enforced in `0006_intake_pof_mhp_supabase.sql`.
- `care_plan_diagnoses` uses composite lineage FKs to both `care_plans(id, member_id)` and `member_diagnoses(id, member_id)` in `0085_care_plan_diagnosis_relation.sql`.
- MAR lineage is hardened with composite constraints in `0127_clinical_lineage_enforcement.sql`, including:
  - `pof_medications(physician_order_id, member_id) -> physician_orders(id, member_id)`
  - `mar_schedules(pof_medication_id, member_id) -> pof_medications(id, member_id)`
  - `mar_administrations(mar_schedule_id, pof_medication_id, member_id) -> mar_schedules(id, pof_medication_id, member_id)`
- Enrollment packet child tables are tied back to `(packet_id, member_id)` through `0140_enrollment_packet_lineage_enforcement.sql`.

Important limit:
- This run did not query live Supabase data, so this section confirms the current code/schema contract, not current production row contents.

## 2. Missing Lifecycle Cascades

### A. Signed POF can still be durable while downstream MHP/MCC/MAR sync is queued
- Status: Real cascade gap, still present by design.
- Evidence:
  - `lib/services/physician-order-post-sign-service.ts` explicitly returns `postSignStatus: "queued"` and warns staff not to treat the order as operationally ready yet.
  - `supabase/migrations/0037_shared_rpc_standardization_lead_pof.sql` defines `pof_post_sign_sync_queue`.
- Operational impact:
  - A physician order can be signed while downstream clinical state is still catching up.
  - This is not hidden anymore, but it is still a real cascade lag.

### B. Signed intake can still complete while draft POF creation or member-file verification needs follow-up
- Status: Real cascade gap, still present by design.
- Evidence:
  - `lib/services/intake-pof-mhp-cascade.ts` returns `draftPofStatus: "failed"` or a follow-up-needed result after the intake is already committed.
  - `supabase/migrations/0106_enrollment_atomicity_and_intake_follow_up_queue.sql` defines `intake_post_sign_follow_up_queue`.
- Operational impact:
  - Intake success does not always mean the downstream physician-order handoff is ready.

### C. Recent regression: MHP-to-MCC sync now recreates a missing MHP shell instead of failing explicitly
- Status: New structural regression.
- Evidence:
  - `supabase/migrations/0194_member_command_center_shell_write_path_hardening.sql` required `rpc_sync_member_health_profile_to_command_center` to fail when `member_health_profiles` was missing.
  - `supabase/migrations/0206_fix_mhp_sync_member_id_ambiguity.sql` changed that function to `insert into public.member_health_profiles (...) on conflict do nothing` before syncing.
- Why this matters:
  - It weakens the canonical lifecycle rule that MHP sync must not manufacture shell rows during runtime.
  - If this RPC is invoked out of sequence, it can mask a missing upstream artifact instead of surfacing the real failure.

## 3. Duplicate Canonical Records

None confirmed in the current schema contract.

Static duplicate guards reviewed:
- `member_health_profiles.member_id` is unique.
- `enrollment_packet_requests` has active uniqueness per member and per lead in `0152_enrollment_packet_lifecycle_and_voiding.sql`.
- `care_plans(member_id, track)` is unique in `0049_workflow_hardening_constraints.sql`.
- `pof_medications(physician_order_id, source_medication_id)` is unique in `0028_pof_seeded_mar_workflow.sql`.
- `mar_schedules(member_id, pof_medication_id, scheduled_time)` is unique in `0028_pof_seeded_mar_workflow.sql`.
- `mar_administrations(mar_schedule_id)` is unique when non-null in `0028_pof_seeded_mar_workflow.sql`.

## 4. Lifecycle State Violations

None confirmed as persisted rows in this repo-only audit.

Notes:
- Enrollment packet finalization is transition-gated in RPCs and now has coupled status metadata checks in `0162_enrollment_packet_status_coupled_constraints.sql`.
- Care plan caregiver signature finalization is transition-gated in RPCs.
- The strongest lifecycle weakness in this pass is not a confirmed bad state row; it is the Section 2C regression that can hide a missing MHP artifact by auto-creating a shell row.

## 5. Missing Constraints

### A. `pof_post_sign_sync_queue` is missing composite lineage enforcement back to physician orders
- Current state:
  - `supabase/migrations/0037_shared_rpc_standardization_lead_pof.sql` defines:
    - `physician_order_id uuid not null unique references public.physician_orders(id)`
    - `member_id uuid not null references public.members(id)`
  - But unlike the MAR lineage hardening in `0127_clinical_lineage_enforcement.sql`, there is no composite FK on `(physician_order_id, member_id) -> physician_orders(id, member_id)`.
- Risk if left as-is:
  - A drifted writer could create a post-sign queue row whose `member_id` does not actually belong to the queued physician order.
  - That would make retries, alerts, and readiness reporting point at the wrong member context.

## 6. Suggested Fix Prompts

### Prompt 1: Restore explicit MHP shell protection
Implement a production-safe fix for the `rpc_sync_member_health_profile_to_command_center` regression introduced in `supabase/migrations/0206_fix_mhp_sync_member_id_ambiguity.sql`.

Requirements:
- Restore the canonical rule from `0194_member_command_center_shell_write_path_hardening.sql`: if `member_health_profiles` is missing for the member, the RPC must fail explicitly instead of inserting a shell row.
- Do not break the signed-POF path that already upserts the real MHP payload before MCC sync.
- Keep the member-id ambiguity fix from `0206`; only remove the shell-creation behavior.
- Add or update a migration only; do not rely on UI guards.
- Confirm downstream impact on signed POF sync, intake follow-up, and MCC refresh behavior.
- Include a short manual retest checklist for:
  1. normal signed POF sync
  2. missing-MHP repair case
  3. MCC sync failure path

### Prompt 2: Add composite lineage FK for `pof_post_sign_sync_queue`
Add a forward-only Supabase migration that hardens `pof_post_sign_sync_queue` so queue rows cannot drift away from the physician order's canonical member.

Requirements:
- Add any prerequisite unique constraint needed on `physician_orders(id, member_id)` only if it is not already present in the live schema.
- Add a composite FK on `pof_post_sign_sync_queue(physician_order_id, member_id) -> physician_orders(id, member_id)`.
- Use a production-safe pattern:
  - backfill/check existing mismatches first
  - fail loudly if mismatches exist
  - add the FK as `NOT VALID`
  - then `VALIDATE CONSTRAINT`
- Add any covering index needed for the new FK.
- Explain downstream protection for retry workers, alerts, and operational readiness reporting.

### Prompt 3: Tighten readiness truth for signed POF and signed intake
Implement a small canonical read-model hardening pass so committed records are never misread as downstream-ready.

Requirements:
- Reuse existing queue/follow-up truth instead of inventing new statuses.
- For physician orders, standardize all detail/read models on the existing post-sign queue status so `signed` is clearly distinct from `synced`.
- For intake assessments, standardize all detail/read models on `draft_pof_status` plus `intake_post_sign_follow_up_queue`.
- Do not add duplicate readiness logic in UI components; keep it in shared read-model/helpers.
- Add regression coverage for:
  1. signed POF with queued sync
  2. intake signed with failed draft POF creation
  3. successful fully-ready path

## 7. Founder Summary

The good news: the core schema is materially stronger than earlier audit runs. I did not find a new broad orphan-record or duplicate-record regression in the lead -> enrollment -> member -> intake -> POF -> MHP -> care plan -> MAR chain. Most of the scary examples you called out are now blocked by composite foreign keys or uniqueness rules.

The two things that still matter are:
- signed intake and signed POF can still be committed before all downstream work is operationally ready, although the system now surfaces that state instead of hiding it
- a newer MHP/MCC sync migration weakened a previous guardrail by allowing a missing MHP shell row to be auto-created during sync

Safest next action:
- fix the MHP shell regression first
- then add the missing composite lineage FK on `pof_post_sign_sync_queue`
- after that, rerun this audit against live Supabase data to confirm there are no real mismatched rows already in production
