create index if not exists idx_leads_caregiver_email_trgm
  on public.leads using gin (caregiver_email gin_trgm_ops);
