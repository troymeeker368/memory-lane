alter table public.member_medications
  add column if not exists given_at_center boolean not null default true,
  add column if not exists prn boolean not null default false,
  add column if not exists prn_instructions text,
  add column if not exists scheduled_times text[] not null default '{}'::text[];

create index if not exists idx_member_medications_member_mar_active
  on public.member_medications (member_id, medication_status, given_at_center, updated_at desc);
