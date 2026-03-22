create extension if not exists pg_trgm;

create index if not exists idx_intake_assessments_created_by_user_id_created_at_desc
  on public.intake_assessments (created_by_user_id, created_at desc);

create index if not exists idx_leads_inquiry_date_desc
  on public.leads (inquiry_date desc);

create index if not exists idx_leads_member_name_trgm
  on public.leads using gin (member_name gin_trgm_ops);

create index if not exists idx_leads_caregiver_name_trgm
  on public.leads using gin (caregiver_name gin_trgm_ops);
