# RPC Architecture Audit - 2026-03-24

## Executive Summary

- SQL files inventoried: `132`
- Current live SQL functions after the new consolidation migrations: `80`
- Current live RPC-style functions (`rpc_*`): `63`
- Current live views: `12`
- Trigger definitions inventoried across migrations: `78`

### What changed in this pass

- Consolidated the sales dashboard into one stronger read-model RPC: `rpc_get_sales_dashboard_summary`
- Consolidated the progress note tracker into one stronger read-model RPC: `rpc_get_progress_note_tracker`
- Removed the thin helper RPC `rpc_get_sales_pipeline_summary_counts`
- Removed the thin wrapper RPC `rpc_list_mar_member_options`
- Removed stale legacy RPC `rpc_finalize_enrollment_packet_request_completion`
- Removed split progress note helper RPCs:
  - `rpc_get_progress_note_tracker_summary`
  - `rpc_get_progress_note_tracker_page`
- Updated sales call sites to stop composing the dashboard from multiple round trips
- Updated progress note tracker call sites to stop composing the screen from summary + page RPCs
- Added repo guardrails in [docs/database-rpc-architecture.md](/D:/Memory Lane App/docs/database-rpc-architecture.md)

## Domain Counts

Counts below reflect live current functions after `0129_sales_dashboard_rpc_consolidation.sql`.

| Domain | Functions | Views |
| --- | ---: | ---: |
| members | 36 | 1 |
| enrollment | 9 | 0 |
| health unit | 5 | 0 |
| intake | 5 | 0 |
| MAR | 5 | 4 |
| physician orders | 4 | 0 |
| care plans | 4 | 0 |
| billing | 3 | 0 |
| auth/permissions | 3 | 0 |
| sales/leads | 1 | 1 |
| reporting | 2 | 2 |
| attendance | 1 | 0 |
| transportation | 1 | 0 |
| uncategorized helpers | 2 | 4 |

## Grouped Inventory By Domain

### Sales / Leads

- Read model:
  - `rpc_get_sales_dashboard_summary`
- Business workflows still active in adjacent domains:
  - `rpc_convert_lead_to_member`
  - `rpc_create_lead_with_member_conversion`
  - `rpc_transition_lead_stage`
  - `apply_lead_stage_transition_with_member_upsert`
  - `create_lead_with_member_conversion`
- Findings:
  - The dashboard is now correctly one canonical read path.
  - `resolveCanonicalLeadState` still exists in TypeScript and SQL-adjacent reporting logic, so lead stage/status canonicalization is still duplicated across layers.

### Enrollment

- Workflow / queue RPCs:
  - `rpc_prepare_enrollment_packet_request`
  - `rpc_transition_enrollment_packet_delivery_state`
  - `rpc_save_enrollment_packet_progress`
  - `rpc_finalize_enrollment_packet_submission`
  - `rpc_claim_enrollment_packet_mapping_retries`
  - `rpc_claim_enrollment_packet_follow_up_task`
- Non-RPC helpers used by policy / transactional boundaries:
  - `convert_enrollment_packet_to_member`
  - `can_access_enrollment_packet_child`
  - `can_write_enrollment_packet_child`
  - `can_write_enrollment_packet_request`
  - `is_enrollment_packet_internal_viewer`
  - `is_enrollment_packet_sender_role`
- Findings:
  - This domain still has too many lifecycle-adjacent entry points.
  - `rpc_finalize_enrollment_packet_request_completion` was stale and has been removed.
  - `convert_enrollment_packet_to_member` remains a critical workflow boundary and should stay authoritative until a broader enrollment/intake merge is done.

### Intake

- Authoritative workflows:
  - `rpc_create_intake_assessment_with_responses`
  - `rpc_finalize_intake_assessment_signature`
  - `rpc_create_draft_physician_order_from_intake`
  - `rpc_claim_intake_post_sign_follow_up_task`
- Findings:
  - This is a good example of where RPCs are justified: intake persistence, signing, and downstream follow-up are atomic and lifecycle-sensitive.
  - The remaining sprawl is around follow-up queue ownership, not thin wrappers.

### Physician Orders / POF

- Authoritative workflows:
  - `rpc_prepare_pof_request_delivery`
  - `rpc_sign_physician_order`
  - `rpc_finalize_pof_signature`
  - `rpc_claim_pof_post_sign_sync_queue`
- Cross-domain sync boundary:
  - `rpc_sync_signed_pof_to_member_clinical_profile`
- Findings:
  - This is appropriately workflow-oriented overall.
  - The POF delivery state path and signed-order sync path are still separate boundaries; that is acceptable for now because they represent different lifecycle steps.

### Members / MHP / MCC / Member Files

- Read-model RPCs:
  - `rpc_get_member_detail_counts`
  - `rpc_get_member_activity_snapshot_counts`
  - `rpc_get_member_activity_snapshot_rows`
  - `rpc_get_member_documentation_summary`
  - `rpc_get_member_health_profile_summary_counts`
- Workflow RPCs:
  - `rpc_update_member_command_center_bundle`
  - `rpc_save_member_command_center_attendance_billing`
  - `rpc_save_member_command_center_transportation`
  - `rpc_update_member_health_profile_bundle`
  - `rpc_update_member_track_with_note`
  - `rpc_sync_member_health_profile_to_command_center`
  - `rpc_sync_command_center_to_member_health_profile`
  - `rpc_prefill_member_command_center_from_assessment`
  - `rpc_sync_mar_medications_from_member_profile`
  - `rpc_reconcile_member_mar_state`
  - `rpc_set_member_contact_payor`
  - `rpc_upsert_member_file_by_source`
  - `rpc_delete_member_file_record`
- Child workflow RPCs that are still fragmented:
  - `rpc_mutate_member_diagnosis_workflow`
  - `rpc_mutate_member_medication_workflow`
  - `rpc_mutate_member_allergy_workflow`
  - `rpc_mutate_member_provider_workflow`
  - `rpc_mutate_member_equipment_workflow`
  - `rpc_mutate_member_note_workflow`
- Findings:
  - This is the largest remaining RPC sprawl cluster.
  - The child mutation RPC family is workable, but it is not yet the canonical “one member clinical profile write path” target state.
  - The member detail screen still uses one count RPC plus many direct relation queries, so the domain still lacks a proper member command center read model.

### Care Plans

- Read-model / summary RPCs:
  - `rpc_get_care_plan_summary_counts`
  - `rpc_get_care_plan_participation_summary`
- Workflow RPCs:
  - `rpc_upsert_care_plan_core`
  - `rpc_record_care_plan_snapshot`
  - `rpc_prepare_care_plan_caregiver_request`
  - `rpc_transition_care_plan_caregiver_status`
  - `rpc_finalize_care_plan_caregiver_signature`
  - `rpc_finalize_care_plan_nurse_signature`
- Findings:
  - Write boundaries are mostly correct.
  - Reads are still fragmented between direct `care_plans` queries and separate summary RPCs.

### MAR

- Read models:
  - `rpc_list_mar_monthly_report_member_options`
  - `v_mar_today`
  - `v_mar_not_given_today`
  - `v_mar_prn_log`
  - `v_mar_prn_given_awaiting_outcome`
  - `v_mar_prn_effective`
  - `v_mar_prn_ineffective`
- Workflows:
  - `rpc_document_scheduled_mar_administration`
  - `rpc_sync_active_prn_medication_orders`
  - `rpc_record_prn_medication_administration`
  - `rpc_create_prn_medication_order_and_administer`
  - `rpc_complete_prn_administration_followup`
- Findings:
  - `rpc_list_mar_member_options` was only a pass-through wrapper and has been removed.
  - The PRN workflow set is still broad but justified because each function owns a distinct medication lifecycle step.

### Billing

- Workflows:
  - `rpc_generate_billing_batch`
  - `rpc_create_billing_export`
  - `rpc_create_custom_invoice`
- Findings:
  - Billing is correctly using transactional RPCs.
  - The next consolidation target is not fewer write RPCs, but stronger batch-oriented read models for invoice review screens if those screens fragment later.

### Transportation

- Workflow RPCs:
  - `rpc_post_transportation_run`
- Findings:
  - Clean, strong single-purpose workflow boundary.

### Health Unit / Documentation / Progress Notes

- Read models:
  - `rpc_get_documentation_workflows`
  - `rpc_get_health_dashboard_care_alerts`
  - `rpc_get_progress_note_tracker`
  - `rpc_get_staff_activity_snapshot_counts`
  - `rpc_get_staff_activity_snapshot_rows`
- Findings:
  - Progress note tracker is now correctly one canonical read path instead of a summary/page split.
  - Activity snapshot counts and rows are similarly split.

### Auth / Permissions / Low-Level Helpers

- Policy / auth helpers:
  - `current_role`
  - `current_profile_id`
  - `sync_profile_auth_lifecycle_fields`
- Trigger helpers / platform helpers:
  - `set_updated_at`
  - `sync_time_punch_to_canonical_punch`
  - `generate_incident_number`
  - `log_documentation_event`
  - `member_contacts_auto_seed_payor`
- Findings:
  - These are not RPC sprawl problems; they are expected database-side helpers.

## Current Classification Summary

### Thin Wrappers Removed

- `rpc_get_sales_pipeline_summary_counts`
- `rpc_list_mar_member_options`

### Stale / Dead Removed

- `rpc_finalize_enrollment_packet_request_completion`

### Fragmented Read Models Consolidated

- `rpc_get_progress_note_tracker_summary` + `rpc_get_progress_note_tracker_page`
  -> `rpc_get_progress_note_tracker`

### Strong Read Models That Should Stay

- `rpc_get_sales_dashboard_summary`
- `rpc_get_documentation_workflows`
- `rpc_get_health_dashboard_care_alerts`
- `rpc_list_mar_monthly_report_member_options`
- `rpc_get_member_activity_snapshot_counts`
- `rpc_get_member_activity_snapshot_rows`
- `rpc_get_staff_activity_snapshot_counts`
- `rpc_get_staff_activity_snapshot_rows`

### Strong Workflow RPCs That Should Stay

- Lead conversion and lead stage transition RPCs
- Intake create / finalize RPCs
- POF sign / finalize / post-sign claim RPCs
- Enrollment finalize / claim / delivery-state RPCs
- Billing batch / export / custom invoice RPCs
- Care plan sign / finalize / snapshot RPCs
- MAR documentation and PRN workflow RPCs
- Transportation run posting RPC

### Duplicate / Overlapping Clusters Still Present

- Member clinical child mutations:
  - diagnosis, medication, allergy, provider, equipment, and note mutations should converge toward a stronger member clinical workflow boundary
- Care plan reads:
  - summary counts RPC + participation RPC + direct table queries
- Progress note tracker reads:
  - summary RPC + page RPC for the same screen
- Activity snapshots:
  - counts RPC + rows RPC for the same screen
- Lead canonicalization:
  - stage/status normalization still exists in both SQL and TypeScript report logic

## Confirmed Waterfall / Fragmentation Findings

- Reduced in this pass:
  - `/sales/pipeline/by-stage`
  - `lib/services/sales-crm-read-model.ts:getSalesSummarySnapshotSupabase`
  - Previous shape: dashboard RPC + pipeline summary RPC + direct recent-inquiry query
  - Current shape: one canonical `rpc_get_sales_dashboard_summary` read model
- Reduced in this pass:
  - `/health/progress-notes`
  - `lib/services/progress-notes-read-model.ts:getProgressNoteTracker`
  - Previous shape: summary RPC + page RPC
  - Current shape: one canonical `rpc_get_progress_note_tracker` read model
- Still fragmented:
  - `lib/services/member-detail-read-model.ts`
  - `lib/services/care-plans-read-model.ts:getCarePlanById`
  - `lib/services/sales-summary-report.ts`

## Recommended Next Canonical Merges

- Members:
  - create one member command center read model that replaces `rpc_get_member_detail_counts` plus the relation waterfall in `member-detail-read-model.ts`
- Intake / enrollment:
  - move toward one canonical enrollment/intake downstream workflow boundary instead of separate packet-completion helpers plus conversion orchestration
- Care plans:
  - create one care plan review read model for detail, sections, history, versions, and participation summary
- Progress notes:
  - activity/dashboard follow-on read models still deserve cleanup, but the tracker split is now consolidated
- MHP / MCC:
  - converge the child mutation RPC family toward one authoritative member clinical bundle write path

## Safe Changes Applied In This Pass

- Migration added:
  - [0129_sales_dashboard_rpc_consolidation.sql](/D:/Memory Lane App/supabase/migrations/0129_sales_dashboard_rpc_consolidation.sql)
- Service refactors:
  - [sales-crm-read-model.ts](/D:/Memory Lane App/lib/services/sales-crm-read-model.ts)
  - [sales-workflows.ts](/D:/Memory Lane App/lib/services/sales-workflows.ts)
- Guardrails:
  - [database-rpc-architecture.md](/D:/Memory Lane App/docs/database-rpc-architecture.md)

## Risk Areas Not Auto-Refactored Yet

- Member detail and care plan detail screens still rely on many direct reads for one obvious payload.
- Clinical member profile writes are still spread across a family of child mutation RPCs.
- Sales summary reporting still recomputes canonical lead logic in TypeScript instead of reusing one read-model boundary.
- Progress note tracker still uses a summary/page split that likely becomes an avoidable same-screen waterfall.
