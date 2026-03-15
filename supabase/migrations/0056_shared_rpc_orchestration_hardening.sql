create or replace function public.rpc_upsert_care_plan_core(
  p_care_plan_id uuid,
  p_member_id uuid,
  p_track text,
  p_enrollment_date date,
  p_review_date date,
  p_last_completed_date date,
  p_next_due_date date,
  p_status text,
  p_care_team_notes text,
  p_no_changes_needed boolean,
  p_modifications_required boolean,
  p_modifications_description text,
  p_caregiver_name text,
  p_caregiver_email text,
  p_actor_user_id uuid,
  p_actor_name text,
  p_now timestamptz default now(),
  p_sections jsonb default '[]'::jsonb
)
returns table (
  care_plan_id uuid,
  was_created boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_care_plan_id uuid;
  v_now timestamptz := coalesce(p_now, now());
begin
  if p_member_id is null then
    raise exception 'rpc_upsert_care_plan_core requires p_member_id';
  end if;
  if nullif(trim(coalesce(p_track, '')), '') is null then
    raise exception 'rpc_upsert_care_plan_core requires p_track';
  end if;
  if p_enrollment_date is null or p_review_date is null or p_next_due_date is null then
    raise exception 'rpc_upsert_care_plan_core requires enrollment, review, and next due dates';
  end if;
  if jsonb_typeof(coalesce(p_sections, '[]'::jsonb)) <> 'array' then
    raise exception 'rpc_upsert_care_plan_core requires p_sections to be a JSON array';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_sections, '[]'::jsonb)) section
    where nullif(trim(coalesce(section ->> 'sectionType', '')), '') is null
      or nullif(trim(coalesce(section ->> 'shortTermGoals', '')), '') is null
      or nullif(trim(coalesce(section ->> 'longTermGoals', '')), '') is null
      or nullif(trim(coalesce(section ->> 'displayOrder', '')), '') is null
  ) then
    raise exception 'rpc_upsert_care_plan_core requires populated sectionType, shortTermGoals, longTermGoals, and displayOrder values';
  end if;

  if p_care_plan_id is null then
    insert into public.care_plans (
      member_id,
      track,
      enrollment_date,
      review_date,
      last_completed_date,
      next_due_date,
      status,
      completed_by,
      date_of_completion,
      responsible_party_signature,
      responsible_party_signature_date,
      administrator_signature,
      administrator_signature_date,
      care_team_notes,
      no_changes_needed,
      modifications_required,
      modifications_description,
      nurse_designee_user_id,
      nurse_designee_name,
      nurse_signed_at,
      nurse_signature_status,
      nurse_signed_by_user_id,
      nurse_signed_by_name,
      nurse_signature_artifact_storage_path,
      nurse_signature_artifact_member_file_id,
      nurse_signature_metadata,
      caregiver_name,
      caregiver_email,
      caregiver_signature_status,
      caregiver_sent_at,
      caregiver_sent_by_user_id,
      caregiver_viewed_at,
      caregiver_signed_at,
      caregiver_signature_request_token,
      caregiver_signature_expires_at,
      caregiver_signature_request_url,
      caregiver_signed_name,
      caregiver_signature_image_url,
      caregiver_signature_ip,
      caregiver_signature_user_agent,
      final_member_file_id,
      legacy_cleanup_flag,
      created_by_user_id,
      created_by_name,
      updated_by_user_id,
      updated_by_name,
      created_at,
      updated_at
    )
    values (
      p_member_id,
      p_track,
      p_enrollment_date,
      p_review_date,
      p_last_completed_date,
      p_next_due_date,
      p_status,
      null,
      null,
      null,
      null,
      null,
      null,
      coalesce(p_care_team_notes, ''),
      coalesce(p_no_changes_needed, false),
      coalesce(p_modifications_required, false),
      coalesce(p_modifications_description, ''),
      null,
      null,
      null,
      'unsigned',
      null,
      null,
      null,
      null,
      '{}'::jsonb,
      nullif(trim(coalesce(p_caregiver_name, '')), ''),
      nullif(trim(coalesce(p_caregiver_email, '')), ''),
      'not_requested',
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      false,
      p_actor_user_id,
      nullif(trim(coalesce(p_actor_name, '')), ''),
      p_actor_user_id,
      nullif(trim(coalesce(p_actor_name, '')), ''),
      v_now,
      v_now
    )
    returning id into v_care_plan_id;
    was_created := true;
  else
    select id
    into v_care_plan_id
    from public.care_plans
    where id = p_care_plan_id
    for update;

    if v_care_plan_id is null then
      raise exception 'Care plan % not found for update', p_care_plan_id;
    end if;

    update public.care_plans
    set
      track = p_track,
      enrollment_date = p_enrollment_date,
      review_date = p_review_date,
      last_completed_date = p_last_completed_date,
      next_due_date = p_next_due_date,
      status = p_status,
      completed_by = null,
      date_of_completion = null,
      responsible_party_signature = null,
      responsible_party_signature_date = null,
      administrator_signature = null,
      administrator_signature_date = null,
      care_team_notes = coalesce(p_care_team_notes, ''),
      no_changes_needed = coalesce(p_no_changes_needed, false),
      modifications_required = coalesce(p_modifications_required, false),
      modifications_description = coalesce(p_modifications_description, ''),
      nurse_designee_user_id = null,
      nurse_designee_name = null,
      nurse_signed_at = null,
      nurse_signature_status = 'unsigned',
      nurse_signed_by_user_id = null,
      nurse_signed_by_name = null,
      nurse_signature_artifact_storage_path = null,
      nurse_signature_artifact_member_file_id = null,
      nurse_signature_metadata = '{}'::jsonb,
      caregiver_name = nullif(trim(coalesce(p_caregiver_name, '')), ''),
      caregiver_email = nullif(trim(coalesce(p_caregiver_email, '')), ''),
      caregiver_signature_status = 'not_requested',
      caregiver_sent_at = null,
      caregiver_sent_by_user_id = null,
      caregiver_viewed_at = null,
      caregiver_signed_at = null,
      caregiver_signature_request_token = null,
      caregiver_signature_expires_at = null,
      caregiver_signature_request_url = null,
      caregiver_signed_name = null,
      caregiver_signature_image_url = null,
      caregiver_signature_ip = null,
      caregiver_signature_user_agent = null,
      final_member_file_id = null,
      legacy_cleanup_flag = false,
      updated_by_user_id = p_actor_user_id,
      updated_by_name = nullif(trim(coalesce(p_actor_name, '')), ''),
      updated_at = v_now
    where id = v_care_plan_id;

    was_created := false;
  end if;

  delete from public.care_plan_sections where care_plan_id = v_care_plan_id;

  insert into public.care_plan_sections (
    care_plan_id,
    section_type,
    short_term_goals,
    long_term_goals,
    display_order
  )
  select
    v_care_plan_id,
    section ->> 'sectionType',
    section ->> 'shortTermGoals',
    section ->> 'longTermGoals',
    (section ->> 'displayOrder')::integer
  from jsonb_array_elements(coalesce(p_sections, '[]'::jsonb)) section;

  care_plan_id := v_care_plan_id;
  return next;
end;
$$;

grant execute on function public.rpc_upsert_care_plan_core(
  uuid,
  uuid,
  text,
  date,
  date,
  date,
  date,
  text,
  text,
  boolean,
  boolean,
  text,
  text,
  text,
  uuid,
  text,
  timestamptz,
  jsonb
) to authenticated, service_role;

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
declare
  v_now timestamptz := coalesce(p_now, now());
begin
  if p_member_id is null then
    raise exception 'rpc_sync_member_health_profile_to_command_center requires p_member_id';
  end if;

  insert into public.member_health_profiles (
    member_id,
    created_at,
    updated_at,
    updated_by_user_id,
    updated_by_name
  )
  values (
    p_member_id,
    v_now,
    v_now,
    p_actor_user_id,
    nullif(trim(coalesce(p_actor_name, '')), '')
  )
  on conflict (member_id) do nothing;

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
    'mcc-' || p_member_id::text,
    p_member_id,
    'English',
    p_actor_user_id,
    nullif(trim(coalesce(p_actor_name, '')), ''),
    v_now,
    v_now
  )
  on conflict (member_id) do nothing;

  update public.member_command_centers mcc
  set
    gender = mhp.gender,
    payor = mhp.payor,
    original_referral_source = mhp.original_referral_source,
    photo_consent = mhp.photo_consent,
    profile_image_url = mhp.profile_image_url,
    code_status = mhp.code_status,
    dnr = mhp.dnr,
    dni = mhp.dni,
    polst_molst_colst = mhp.polst_molst_colst,
    hospice = mhp.hospice,
    advanced_directives_obtained = mhp.advanced_directives_obtained,
    power_of_attorney = mhp.power_of_attorney,
    legal_comments = mhp.legal_comments,
    diet_type = mhp.diet_type,
    dietary_preferences_restrictions = mhp.dietary_restrictions,
    swallowing_difficulty = mhp.swallowing_difficulty,
    supplements = mhp.supplements,
    foods_to_omit = mhp.foods_to_omit,
    diet_texture = mhp.diet_texture,
    command_center_notes = mhp.important_alerts,
    updated_by_user_id = p_actor_user_id,
    updated_by_name = nullif(trim(coalesce(p_actor_name, '')), ''),
    updated_at = v_now
  from public.member_health_profiles mhp
  where mhp.member_id = p_member_id
    and mcc.member_id = p_member_id;

  update public.members m
  set code_status = mhp.code_status
  from public.member_health_profiles mhp
  where mhp.member_id = p_member_id
    and m.id = p_member_id
    and nullif(trim(coalesce(mhp.code_status, '')), '') is not null;

  return query
  select
    p_member_id,
    mhp.id,
    mcc.id
  from public.member_health_profiles mhp
  join public.member_command_centers mcc
    on mcc.member_id = mhp.member_id
  where mhp.member_id = p_member_id;
end;
$$;

grant execute on function public.rpc_sync_member_health_profile_to_command_center(
  uuid,
  uuid,
  text,
  timestamptz
) to authenticated, service_role;

create or replace function public.rpc_sync_command_center_to_member_health_profile(
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
declare
  v_now timestamptz := coalesce(p_now, now());
begin
  if p_member_id is null then
    raise exception 'rpc_sync_command_center_to_member_health_profile requires p_member_id';
  end if;

  insert into public.member_health_profiles (
    member_id,
    created_at,
    updated_at,
    updated_by_user_id,
    updated_by_name
  )
  values (
    p_member_id,
    v_now,
    v_now,
    p_actor_user_id,
    nullif(trim(coalesce(p_actor_name, '')), '')
  )
  on conflict (member_id) do nothing;

  update public.member_health_profiles mhp
  set
    gender = mcc.gender,
    payor = mcc.payor,
    original_referral_source = mcc.original_referral_source,
    photo_consent = mcc.photo_consent,
    profile_image_url = mcc.profile_image_url,
    code_status = mcc.code_status,
    dnr = mcc.dnr,
    dni = mcc.dni,
    polst_molst_colst = mcc.polst_molst_colst,
    hospice = mcc.hospice,
    advanced_directives_obtained = mcc.advanced_directives_obtained,
    power_of_attorney = mcc.power_of_attorney,
    legal_comments = mcc.legal_comments,
    diet_type = mcc.diet_type,
    dietary_restrictions = mcc.dietary_preferences_restrictions,
    swallowing_difficulty = mcc.swallowing_difficulty,
    supplements = mcc.supplements,
    foods_to_omit = mcc.foods_to_omit,
    diet_texture = mcc.diet_texture,
    important_alerts = mcc.command_center_notes,
    source_assessment_id = mcc.source_assessment_id,
    source_assessment_at = mcc.source_assessment_at,
    updated_by_user_id = p_actor_user_id,
    updated_by_name = nullif(trim(coalesce(p_actor_name, '')), ''),
    updated_at = v_now
  from public.member_command_centers mcc
  where mcc.member_id = p_member_id
    and mhp.member_id = p_member_id;

  update public.members m
  set code_status = mcc.code_status
  from public.member_command_centers mcc
  where mcc.member_id = p_member_id
    and m.id = p_member_id
    and nullif(trim(coalesce(mcc.code_status, '')), '') is not null;

  return query
  select
    p_member_id,
    mhp.id,
    mcc.id
  from public.member_health_profiles mhp
  join public.member_command_centers mcc
    on mcc.member_id = mhp.member_id
  where mhp.member_id = p_member_id;
end;
$$;

grant execute on function public.rpc_sync_command_center_to_member_health_profile(
  uuid,
  uuid,
  text,
  timestamptz
) to authenticated, service_role;

create or replace function public.rpc_prefill_member_command_center_from_assessment(
  p_member_id uuid,
  p_assessment_id uuid,
  p_actor_user_id uuid,
  p_actor_name text,
  p_now timestamptz default now()
)
returns table (
  member_command_center_id text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_assessment record;
begin
  if p_member_id is null or p_assessment_id is null then
    raise exception 'rpc_prefill_member_command_center_from_assessment requires member and assessment ids';
  end if;

  select
    id,
    member_id,
    assessment_date,
    signed_at,
    code_status,
    diet_type,
    diet_other,
    diet_restrictions_notes,
    incontinence_products,
    social_triggers,
    emotional_wellness_notes,
    transport_notes,
    notes,
    total_score,
    recommended_track,
    admission_review_required
  into v_assessment
  from public.intake_assessments
  where id = p_assessment_id
  for update;

  if not found then
    raise exception 'Assessment % not found', p_assessment_id;
  end if;
  if v_assessment.member_id <> p_member_id then
    raise exception 'Assessment/member mismatch for assessment %', p_assessment_id;
  end if;

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
    'mcc-' || p_member_id::text,
    p_member_id,
    'English',
    p_actor_user_id,
    nullif(trim(coalesce(p_actor_name, '')), ''),
    v_now,
    v_now
  )
  on conflict (member_id) do nothing;

  update public.member_command_centers
  set
    source_assessment_id = p_assessment_id,
    source_assessment_at = coalesce(
      (v_assessment.signed_at at time zone 'America/New_York')::date,
      v_assessment.assessment_date
    ),
    code_status = nullif(trim(coalesce(v_assessment.code_status, '')), ''),
    dnr = upper(coalesce(v_assessment.code_status, '')) = 'DNR',
    diet_type = nullif(trim(coalesce(v_assessment.diet_type, '')), ''),
    dietary_preferences_restrictions = nullif(
      concat_ws(
        ' | ',
        nullif(trim(coalesce(v_assessment.diet_restrictions_notes, '')), ''),
        nullif(trim(coalesce(v_assessment.diet_other, '')), '')
      ),
      ''
    ),
    swallowing_difficulty = nullif(trim(coalesce(v_assessment.incontinence_products, '')), ''),
    command_center_notes = nullif(
      concat_ws(
        ' | ',
        nullif(trim(coalesce(v_assessment.transport_notes, '')), ''),
        nullif(trim(coalesce(v_assessment.social_triggers, '')), ''),
        nullif(trim(coalesce(v_assessment.emotional_wellness_notes, '')), ''),
        nullif(trim(coalesce(v_assessment.notes, '')), '')
      ),
      ''
    ),
    updated_by_user_id = p_actor_user_id,
    updated_by_name = nullif(trim(coalesce(p_actor_name, '')), ''),
    updated_at = v_now
  where member_id = p_member_id;

  update public.members
  set
    latest_assessment_id = p_assessment_id,
    latest_assessment_date = v_assessment.assessment_date,
    latest_assessment_score = v_assessment.total_score,
    latest_assessment_track = nullif(trim(coalesce(v_assessment.recommended_track, '')), ''),
    latest_assessment_admission_review_required = coalesce(v_assessment.admission_review_required, false),
    code_status = nullif(trim(coalesce(v_assessment.code_status, '')), '')
  where id = p_member_id;

  return query
  select mcc.id
  from public.member_command_centers mcc
  where mcc.member_id = p_member_id;
end;
$$;

grant execute on function public.rpc_prefill_member_command_center_from_assessment(
  uuid,
  uuid,
  uuid,
  text,
  timestamptz
) to authenticated, service_role;

create or replace function public.rpc_sync_mar_medications_from_member_profile(
  p_member_id uuid,
  p_preferred_physician_order_id uuid default null,
  p_now timestamptz default now()
)
returns table (
  anchor_physician_order_id uuid,
  synced_medications integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_anchor_physician_order_id uuid;
  v_profile_order_id uuid;
  v_member_name text;
begin
  if p_member_id is null then
    raise exception 'rpc_sync_mar_medications_from_member_profile requires p_member_id';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_member_id::text)::bigint);

  if p_preferred_physician_order_id is not null then
    v_anchor_physician_order_id := p_preferred_physician_order_id;
  else
    select active_physician_order_id
    into v_profile_order_id
    from public.member_health_profiles
    where member_id = p_member_id;

    v_anchor_physician_order_id := v_profile_order_id;
  end if;

  if v_anchor_physician_order_id is null then
    select po.id
    into v_anchor_physician_order_id
    from public.physician_orders po
    where po.member_id = p_member_id
    order by po.version_number desc, po.created_at desc
    limit 1;
  end if;

  if v_anchor_physician_order_id is null then
    select m.display_name
    into v_member_name
    from public.members m
    where m.id = p_member_id
    for update;

    if v_member_name is null then
      raise exception 'Member % not found for MAR medication sync', p_member_id;
    end if;

    insert into public.physician_orders (
      member_id,
      version_number,
      status,
      is_active_signed,
      superseded_at,
      signed_at,
      effective_at,
      member_name_snapshot,
      signature_metadata,
      created_by_name,
      updated_by_name,
      created_at,
      updated_at
    )
    values (
      p_member_id,
      1,
      'superseded',
      false,
      v_now,
      v_now,
      v_now,
      v_member_name,
      jsonb_build_object(
        'system_generated_for', 'mar_anchor',
        'generated_by_service', 'mar-workflow',
        'generated_at', v_now
      ),
      'System MAR Anchor',
      'System MAR Anchor',
      v_now,
      v_now
    )
    returning id into v_anchor_physician_order_id;
  end if;

  with source_rows as (
    select
      'mhp-' || mm.id::text as source_medication_id,
      mm.medication_name,
      mm.dose,
      mm.route,
      mm.frequency,
      coalesce(mm.scheduled_times, '{}'::text[]) as scheduled_times,
      coalesce(mm.prn, false) as prn,
      mm.prn_instructions,
      mm.date_started,
      mm.inactivated_at,
      mm.comments
    from public.member_medications mm
    where mm.member_id = p_member_id
      and mm.medication_status = 'active'
      and coalesce(mm.given_at_center, false) = true
      and nullif(trim(coalesce(mm.medication_name, '')), '') is not null
  ), upserted as (
    insert into public.pof_medications (
      physician_order_id,
      member_id,
      source_medication_id,
      medication_name,
      strength,
      dose,
      route,
      frequency,
      scheduled_times,
      given_at_center,
      prn,
      prn_instructions,
      start_date,
      end_date,
      active,
      provider,
      instructions,
      created_by_user_id,
      created_by_name,
      updated_by_user_id,
      updated_by_name,
      created_at,
      updated_at
    )
    select
      v_anchor_physician_order_id,
      p_member_id,
      source_rows.source_medication_id,
      source_rows.medication_name,
      null,
      source_rows.dose,
      source_rows.route,
      source_rows.frequency,
      source_rows.scheduled_times,
      true,
      source_rows.prn,
      source_rows.prn_instructions,
      source_rows.date_started,
      source_rows.inactivated_at,
      true,
      null,
      source_rows.comments,
      null,
      null,
      null,
      null,
      v_now,
      v_now
    from source_rows
    on conflict (physician_order_id, source_medication_id)
    do update
    set
      medication_name = excluded.medication_name,
      dose = excluded.dose,
      route = excluded.route,
      frequency = excluded.frequency,
      scheduled_times = excluded.scheduled_times,
      given_at_center = excluded.given_at_center,
      prn = excluded.prn,
      prn_instructions = excluded.prn_instructions,
      start_date = excluded.start_date,
      end_date = excluded.end_date,
      active = true,
      instructions = excluded.instructions,
      updated_at = excluded.updated_at
    returning 1
  )
  select count(*) into synced_medications from upserted;

  update public.pof_medications pm
  set
    active = false,
    updated_at = v_now
  where pm.member_id = p_member_id
    and pm.active = true
    and pm.source_medication_id like 'mhp-%'
    and (
      pm.physician_order_id <> v_anchor_physician_order_id
      or not exists (
        select 1
        from public.member_medications mm
        where mm.member_id = p_member_id
          and mm.medication_status = 'active'
          and coalesce(mm.given_at_center, false) = true
          and ('mhp-' || mm.id::text) = pm.source_medication_id
      )
    );

  anchor_physician_order_id := v_anchor_physician_order_id;
  return next;
end;
$$;

grant execute on function public.rpc_sync_mar_medications_from_member_profile(
  uuid,
  uuid,
  timestamptz
) to authenticated, service_role;

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
    (((generated_day)::text || 'T' || scheduled_time.value)::timestamp at time zone 'America/New_York'),
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
