create or replace function public.rpc_record_prn_medication_administration(
  p_medication_order_id uuid,
  p_admin_datetime timestamptz,
  p_dose_given text default null,
  p_route_given text default null,
  p_indication text default null,
  p_symptom_score_before integer default null,
  p_followup_due_at timestamptz default null,
  p_status text default 'Given',
  p_notes text default null,
  p_administered_by uuid default null,
  p_administered_by_name text default null,
  p_idempotency_key text default null,
  p_now timestamptz default now()
)
returns table (
  log_id uuid,
  member_id uuid,
  medication_order_id uuid,
  followup_due_at timestamptz,
  followup_status text,
  duplicate_safe boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_admin_datetime timestamptz := coalesce(p_admin_datetime, v_now);
  v_status text := coalesce(nullif(trim(p_status), ''), 'Given');
  v_order public.medication_orders%rowtype;
  v_existing_id uuid;
  v_last_given timestamptz;
  v_given_count integer := 0;
  v_current_dose numeric;
  v_previous_total numeric := 0;
  v_followup_due_at timestamptz;
begin
  if p_medication_order_id is null then
    raise exception 'PRN administration requires medication_order_id';
  end if;

  if v_status not in ('Given', 'Refused', 'Held', 'Omitted') then
    raise exception 'PRN administration status must be Given, Refused, Held, or Omitted';
  end if;

  if p_symptom_score_before is not null and (p_symptom_score_before < 0 or p_symptom_score_before > 10) then
    raise exception 'Symptom score must be between 0 and 10.';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_medication_order_id::text)::bigint);

  if nullif(trim(coalesce(p_idempotency_key, '')), '') is not null then
    select logs.id
    into v_existing_id
    from public.med_administration_logs logs
    where logs.idempotency_key = p_idempotency_key
    limit 1;

    if v_existing_id is not null then
      select
        logs.id,
        logs.member_id,
        logs.medication_order_id,
        logs.followup_due_at,
        logs.followup_status,
        true
      into
        log_id,
        member_id,
        medication_order_id,
        followup_due_at,
        followup_status,
        duplicate_safe
      from public.med_administration_logs logs
      where logs.id = v_existing_id;
      return next;
      return;
    end if;
  end if;

  select *
  into v_order
  from public.medication_orders
  where id = p_medication_order_id;

  if v_order.id is null then
    raise exception 'Selected PRN medication order was not found.';
  end if;

  if v_order.order_type <> 'prn' then
    raise exception 'Selected medication order is not a PRN order.';
  end if;

  if v_order.status <> 'active' then
    raise exception 'The selected PRN medication order is no longer active.';
  end if;

  if v_order.start_date is not null and v_admin_datetime::date < v_order.start_date then
    raise exception 'The selected PRN medication order is not active yet.';
  end if;

  if v_order.end_date is not null and v_admin_datetime::date > v_order.end_date then
    raise exception 'The selected PRN medication order has expired.';
  end if;

  if nullif(trim(coalesce(p_indication, '')), '') is null then
    raise exception 'Indication is required for PRN administration.';
  end if;

  if v_status = 'Given' then
    if v_order.min_interval_minutes is not null then
      select max(logs.admin_datetime)
      into v_last_given
      from public.med_administration_logs logs
      where logs.medication_order_id = v_order.id
        and logs.status = 'Given';

      if v_last_given is not null and v_admin_datetime < v_last_given + make_interval(mins => v_order.min_interval_minutes) then
        raise exception 'Minimum PRN interval has not been met for this medication order.';
      end if;
    end if;

    if v_order.max_doses_per_24h is not null then
      select count(*)
      into v_given_count
      from public.med_administration_logs logs
      where logs.medication_order_id = v_order.id
        and logs.status = 'Given'
        and logs.admin_datetime > v_admin_datetime - interval '24 hours'
        and logs.admin_datetime <= v_admin_datetime;

      if v_given_count >= v_order.max_doses_per_24h then
        raise exception 'Maximum PRN doses in 24 hours would be exceeded for this medication order.';
      end if;
    end if;

    if v_order.max_daily_dose is not null then
      v_current_dose := nullif(regexp_replace(coalesce(p_dose_given, ''), '[^0-9\.]+', '', 'g'), '')::numeric;

      if v_current_dose is not null then
        select coalesce(sum(nullif(regexp_replace(coalesce(logs.dose_given, ''), '[^0-9\.]+', '', 'g'), '')::numeric), 0)
        into v_previous_total
        from public.med_administration_logs logs
        where logs.medication_order_id = v_order.id
          and logs.status = 'Given'
          and logs.admin_datetime > v_admin_datetime - interval '24 hours'
          and logs.admin_datetime <= v_admin_datetime;

        if v_previous_total + v_current_dose > v_order.max_daily_dose then
          raise exception 'Maximum PRN daily dose would be exceeded for this medication order.';
        end if;
      end if;
    end if;
  end if;

  if v_status = 'Given' and v_order.requires_effectiveness_followup then
    v_followup_due_at := coalesce(p_followup_due_at, v_admin_datetime + interval '1 hour');
    followup_status := case when v_followup_due_at < v_now then 'overdue' else 'due' end;
  else
    v_followup_due_at := null;
    followup_status := 'not_required';
  end if;

  insert into public.med_administration_logs as logs (
    member_id,
    medication_order_id,
    admin_type,
    admin_datetime,
    dose_given,
    route_given,
    indication,
    symptom_score_before,
    followup_due_at,
    followup_status,
    effectiveness_result,
    followup_notes,
    administered_by,
    administered_by_name,
    status,
    notes,
    idempotency_key,
    created_at,
    updated_at
  )
  values (
    v_order.member_id,
    v_order.id,
    'prn',
    v_admin_datetime,
    nullif(trim(coalesce(p_dose_given, '')), ''),
    nullif(trim(coalesce(p_route_given, '')), ''),
    nullif(trim(coalesce(p_indication, '')), ''),
    p_symptom_score_before,
    v_followup_due_at,
    followup_status,
    null,
    null,
    p_administered_by,
    nullif(trim(coalesce(p_administered_by_name, '')), ''),
    v_status,
    nullif(trim(coalesce(p_notes, '')), ''),
    nullif(trim(coalesce(p_idempotency_key, '')), ''),
    v_now,
    v_now
  )
  returning
    logs.id,
    logs.member_id,
    logs.medication_order_id
  into
    log_id,
    member_id,
    medication_order_id;

  duplicate_safe := false;
  followup_due_at := v_followup_due_at;
  return next;
end;
$$;

grant execute on function public.rpc_record_prn_medication_administration(
  uuid,
  timestamptz,
  text,
  text,
  text,
  integer,
  timestamptz,
  text,
  text,
  uuid,
  text,
  text,
  timestamptz
) to authenticated, service_role;
