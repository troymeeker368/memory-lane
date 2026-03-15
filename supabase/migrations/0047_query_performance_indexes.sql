create index if not exists idx_member_files_member_uploaded_at
  on public.member_files (member_id, uploaded_at);

create index if not exists idx_member_files_member_document_source
  on public.member_files (member_id, document_source);

create index if not exists idx_member_contacts_member_updated_at
  on public.member_contacts (member_id, updated_at);

create index if not exists idx_audit_logs_entity_type_created_at
  on public.audit_logs (entity_type, created_at);

create index if not exists idx_documentation_events_event_at
  on public.documentation_events (event_at);

create index if not exists idx_documentation_assignments_due_at_incomplete
  on public.documentation_assignments (due_at)
  where completed = false;

create index if not exists idx_time_punches_staff_punch_at
  on public.time_punches (staff_user_id, punch_at);

create index if not exists idx_lead_activities_lead_activity_at
  on public.lead_activities (lead_id, activity_at);
