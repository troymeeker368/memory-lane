create table if not exists public.enrollment_pricing_community_fees (
  id uuid primary key default gen_random_uuid(),
  amount numeric(10,2) not null check (amount >= 0),
  effective_start_date date not null,
  effective_end_date date,
  is_active boolean not null default true,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_end_date is null or effective_end_date >= effective_start_date)
);

create index if not exists idx_enrollment_pricing_community_fees_active_dates
  on public.enrollment_pricing_community_fees(is_active, effective_start_date desc, effective_end_date desc nulls last);

create table if not exists public.enrollment_pricing_daily_rates (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  min_days_per_week integer not null check (min_days_per_week >= 1 and min_days_per_week <= 7),
  max_days_per_week integer not null check (max_days_per_week >= 1 and max_days_per_week <= 7),
  daily_rate numeric(10,2) not null check (daily_rate >= 0),
  effective_start_date date not null,
  effective_end_date date,
  is_active boolean not null default true,
  display_order integer not null default 100,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (max_days_per_week >= min_days_per_week),
  check (effective_end_date is null or effective_end_date >= effective_start_date)
);

create index if not exists idx_enrollment_pricing_daily_rates_active_dates
  on public.enrollment_pricing_daily_rates(is_active, display_order asc, effective_start_date desc, effective_end_date desc nulls last);
create index if not exists idx_enrollment_pricing_daily_rates_days
  on public.enrollment_pricing_daily_rates(min_days_per_week, max_days_per_week);

drop trigger if exists trg_enrollment_pricing_community_fees_updated on public.enrollment_pricing_community_fees;
create trigger trg_enrollment_pricing_community_fees_updated
before update on public.enrollment_pricing_community_fees
for each row execute function public.set_updated_at();

drop trigger if exists trg_enrollment_pricing_daily_rates_updated on public.enrollment_pricing_daily_rates;
create trigger trg_enrollment_pricing_daily_rates_updated
before update on public.enrollment_pricing_daily_rates
for each row execute function public.set_updated_at();

alter table public.enrollment_pricing_community_fees enable row level security;
alter table public.enrollment_pricing_daily_rates enable row level security;

drop policy if exists "enrollment_pricing_community_fees_select" on public.enrollment_pricing_community_fees;
drop policy if exists "enrollment_pricing_community_fees_insert" on public.enrollment_pricing_community_fees;
drop policy if exists "enrollment_pricing_community_fees_update" on public.enrollment_pricing_community_fees;
create policy "enrollment_pricing_community_fees_select" on public.enrollment_pricing_community_fees
for select to authenticated using (true);
create policy "enrollment_pricing_community_fees_insert" on public.enrollment_pricing_community_fees
for insert to authenticated with check (true);
create policy "enrollment_pricing_community_fees_update" on public.enrollment_pricing_community_fees
for update to authenticated using (true) with check (true);

drop policy if exists "enrollment_pricing_daily_rates_select" on public.enrollment_pricing_daily_rates;
drop policy if exists "enrollment_pricing_daily_rates_insert" on public.enrollment_pricing_daily_rates;
drop policy if exists "enrollment_pricing_daily_rates_update" on public.enrollment_pricing_daily_rates;
create policy "enrollment_pricing_daily_rates_select" on public.enrollment_pricing_daily_rates
for select to authenticated using (true);
create policy "enrollment_pricing_daily_rates_insert" on public.enrollment_pricing_daily_rates
for insert to authenticated with check (true);
create policy "enrollment_pricing_daily_rates_update" on public.enrollment_pricing_daily_rates
for update to authenticated using (true) with check (true);

alter table public.enrollment_packet_fields
  add column if not exists pricing_community_fee_id uuid references public.enrollment_pricing_community_fees(id) on delete set null,
  add column if not exists pricing_daily_rate_id uuid references public.enrollment_pricing_daily_rates(id) on delete set null,
  add column if not exists pricing_snapshot jsonb not null default '{}'::jsonb;

create index if not exists idx_enrollment_packet_fields_pricing_community_fee_id
  on public.enrollment_packet_fields(pricing_community_fee_id);
create index if not exists idx_enrollment_packet_fields_pricing_daily_rate_id
  on public.enrollment_packet_fields(pricing_daily_rate_id);

insert into public.enrollment_pricing_community_fees (
  amount,
  effective_start_date,
  effective_end_date,
  is_active,
  notes,
  created_by,
  updated_by
)
select
  750,
  current_date,
  null,
  true,
  'Initial default community fee seeded by migration 0026_enrollment_pricing_module.sql.',
  null,
  null
where not exists (
  select 1
  from public.enrollment_pricing_community_fees
  where is_active = true
    and amount = 750
    and effective_end_date is null
);

insert into public.enrollment_pricing_daily_rates (
  label,
  min_days_per_week,
  max_days_per_week,
  daily_rate,
  effective_start_date,
  effective_end_date,
  is_active,
  display_order,
  notes,
  created_by,
  updated_by
)
select
  seed.label,
  seed.min_days_per_week,
  seed.max_days_per_week,
  seed.daily_rate,
  current_date,
  null,
  true,
  seed.display_order,
  seed.notes,
  null,
  null
from (
  values
    ('1 day/week', 1, 1, 205::numeric(10,2), 10, 'Initial seeded daily rate tier.'),
    ('2-3 days/week', 2, 3, 180::numeric(10,2), 20, 'Initial seeded daily rate tier.'),
    ('4-5 days/week', 4, 5, 170::numeric(10,2), 30, 'Initial seeded daily rate tier.')
) as seed(label, min_days_per_week, max_days_per_week, daily_rate, display_order, notes)
where not exists (
  select 1
  from public.enrollment_pricing_daily_rates existing
  where existing.label = seed.label
    and existing.min_days_per_week = seed.min_days_per_week
    and existing.max_days_per_week = seed.max_days_per_week
    and existing.daily_rate = seed.daily_rate
    and existing.is_active = true
    and existing.effective_end_date is null
);
