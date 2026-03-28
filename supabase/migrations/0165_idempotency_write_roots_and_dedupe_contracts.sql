-- Add DB-backed idempotency contracts for the highest-risk write roots
-- and optional dedupe keys for append-only observability tables.

alter table public.leads
  add column if not exists idempotency_key text;

create unique index if not exists idx_leads_idempotency_key
  on public.leads (idempotency_key)
  where idempotency_key is not null;

alter table public.intake_assessments
  add column if not exists creation_idempotency_key text;

create unique index if not exists idx_intake_assessments_creation_idempotency_key
  on public.intake_assessments (creation_idempotency_key)
  where creation_idempotency_key is not null;

alter table public.medication_orders
  add column if not exists creation_idempotency_key text;

create unique index if not exists idx_medication_orders_creation_idempotency_key
  on public.medication_orders (creation_idempotency_key)
  where creation_idempotency_key is not null;

alter table public.billing_export_jobs
  add column if not exists idempotency_key text;

create unique index if not exists idx_billing_export_jobs_idempotency_key
  on public.billing_export_jobs (idempotency_key)
  where idempotency_key is not null;

alter table public.system_events
  add column if not exists dedupe_key text;

create unique index if not exists idx_system_events_dedupe_key
  on public.system_events (dedupe_key)
  where dedupe_key is not null;

alter table public.audit_logs
  add column if not exists dedupe_key text;

create unique index if not exists idx_audit_logs_dedupe_key
  on public.audit_logs (dedupe_key)
  where dedupe_key is not null;

alter table public.enrollment_packet_uploads
  add column if not exists upload_fingerprint text;

create unique index if not exists idx_enrollment_packet_uploads_packet_category_fingerprint
  on public.enrollment_packet_uploads (packet_id, upload_category, upload_fingerprint);

drop function if exists public.create_lead_with_member_conversion(
  text,
  text,
  text,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  date,
  date,
  jsonb,
  timestamptz,
  date
);

create or replace function public.create_lead_with_member_conversion(
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
  p_idempotency_key text default null,
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
  v_lead_id uuid;
  v_patch jsonb := coalesce(p_lead_patch, '{}'::jsonb);
  v_idempotency_key text := nullif(trim(coalesce(p_idempotency_key, '')), '');
begin
  if nullif(trim(coalesce(p_to_stage, '')), '') is null then
    raise exception 'Target stage is required.';
  end if;
  if p_to_status not in ('open', 'won', 'lost') then
    raise exception 'Target status must be open, won, or lost.';
  end if;
  if p_business_status not in ('Open', 'Won', 'Lost', 'Nurture') then
    raise exception 'Business status is invalid.';
  end if;

  if v_idempotency_key is not null then
    select l.id
    into v_lead_id
    from public.leads l
    where l.idempotency_key = v_idempotency_key
    order by l.created_at asc, l.id asc
    limit 1
    for update;
  end if;

  if v_lead_id is null then
    begin
      insert into public.leads (
        status,
        stage,
        stage_updated_at,
        inquiry_date,
        tour_date,
        tour_completed,
        discovery_date,
        member_start_date,
        caregiver_name,
        caregiver_relationship,
        caregiver_email,
        caregiver_phone,
        member_name,
        member_dob,
        lead_source,
        lead_source_other,
        partner_id,
        referral_source_id,
        referral_name,
        likelihood,
        next_follow_up_date,
        next_follow_up_type,
        notes_summary,
        lost_reason,
        closed_date,
        created_by_user_id,
        updated_at,
        idempotency_key
      )
      values (
        p_to_status::public.lead_status,
        p_to_stage,
        coalesce(nullif(v_patch->>'stage_updated_at', '')::timestamptz, p_now),
        nullif(v_patch->>'inquiry_date', '')::date,
        nullif(v_patch->>'tour_date', '')::date,
        coalesce((v_patch->>'tour_completed')::boolean, false),
        nullif(v_patch->>'discovery_date', '')::date,
        nullif(v_patch->>'member_start_date', '')::date,
        nullif(v_patch->>'caregiver_name', ''),
        nullif(v_patch->>'caregiver_relationship', ''),
        nullif(v_patch->>'caregiver_email', ''),
        nullif(v_patch->>'caregiver_phone', ''),
        coalesce(nullif(v_patch->>'member_name', ''), nullif(trim(coalesce(p_member_display_name, '')), ''), 'Unknown Member'),
        nullif(v_patch->>'member_dob', '')::date,
        nullif(v_patch->>'lead_source', ''),
        nullif(v_patch->>'lead_source_other', ''),
        nullif(v_patch->>'partner_id', ''),
        nullif(v_patch->>'referral_source_id', ''),
        nullif(v_patch->>'referral_name', ''),
        nullif(v_patch->>'likelihood', ''),
        nullif(v_patch->>'next_follow_up_date', '')::date,
        nullif(v_patch->>'next_follow_up_type', ''),
        nullif(v_patch->>'notes_summary', ''),
        nullif(v_patch->>'lost_reason', ''),
        nullif(v_patch->>'closed_date', '')::date,
        p_created_by_user_id,
        coalesce(nullif(v_patch->>'updated_at', '')::timestamptz, p_now),
        v_idempotency_key
      )
      returning id into v_lead_id;
    exception
      when unique_violation then
        if v_idempotency_key is null then
          raise;
        end if;

        select l.id
        into v_lead_id
        from public.leads l
        where l.idempotency_key = v_idempotency_key
        order by l.created_at asc, l.id asc
        limit 1
        for update;

        if v_lead_id is null then
          raise;
        end if;
    end;
  end if;

  return query
  select transition.lead_id, transition.member_id, transition.from_stage, transition.to_stage, transition.from_status, transition.to_status, transition.business_status
  from public.apply_lead_stage_transition_with_member_upsert(
    p_lead_id => v_lead_id,
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
    p_existing_member_id => null,
    p_additional_lead_patch => '{}'::jsonb,
    p_now => p_now,
    p_today => p_today
  ) as transition;
end;
$$;

drop function if exists public.rpc_create_lead_with_member_conversion(
  text,
  text,
  text,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  date,
  date,
  jsonb,
  timestamptz,
  date
);

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
  p_idempotency_key text default null,
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
security definer
set search_path = public
as $$
declare
  v_created record;
  v_current_role public.app_role;
  v_current_profile_id uuid;
begin
  if auth.role() <> 'service_role' then
    v_current_role := public.current_role();
    v_current_profile_id := public.current_profile_id();

    if v_current_role is null or v_current_role not in ('admin', 'director', 'sales') then
      raise exception 'rpc_create_lead_with_member_conversion is not permitted for role %.', coalesce(v_current_role::text, 'unknown')
        using errcode = '42501';
    end if;

    if p_actor_user_id is null or v_current_profile_id is null or p_actor_user_id <> v_current_profile_id then
      raise exception 'rpc_create_lead_with_member_conversion requires p_actor_user_id to match the authenticated profile.'
        using errcode = '42501';
    end if;

    if p_created_by_user_id is null or p_created_by_user_id <> v_current_profile_id then
      raise exception 'rpc_create_lead_with_member_conversion requires p_created_by_user_id to match the authenticated profile.'
        using errcode = '42501';
    end if;
  end if;

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
    p_idempotency_key => p_idempotency_key,
    p_now => p_now,
    p_today => p_today
  ) as created;

  if v_created.member_id is null then
    raise exception 'Lead creation with conversion did not return a canonical member_id.';
  end if;

  perform 1 from public.member_command_centers where member_id = v_created.member_id;
  if not found then
    raise exception 'Lead creation with conversion did not persist member_command_centers for member %.', v_created.member_id;
  end if;

  perform 1 from public.member_attendance_schedules where member_id = v_created.member_id;
  if not found then
    raise exception 'Lead creation with conversion did not persist member_attendance_schedules for member %.', v_created.member_id;
  end if;

  perform 1 from public.member_health_profiles where member_id = v_created.member_id;
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

revoke all on function public.rpc_create_lead_with_member_conversion(
  text,
  text,
  text,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  date,
  date,
  jsonb,
  text,
  timestamptz,
  date
) from public, anon, authenticated, service_role;

grant execute on function public.rpc_create_lead_with_member_conversion(
  text,
  text,
  text,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  date,
  date,
  jsonb,
  text,
  timestamptz,
  date
) to authenticated, service_role;

create or replace function public.rpc_create_intake_assessment_with_responses(
  p_assessment jsonb,
  p_response_rows jsonb default '[]'::jsonb
)
returns setof public.intake_assessments
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_assessment public.intake_assessments%rowtype;
  v_creation_idempotency_key text := nullif(trim(coalesce(p_assessment ->> 'creation_idempotency_key', '')), '');
begin
  if p_assessment is null or jsonb_typeof(p_assessment) <> 'object' then
    raise exception 'p_assessment must be a JSON object';
  end if;
  if p_response_rows is not null and jsonb_typeof(p_response_rows) <> 'array' then
    raise exception 'p_response_rows must be a JSON array';
  end if;

  if v_creation_idempotency_key is not null then
    select *
    into v_assessment
    from public.intake_assessments
    where creation_idempotency_key = v_creation_idempotency_key
    order by created_at asc, id asc
    limit 1
    for update;

    if found then
      return next v_assessment;
      return;
    end if;
  end if;

  begin
    insert into public.intake_assessments (
      member_id,
      lead_id,
      assessment_date,
      status,
      completed_by_user_id,
      completed_by,
      signed_by,
      signed_by_user_id,
      signed_at,
      signature_status,
      signature_metadata,
      draft_pof_status,
      draft_pof_attempted_at,
      draft_pof_error,
      complete,
      feeling_today,
      health_lately,
      allergies,
      code_status,
      orientation_dob_verified,
      orientation_city_verified,
      orientation_year_verified,
      orientation_occupation_verified,
      orientation_notes,
      medication_management_status,
      dressing_support_status,
      assistive_devices,
      incontinence_products,
      on_site_medication_use,
      on_site_medication_list,
      independence_notes,
      diet_type,
      diet_other,
      diet_restrictions_notes,
      mobility_steadiness,
      falls_history,
      mobility_aids,
      mobility_safety_notes,
      overwhelmed_by_noise,
      social_triggers,
      emotional_wellness_notes,
      joy_sparks,
      personal_notes,
      score_orientation_general_health,
      score_daily_routines_independence,
      score_nutrition_dietary_needs,
      score_mobility_safety,
      score_social_emotional_wellness,
      total_score,
      recommended_track,
      admission_review_required,
      transport_can_enter_exit_vehicle,
      transport_assistance_level,
      transport_mobility_aid,
      transport_can_remain_seated_buckled,
      transport_behavior_concern,
      transport_appropriate,
      transport_notes,
      vitals_hr,
      vitals_bp,
      vitals_o2_percent,
      vitals_rr,
      notes,
      created_at,
      updated_at,
      creation_idempotency_key
    )
    values (
      (p_assessment->>'member_id')::uuid,
      nullif(trim(coalesce(p_assessment->>'lead_id', '')), '')::uuid,
      (p_assessment->>'assessment_date')::date,
      coalesce(nullif(trim(p_assessment->>'status'), ''), 'completed'),
      (p_assessment->>'completed_by_user_id')::uuid,
      p_assessment->>'completed_by',
      nullif(trim(coalesce(p_assessment->>'signed_by', '')), ''),
      nullif(trim(coalesce(p_assessment->>'signed_by_user_id', '')), '')::uuid,
      nullif(trim(coalesce(p_assessment->>'signed_at', '')), '')::timestamptz,
      coalesce(nullif(trim(p_assessment->>'signature_status'), ''), 'unsigned'),
      coalesce(p_assessment->'signature_metadata', '{}'::jsonb),
      coalesce(nullif(trim(p_assessment->>'draft_pof_status'), ''), 'pending'),
      nullif(trim(coalesce(p_assessment->>'draft_pof_attempted_at', '')), '')::timestamptz,
      nullif(trim(coalesce(p_assessment->>'draft_pof_error', '')), ''),
      coalesce((p_assessment->>'complete')::boolean, true),
      p_assessment->>'feeling_today',
      p_assessment->>'health_lately',
      p_assessment->>'allergies',
      p_assessment->>'code_status',
      coalesce((p_assessment->>'orientation_dob_verified')::boolean, false),
      coalesce((p_assessment->>'orientation_city_verified')::boolean, false),
      coalesce((p_assessment->>'orientation_year_verified')::boolean, false),
      coalesce((p_assessment->>'orientation_occupation_verified')::boolean, false),
      p_assessment->>'orientation_notes',
      p_assessment->>'medication_management_status',
      p_assessment->>'dressing_support_status',
      p_assessment->>'assistive_devices',
      p_assessment->>'incontinence_products',
      p_assessment->>'on_site_medication_use',
      p_assessment->>'on_site_medication_list',
      p_assessment->>'independence_notes',
      p_assessment->>'diet_type',
      p_assessment->>'diet_other',
      p_assessment->>'diet_restrictions_notes',
      p_assessment->>'mobility_steadiness',
      p_assessment->>'falls_history',
      p_assessment->>'mobility_aids',
      p_assessment->>'mobility_safety_notes',
      coalesce((p_assessment->>'overwhelmed_by_noise')::boolean, false),
      p_assessment->>'social_triggers',
      p_assessment->>'emotional_wellness_notes',
      p_assessment->>'joy_sparks',
      p_assessment->>'personal_notes',
      nullif(trim(coalesce(p_assessment->>'score_orientation_general_health', '')), '')::smallint,
      nullif(trim(coalesce(p_assessment->>'score_daily_routines_independence', '')), '')::smallint,
      nullif(trim(coalesce(p_assessment->>'score_nutrition_dietary_needs', '')), '')::smallint,
      nullif(trim(coalesce(p_assessment->>'score_mobility_safety', '')), '')::smallint,
      nullif(trim(coalesce(p_assessment->>'score_social_emotional_wellness', '')), '')::smallint,
      nullif(trim(coalesce(p_assessment->>'total_score', '')), '')::smallint,
      p_assessment->>'recommended_track',
      coalesce((p_assessment->>'admission_review_required')::boolean, false),
      p_assessment->>'transport_can_enter_exit_vehicle',
      p_assessment->>'transport_assistance_level',
      p_assessment->>'transport_mobility_aid',
      coalesce((p_assessment->>'transport_can_remain_seated_buckled')::boolean, false),
      p_assessment->>'transport_behavior_concern',
      coalesce((p_assessment->>'transport_appropriate')::boolean, false),
      p_assessment->>'transport_notes',
      nullif(trim(coalesce(p_assessment->>'vitals_hr', '')), '')::integer,
      p_assessment->>'vitals_bp',
      nullif(trim(coalesce(p_assessment->>'vitals_o2_percent', '')), '')::integer,
      nullif(trim(coalesce(p_assessment->>'vitals_rr', '')), '')::integer,
      p_assessment->>'notes',
      coalesce(nullif(trim(coalesce(p_assessment->>'created_at', '')), '')::timestamptz, now()),
      coalesce(nullif(trim(coalesce(p_assessment->>'updated_at', '')), '')::timestamptz, now()),
      v_creation_idempotency_key
    )
    returning * into v_assessment;
  exception
    when unique_violation then
      if v_creation_idempotency_key is null then
        raise;
      end if;

      select *
      into v_assessment
      from public.intake_assessments
      where creation_idempotency_key = v_creation_idempotency_key
      order by created_at asc, id asc
      limit 1
      for update;

      if not found then
        raise;
      end if;

      return next v_assessment;
      return;
  end;

  if p_response_rows is not null and jsonb_typeof(p_response_rows) = 'array' and jsonb_array_length(p_response_rows) > 0 then
    insert into public.assessment_responses (
      assessment_id,
      member_id,
      field_key,
      field_label,
      section_type,
      field_value,
      field_value_type,
      created_at
    )
    select
      v_assessment.id,
      v_assessment.member_id,
      row.field_key,
      row.field_label,
      row.section_type,
      row.field_value,
      row.field_value_type,
      coalesce(row.created_at, v_assessment.created_at, now())
    from jsonb_to_recordset(p_response_rows) as row(
      field_key text,
      field_label text,
      section_type text,
      field_value text,
      field_value_type text,
      created_at timestamptz
    );
  end if;

  return next v_assessment;
end;
$$;

create or replace function public.rpc_create_prn_medication_order_and_administer(
  p_member_id uuid,
  p_order_payload jsonb default '{}'::jsonb,
  p_admin_payload jsonb default '{}'::jsonb,
  p_actor_user_id uuid default null,
  p_actor_name text default null,
  p_now timestamptz default now()
)
returns table (
  medication_order_id uuid,
  log_id uuid,
  member_id uuid,
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
  v_order public.medication_orders%rowtype;
  v_requires_review boolean := coalesce((p_order_payload ->> 'requires_review')::boolean, true);
  v_requires_followup boolean := coalesce((p_order_payload ->> 'requires_effectiveness_followup')::boolean, true);
  v_creation_idempotency_key text := nullif(trim(coalesce(p_order_payload ->> 'creation_idempotency_key', '')), '');
begin
  if p_member_id is null then
    raise exception 'PRN medication order creation requires member_id';
  end if;
  if nullif(trim(coalesce(p_order_payload ->> 'medication_name', '')), '') is null then
    raise exception 'Medication name is required for new PRN orders.';
  end if;
  if nullif(trim(coalesce(p_order_payload ->> 'provider_name', '')), '') is null then
    raise exception 'Provider name is required for new PRN orders.';
  end if;
  if nullif(trim(coalesce(p_order_payload ->> 'directions', '')), '') is null then
    raise exception 'Directions are required for new PRN orders.';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_member_id::text)::bigint);

  if v_creation_idempotency_key is not null then
    select *
    into v_order
    from public.medication_orders
    where creation_idempotency_key = v_creation_idempotency_key
    order by created_at asc, id asc
    limit 1
    for update;
  end if;

  if v_order.id is null then
    begin
      insert into public.medication_orders (
        member_id,
        physician_order_id,
        pof_medication_id,
        source_medication_id,
        order_type,
        medication_name,
        strength,
        form,
        route,
        directions,
        prn_reason,
        frequency_text,
        min_interval_minutes,
        max_doses_per_24h,
        max_daily_dose,
        start_date,
        end_date,
        provider_name,
        order_source,
        status,
        created_by,
        verified_by,
        requires_review,
        requires_effectiveness_followup,
        created_by_name,
        verified_by_name,
        source_payload,
        created_at,
        updated_at,
        creation_idempotency_key
      )
      values (
        p_member_id,
        nullif(trim(coalesce(p_order_payload ->> 'physician_order_id', '')), '')::uuid,
        nullif(trim(coalesce(p_order_payload ->> 'pof_medication_id', '')), '')::uuid,
        nullif(trim(coalesce(p_order_payload ->> 'source_medication_id', '')), ''),
        'prn',
        nullif(trim(coalesce(p_order_payload ->> 'medication_name', '')), ''),
        nullif(trim(coalesce(p_order_payload ->> 'strength', '')), ''),
        nullif(trim(coalesce(p_order_payload ->> 'form', '')), ''),
        nullif(trim(coalesce(p_order_payload ->> 'route', '')), ''),
        nullif(trim(coalesce(p_order_payload ->> 'directions', '')), ''),
        nullif(trim(coalesce(p_order_payload ->> 'prn_reason', '')), ''),
        nullif(trim(coalesce(p_order_payload ->> 'frequency_text', '')), ''),
        nullif(trim(coalesce(p_order_payload ->> 'min_interval_minutes', '')), '')::integer,
        nullif(trim(coalesce(p_order_payload ->> 'max_doses_per_24h', '')), '')::integer,
        nullif(trim(coalesce(p_order_payload ->> 'max_daily_dose', '')), '')::numeric,
        nullif(trim(coalesce(p_order_payload ->> 'start_date', '')), '')::date,
        nullif(trim(coalesce(p_order_payload ->> 'end_date', '')), '')::date,
        nullif(trim(coalesce(p_order_payload ->> 'provider_name', '')), ''),
        'manual_provider_order',
        coalesce(nullif(trim(coalesce(p_order_payload ->> 'status', '')), ''), 'active'),
        p_actor_user_id,
        nullif(trim(coalesce(p_order_payload ->> 'verified_by', '')), '')::uuid,
        v_requires_review,
        v_requires_followup,
        nullif(trim(coalesce(p_actor_name, '')), ''),
        nullif(trim(coalesce(p_order_payload ->> 'verified_by_name', '')), ''),
        jsonb_build_object(
          'source', 'manual_provider_order',
          'order_payload', p_order_payload,
          'creation_idempotency_key', v_creation_idempotency_key
        ),
        v_now,
        v_now,
        v_creation_idempotency_key
      )
      returning * into v_order;
    exception
      when unique_violation then
        if v_creation_idempotency_key is null then
          raise;
        end if;

        select *
        into v_order
        from public.medication_orders
        where creation_idempotency_key = v_creation_idempotency_key
        order by created_at asc, id asc
        limit 1
        for update;

        if v_order.id is null then
          raise;
        end if;
    end;
  end if;

  select
    logged.medication_order_id,
    logged.log_id,
    logged.member_id,
    logged.followup_due_at,
    logged.followup_status,
    logged.duplicate_safe
  into
    medication_order_id,
    log_id,
    member_id,
    followup_due_at,
    followup_status,
    duplicate_safe
  from public.rpc_record_prn_medication_administration(
    v_order.id,
    nullif(trim(coalesce(p_admin_payload ->> 'admin_datetime', '')), '')::timestamptz,
    nullif(trim(coalesce(p_admin_payload ->> 'dose_given', '')), ''),
    nullif(trim(coalesce(p_admin_payload ->> 'route_given', '')), ''),
    nullif(trim(coalesce(p_admin_payload ->> 'indication', '')), ''),
    nullif(trim(coalesce(p_admin_payload ->> 'symptom_score_before', '')), '')::integer,
    nullif(trim(coalesce(p_admin_payload ->> 'followup_due_at', '')), '')::timestamptz,
    coalesce(nullif(trim(coalesce(p_admin_payload ->> 'status', '')), ''), 'Given'),
    nullif(trim(coalesce(p_admin_payload ->> 'notes', '')), ''),
    p_actor_user_id,
    nullif(trim(coalesce(p_actor_name, '')), ''),
    nullif(trim(coalesce(p_admin_payload ->> 'idempotency_key', '')), ''),
    v_now
  ) as logged;

  return next;
end;
$$;

drop function if exists public.rpc_complete_prn_administration_followup(
  uuid,
  text,
  text,
  timestamptz,
  timestamptz
);

create or replace function public.rpc_complete_prn_administration_followup(
  p_log_id uuid,
  p_effectiveness_result text,
  p_followup_notes text default null,
  p_assessed_at timestamptz default now(),
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
  v_assessed_at timestamptz := coalesce(p_assessed_at, v_now);
  v_followup_notes text := nullif(trim(coalesce(p_followup_notes, '')), '');
  v_existing public.med_administration_logs%rowtype;
begin
  if p_log_id is null then
    raise exception 'PRN follow-up requires log_id';
  end if;
  if p_effectiveness_result not in ('Effective', 'Ineffective') then
    raise exception 'PRN follow-up result must be Effective or Ineffective.';
  end if;
  if p_effectiveness_result = 'Ineffective' and v_followup_notes is null then
    raise exception 'Follow-up note is required when PRN outcome is Ineffective.';
  end if;

  select *
  into v_existing
  from public.med_administration_logs logs
  where logs.id = p_log_id
    and logs.admin_type = 'prn'
  for update;

  if not found then
    raise exception 'PRN follow-up can only be completed for existing PRN administrations.';
  end if;
  if v_existing.status <> 'Given' or v_existing.followup_status = 'not_required' then
    raise exception 'PRN follow-up can only be completed for given PRN administrations that require follow-up.';
  end if;

  if v_existing.followup_status = 'completed' then
    if coalesce(v_existing.effectiveness_result, '') = p_effectiveness_result
       and coalesce(v_existing.followup_notes, '') = coalesce(v_followup_notes, '') then
      log_id := v_existing.id;
      member_id := v_existing.member_id;
      medication_order_id := v_existing.medication_order_id;
      followup_due_at := v_existing.followup_due_at;
      followup_status := v_existing.followup_status;
      duplicate_safe := true;
      return next;
      return;
    end if;

    raise exception 'PRN follow-up has already been completed and cannot be overwritten.';
  end if;

  update public.med_administration_logs logs
  set
    followup_due_at = coalesce(logs.followup_due_at, v_assessed_at),
    followup_status = 'completed',
    effectiveness_result = p_effectiveness_result,
    followup_notes = v_followup_notes,
    updated_at = v_now
  where logs.id = p_log_id
    and logs.admin_type = 'prn'
    and logs.status = 'Given'
    and logs.followup_status in ('due', 'overdue')
  returning
    logs.id,
    logs.member_id,
    logs.medication_order_id,
    logs.followup_due_at,
    logs.followup_status
  into
    log_id,
    member_id,
    medication_order_id,
    followup_due_at,
    followup_status;

  if log_id is null then
    raise exception 'PRN follow-up can only be completed for due PRN administrations.';
  end if;

  duplicate_safe := false;
  return next;
end;
$$;

grant execute on function public.rpc_complete_prn_administration_followup(
  uuid,
  text,
  text,
  timestamptz,
  timestamptz
) to authenticated, service_role;

create or replace function public.rpc_create_billing_export(
  p_export_job jsonb,
  p_invoice_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_export_id uuid := nullif(p_export_job ->> 'id', '')::uuid;
  v_batch_id uuid := nullif(p_export_job ->> 'billing_batch_id', '')::uuid;
  v_now timestamptz := coalesce(nullif(p_export_job ->> 'updated_at', '')::timestamptz, now());
  v_idempotency_key text := nullif(trim(coalesce(p_export_job ->> 'idempotency_key', '')), '');
begin
  if v_export_id is null then
    raise exception 'billing export id is required';
  end if;
  if v_batch_id is null then
    raise exception 'billing batch id is required for export generation';
  end if;

  if v_idempotency_key is not null then
    select id
    into v_export_id
    from public.billing_export_jobs
    where idempotency_key = v_idempotency_key
    order by created_at asc, id asc
    limit 1;

    if found then
      return v_export_id;
    end if;
  end if;

  v_export_id := nullif(p_export_job ->> 'id', '')::uuid;

  begin
    insert into public.billing_export_jobs (
      id,
      billing_batch_id,
      export_type,
      quickbooks_detail_level,
      file_name,
      file_data_url,
      generated_at,
      generated_by,
      status,
      notes,
      created_at,
      updated_at,
      idempotency_key
    )
    values (
      v_export_id,
      v_batch_id,
      nullif(p_export_job ->> 'export_type', ''),
      coalesce(nullif(p_export_job ->> 'quickbooks_detail_level', ''), 'Summary'),
      nullif(p_export_job ->> 'file_name', ''),
      nullif(p_export_job ->> 'file_data_url', ''),
      coalesce(nullif(p_export_job ->> 'generated_at', '')::timestamptz, now()),
      nullif(p_export_job ->> 'generated_by', ''),
      coalesce(nullif(p_export_job ->> 'status', ''), 'Generated'),
      nullif(p_export_job ->> 'notes', ''),
      coalesce(nullif(p_export_job ->> 'created_at', '')::timestamptz, now()),
      v_now,
      v_idempotency_key
    );
  exception
    when unique_violation then
      if v_idempotency_key is null then
        raise;
      end if;

      select id
      into v_export_id
      from public.billing_export_jobs
      where idempotency_key = v_idempotency_key
      order by created_at asc, id asc
      limit 1;

      if found then
        return v_export_id;
      end if;

      raise;
  end;

  update public.billing_batches
  set
    batch_status = 'Exported',
    updated_at = v_now
  where id = v_batch_id;
  if not found then
    raise exception 'billing batch % was not found for export generation', v_batch_id;
  end if;

  update public.billing_invoices
  set
    export_status = 'Exported',
    updated_at = v_now
  where id = any(coalesce(p_invoice_ids, array[]::uuid[]));

  return v_export_id;
end;
$$;
