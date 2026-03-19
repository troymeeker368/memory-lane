alter table public.mar_administrations
  add column if not exists idempotency_key text;

create unique index if not exists idx_mar_administrations_prn_idempotency
  on public.mar_administrations (idempotency_key)
  where source = 'prn' and idempotency_key is not null;
