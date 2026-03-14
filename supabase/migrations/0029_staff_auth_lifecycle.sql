alter table public.profiles
  add column if not exists auth_user_id uuid,
  add column if not exists status text not null default 'active',
  add column if not exists invited_at timestamptz,
  add column if not exists password_set_at timestamptz,
  add column if not exists last_sign_in_at timestamptz,
  add column if not exists disabled_at timestamptz,
  add column if not exists is_active boolean not null default true;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_auth_user_id_fkey'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_auth_user_id_fkey
      foreign key (auth_user_id) references auth.users(id) on delete cascade;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_status_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_status_check
      check (status in ('invited', 'active', 'disabled'));
  end if;
end $$;

update public.profiles
set
  auth_user_id = coalesce(auth_user_id, id),
  status = case
    when coalesce(nullif(lower(status), ''), '') in ('invited', 'active', 'disabled') then lower(status)
    when active = false then 'disabled'
    else 'active'
  end,
  is_active = coalesce(is_active, active, true),
  active = coalesce(active, is_active, true),
  disabled_at = case
    when coalesce(nullif(lower(status), ''), case when active = false then 'disabled' else 'active' end) = 'disabled'
      then coalesce(disabled_at, now())
    else null
  end
where true;

create or replace function public.sync_profile_auth_lifecycle_fields()
returns trigger
language plpgsql
as $$
begin
  new.auth_user_id := coalesce(new.auth_user_id, new.id);
  new.active := coalesce(new.active, new.is_active, true);
  new.is_active := coalesce(new.is_active, new.active, true);
  new.status := coalesce(nullif(lower(new.status), ''), case when new.active = false then 'disabled' else 'active' end);

  if new.status = 'disabled' then
    new.disabled_at := coalesce(new.disabled_at, now());
  else
    new.disabled_at := null;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_profiles_auth_lifecycle_sync on public.profiles;
create trigger trg_profiles_auth_lifecycle_sync
before insert or update on public.profiles
for each row execute function public.sync_profile_auth_lifecycle_fields();

create table if not exists public.staff_auth_events (
  id uuid primary key default gen_random_uuid(),
  staff_user_id uuid not null references public.profiles(id) on delete cascade,
  auth_user_id uuid references auth.users(id) on delete set null,
  actor_user_id uuid references public.profiles(id) on delete set null,
  event_type text not null check (
    event_type in (
      'invite_sent',
      'invite_resent',
      'password_set',
      'password_reset_requested',
      'password_reset_completed',
      'login_disabled',
      'login_enabled'
    )
  ),
  event_details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_staff_auth_events_staff_created
  on public.staff_auth_events(staff_user_id, created_at desc);

create index if not exists idx_staff_auth_events_type_created
  on public.staff_auth_events(event_type, created_at desc);

alter table public.staff_auth_events enable row level security;

drop policy if exists "staff_auth_events_select_admin_manager" on public.staff_auth_events;
create policy "staff_auth_events_select_admin_manager"
on public.staff_auth_events
for select
using (public.current_role() in ('admin', 'manager'));

drop policy if exists "staff_auth_events_insert_actor_or_service" on public.staff_auth_events;
create policy "staff_auth_events_insert_actor_or_service"
on public.staff_auth_events
for insert
with check (
  actor_user_id = auth.uid()
  or staff_user_id = auth.uid()
  or auth.role() = 'service_role'
);
