create index if not exists idx_attendance_records_attendance_date_member_status
  on public.attendance_records (attendance_date desc, member_id, status);

create index if not exists idx_member_attendance_schedules_transport_required_member
  on public.member_attendance_schedules (member_id)
  where transportation_required = true;

create index if not exists idx_transportation_logs_service_date_period_member_id
  on public.transportation_logs (service_date desc, period, member_id);

create index if not exists idx_transportation_runs_service_date_bus_last_submitted_desc
  on public.transportation_runs (service_date desc, bus_number, last_submitted_at desc);

create index if not exists idx_community_partner_organizations_partner_id
  on public.community_partner_organizations (partner_id);

create index if not exists idx_referral_sources_partner_id_organization_name
  on public.referral_sources (partner_id, organization_name);

create index if not exists idx_leads_partner_id_created_at_desc
  on public.leads (partner_id, created_at desc);

create index if not exists idx_leads_referral_source_id_created_at_desc
  on public.leads (referral_source_id, created_at desc);

create index if not exists idx_lead_activities_referral_source_id_activity_at_desc
  on public.lead_activities (referral_source_id, activity_at desc);

create index if not exists idx_partner_activities_partner_id_activity_at_desc
  on public.partner_activities (partner_id, activity_at desc);

create index if not exists idx_partner_activities_referral_source_id_activity_at_desc
  on public.partner_activities (referral_source_id, activity_at desc);

create index if not exists idx_billing_invoices_invoice_source_month
  on public.billing_invoices (invoice_source, invoice_month desc);
