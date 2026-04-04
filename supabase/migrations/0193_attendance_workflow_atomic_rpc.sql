create index if not exists idx_billing_adjustments_source_lookup
  on public.billing_adjustments (source_table, source_record_id)
  where source_table is not null and source_record_id is not null;

create index if not exists idx_ancillary_charge_logs_source_lookup
  on public.ancillary_charge_logs (source_entity, source_entity_id)
  where source_entity is not null and source_entity_id is not null;

create or replace function public.rpc_save_attendance_workflow_internal(
  p_member_id uuid,
  p_attendance_date date,
  p_operation text,
  p_delete_record boolean default false,
  p_status text default null,
  p_absent_reason text default null,
  p_absent_reason_other text default null,
  p_check_in_at timestamptz default null,
  p_check_out_at timestamptz default null,
  p_notes text default null,
  p_is_scheduled_day boolean default false,
  p_makeup_schedule_id text default null,
  p_use_makeup_day boolean default false,
  p_should_have_extra_day_adjustment boolean default false,
  p_extra_day_rate numeric default 0,
  p_late_pickup_time text default null,
  p_late_pickup_fee_cents integer default 0,
  p_actor_user_id uuid default null,
  p_actor_role public.app_role default null,
  p_actor_name text default null,
  p_now timestamptz default now()
)
returns table (
  attendance_record_id uuid,
  member_id uuid,
  attendance_date date,
  status text,
  absent_reason text,
  absent_reason_other text,
  check_in_at timestamptz,
  check_out_at timestamptz,
  linked_adjustment_id text,
  billing_status text,
  notes text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_actor_name text := nullif(trim(coalesce(p_actor_name, '')), '');
  v_operation text := lower(trim(coalesce(p_operation, '')));
  v_should_delete boolean := coalesce(p_delete_record, false);
  v_existing public.attendance_records%rowtype;
  v_saved public.attendance_records%rowtype;
  v_record_changed boolean := false;
  v_makeup_schedule_id text := nullif(trim(coalesce(p_makeup_schedule_id, '')), '');
  v_makeup_delta_days integer := 0;
  v_makeup_source text := null;
  v_makeup_result jsonb := null;
  v_unscheduled_makeup_net integer := 0;
  v_should_have_extra_day_adjustment boolean := coalesce(p_should_have_extra_day_adjustment, false);
  v_extra_day_rate numeric(10,2) := round(greatest(coalesce(p_extra_day_rate, 0), 0)::numeric, 2);
  v_source_adjustment public.billing_adjustments%rowtype;
  v_source_adjustment_count integer := 0;
  v_linked_adjustment_id text := null;
  v_billing_adjustment_action text := 'none';
  v_billing_adjustment_changed boolean := false;
  v_target_adjustment_exclusion_reason text := null;
  v_late_pickup_category_id uuid;
  v_existing_late_pickup public.ancillary_charge_logs%rowtype;
  v_existing_late_pickup_count integer := 0;
  v_late_pickup_action text := 'none';
  v_late_pickup_changed boolean := false;
  v_target_late_pickup_time text := nullif(trim(coalesce(p_late_pickup_time, '')), '');
  v_should_have_late_pickup_charge boolean :=
    nullif(trim(coalesce(p_late_pickup_time, '')), '') is not null and greatest(coalesce(p_late_pickup_fee_cents, 0), 0) > 0;
  v_late_pickup_amount numeric(10,2) :=
    round((greatest(coalesce(p_late_pickup_fee_cents, 0), 0)::numeric / 100.0), 2);
  v_target_record_billing_status text;
  v_any_changed boolean := false;
begin
  if p_member_id is null then
    raise exception 'rpc_save_attendance_workflow requires p_member_id';
  end if;
  if p_attendance_date is null then
    raise exception 'rpc_save_attendance_workflow requires p_attendance_date';
  end if;
  if v_operation not in ('clear', 'present', 'absent', 'check-in', 'check-out', 'unscheduled') then
    raise exception 'Invalid attendance workflow operation.';
  end if;
  if not v_should_delete and p_status not in ('present', 'absent') then
    raise exception 'Attendance workflow status must be present or absent.';
  end if;

  perform 1
  from public.members
  where id = p_member_id
  for update;

  if not found then
    raise exception 'Member % not found for attendance workflow.', p_member_id;
  end if;

  select *
  into v_existing
  from public.attendance_records
  where member_id = p_member_id
    and attendance_date = p_attendance_date
  for update;

  if v_existing.id is not null and coalesce(v_existing.billing_status, '') = 'Billed' then
    if v_should_delete
      or v_existing.status is distinct from p_status
      or v_existing.absent_reason is distinct from p_absent_reason
      or v_existing.absent_reason_other is distinct from p_absent_reason_other
      or v_existing.check_in_at is distinct from p_check_in_at
      or v_existing.check_out_at is distinct from p_check_out_at
      or v_existing.notes is distinct from p_notes
      or v_existing.scheduled_day is distinct from coalesce(p_is_scheduled_day, false)
      or v_existing.unscheduled_day is distinct from (not coalesce(p_is_scheduled_day, false))
      or v_existing.billable_extra_day is distinct from coalesce(p_should_have_extra_day_adjustment, false) then
      raise exception 'Attendance has already been billed and cannot be changed automatically.';
    end if;
  end if;

  if v_makeup_schedule_id is not null then
    select coalesce(sum((details ->> 'deltaDays')::integer), 0)
    into v_unscheduled_makeup_net
    from public.audit_logs
    where entity_type = 'makeup_day'
      and entity_id = p_member_id::text
      and details ->> 'attendanceDate' = p_attendance_date::text
      and details ->> 'scheduleId' = v_makeup_schedule_id
      and details ->> 'source' in (
        'unscheduled-attendance',
        'unscheduled-attendance-clear-reversal',
        'unscheduled-attendance-status-reversal'
      );
  end if;

  if not coalesce(p_is_scheduled_day, false)
    and v_makeup_schedule_id is not null
    and coalesce(p_use_makeup_day, false)
    and v_unscheduled_makeup_net >= 0 then
    v_makeup_delta_days := -1;
    v_makeup_source := 'unscheduled-attendance';
  elsif not coalesce(p_is_scheduled_day, false)
    and v_makeup_schedule_id is not null
    and v_unscheduled_makeup_net < 0
    and (v_should_delete or coalesce(p_status, '') <> 'present') then
    v_makeup_delta_days := 1;
    v_makeup_source := case
      when v_should_delete then 'unscheduled-attendance-clear-reversal'
      else 'unscheduled-attendance-status-reversal'
    end;
  elsif coalesce(p_is_scheduled_day, false)
    and v_existing.id is not null
    and v_existing.status = 'absent'
    and v_operation in ('clear', 'present', 'check-in', 'check-out') then
    v_makeup_delta_days := -1;
    v_makeup_source := case v_operation
      when 'clear' then 'attendance-clear-absence'
      when 'check-in' then 'attendance-check-in-reversal'
      when 'check-out' then 'attendance-check-out-reversal'
      else 'attendance-present-reversal'
    end;
  elsif coalesce(p_is_scheduled_day, false)
    and v_operation = 'absent'
    and coalesce(v_existing.status, '') <> 'absent' then
    v_makeup_delta_days := 1;
    v_makeup_source := 'attendance-absence-accrual';
  end if;

  if v_should_delete then
    v_saved := v_existing;
  elsif v_existing.id is null then
    insert into public.attendance_records (
      member_id,
      attendance_date,
      status,
      absent_reason,
      absent_reason_other,
      check_in_at,
      check_out_at,
      notes,
      recorded_by_user_id,
      recorded_by_name,
      created_at,
      updated_at
    )
    values (
      p_member_id,
      p_attendance_date,
      p_status,
      p_absent_reason,
      p_absent_reason_other,
      p_check_in_at,
      p_check_out_at,
      p_notes,
      p_actor_user_id,
      v_actor_name,
      v_now,
      v_now
    )
    returning * into v_saved;
    v_record_changed := true;
  else
    v_saved := v_existing;
    if v_existing.status is distinct from p_status
      or v_existing.absent_reason is distinct from p_absent_reason
      or v_existing.absent_reason_other is distinct from p_absent_reason_other
      or v_existing.check_in_at is distinct from p_check_in_at
      or v_existing.check_out_at is distinct from p_check_out_at
      or v_existing.notes is distinct from p_notes then
      update public.attendance_records
      set
        status = p_status,
        absent_reason = p_absent_reason,
        absent_reason_other = p_absent_reason_other,
        check_in_at = p_check_in_at,
        check_out_at = p_check_out_at,
        notes = p_notes,
        recorded_by_user_id = p_actor_user_id,
        recorded_by_name = v_actor_name,
        updated_at = v_now
      where id = v_existing.id
      returning * into v_saved;
      v_record_changed := true;
    end if;
  end if;

  if coalesce(v_saved.id, v_existing.id) is not null then
    select count(*)
    into v_source_adjustment_count
    from public.billing_adjustments
    where source_table = 'attendance_records'
      and source_record_id = coalesce(v_saved.id, v_existing.id)::text
      and adjustment_type = 'ExtraDay';

    if v_source_adjustment_count > 1 then
      raise exception 'Multiple attendance-derived billing adjustments exist for attendance record %.', coalesce(v_saved.id, v_existing.id);
    end if;

    select *
    into v_source_adjustment
    from public.billing_adjustments
    where source_table = 'attendance_records'
      and source_record_id = coalesce(v_saved.id, v_existing.id)::text
      and adjustment_type = 'ExtraDay'
    order by created_at asc, id asc
    limit 1
    for update;

    if v_source_adjustment.id is null and nullif(coalesce(v_existing.linked_adjustment_id, ''), '') is not null then
      select *
      into v_source_adjustment
      from public.billing_adjustments
      where id::text = v_existing.linked_adjustment_id
      for update;

      if v_source_adjustment.id is not null
        and (
          (v_source_adjustment.source_table is not null and v_source_adjustment.source_table <> 'attendance_records')
          or (
            v_source_adjustment.source_record_id is not null
            and v_source_adjustment.source_record_id <> coalesce(v_saved.id, v_existing.id)::text
          )
        ) then
        raise exception 'Attendance linked billing adjustment points to a different source record.';
      end if;
    elsif v_source_adjustment.id is not null
      and nullif(coalesce(v_existing.linked_adjustment_id, ''), '') is not null
      and v_existing.linked_adjustment_id <> v_source_adjustment.id::text then
      raise exception 'Attendance linked adjustment id does not match the canonical attendance-derived billing adjustment.';
    end if;

    if v_should_have_extra_day_adjustment then
      if v_source_adjustment.id is null then
        insert into public.billing_adjustments (
          member_id,
          payor_id,
          adjustment_date,
          adjustment_type,
          description,
          quantity,
          unit_rate,
          amount,
          billing_status,
          created_by_system,
          source_table,
          source_record_id,
          created_by_user_id,
          created_by_name,
          created_at,
          updated_at
        )
        values (
          p_member_id,
          null,
          p_attendance_date,
          'ExtraDay',
          'Unscheduled attendance extra day charge',
          1,
          v_extra_day_rate,
          v_extra_day_rate,
          'Unbilled',
          true,
          'attendance_records',
          coalesce(v_saved.id, v_existing.id)::text,
          p_actor_user_id,
          v_actor_name,
          v_now,
          v_now
        )
        returning * into v_source_adjustment;
        v_billing_adjustment_action := 'created';
        v_billing_adjustment_changed := true;
      else
        if (coalesce(v_source_adjustment.billing_status, '') = 'Billed' or v_source_adjustment.invoice_id is not null)
          and (
            v_source_adjustment.adjustment_date is distinct from p_attendance_date
            or v_source_adjustment.quantity is distinct from 1
            or v_source_adjustment.unit_rate is distinct from v_extra_day_rate
            or v_source_adjustment.amount is distinct from v_extra_day_rate
            or v_source_adjustment.description is distinct from 'Unscheduled attendance extra day charge'
            or coalesce(v_source_adjustment.source_table, '') <> 'attendance_records'
            or v_source_adjustment.source_record_id is distinct from coalesce(v_saved.id, v_existing.id)::text
          ) then
          raise exception 'Attendance-derived billing adjustment has already been billed and cannot be changed automatically.';
        end if;

        if coalesce(v_source_adjustment.billing_status, '') <> 'Billed'
          and (
            v_source_adjustment.adjustment_date is distinct from p_attendance_date
            or v_source_adjustment.quantity is distinct from 1
            or v_source_adjustment.unit_rate is distinct from v_extra_day_rate
            or v_source_adjustment.amount is distinct from v_extra_day_rate
            or v_source_adjustment.description is distinct from 'Unscheduled attendance extra day charge'
            or coalesce(v_source_adjustment.source_table, '') <> 'attendance_records'
            or v_source_adjustment.source_record_id is distinct from coalesce(v_saved.id, v_existing.id)::text
            or coalesce(v_source_adjustment.billing_status, '') <> 'Unbilled'
            or coalesce(v_source_adjustment.created_by_name, '') is distinct from coalesce(v_actor_name, '')
          ) then
          update public.billing_adjustments
          set
            adjustment_date = p_attendance_date,
            adjustment_type = 'ExtraDay',
            description = 'Unscheduled attendance extra day charge',
            quantity = 1,
            unit_rate = v_extra_day_rate,
            amount = v_extra_day_rate,
            billing_status = 'Unbilled',
            exclusion_reason = null,
            invoice_id = null,
            created_by_system = true,
            source_table = 'attendance_records',
            source_record_id = coalesce(v_saved.id, v_existing.id)::text,
            created_by_user_id = p_actor_user_id,
            created_by_name = v_actor_name,
            updated_at = v_now
          where id = v_source_adjustment.id
          returning * into v_source_adjustment;
          v_billing_adjustment_action := 'updated';
          v_billing_adjustment_changed := true;
        end if;
      end if;

      v_linked_adjustment_id := v_source_adjustment.id::text;
    elsif v_source_adjustment.id is not null then
      if coalesce(v_source_adjustment.billing_status, '') = 'Billed' or v_source_adjustment.invoice_id is not null then
        raise exception 'Attendance-derived billing adjustment has already been billed and cannot be removed automatically.';
      end if;

      v_target_adjustment_exclusion_reason := case
        when v_should_delete then 'Attendance record was cleared.'
        else 'Attendance no longer requires extra-day billing.'
      end;

      if coalesce(v_source_adjustment.billing_status, '') <> 'Excluded'
        or v_source_adjustment.invoice_id is not null
        or coalesce(v_source_adjustment.exclusion_reason, '') <> v_target_adjustment_exclusion_reason then
        update public.billing_adjustments
        set
          billing_status = 'Excluded',
          exclusion_reason = v_target_adjustment_exclusion_reason,
          invoice_id = null,
          updated_at = v_now
        where id = v_source_adjustment.id
        returning * into v_source_adjustment;
        v_billing_adjustment_action := 'excluded';
        v_billing_adjustment_changed := true;
      end if;

      v_linked_adjustment_id := null;
    end if;

    select id
    into v_late_pickup_category_id
    from public.ancillary_charge_categories
    where lower(trim(name)) = 'late pickup'
    limit 1;

    if v_late_pickup_category_id is null then
      raise exception 'Late Pickup ancillary charge category not found.';
    end if;

    select count(*)
    into v_existing_late_pickup_count
    from public.ancillary_charge_logs
    where category_id = v_late_pickup_category_id
      and source_entity = 'attendanceRecords'
      and source_entity_id = coalesce(v_saved.id, v_existing.id)::text;

    if v_existing_late_pickup_count > 1 then
      raise exception 'Multiple automated late pick-up ancillary charges exist for attendance record %.', coalesce(v_saved.id, v_existing.id);
    end if;

    select *
    into v_existing_late_pickup
    from public.ancillary_charge_logs
    where category_id = v_late_pickup_category_id
      and source_entity = 'attendanceRecords'
      and source_entity_id = coalesce(v_saved.id, v_existing.id)::text
    order by created_at asc, id asc
    limit 1
    for update;

    if not v_should_have_late_pickup_charge then
      if v_existing_late_pickup.id is not null then
        if coalesce(v_existing_late_pickup.billing_status, '') = 'Billed' or v_existing_late_pickup.invoice_id is not null then
          raise exception 'Late pick-up charge has already been billed and cannot be removed automatically.';
        end if;

        delete from public.ancillary_charge_logs
        where id = v_existing_late_pickup.id;
        v_late_pickup_action := 'deleted';
        v_late_pickup_changed := true;
      end if;
    elsif v_existing_late_pickup.id is null then
      insert into public.ancillary_charge_logs (
        member_id,
        category_id,
        service_date,
        late_pickup_time,
        staff_user_id,
        notes,
        source_entity,
        source_entity_id,
        quantity,
        unit_rate,
        amount,
        billing_status,
        created_at,
        updated_at
      )
      values (
        p_member_id,
        v_late_pickup_category_id,
        p_attendance_date,
        v_target_late_pickup_time::time,
        p_actor_user_id,
        'Auto-generated from attendance checkout.',
        'attendanceRecords',
        coalesce(v_saved.id, v_existing.id)::text,
        1,
        v_late_pickup_amount,
        v_late_pickup_amount,
        'Unbilled',
        v_now,
        v_now
      );
      v_late_pickup_action := 'created';
      v_late_pickup_changed := true;
    else
      if (coalesce(v_existing_late_pickup.billing_status, '') = 'Billed' or v_existing_late_pickup.invoice_id is not null)
        and (
          v_existing_late_pickup.late_pickup_time is distinct from v_target_late_pickup_time::time
          or v_existing_late_pickup.unit_rate is distinct from v_late_pickup_amount
          or v_existing_late_pickup.amount is distinct from v_late_pickup_amount
        ) then
        raise exception 'Late pick-up charge has already been billed and cannot be changed automatically.';
      end if;

      if coalesce(v_existing_late_pickup.billing_status, '') <> 'Billed'
        and (
          v_existing_late_pickup.service_date is distinct from p_attendance_date
          or v_existing_late_pickup.late_pickup_time is distinct from v_target_late_pickup_time::time
          or v_existing_late_pickup.unit_rate is distinct from v_late_pickup_amount
          or v_existing_late_pickup.amount is distinct from v_late_pickup_amount
          or coalesce(v_existing_late_pickup.billing_status, '') <> 'Unbilled'
          or v_existing_late_pickup.invoice_id is not null
          or coalesce(v_existing_late_pickup.source_entity, '') <> 'attendanceRecords'
          or v_existing_late_pickup.source_entity_id is distinct from coalesce(v_saved.id, v_existing.id)::text
        ) then
        update public.ancillary_charge_logs
        set
          member_id = p_member_id,
          category_id = v_late_pickup_category_id,
          service_date = p_attendance_date,
          late_pickup_time = v_target_late_pickup_time::time,
          staff_user_id = p_actor_user_id,
          notes = 'Auto-generated from attendance checkout.',
          source_entity = 'attendanceRecords',
          source_entity_id = coalesce(v_saved.id, v_existing.id)::text,
          quantity = 1,
          unit_rate = v_late_pickup_amount,
          amount = v_late_pickup_amount,
          billing_status = 'Unbilled',
          invoice_id = null,
          updated_at = v_now
        where id = v_existing_late_pickup.id
        returning * into v_existing_late_pickup;
        v_late_pickup_action := 'updated';
        v_late_pickup_changed := true;
      end if;
    end if;
  end if;

  if v_makeup_delta_days <> 0 and v_makeup_schedule_id is not null then
    select public.apply_makeup_balance_delta_with_audit(
      v_makeup_schedule_id,
      p_member_id,
      p_attendance_date,
      v_makeup_delta_days,
      v_makeup_source,
      p_actor_user_id,
      p_actor_role,
      v_actor_name,
      v_now,
      coalesce(p_use_makeup_day, false) and v_makeup_delta_days < 0
    )
    into v_makeup_result;
  end if;

  if not v_should_delete and v_saved.id is not null then
    v_target_record_billing_status := case
      when coalesce(v_saved.billing_status, '') = 'Billed' then 'Billed'
      when p_status = 'present' then 'Unbilled'
      else 'Excluded'
    end;

    if v_saved.scheduled_day is distinct from coalesce(p_is_scheduled_day, false)
      or v_saved.unscheduled_day is distinct from (not coalesce(p_is_scheduled_day, false))
      or v_saved.billable_extra_day is distinct from v_should_have_extra_day_adjustment
      or v_saved.billing_status is distinct from v_target_record_billing_status
      or v_saved.linked_adjustment_id is distinct from v_linked_adjustment_id then
      update public.attendance_records
      set
        scheduled_day = coalesce(p_is_scheduled_day, false),
        unscheduled_day = not coalesce(p_is_scheduled_day, false),
        billable_extra_day = v_should_have_extra_day_adjustment,
        billing_status = v_target_record_billing_status,
        linked_adjustment_id = v_linked_adjustment_id,
        updated_at = v_now
      where id = v_saved.id
      returning * into v_saved;
      v_record_changed := true;
    end if;
  end if;

  if v_should_delete and v_existing.id is not null then
    delete from public.attendance_records
    where id = v_existing.id;
    v_record_changed := true;
  end if;

  v_any_changed :=
    v_record_changed
    or v_billing_adjustment_changed
    or v_late_pickup_changed
    or coalesce((v_makeup_result ->> 'applied')::boolean, false);

  if v_any_changed then
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
      'attendance_mutation',
      'attendance_record',
      coalesce(v_saved.id, v_existing.id)::text,
      jsonb_build_object(
        'memberId', p_member_id,
        'attendanceDate', p_attendance_date,
        'operation', v_operation,
        'deleteRecord', v_should_delete,
        'previousStatus', v_existing.status,
        'nextStatus', case when v_should_delete then null else p_status end,
        'scheduledDay', coalesce(p_is_scheduled_day, false),
        'useMakeupDay', coalesce(p_use_makeup_day, false),
        'makeupDeltaDays', v_makeup_delta_days,
        'makeupSource', v_makeup_source,
        'billingAdjustmentAction', v_billing_adjustment_action,
        'latePickupAction', v_late_pickup_action
      )
    );

    insert into public.system_events (
      event_type,
      entity_type,
      entity_id,
      actor_type,
      actor_id,
      actor_user_id,
      status,
      severity,
      metadata
    )
    values (
      case when v_should_delete then 'attendance_cleared' else 'attendance_saved' end,
      'attendance_record',
      coalesce(v_saved.id, v_existing.id)::text,
      'user',
      p_actor_user_id::text,
      p_actor_user_id,
      'completed',
      'low',
      jsonb_build_object(
        'memberId', p_member_id,
        'attendanceDate', p_attendance_date,
        'operation', v_operation,
        'deleteRecord', v_should_delete,
        'previousStatus', v_existing.status,
        'nextStatus', case when v_should_delete then null else p_status end,
        'scheduledDay', coalesce(p_is_scheduled_day, false),
        'useMakeupDay', coalesce(p_use_makeup_day, false),
        'makeupDeltaDays', v_makeup_delta_days,
        'makeupSource', v_makeup_source,
        'billingAdjustmentAction', v_billing_adjustment_action,
        'latePickupAction', v_late_pickup_action
      )
    );
  end if;

  if v_should_delete then
    return query
    select
      null::uuid,
      p_member_id,
      p_attendance_date,
      null::text,
      null::text,
      null::text,
      null::timestamptz,
      null::timestamptz,
      null::text,
      null::text,
      null::text;
    return;
  end if;

  return query
  select
    v_saved.id,
    v_saved.member_id,
    v_saved.attendance_date,
    v_saved.status,
    v_saved.absent_reason,
    v_saved.absent_reason_other,
    v_saved.check_in_at,
    v_saved.check_out_at,
    v_saved.linked_adjustment_id,
    v_saved.billing_status,
    v_saved.notes;
end;
$$;

revoke execute on function public.rpc_save_attendance_workflow_internal(
  uuid,
  date,
  text,
  boolean,
  text,
  text,
  text,
  timestamptz,
  timestamptz,
  text,
  boolean,
  text,
  boolean,
  boolean,
  numeric,
  text,
  integer,
  uuid,
  public.app_role,
  text,
  timestamptz
) from public;

grant execute on function public.rpc_save_attendance_workflow_internal(
  uuid,
  date,
  text,
  boolean,
  text,
  text,
  text,
  timestamptz,
  timestamptz,
  text,
  boolean,
  text,
  boolean,
  boolean,
  numeric,
  text,
  integer,
  uuid,
  public.app_role,
  text,
  timestamptz
) to service_role;

create or replace function public.rpc_save_attendance_workflow(
  p_member_id uuid,
  p_attendance_date date,
  p_operation text,
  p_delete_record boolean default false,
  p_status text default null,
  p_absent_reason text default null,
  p_absent_reason_other text default null,
  p_check_in_at timestamptz default null,
  p_check_out_at timestamptz default null,
  p_notes text default null,
  p_is_scheduled_day boolean default false,
  p_makeup_schedule_id text default null,
  p_use_makeup_day boolean default false,
  p_should_have_extra_day_adjustment boolean default false,
  p_extra_day_rate numeric default 0,
  p_late_pickup_time text default null,
  p_late_pickup_fee_cents integer default 0,
  p_actor_user_id uuid default null,
  p_actor_role public.app_role default null,
  p_actor_name text default null,
  p_now timestamptz default now()
)
returns table (
  attendance_record_id uuid,
  member_id uuid,
  attendance_date date,
  status text,
  absent_reason text,
  absent_reason_other text,
  check_in_at timestamptz,
  check_out_at timestamptz,
  linked_adjustment_id text,
  billing_status text,
  notes text
)
language plpgsql
security invoker
set search_path = public
as $$
begin
  if auth.role() <> 'service_role'
    and (
      (select public.current_role()) not in ('admin', 'manager')
      or not (select public.current_profile_has_permission('operations', 'can_edit'))
    ) then
    raise exception 'rpc_save_attendance_workflow requires operations attendance edit access.';
  end if;

  return query
  select *
  from public.rpc_save_attendance_workflow_internal(
    p_member_id,
    p_attendance_date,
    p_operation,
    p_delete_record,
    p_status,
    p_absent_reason,
    p_absent_reason_other,
    p_check_in_at,
    p_check_out_at,
    p_notes,
    p_is_scheduled_day,
    p_makeup_schedule_id,
    p_use_makeup_day,
    p_should_have_extra_day_adjustment,
    p_extra_day_rate,
    p_late_pickup_time,
    p_late_pickup_fee_cents,
    p_actor_user_id,
    p_actor_role,
    p_actor_name,
    p_now
  );
end;
$$;

grant execute on function public.rpc_save_attendance_workflow(
  uuid,
  date,
  text,
  boolean,
  text,
  text,
  text,
  timestamptz,
  timestamptz,
  text,
  boolean,
  text,
  boolean,
  boolean,
  numeric,
  text,
  integer,
  uuid,
  public.app_role,
  text,
  timestamptz
) to authenticated, service_role;
