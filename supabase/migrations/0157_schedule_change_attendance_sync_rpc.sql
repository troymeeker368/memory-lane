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
security definer
set search_path = public
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_schedule_change_id text := nullif(trim(coalesce(p_schedule_change_id, '')), '');
  v_actor_name text := nullif(trim(coalesce(p_actor_name, '')), '');
  v_entered_by text := nullif(trim(coalesce(p_entered_by, '')), '');
  v_previous public.schedule_changes%rowtype;
  v_saved public.schedule_changes%rowtype;
  v_member public.members%rowtype;
  v_attendance_schedule_id text;
  v_target_days text[] := null;
begin
  if p_member_id is null then
    raise exception 'rpc_save_schedule_change_with_attendance_sync requires p_member_id';
  end if;
  if nullif(trim(coalesce(p_change_type, '')), '') is null then
    raise exception 'rpc_save_schedule_change_with_attendance_sync requires p_change_type';
  end if;
  if p_change_type not in (
    'Scheduled Absence',
    'Makeup Day',
    'Day Swap',
    'Temporary Schedule Change',
    'Permanent Schedule Change'
  ) then
    raise exception 'Invalid schedule change type.';
  end if;
  if p_effective_start_date is null then
    raise exception 'rpc_save_schedule_change_with_attendance_sync requires p_effective_start_date';
  end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'rpc_save_schedule_change_with_attendance_sync requires p_reason';
  end if;

  select *
  into v_member
  from public.members as members
  where members.id = p_member_id
  for update;

  if not found then
    raise exception 'Member % not found for schedule change save.', p_member_id;
  end if;

  insert into public.member_attendance_schedules (
    id,
    member_id,
    enrollment_date,
    monday,
    tuesday,
    wednesday,
    thursday,
    friday,
    full_day,
    transportation_billing_status,
    attendance_days_per_week,
    make_up_days_available,
    created_at,
    updated_at
  )
  values (
    'attendance-' || p_member_id::text,
    p_member_id,
    coalesce(v_member.enrollment_date, (v_now at time zone 'America/New_York')::date),
    false,
    false,
    false,
    false,
    false,
    true,
    'BillNormally',
    0,
    0,
    v_now,
    v_now
  )
  on conflict on constraint member_attendance_schedules_member_id_key do nothing;

  select member_attendance_schedules.id
  into v_attendance_schedule_id
  from public.member_attendance_schedules as member_attendance_schedules
  where member_attendance_schedules.member_id = p_member_id
  for update;

  if v_schedule_change_id is not null then
    select *
    into v_previous
    from public.schedule_changes as schedule_changes
    where schedule_changes.id = v_schedule_change_id
    for update;

    if not found then
      raise exception 'Schedule change not found.';
    end if;
    if v_previous.status <> 'active' then
      raise exception 'Only active schedule changes can be edited. Completed or cancelled items stay locked as history.';
    end if;

    update public.schedule_changes as schedule_changes
    set
      member_id = p_member_id,
      change_type = p_change_type,
      effective_start_date = p_effective_start_date,
      effective_end_date = p_effective_end_date,
      original_days = coalesce(p_original_days, '{}'::text[]),
      new_days = coalesce(p_new_days, '{}'::text[]),
      suspend_base_schedule = coalesce(p_suspend_base_schedule, false),
      reason = trim(p_reason),
      notes = nullif(trim(coalesce(p_notes, '')), ''),
      updated_at = v_now
    where schedule_changes.id = v_schedule_change_id
    returning * into v_saved;
  else
    v_schedule_change_id := 'schedule-change-' || gen_random_uuid()::text;
    v_entered_by := coalesce(v_entered_by, v_actor_name, 'Unknown');

    insert into public.schedule_changes (
      id,
      member_id,
      change_type,
      effective_start_date,
      effective_end_date,
      original_days,
      new_days,
      suspend_base_schedule,
      reason,
      notes,
      entered_by,
      entered_by_user_id,
      status,
      created_at,
      updated_at,
      closed_at,
      closed_by,
      closed_by_user_id
    )
    values (
      v_schedule_change_id,
      p_member_id,
      p_change_type,
      p_effective_start_date,
      p_effective_end_date,
      coalesce(p_original_days, '{}'::text[]),
      coalesce(p_new_days, '{}'::text[]),
      coalesce(p_suspend_base_schedule, false),
      trim(p_reason),
      nullif(trim(coalesce(p_notes, '')), ''),
      v_entered_by,
      p_entered_by_user_id,
      'active',
      v_now,
      v_now,
      null,
      null,
      null
    )
    returning * into v_saved;
  end if;

  if v_saved.change_type = 'Permanent Schedule Change' then
    v_target_days := coalesce(v_saved.new_days, '{}'::text[]);
  elsif v_previous.id is not null and v_previous.change_type = 'Permanent Schedule Change' then
    v_target_days := coalesce(v_previous.original_days, '{}'::text[]);
  end if;

  if v_target_days is not null then
    update public.member_attendance_schedules as member_attendance_schedules
    set
      monday = 'monday' = any(v_target_days),
      tuesday = 'tuesday' = any(v_target_days),
      wednesday = 'wednesday' = any(v_target_days),
      thursday = 'thursday' = any(v_target_days),
      friday = 'friday' = any(v_target_days),
      attendance_days_per_week =
        case when 'monday' = any(v_target_days) then 1 else 0 end +
        case when 'tuesday' = any(v_target_days) then 1 else 0 end +
        case when 'wednesday' = any(v_target_days) then 1 else 0 end +
        case when 'thursday' = any(v_target_days) then 1 else 0 end +
        case when 'friday' = any(v_target_days) then 1 else 0 end,
      updated_by_user_id = p_actor_user_id,
      updated_by_name = v_actor_name,
      updated_at = v_now
    where member_attendance_schedules.id = v_attendance_schedule_id;
  end if;

  return query
  select
    v_saved.id,
    v_saved.member_id,
    v_saved.change_type,
    v_saved.effective_start_date,
    v_saved.effective_end_date,
    v_saved.original_days,
    v_saved.new_days,
    v_saved.suspend_base_schedule,
    v_saved.reason,
    v_saved.notes,
    v_saved.entered_by,
    v_saved.entered_by_user_id,
    v_saved.status,
    v_saved.created_at,
    v_saved.updated_at,
    v_saved.closed_at,
    v_saved.closed_by,
    v_saved.closed_by_user_id;
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
security definer
set search_path = public
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_actor_name text := nullif(trim(coalesce(p_actor_name, '')), '');
  v_schedule_change_id text := nullif(trim(coalesce(p_schedule_change_id, '')), '');
  v_saved public.schedule_changes%rowtype;
  v_member public.members%rowtype;
  v_attendance_schedule_id text;
  v_target_days text[] := null;
begin
  if v_schedule_change_id is null then
    raise exception 'rpc_update_schedule_change_status_with_attendance_sync requires p_schedule_change_id';
  end if;
  if p_status not in ('active', 'cancelled', 'completed') then
    raise exception 'Invalid schedule change status.';
  end if;

  select *
  into v_saved
  from public.schedule_changes as schedule_changes
  where schedule_changes.id = v_schedule_change_id
  for update;

  if not found then
    raise exception 'Schedule change not found.';
  end if;

  select *
  into v_member
  from public.members as members
  where members.id = v_saved.member_id
  for update;

  if not found then
    raise exception 'Member % not found for schedule change status update.', v_saved.member_id;
  end if;

  insert into public.member_attendance_schedules (
    id,
    member_id,
    enrollment_date,
    monday,
    tuesday,
    wednesday,
    thursday,
    friday,
    full_day,
    transportation_billing_status,
    attendance_days_per_week,
    make_up_days_available,
    created_at,
    updated_at
  )
  values (
    'attendance-' || v_saved.member_id::text,
    v_saved.member_id,
    coalesce(v_member.enrollment_date, (v_now at time zone 'America/New_York')::date),
    false,
    false,
    false,
    false,
    false,
    true,
    'BillNormally',
    0,
    0,
    v_now,
    v_now
  )
  on conflict on constraint member_attendance_schedules_member_id_key do nothing;

  select member_attendance_schedules.id
  into v_attendance_schedule_id
  from public.member_attendance_schedules as member_attendance_schedules
  where member_attendance_schedules.member_id = v_saved.member_id
  for update;

  update public.schedule_changes as schedule_changes
  set
    status = p_status,
    closed_at = case when p_status = 'active' then null else v_now end,
    closed_by = case when p_status = 'active' then null else v_actor_name end,
    closed_by_user_id = case when p_status = 'active' then null else p_actor_user_id end,
    updated_at = v_now
  where schedule_changes.id = v_schedule_change_id
  returning * into v_saved;

  if v_saved.change_type = 'Permanent Schedule Change' then
    if p_status = 'cancelled' then
      v_target_days := coalesce(v_saved.original_days, '{}'::text[]);
    elsif p_status in ('active', 'completed') then
      v_target_days := coalesce(v_saved.new_days, '{}'::text[]);
    end if;
  end if;

  if v_target_days is not null then
    update public.member_attendance_schedules as member_attendance_schedules
    set
      monday = 'monday' = any(v_target_days),
      tuesday = 'tuesday' = any(v_target_days),
      wednesday = 'wednesday' = any(v_target_days),
      thursday = 'thursday' = any(v_target_days),
      friday = 'friday' = any(v_target_days),
      attendance_days_per_week =
        case when 'monday' = any(v_target_days) then 1 else 0 end +
        case when 'tuesday' = any(v_target_days) then 1 else 0 end +
        case when 'wednesday' = any(v_target_days) then 1 else 0 end +
        case when 'thursday' = any(v_target_days) then 1 else 0 end +
        case when 'friday' = any(v_target_days) then 1 else 0 end,
      updated_by_user_id = p_actor_user_id,
      updated_by_name = v_actor_name,
      updated_at = v_now
    where member_attendance_schedules.id = v_attendance_schedule_id;
  end if;

  return query
  select
    v_saved.id,
    v_saved.member_id,
    v_saved.change_type,
    v_saved.effective_start_date,
    v_saved.effective_end_date,
    v_saved.original_days,
    v_saved.new_days,
    v_saved.suspend_base_schedule,
    v_saved.reason,
    v_saved.notes,
    v_saved.entered_by,
    v_saved.entered_by_user_id,
    v_saved.status,
    v_saved.created_at,
    v_saved.updated_at,
    v_saved.closed_at,
    v_saved.closed_by,
    v_saved.closed_by_user_id;
end;
$$;

grant execute on function public.rpc_update_schedule_change_status_with_attendance_sync(
  text,
  text,
  uuid,
  text,
  timestamptz
) to authenticated, service_role;
