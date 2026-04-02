create or replace function public.rpc_create_draft_physician_order_from_intake(
  p_assessment_id uuid,
  p_member_id uuid,
  p_payload jsonb,
  p_attempted_at timestamptz default now()
)
returns table (
  physician_order_id uuid,
  draft_pof_status text,
  was_existing boolean
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_assessment public.intake_assessments%rowtype;
  v_existing public.physician_orders%rowtype;
  v_member public.members%rowtype;
  v_order public.physician_orders%rowtype;
  v_attempted_at timestamptz := coalesce(p_attempted_at, now());
  v_version_number integer;
begin
  if p_assessment_id is null then
    raise exception 'assessment id is required';
  end if;
  if p_member_id is null then
    raise exception 'member id is required';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'p_payload must be a JSON object';
  end if;

  select *
  into v_assessment
  from public.intake_assessments
  where id = p_assessment_id
  for update;

  if not found then
    raise exception 'Intake assessment % was not found.', p_assessment_id;
  end if;

  if v_assessment.member_id is distinct from p_member_id then
    raise exception 'Intake assessment % does not belong to member %.', p_assessment_id, p_member_id;
  end if;

  if coalesce(lower(v_assessment.signature_status), '') <> 'signed' then
    raise exception 'Intake assessment % must be signed before draft POF creation.', p_assessment_id;
  end if;

  select *
  into v_member
  from public.members
  where id = p_member_id
  for update;

  if not found then
    raise exception 'Member % was not found.', p_member_id;
  end if;

  perform pg_advisory_xact_lock(hashtext(format('physician-order-member:%s', p_member_id))::bigint);

  select *
  into v_existing
  from public.physician_orders
  where intake_assessment_id = p_assessment_id
    and status in ('draft', 'sent')
  order by created_at desc
  limit 1
  for update;

  if found then
    update public.intake_assessments
    set
      draft_pof_status = 'created',
      draft_pof_attempted_at = v_attempted_at,
      draft_pof_error = null,
      updated_at = v_attempted_at
    where id = p_assessment_id;

    return query
    select
      v_existing.id,
      'created',
      true;
    return;
  end if;

  select coalesce(max(po.version_number), 0) + 1
  into v_version_number
  from public.physician_orders po
  where po.member_id = p_member_id;

  v_order := jsonb_populate_record(null::public.physician_orders, p_payload);
  v_order.id := coalesce(v_order.id, gen_random_uuid());
  v_order.member_id := p_member_id;
  v_order.intake_assessment_id := p_assessment_id;
  v_order.version_number := v_version_number;
  v_order.status := coalesce(nullif(trim(coalesce(v_order.status, '')), ''), 'draft');
  v_order.is_active_signed := false;
  v_order.superseded_by := null;
  v_order.superseded_at := null;
  v_order.sent_at := null;
  v_order.signed_at := null;
  v_order.effective_at := null;
  v_order.next_renewal_due_date := null;
  v_order.created_at := coalesce(v_order.created_at, v_attempted_at);
  v_order.updated_at := coalesce(v_order.updated_at, v_attempted_at);

  begin
    insert into public.physician_orders
    select (v_order).*;
  exception
    when unique_violation then
      select *
      into v_existing
      from public.physician_orders
      where intake_assessment_id = p_assessment_id
        and status in ('draft', 'sent')
      order by created_at desc
      limit 1
      for update;

      if found then
        update public.intake_assessments
        set
          draft_pof_status = 'created',
          draft_pof_attempted_at = v_attempted_at,
          draft_pof_error = null,
          updated_at = v_attempted_at
        where id = p_assessment_id;

        return query
        select
          v_existing.id,
          'created',
          true;
        return;
      end if;

      raise;
  end;

  update public.intake_assessments
  set
    draft_pof_status = 'created',
    draft_pof_attempted_at = v_attempted_at,
    draft_pof_error = null,
    updated_at = v_attempted_at
  where id = p_assessment_id;

  return query
  select
    v_order.id,
    'created',
    false;
end;
$$;

create or replace function public.rpc_upsert_physician_order(
  p_pof_id uuid default null,
  p_member_id uuid default null,
  p_payload jsonb default '{}'::jsonb,
  p_target_status text default 'draft',
  p_actor_user_id uuid default null,
  p_actor_name text default null,
  p_signed_at timestamptz default null,
  p_pof_request_id uuid default null
)
returns table (
  physician_order_id uuid,
  member_id uuid,
  version_number integer,
  status text,
  queue_id uuid,
  queue_attempt_count integer,
  queue_next_retry_at timestamptz,
  created_new boolean
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_member public.members%rowtype;
  v_existing public.physician_orders%rowtype;
  v_order public.physician_orders%rowtype;
  v_target_status text := lower(trim(coalesce(p_target_status, 'draft')));
  v_actor_name text := nullif(trim(coalesce(p_actor_name, '')), '');
  v_attempted_at timestamptz := coalesce(p_signed_at, now());
  v_signed_at timestamptz := coalesce(p_signed_at, v_attempted_at);
  v_version_number integer;
  v_sign_result record;
  v_created_new boolean := false;
begin
  if p_member_id is null then
    raise exception 'member id is required';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'p_payload must be a JSON object';
  end if;
  if v_target_status not in ('draft', 'sent', 'signed') then
    raise exception 'target status must be draft, sent, or signed';
  end if;

  select *
  into v_member
  from public.members
  where id = p_member_id
  for update;

  if not found then
    raise exception 'Member % was not found.', p_member_id;
  end if;

  perform pg_advisory_xact_lock(hashtext(format('physician-order-member:%s', p_member_id))::bigint);

  if p_pof_id is not null then
    select *
    into v_existing
    from public.physician_orders
    where id = p_pof_id
    for update;

    if not found then
      raise exception 'Physician order % was not found.', p_pof_id;
    end if;

    if v_existing.member_id is distinct from p_member_id then
      raise exception 'Physician order % does not belong to member %.', p_pof_id, p_member_id;
    end if;

    if coalesce(lower(v_existing.status), '') = 'signed' then
      raise exception 'Signed physician orders are locked. Create a new order to make updates.';
    end if;

    v_order := jsonb_populate_record(v_existing, p_payload);
    v_order.id := v_existing.id;
    v_order.member_id := p_member_id;
    v_order.version_number := v_existing.version_number;
    v_order.created_at := v_existing.created_at;
    v_order.created_by_user_id := v_existing.created_by_user_id;
    v_order.created_by_name := v_existing.created_by_name;
  else
    select coalesce(max(po.version_number), 0) + 1
    into v_version_number
    from public.physician_orders as po
    where po.member_id = p_member_id;

    v_order := jsonb_populate_record(null::public.physician_orders, p_payload);
    v_order.id := coalesce(v_order.id, gen_random_uuid());
    v_order.member_id := p_member_id;
    v_order.version_number := v_version_number;
    v_order.created_at := coalesce(v_order.created_at, v_attempted_at);
    v_order.created_by_user_id := coalesce(v_order.created_by_user_id, p_actor_user_id);
    v_order.created_by_name := coalesce(nullif(trim(coalesce(v_order.created_by_name, '')), ''), v_actor_name);
    v_created_new := true;
  end if;

  v_order.status := case
    when v_target_status = 'signed' then 'sent'
    else v_target_status
  end;
  v_order.is_active_signed := false;
  v_order.superseded_by := null;
  v_order.superseded_at := null;
  v_order.signed_at := null;
  v_order.effective_at := null;
  v_order.signed_by_name := null;
  v_order.signature_metadata := coalesce(v_order.signature_metadata, '{}'::jsonb);
  v_order.dnr_selected := coalesce(v_order.dnr_selected, false);
  v_order.diagnoses := coalesce(v_order.diagnoses, '[]'::jsonb);
  v_order.allergies := coalesce(v_order.allergies, '[]'::jsonb);
  v_order.medications := coalesce(v_order.medications, '[]'::jsonb);
  v_order.standing_orders := coalesce(v_order.standing_orders, '[]'::jsonb);
  v_order.diet_order := coalesce(v_order.diet_order, '{}'::jsonb);
  v_order.mobility_order := coalesce(v_order.mobility_order, '{}'::jsonb);
  v_order.adl_support := coalesce(v_order.adl_support, '{}'::jsonb);
  v_order.continence_support := coalesce(v_order.continence_support, '{}'::jsonb);
  v_order.behavior_orientation := coalesce(v_order.behavior_orientation, '{}'::jsonb);
  v_order.clinical_support := coalesce(v_order.clinical_support, '{}'::jsonb);
  v_order.nutrition_orders := coalesce(v_order.nutrition_orders, '{}'::jsonb);
  v_order.operational_flags := coalesce(v_order.operational_flags, '{}'::jsonb);
  v_order.sent_at := case
    when v_order.status = 'sent' then coalesce(v_order.sent_at, v_attempted_at)
    else null
  end;
  v_order.next_renewal_due_date := case
    when v_order.status = 'sent' then v_order.next_renewal_due_date
    else null
  end;
  v_order.updated_by_user_id := coalesce(p_actor_user_id, v_order.updated_by_user_id);
  v_order.updated_by_name := coalesce(v_actor_name, nullif(trim(coalesce(v_order.updated_by_name, '')), ''));
  v_order.updated_at := v_attempted_at;

  if v_created_new then
    insert into public.physician_orders (
      id,
      member_id,
      intake_assessment_id,
      version_number,
      status,
      is_active_signed,
      superseded_by,
      superseded_at,
      sent_at,
      signed_at,
      effective_at,
      next_renewal_due_date,
      member_name_snapshot,
      member_dob_snapshot,
      sex,
      level_of_care,
      dnr_selected,
      vitals_blood_pressure,
      vitals_pulse,
      vitals_oxygen_saturation,
      vitals_respiration,
      diagnoses,
      allergies,
      medications,
      standing_orders,
      diet_order,
      mobility_order,
      adl_support,
      continence_support,
      behavior_orientation,
      clinical_support,
      nutrition_orders,
      operational_flags,
      provider_name,
      provider_signature,
      provider_signature_date,
      signed_by_name,
      signature_metadata,
      created_by_user_id,
      created_by_name,
      updated_by_user_id,
      updated_by_name,
      created_at,
      updated_at
    )
    values (
      v_order.id,
      v_order.member_id,
      v_order.intake_assessment_id,
      v_order.version_number,
      v_order.status,
      v_order.is_active_signed,
      v_order.superseded_by,
      v_order.superseded_at,
      v_order.sent_at,
      v_order.signed_at,
      v_order.effective_at,
      v_order.next_renewal_due_date,
      v_order.member_name_snapshot,
      v_order.member_dob_snapshot,
      v_order.sex,
      v_order.level_of_care,
      v_order.dnr_selected,
      v_order.vitals_blood_pressure,
      v_order.vitals_pulse,
      v_order.vitals_oxygen_saturation,
      v_order.vitals_respiration,
      v_order.diagnoses,
      v_order.allergies,
      v_order.medications,
      v_order.standing_orders,
      v_order.diet_order,
      v_order.mobility_order,
      v_order.adl_support,
      v_order.continence_support,
      v_order.behavior_orientation,
      v_order.clinical_support,
      v_order.nutrition_orders,
      v_order.operational_flags,
      v_order.provider_name,
      v_order.provider_signature,
      v_order.provider_signature_date,
      v_order.signed_by_name,
      v_order.signature_metadata,
      v_order.created_by_user_id,
      v_order.created_by_name,
      v_order.updated_by_user_id,
      v_order.updated_by_name,
      v_order.created_at,
      v_order.updated_at
    );
  else
    update public.physician_orders
    set
      intake_assessment_id = v_order.intake_assessment_id,
      status = v_order.status,
      is_active_signed = v_order.is_active_signed,
      superseded_by = v_order.superseded_by,
      superseded_at = v_order.superseded_at,
      sent_at = v_order.sent_at,
      signed_at = v_order.signed_at,
      effective_at = v_order.effective_at,
      next_renewal_due_date = v_order.next_renewal_due_date,
      member_name_snapshot = v_order.member_name_snapshot,
      member_dob_snapshot = v_order.member_dob_snapshot,
      sex = v_order.sex,
      level_of_care = v_order.level_of_care,
      dnr_selected = v_order.dnr_selected,
      vitals_blood_pressure = v_order.vitals_blood_pressure,
      vitals_pulse = v_order.vitals_pulse,
      vitals_oxygen_saturation = v_order.vitals_oxygen_saturation,
      vitals_respiration = v_order.vitals_respiration,
      diagnoses = v_order.diagnoses,
      allergies = v_order.allergies,
      medications = v_order.medications,
      standing_orders = v_order.standing_orders,
      diet_order = v_order.diet_order,
      mobility_order = v_order.mobility_order,
      adl_support = v_order.adl_support,
      continence_support = v_order.continence_support,
      behavior_orientation = v_order.behavior_orientation,
      clinical_support = v_order.clinical_support,
      nutrition_orders = v_order.nutrition_orders,
      operational_flags = v_order.operational_flags,
      provider_name = v_order.provider_name,
      provider_signature = v_order.provider_signature,
      provider_signature_date = v_order.provider_signature_date,
      signed_by_name = v_order.signed_by_name,
      signature_metadata = v_order.signature_metadata,
      updated_by_user_id = v_order.updated_by_user_id,
      updated_by_name = v_order.updated_by_name,
      updated_at = v_order.updated_at
    where id = v_order.id;
  end if;

  if v_target_status = 'signed' then
    select *
    into v_sign_result
    from public.rpc_sign_physician_order(
      p_pof_id => v_order.id,
      p_actor_user_id => p_actor_user_id,
      p_actor_name => v_actor_name,
      p_signed_at => v_signed_at,
      p_pof_request_id => p_pof_request_id
    );
  end if;

  return query
  select
    v_order.id,
    p_member_id,
    v_order.version_number,
    case when v_target_status = 'signed' then 'signed' else v_order.status end,
    case when v_target_status = 'signed' then (v_sign_result.queue_id)::uuid else null end,
    case when v_target_status = 'signed' then coalesce((v_sign_result.queue_attempt_count)::integer, 0) else null end,
    case when v_target_status = 'signed' then (v_sign_result.queue_next_retry_at)::timestamptz else null end,
    v_created_new;
end;
$$;

grant execute on function public.rpc_upsert_physician_order(
  uuid,
  uuid,
  jsonb,
  text,
  uuid,
  text,
  timestamptz,
  uuid
) to authenticated, service_role;
