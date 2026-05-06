begin;

alter table public.lead_activities
  add column if not exists idempotency_key text;

create unique index if not exists idx_lead_activities_idempotency_key
  on public.lead_activities (idempotency_key)
  where idempotency_key is not null;

commit;
