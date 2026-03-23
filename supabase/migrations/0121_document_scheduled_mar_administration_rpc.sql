create or replace function public.rpc_document_scheduled_mar_administration(
  p_mar_schedule_id uuid,
  p_member_id uuid,
  p_pof_medication_id uuid,
  p_medication_name text,
  p_dose text default null,
  p_route text default null,
  p_scheduled_time timestamptz default null,
  p_administration_date date default null,
  p_status text default 'Given',
  p_not_given_reason text default null,
  p_notes text default null,
  p_administered_by uuid default null,
  p_administered_by_name text default null,
  p_now timestamptz default now()
)
returns table (
  administration_id uuid,
  member_id uuid,
  administered_at timestamptz,
  duplicate_safe boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_status text := coalesce(nullif(trim(p_status), ''), 'Given');
  v_administered_at timestamptz := v_now;
  v_administration_date date := coalesce(p_administration_date, (v_now at time zone 'America/New_York')::date);
  v_scheduled_time timestamptz := p_scheduled_time;
  v_not_given_reason text := nullif(trim(coalesce(p_not_given_reason, '')), '');
  v_row record;
  v_notes text := nullif(trim(coalesce(p_notes, '')), '');
begin
  if p_mar_schedule_id is null then
    raise exception 'MAR schedule is required.';
  end if;
  if p_member_id is null then
    raise exception 'Member is required for scheduled MAR documentation.';
  end if;
  if p_pof_medication_id is null then
    raise exception 'Scheduled MAR documentation requires a linked medication.';
  end if;
  if nullif(trim(coalesce(p_medication_name, '')), '') is null then
    raise exception 'Medication name is required for scheduled MAR documentation.';
  end if;

  if v_status not in ('Given', 'Not Given') then
    raise exception 'Scheduled MAR status must be Given or Not Given.';
  end if;
  if v_status = 'Not Given' and v_not_given_reason is null then
    raise exception 'Not Given reason is required.';
  end if;
  if v_status = 'Given' then
    v_not_given_reason := null;
  end if;

  perform pg_advisory_xact_lock(hashtext(p_mar_schedule_id::text)::bigint);

  with inserted as (
    insert into public.mar_administrations as ma (
      member_id,
      pof_medication_id,
      mar_schedule_id,
      administration_date,
      scheduled_time,
      medication_name,
      dose,
      route,
      status,
      not_given_reason,
      prn_reason,
      notes,
      administered_by,
      administered_by_user_id,
      administered_at,
      source,
      prn_outcome,
      prn_outcome_assessed_at,
      prn_followup_note
    )
    values (
      p_member_id,
      p_pof_medication_id,
      p_mar_schedule_id,
      v_administration_date,
      v_scheduled_time,
      trim(p_medication_name),
      nullif(trim(coalesce(p_dose, '')), ''),
      nullif(trim(p_route), ''),
      v_status,
      v_not_given_reason,
      null,
      v_notes,
      p_administered_by_name,
      p_administered_by,
      v_administered_at,
      'scheduled',
      null,
      null,
      null
    )
    on conflict (mar_schedule_id) do nothing
    returning ma.id, ma.member_id, ma.administered_at
  )
  select inserted.id, inserted.member_id, inserted.administered_at
  into v_row
  from inserted;

  if v_row is not null then
    administration_id := v_row.id;
    member_id := v_row.member_id;
    administered_at := v_row.administered_at;
    duplicate_safe := false;
    return next;
    return;
  end if;

  select ma.id, ma.member_id, ma.administered_at
  into v_row
  from public.mar_administrations ma
  where ma.mar_schedule_id = p_mar_schedule_id
    and ma.source = 'scheduled'
  order by ma.administered_at desc, ma.created_at desc
  limit 1;

  if v_row is null then
    raise exception 'Unable to save or retrieve scheduled MAR administration.';
  end if;

  administration_id := v_row.id;
  member_id := v_row.member_id;
  administered_at := v_row.administered_at;
  duplicate_safe := true;
  return next;
end;
$$;

grant execute on function public.rpc_document_scheduled_mar_administration(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  timestamptz,
  date,
  text,
  text,
  text,
  uuid,
  text,
  timestamptz
) to authenticated, service_role;
