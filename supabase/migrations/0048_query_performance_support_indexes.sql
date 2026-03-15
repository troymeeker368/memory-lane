create index if not exists idx_member_files_member_id_uploaded_at_desc
  on public.member_files (member_id, uploaded_at desc);

create index if not exists idx_member_files_member_id_document_source
  on public.member_files (member_id, document_source);

create index if not exists idx_member_contacts_member_id_updated_at_desc
  on public.member_contacts (member_id, updated_at desc);

create index if not exists idx_audit_logs_entity_type_created_at_desc
  on public.audit_logs (entity_type, created_at desc);

create index if not exists idx_audit_logs_actor_user_id_created_at_desc
  on public.audit_logs (actor_user_id, created_at desc);

create index if not exists idx_documentation_events_event_at_desc
  on public.documentation_events (event_at desc);

create index if not exists idx_documentation_events_staff_user_id_event_at_desc
  on public.documentation_events (staff_user_id, event_at desc);

create index if not exists idx_documentation_assignments_due_at_open
  on public.documentation_assignments (due_at)
  where completed = false;

create index if not exists idx_time_punches_staff_user_id_punch_at_desc
  on public.time_punches (staff_user_id, punch_at desc);

create index if not exists idx_time_punch_exceptions_resolved_created_at_desc
  on public.time_punch_exceptions (resolved, created_at desc);

create index if not exists idx_leads_status_created_at_desc
  on public.leads (status, created_at desc);

create index if not exists idx_leads_status_next_follow_up_date_created_at_desc
  on public.leads (status, next_follow_up_date, created_at desc);

create index if not exists idx_lead_activities_lead_id_activity_at_desc
  on public.lead_activities (lead_id, activity_at desc);
