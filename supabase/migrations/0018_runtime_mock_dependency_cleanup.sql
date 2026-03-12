create table if not exists public.operations_settings (
  id text primary key,
  bus_numbers text[] not null default '{}'::text[],
  makeup_policy text not null check (makeup_policy in ('rolling_30_day_expiration', 'running_total')),
  late_pickup_grace_start_time text not null,
  late_pickup_first_window_minutes integer not null,
  late_pickup_first_window_fee_cents integer not null,
  late_pickup_additional_per_minute_cents integer not null,
  late_pickup_additional_minutes_cap integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.operations_settings (
  id,
  bus_numbers,
  makeup_policy,
  late_pickup_grace_start_time,
  late_pickup_first_window_minutes,
  late_pickup_first_window_fee_cents,
  late_pickup_additional_per_minute_cents,
  late_pickup_additional_minutes_cap
)
values (
  'default',
  '{}'::text[],
  'rolling_30_day_expiration',
  '17:00',
  15,
  2500,
  200,
  15
)
on conflict (id) do nothing;

drop trigger if exists trg_operations_settings_updated on public.operations_settings;
create trigger trg_operations_settings_updated
before update on public.operations_settings
for each row execute function public.set_updated_at();

alter table public.operations_settings enable row level security;

drop policy if exists "operations_settings_select" on public.operations_settings;
create policy "operations_settings_select" on public.operations_settings
for select using (auth.uid() is not null);

drop policy if exists "operations_settings_insert" on public.operations_settings;
create policy "operations_settings_insert" on public.operations_settings
for insert
with check (public.current_role() in ('admin'));

drop policy if exists "operations_settings_update" on public.operations_settings;
create policy "operations_settings_update" on public.operations_settings
for update using (public.current_role() in ('admin'))
with check (public.current_role() in ('admin'));

alter table if exists public.ancillary_charge_logs
  add column if not exists source_entity text,
  add column if not exists source_entity_id text,
  add column if not exists quantity numeric(10,2) not null default 1,
  add column if not exists unit_rate numeric(10,2) not null default 0,
  add column if not exists amount numeric(12,2) not null default 0,
  add column if not exists billing_status text not null default 'Unbilled',
  add column if not exists reconciliation_status text not null default 'open',
  add column if not exists reconciled_by text,
  add column if not exists reconciled_at timestamptz,
  add column if not exists reconciliation_note text;

update public.ancillary_charge_logs acl
set
  quantity = coalesce(acl.quantity, 1),
  unit_rate = coalesce(acl.unit_rate, (acc.price_cents / 100.0)::numeric(10,2), 0),
  amount = coalesce(acl.amount, ((coalesce(acl.quantity, 1) * coalesce(acc.price_cents, 0)) / 100.0)::numeric(12,2), 0),
  billing_status = coalesce(nullif(acl.billing_status, ''), 'Unbilled'),
  reconciliation_status = coalesce(nullif(acl.reconciliation_status, ''), 'open')
from public.ancillary_charge_categories acc
where acc.id = acl.category_id;

drop view if exists public.v_ancillary_charge_logs_detailed;

create view public.v_ancillary_charge_logs_detailed as
select
  l.id,
  l.member_id,
  m.display_name as member_name,
  l.category_id,
  c.name as category_name,
  round((coalesce(l.amount, ((coalesce(l.quantity, 1) * coalesce(c.price_cents, 0)) / 100.0)::numeric(12,2), 0) * 100.0))::int as amount_cents,
  coalesce(l.quantity, 1)::numeric(10,2) as quantity,
  l.source_entity,
  l.source_entity_id,
  l.service_date,
  l.late_pickup_time,
  l.staff_user_id,
  p.full_name as staff_name,
  l.notes,
  coalesce(nullif(l.reconciliation_status, ''), 'open') as reconciliation_status,
  l.reconciled_by,
  l.reconciled_at,
  l.reconciliation_note,
  l.created_at
from public.ancillary_charge_logs l
join public.members m on m.id = l.member_id
join public.ancillary_charge_categories c on c.id = l.category_id
left join public.profiles p on p.id = l.staff_user_id;
