-- Harden canonical role template tables behind a database-enforced boundary.
-- Runtime permission resolution should continue through security-definer
-- helpers such as public.current_profile_has_permission().

alter table public.roles enable row level security;
alter table public.role_permissions enable row level security;

revoke all on table public.roles from public;
revoke all on table public.roles from anon;
revoke all on table public.roles from authenticated;
grant select, insert, update, delete on table public.roles to service_role;

revoke all on table public.role_permissions from public;
revoke all on table public.role_permissions from anon;
revoke all on table public.role_permissions from authenticated;
grant select, insert, update, delete on table public.role_permissions to service_role;

do $$
declare
  policy_record record;
begin
  for policy_record in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'roles'
  loop
    execute format('drop policy if exists %I on public.roles', policy_record.policyname);
  end loop;

  for policy_record in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'role_permissions'
  loop
    execute format('drop policy if exists %I on public.role_permissions', policy_record.policyname);
  end loop;
end
$$;

create policy "roles_service_role_all"
on public.roles
for all
to service_role
using (true)
with check (true);

create policy "role_permissions_service_role_all"
on public.role_permissions
for all
to service_role
using (true)
with check (true);
