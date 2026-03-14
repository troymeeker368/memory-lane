-- Make attendance makeup balance updates and audit persistence atomic.
create or replace function public.apply_makeup_balance_delta_with_audit(
  p_schedule_id text,
  p_member_id uuid,
  p_attendance_date date,
  p_delta_days integer,
  p_source text,
  p_actor_user_id uuid,
  p_actor_role app_role,
  p_actor_name text,
  p_at timestamptz default now(),
  p_fail_if_insufficient boolean default false
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_current_balance integer;
  v_next_balance integer;
begin
  if p_delta_days = 0 then
    return jsonb_build_object(
      'applied', false,
      'previousBalance', null,
      'nextBalance', null
    );
  end if;

  select coalesce(s.make_up_days_available, 0)
    into v_current_balance
  from public.member_attendance_schedules s
  where s.id = p_schedule_id
  for update;

  if not found then
    raise exception 'Attendance schedule not found for makeup update: %', p_schedule_id;
  end if;

  if p_fail_if_insufficient and p_delta_days < 0 and (v_current_balance + p_delta_days) < 0 then
    raise exception 'No makeup days are currently available for this member.';
  end if;

  v_next_balance := greatest(0, v_current_balance + p_delta_days);

  if v_next_balance = v_current_balance then
    return jsonb_build_object(
      'applied', false,
      'previousBalance', v_current_balance,
      'nextBalance', v_next_balance
    );
  end if;

  update public.member_attendance_schedules
  set make_up_days_available = v_next_balance,
      updated_by_user_id = p_actor_user_id,
      updated_by_name = p_actor_name,
      updated_at = coalesce(p_at, now())
  where id = p_schedule_id;

  insert into public.audit_logs (
    actor_user_id,
    actor_role,
    action,
    entity_type,
    entity_id,
    details
  )
  values (
    p_actor_user_id,
    p_actor_role,
    'manager_review',
    'makeup_day',
    p_member_id::text,
    jsonb_build_object(
      'attendanceDate', p_attendance_date,
      'deltaDays', p_delta_days,
      'source', p_source,
      'scheduleId', p_schedule_id,
      'previousBalance', v_current_balance,
      'nextBalance', v_next_balance
    )
  );

  return jsonb_build_object(
    'applied', true,
    'previousBalance', v_current_balance,
    'nextBalance', v_next_balance
  );
end;
$$;

grant execute on function public.apply_makeup_balance_delta_with_audit(
  text,
  uuid,
  date,
  integer,
  text,
  uuid,
  app_role,
  text,
  timestamptz,
  boolean
) to authenticated;
