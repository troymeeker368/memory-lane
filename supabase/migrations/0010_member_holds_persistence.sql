create table if not exists public.member_holds (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  start_date date not null,
  end_date date,
  status text not null default 'active' check (status in ('active', 'ended')),
  reason text not null,
  reason_other text,
  notes text,
  created_by_user_id uuid references public.profiles(id),
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ended_at timestamptz,
  ended_by_user_id uuid references public.profiles(id),
  ended_by_name text
);

create index if not exists idx_member_holds_member_id on public.member_holds(member_id);
create index if not exists idx_member_holds_dates on public.member_holds(start_date, end_date, status);

drop trigger if exists trg_member_holds_updated on public.member_holds;
create trigger trg_member_holds_updated before update on public.member_holds
for each row execute function public.set_updated_at();

alter table public.member_holds enable row level security;

drop policy if exists "member_holds_read" on public.member_holds;
create policy "member_holds_read" on public.member_holds
for select using (auth.uid() is not null);

drop policy if exists "member_holds_insert" on public.member_holds;
create policy "member_holds_insert" on public.member_holds
for insert with check (public.current_role() in ('admin', 'manager', 'director'));

drop policy if exists "member_holds_update" on public.member_holds;
create policy "member_holds_update" on public.member_holds
for update using (public.current_role() in ('admin', 'manager', 'director'))
with check (public.current_role() in ('admin', 'manager', 'director'));
