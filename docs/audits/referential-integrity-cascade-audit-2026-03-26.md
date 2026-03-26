# Referential Integrity & Cascade Audit

Date: 2026-03-26
Scope: static repo audit against Supabase migrations and canonical services for leads -> enrollment packets -> members -> intake assessments -> physician orders (POF) -> member health profiles -> care plans -> medications -> MAR
Limit: no live Supabase data was available in this run, so orphan/duplicate findings are limited to schema and canonical runtime guarantees rather than current production row counts.

## 1. Orphan Records Detected

None detected in the current static schema/runtime audit for the core direct relationships.

Confirmed hardening now exists for:
- intake -> member and intake child lineage
- POF -> member and POF-medication lineage
- MAR schedule/administration -> medication/member lineage
- care plan -> diagnosis/member lineage
- enrollment packet child tables -> packet/member lineage

Main evidence:
- `supabase/migrations/0127_clinical_lineage_enforcement.sql`
- `supabase/migrations/0140_enrollment_packet_lineage_enforcement.sql`
- `supabase/migrations/0085_care_plan_diagnosis_relation.sql`

## 2. Missing Lifecycle Cascades

1. POF signed can still exist before downstream clinical sync is complete.
Evidence:
- `rpc_finalize_pof_signature` marks the request signed in the same transaction that leaves post-sign sync in a queue-first state: `supabase/migrations/0053_artifact_drift_replay_hardening.sql`
- public/runtime truth is better than before because it returns `postSignStatus` and an action-needed message when sync is still queued: `lib/services/pof-post-sign-runtime.ts`
Risk:
- Any reader that keys off raw `physician_orders.status = 'signed'` or `pof_requests.status = 'signed'` without also checking post-sign sync truth can treat an unsynced POF as fully complete.

2. Enrollment packet filed can still exist before downstream mapping is complete.
Evidence:
- finalization writes `status = 'filed'` and `mapping_sync_status = 'pending'`: `supabase/migrations/0053_artifact_drift_replay_hardening.sql`
- canonical readiness helper distinguishes `filed_pending_mapping` from `operationally_ready`: `lib/services/enrollment-packet-readiness.ts`
Risk:
- Any consumer that reads raw filed/completed status instead of `mapping_sync_status` or readiness helpers can overstate downstream completion.

3. Intake signed can still exist before all post-sign follow-up is complete.
Evidence:
- follow-up queue exists for `draft_pof_creation` and `member_file_pdf_persistence`: `supabase/migrations/0106_enrollment_atomicity_and_intake_follow_up_queue.sql`, `lib/services/intake-post-sign-follow-up.ts`
- readiness helper correctly keeps signed intake out of fully ready state while follow-up is open: `lib/services/intake-post-sign-readiness.ts`
Risk:
- Any screen using signature state alone can misreport intake readiness.

4. Member shell cascade after conversion is materially improved.
Evidence:
- lead conversion now backfills `member_command_centers`, `member_attendance_schedules`, and `member_health_profiles`: `supabase/migrations/0148_restore_lead_conversion_mhp_and_member_shell_backfill.sql`
Status:
- prior “enrollment packet completed without member shell/MHP context” risk is reduced, but only if all conversion paths stay on the canonical RPC/service boundary.

## 3. Duplicate Canonical Records

None newly exposed in the current static audit.

Confirmed uniqueness guards:
- one member per lead: `supabase/migrations/0049_workflow_hardening_constraints.sql`
- one active enrollment packet per member: `supabase/migrations/0049_workflow_hardening_constraints.sql`
- one care-plan root per member/track: `supabase/migrations/0049_workflow_hardening_constraints.sql`
- one active signed POF per member: `supabase/migrations/0006_intake_pof_mhp_supabase.sql`
- one MHP per member: `supabase/migrations/0006_intake_pof_mhp_supabase.sql`
- one MAR schedule dose per member/medication/time and one administration per schedule: `supabase/migrations/0028_pof_seeded_mar_workflow.sql`

## 4. Lifecycle State Violations

1. Raw terminal states are still not sufficient truth by themselves.
This is a residual state-truth risk, not a broken canonical write path.

- POF:
  `signed` can mean “signature committed, post-sign MHP/MCC sync still queued”.
- Enrollment packet:
  `filed` can mean “submission committed, downstream mapping still pending”.
- Intake:
  `signed` can mean “signature committed, draft POF or member-file follow-up still pending”.

Canonical helpers exist for all three, so the violation risk is now at the reader/consumer layer rather than the core writer layer.

2. Care plan post-sign readiness looks materially hardened.
Evidence:
- explicit `post_sign_readiness_status` contract exists: `supabase/migrations/0112_care_plan_post_sign_readiness.sql`
- writes update readiness through canonical services: `lib/services/care-plans-supabase.ts`
Status:
- no new care-plan state violation was exposed in this run.

## 5. Missing Foreign Key Constraints

1. `members.latest_assessment_id` only points to `intake_assessments.id`, not `(assessment_id, member_id)` lineage.
Evidence:
- `supabase/migrations/0011_member_command_center_aux_schema.sql:6`
Risk:
- a member can point at another member's intake assessment if application logic drifts.

2. `member_command_centers.source_assessment_id` only points to `intake_assessments.id`, not `(assessment_id, member_id)` lineage.
Evidence:
- `supabase/migrations/0011_member_command_center_aux_schema.sql:53`
Risk:
- MCC can carry an assessment reference that belongs to a different member.

3. `member_health_profiles.source_assessment_id` only points to `intake_assessments.id`, not `(assessment_id, member_id)` lineage.
Evidence:
- `supabase/migrations/0016_member_health_profile_flat_fields.sql:65`
Risk:
- MHP can carry the wrong source assessment across members.

4. `member_health_profiles.active_physician_order_id` only points to `physician_orders.id`, not `(pof_id, member_id)` lineage.
Evidence:
- `supabase/migrations/0006_intake_pof_mhp_supabase.sql:135`
Risk:
- MHP can reference a physician order belonging to another member.

5. `pof_post_sign_sync_queue` only has simple foreign keys to `physician_orders.id` and `members.id`.
Evidence:
- `supabase/migrations/0037_shared_rpc_standardization_lead_pof.sql:1-4`
Risk:
- queued clinical-sync work can carry a mismatched member/order pair even though the main clinical tables are now composite-lineage hardened.

6. `pof_requests` also stores `physician_order_id` and `member_id` with only simple foreign keys.
Evidence:
- `supabase/migrations/0019_pof_esign_workflow.sql:2-4`
Risk:
- signature requests can drift into cross-member linkage if a non-canonical write path ever appears.

## 6. Suggested Fix Prompts

### Prompt 1. Add composite lineage FKs for assessment/order snapshot columns

Add a forward-only Supabase migration that hardens the remaining cross-member lineage gaps in the canonical clinical/member snapshot columns.

Scope:
- `members.latest_assessment_id`
- `member_command_centers.source_assessment_id`
- `member_health_profiles.source_assessment_id`
- `member_health_profiles.active_physician_order_id`

Requirements:
- Backfill or null out mismatched rows first instead of forcing unsafe constraints onto dirty data.
- Use composite foreign keys so the referenced assessment/order must belong to the same member:
  - `(latest_assessment_id, id)` -> `intake_assessments(id, member_id)`
  - `(source_assessment_id, member_id)` -> `intake_assessments(id, member_id)`
  - `(active_physician_order_id, member_id)` -> `physician_orders(id, member_id)`
- Add any supporting unique constraints only if required by FK shape.
- Validate constraints after cleanup.
- Do not add UI-side guards as a substitute for DB enforcement.

Manual retest:
- Try to persist a member/MCC/MHP row that points at another member’s assessment or physician order and confirm Postgres rejects it.

### Prompt 2. Harden sidecar queue lineage for signed POF follow-up

Add a forward-only migration that enforces canonical member/order lineage on `pof_post_sign_sync_queue` and `pof_requests`.

Requirements:
- Preflight for rows where `member_id` does not match `physician_orders.member_id`.
- Repair safe rows deterministically from the canonical physician order when possible.
- Add composite FKs:
  - `pof_post_sign_sync_queue(physician_order_id, member_id)` -> `physician_orders(id, member_id)`
  - `pof_requests(physician_order_id, member_id)` -> `physician_orders(id, member_id)`
- Keep existing idempotency and replay-safe token behavior intact.

Manual retest:
- Attempt to insert a queue/request row with a mismatched member/order pair and confirm the write fails.

### Prompt 3. Remove raw-status truth drift from enrollment and POF readers

Audit all enrollment-packet and POF read paths and replace any raw-status-only completion logic with canonical readiness truth.

Requirements:
- Enrollment packet readers must use `resolveEnrollmentPacketOperationalReadiness` or equivalent shared truth instead of treating `status in ('completed','filed')` as fully done.
- POF readers must expose post-sign sync truth and not treat raw `signed` as “fully synced” unless the queue/read model confirms sync completion.
- Intake readers must use the post-sign readiness helper rather than signature state alone.
- Keep the shared service/read-model boundary canonical; do not duplicate readiness logic in pages/components.
- Add regression tests that fail if a consumer regresses back to raw terminal-state checks.

Manual retest:
- Force mapping or post-sign sync failure and confirm UI/reporting stays truthful about pending follow-up.

## 7. Founder Summary

The good news: the repo is materially stronger than the last run. The biggest direct lineage holes in enrollment children and the POF -> medication -> MAR chain are now closed with composite foreign keys, and the lead -> member duplicate identity path is protected by a DB uniqueness guard.

The remaining risk is no longer “obvious missing FKs everywhere.” It is narrower: a few member snapshot fields and POF sidecar queue tables still rely on application logic to keep the referenced assessment/order on the same member, and raw `signed` / `filed` states still do not mean downstream work is finished unless readers also check the canonical readiness fields.

Safest next action:
- add the remaining composite lineage FKs for assessment/order snapshot columns and POF sidecar tables
- then do a narrow reader audit so no screen/report treats raw terminal status as full completion truth
