create or replace function public.rpc_convert_lead_to_member(
  p_lead_id uuid,
  p_to_stage text,
  p_to_status text,
  p_business_status text,
  p_actor_user_id uuid,
  p_actor_name text,
  p_source text,
  p_reason text default null,
  p_member_display_name text default null,
  p_member_dob date default null,
  p_member_enrollment_date date default null,
  p_existing_member_id uuid default null,
  p_additional_lead_patch jsonb default '{}'::jsonb,
  p_now timestamptz default now(),
  p_today date default current_date
)
returns table (
  lead_id uuid,
  member_id uuid,
  from_stage text,
  to_stage text,
  from_status text,
  to_status text,
  business_status text
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_converted record;
begin
  select *
  into v_converted
  from public.apply_lead_stage_transition_with_member_upsert(
    p_lead_id => p_lead_id,
    p_to_stage => p_to_stage,
    p_to_status => p_to_status,
    p_business_status => p_business_status,
    p_actor_user_id => p_actor_user_id,
    p_actor_name => p_actor_name,
    p_source => p_source,
    p_reason => p_reason,
    p_member_display_name => p_member_display_name,
    p_member_dob => p_member_dob,
    p_member_enrollment_date => p_member_enrollment_date,
    p_existing_member_id => p_existing_member_id,
    p_additional_lead_patch => p_additional_lead_patch,
    p_now => p_now,
    p_today => p_today
  ) as converted;

  if v_converted.member_id is null then
    raise exception 'Lead conversion did not return a canonical member_id.';
  end if;

  perform 1
  from public.member_command_centers as member_command_centers
  where member_command_centers.member_id = v_converted.member_id;
  if not found then
    raise exception 'Lead conversion did not persist member_command_centers for member %.', v_converted.member_id;
  end if;

  perform 1
  from public.member_attendance_schedules as member_attendance_schedules
  where member_attendance_schedules.member_id = v_converted.member_id;
  if not found then
    raise exception 'Lead conversion did not persist member_attendance_schedules for member %.', v_converted.member_id;
  end if;

  perform 1
  from public.member_health_profiles as member_health_profiles
  where member_health_profiles.member_id = v_converted.member_id;
  if not found then
    raise exception 'Lead conversion did not persist member_health_profiles for member %.', v_converted.member_id;
  end if;

  lead_id := v_converted.lead_id;
  member_id := v_converted.member_id;
  from_stage := v_converted.from_stage;
  to_stage := v_converted.to_stage;
  from_status := v_converted.from_status;
  to_status := v_converted.to_status;
  business_status := v_converted.business_status;
  return next;
end;
$$;

create or replace function public.rpc_create_lead_with_member_conversion(
  p_to_stage text,
  p_to_status text,
  p_business_status text,
  p_created_by_user_id uuid,
  p_actor_user_id uuid,
  p_actor_name text,
  p_source text,
  p_reason text default null,
  p_member_display_name text default null,
  p_member_dob date default null,
  p_member_enrollment_date date default null,
  p_lead_patch jsonb default '{}'::jsonb,
  p_now timestamptz default now(),
  p_today date default current_date
)
returns table (
  lead_id uuid,
  member_id uuid,
  from_stage text,
  to_stage text,
  from_status text,
  to_status text,
  business_status text
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_created record;
begin
  select *
  into v_created
  from public.create_lead_with_member_conversion(
    p_to_stage => p_to_stage,
    p_to_status => p_to_status,
    p_business_status => p_business_status,
    p_created_by_user_id => p_created_by_user_id,
    p_actor_user_id => p_actor_user_id,
    p_actor_name => p_actor_name,
    p_source => p_source,
    p_reason => p_reason,
    p_member_display_name => p_member_display_name,
    p_member_dob => p_member_dob,
    p_member_enrollment_date => p_member_enrollment_date,
    p_lead_patch => p_lead_patch,
    p_now => p_now,
    p_today => p_today
  ) as created;

  if v_created.member_id is null then
    raise exception 'Lead creation with conversion did not return a canonical member_id.';
  end if;

  perform 1
  from public.member_command_centers as member_command_centers
  where member_command_centers.member_id = v_created.member_id;
  if not found then
    raise exception 'Lead creation with conversion did not persist member_command_centers for member %.', v_created.member_id;
  end if;

  perform 1
  from public.member_attendance_schedules as member_attendance_schedules
  where member_attendance_schedules.member_id = v_created.member_id;
  if not found then
    raise exception 'Lead creation with conversion did not persist member_attendance_schedules for member %.', v_created.member_id;
  end if;

  perform 1
  from public.member_health_profiles as member_health_profiles
  where member_health_profiles.member_id = v_created.member_id;
  if not found then
    raise exception 'Lead creation with conversion did not persist member_health_profiles for member %.', v_created.member_id;
  end if;

  lead_id := v_created.lead_id;
  member_id := v_created.member_id;
  from_stage := v_created.from_stage;
  to_stage := v_created.to_stage;
  from_status := v_created.from_status;
  to_status := v_created.to_status;
  business_status := v_created.business_status;
  return next;
end;
$$;
