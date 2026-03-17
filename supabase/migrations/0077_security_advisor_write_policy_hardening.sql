-- Supabase Security Advisor hardening pass.
-- Fixes:
-- 1. mutable function search_path warnings
-- 2. SECURITY DEFINER view warnings by switching views to security_invoker
-- 3. authenticated write/delete policies with USING/WITH CHECK (true)

alter function public.sync_profile_auth_lifecycle_fields() set search_path = public;
alter function public.set_updated_at() set search_path = public;
alter function public.sync_time_punch_to_canonical_punch() set search_path = public;
alter function public.generate_incident_number() set search_path = public;
alter function public.log_documentation_event() set search_path = public;

alter view if exists public.billing_payor_backfill_review set (security_invoker = true);
alter view if exists public.v_ancillary_charge_logs_detailed set (security_invoker = true);
alter view if exists public.v_biweekly_totals set (security_invoker = true);
alter view if exists public.v_blood_sugar_logs_detailed set (security_invoker = true);
alter view if exists public.v_last_toileted set (security_invoker = true);
alter view if exists public.v_lead_pipeline_stage_counts set (security_invoker = true);
alter view if exists public.v_mar_administration_history set (security_invoker = true);
alter view if exists public.v_mar_entries_detailed set (security_invoker = true);
alter view if exists public.v_mar_not_given_today set (security_invoker = true);
alter view if exists public.v_mar_overdue_today set (security_invoker = true);
alter view if exists public.v_mar_prn_effective set (security_invoker = true);
alter view if exists public.v_mar_prn_given_awaiting_outcome set (security_invoker = true);
alter view if exists public.v_mar_prn_ineffective set (security_invoker = true);
alter view if exists public.v_mar_prn_log set (security_invoker = true);
alter view if exists public.v_mar_today set (security_invoker = true);
alter view if exists public.v_monthly_ancillary_summary set (security_invoker = true);
alter view if exists public.v_timely_docs_summary set (security_invoker = true);
alter view if exists public.v_today_at_a_glance set (security_invoker = true);

-- Canonical RPC or admin-client writes only.
drop policy if exists "assessment_responses_insert" on public.assessment_responses;
create policy "assessment_responses_insert"
on public.assessment_responses
for insert
to service_role
with check (true);

drop policy if exists "assessment_responses_update" on public.assessment_responses;
create policy "assessment_responses_update"
on public.assessment_responses
for update
to service_role
using (true)
with check (true);

drop policy if exists "care_plan_signature_events_insert" on public.care_plan_signature_events;
create policy "care_plan_signature_events_insert"
on public.care_plan_signature_events
for insert
to service_role
with check (true);

drop policy if exists "care_plan_review_history_insert" on public.care_plan_review_history;
create policy "care_plan_review_history_insert"
on public.care_plan_review_history
for insert
to service_role
with check (true);

drop policy if exists "care_plan_review_history_update" on public.care_plan_review_history;
create policy "care_plan_review_history_update"
on public.care_plan_review_history
for update
to service_role
using (true)
with check (true);

drop policy if exists "care_plan_sections_insert" on public.care_plan_sections;
create policy "care_plan_sections_insert"
on public.care_plan_sections
for insert
to service_role
with check (true);

drop policy if exists "care_plan_sections_update" on public.care_plan_sections;
create policy "care_plan_sections_update"
on public.care_plan_sections
for update
to service_role
using (true)
with check (true);

drop policy if exists "care_plan_sections_delete" on public.care_plan_sections;
create policy "care_plan_sections_delete"
on public.care_plan_sections
for delete
to service_role
using (true);

drop policy if exists "care_plan_versions_insert" on public.care_plan_versions;
create policy "care_plan_versions_insert"
on public.care_plan_versions
for insert
to service_role
with check (true);

drop policy if exists "care_plan_versions_update" on public.care_plan_versions;
create policy "care_plan_versions_update"
on public.care_plan_versions
for update
to service_role
using (true)
with check (true);

drop policy if exists "enrollment_packet_events_insert" on public.enrollment_packet_events;
create policy "enrollment_packet_events_insert"
on public.enrollment_packet_events
for insert
to service_role
with check (true);

drop policy if exists "enrollment_packet_fields_insert" on public.enrollment_packet_fields;
create policy "enrollment_packet_fields_insert"
on public.enrollment_packet_fields
for insert
to service_role
with check (true);

drop policy if exists "enrollment_packet_fields_update" on public.enrollment_packet_fields;
create policy "enrollment_packet_fields_update"
on public.enrollment_packet_fields
for update
to service_role
using (true)
with check (true);

drop policy if exists "enrollment_packet_mapping_records_insert" on public.enrollment_packet_mapping_records;
create policy "enrollment_packet_mapping_records_insert"
on public.enrollment_packet_mapping_records
for insert
to service_role
with check (true);

drop policy if exists "enrollment_packet_mapping_runs_insert" on public.enrollment_packet_mapping_runs;
create policy "enrollment_packet_mapping_runs_insert"
on public.enrollment_packet_mapping_runs
for insert
to service_role
with check (true);

drop policy if exists "enrollment_packet_mapping_runs_update" on public.enrollment_packet_mapping_runs;
create policy "enrollment_packet_mapping_runs_update"
on public.enrollment_packet_mapping_runs
for update
to service_role
using (true)
with check (true);

drop policy if exists "enrollment_packet_pof_staging_insert" on public.enrollment_packet_pof_staging;
create policy "enrollment_packet_pof_staging_insert"
on public.enrollment_packet_pof_staging
for insert
to service_role
with check (true);

drop policy if exists "enrollment_packet_pof_staging_update" on public.enrollment_packet_pof_staging;
create policy "enrollment_packet_pof_staging_update"
on public.enrollment_packet_pof_staging
for update
to service_role
using (true)
with check (true);

drop policy if exists "enrollment_packet_sender_signatures_insert" on public.enrollment_packet_sender_signatures;
create policy "enrollment_packet_sender_signatures_insert"
on public.enrollment_packet_sender_signatures
for insert
to service_role
with check (true);

drop policy if exists "enrollment_packet_sender_signatures_update" on public.enrollment_packet_sender_signatures;
create policy "enrollment_packet_sender_signatures_update"
on public.enrollment_packet_sender_signatures
for update
to service_role
using (true)
with check (true);

drop policy if exists "enrollment_packet_signatures_insert" on public.enrollment_packet_signatures;
create policy "enrollment_packet_signatures_insert"
on public.enrollment_packet_signatures
for insert
to service_role
with check (true);

drop policy if exists "enrollment_packet_signatures_update" on public.enrollment_packet_signatures;
create policy "enrollment_packet_signatures_update"
on public.enrollment_packet_signatures
for update
to service_role
using (true)
with check (true);

drop policy if exists "enrollment_packet_uploads_insert" on public.enrollment_packet_uploads;
create policy "enrollment_packet_uploads_insert"
on public.enrollment_packet_uploads
for insert
to service_role
with check (true);

drop policy if exists "enrollment_packet_uploads_update" on public.enrollment_packet_uploads;
create policy "enrollment_packet_uploads_update"
on public.enrollment_packet_uploads
for update
to service_role
using (true)
with check (true);

drop policy if exists "enrollment_pricing_community_fees_insert" on public.enrollment_pricing_community_fees;
create policy "enrollment_pricing_community_fees_insert"
on public.enrollment_pricing_community_fees
for insert
to service_role
with check (true);

drop policy if exists "enrollment_pricing_community_fees_update" on public.enrollment_pricing_community_fees;
create policy "enrollment_pricing_community_fees_update"
on public.enrollment_pricing_community_fees
for update
to service_role
using (true)
with check (true);

drop policy if exists "enrollment_pricing_daily_rates_insert" on public.enrollment_pricing_daily_rates;
create policy "enrollment_pricing_daily_rates_insert"
on public.enrollment_pricing_daily_rates
for insert
to service_role
with check (true);

drop policy if exists "enrollment_pricing_daily_rates_update" on public.enrollment_pricing_daily_rates;
create policy "enrollment_pricing_daily_rates_update"
on public.enrollment_pricing_daily_rates
for update
to service_role
using (true)
with check (true);

drop policy if exists "billing_export_jobs_insert" on public.billing_export_jobs;
create policy "billing_export_jobs_insert"
on public.billing_export_jobs
for insert
to service_role
with check (true);

drop policy if exists "billing_export_jobs_update" on public.billing_export_jobs;
create policy "billing_export_jobs_update"
on public.billing_export_jobs
for update
to service_role
using (true)
with check (true);

-- Authenticated internal staff writes for active operational workflows.
drop policy if exists "attendance_records_insert" on public.attendance_records;
create policy "attendance_records_insert"
on public.attendance_records
for insert
to authenticated
with check (public.current_role() in ('admin', 'manager', 'director', 'nurse', 'coordinator'));

drop policy if exists "attendance_records_update" on public.attendance_records;
create policy "attendance_records_update"
on public.attendance_records
for update
to authenticated
using (public.current_role() in ('admin', 'manager', 'director', 'nurse', 'coordinator'))
with check (public.current_role() in ('admin', 'manager', 'director', 'nurse', 'coordinator'));

drop policy if exists "billing_adjustments_insert" on public.billing_adjustments;
create policy "billing_adjustments_insert"
on public.billing_adjustments
for insert
to authenticated
with check (public.current_role() in ('admin', 'manager', 'director', 'coordinator'));

drop policy if exists "billing_adjustments_update" on public.billing_adjustments;
create policy "billing_adjustments_update"
on public.billing_adjustments
for update
to authenticated
using (public.current_role() in ('admin', 'manager', 'director', 'coordinator'))
with check (public.current_role() in ('admin', 'manager', 'director', 'coordinator'));

drop policy if exists "billing_batches_insert" on public.billing_batches;
create policy "billing_batches_insert"
on public.billing_batches
for insert
to authenticated
with check (public.current_role() in ('admin', 'manager', 'director', 'coordinator'));

drop policy if exists "billing_batches_update" on public.billing_batches;
create policy "billing_batches_update"
on public.billing_batches
for update
to authenticated
using (public.current_role() in ('admin', 'manager', 'director', 'coordinator'))
with check (public.current_role() in ('admin', 'manager', 'director', 'coordinator'));

drop policy if exists "billing_coverages_delete" on public.billing_coverages;
create policy "billing_coverages_delete"
on public.billing_coverages
for delete
to authenticated
using (public.current_role() in ('admin', 'manager', 'director', 'coordinator'));

drop policy if exists "billing_coverages_insert" on public.billing_coverages;
create policy "billing_coverages_insert"
on public.billing_coverages
for insert
to authenticated
with check (public.current_role() in ('admin', 'manager', 'director', 'coordinator'));

drop policy if exists "billing_coverages_update" on public.billing_coverages;
create policy "billing_coverages_update"
on public.billing_coverages
for update
to authenticated
using (public.current_role() in ('admin', 'manager', 'director', 'coordinator'))
with check (public.current_role() in ('admin', 'manager', 'director', 'coordinator'));

drop policy if exists "billing_invoice_lines_delete" on public.billing_invoice_lines;
create policy "billing_invoice_lines_delete"
on public.billing_invoice_lines
for delete
to authenticated
using (public.current_role() in ('admin', 'manager', 'director', 'coordinator'));

drop policy if exists "billing_invoice_lines_insert" on public.billing_invoice_lines;
create policy "billing_invoice_lines_insert"
on public.billing_invoice_lines
for insert
to authenticated
with check (public.current_role() in ('admin', 'manager', 'director', 'coordinator'));

drop policy if exists "billing_invoice_lines_update" on public.billing_invoice_lines;
create policy "billing_invoice_lines_update"
on public.billing_invoice_lines
for update
to authenticated
using (public.current_role() in ('admin', 'manager', 'director', 'coordinator'))
with check (public.current_role() in ('admin', 'manager', 'director', 'coordinator'));

drop policy if exists "billing_invoices_insert" on public.billing_invoices;
create policy "billing_invoices_insert"
on public.billing_invoices
for insert
to authenticated
with check (public.current_role() in ('admin', 'manager', 'director', 'coordinator'));

drop policy if exists "billing_invoices_update" on public.billing_invoices;
create policy "billing_invoices_update"
on public.billing_invoices
for update
to authenticated
using (public.current_role() in ('admin', 'manager', 'director', 'coordinator'))
with check (public.current_role() in ('admin', 'manager', 'director', 'coordinator'));

drop policy if exists "billing_schedule_templates_insert" on public.billing_schedule_templates;
create policy "billing_schedule_templates_insert"
on public.billing_schedule_templates
for insert
to authenticated
with check (public.current_role() in ('admin', 'manager', 'director', 'coordinator'));

drop policy if exists "billing_schedule_templates_update" on public.billing_schedule_templates;
create policy "billing_schedule_templates_update"
on public.billing_schedule_templates
for update
to authenticated
using (public.current_role() in ('admin', 'manager', 'director', 'coordinator'))
with check (public.current_role() in ('admin', 'manager', 'director', 'coordinator'));

drop policy if exists "bus_stop_directory_insert" on public.bus_stop_directory;
create policy "bus_stop_directory_insert"
on public.bus_stop_directory
for insert
to authenticated
with check (public.current_role() in ('admin', 'manager', 'director', 'coordinator'));

drop policy if exists "bus_stop_directory_update" on public.bus_stop_directory;
create policy "bus_stop_directory_update"
on public.bus_stop_directory
for update
to authenticated
using (public.current_role() in ('admin', 'manager', 'director', 'coordinator'))
with check (public.current_role() in ('admin', 'manager', 'director', 'coordinator'));

drop policy if exists "center_billing_settings_insert" on public.center_billing_settings;
create policy "center_billing_settings_insert"
on public.center_billing_settings
for insert
to authenticated
with check (public.current_role() in ('admin', 'manager', 'director', 'coordinator'));

drop policy if exists "center_billing_settings_update" on public.center_billing_settings;
create policy "center_billing_settings_update"
on public.center_billing_settings
for update
to authenticated
using (public.current_role() in ('admin', 'manager', 'director', 'coordinator'))
with check (public.current_role() in ('admin', 'manager', 'director', 'coordinator'));

drop policy if exists "center_closures_delete" on public.center_closures;
create policy "center_closures_delete"
on public.center_closures
for delete
to authenticated
using (public.current_role() in ('admin', 'manager', 'director', 'coordinator'));

drop policy if exists "center_closures_insert" on public.center_closures;
create policy "center_closures_insert"
on public.center_closures
for insert
to authenticated
with check (public.current_role() in ('admin', 'manager', 'director', 'coordinator'));

drop policy if exists "center_closures_update" on public.center_closures;
create policy "center_closures_update"
on public.center_closures
for update
to authenticated
using (public.current_role() in ('admin', 'manager', 'director', 'coordinator'))
with check (public.current_role() in ('admin', 'manager', 'director', 'coordinator'));

drop policy if exists "closure_rules_insert" on public.closure_rules;
create policy "closure_rules_insert"
on public.closure_rules
for insert
to authenticated
with check (public.current_role() in ('admin', 'manager', 'director', 'coordinator'));

drop policy if exists "closure_rules_update" on public.closure_rules;
create policy "closure_rules_update"
on public.closure_rules
for update
to authenticated
using (public.current_role() in ('admin', 'manager', 'director', 'coordinator'))
with check (public.current_role() in ('admin', 'manager', 'director', 'coordinator'));

drop policy if exists "hospital_preference_directory_delete" on public.hospital_preference_directory;
create policy "hospital_preference_directory_delete"
on public.hospital_preference_directory
for delete
to authenticated
using (public.current_role() in ('admin', 'manager', 'director', 'nurse', 'coordinator'));

drop policy if exists "hospital_preference_directory_insert" on public.hospital_preference_directory;
create policy "hospital_preference_directory_insert"
on public.hospital_preference_directory
for insert
to authenticated
with check (public.current_role() in ('admin', 'manager', 'director', 'nurse', 'coordinator'));

drop policy if exists "hospital_preference_directory_update" on public.hospital_preference_directory;
create policy "hospital_preference_directory_update"
on public.hospital_preference_directory
for update
to authenticated
using (public.current_role() in ('admin', 'manager', 'director', 'nurse', 'coordinator'))
with check (public.current_role() in ('admin', 'manager', 'director', 'nurse', 'coordinator'));

drop policy if exists "intake_assessment_signatures_insert" on public.intake_assessment_signatures;
create policy "intake_assessment_signatures_insert"
on public.intake_assessment_signatures
for insert
to service_role
with check (true);

drop policy if exists "intake_assessment_signatures_update" on public.intake_assessment_signatures;
create policy "intake_assessment_signatures_update"
on public.intake_assessment_signatures
for update
to service_role
using (true)
with check (true);

drop policy if exists "intake_assessments_insert" on public.intake_assessments;
create policy "intake_assessments_insert"
on public.intake_assessments
for insert
to authenticated
with check (public.current_role() in ('admin', 'manager', 'director', 'nurse', 'coordinator'));

drop policy if exists "intake_assessments_update" on public.intake_assessments;
create policy "intake_assessments_update"
on public.intake_assessments
for update
to authenticated
using (public.current_role() in ('admin', 'manager', 'director', 'nurse', 'coordinator'))
with check (public.current_role() in ('admin', 'manager', 'director', 'nurse', 'coordinator'));

drop policy if exists "locker_assignment_history_insert" on public.locker_assignment_history;
create policy "locker_assignment_history_insert"
on public.locker_assignment_history
for insert
to authenticated
with check (public.current_role() in ('admin', 'manager', 'director', 'coordinator'));

drop policy if exists "locker_assignment_history_update" on public.locker_assignment_history;
create policy "locker_assignment_history_update"
on public.locker_assignment_history
for update
to authenticated
using (public.current_role() in ('admin', 'manager', 'director', 'coordinator'))
with check (public.current_role() in ('admin', 'manager', 'director', 'coordinator'));

drop policy if exists "member_attendance_schedules_insert" on public.member_attendance_schedules;
create policy "member_attendance_schedules_insert"
on public.member_attendance_schedules
for insert
to authenticated
with check (public.current_role() in ('admin', 'manager', 'director', 'nurse', 'coordinator'));

drop policy if exists "member_attendance_schedules_update" on public.member_attendance_schedules;
create policy "member_attendance_schedules_update"
on public.member_attendance_schedules
for update
to authenticated
using (public.current_role() in ('admin', 'manager', 'director', 'nurse', 'coordinator'))
with check (public.current_role() in ('admin', 'manager', 'director', 'nurse', 'coordinator'));

drop policy if exists "member_command_centers_insert" on public.member_command_centers;
create policy "member_command_centers_insert"
on public.member_command_centers
for insert
to authenticated
with check (public.current_role() in ('admin', 'manager', 'director', 'nurse', 'coordinator'));

drop policy if exists "member_command_centers_update" on public.member_command_centers;
create policy "member_command_centers_update"
on public.member_command_centers
for update
to authenticated
using (public.current_role() in ('admin', 'manager', 'director', 'nurse', 'coordinator'))
with check (public.current_role() in ('admin', 'manager', 'director', 'nurse', 'coordinator'));

drop policy if exists "member_equipment_delete" on public.member_equipment;
create policy "member_equipment_delete"
on public.member_equipment
for delete
to authenticated
using (public.current_role() in ('admin', 'manager', 'director', 'nurse', 'coordinator'));

drop policy if exists "member_equipment_insert" on public.member_equipment;
create policy "member_equipment_insert"
on public.member_equipment
for insert
to authenticated
with check (public.current_role() in ('admin', 'manager', 'director', 'nurse', 'coordinator'));

drop policy if exists "member_equipment_update" on public.member_equipment;
create policy "member_equipment_update"
on public.member_equipment
for update
to authenticated
using (public.current_role() in ('admin', 'manager', 'director', 'nurse', 'coordinator'))
with check (public.current_role() in ('admin', 'manager', 'director', 'nurse', 'coordinator'));

drop policy if exists "member_notes_delete" on public.member_notes;
create policy "member_notes_delete"
on public.member_notes
for delete
to authenticated
using (public.current_role() in ('admin', 'manager', 'director', 'nurse', 'coordinator'));

drop policy if exists "member_notes_insert" on public.member_notes;
create policy "member_notes_insert"
on public.member_notes
for insert
to authenticated
with check (public.current_role() in ('admin', 'manager', 'director', 'nurse', 'coordinator'));

drop policy if exists "member_notes_update" on public.member_notes;
create policy "member_notes_update"
on public.member_notes
for update
to authenticated
using (public.current_role() in ('admin', 'manager', 'director', 'nurse', 'coordinator'))
with check (public.current_role() in ('admin', 'manager', 'director', 'nurse', 'coordinator'));

drop policy if exists "member_providers_delete" on public.member_providers;
create policy "member_providers_delete"
on public.member_providers
for delete
to authenticated
using (public.current_role() in ('admin', 'manager', 'director', 'nurse', 'coordinator'));

drop policy if exists "member_providers_insert" on public.member_providers;
create policy "member_providers_insert"
on public.member_providers
for insert
to authenticated
with check (public.current_role() in ('admin', 'manager', 'director', 'nurse', 'coordinator'));

drop policy if exists "member_providers_update" on public.member_providers;
create policy "member_providers_update"
on public.member_providers
for update
to authenticated
using (public.current_role() in ('admin', 'manager', 'director', 'nurse', 'coordinator'))
with check (public.current_role() in ('admin', 'manager', 'director', 'nurse', 'coordinator'));

drop policy if exists "provider_directory_delete" on public.provider_directory;
create policy "provider_directory_delete"
on public.provider_directory
for delete
to authenticated
using (public.current_role() in ('admin', 'manager', 'director', 'nurse', 'coordinator'));

drop policy if exists "provider_directory_insert" on public.provider_directory;
create policy "provider_directory_insert"
on public.provider_directory
for insert
to authenticated
with check (public.current_role() in ('admin', 'manager', 'director', 'nurse', 'coordinator'));

drop policy if exists "provider_directory_update" on public.provider_directory;
create policy "provider_directory_update"
on public.provider_directory
for update
to authenticated
using (public.current_role() in ('admin', 'manager', 'director', 'nurse', 'coordinator'))
with check (public.current_role() in ('admin', 'manager', 'director', 'nurse', 'coordinator'));

drop policy if exists "schedule_changes_insert" on public.schedule_changes;
create policy "schedule_changes_insert"
on public.schedule_changes
for insert
to authenticated
with check (public.current_role() in ('admin', 'manager', 'director', 'nurse', 'coordinator'));

drop policy if exists "schedule_changes_update" on public.schedule_changes;
create policy "schedule_changes_update"
on public.schedule_changes
for update
to authenticated
using (public.current_role() in ('admin', 'manager', 'director', 'nurse', 'coordinator'))
with check (public.current_role() in ('admin', 'manager', 'director', 'nurse', 'coordinator'));

drop policy if exists "transportation_manifest_adjustments_delete" on public.transportation_manifest_adjustments;
create policy "transportation_manifest_adjustments_delete"
on public.transportation_manifest_adjustments
for delete
to authenticated
using (public.current_role() in ('admin', 'manager', 'director', 'coordinator'));

drop policy if exists "transportation_manifest_adjustments_insert" on public.transportation_manifest_adjustments;
create policy "transportation_manifest_adjustments_insert"
on public.transportation_manifest_adjustments
for insert
to authenticated
with check (public.current_role() in ('admin', 'manager', 'director', 'coordinator'));

drop policy if exists "transportation_manifest_adjustments_update" on public.transportation_manifest_adjustments;
create policy "transportation_manifest_adjustments_update"
on public.transportation_manifest_adjustments
for update
to authenticated
using (public.current_role() in ('admin', 'manager', 'director', 'coordinator'))
with check (public.current_role() in ('admin', 'manager', 'director', 'coordinator'));
