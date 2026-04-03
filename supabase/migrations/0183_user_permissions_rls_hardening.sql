-- Harden canonical staff permission overrides behind an explicit database boundary.
-- Reads stay limited to authenticated admins. Writes stay on the canonical
-- service-role-backed user-management service path.

alter table public.user_permissions enable row level security;

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
