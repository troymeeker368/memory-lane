-- 0175_fk_covering_indexes_hardening.sql
-- Add missing foreign-key covering indexes reported by the live Supabase schema.
-- This migration is intentionally additive only.

-- 1. enrollment / intake follow-up queues
create index if not exists idx_enrollment_packet_events_actor_user_id
  on public.enrollment_packet_events (actor_user_id);

create index if not exists idx_enrollment_packet_field_conflicts_mapping_run_id
  on public.enrollment_packet_field_conflicts (mapping_run_id);

create index if not exists idx_enrollment_packet_field_conflicts_resolved_by_user_id
  on public.enrollment_packet_field_conflicts (resolved_by_user_id);

create index if not exists idx_enrollment_packet_follow_up_queue_claimed_by_user_id
  on public.enrollment_packet_follow_up_queue (claimed_by_user_id);

create index if not exists idx_enrollment_packet_follow_up_queue_created_by_user_id
  on public.enrollment_packet_follow_up_queue (created_by_user_id);

create index if not exists idx_enrollment_packet_follow_up_queue_lead_id
  on public.enrollment_packet_follow_up_queue (lead_id);

create index if not exists idx_enrollment_packet_follow_up_queue_member_id
  on public.enrollment_packet_follow_up_queue (member_id);

create index if not exists idx_enrollment_packet_follow_up_queue_updated_by_user_id
  on public.enrollment_packet_follow_up_queue (updated_by_user_id);

create index if not exists idx_enrollment_packet_mapping_records_member_id
  on public.enrollment_packet_mapping_records (member_id);

create index if not exists idx_enrollment_packet_mapping_runs_actor_user_id
  on public.enrollment_packet_mapping_runs (actor_user_id);

create index if not exists idx_enrollment_packet_pof_staging_updated_by_user_id
  on public.enrollment_packet_pof_staging (updated_by_user_id);

create index if not exists idx_enrollment_packet_requests_latest_mapping_run_id
  on public.enrollment_packet_requests (latest_mapping_run_id);

create index if not exists idx_enrollment_packet_requests_mapping_sync_claimed_by_user_id
  on public.enrollment_packet_requests (mapping_sync_claimed_by_user_id);

create index if not exists idx_enrollment_packet_requests_voided_by_user_id
  on public.enrollment_packet_requests (voided_by_user_id);

create index if not exists idx_enrollment_packet_uploads_member_file_id
  on public.enrollment_packet_uploads (member_file_id);

create index if not exists idx_intake_assessment_signatures_signature_artifact_mem_f096fc2
  on public.intake_assessment_signatures (signature_artifact_member_file_id);

create index if not exists idx_intake_assessment_signatures_signed_by_user_id
  on public.intake_assessment_signatures (signed_by_user_id);

create index if not exists idx_intake_assessments_lead_id
  on public.intake_assessments (lead_id);

create index if not exists idx_intake_assessments_signed_by_user_id
  on public.intake_assessments (signed_by_user_id);

create index if not exists idx_intake_post_sign_follow_up_queue_claimed_by_user_id
  on public.intake_post_sign_follow_up_queue (claimed_by_user_id);

create index if not exists idx_intake_post_sign_follow_up_queue_created_by_user_id
  on public.intake_post_sign_follow_up_queue (created_by_user_id);

create index if not exists idx_intake_post_sign_follow_up_queue_member_id
  on public.intake_post_sign_follow_up_queue (member_id);

create index if not exists idx_intake_post_sign_follow_up_queue_updated_by_user_id
  on public.intake_post_sign_follow_up_queue (updated_by_user_id);

create index if not exists idx_enrollment_packet_field_conflicts_packet_id_member_id
  on public.enrollment_packet_field_conflicts (packet_id, member_id);

create index if not exists idx_enrollment_packet_follow_up_queue_packet_id_member_id
  on public.enrollment_packet_follow_up_queue (packet_id, member_id);

create index if not exists idx_enrollment_packet_mapping_records_packet_id_member_id
  on public.enrollment_packet_mapping_records (packet_id, member_id);

create index if not exists idx_enrollment_packet_mapping_runs_packet_id_member_id
  on public.enrollment_packet_mapping_runs (packet_id, member_id);

create index if not exists idx_enrollment_packet_pof_staging_packet_id_member_id
  on public.enrollment_packet_pof_staging (packet_id, member_id);

create index if not exists idx_enrollment_packet_uploads_packet_id_member_id
  on public.enrollment_packet_uploads (packet_id, member_id);

create index if not exists idx_intake_assessment_signatures_assessment_id_member_id
  on public.intake_assessment_signatures (assessment_id, member_id);

create index if not exists idx_intake_post_sign_follow_up_queue_assessment_id_member_id
  on public.intake_post_sign_follow_up_queue (assessment_id, member_id);

create index if not exists idx_enrollment_packet_field_conflicts_mapping_run_id_pa_cd20305
  on public.enrollment_packet_field_conflicts (mapping_run_id, packet_id, member_id);

create index if not exists idx_enrollment_packet_mapping_records_mapping_run_id_pa_acce0b1
  on public.enrollment_packet_mapping_records (mapping_run_id, packet_id, member_id);

-- 2. care plans / diagnoses / signatures
create index if not exists idx_care_plan_diagnoses_created_by_user_id
  on public.care_plan_diagnoses (created_by_user_id);

create index if not exists idx_care_plan_diagnoses_updated_by_user_id
  on public.care_plan_diagnoses (updated_by_user_id);

create index if not exists idx_care_plan_nurse_signatures_signature_artifact_membe_da6a441
  on public.care_plan_nurse_signatures (signature_artifact_member_file_id);

create index if not exists idx_care_plan_review_history_version_id
  on public.care_plan_review_history (version_id);

create index if not exists idx_care_plan_signature_events_actor_user_id
  on public.care_plan_signature_events (actor_user_id);

create index if not exists idx_care_plans_caregiver_sent_by_user_id
  on public.care_plans (caregiver_sent_by_user_id);

create index if not exists idx_care_plans_created_by_user_id
  on public.care_plans (created_by_user_id);

create index if not exists idx_care_plans_final_member_file_id
  on public.care_plans (final_member_file_id);

create index if not exists idx_care_plans_nurse_signature_artifact_member_file_id
  on public.care_plans (nurse_signature_artifact_member_file_id);

create index if not exists idx_care_plans_updated_by_user_id
  on public.care_plans (updated_by_user_id);

create index if not exists idx_care_plan_diagnoses_care_plan_id_member_id
  on public.care_plan_diagnoses (care_plan_id, member_id);

create index if not exists idx_care_plan_diagnoses_member_diagnosis_id_member_id
  on public.care_plan_diagnoses (member_diagnosis_id, member_id);

-- 3. POF / physician orders / MAR
create index if not exists idx_document_events_actor_user_id
  on public.document_events (actor_user_id);

create index if not exists idx_document_events_physician_order_id
  on public.document_events (physician_order_id);

create index if not exists idx_mar_administrations_administered_by_user_id
  on public.mar_administrations (administered_by_user_id);

create index if not exists idx_mar_administrations_mar_schedule_id
  on public.mar_administrations (mar_schedule_id);

create index if not exists idx_mar_entries_member_id
  on public.mar_entries (member_id);

create index if not exists idx_mar_entries_nurse_user_id
  on public.mar_entries (nurse_user_id);

create index if not exists idx_med_administration_logs_administered_by
  on public.med_administration_logs (administered_by);

create index if not exists idx_medication_orders_created_by
  on public.medication_orders (created_by);

create index if not exists idx_medication_orders_verified_by
  on public.medication_orders (verified_by);

create index if not exists idx_physician_orders_created_by_user_id
  on public.physician_orders (created_by_user_id);

create index if not exists idx_physician_orders_superseded_by
  on public.physician_orders (superseded_by);

create index if not exists idx_physician_orders_updated_by_user_id
  on public.physician_orders (updated_by_user_id);

create index if not exists idx_pof_medications_created_by_user_id
  on public.pof_medications (created_by_user_id);

create index if not exists idx_pof_medications_updated_by_user_id
  on public.pof_medications (updated_by_user_id);

create index if not exists idx_pof_post_sign_sync_queue_claimed_by_user_id
  on public.pof_post_sign_sync_queue (claimed_by_user_id);

create index if not exists idx_pof_post_sign_sync_queue_pof_request_id
  on public.pof_post_sign_sync_queue (pof_request_id);

create index if not exists idx_pof_post_sign_sync_queue_queued_by_user_id
  on public.pof_post_sign_sync_queue (queued_by_user_id);

create index if not exists idx_pof_post_sign_sync_queue_resolved_by_user_id
  on public.pof_post_sign_sync_queue (resolved_by_user_id);

create index if not exists idx_pof_requests_created_by_user_id
  on public.pof_requests (created_by_user_id);

create index if not exists idx_pof_requests_member_file_id
  on public.pof_requests (member_file_id);

create index if not exists idx_pof_requests_sent_by_user_id
  on public.pof_requests (sent_by_user_id);

create index if not exists idx_pof_requests_updated_by_user_id
  on public.pof_requests (updated_by_user_id);

create index if not exists idx_mar_administrations_pof_medication_id_member_id
  on public.mar_administrations (pof_medication_id, member_id);

create index if not exists idx_mar_schedules_pof_medication_id_member_id
  on public.mar_schedules (pof_medication_id, member_id);

create index if not exists idx_pof_medications_physician_order_id_member_id
  on public.pof_medications (physician_order_id, member_id);

create index if not exists idx_mar_administrations_mar_schedule_id_pof_medication__9594aec
  on public.mar_administrations (mar_schedule_id, pof_medication_id, member_id);

-- 4. transportation / time / incidents / documentation
create index if not exists idx_assessment_responses_member_id
  on public.assessment_responses (member_id);

create index if not exists idx_attendance_records_recorded_by_user_id
  on public.attendance_records (recorded_by_user_id);

create index if not exists idx_documentation_assignments_assigned_staff_user_id
  on public.documentation_assignments (assigned_staff_user_id);

create index if not exists idx_documentation_assignments_member_id
  on public.documentation_assignments (member_id);

create index if not exists idx_documentation_events_member_id
  on public.documentation_events (member_id);

create index if not exists idx_documentation_tracker_assigned_staff_user_id
  on public.documentation_tracker (assigned_staff_user_id);

create index if not exists idx_documentation_tracker_member_id
  on public.documentation_tracker (member_id);

create index if not exists idx_email_logs_lead_id
  on public.email_logs (lead_id);

create index if not exists idx_email_logs_sent_by_user_id
  on public.email_logs (sent_by_user_id);

create index if not exists idx_incident_history_user_id
  on public.incident_history (user_id);

create index if not exists idx_incidents_director_reviewed_by
  on public.incidents (director_reviewed_by);

create index if not exists idx_incidents_final_pdf_member_file_id
  on public.incidents (final_pdf_member_file_id);

create index if not exists idx_incidents_reporter_user_id
  on public.incidents (reporter_user_id);

create index if not exists idx_incidents_staff_member_id
  on public.incidents (staff_member_id);

create index if not exists idx_incidents_submitted_by_user_id
  on public.incidents (submitted_by_user_id);

create index if not exists idx_pto_requests_approved_by
  on public.pto_requests (approved_by);

create index if not exists idx_pto_requests_staff_user_id
  on public.pto_requests (staff_user_id);

create index if not exists idx_shower_logs_member_id
  on public.shower_logs (member_id);

create index if not exists idx_staff_auth_events_actor_user_id
  on public.staff_auth_events (actor_user_id);

create index if not exists idx_staff_auth_events_auth_user_id
  on public.staff_auth_events (auth_user_id);

create index if not exists idx_time_punch_exceptions_punch_id
  on public.time_punch_exceptions (punch_id);

create index if not exists idx_time_punch_exceptions_resolved_by
  on public.time_punch_exceptions (resolved_by);

create index if not exists idx_time_punch_exceptions_staff_user_id
  on public.time_punch_exceptions (staff_user_id);

create index if not exists idx_time_punches_site_id
  on public.time_punches (site_id);

create index if not exists idx_toilet_logs_member_id
  on public.toilet_logs (member_id);

create index if not exists idx_transportation_logs_invoice_id
  on public.transportation_logs (invoice_id);

create index if not exists idx_transportation_logs_posted_by_user_id
  on public.transportation_logs (posted_by_user_id);

create index if not exists idx_transportation_logs_transport_run_id
  on public.transportation_logs (transport_run_id);

create index if not exists idx_transportation_logs_transport_run_result_id
  on public.transportation_logs (transport_run_result_id);

create index if not exists idx_transportation_manifest_adjustments_caregiver_contact_id
  on public.transportation_manifest_adjustments (caregiver_contact_id);

create index if not exists idx_transportation_manifest_adjustments_created_by_user_id
  on public.transportation_manifest_adjustments (created_by_user_id);

create index if not exists idx_transportation_manifest_adjustments_member_id
  on public.transportation_manifest_adjustments (member_id);

create index if not exists idx_transportation_run_results_caregiver_contact_id
  on public.transportation_run_results (caregiver_contact_id);

create index if not exists idx_transportation_run_results_transport_log_id
  on public.transportation_run_results (transport_log_id);

create index if not exists idx_transportation_runs_submitted_by_user_id
  on public.transportation_runs (submitted_by_user_id);

-- 5. billing / operations / notifications / member support tables
create index if not exists idx_ancillary_charge_logs_category_id
  on public.ancillary_charge_logs (category_id);

create index if not exists idx_ancillary_charge_logs_invoice_id
  on public.ancillary_charge_logs (invoice_id);

create index if not exists idx_ancillary_charge_logs_member_id
  on public.ancillary_charge_logs (member_id);

create index if not exists idx_ancillary_charge_logs_staff_user_id
  on public.ancillary_charge_logs (staff_user_id);

create index if not exists idx_billing_adjustments_created_by_user_id
  on public.billing_adjustments (created_by_user_id);

create index if not exists idx_billing_adjustments_invoice_id
  on public.billing_adjustments (invoice_id);

create index if not exists idx_billing_adjustments_payor_id
  on public.billing_adjustments (payor_id);

create index if not exists idx_billing_batches_generated_by_user_id
  on public.billing_batches (generated_by_user_id);

create index if not exists idx_billing_coverages_source_invoice_id
  on public.billing_coverages (source_invoice_id);

create index if not exists idx_billing_coverages_source_invoice_line_id
  on public.billing_coverages (source_invoice_line_id);

create index if not exists idx_billing_invoice_lines_payor_id
  on public.billing_invoice_lines (payor_id);

create index if not exists idx_billing_invoices_billing_batch_id
  on public.billing_invoices (billing_batch_id);

create index if not exists idx_billing_invoices_created_by_user_id
  on public.billing_invoices (created_by_user_id);

create index if not exists idx_billing_invoices_payor_id
  on public.billing_invoices (payor_id);

create index if not exists idx_billing_schedule_templates_updated_by_user_id
  on public.billing_schedule_templates (updated_by_user_id);

create index if not exists idx_bus_stop_directory_created_by_user_id
  on public.bus_stop_directory (created_by_user_id);

create index if not exists idx_center_billing_settings_updated_by_user_id
  on public.center_billing_settings (updated_by_user_id);

create index if not exists idx_center_closures_closure_rule_id
  on public.center_closures (closure_rule_id);

create index if not exists idx_center_closures_updated_by_user_id
  on public.center_closures (updated_by_user_id);

create index if not exists idx_closure_rules_updated_by_user_id
  on public.closure_rules (updated_by_user_id);

create index if not exists idx_enrollment_pricing_community_fees_created_by
  on public.enrollment_pricing_community_fees (created_by);

create index if not exists idx_enrollment_pricing_community_fees_updated_by
  on public.enrollment_pricing_community_fees (updated_by);

create index if not exists idx_enrollment_pricing_daily_rates_created_by
  on public.enrollment_pricing_daily_rates (created_by);

create index if not exists idx_enrollment_pricing_daily_rates_updated_by
  on public.enrollment_pricing_daily_rates (updated_by);

create index if not exists idx_hospital_preference_directory_created_by_user_id
  on public.hospital_preference_directory (created_by_user_id);

create index if not exists idx_lead_stage_history_changed_by_user_id
  on public.lead_stage_history (changed_by_user_id);

create index if not exists idx_leads_created_by_user_id
  on public.leads (created_by_user_id);

create index if not exists idx_member_allergies_created_by_user_id
  on public.member_allergies (created_by_user_id);

create index if not exists idx_member_attendance_schedules_updated_by_user_id
  on public.member_attendance_schedules (updated_by_user_id);

create index if not exists idx_member_billing_settings_payor_id
  on public.member_billing_settings (payor_id);

create index if not exists idx_member_billing_settings_updated_by_user_id
  on public.member_billing_settings (updated_by_user_id);

create index if not exists idx_member_command_centers_source_assessment_id
  on public.member_command_centers (source_assessment_id);

create index if not exists idx_member_command_centers_updated_by_user_id
  on public.member_command_centers (updated_by_user_id);

create index if not exists idx_member_contacts_created_by_user_id
  on public.member_contacts (created_by_user_id);

create index if not exists idx_member_diagnoses_created_by_user_id
  on public.member_diagnoses (created_by_user_id);

create index if not exists idx_member_equipment_created_by_user_id
  on public.member_equipment (created_by_user_id);

create index if not exists idx_member_files_uploaded_by_user_id
  on public.member_files (uploaded_by_user_id);

create index if not exists idx_member_health_profiles_updated_by_user_id
  on public.member_health_profiles (updated_by_user_id);

create index if not exists idx_member_holds_created_by_user_id
  on public.member_holds (created_by_user_id);

create index if not exists idx_member_holds_ended_by_user_id
  on public.member_holds (ended_by_user_id);

create index if not exists idx_member_medications_created_by_user_id
  on public.member_medications (created_by_user_id);

create index if not exists idx_member_notes_created_by_user_id
  on public.member_notes (created_by_user_id);

create index if not exists idx_member_providers_created_by_user_id
  on public.member_providers (created_by_user_id);

create index if not exists idx_members_latest_assessment_id
  on public.members (latest_assessment_id);

create index if not exists idx_partner_activities_completed_by_user_id
  on public.partner_activities (completed_by_user_id);

create index if not exists idx_partner_activities_lead_id
  on public.partner_activities (lead_id);

create index if not exists idx_payors_updated_by_user_id
  on public.payors (updated_by_user_id);

create index if not exists idx_profiles_auth_user_id
  on public.profiles (auth_user_id);

create index if not exists idx_progress_notes_created_by_user_id
  on public.progress_notes (created_by_user_id);

create index if not exists idx_progress_notes_signed_by_user_id
  on public.progress_notes (signed_by_user_id);

create index if not exists idx_progress_notes_updated_by_user_id
  on public.progress_notes (updated_by_user_id);

create index if not exists idx_provider_directory_created_by_user_id
  on public.provider_directory (created_by_user_id);

create index if not exists idx_schedule_changes_closed_by_user_id
  on public.schedule_changes (closed_by_user_id);

create index if not exists idx_schedule_changes_entered_by_user_id
  on public.schedule_changes (entered_by_user_id);

create index if not exists idx_system_events_actor_user_id
  on public.system_events (actor_user_id);

create index if not exists idx_user_notifications_actor_user_id
  on public.user_notifications (actor_user_id);
