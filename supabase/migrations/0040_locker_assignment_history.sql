create table if not exists public.locker_assignment_history (
  locker_number text primary key,
  previous_member_id uuid references public.members(id) on delete set null,
  previous_member_assigned text not null,
  previous_assigned_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_locker_assignment_history_previous_member_id
  on public.locker_assignment_history(previous_member_id);

drop trigger if exists trg_locker_assignment_history_updated on public.locker_assignment_history;
create trigger trg_locker_assignment_history_updated before update on public.locker_assignment_history
for each row execute function public.set_updated_at();

alter table public.locker_assignment_history enable row level security;

drop policy if exists "locker_assignment_history_select" on public.locker_assignment_history;
drop policy if exists "locker_assignment_history_insert" on public.locker_assignment_history;
drop policy if exists "locker_assignment_history_update" on public.locker_assignment_history;
create policy "locker_assignment_history_select" on public.locker_assignment_history for select to authenticated using (true);
create policy "locker_assignment_history_insert" on public.locker_assignment_history for insert to authenticated with check (true);
create policy "locker_assignment_history_update" on public.locker_assignment_history for update to authenticated using (true) with check (true);
