-- Close lazy MCC shell creation in normal runtime write paths.
-- Canonical member shell rows must come from lead conversion or explicit repair/backfill workflows.

alter function public.convert_enrollment_packet_to_member(
  uuid,
  uuid,
  uuid,
  text,
  text,
  timestamptz,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb
) rename to convert_enrollment_packet_to_member_internal;

revoke all on function public.convert_enrollment_packet_to_member_internal(
  uuid,
  uuid,
  uuid,
  text,
  text,
  timestamptz,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb
) from public, anon, authenticated;

grant execute on function public.convert_enrollment_packet_to_member_internal(
  uuid,
  uuid,
  uuid,
  text,
  text,
  timestamptz,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb
) to service_role;

create or replace function public.convert_enrollment_packet_to_member(
  p_packet_id uuid,
  p_member_id uuid,
  p_actor_user_id uuid,
  p_actor_name text,
  p_actor_email text default null,
  p_started_at timestamptz default now(),
  p_member_patch jsonb default '{}'::jsonb,
  p_mcc_patch jsonb default '{}'::jsonb,
  p_attendance_patch jsonb default '{}'::jsonb,
  p_contacts jsonb default '[]'::jsonb,
  p_mhp_patch jsonb default '{}'::jsonb,
  p_pof_stage_payload jsonb default '{}'::jsonb,
  p_record_rows jsonb default '[]'::jsonb,
  p_summary jsonb default '{}'::jsonb
)
returns table (
  packet_id uuid,
  member_id uuid,
  lead_id uuid,
  conversion_status text,
  mapping_run_id uuid,
  systems jsonb,
  downstream_systems_updated text[],
  conflicts_requiring_review integer,
  records_persisted integer,
  conflict_ids uuid[],
  entity_references jsonb
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_member_id is null then
    raise exception 'convert_enrollment_packet_to_member requires p_member_id';
  end if;

  perform 1
  from public.members
  where id = p_member_id;
  if not found then
    raise exception 'Member % was not found for enrollment conversion.', p_member_id;
  end if;

  perform 1
  from public.member_command_centers
  where member_id = p_member_id;
  if not found then
    raise exception 'Missing canonical member_command_centers row for member %. Enrollment packet downstream mapping must not create Member Command Center shells. Run canonical lead conversion or an explicit repair workflow first.', p_member_id;
  end if;

  perform 1
  from public.member_attendance_schedules
  where member_id = p_member_id;
  if not found then
    raise exception 'Missing canonical member_attendance_schedules row for member %. Enrollment packet downstream mapping must not create attendance schedule shells. Run canonical lead conversion or an explicit repair workflow first.', p_member_id;
  end if;

  perform 1
  from public.member_health_profiles
  where member_id = p_member_id;
  if not found then
    raise exception 'Missing canonical member_health_profiles row for member %. Enrollment packet downstream mapping must not create Member Health Profile shells. Run canonical lead conversion or an explicit repair workflow first.', p_member_id;
  end if;

  return query
  select *
  from public.convert_enrollment_packet_to_member_internal(
    p_packet_id,
    p_member_id,
    p_actor_user_id,
    p_actor_name,
    p_actor_email,
    p_started_at,
    p_member_patch,
    p_mcc_patch,
    p_attendance_patch,
    p_contacts,
    p_mhp_patch,
    p_pof_stage_payload,
    p_record_rows,
    p_summary
  );
end;
$$;

revoke all on function public.convert_enrollment_packet_to_member(
  uuid,
  uuid,
  uuid,
  text,
  text,
  timestamptz,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb
) from public, anon, authenticated;

grant execute on function public.convert_enrollment_packet_to_member(
  uuid,
  uuid,
  uuid,
  text,
  text,
  timestamptz,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb
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

  perform 1
  from public.member_command_centers
  where member_id = p_member_id;
  if not found then
    raise exception 'Missing canonical member_command_centers row for member %. Member Command Center writes must not create shells during runtime. Run canonical lead conversion or an explicit repair workflow first.', p_member_id;
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

  perform 1
  from public.member_attendance_schedules
  where member_id = p_member_id;
  if not found then
    raise exception 'Missing canonical member_attendance_schedules row for member %. MCC attendance/billing writes must not create schedule shells during runtime. Run canonical lead conversion or an explicit repair workflow first.', p_member_id;
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

  perform 1
  from public.member_attendance_schedules
  where member_id = p_member_id;
  if not found then
    raise exception 'Missing canonical member_attendance_schedules row for member %. MCC transportation writes must not create schedule shells during runtime. Run canonical lead conversion or an explicit repair workflow first.', p_member_id;
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

  perform 1
  from public.member_attendance_schedules
  where member_id = p_member_id;
  if not found then
    raise exception 'Missing canonical member_attendance_schedules row for member %. Schedule-change workflows must not create attendance schedule shells during runtime. Run canonical lead conversion or an explicit repair workflow first.', p_member_id;
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
declare
  v_member_id uuid;
begin
  if auth.role() <> 'service_role' and public.current_role() not in ('admin', 'manager', 'director', 'coordinator') then
    raise exception 'rpc_update_schedule_change_status_with_attendance_sync requires admin, manager, director, or coordinator role.';
  end if;

  select schedule_changes.member_id
  into v_member_id
  from public.schedule_changes as schedule_changes
  where schedule_changes.id = p_schedule_change_id;

  if v_member_id is not null then
    perform 1
    from public.member_attendance_schedules
    where member_id = v_member_id;
    if not found then
      raise exception 'Missing canonical member_attendance_schedules row for member %. Schedule-change workflows must not create attendance schedule shells during runtime. Run canonical lead conversion or an explicit repair workflow first.', v_member_id;
    end if;
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

alter function public.rpc_sync_member_health_profile_to_command_center(
  uuid,
  uuid,
  text,
  timestamptz
) rename to rpc_sync_member_health_profile_to_command_center_internal;

revoke all on function public.rpc_sync_member_health_profile_to_command_center_internal(
  uuid,
  uuid,
  text,
  timestamptz
) from public, anon, authenticated;

grant execute on function public.rpc_sync_member_health_profile_to_command_center_internal(
  uuid,
  uuid,
  text,
  timestamptz
) to service_role;

create or replace function public.rpc_sync_member_health_profile_to_command_center(
  p_member_id uuid,
  p_actor_user_id uuid default null,
  p_actor_name text default null,
  p_now timestamptz default now()
)
returns table (
  member_id uuid,
  member_health_profile_id uuid,
  member_command_center_id text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_member_id is null then
    raise exception 'rpc_sync_member_health_profile_to_command_center requires p_member_id';
  end if;

  perform 1
  from public.member_health_profiles
  where member_id = p_member_id;
  if not found then
    raise exception 'Missing canonical member_health_profiles row for member %. MHP sync must not create shells during runtime. Run canonical lead conversion or an explicit repair workflow first.', p_member_id;
  end if;

  perform 1
  from public.member_command_centers
  where member_id = p_member_id;
  if not found then
    raise exception 'Missing canonical member_command_centers row for member %. MHP-to-MCC sync must not create Member Command Center shells during runtime. Run canonical lead conversion or an explicit repair workflow first.', p_member_id;
  end if;

  return query
  select *
  from public.rpc_sync_member_health_profile_to_command_center_internal(
    p_member_id,
    p_actor_user_id,
    p_actor_name,
    p_now
  );
end;
$$;

revoke all on function public.rpc_sync_member_health_profile_to_command_center(
  uuid,
  uuid,
  text,
  timestamptz
) from public, anon;

grant execute on function public.rpc_sync_member_health_profile_to_command_center(
  uuid,
  uuid,
  text,
  timestamptz
) to authenticated, service_role;
