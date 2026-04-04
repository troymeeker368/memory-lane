-- Tighten SQL privileges for canonical staff permission overrides.
-- Reads remain available to authenticated admins through RLS.
-- Writes remain restricted to the service-role-backed user-management service path.

alter table public.user_permissions enable row level security;

revoke all on table public.user_permissions from public;
revoke all on table public.user_permissions from anon;
revoke all on table public.user_permissions from authenticated;

grant select on table public.user_permissions to authenticated;
grant select, insert, update, delete on table public.user_permissions to service_role;

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
