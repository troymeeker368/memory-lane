create table if not exists public.pay_periods (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  start_date date not null,
  end_date date not null,
  is_closed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(start_date, end_date)
);

create table if not exists public.punches (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles(id),
  employee_name text not null,
  timestamp timestamptz not null,
  type text not null check (type in ('in', 'out')),
  source text not null check (source in ('employee', 'director_correction', 'approved_forgotten_punch')),
  status text not null check (status in ('active', 'voided')) default 'active',
  note text,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_punches_employee_timestamp on public.punches(employee_id, timestamp);

create table if not exists public.daily_timecards (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles(id),
  employee_name text not null,
  work_date date not null,
  first_in timestamptz,
  last_out timestamptz,
  raw_hours numeric(8,2) not null default 0,
  meal_deduction_hours numeric(8,2) not null default 0,
  worked_hours numeric(8,2) not null default 0,
  pto_hours numeric(8,2) not null default 0,
  overtime_hours numeric(8,2) not null default 0,
  total_paid_hours numeric(8,2) not null default 0,
  status text not null check (status in ('pending', 'needs_review', 'approved', 'corrected')) default 'pending',
  director_note text,
  approved_by text,
  approved_at timestamptz,
  pay_period_id uuid references public.pay_periods(id),
  has_exception boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(employee_id, work_date)
);

create index if not exists idx_daily_timecards_period on public.daily_timecards(pay_period_id, employee_id, work_date);

create table if not exists public.forgotten_punch_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles(id),
  employee_name text not null,
  work_date date not null,
  request_type text not null check (request_type in ('missing_in', 'missing_out', 'full_shift', 'edit_shift')),
  requested_in time,
  requested_out time,
  reason text not null,
  employee_note text,
  status text not null check (status in ('submitted', 'approved', 'denied')) default 'submitted',
  director_decision_note text,
  approved_by text,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_forgotten_punch_requests_employee_date on public.forgotten_punch_requests(employee_id, work_date);

create table if not exists public.pto_entries (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles(id),
  employee_name text not null,
  work_date date not null,
  hours numeric(8,2) not null default 0,
  type text not null check (type in ('vacation', 'sick', 'holiday', 'personal')),
  status text not null check (status in ('pending', 'approved', 'denied')) default 'pending',
  note text,
  approved_by text,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_pto_entries_employee_date on public.pto_entries(employee_id, work_date);

drop trigger if exists trg_pay_periods_updated on public.pay_periods;
create trigger trg_pay_periods_updated before update on public.pay_periods
for each row execute function public.set_updated_at();

drop trigger if exists trg_punches_updated on public.punches;
create trigger trg_punches_updated before update on public.punches
for each row execute function public.set_updated_at();

drop trigger if exists trg_daily_timecards_updated on public.daily_timecards;
create trigger trg_daily_timecards_updated before update on public.daily_timecards
for each row execute function public.set_updated_at();

drop trigger if exists trg_forgotten_punch_requests_updated on public.forgotten_punch_requests;
create trigger trg_forgotten_punch_requests_updated before update on public.forgotten_punch_requests
for each row execute function public.set_updated_at();

drop trigger if exists trg_pto_entries_updated on public.pto_entries;
create trigger trg_pto_entries_updated before update on public.pto_entries
for each row execute function public.set_updated_at();

alter table public.pay_periods enable row level security;
alter table public.punches enable row level security;
alter table public.daily_timecards enable row level security;
alter table public.forgotten_punch_requests enable row level security;
alter table public.pto_entries enable row level security;

create policy "pay_periods_read" on public.pay_periods
for select using (auth.uid() is not null);

create policy "pay_periods_edit" on public.pay_periods
for all using (public.current_role() in ('admin', 'director', 'manager'))
with check (public.current_role() in ('admin', 'director', 'manager'));

create policy "punches_read" on public.punches
for select using (employee_id = auth.uid() or public.current_role() in ('admin', 'director', 'manager'));

create policy "punches_insert" on public.punches
for insert with check (employee_id = auth.uid() or public.current_role() in ('admin', 'director', 'manager'));

create policy "punches_update" on public.punches
for update using (public.current_role() in ('admin', 'director', 'manager'))
with check (public.current_role() in ('admin', 'director', 'manager'));

create policy "daily_timecards_read" on public.daily_timecards
for select using (employee_id = auth.uid() or public.current_role() in ('admin', 'director', 'manager'));

create policy "daily_timecards_edit" on public.daily_timecards
for all using (public.current_role() in ('admin', 'director', 'manager'))
with check (public.current_role() in ('admin', 'director', 'manager'));

create policy "forgotten_punch_requests_read" on public.forgotten_punch_requests
for select using (employee_id = auth.uid() or public.current_role() in ('admin', 'director', 'manager'));

create policy "forgotten_punch_requests_insert" on public.forgotten_punch_requests
for insert with check (employee_id = auth.uid() or public.current_role() in ('admin', 'director', 'manager'));

create policy "forgotten_punch_requests_update" on public.forgotten_punch_requests
for update using (public.current_role() in ('admin', 'director', 'manager'))
with check (public.current_role() in ('admin', 'director', 'manager'));

create policy "pto_entries_read" on public.pto_entries
for select using (employee_id = auth.uid() or public.current_role() in ('admin', 'director', 'manager'));

create policy "pto_entries_insert" on public.pto_entries
for insert with check (employee_id = auth.uid() or public.current_role() in ('admin', 'director', 'manager'));

create policy "pto_entries_update" on public.pto_entries
for update using (public.current_role() in ('admin', 'director', 'manager'))
with check (public.current_role() in ('admin', 'director', 'manager'));
