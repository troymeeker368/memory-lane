-- Remove direct authenticated table reads from canonical staff permission overrides.
-- Admin reads stay available through RLS, and service-role-backed writes remain canonical.
-- Non-admin self permission resolution must go through the shared security-definer function.

alter table public.user_permissions enable row level security;

revoke all on table public.user_permissions from public;
revoke all on table public.user_permissions from anon;
revoke insert, update, delete on table public.user_permissions from authenticated;
grant select on table public.user_permissions to authenticated;
grant select, insert, update, delete on table public.user_permissions to service_role;

drop policy if exists "user_permissions_read_self" on public.user_permissions;
drop policy if exists "user_permissions_read_admin" on public.user_permissions;
drop policy if exists "user_permissions_service_role_all" on public.user_permissions;

create policy "user_permissions_read_admin"
on public.user_permissions
for select
to authenticated
using ((select public.current_role()) = 'admin');

create policy "user_permissions_service_role_all"
on public.user_permissions
for all
to service_role
using (true)
with check (true);

create or replace function public.current_profile_custom_permissions()
returns table (
  module_key text,
  can_view boolean,
  can_create boolean,
  can_edit boolean,
  can_admin boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    up.module_key,
    up.can_view,
    up.can_create,
    up.can_edit,
    up.can_admin
  from public.user_permissions as up
  where up.user_id = public.current_profile_id()
  order by up.module_key
$$;

revoke all on function public.current_profile_custom_permissions() from public;
revoke all on function public.current_profile_custom_permissions() from anon;
revoke all on function public.current_profile_custom_permissions() from authenticated;

grant execute on function public.current_profile_custom_permissions() to authenticated;
