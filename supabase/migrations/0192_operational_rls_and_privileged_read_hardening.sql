-- Align operational-table RLS with the app capability boundary and
-- allow self-scoped permission reads without service-role escalation.

create or replace function public.current_profile_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.id
  from public.profiles as p
  where p.auth_user_id = auth.uid()
     or p.id = auth.uid()
  order by
    case when p.auth_user_id = auth.uid() then 0 else 1 end,
    p.updated_at desc nulls last
  limit 1
$$;

grant execute on function public.current_profile_id() to authenticated;

create or replace function public.current_profile_has_permission(
  p_module_key text,
  p_action text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with current_profile as (
    select p.id, p.role_id, p.role, p.has_custom_permissions
    from public.profiles as p
    where p.id = public.current_profile_id()
  )
  select coalesce((
    select
      case
        when current_profile.has_custom_permissions then
          case p_action
            when 'can_view' then coalesce(user_permissions.can_view, false)
            when 'can_create' then coalesce(user_permissions.can_create, false)
            when 'can_edit' then coalesce(user_permissions.can_edit, false)
            when 'can_admin' then coalesce(user_permissions.can_admin, false)
            else false
          end
        else
          case p_action
            when 'can_view' then coalesce(role_permissions.can_view, false)
            when 'can_create' then coalesce(role_permissions.can_create, false)
            when 'can_edit' then coalesce(role_permissions.can_edit, false)
            when 'can_admin' then coalesce(role_permissions.can_admin, false)
            else false
          end
      end
    from current_profile
    left join public.user_permissions
      on user_permissions.user_id = current_profile.id
     and user_permissions.module_key = p_module_key
    left join public.roles
      on public.roles.id = current_profile.role_id
      or public.roles.key = current_profile.role
    left join public.role_permissions
      on role_permissions.role_id = public.roles.id
     and role_permissions.module_key = p_module_key
  ), false)
$$;

grant execute on function public.current_profile_has_permission(text, text) to authenticated;

drop policy if exists "user_permissions_read_self" on public.user_permissions;
create policy "user_permissions_read_self"
on public.user_permissions
for select
to authenticated
using (user_id = (select public.current_profile_id()));

drop policy if exists "member_command_centers_select" on public.member_command_centers;
create policy "member_command_centers_select"
on public.member_command_centers
for select
to authenticated
using ((select public.current_profile_has_permission('operations', 'can_view')));

drop policy if exists "member_command_centers_insert" on public.member_command_centers;
create policy "member_command_centers_insert"
on public.member_command_centers
for insert
to authenticated
with check (
  (select public.current_role()) in ('admin', 'manager')
  and (select public.current_profile_has_permission('operations', 'can_edit'))
);

drop policy if exists "member_command_centers_update" on public.member_command_centers;
create policy "member_command_centers_update"
on public.member_command_centers
for update
to authenticated
using (
  (select public.current_role()) in ('admin', 'manager')
  and (select public.current_profile_has_permission('operations', 'can_edit'))
)
with check (
  (select public.current_role()) in ('admin', 'manager')
  and (select public.current_profile_has_permission('operations', 'can_edit'))
);

drop policy if exists "member_attendance_schedules_select" on public.member_attendance_schedules;
create policy "member_attendance_schedules_select"
on public.member_attendance_schedules
for select
to authenticated
using ((select public.current_profile_has_permission('operations', 'can_view')));

drop policy if exists "member_attendance_schedules_insert" on public.member_attendance_schedules;
create policy "member_attendance_schedules_insert"
on public.member_attendance_schedules
for insert
to authenticated
with check ((select public.current_profile_has_permission('operations', 'can_edit')));

drop policy if exists "member_attendance_schedules_update" on public.member_attendance_schedules;
create policy "member_attendance_schedules_update"
on public.member_attendance_schedules
for update
to authenticated
using ((select public.current_profile_has_permission('operations', 'can_edit')))
with check ((select public.current_profile_has_permission('operations', 'can_edit')));

drop policy if exists "schedule_changes_select" on public.schedule_changes;
create policy "schedule_changes_select"
on public.schedule_changes
for select
to authenticated
using ((select public.current_profile_has_permission('operations', 'can_view')));

drop policy if exists "schedule_changes_insert" on public.schedule_changes;
create policy "schedule_changes_insert"
on public.schedule_changes
for insert
to authenticated
with check ((select public.current_role()) in ('admin', 'manager', 'director', 'coordinator'));

drop policy if exists "schedule_changes_update" on public.schedule_changes;
create policy "schedule_changes_update"
on public.schedule_changes
for update
to authenticated
using ((select public.current_role()) in ('admin', 'manager', 'director', 'coordinator'))
with check ((select public.current_role()) in ('admin', 'manager', 'director', 'coordinator'));

drop policy if exists "provider_directory_select" on public.provider_directory;
create policy "provider_directory_select"
on public.provider_directory
for select
to authenticated
using (
  (select public.current_role()) in ('admin', 'nurse')
  and (select public.current_profile_has_permission('health-unit', 'can_view'))
);

drop policy if exists "provider_directory_insert" on public.provider_directory;
create policy "provider_directory_insert"
on public.provider_directory
for insert
to authenticated
with check (
  (select public.current_role()) in ('admin', 'nurse')
  and (select public.current_profile_has_permission('health-unit', 'can_edit'))
);

drop policy if exists "provider_directory_update" on public.provider_directory;
create policy "provider_directory_update"
on public.provider_directory
for update
to authenticated
using (
  (select public.current_role()) in ('admin', 'nurse')
  and (select public.current_profile_has_permission('health-unit', 'can_edit'))
)
with check (
  (select public.current_role()) in ('admin', 'nurse')
  and (select public.current_profile_has_permission('health-unit', 'can_edit'))
);

drop policy if exists "provider_directory_delete" on public.provider_directory;
create policy "provider_directory_delete"
on public.provider_directory
for delete
to authenticated
using (
  (select public.current_role()) in ('admin', 'nurse')
  and (select public.current_profile_has_permission('health-unit', 'can_edit'))
);

drop policy if exists "hospital_preference_directory_select" on public.hospital_preference_directory;
create policy "hospital_preference_directory_select"
on public.hospital_preference_directory
for select
to authenticated
using (
  (select public.current_role()) in ('admin', 'nurse')
  and (select public.current_profile_has_permission('health-unit', 'can_view'))
);

drop policy if exists "hospital_preference_directory_insert" on public.hospital_preference_directory;
create policy "hospital_preference_directory_insert"
on public.hospital_preference_directory
for insert
to authenticated
with check (
  (select public.current_role()) in ('admin', 'nurse')
  and (select public.current_profile_has_permission('health-unit', 'can_edit'))
);

drop policy if exists "hospital_preference_directory_update" on public.hospital_preference_directory;
create policy "hospital_preference_directory_update"
on public.hospital_preference_directory
for update
to authenticated
using (
  (select public.current_role()) in ('admin', 'nurse')
  and (select public.current_profile_has_permission('health-unit', 'can_edit'))
)
with check (
  (select public.current_role()) in ('admin', 'nurse')
  and (select public.current_profile_has_permission('health-unit', 'can_edit'))
);

drop policy if exists "hospital_preference_directory_delete" on public.hospital_preference_directory;
create policy "hospital_preference_directory_delete"
on public.hospital_preference_directory
for delete
to authenticated
using (
  (select public.current_role()) in ('admin', 'nurse')
  and (select public.current_profile_has_permission('health-unit', 'can_edit'))
);

alter function public.rpc_update_member_command_center_bundle(
  uuid,
  jsonb,
  jsonb,
  uuid,
  text,
  timestamptz
) rename to rpc_update_member_command_center_bundle_internal;

revoke execute on function public.rpc_update_member_command_center_bundle_internal(
  uuid,
  jsonb,
  jsonb,
  uuid,
  text,
  timestamptz
) from authenticated;

grant execute on function public.rpc_update_member_command_center_bundle_internal(
  uuid,
  jsonb,
  jsonb,
  uuid,
  text,
  timestamptz
) to service_role;

create or replace function public.rpc_update_member_command_center_bundle(
  p_member_id uuid,
  p_mcc_patch jsonb default '{}'::jsonb,
  p_member_patch jsonb default '{}'::jsonb,
  p_actor_user_id uuid default null,
  p_actor_name text default null,
  p_now timestamptz default now()
)
returns table (
  member_command_center_id text
)
language plpgsql
security invoker
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' and (
    (select public.current_role()) not in ('admin', 'manager')
    or not (select public.current_profile_has_permission('operations', 'can_edit'))
  ) then
    raise exception 'rpc_update_member_command_center_bundle requires admin or manager operations edit access.';
  end if;

  return query
  select *
  from public.rpc_update_member_command_center_bundle_internal(
    p_member_id,
    p_mcc_patch,
    p_member_patch,
    p_actor_user_id,
    p_actor_name,
    p_now
  );
end;
$$;

grant execute on function public.rpc_update_member_command_center_bundle(
  uuid,
  jsonb,
  jsonb,
  uuid,
  text,
  timestamptz
) to authenticated, service_role;

alter function public.rpc_save_member_command_center_attendance_billing(
  uuid,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  uuid,
  text,
  timestamptz
) rename to rpc_save_member_command_center_attendance_billing_internal;

revoke execute on function public.rpc_save_member_command_center_attendance_billing_internal(
  uuid,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  uuid,
  text,
  timestamptz
) from authenticated;

grant execute on function public.rpc_save_member_command_center_attendance_billing_internal(
  uuid,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  uuid,
  text,
  timestamptz
) to service_role;

create or replace function public.rpc_save_member_command_center_attendance_billing(
  p_member_id uuid,
  p_schedule_patch jsonb,
  p_member_patch jsonb default '{}'::jsonb,
  p_billing_payload jsonb default '{}'::jsonb,
  p_template_payload jsonb default '{}'::jsonb,
  p_actor_user_id uuid default null,
  p_actor_name text default null,
  p_now timestamptz default now()
)
returns table (
  attendance_schedule_id text,
  billing_setting_id text,
  billing_schedule_template_id text
)
language plpgsql
security invoker
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' and not (select public.current_profile_has_permission('operations', 'can_edit')) then
    raise exception 'rpc_save_member_command_center_attendance_billing requires operations edit access.';
  end if;

  return query
  select *
  from public.rpc_save_member_command_center_attendance_billing_internal(
    p_member_id,
    p_schedule_patch,
    p_member_patch,
    p_billing_payload,
    p_template_payload,
    p_actor_user_id,
    p_actor_name,
    p_now
  );
end;
$$;

grant execute on function public.rpc_save_member_command_center_attendance_billing(
  uuid,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  uuid,
  text,
  timestamptz
) to authenticated, service_role;

alter function public.rpc_save_member_command_center_transportation(
  uuid,
  jsonb,
  jsonb,
  uuid,
  text,
  timestamptz
) rename to rpc_save_member_command_center_transportation_internal;

revoke execute on function public.rpc_save_member_command_center_transportation_internal(
  uuid,
  jsonb,
  jsonb,
  uuid,
  text,
  timestamptz
) from authenticated;

grant execute on function public.rpc_save_member_command_center_transportation_internal(
  uuid,
  jsonb,
  jsonb,
  uuid,
  text,
  timestamptz
) to service_role;

create or replace function public.rpc_save_member_command_center_transportation(
  p_member_id uuid,
  p_schedule_patch jsonb,
  p_bus_stop_names jsonb default '[]'::jsonb,
  p_actor_user_id uuid default null,
  p_actor_name text default null,
  p_now timestamptz default now()
)
returns table (
  attendance_schedule_id text
)
language plpgsql
security invoker
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' and (
    (select public.current_role()) not in ('admin', 'manager')
    or not (select public.current_profile_has_permission('operations', 'can_edit'))
  ) then
    raise exception 'rpc_save_member_command_center_transportation requires admin or manager operations edit access.';
  end if;

  return query
  select *
  from public.rpc_save_member_command_center_transportation_internal(
    p_member_id,
    p_schedule_patch,
    p_bus_stop_names,
    p_actor_user_id,
    p_actor_name,
    p_now
  );
end;
$$;

grant execute on function public.rpc_save_member_command_center_transportation(
  uuid,
  jsonb,
  jsonb,
  uuid,
  text,
  timestamptz
) to authenticated, service_role;

alter function public.rpc_save_schedule_change_with_attendance_sync(
  text,
  uuid,
  text,
  date,
  date,
  text[],
  text[],
  boolean,
  text,
  text,
  text,
  uuid,
  uuid,
  text,
  timestamptz
) rename to rpc_save_schedule_change_with_attendance_sync_internal;

revoke execute on function public.rpc_save_schedule_change_with_attendance_sync_internal(
  text,
  uuid,
  text,
  date,
  date,
  text[],
  text[],
  boolean,
  text,
  text,
  text,
  uuid,
  uuid,
  text,
  timestamptz
) from authenticated;

grant execute on function public.rpc_save_schedule_change_with_attendance_sync_internal(
  text,
  uuid,
  text,
  date,
  date,
  text[],
  text[],
  boolean,
  text,
  text,
  text,
  uuid,
  uuid,
  text,
  timestamptz
) to service_role;

create or replace function public.rpc_save_schedule_change_with_attendance_sync(
  p_schedule_change_id text default null,
  p_member_id uuid default null,
  p_change_type text default null,
  p_effective_start_date date default null,
  p_effective_end_date date default null,
  p_original_days text[] default '{}'::text[],
  p_new_days text[] default '{}'::text[],
  p_suspend_base_schedule boolean default false,
  p_reason text default null,
  p_notes text default null,
  p_entered_by text default null,
  p_entered_by_user_id uuid default null,
  p_actor_user_id uuid default null,
  p_actor_name text default null,
  p_now timestamptz default now()
)
returns table (
  id text,
  member_id uuid,
  change_type text,
  effective_start_date date,
  effective_end_date date,
  original_days text[],
  new_days text[],
  suspend_base_schedule boolean,
  reason text,
  notes text,
  entered_by text,
  entered_by_user_id uuid,
  status text,
  created_at timestamptz,
  updated_at timestamptz,
  closed_at timestamptz,
  closed_by text,
  closed_by_user_id uuid
)
language plpgsql
security invoker
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' and public.current_role() not in ('admin', 'manager', 'director', 'coordinator') then
    raise exception 'rpc_save_schedule_change_with_attendance_sync requires admin, manager, director, or coordinator role.';
  end if;

  return query
  select *
  from public.rpc_save_schedule_change_with_attendance_sync_internal(
    p_schedule_change_id,
    p_member_id,
    p_change_type,
    p_effective_start_date,
    p_effective_end_date,
    p_original_days,
    p_new_days,
    p_suspend_base_schedule,
    p_reason,
    p_notes,
    p_entered_by,
    p_entered_by_user_id,
    p_actor_user_id,
    p_actor_name,
    p_now
  );
end;
$$;

grant execute on function public.rpc_save_schedule_change_with_attendance_sync(
  text,
  uuid,
  text,
  date,
  date,
  text[],
  text[],
  boolean,
  text,
  text,
  text,
  uuid,
  uuid,
  text,
  timestamptz
) to authenticated, service_role;

alter function public.rpc_update_schedule_change_status_with_attendance_sync(
  text,
  text,
  uuid,
  text,
  timestamptz
) rename to rpc_update_schedule_change_status_with_attendance_sync_internal;

revoke execute on function public.rpc_update_schedule_change_status_with_attendance_sync_internal(
  text,
  text,
  uuid,
  text,
  timestamptz
) from authenticated;

grant execute on function public.rpc_update_schedule_change_status_with_attendance_sync_internal(
  text,
  text,
  uuid,
  text,
  timestamptz
) to service_role;

create or replace function public.rpc_update_schedule_change_status_with_attendance_sync(
  p_schedule_change_id text,
  p_status text,
  p_actor_user_id uuid default null,
  p_actor_name text default null,
  p_now timestamptz default now()
)
returns table (
  id text,
  member_id uuid,
  change_type text,
  effective_start_date date,
  effective_end_date date,
  original_days text[],
  new_days text[],
  suspend_base_schedule boolean,
  reason text,
  notes text,
  entered_by text,
  entered_by_user_id uuid,
  status text,
  created_at timestamptz,
  updated_at timestamptz,
  closed_at timestamptz,
  closed_by text,
  closed_by_user_id uuid
)
language plpgsql
security invoker
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' and public.current_role() not in ('admin', 'manager', 'director', 'coordinator') then
    raise exception 'rpc_update_schedule_change_status_with_attendance_sync requires admin, manager, director, or coordinator role.';
  end if;

  return query
  select *
  from public.rpc_update_schedule_change_status_with_attendance_sync_internal(
    p_schedule_change_id,
    p_status,
    p_actor_user_id,
    p_actor_name,
    p_now
  );
end;
$$;

grant execute on function public.rpc_update_schedule_change_status_with_attendance_sync(
  text,
  text,
  uuid,
  text,
  timestamptz
) to authenticated, service_role;

create or replace function public.rpc_lookup_provider_directory_normalized(
  p_provider_name text,
  p_practice_name text default null
)
returns table (
  id uuid,
  provider_name text,
  specialty text,
  specialty_other text,
  practice_name text,
  provider_phone text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' and (
    (select public.current_role()) not in ('admin', 'nurse')
    or not (select public.current_profile_has_permission('health-unit', 'can_view'))
  ) then
    raise exception 'rpc_lookup_provider_directory_normalized requires authorized health-unit access.';
  end if;

  return query
  with normalized_input as (
    select
      nullif(btrim(coalesce(p_provider_name, '')), '') as provider_name_trimmed,
      lower(btrim(coalesce(p_provider_name, ''))) as provider_name_normalized,
      lower(btrim(coalesce(p_practice_name, ''))) as practice_name_normalized
  )
  select
    directory.id,
    directory.provider_name,
    directory.specialty,
    directory.specialty_other,
    directory.practice_name,
    directory.provider_phone
  from public.provider_directory as directory
  cross join normalized_input as input
  where input.provider_name_trimmed is not null
    and lower(btrim(directory.provider_name)) = input.provider_name_normalized
    and lower(btrim(coalesce(directory.practice_name, ''))) = input.practice_name_normalized;
end;
$$;

create or replace function public.rpc_lookup_hospital_preference_directory_normalized(
  p_hospital_name text
)
returns table (
  id uuid,
  hospital_name text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' and (
    (select public.current_role()) not in ('admin', 'nurse')
    or not (select public.current_profile_has_permission('health-unit', 'can_view'))
  ) then
    raise exception 'rpc_lookup_hospital_preference_directory_normalized requires authorized health-unit access.';
  end if;

  return query
  with normalized_input as (
    select
      nullif(btrim(coalesce(p_hospital_name, '')), '') as hospital_name_trimmed,
      lower(btrim(coalesce(p_hospital_name, ''))) as hospital_name_normalized
  )
  select
    directory.id,
    directory.hospital_name
  from public.hospital_preference_directory as directory
  cross join normalized_input as input
  where input.hospital_name_trimmed is not null
    and lower(btrim(directory.hospital_name)) = input.hospital_name_normalized;
end;
$$;
