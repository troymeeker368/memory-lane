create table if not exists public.schedule_changes (
  id text primary key,
  member_id uuid not null references public.members(id) on delete cascade,
  change_type text not null check (
    change_type in (
      'Scheduled Absence',
      'Makeup Day',
      'Day Swap',
      'Temporary Schedule Change',
      'Permanent Schedule Change'
    )
  ),
  effective_start_date date not null,
  effective_end_date date,
  original_days text[] not null default '{}',
  new_days text[] not null default '{}',
  suspend_base_schedule boolean not null default false,
  reason text not null,
  notes text,
  entered_by text not null,
  entered_by_user_id uuid references public.profiles(id) on delete set null,
  status text not null default 'active' check (status in ('active', 'cancelled', 'completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  closed_by text,
  closed_by_user_id uuid references public.profiles(id) on delete set null
);

create index if not exists idx_schedule_changes_member_id on public.schedule_changes(member_id);
create index if not exists idx_schedule_changes_status on public.schedule_changes(status);
create index if not exists idx_schedule_changes_effective_dates on public.schedule_changes(effective_start_date, effective_end_date);

drop trigger if exists trg_schedule_changes_updated on public.schedule_changes;
create trigger trg_schedule_changes_updated
before update on public.schedule_changes
for each row execute function public.set_updated_at();

alter table public.schedule_changes enable row level security;

drop policy if exists "schedule_changes_select" on public.schedule_changes;
drop policy if exists "schedule_changes_insert" on public.schedule_changes;
drop policy if exists "schedule_changes_update" on public.schedule_changes;
create policy "schedule_changes_select" on public.schedule_changes for select to authenticated using (true);
create policy "schedule_changes_insert" on public.schedule_changes for insert to authenticated with check (true);
create policy "schedule_changes_update" on public.schedule_changes for update to authenticated using (true) with check (true);
