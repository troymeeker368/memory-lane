# Production Readiness System Map

Date: 2026-03-15
Scope: full-system inventory before repo-wide production hardening and refactor
Method: static repo scan of `app/`, `lib/services/`, `lib/actions/`, `supabase/migrations/`, and `tests/`

## Purpose

This document is the mandatory pre-refactor map for Memory Lane. It identifies:

- workflow entry points
- server action hubs
- canonical service owners
- canonical tables
- shared RPC / transaction boundaries
- direct database write hotspots
- file/storage paths
- email/notification paths
- cross-domain sync points
- initial idempotency / concurrency / observability / migration-safety posture

## Raw Inventory Artifacts Generated During This Audit

These machine-generated inventories were produced in the workspace and used to build this map:

- `.tmp_server_action_functions.txt`
- `.tmp_rpc_calls.txt`
- `.tmp_db_writes.txt`
- `.tmp_storage_paths.txt`
- `.tmp_delivery_paths.txt`
- `.tmp_cross_domain_syncs.txt`

They should be treated as the exhaustive raw scan baseline for this audit pass.

## System-Wide Inventory Summary

- Workflow entry-point files discovered in `app/`: portal pages, public signature pages, auth routes, internal API route, and action files across sales, health, operations, members, notifications, billing, and HR/time.
- Server-action/exported async function inventory: 229 action/helper functions discovered in `app/**`.
- RPC usage discovered in runtime code: 6 direct `client.rpc(...)` callsites plus shared-wrapper RPC usage in lead conversion, physician order signing, and POF signing.
- Direct database write callsites discovered in `app/` + `lib/`: 100 matched write hotspots.
- File/storage path callsites discovered: 12.
- Email/notification delivery callsites discovered: 82.

## Domain Map

### 1. Sales / Lead Management

- Workflow entry points:
  - `app/sales-actions.ts`
  - `app/actions.ts` legacy sales actions
  - `app/(portal)/sales/**/page.tsx`
  - `app/(portal)/sales/new-entries/**/page.tsx`
- Canonical source-of-truth tables:
  - `leads`
  - `lead_activities`
  - `lead_stage_history`
  - `community_partner_organizations`
  - `referral_sources`
  - `partner_activities`
  - `audit_logs`
- Canonical service owners:
  - `lib/services/sales-crm-supabase.ts`
  - `lib/services/sales-lead-stage-supabase.ts`
  - `lib/services/sales-lead-conversion-supabase.ts`
  - `lib/services/sales-lead-activities.ts`
  - `lib/services/canonical-person-ref.ts`
- Canonical RPC / transaction boundaries:
  - `rpc_convert_lead_to_member`
  - `rpc_create_lead_with_member_conversion`
  - legacy fallbacks: `apply_lead_stage_transition_with_member_upsert`, `create_lead_with_member_conversion`
- Downstream dependents:
  - `members`
  - enrollment packet workflows
  - member command center
  - MHP / POF / care plan workflows after conversion
- Cross-domain sync points:
  - lead -> member conversion
  - lead -> enrollment packet send
  - lead activity logging after enrollment packet completion
- Idempotency / duplicate posture:
  - DB hardening exists for `members.source_lead_id` in `0049_workflow_hardening_constraints.sql`
  - conversion path is RPC-backed, but legacy action and audit paths still need consistency review

### 2. Enrollment Packet Workflow

- Workflow entry points:
  - `app/sales-actions.ts::sendEnrollmentPacketAction`
  - `app/sign/enrollment-packet/[token]/actions.ts`
  - `components/sales/send-enrollment-packet-action.tsx`
  - `components/enrollment-packets/enrollment-packet-public-form.tsx`
- Canonical source-of-truth tables:
  - `enrollment_packet_requests`
  - `enrollment_packet_fields`
  - `enrollment_packet_signatures`
  - `enrollment_packet_uploads`
  - `enrollment_packet_events`
  - `enrollment_packet_mapping_runs`
  - `enrollment_packet_mapping_records`
  - `enrollment_packet_pof_staging`
  - `member_files`
- Canonical service owners:
  - `lib/services/enrollment-packets.ts`
  - `lib/services/enrollment-packet-intake-mapping.ts`
  - `lib/services/enrollment-packet-intake-staging.ts`
  - `lib/services/member-files.ts`
- Canonical RPC / transaction boundaries:
  - `rpc_finalize_enrollment_packet_request_completion`
  - send path is service-backed but not RPC-backed end-to-end
  - downstream mapping is still service-orchestrated and rollback-based
- Downstream dependents:
  - `members`
  - `member_command_centers`
  - `member_attendance_schedules`
  - `member_contacts`
  - `member_health_profiles`
  - `enrollment_packet_pof_staging`
  - `lead_activities`
  - `member_files`
  - `system_events`
  - `user_notifications`
- Cross-domain sync points:
  - lead/member canonical resolution
  - public packet completion -> downstream mapping -> member files -> lead activity -> workflow events
- Idempotency / duplicate posture:
  - active-packet uniqueness is DB-backed in `0049_workflow_hardening_constraints.sql`
  - service pre-check exists in `sendEnrollmentPacketRequest`
  - completion path still has split storage/mapping/finalization phases and repair-state behavior

### 3. Intake Assessment

- Workflow entry points:
  - `app/actions.ts::createAssessmentAction`
  - `app/(portal)/health/assessment/page.tsx`
  - `app/(portal)/health/assessment/[assessmentId]/actions.ts`
- Canonical source-of-truth tables:
  - `intake_assessments`
  - `assessment_responses`
  - `intake_assessment_signatures`
  - `member_files`
- Canonical service owners:
  - `lib/services/intake-pof-mhp-cascade.ts`
  - `lib/services/intake-assessment-esign.ts`
  - `lib/services/clinical-esign-artifacts.ts`
- Canonical RPC / transaction boundaries:
  - `rpc_create_intake_assessment_with_responses` now provides one atomic boundary for the base assessment row plus `assessment_responses`
  - `rpc_finalize_intake_assessment_signature` now provides one atomic DB boundary for `intake_assessment_signatures` + `intake_assessments`
  - draft-POF follow-up is still sequential and not one end-to-end transaction
- Downstream dependents:
  - `physician_orders` draft creation
  - intake PDF member files
  - workflow events
- Cross-domain sync points:
  - signed intake -> draft POF creation
- Idempotency / duplicate posture:
  - `draft_pof_status` / `draft_pof_attempted_at` / `draft_pof_error` added in `0049`
  - base assessment create + responses is now one RPC-backed transaction
  - signature DB finalization is now RPC-backed with replay-safe signed-state gating
  - full create + sign + draft-POF cascade still needs a wider atomic boundary

### 4. Physician Orders / POF

- Workflow entry points:
  - `app/(portal)/health/physician-orders/actions.ts`
  - `app/(portal)/operations/member-command-center/pof-actions.ts`
  - `app/sign/pof/[token]/actions.ts`
  - `app/api/internal/pof-post-sign-sync/route.ts`
- Canonical source-of-truth tables:
  - `physician_orders`
  - `pof_requests`
  - `pof_signatures`
  - `document_events`
  - `member_files`
  - `pof_post_sign_sync_queue`
  - `pof_medications`
  - `mar_schedules`
- Canonical service owners:
  - `lib/services/physician-orders-supabase.ts`
  - `lib/services/pof-esign.ts`
  - `lib/services/mar-workflow.ts`
  - `lib/services/member-files.ts`
- Canonical RPC / transaction boundaries:
  - `rpc_sign_physician_order`
  - `rpc_finalize_pof_signature`
  - `rpc_sync_signed_pof_to_member_clinical_profile`
- Downstream dependents:
  - MHP
  - MCC visibility
  - `pof_medications`
  - `mar_schedules`
  - signed PDF member file
  - notifications / workflow milestones
- Cross-domain sync points:
  - signed POF -> clinical profile sync -> medication propagation -> MAR schedule generation
  - internal retry route for queued post-sign sync
- Idempotency / duplicate posture:
  - active POF request uniqueness is handled in service + DB constraint messaging
  - post-sign sync is queue-backed and recoverable, but runner/config must stay healthy

### 5. Member Health Profile (MHP)

- Workflow entry points:
  - `app/(portal)/health/member-health-profiles/actions.ts`
  - `app/(portal)/health/member-health-profiles/[memberId]/page.tsx`
- Canonical source-of-truth tables:
  - `member_health_profiles`
  - `member_diagnoses`
  - `member_medications`
  - `member_allergies`
  - `member_providers`
  - `member_equipment`
  - `member_notes`
  - provider directory support tables
- Canonical service owners:
  - `lib/services/member-health-profiles-supabase.ts`
  - `lib/services/member-health-profiles-write-supabase.ts`
- Canonical RPC / transaction boundaries:
  - no single RPC for full parent/child sync
  - child writes are service CRUD
- Downstream dependents:
  - MCC
  - MAR medication/schedule generation
  - reporting / print artifacts
- Cross-domain sync points:
  - MHP overview/legal/etc. -> MCC sync
  - MHP medications -> MAR sync
- Idempotency / duplicate posture:
  - child-row CRUD is service-backed
  - bulk parent/child consistency still depends on action sequencing

### 6. Care Plans

- Workflow entry points:
  - `app/care-plan-actions.ts`
  - `app/(portal)/health/care-plans/[carePlanId]/actions.ts`
  - `app/sign/care-plan/[token]/actions.ts`
- Canonical source-of-truth tables:
  - `care_plans`
  - `care_plan_sections`
  - `care_plan_versions`
  - `care_plan_review_history`
  - `care_plan_signature_events`
  - `member_files`
- Canonical service owners:
  - `lib/services/care-plans-supabase.ts`
  - `lib/services/care-plan-esign.ts`
  - `lib/services/care-plan-nurse-esign.ts`
- Canonical RPC / transaction boundaries:
  - `rpc_finalize_care_plan_caregiver_signature`
  - create/review path itself is still service-orchestrated with rollback/delete patterns
- Downstream dependents:
  - signed/final care plan member files
  - signature events
  - notifications / workflow milestones
- Cross-domain sync points:
  - create/review -> nurse signature -> caregiver dispatch -> caregiver sign -> final artifact filing
- Idempotency / duplicate posture:
  - `care_plans(member_id, track)` uniqueness is DB-backed in `0049`
  - caregiver finalization is RPC-backed
  - pre-finalization storage and draft signature state remain split

### 7. MAR / Medication Administration

- Workflow entry points:
  - `app/(portal)/health/mar/actions.ts`
  - `app/(portal)/health/mar/page.tsx`
- Canonical source-of-truth tables:
  - `pof_medications`
  - `mar_schedules`
  - `mar_administrations`
- Canonical service owners:
  - `lib/services/mar-workflow.ts`
  - `lib/services/mar-monthly-report.ts`
  - `lib/services/mar-monthly-report-pdf.ts`
- Canonical RPC / transaction boundaries:
  - none for schedule regeneration
  - documentation writes are service CRUD with DB uniqueness on `mar_administrations(mar_schedule_id)`
- Downstream dependents:
  - member files for monthly reports
  - workflow events / notifications
- Cross-domain sync points:
  - signed POF / MHP meds -> `pof_medications` -> `mar_schedules`
- Idempotency / duplicate posture:
  - duplicate scheduled administration is DB-constrained
  - schedule regeneration is multi-step and still non-transactional

### 8. Member Command Center / Operations

- Workflow entry points:
  - `app/(portal)/operations/member-command-center/actions.ts`
  - `app/(portal)/operations/attendance/actions.ts`
  - `app/(portal)/operations/transportation-station/actions.ts`
  - `app/(portal)/operations/holds/actions.ts`
  - `app/(portal)/operations/locker-assignments/actions.ts`
  - `app/(portal)/operations/schedule-changes/actions.ts`
  - `app/(portal)/operations/pricing/actions.ts`
  - `app/(portal)/operations/payor/actions.ts`
- Canonical source-of-truth tables:
  - `member_command_centers`
  - `member_attendance_schedules`
  - `member_contacts`
  - `member_files`
  - `member_holds`
  - `attendance_records`
  - `transportation_manifest_adjustments`
  - pricing / billing tables
- Canonical service owners:
  - `lib/services/member-command-center-supabase.ts`
  - `lib/services/attendance-workflow-supabase.ts`
  - `lib/services/transportation-station-supabase.ts`
  - `lib/services/holds-supabase.ts`
  - `lib/services/schedule-changes-supabase.ts`
  - `lib/services/enrollment-pricing.ts`
  - `lib/services/billing-supabase.ts`
- Canonical RPC / transaction boundaries:
  - `apply_makeup_balance_delta_with_audit`
  - `rpc_generate_billing_batch`
  - `rpc_create_billing_export`
- Downstream dependents:
  - billing / invoice generation
  - transportation manifests
  - member detail read models
  - reports
- Cross-domain sync points:
  - attendance -> makeup ledger -> billing
  - MCC attendance/billing settings -> payor module
- Idempotency / duplicate posture:
  - mixed; some service CRUD, some RPC-backed, some action-level orchestration

### 9. File / Document Generation and Member Files

- Workflow entry points:
  - assessment PDF
  - care plan PDF
  - POF PDF
  - MAR monthly PDF
  - face sheet PDF
  - diet card PDF
  - name badge PDF
  - enrollment packet artifacts
  - caregiver/provider/nurse signature image capture
- Canonical source-of-truth tables / storage:
  - storage bucket: `member-documents`
  - `member_files`
  - workflow-specific artifact tables such as `enrollment_packet_uploads`
- Canonical service owners:
  - `lib/services/member-files.ts`
  - `lib/services/clinical-esign-artifacts.ts`
  - workflow-specific services above
- File/storage path hotspots:
  - `lib/services/member-files.ts`
  - `lib/services/enrollment-packets.ts`
  - `lib/services/pof-esign.ts`
  - `lib/services/care-plan-esign.ts`
  - `lib/services/clinical-esign-artifacts.ts`
- Integrity posture:
  - storage and metadata writes are centralized around `uploadMemberDocumentObject` and `upsertMemberFileByDocumentSource`
  - several workflows still upload to storage before final DB finalization, creating split-brain risk on failure

### 10. Notifications / Workflow Milestones / System Events

- Workflow entry points:
  - lifecycle service calls from enrollment, POF, care plan, MAR, billing, and operational reliability paths
  - portal inbox routes and actions in `app/(portal)/notifications/*`
- Canonical source-of-truth tables:
  - `system_events`
  - `user_notifications`
- Canonical service owners:
  - `lib/services/system-event-service.ts`
  - `lib/services/workflow-observability.ts`
  - `lib/services/lifecycle-milestones.ts`
  - `lib/services/notifications.ts`
- Delivery posture:
  - notifications are created after success-path milestones in several critical workflows
  - some milestone/event writes remain optional/non-blocking by design

## RPC Inventory

- `apply_makeup_balance_delta_with_audit`
- `rpc_convert_lead_to_member`
- `rpc_create_lead_with_member_conversion`
- `rpc_sign_physician_order`
- `rpc_finalize_pof_signature`
- `rpc_sync_signed_pof_to_member_clinical_profile`
- `rpc_generate_billing_batch`
- `rpc_create_billing_export`
- `rpc_finalize_enrollment_packet_request_completion`
- `rpc_finalize_care_plan_caregiver_signature`

## File / Storage Inventory

- Bucket owner: `lib/services/member-files.ts`
- Storage upload/download/signed-url paths:
  - enrollment packet uploads and completed DOCX artifacts
  - POF unsigned PDF, signed PDF, provider signature image
  - care plan caregiver signature image and final signed PDF
  - nurse clinical signature artifacts for intake/care plan

## Email / Notification Inventory

- Outbound email send services:
  - `lib/services/enrollment-packets.ts`
  - `lib/services/pof-esign.ts`
  - `lib/services/care-plan-esign.ts`
  - `lib/services/staff-auth.ts`
- Notification/milestone services:
  - `lib/services/lifecycle-milestones.ts`
  - `lib/services/notifications.ts`
  - `lib/services/workflow-observability.ts`

## Test Coverage Baseline

Confirmed focused tests exist for:

- RPC standardization
- enrollment packet workflow wiring
- POF e-sign UI and document rendering
- care plan canonical rules
- daily activity update action
- member name badge display-name rules

Critical gaps still appear likely for:

- enrollment packet downstream mapping durability
- intake create/sign + draft-POF atomicity
- care plan create/review transactional safety
- MAR schedule regeneration under retry/concurrency
- billing batch/export failure and replay safety
- public route token replay / duplicate-submit coverage
- RLS/policy parity verification

## Environment / Config Dependency Baseline

High-impact runtime dependencies discovered:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_SERVICE_KEY`
- `NEXT_PUBLIC_APP_URL` / `APP_URL` / `SITE_URL`
- `RESEND_API_KEY`
- `CLINICAL_SENDER_EMAIL` / `DEFAULT_CLINICAL_SENDER_EMAIL` / `RESEND_FROM_EMAIL`
- `POF_POST_SIGN_SYNC_SECRET`

## Initial Production-Risk Hotspots To Carry Into Refactor

- Action-level direct `audit_logs` writes still exist in `app/actions.ts`, `app/(portal)/health/mar/actions.ts`, and `app/(portal)/operations/pricing/actions.ts`.
- Enrollment packet downstream mapping is still outside the finalization RPC boundary.
- Intake assessment create + responses + signature + draft-POF follow-up is not one atomic DB boundary.
- Care plan create/review paths still use service-level rollback/delete behavior rather than one RPC-backed transaction.
- File workflows still have storage-first patterns that can leave orphaned objects when later metadata/finalization fails.
- MAR schedule regeneration is multi-step and non-transactional.
- Some service modules still write `audit_logs` directly instead of routing all lifecycle logging through one shared service.

## Next Audit Phases After This Map

1. Idempotency / duplicate-submit / concurrency audit by workflow.
2. UI mutation-state audit for loading/success/failure/retry/duplicate-submit prevention.
3. Permission parity audit across UI, actions, services, RPC, RLS, and public token routes.
4. File/document integrity audit for storage + metadata atomicity.
5. Blocker-first implementation pass.

## Hardening Pass Applied In This Session

Implemented production-safety fixes:

- Moved action-level audit log persistence in `app/actions.ts`, `app/(portal)/health/mar/actions.ts`, and `app/(portal)/operations/pricing/actions.ts` behind shared service `lib/services/audit-log-service.ts`.
- Moved `timePunchAction` write orchestration behind shared service `lib/services/time-punches.ts`.
- Moved legacy `app/actions.ts` ancillary pricing mutation behind `lib/services/ancillary-write-supabase.ts::updateAncillaryCategoryPriceSupabase`.
- Moved legacy `app/actions.ts` intake-assessment rollback delete behind `lib/services/intake-pof-mhp-cascade.ts::deleteIntakeAssessmentSupabase`.
- Added `0051_intake_assessment_atomic_creation_rpc.sql` and moved base intake assessment creation (`intake_assessments` + `assessment_responses`) onto `rpc_create_intake_assessment_with_responses`.
- Added `0052_intake_assessment_signature_finalize_rpc.sql` and moved intake signature DB finalization (`intake_assessment_signatures` + `intake_assessments`) onto `rpc_finalize_intake_assessment_signature`, with explicit cleanup/alert handling for artifact split-brain failures.
- Added `0053_artifact_drift_replay_hardening.sql` and moved artifact-finalization workflows onto replay-safe RPC boundaries:
  - `rpc_finalize_pof_signature` now records consumed-token hashes and returns replay-safe signed-state results
  - `rpc_finalize_care_plan_caregiver_signature` now owns caregiver final state + final `member_files` persistence
  - `rpc_finalize_care_plan_nurse_signature` now atomically finalizes `care_plan_nurse_signatures` + `care_plans`
  - `rpc_finalize_enrollment_packet_submission` now files packets before downstream mapping and finalizes staged upload batches
- Added `0054_care_plan_snapshot_atomicity.sql` and moved care-plan version snapshot + review-history persistence onto `rpc_record_care_plan_snapshot` so signed care plan reviews cannot save one without the other.
- Added `0055_intake_draft_pof_atomic_creation.sql` and moved signed-intake -> draft POF creation onto `rpc_create_draft_physician_order_from_intake` so `physician_orders` creation and `intake_assessments.draft_pof_status` stay transactionally aligned.
- Added `0056_shared_rpc_orchestration_hardening.sql` and moved remaining multi-step relay/orchestration paths onto shared RPC boundaries:
  - `rpc_upsert_care_plan_core` now owns `care_plans` + `care_plan_sections` create/review persistence in one transaction
  - `rpc_sync_mar_medications_from_member_profile` now owns MAR medication anchor resolution + `pof_medications` upsert/deactivation
  - `rpc_reconcile_member_mar_state` now owns member MAR medication sync + `mar_schedules` reconciliation in one transaction
  - `rpc_sync_member_health_profile_to_command_center` now owns MHP -> MCC/member cross-domain sync
  - `rpc_sync_command_center_to_member_health_profile` now owns MCC -> MHP/member cross-domain sync
  - `rpc_prefill_member_command_center_from_assessment` now owns intake-assessment -> MCC/member propagation
- Added `0057_mcc_mhp_workflow_rpc_hardening.sql` and moved remaining Member Command Center / Member Health Profile multi-step bundle workflows onto shared RPC boundaries:
  - `rpc_update_member_command_center_bundle` now owns MCC + `members` summary/demographics/legal/photo/diet persistence in one transaction
  - `rpc_save_member_command_center_attendance_billing` now owns attendance schedule + enrollment date + billing settings + billing schedule template persistence in one transaction
  - `rpc_save_member_command_center_transportation` now owns attendance transportation fields + bus stop directory upserts in one transaction
  - `rpc_update_member_health_profile_bundle` now owns MHP + `members` + hospital preference directory + optional MHP -> MCC sync in one transaction
  - `rpc_update_member_track_with_note` now owns `members.latest_assessment_track` + required care-plan review note creation in one transaction
- Added `0058_mhp_child_workflow_rpc_hardening.sql` and moved remaining high-risk MHP child-row clinical workflows onto shared RPC boundaries:
  - `rpc_mutate_member_diagnosis_workflow` now owns diagnosis create/update/delete + profile touch + audit event in one transaction
  - `rpc_mutate_member_medication_workflow` now owns medication create/update/delete/status mutation + profile touch + MAR reconciliation + audit event in one transaction
  - `rpc_mutate_member_allergy_workflow` now owns allergy create/update/delete + profile touch + audit event in one transaction
  - `rpc_mutate_member_provider_workflow` now owns provider create/update/delete + provider directory upsert + profile touch + audit event in one transaction
- Added `0059_mhp_equipment_notes_rpc_hardening.sql` and moved the remaining MHP equipment/note child workflows onto shared RPC boundaries:
  - `rpc_mutate_member_equipment_workflow` now owns equipment create/update/delete + profile touch + audit event in one transaction
  - `rpc_mutate_member_note_workflow` now owns note create/update/delete + profile touch + audit event in one transaction
- Normalized remaining service-layer `audit_logs` writers in `lib/services/sales-crm-supabase.ts`, `lib/services/sales-lead-activities.ts`, and `lib/services/staff-auth.ts` behind shared service `lib/services/audit-log-service.ts`.
- Added storage cleanup helper `deleteMemberDocumentObject(...)` and metadata cleanup helper `deleteMemberFileRecord(...)` in `lib/services/member-files.ts`.
- Hardened `lib/services/clinical-esign-artifacts.ts` so failed `member_files` persistence cleans up the just-uploaded storage object.
- Hardened `lib/services/enrollment-packets.ts` so:
  - failed `member_files` upsert cleans up the just-uploaded object
  - failed `enrollment_packet_uploads` insert cleans up newly created `member_files` + storage when rollback is safe
  - unsafe rollback cases now emit a high-severity system alert `enrollment_packet_upload_split_brain`
  - public submission now stages uploads, files the packet in one RPC, and tracks downstream mapping separately as post-commit sync state
- Hardened `lib/services/pof-esign.ts` so public signing now:
  - recognizes consumed-token replays as committed signed state
  - cleans staged signature/PDF artifacts when finalization RPC fails
  - skips duplicate post-sign milestones on replay
- Hardened `lib/services/care-plan-esign.ts` so caregiver signing now:
  - avoids pre-finalization `care_plans` draft signature writes
  - moves final signed `member_files` persistence into the finalization RPC
  - cleans staged caregiver signature/PDF artifacts on RPC failure
- Hardened `lib/services/care-plan-nurse-esign.ts` so nurse signing now:
  - short-circuits replay from canonical signed state
  - finalizes signature row + parent care plan state in one RPC
  - cleans new artifact/member-file rows or raises explicit split-brain alerts when cleanup is unsafe
- Hardened `app/actions.ts` intake create flow so signed-assessment failures no longer delete a successfully created assessment; failures now return a retryable saved-state result instead of simulating a rollback.
- Hardened `lib/services/physician-orders-supabase.ts` and `app/actions.ts` so intake draft POF creation now:
  - uses one replay-safe RPC boundary for draft `physician_orders` creation
  - atomically sets `draft_pof_status = created` only when the draft POF row exists
  - reuses existing draft/sent POF rows safely under retry
  - leaves `draft_pof_status = failed` only on genuine post-RPC failure paths
- Hardened `lib/services/care-plans-supabase.ts` and `app/care-plan-actions.ts` so:
  - care plan create no longer deletes the newly created parent row when later signing fails
  - create/review/sign actions now return recoverable saved-state errors with the committed `carePlanId`
  - post-sign version/review history persistence uses one RPC boundary instead of split inserts
- Added workflow reliability support indexes in `supabase/migrations/0050_workflow_reliability_indexes.sql` for:
  - `enrollment_packet_requests(delivery_status, updated_at desc)`
  - `pof_requests(delivery_status, updated_at desc)`
  - `pof_requests(delivery_status, status, updated_at desc)`
  - `care_plans(caregiver_signature_status, updated_at desc)`
  - `system_events(event_type, status, created_at desc)`
  - `system_events(event_type, created_at desc)`
- Added focused regression coverage in `tests/production-hardening-write-paths.test.ts`.
- Updated stale enrollment packet source-inspection tests in `tests/enrollment-packet-workflow.test.ts` to match the current canonical code.

## Production Blockers Resolved In This Pass

- Direct action-level writes to `audit_logs` in key workflow entry points.
- Direct action-level write to `time_punches` from `timePunchAction`.
- Remaining direct app-layer mutation leak in ancillary pricing update.
- Remaining direct app-layer mutation leak in intake rollback delete path.
- Silent orphaned storage-object risk in nurse clinical e-sign artifact capture.
- Silent orphaned storage-object risk when enrollment packet upload metadata fails before final upload row creation.
- Missing observability for the enrollment packet upload split-brain case that cannot be safely auto-rolled-back after an upserted `member_files` row is reused.
- Duplicated service-layer `audit_logs` write implementations in core sales/staff-auth services.
- Missing support indexes for workflow delivery-state and system-event retry/alert queries.
- POF public signing replay ambiguity and pre-finalization artifact cleanup gap.
- Care plan caregiver signing drift window caused by pre-finalization parent/member-file writes.
- Care plan nurse signing drift window caused by separate artifact, signature-row, and parent finalization writes.
- Enrollment packet filing drift caused by staging artifacts and downstream mapping before canonical filed-state commit.
- Care plan core create/review parent+section persistence previously split across direct table writes.
- MAR medication + schedule regeneration previously ran as direct service-layer multi-write orchestration.
- Shared MHP/MCC/member propagation relays previously wrote cross-domain state directly instead of using one canonical RPC boundary.
- Member Command Center summary/photo/demographics/legal/diet, attendance/billing, and transportation flows previously orchestrated related writes directly from action/service layers.
- Member Health Profile overview/photo/medical/legal/track workflows previously wrote cross-table state through direct relay paths instead of one canonical RPC boundary.
- Member Health Profile diagnosis/medication/allergy/provider child-row workflows previously mutated child tables, touched parent profile state, and ran downstream MAR/provider side effects as scattered action-level writes.
- Member Health Profile equipment/note child-row workflows previously used direct service CRUD plus follow-up parent touches instead of one canonical workflow boundary.

## Production Blockers Still Open After This Pass

- Enrollment packet downstream mapping is still not inside one shared RPC/transaction boundary.
- Intake assessment create + signature + draft POF cascade is still not one end-to-end atomic DB boundary, even though base assessment creation, signature finalization, and draft POF creation now each have canonical transaction boundaries.
- Care plan create/review workflow still spans multiple canonical boundaries (`care plan core`, `nurse sign`, `snapshot/history`, caregiver dispatch) rather than one end-to-end transaction, even though the direct parent/child write gap is removed.
- POF post-sign clinical sync remains a post-commit derived process rather than a single end-to-end transaction, though canonical signed state is now protected.
- Service-layer `audit_logs` writes still exist in some service modules and should be normalized behind one shared audit writer.
- RLS/policy parity, public-token replay safety, and cross-domain downstream propagation still require deeper workflow-by-workflow verification beyond this code pass.
