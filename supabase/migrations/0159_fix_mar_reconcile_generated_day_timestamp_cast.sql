-- Fix MAR schedule generation to treat generated series values as dates before
-- appending scheduled HH:MM strings. Without this cast, Postgres can stringify
-- the series value as a timestamp (for example 2026-03-27 00:00:00+00), which
-- produces invalid inputs like 2026-03-27 00:00:00+00T14:00 during schedule reconciliation.
create or replace function public.rpc_reconcile_member_mar_state(
  p_member_id uuid,
  p_start_date date,
  p_end_date date,
  p_preferred_physician_order_id uuid default null,
  p_now timestamptz default now()
)
returns table (
  anchor_physician_order_id uuid,
  synced_medications integer,
  inserted_schedules integer,
  patched_schedules integer,
  reactivated_schedules integer,
  deactivated_schedules integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_start_date date := least(p_start_date, p_end_date);
  v_end_date date := greatest(p_start_date, p_end_date);
  v_start_ts timestamptz;
  v_end_ts timestamptz;
begin
  if p_member_id is null or p_start_date is null or p_end_date is null then
    raise exception 'rpc_reconcile_member_mar_state requires member, start date, and end date';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_member_id::text)::bigint);

  select
    sync.anchor_physician_order_id,
    sync.synced_medications
  into
    anchor_physician_order_id,
    synced_medications
  from public.rpc_sync_mar_medications_from_member_profile(
    p_member_id,
    p_preferred_physician_order_id,
    v_now
  ) as sync;

  v_start_ts := (v_start_date::text || ' 00:00:00 America/New_York')::timestamptz;
  v_end_ts := (v_end_date::text || ' 23:59:00 America/New_York')::timestamptz;

  create temporary table if not exists tmp_expected_mar_rows (
    pof_medication_id uuid not null,
    medication_name text not null,
    dose text,
    route text,
    scheduled_time timestamptz not null,
    frequency text,
    instructions text,
    prn boolean not null,
    start_date date,
    end_date date
  ) on commit drop;
  truncate table tmp_expected_mar_rows;

  insert into tmp_expected_mar_rows (
    pof_medication_id,
    medication_name,
    dose,
    route,
    scheduled_time,
    frequency,
    instructions,
    prn,
    start_date,
    end_date
  )
  select
    pm.id,
    pm.medication_name,
    pm.dose,
    pm.route,
    (((generated_day::date)::text || 'T' || scheduled_time.value)::timestamp at time zone 'America/New_York'),
    pm.frequency,
    pm.instructions,
    pm.prn,
    pm.start_date,
    pm.end_date
  from public.pof_medications pm
  cross join lateral unnest(pm.scheduled_times) as scheduled_time(value)
  cross join lateral generate_series(
    greatest(coalesce(pm.start_date, v_start_date), v_start_date),
    least(coalesce(pm.end_date, v_end_date), v_end_date),
    interval '1 day'
  ) as generated_day
  where pm.member_id = p_member_id
    and pm.active = true
    and pm.given_at_center = true
    and pm.prn = false
    and pm.source_medication_id like 'mhp-%'
    and array_length(pm.scheduled_times, 1) is not null;

  create temporary table if not exists tmp_documented_mar_schedule_ids (
    id uuid primary key
  ) on commit drop;
  truncate table tmp_documented_mar_schedule_ids;

  insert into tmp_documented_mar_schedule_ids (id)
  select distinct ms.id
  from public.mar_schedules ms
  join public.mar_administrations ma
    on ma.mar_schedule_id = ms.id
  where ms.member_id = p_member_id
    and ms.scheduled_time >= v_start_ts
    and ms.scheduled_time <= v_end_ts;

  with inserted as (
    insert into public.mar_schedules (
      member_id,
      pof_medication_id,
      medication_name,
      dose,
      route,
      scheduled_time,
      frequency,
      instructions,
      prn,
      active,
      start_date,
      end_date,
      created_at,
      updated_at
    )
    select
      p_member_id,
      expected.pof_medication_id,
      expected.medication_name,
      expected.dose,
      expected.route,
      expected.scheduled_time,
      expected.frequency,
      expected.instructions,
      expected.prn,
      true,
      expected.start_date,
      expected.end_date,
      v_now,
      v_now
    from tmp_expected_mar_rows expected
    left join public.mar_schedules existing
      on existing.member_id = p_member_id
     and existing.pof_medication_id = expected.pof_medication_id
     and existing.scheduled_time = expected.scheduled_time
    where existing.id is null
    on conflict (member_id, pof_medication_id, scheduled_time) do nothing
    returning 1
  )
  select count(*) into inserted_schedules from inserted;

  with patched as (
    update public.mar_schedules ms
    set
      medication_name = expected.medication_name,
      dose = expected.dose,
      route = expected.route,
      frequency = expected.frequency,
      instructions = expected.instructions,
      prn = expected.prn,
      start_date = expected.start_date,
      end_date = expected.end_date,
      updated_at = v_now
    from tmp_expected_mar_rows expected
    where ms.member_id = p_member_id
      and ms.pof_medication_id = expected.pof_medication_id
      and ms.scheduled_time = expected.scheduled_time
      and not exists (
        select 1 from tmp_documented_mar_schedule_ids documented where documented.id = ms.id
      )
      and (
        coalesce(ms.medication_name, '') <> coalesce(expected.medication_name, '')
        or coalesce(ms.dose, '') <> coalesce(expected.dose, '')
        or coalesce(ms.route, '') <> coalesce(expected.route, '')
        or coalesce(ms.frequency, '') <> coalesce(expected.frequency, '')
        or coalesce(ms.instructions, '') <> coalesce(expected.instructions, '')
        or coalesce(ms.prn, false) <> coalesce(expected.prn, false)
        or coalesce(ms.start_date, date '1900-01-01') <> coalesce(expected.start_date, date '1900-01-01')
        or coalesce(ms.end_date, date '1900-01-01') <> coalesce(expected.end_date, date '1900-01-01')
      )
    returning ms.id
  )
  select count(*) into patched_schedules from patched;

  with reactivated as (
    update public.mar_schedules ms
    set
      active = true,
      updated_at = v_now
    from tmp_expected_mar_rows expected
    where ms.member_id = p_member_id
      and ms.pof_medication_id = expected.pof_medication_id
      and ms.scheduled_time = expected.scheduled_time
      and ms.active = false
      and not exists (
        select 1 from tmp_documented_mar_schedule_ids documented where documented.id = ms.id
      )
    returning ms.id
  )
  select count(*) into reactivated_schedules from reactivated;

  with deactivated as (
    update public.mar_schedules ms
    set
      active = false,
      updated_at = v_now
    where ms.member_id = p_member_id
      and ms.active = true
      and ms.scheduled_time >= v_start_ts
      and ms.scheduled_time <= v_end_ts
      and not exists (
        select 1 from tmp_documented_mar_schedule_ids documented where documented.id = ms.id
      )
      and not exists (
        select 1
        from tmp_expected_mar_rows expected
        where expected.pof_medication_id = ms.pof_medication_id
          and expected.scheduled_time = ms.scheduled_time
      )
    returning ms.id
  )
  select count(*) into deactivated_schedules from deactivated;

  return next;
end;
$$;

grant execute on function public.rpc_reconcile_member_mar_state(
  uuid,
  date,
  date,
  uuid,
  timestamptz
) to authenticated, service_role;
