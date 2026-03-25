# Memory Lane Referential Integrity & Cascade Audit

Date: 2026-03-25

Scope audited from repo schema and canonical services:
- leads
- enrollment packets
- members
- intake assessments
- physician orders (POF)
- member health profiles
- care plans
- medications
- MAR records

Method:
- Reviewed Supabase migrations as schema truth.
- Reviewed canonical runtime paths for enrollment packet filing, intake-to-POF creation, signed-POF sync, MHP/MCC sync, care-plan writes, and MAR documentation.
- This is a static repo audit. No live production data was queried, so "detected" findings are schema/runtime integrity gaps and state/cascade risks visible in code.

## 1. Orphan Records Detected

None confirmed from the repo alone.

What is already enforced:
- Intake -> member foreign key exists in [`supabase/migrations/0006_intake_pof_mhp_supabase.sql`](../../supabase/migrations/0006_intake_pof_mhp_supabase.sql).
- Care plan diagnoses -> member diagnosis/member/care plan composite lineage exists in [`supabase/migrations/0085_care_plan_diagnosis_relation.sql`](../../supabase/migrations/0085_care_plan_diagnosis_relation.sql).
- POF medications -> MAR schedules -> MAR administrations composite lineage exists in [`supabase/migrations/0127_clinical_lineage_enforcement.sql`](../../supabase/migrations/0127_clinical_lineage_enforcement.sql).

## 2. Missing Lifecycle Cascades

1. Enrollment packet filing is committed before downstream mapping is committed.
Evidence:
- `rpc_finalize_enrollment_packet_submission` sets `status = 'filed'` and `mapping_sync_status = 'pending'` before MCC/MHP/POF staging work is complete in [`supabase/migrations/0053_artifact_drift_replay_hardening.sql`](../../supabase/migrations/0053_artifact_drift_replay_hardening.sql).
- The application then runs `runEnrollmentPacketDownstreamMapping(...)` after that committed state in [`lib/services/enrollment-packets-public-runtime.ts`](../../lib/services/enrollment-packets-public-runtime.ts).
Impact:
- A packet can be operationally presented as completed/filed while downstream artifacts are still missing or failed.
- This matches the violation pattern "enrollment packet completed without downstream member handoff being complete."

2. Signed POF state is committed before MHP/MAR downstream sync is committed.
Evidence:
- `rpc_finalize_pof_signature` persists the signed request/order and returns a queue id in [`supabase/migrations/0053_artifact_drift_replay_hardening.sql`](../../supabase/migrations/0053_artifact_drift_replay_hardening.sql).
- Runtime explicitly treats the follow-up as best-effort and allows `postSignStatus: "queued"` with action needed in [`lib/services/pof-post-sign-runtime.ts`](../../lib/services/pof-post-sign-runtime.ts).
Impact:
- A physician order can be `signed` while MHP/MCC/MAR sync has not completed yet.
- This matches the violation pattern "POF signed without downstream MHP sync."

## 3. Duplicate Canonical Records

None newly exposed in current migrations.

Current protections found:
- One member per source lead: [`supabase/migrations/0049_workflow_hardening_constraints.sql`](../../supabase/migrations/0049_workflow_hardening_constraints.sql)
- One active enrollment packet per member: [`supabase/migrations/0049_workflow_hardening_constraints.sql`](../../supabase/migrations/0049_workflow_hardening_constraints.sql)
- One care-plan root per member/track: [`supabase/migrations/0049_workflow_hardening_constraints.sql`](../../supabase/migrations/0049_workflow_hardening_constraints.sql)
- One active signed physician order per member: [`supabase/migrations/0006_intake_pof_mhp_supabase.sql`](../../supabase/migrations/0006_intake_pof_mhp_supabase.sql)
- One member health profile per member: [`supabase/migrations/0006_intake_pof_mhp_supabase.sql`](../../supabase/migrations/0006_intake_pof_mhp_supabase.sql)
- One MAR schedule per member/medication/time and one scheduled administration per schedule: [`supabase/migrations/0028_pof_seeded_mar_workflow.sql`](../../supabase/migrations/0028_pof_seeded_mar_workflow.sql), [`supabase/migrations/0121_document_scheduled_mar_administration_rpc.sql`](../../supabase/migrations/0121_document_scheduled_mar_administration_rpc.sql)

## 4. Lifecycle State Violations

1. Enrollment packet `filed` currently means "signature/artifacts committed" but not necessarily "downstream mapping committed."
Why this is a state violation:
- The status name reads terminal.
- The actual implementation still allows `mapping_sync_status = 'pending'` or later `failed` after the request is already filed.

2. Physician order `signed` currently means "signature persisted" but not necessarily "clinical profile + MAR sync committed."
Why this is a state violation:
- The order is signed even when post-sign sync is only queued or has failed.
- Runtime messaging explicitly warns staff not to treat queued sync as fully synced.

## 5. Missing Constraints

1. `members.latest_assessment_id` is only keyed to `intake_assessments(id)`, not `(id, member_id)`.
Evidence:
- Added in [`supabase/migrations/0011_member_command_center_aux_schema.sql`](../../supabase/migrations/0011_member_command_center_aux_schema.sql)
Risk:
- A member can point at another member's intake assessment if application logic drifts.

2. `member_command_centers.source_assessment_id` is only keyed to `intake_assessments(id)`, not `(id, member_id)`.
Evidence:
- Added in [`supabase/migrations/0011_member_command_center_aux_schema.sql`](../../supabase/migrations/0011_member_command_center_aux_schema.sql)
Risk:
- MCC can claim intake lineage from the wrong member.

3. `member_health_profiles.source_assessment_id` is only keyed to `intake_assessments(id)`, not `(id, member_id)`.
Evidence:
- Added in [`supabase/migrations/0016_member_health_profile_flat_fields.sql`](../../supabase/migrations/0016_member_health_profile_flat_fields.sql)
Risk:
- MHP can claim intake lineage from the wrong member.

4. `member_health_profiles.active_physician_order_id` is only keyed to `physician_orders(id)`, not `(id, member_id)`.
Evidence:
- Defined in [`supabase/migrations/0006_intake_pof_mhp_supabase.sql`](../../supabase/migrations/0006_intake_pof_mhp_supabase.sql)
- Later clinical-lineage hardening did not extend composite lineage to MHP in [`supabase/migrations/0127_clinical_lineage_enforcement.sql`](../../supabase/migrations/0127_clinical_lineage_enforcement.sql)
Risk:
- MHP can point at another member's physician order and still satisfy the current FK.

## 6. Suggested Fix Prompts

1. Composite lineage hardening for MHP/MCC assessment and POF references

```text
Audit and harden Memory Lane's remaining cross-member lineage gaps in Supabase. Add production-safe composite uniqueness/FK enforcement so these pointers cannot reference records from another member:

- members.latest_assessment_id -> intake_assessments(id, member_id)
- member_command_centers.source_assessment_id -> intake_assessments(id, member_id)
- member_health_profiles.source_assessment_id -> intake_assessments(id, member_id)
- member_health_profiles.active_physician_order_id -> physician_orders(id, member_id)

Requirements:
- Use forward-only migrations.
- Backfill or null out mismatched rows before validating new constraints.
- Preserve existing service behavior where data is already correct.
- Update any canonical services/RPCs that need composite helper constraints or unique indexes to support the new FKs.
- Report any rows that would fail validation before enforcing.

Manual retest:
- Try wiring an intake or POF from member A onto member B through server actions/RPC paths and confirm the write fails explicitly.
```

2. Enrollment packet terminal-state hardening

```text
Fix Memory Lane's enrollment packet lifecycle so terminal packet status cannot get ahead of downstream member handoff. Today `rpc_finalize_enrollment_packet_submission` marks packets `filed` while downstream MCC/MHP/POF mapping is still only pending.

Implement the smallest production-safe fix that preserves replay safety:
- Keep caregiver signature/artifact persistence atomic.
- Introduce an explicit non-terminal post-sign state for "filed artifacts, mapping pending" OR move downstream mapping into a transaction-backed canonical boundary if feasible.
- Do not let the founder/staff-facing "completed/filed" state imply operational readiness until downstream mapping is committed.
- Keep action-required alerts and retry behavior for failed mapping.
- Update any listing/read-model logic that currently treats `filed` as operationally done.

Manual retest:
- Submit an enrollment packet, force downstream mapping failure, and confirm the UI/read models show a non-terminal blocked state instead of a terminal completed/filed state.
```

3. Signed POF terminal-state hardening

```text
Fix Memory Lane's physician-order post-sign cascade so a POF cannot look fully complete when downstream MHP/MCC/MAR sync is still queued or failed.

Current issue:
- `rpc_finalize_pof_signature` commits signed state first.
- Runtime follow-up treats downstream sync as best-effort and can leave the order signed while clinical sync is still pending.

Implement the smallest safe fix:
- Either introduce a distinct post-sign sync status/readiness field that is required for operational readiness, or move the required downstream sync into a stronger canonical transaction boundary where feasible.
- Preserve replay safety and signed artifact persistence.
- Ensure staff-facing screens clearly distinguish "signed" from "clinically synced".
- Keep retry queue behavior, but do not let downstream consumers assume signed == MHP/MAR current.

Manual retest:
- Sign a POF, force the post-sign sync queue to fail, and confirm the order remains visibly blocked from operational readiness until MHP/MAR sync succeeds.
```

## 7. Founder Summary

The good news: the repo now has strong protection against the exact orphan patterns you called out for intake, care-plan diagnoses, POF medications, MAR schedules, and MAR administrations. The 2026 clinical-lineage migration closed most of the dangerous child-to-parent gaps.

The remaining production risk is mostly about meaning, not missing tables:
- enrollment packets can be marked filed before downstream member handoff is finished
- signed POFs can exist before MHP/MAR sync is finished
- a few MHP/MCC lineage pointers still rely on app discipline instead of composite database enforcement

Safest next action:
- harden the four remaining composite lineage pointers first
- then tighten enrollment packet and POF terminal-state semantics so "done" only means downstream-ready
