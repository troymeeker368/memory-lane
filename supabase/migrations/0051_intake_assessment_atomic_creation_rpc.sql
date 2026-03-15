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
begin
  if p_assessment is null or jsonb_typeof(p_assessment) <> 'object' then
    raise exception 'p_assessment must be a JSON object';
  end if;
  if p_response_rows is not null and jsonb_typeof(p_response_rows) <> 'array' then
    raise exception 'p_response_rows must be a JSON array';
  end if;

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
    updated_at
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
    coalesce(nullif(trim(coalesce(p_assessment->>'updated_at', '')), '')::timestamptz, now())
  )
  returning * into v_assessment;

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

grant execute on function public.rpc_create_intake_assessment_with_responses(jsonb, jsonb) to authenticated, service_role;
