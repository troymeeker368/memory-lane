alter table public.enrollment_packet_requests
  add column if not exists delivery_status text not null default 'pending_preparation'
    check (delivery_status in ('pending_preparation', 'ready_to_send', 'retry_pending', 'send_failed', 'sent')),
  add column if not exists last_delivery_attempt_at timestamptz,
  add column if not exists delivery_failed_at timestamptz,
  add column if not exists delivery_error text;

update public.enrollment_packet_requests
set delivery_status = case
  when status in ('sent', 'opened', 'partially_completed', 'completed', 'filed') then 'sent'
  when status = 'prepared' then 'ready_to_send'
  else 'pending_preparation'
end
where delivery_status is null
   or delivery_status not in ('pending_preparation', 'ready_to_send', 'retry_pending', 'send_failed', 'sent');

alter table public.pof_requests
  add column if not exists delivery_status text not null default 'pending_preparation'
    check (delivery_status in ('pending_preparation', 'ready_to_send', 'retry_pending', 'send_failed', 'sent')),
  add column if not exists last_delivery_attempt_at timestamptz,
  add column if not exists delivery_failed_at timestamptz,
  add column if not exists delivery_error text;

update public.pof_requests
set delivery_status = case
  when status in ('sent', 'opened', 'signed', 'declined', 'expired') then 'sent'
  else 'pending_preparation'
end
where delivery_status is null
   or delivery_status not in ('pending_preparation', 'ready_to_send', 'retry_pending', 'send_failed', 'sent');

create or replace function public.rpc_sync_signed_pof_to_member_clinical_profile(
  p_pof_id uuid,
  p_synced_at timestamptz default now()
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
declare
  v_order public.physician_orders%rowtype;
  v_now timestamptz := coalesce(p_synced_at, now());
  v_signed_date date;
  v_actor_user_id uuid;
  v_actor_name text;
  v_nutrition_diets jsonb;
  v_primary_diet text;
  v_food_allergies text;
  v_medication_allergies text;
  v_environmental_allergies text;
begin
  if p_pof_id is null then
    raise exception 'p_pof_id is required';
  end if;

  select *
  into v_order
  from public.physician_orders
  where id = p_pof_id
  for update;

  if not found then
    raise exception 'Signed physician order % was not found for post-sign sync.', p_pof_id;
  end if;

  if coalesce(lower(v_order.status), '') <> 'signed' then
    raise exception 'Signed physician order sync requires status=signed. Current status=%', coalesce(v_order.status, 'null');
  end if;

  v_signed_date := coalesce((v_order.signed_at at time zone 'America/New_York')::date, (v_now at time zone 'America/New_York')::date);
  v_actor_user_id := v_order.updated_by_user_id;
  v_actor_name := coalesce(nullif(trim(v_order.updated_by_name), ''), nullif(trim(v_order.created_by_name), ''));
  v_nutrition_diets := coalesce((v_order.clinical_support -> 'nutritionDiets'), '[]'::jsonb);
  v_primary_diet :=
    coalesce(
      (
        select value
        from jsonb_array_elements_text(v_nutrition_diets) as diets(value)
        where lower(value) <> 'regular'
        limit 1
      ),
      (
        select value
        from jsonb_array_elements_text(v_nutrition_diets) as diets(value)
        limit 1
      ),
      'Regular'
    );

  insert into public.member_health_profiles (
    member_id,
    active_physician_order_id,
    diagnoses,
    allergies,
    medications,
    diet,
    mobility,
    adl_support,
    continence,
    behavior_orientation,
    clinical_support,
    operational_flags,
    profile_notes,
    joy_sparks,
    last_synced_at,
    updated_at
  )
  values (
    v_order.member_id,
    v_order.id,
    coalesce(v_order.diagnoses, '[]'::jsonb),
    coalesce(v_order.allergies, '[]'::jsonb),
    coalesce(v_order.medications, '[]'::jsonb),
    jsonb_build_object(
      'nutritionDiets', coalesce(v_order.clinical_support -> 'nutritionDiets', '[]'::jsonb),
      'nutritionDietOther', v_order.clinical_support -> 'nutritionDietOther'
    ),
    jsonb_build_object(
      'ambulatoryStatus', v_order.clinical_support -> 'ambulatoryStatus',
      'mobilityIndependent', v_order.clinical_support -> 'mobilityIndependent',
      'mobilityWalker', v_order.clinical_support -> 'mobilityWalker',
      'mobilityWheelchair', v_order.clinical_support -> 'mobilityWheelchair',
      'mobilityScooter', v_order.clinical_support -> 'mobilityScooter',
      'mobilityOther', v_order.clinical_support -> 'mobilityOther',
      'mobilityOtherText', v_order.clinical_support -> 'mobilityOtherText'
    ),
    coalesce(v_order.clinical_support -> 'adlProfile', '{}'::jsonb),
    jsonb_build_object(
      'bladderContinent', v_order.clinical_support -> 'bladderContinent',
      'bladderIncontinent', v_order.clinical_support -> 'bladderIncontinent',
      'bowelContinent', v_order.clinical_support -> 'bowelContinent',
      'bowelIncontinent', v_order.clinical_support -> 'bowelIncontinent'
    ),
    coalesce(v_order.clinical_support -> 'orientationProfile', '{}'::jsonb),
    coalesce(v_order.clinical_support, '{}'::jsonb),
    coalesce(v_order.operational_flags, '{}'::jsonb),
    nullif(trim(coalesce(v_order.clinical_support -> 'orientationProfile' ->> 'cognitiveBehaviorComments', '')), ''),
    nullif(trim(coalesce(v_order.clinical_support ->> 'joySparksNotes', '')), ''),
    v_now,
    v_now
  )
  on conflict (member_id)
  do update
  set
    active_physician_order_id = excluded.active_physician_order_id,
    diagnoses = excluded.diagnoses,
    allergies = excluded.allergies,
    medications = excluded.medications,
    diet = excluded.diet,
    mobility = excluded.mobility,
    adl_support = excluded.adl_support,
    continence = excluded.continence,
    behavior_orientation = excluded.behavior_orientation,
    clinical_support = excluded.clinical_support,
    operational_flags = excluded.operational_flags,
    profile_notes = excluded.profile_notes,
    joy_sparks = excluded.joy_sparks,
    last_synced_at = excluded.last_synced_at,
    updated_at = excluded.updated_at;

  delete from public.member_diagnoses where member_id = v_order.member_id;
  insert into public.member_diagnoses (
    id,
    member_id,
    diagnosis_type,
    diagnosis_name,
    diagnosis_code,
    date_added,
    comments,
    created_by_user_id,
    created_by_name,
    created_at,
    updated_at
  )
  select
    gen_random_uuid(),
    v_order.member_id,
    case
      when lower(coalesce(item ->> 'diagnosisType', '')) = 'secondary' then 'secondary'
      else 'primary'
    end,
    item ->> 'diagnosisName',
    null,
    v_signed_date,
    null,
    v_actor_user_id,
    v_actor_name,
    v_now,
    v_now
  from jsonb_array_elements(coalesce(v_order.diagnoses, '[]'::jsonb)) item
  where nullif(trim(coalesce(item ->> 'diagnosisName', '')), '') is not null;

  delete from public.member_medications where member_id = v_order.member_id;
  insert into public.member_medications (
    id,
    member_id,
    medication_name,
    date_started,
    medication_status,
    inactivated_at,
    dose,
    quantity,
    form,
    frequency,
    route,
    route_laterality,
    comments,
    created_by_user_id,
    created_by_name,
    created_at,
    updated_at
  )
  select
    gen_random_uuid(),
    v_order.member_id,
    item ->> 'name',
    v_signed_date,
    'active',
    null,
    nullif(trim(coalesce(item ->> 'dose', '')), ''),
    nullif(trim(coalesce(item ->> 'quantity', '')), ''),
    nullif(trim(coalesce(item ->> 'form', '')), ''),
    nullif(trim(coalesce(item ->> 'frequency', '')), ''),
    nullif(trim(coalesce(item ->> 'route', '')), ''),
    nullif(trim(coalesce(item ->> 'routeLaterality', '')), ''),
    nullif(trim(coalesce(item ->> 'comments', '')), ''),
    v_actor_user_id,
    v_actor_name,
    v_now,
    v_now
  from jsonb_array_elements(coalesce(v_order.medications, '[]'::jsonb)) item
  where nullif(trim(coalesce(item ->> 'name', '')), '') is not null;

  delete from public.member_allergies where member_id = v_order.member_id;
  insert into public.member_allergies (
    id,
    member_id,
    allergy_group,
    allergy_name,
    severity,
    comments,
    created_by_user_id,
    created_by_name,
    created_at,
    updated_at
  )
  select
    'allergy-' || replace(gen_random_uuid()::text, '-', ''),
    v_order.member_id,
    case
      when lower(coalesce(item ->> 'allergyGroup', '')) in ('food', 'medication', 'environmental') then lower(item ->> 'allergyGroup')
      else 'environmental'
    end,
    item ->> 'allergyName',
    nullif(trim(coalesce(item ->> 'severity', '')), ''),
    nullif(trim(coalesce(item ->> 'comments', '')), ''),
    v_actor_user_id,
    v_actor_name,
    v_now,
    v_now
  from jsonb_array_elements(coalesce(v_order.allergies, '[]'::jsonb)) item
  where nullif(trim(coalesce(item ->> 'allergyName', '')), '') is not null;

  insert into public.member_command_centers (
    id,
    member_id,
    primary_language,
    updated_by_user_id,
    updated_by_name,
    created_at,
    updated_at
  )
  values (
    'mcc-' || v_order.member_id::text,
    v_order.member_id,
    'English',
    v_actor_user_id,
    v_actor_name,
    v_now,
    v_now
  )
  on conflict (member_id)
  do nothing;

  select string_agg(allergy_name, ', ' order by allergy_name)
  into v_food_allergies
  from public.member_allergies
  where member_id = v_order.member_id
    and allergy_group = 'food';

  select string_agg(allergy_name, ', ' order by allergy_name)
  into v_medication_allergies
  from public.member_allergies
  where member_id = v_order.member_id
    and allergy_group = 'medication';

  select string_agg(allergy_name, ', ' order by allergy_name)
  into v_environmental_allergies
  from public.member_allergies
  where member_id = v_order.member_id
    and allergy_group = 'environmental';

  update public.member_command_centers
  set
    code_status = case when coalesce(v_order.dnr_selected, false) then 'DNR' else 'Full Code' end,
    dnr = coalesce(v_order.dnr_selected, false),
    diet_type = v_primary_diet,
    dietary_preferences_restrictions = nullif(
      concat_ws(
        ' | ',
        nullif(trim(coalesce(v_order.clinical_support ->> 'nutritionDietOther', '')), ''),
        nullif(trim(coalesce(v_order.clinical_support ->> 'joySparksNotes', '')), '')
      ),
      ''
    ),
    no_known_allergies = not exists (
      select 1 from public.member_allergies ma where ma.member_id = v_order.member_id
    ),
    medication_allergies = nullif(coalesce(v_medication_allergies, ''), ''),
    food_allergies = nullif(coalesce(v_food_allergies, ''), ''),
    environmental_allergies = nullif(coalesce(v_environmental_allergies, ''), ''),
    source_assessment_id = v_order.intake_assessment_id,
    source_assessment_at = (v_order.signed_at at time zone 'America/New_York')::date,
    updated_by_user_id = v_actor_user_id,
    updated_by_name = v_actor_name,
    updated_at = v_now
  where member_id = v_order.member_id;

  return query
  select
    v_order.member_id,
    mhp.id,
    mcc.id
  from public.member_health_profiles mhp
  left join public.member_command_centers mcc
    on mcc.member_id = mhp.member_id
  where mhp.member_id = v_order.member_id;
end;
$$;
