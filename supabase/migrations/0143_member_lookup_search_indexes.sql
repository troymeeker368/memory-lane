create extension if not exists pg_trgm;

create index if not exists idx_members_display_name_trgm
  on public.members
  using gin (display_name gin_trgm_ops);

create index if not exists idx_members_source_lead_discharge_date
  on public.members (source_lead_id, discharge_date)
  where source_lead_id is not null
    and discharge_date is not null;
