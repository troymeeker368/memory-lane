-- Enforce canonical Member Command Center shell provisioning.
-- Runtime reads/writes must fail when canonical shells are missing instead of creating them on demand.

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

  perform 1
  from public.member_command_centers
  where member_id = p_member_id
  for update;
  if not found then
    raise exception 'Missing canonical member_command_centers row for member %. Provision Member Command Center shells via canonical lifecycle or explicit repair before prefill.', p_member_id;
  end if;

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
  from public.member_command_centers as mcc
  where mcc.member_id = p_member_id;
end;
$$;

create or replace function public.rpc_update_member_command_center_bundle(
  p_member_id uuid,
  p_mcc_patch jsonb default '{}'::jsonb,
  p_member_patch jsonb default '{}'::jsonb,
  p_actor_user_id uuid default null,
  p_actor_name text default null,
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
  v_mcc_patch public.member_command_centers%rowtype;
  v_member_patch public.members%rowtype;
begin
  if p_member_id is null then
    raise exception 'rpc_update_member_command_center_bundle requires p_member_id';
  end if;

  perform 1
  from public.members
  where id = p_member_id
  for update;
  if not found then
    raise exception 'Member % not found', p_member_id;
  end if;

  perform 1
  from public.member_command_centers
  where member_id = p_member_id
  for update;
  if not found then
    raise exception 'Missing canonical member_command_centers row for member %. Provision Member Command Center shells via canonical lifecycle or explicit repair before saving.', p_member_id;
  end if;

  select *
  into v_mcc_patch
  from jsonb_populate_record(null::public.member_command_centers, coalesce(p_mcc_patch, '{}'::jsonb));

  update public.member_command_centers
  set
    payor = case when p_mcc_patch ? 'payor' then v_mcc_patch.payor else payor end,
    original_referral_source = case when p_mcc_patch ? 'original_referral_source' then v_mcc_patch.original_referral_source else original_referral_source end,
    photo_consent = case when p_mcc_patch ? 'photo_consent' then v_mcc_patch.photo_consent else photo_consent end,
    location = case when p_mcc_patch ? 'location' then v_mcc_patch.location else location end,
    profile_image_url = case when p_mcc_patch ? 'profile_image_url' then v_mcc_patch.profile_image_url else profile_image_url end,
    gender = case when p_mcc_patch ? 'gender' then v_mcc_patch.gender else gender end,
    street_address = case when p_mcc_patch ? 'street_address' then v_mcc_patch.street_address else street_address end,
    city = case when p_mcc_patch ? 'city' then v_mcc_patch.city else city end,
    state = case when p_mcc_patch ? 'state' then v_mcc_patch.state else state end,
    zip = case when p_mcc_patch ? 'zip' then v_mcc_patch.zip else zip end,
    marital_status = case when p_mcc_patch ? 'marital_status' then v_mcc_patch.marital_status else marital_status end,
    primary_language = case when p_mcc_patch ? 'primary_language' then v_mcc_patch.primary_language else primary_language end,
    secondary_language = case when p_mcc_patch ? 'secondary_language' then v_mcc_patch.secondary_language else secondary_language end,
    religion = case when p_mcc_patch ? 'religion' then v_mcc_patch.religion else religion end,
    ethnicity = case when p_mcc_patch ? 'ethnicity' then v_mcc_patch.ethnicity else ethnicity end,
    is_veteran = case when p_mcc_patch ? 'is_veteran' then v_mcc_patch.is_veteran else is_veteran end,
    veteran_branch = case when p_mcc_patch ? 'veteran_branch' then v_mcc_patch.veteran_branch else veteran_branch end,
    code_status = case when p_mcc_patch ? 'code_status' then v_mcc_patch.code_status else code_status end,
    dnr = case when p_mcc_patch ? 'dnr' then v_mcc_patch.dnr else dnr end,
    dni = case when p_mcc_patch ? 'dni' then v_mcc_patch.dni else dni end,
    polst_molst_colst = case when p_mcc_patch ? 'polst_molst_colst' then v_mcc_patch.polst_molst_colst else polst_molst_colst end,
    hospice = case when p_mcc_patch ? 'hospice' then v_mcc_patch.hospice else hospice end,
    advanced_directives_obtained = case when p_mcc_patch ? 'advanced_directives_obtained' then v_mcc_patch.advanced_directives_obtained else advanced_directives_obtained end,
    power_of_attorney = case when p_mcc_patch ? 'power_of_attorney' then v_mcc_patch.power_of_attorney else power_of_attorney end,
    legal_comments = case when p_mcc_patch ? 'legal_comments' then v_mcc_patch.legal_comments else legal_comments end,
    diet_type = case when p_mcc_patch ? 'diet_type' then v_mcc_patch.diet_type else diet_type end,
    dietary_preferences_restrictions = case when p_mcc_patch ? 'dietary_preferences_restrictions' then v_mcc_patch.dietary_preferences_restrictions else dietary_preferences_restrictions end,
    swallowing_difficulty = case when p_mcc_patch ? 'swallowing_difficulty' then v_mcc_patch.swallowing_difficulty else swallowing_difficulty end,
    supplements = case when p_mcc_patch ? 'supplements' then v_mcc_patch.supplements else supplements end,
    food_dislikes = case when p_mcc_patch ? 'food_dislikes' then v_mcc_patch.food_dislikes else food_dislikes end,
    foods_to_omit = case when p_mcc_patch ? 'foods_to_omit' then v_mcc_patch.foods_to_omit else foods_to_omit end,
    diet_texture = case when p_mcc_patch ? 'diet_texture' then v_mcc_patch.diet_texture else diet_texture end,
    command_center_notes = case when p_mcc_patch ? 'command_center_notes' then v_mcc_patch.command_center_notes else command_center_notes end,
    updated_by_user_id = p_actor_user_id,
    updated_by_name = nullif(trim(coalesce(p_actor_name, '')), ''),
    updated_at = v_now
  where member_id = p_member_id;

  select *
  into v_member_patch
  from jsonb_populate_record(null::public.members, coalesce(p_member_patch, '{}'::jsonb));

  update public.members
  set
    locker_number = case when p_member_patch ? 'locker_number' then v_member_patch.locker_number else locker_number end,
    city = case when p_member_patch ? 'city' then v_member_patch.city else city end,
    display_name = case when p_member_patch ? 'display_name' then v_member_patch.display_name else display_name end,
    dob = case when p_member_patch ? 'dob' then v_member_patch.dob else dob end,
    enrollment_date = case when p_member_patch ? 'enrollment_date' then v_member_patch.enrollment_date else enrollment_date end,
    code_status = case when p_member_patch ? 'code_status' then v_member_patch.code_status else code_status end
  where id = p_member_id;

  return query
  select id
  from public.member_command_centers
  where member_id = p_member_id;
end;
$$;

create or replace function public.rpc_save_member_command_center_attendance_billing(
  p_member_id uuid,
  p_schedule_patch jsonb,
  p_member_patch jsonb default '{}'::jsonb,
  p_billing_payload jsonb default '{}'::jsonb,
  p_template_payload jsonb default '{}'::jsonb,
  p_actor_user_id uuid default null,
  p_actor_name text default null,
  p_now timestamptz default now()
)
returns table (
  attendance_schedule_id text,
  billing_setting_id text,
  billing_schedule_template_id text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_member public.members%rowtype;
  v_schedule_patch public.member_attendance_schedules%rowtype;
  v_member_patch public.members%rowtype;
  v_billing_patch public.member_billing_settings%rowtype;
  v_template_patch public.billing_schedule_templates%rowtype;
  v_schedule_id text;
  v_billing_id text;
  v_template_id text;
begin
  if p_member_id is null then
    raise exception 'rpc_save_member_command_center_attendance_billing requires p_member_id';
  end if;

  select *
  into v_member
  from public.members
  where id = p_member_id
  for update;
  if not found then
    raise exception 'Member % not found', p_member_id;
  end if;

  select id
  into v_schedule_id
  from public.member_attendance_schedules
  where member_id = p_member_id
  for update;
  if v_schedule_id is null then
    raise exception 'Missing canonical member_attendance_schedules row for member %. Provision Member Command Center shells via canonical lifecycle or explicit repair before saving.', p_member_id;
  end if;

  select * into v_schedule_patch
  from jsonb_populate_record(null::public.member_attendance_schedules, coalesce(p_schedule_patch, '{}'::jsonb));

  update public.member_attendance_schedules
  set
    enrollment_date = v_schedule_patch.enrollment_date,
    monday = v_schedule_patch.monday,
    tuesday = v_schedule_patch.tuesday,
    wednesday = v_schedule_patch.wednesday,
    thursday = v_schedule_patch.thursday,
    friday = v_schedule_patch.friday,
    full_day = v_schedule_patch.full_day,
    transport_monday_period = v_schedule_patch.transport_monday_period,
    transport_tuesday_period = v_schedule_patch.transport_tuesday_period,
    transport_wednesday_period = v_schedule_patch.transport_wednesday_period,
    transport_thursday_period = v_schedule_patch.transport_thursday_period,
    transport_friday_period = v_schedule_patch.transport_friday_period,
    transport_monday_am_mode = v_schedule_patch.transport_monday_am_mode,
    transport_monday_am_door_to_door_address = v_schedule_patch.transport_monday_am_door_to_door_address,
    transport_monday_am_bus_number = v_schedule_patch.transport_monday_am_bus_number,
    transport_monday_am_bus_stop = v_schedule_patch.transport_monday_am_bus_stop,
    transport_monday_pm_mode = v_schedule_patch.transport_monday_pm_mode,
    transport_monday_pm_door_to_door_address = v_schedule_patch.transport_monday_pm_door_to_door_address,
    transport_monday_pm_bus_number = v_schedule_patch.transport_monday_pm_bus_number,
    transport_monday_pm_bus_stop = v_schedule_patch.transport_monday_pm_bus_stop,
    transport_tuesday_am_mode = v_schedule_patch.transport_tuesday_am_mode,
    transport_tuesday_am_door_to_door_address = v_schedule_patch.transport_tuesday_am_door_to_door_address,
    transport_tuesday_am_bus_number = v_schedule_patch.transport_tuesday_am_bus_number,
    transport_tuesday_am_bus_stop = v_schedule_patch.transport_tuesday_am_bus_stop,
    transport_tuesday_pm_mode = v_schedule_patch.transport_tuesday_pm_mode,
    transport_tuesday_pm_door_to_door_address = v_schedule_patch.transport_tuesday_pm_door_to_door_address,
    transport_tuesday_pm_bus_number = v_schedule_patch.transport_tuesday_pm_bus_number,
    transport_tuesday_pm_bus_stop = v_schedule_patch.transport_tuesday_pm_bus_stop,
    transport_wednesday_am_mode = v_schedule_patch.transport_wednesday_am_mode,
    transport_wednesday_am_door_to_door_address = v_schedule_patch.transport_wednesday_am_door_to_door_address,
    transport_wednesday_am_bus_number = v_schedule_patch.transport_wednesday_am_bus_number,
    transport_wednesday_am_bus_stop = v_schedule_patch.transport_wednesday_am_bus_stop,
    transport_wednesday_pm_mode = v_schedule_patch.transport_wednesday_pm_mode,
    transport_wednesday_pm_door_to_door_address = v_schedule_patch.transport_wednesday_pm_door_to_door_address,
    transport_wednesday_pm_bus_number = v_schedule_patch.transport_wednesday_pm_bus_number,
    transport_wednesday_pm_bus_stop = v_schedule_patch.transport_wednesday_pm_bus_stop,
    transport_thursday_am_mode = v_schedule_patch.transport_thursday_am_mode,
    transport_thursday_am_door_to_door_address = v_schedule_patch.transport_thursday_am_door_to_door_address,
    transport_thursday_am_bus_number = v_schedule_patch.transport_thursday_am_bus_number,
    transport_thursday_am_bus_stop = v_schedule_patch.transport_thursday_am_bus_stop,
    transport_thursday_pm_mode = v_schedule_patch.transport_thursday_pm_mode,
    transport_thursday_pm_door_to_door_address = v_schedule_patch.transport_thursday_pm_door_to_door_address,
    transport_thursday_pm_bus_number = v_schedule_patch.transport_thursday_pm_bus_number,
    transport_thursday_pm_bus_stop = v_schedule_patch.transport_thursday_pm_bus_stop,
    transport_friday_am_mode = v_schedule_patch.transport_friday_am_mode,
    transport_friday_am_door_to_door_address = v_schedule_patch.transport_friday_am_door_to_door_address,
    transport_friday_am_bus_number = v_schedule_patch.transport_friday_am_bus_number,
    transport_friday_am_bus_stop = v_schedule_patch.transport_friday_am_bus_stop,
    transport_friday_pm_mode = v_schedule_patch.transport_friday_pm_mode,
    transport_friday_pm_door_to_door_address = v_schedule_patch.transport_friday_pm_door_to_door_address,
    transport_friday_pm_bus_number = v_schedule_patch.transport_friday_pm_bus_number,
    transport_friday_pm_bus_stop = v_schedule_patch.transport_friday_pm_bus_stop,
    daily_rate = v_schedule_patch.daily_rate,
    transportation_billing_status = v_schedule_patch.transportation_billing_status,
    billing_rate_effective_date = v_schedule_patch.billing_rate_effective_date,
    billing_notes = v_schedule_patch.billing_notes,
    attendance_days_per_week = v_schedule_patch.attendance_days_per_week,
    default_daily_rate = v_schedule_patch.default_daily_rate,
    use_custom_daily_rate = v_schedule_patch.use_custom_daily_rate,
    custom_daily_rate = v_schedule_patch.custom_daily_rate,
    make_up_days_available = v_schedule_patch.make_up_days_available,
    attendance_notes = v_schedule_patch.attendance_notes,
    updated_by_user_id = p_actor_user_id,
    updated_by_name = nullif(trim(coalesce(p_actor_name, '')), ''),
    updated_at = v_now
  where id = v_schedule_id;

  select * into v_member_patch
  from jsonb_populate_record(null::public.members, coalesce(p_member_patch, '{}'::jsonb));

  update public.members
  set
    enrollment_date = case when p_member_patch ? 'enrollment_date' then v_member_patch.enrollment_date else enrollment_date end
  where id = p_member_id;

  select * into v_billing_patch
  from jsonb_populate_record(null::public.member_billing_settings, coalesce(p_billing_payload, '{}'::jsonb));
  v_billing_id := nullif(coalesce(p_billing_payload ->> 'id', ''), '');
  if v_billing_id is null then
    v_billing_id := 'member-billing-' || replace(gen_random_uuid()::text, '-', '');
    insert into public.member_billing_settings (
      id, member_id, payor_id, use_center_default_billing_mode, billing_mode, monthly_billing_basis,
      use_center_default_rate, custom_daily_rate, flat_monthly_rate, bill_extra_days,
      transportation_billing_status, bill_ancillary_arrears, active, effective_start_date, effective_end_date,
      billing_notes, updated_by_user_id, updated_by_name, created_at, updated_at
    )
    values (
      v_billing_id, p_member_id, v_billing_patch.payor_id, coalesce(v_billing_patch.use_center_default_billing_mode, true),
      v_billing_patch.billing_mode, coalesce(v_billing_patch.monthly_billing_basis, 'ScheduledMonthBehind'),
      coalesce(v_billing_patch.use_center_default_rate, false), v_billing_patch.custom_daily_rate, v_billing_patch.flat_monthly_rate,
      coalesce(v_billing_patch.bill_extra_days, true), coalesce(v_billing_patch.transportation_billing_status, 'BillNormally'),
      coalesce(v_billing_patch.bill_ancillary_arrears, true), coalesce(v_billing_patch.active, true),
      v_billing_patch.effective_start_date, v_billing_patch.effective_end_date, v_billing_patch.billing_notes,
      p_actor_user_id, nullif(trim(coalesce(p_actor_name, '')), ''), v_now, v_now
    );
  else
    update public.member_billing_settings
    set
      payor_id = v_billing_patch.payor_id,
      use_center_default_billing_mode = coalesce(v_billing_patch.use_center_default_billing_mode, true),
      billing_mode = v_billing_patch.billing_mode,
      monthly_billing_basis = coalesce(v_billing_patch.monthly_billing_basis, 'ScheduledMonthBehind'),
      use_center_default_rate = coalesce(v_billing_patch.use_center_default_rate, false),
      custom_daily_rate = v_billing_patch.custom_daily_rate,
      flat_monthly_rate = v_billing_patch.flat_monthly_rate,
      bill_extra_days = coalesce(v_billing_patch.bill_extra_days, true),
      transportation_billing_status = coalesce(v_billing_patch.transportation_billing_status, 'BillNormally'),
      bill_ancillary_arrears = coalesce(v_billing_patch.bill_ancillary_arrears, true),
      active = coalesce(v_billing_patch.active, true),
      effective_start_date = v_billing_patch.effective_start_date,
      effective_end_date = v_billing_patch.effective_end_date,
      billing_notes = v_billing_patch.billing_notes,
      updated_by_user_id = p_actor_user_id,
      updated_by_name = nullif(trim(coalesce(p_actor_name, '')), ''),
      updated_at = v_now
    where id = v_billing_id;
  end if;

  select * into v_template_patch
  from jsonb_populate_record(null::public.billing_schedule_templates, coalesce(p_template_payload, '{}'::jsonb));
  v_template_id := nullif(coalesce(p_template_payload ->> 'id', ''), '');
  if v_template_id is null then
    v_template_id := 'schedule-template-' || replace(gen_random_uuid()::text, '-', '');
    insert into public.billing_schedule_templates (
      id, member_id, effective_start_date, effective_end_date, monday, tuesday, wednesday, thursday, friday,
      saturday, sunday, active, notes, updated_by_user_id, updated_by_name, created_at, updated_at
    )
    values (
      v_template_id, p_member_id, v_template_patch.effective_start_date, v_template_patch.effective_end_date,
      coalesce(v_template_patch.monday, false), coalesce(v_template_patch.tuesday, false), coalesce(v_template_patch.wednesday, false),
      coalesce(v_template_patch.thursday, false), coalesce(v_template_patch.friday, false), coalesce(v_template_patch.saturday, false),
      coalesce(v_template_patch.sunday, false), coalesce(v_template_patch.active, true), v_template_patch.notes,
      p_actor_user_id, nullif(trim(coalesce(p_actor_name, '')), ''), v_now, v_now
    );
  else
    update public.billing_schedule_templates
    set
      effective_start_date = v_template_patch.effective_start_date,
      effective_end_date = v_template_patch.effective_end_date,
      monday = coalesce(v_template_patch.monday, false),
      tuesday = coalesce(v_template_patch.tuesday, false),
      wednesday = coalesce(v_template_patch.wednesday, false),
      thursday = coalesce(v_template_patch.thursday, false),
      friday = coalesce(v_template_patch.friday, false),
      saturday = coalesce(v_template_patch.saturday, false),
      sunday = coalesce(v_template_patch.sunday, false),
      active = coalesce(v_template_patch.active, true),
      notes = v_template_patch.notes,
      updated_by_user_id = p_actor_user_id,
      updated_by_name = nullif(trim(coalesce(p_actor_name, '')), ''),
      updated_at = v_now
    where id = v_template_id;
  end if;

  attendance_schedule_id := v_schedule_id;
  billing_setting_id := v_billing_id;
  billing_schedule_template_id := v_template_id;
  return next;
end;
$$;

create or replace function public.rpc_save_member_command_center_transportation(
  p_member_id uuid,
  p_schedule_patch jsonb,
  p_bus_stop_names jsonb default '[]'::jsonb,
  p_actor_user_id uuid default null,
  p_actor_name text default null,
  p_now timestamptz default now()
)
returns table (
  attendance_schedule_id text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_member public.members%rowtype;
  v_schedule_patch public.member_attendance_schedules%rowtype;
  v_schedule_id text;
  v_name text;
begin
  if p_member_id is null then
    raise exception 'rpc_save_member_command_center_transportation requires p_member_id';
  end if;

  select *
  into v_member
  from public.members
  where id = p_member_id
  for update;
  if not found then
    raise exception 'Member % not found', p_member_id;
  end if;

  select id into v_schedule_id
  from public.member_attendance_schedules
  where member_id = p_member_id
  for update;
  if v_schedule_id is null then
    raise exception 'Missing canonical member_attendance_schedules row for member %. Provision Member Command Center shells via canonical lifecycle or explicit repair before saving.', p_member_id;
  end if;

  select * into v_schedule_patch
  from jsonb_populate_record(null::public.member_attendance_schedules, coalesce(p_schedule_patch, '{}'::jsonb));

  update public.member_attendance_schedules
  set
    transportation_required = v_schedule_patch.transportation_required,
    transportation_mode = v_schedule_patch.transportation_mode,
    transport_bus_number = v_schedule_patch.transport_bus_number,
    transportation_bus_stop = v_schedule_patch.transportation_bus_stop,
    transport_monday_period = v_schedule_patch.transport_monday_period,
    transport_tuesday_period = v_schedule_patch.transport_tuesday_period,
    transport_wednesday_period = v_schedule_patch.transport_wednesday_period,
    transport_thursday_period = v_schedule_patch.transport_thursday_period,
    transport_friday_period = v_schedule_patch.transport_friday_period,
    transport_monday_am_mode = v_schedule_patch.transport_monday_am_mode,
    transport_monday_am_door_to_door_address = v_schedule_patch.transport_monday_am_door_to_door_address,
    transport_monday_am_bus_number = v_schedule_patch.transport_monday_am_bus_number,
    transport_monday_am_bus_stop = v_schedule_patch.transport_monday_am_bus_stop,
    transport_monday_pm_mode = v_schedule_patch.transport_monday_pm_mode,
    transport_monday_pm_door_to_door_address = v_schedule_patch.transport_monday_pm_door_to_door_address,
    transport_monday_pm_bus_number = v_schedule_patch.transport_monday_pm_bus_number,
    transport_monday_pm_bus_stop = v_schedule_patch.transport_monday_pm_bus_stop,
    transport_tuesday_am_mode = v_schedule_patch.transport_tuesday_am_mode,
    transport_tuesday_am_door_to_door_address = v_schedule_patch.transport_tuesday_am_door_to_door_address,
    transport_tuesday_am_bus_number = v_schedule_patch.transport_tuesday_am_bus_number,
    transport_tuesday_am_bus_stop = v_schedule_patch.transport_tuesday_am_bus_stop,
    transport_tuesday_pm_mode = v_schedule_patch.transport_tuesday_pm_mode,
    transport_tuesday_pm_door_to_door_address = v_schedule_patch.transport_tuesday_pm_door_to_door_address,
    transport_tuesday_pm_bus_number = v_schedule_patch.transport_tuesday_pm_bus_number,
    transport_tuesday_pm_bus_stop = v_schedule_patch.transport_tuesday_pm_bus_stop,
    transport_wednesday_am_mode = v_schedule_patch.transport_wednesday_am_mode,
    transport_wednesday_am_door_to_door_address = v_schedule_patch.transport_wednesday_am_door_to_door_address,
    transport_wednesday_am_bus_number = v_schedule_patch.transport_wednesday_am_bus_number,
    transport_wednesday_am_bus_stop = v_schedule_patch.transport_wednesday_am_bus_stop,
    transport_wednesday_pm_mode = v_schedule_patch.transport_wednesday_pm_mode,
    transport_wednesday_pm_door_to_door_address = v_schedule_patch.transport_wednesday_pm_door_to_door_address,
    transport_wednesday_pm_bus_number = v_schedule_patch.transport_wednesday_pm_bus_number,
    transport_wednesday_pm_bus_stop = v_schedule_patch.transport_wednesday_pm_bus_stop,
    transport_thursday_am_mode = v_schedule_patch.transport_thursday_am_mode,
    transport_thursday_am_door_to_door_address = v_schedule_patch.transport_thursday_am_door_to_door_address,
    transport_thursday_am_bus_number = v_schedule_patch.transport_thursday_am_bus_number,
    transport_thursday_am_bus_stop = v_schedule_patch.transport_thursday_am_bus_stop,
    transport_thursday_pm_mode = v_schedule_patch.transport_thursday_pm_mode,
    transport_thursday_pm_door_to_door_address = v_schedule_patch.transport_thursday_pm_door_to_door_address,
    transport_thursday_pm_bus_number = v_schedule_patch.transport_thursday_pm_bus_number,
    transport_thursday_pm_bus_stop = v_schedule_patch.transport_thursday_pm_bus_stop,
    transport_friday_am_mode = v_schedule_patch.transport_friday_am_mode,
    transport_friday_am_door_to_door_address = v_schedule_patch.transport_friday_am_door_to_door_address,
    transport_friday_am_bus_number = v_schedule_patch.transport_friday_am_bus_number,
    transport_friday_am_bus_stop = v_schedule_patch.transport_friday_am_bus_stop,
    transport_friday_pm_mode = v_schedule_patch.transport_friday_pm_mode,
    transport_friday_pm_door_to_door_address = v_schedule_patch.transport_friday_pm_door_to_door_address,
    transport_friday_pm_bus_number = v_schedule_patch.transport_friday_pm_bus_number,
    transport_friday_pm_bus_stop = v_schedule_patch.transport_friday_pm_bus_stop,
    updated_by_user_id = p_actor_user_id,
    updated_by_name = nullif(trim(coalesce(p_actor_name, '')), ''),
    updated_at = v_now
  where id = v_schedule_id;

  if jsonb_typeof(coalesce(p_bus_stop_names, '[]'::jsonb)) = 'array' then
    for v_name in select nullif(trim(value), '') from jsonb_array_elements_text(coalesce(p_bus_stop_names, '[]'::jsonb))
    loop
      if v_name is null then
        continue;
      end if;
      insert into public.bus_stop_directory (
        id, bus_stop_name, created_by_user_id, created_by_name, created_at, updated_at
      )
      values (
        'bus-stop-' || replace(gen_random_uuid()::text, '-', ''), v_name, p_actor_user_id,
        nullif(trim(coalesce(p_actor_name, '')), ''), v_now, v_now
      )
      on conflict ((lower(btrim(bus_stop_name))))
      do update
      set bus_stop_name = excluded.bus_stop_name, updated_at = excluded.updated_at;
    end loop;
  end if;

  attendance_schedule_id := v_schedule_id;
  return next;
end;
$$;

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
  on conflict do nothing;

  perform 1
  from public.member_command_centers
  where member_id = p_member_id
  for update;
  if not found then
    raise exception 'Missing canonical member_command_centers row for member %. Provision Member Command Center shells via canonical lifecycle or explicit repair before syncing.', p_member_id;
  end if;

  update public.member_command_centers as mcc
  set
    gender = case
      when lower(trim(coalesce(mhp.gender, ''))) in ('m', 'male') then 'M'
      when lower(trim(coalesce(mhp.gender, ''))) in ('f', 'female') then 'F'
      else null
    end,
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
  from public.member_health_profiles as mhp
  where mhp.member_id = p_member_id
    and mcc.member_id = p_member_id;

  update public.members as m
  set code_status = mhp.code_status
  from public.member_health_profiles as mhp
  where mhp.member_id = p_member_id
    and m.id = p_member_id
    and nullif(trim(coalesce(mhp.code_status, '')), '') is not null;

  return query
  select
    p_member_id as member_id,
    mhp.id as member_health_profile_id,
    mcc.id as member_command_center_id
  from public.member_health_profiles as mhp
  join public.member_command_centers as mcc
    on mcc.member_id = mhp.member_id
  where mhp.member_id = p_member_id;
end;
$$;

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
  v_code_status text;
  v_mhp_operational_flags jsonb;
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
  v_code_status := case when coalesce(v_order.dnr_selected, false) then 'DNR' else 'Full Code' end;
  v_mhp_operational_flags := coalesce(v_order.operational_flags, '{}'::jsonb) || jsonb_build_object('dnr', coalesce(v_order.dnr_selected, false));

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
    code_status,
    dnr,
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
    v_mhp_operational_flags,
    nullif(trim(coalesce(v_order.clinical_support -> 'orientationProfile' ->> 'cognitiveBehaviorComments', '')), ''),
    nullif(trim(coalesce(v_order.clinical_support ->> 'joySparksNotes', '')), ''),
    v_code_status,
    coalesce(v_order.dnr_selected, false),
    v_now,
    v_now
  )
  on conflict on constraint member_health_profiles_member_id_key
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
    code_status = excluded.code_status,
    dnr = excluded.dnr,
    last_synced_at = excluded.last_synced_at,
    updated_at = excluded.updated_at;

  delete from public.member_diagnoses as member_diagnoses where member_diagnoses.member_id = v_order.member_id;
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
  from jsonb_array_elements(coalesce(v_order.diagnoses, '[]'::jsonb)) as item
  where nullif(trim(coalesce(item ->> 'diagnosisName', '')), '') is not null;

  delete from public.member_medications as member_medications where member_medications.member_id = v_order.member_id;
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
  from jsonb_array_elements(coalesce(v_order.medications, '[]'::jsonb)) as item
  where nullif(trim(coalesce(item ->> 'name', '')), '') is not null;

  delete from public.member_allergies as member_allergies where member_allergies.member_id = v_order.member_id;
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
  from jsonb_array_elements(coalesce(v_order.allergies, '[]'::jsonb)) as item
  where nullif(trim(coalesce(item ->> 'allergyName', '')), '') is not null;

  perform 1
  from public.member_command_centers
  where member_id = v_order.member_id
  for update;
  if not found then
    raise exception 'Missing canonical member_command_centers row for member %. Provision Member Command Center shells via canonical lifecycle or explicit repair before signed POF sync.', v_order.member_id;
  end if;

  select string_agg(member_allergies.allergy_name, ', ' order by member_allergies.allergy_name)
  into v_food_allergies
  from public.member_allergies as member_allergies
  where member_allergies.member_id = v_order.member_id
    and member_allergies.allergy_group = 'food';

  select string_agg(member_allergies.allergy_name, ', ' order by member_allergies.allergy_name)
  into v_medication_allergies
  from public.member_allergies as member_allergies
  where member_allergies.member_id = v_order.member_id
    and member_allergies.allergy_group = 'medication';

  select string_agg(member_allergies.allergy_name, ', ' order by member_allergies.allergy_name)
  into v_environmental_allergies
  from public.member_allergies as member_allergies
  where member_allergies.member_id = v_order.member_id
    and member_allergies.allergy_group = 'environmental';

  update public.member_command_centers as member_command_centers
  set
    code_status = v_code_status,
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
      select 1 from public.member_allergies as member_allergies where member_allergies.member_id = v_order.member_id
    ),
    medication_allergies = nullif(coalesce(v_medication_allergies, ''), ''),
    food_allergies = nullif(coalesce(v_food_allergies, ''), ''),
    environmental_allergies = nullif(coalesce(v_environmental_allergies, ''), ''),
    source_assessment_id = v_order.intake_assessment_id,
    source_assessment_at = (v_order.signed_at at time zone 'America/New_York')::date,
    updated_by_user_id = v_actor_user_id,
    updated_by_name = v_actor_name,
    updated_at = v_now
  where member_command_centers.member_id = v_order.member_id;

  return query
  select
    v_order.member_id,
    member_health_profiles.id,
    member_command_centers.id
  from public.member_health_profiles as member_health_profiles
  left join public.member_command_centers as member_command_centers
    on member_command_centers.member_id = member_health_profiles.member_id
  where member_health_profiles.member_id = v_order.member_id;
end;
$$;

create or replace function public.rpc_save_schedule_change_with_attendance_sync(
  p_schedule_change_id text default null,
  p_member_id uuid default null,
  p_change_type text default null,
  p_effective_start_date date default null,
  p_effective_end_date date default null,
  p_original_days text[] default '{}'::text[],
  p_new_days text[] default '{}'::text[],
  p_suspend_base_schedule boolean default false,
  p_reason text default null,
  p_notes text default null,
  p_entered_by text default null,
  p_entered_by_user_id uuid default null,
  p_actor_user_id uuid default null,
  p_actor_name text default null,
  p_now timestamptz default now()
)
returns table (
  id text,
  member_id uuid,
  change_type text,
  effective_start_date date,
  effective_end_date date,
  original_days text[],
  new_days text[],
  suspend_base_schedule boolean,
  reason text,
  notes text,
  entered_by text,
  entered_by_user_id uuid,
  status text,
  created_at timestamptz,
  updated_at timestamptz,
  closed_at timestamptz,
  closed_by text,
  closed_by_user_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_schedule_change_id text := nullif(trim(coalesce(p_schedule_change_id, '')), '');
  v_actor_name text := nullif(trim(coalesce(p_actor_name, '')), '');
  v_entered_by text := nullif(trim(coalesce(p_entered_by, '')), '');
  v_previous public.schedule_changes%rowtype;
  v_saved public.schedule_changes%rowtype;
  v_member public.members%rowtype;
  v_attendance_schedule_id text;
  v_target_days text[] := null;
begin
  if p_member_id is null then
    raise exception 'rpc_save_schedule_change_with_attendance_sync requires p_member_id';
  end if;
  if nullif(trim(coalesce(p_change_type, '')), '') is null then
    raise exception 'rpc_save_schedule_change_with_attendance_sync requires p_change_type';
  end if;
  if p_change_type not in (
    'Scheduled Absence',
    'Makeup Day',
    'Day Swap',
    'Temporary Schedule Change',
    'Permanent Schedule Change'
  ) then
    raise exception 'Invalid schedule change type.';
  end if;
  if p_effective_start_date is null then
    raise exception 'rpc_save_schedule_change_with_attendance_sync requires p_effective_start_date';
  end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'rpc_save_schedule_change_with_attendance_sync requires p_reason';
  end if;

  select *
  into v_member
  from public.members as members
  where members.id = p_member_id
  for update;

  if not found then
    raise exception 'Member % not found for schedule change save.', p_member_id;
  end if;

  select member_attendance_schedules.id
  into v_attendance_schedule_id
  from public.member_attendance_schedules as member_attendance_schedules
  where member_attendance_schedules.member_id = p_member_id
  for update;
  if v_attendance_schedule_id is null then
    raise exception 'Missing canonical member_attendance_schedules row for member %. Provision Member Command Center shells via canonical lifecycle or explicit repair before saving schedule changes.', p_member_id;
  end if;

  if v_schedule_change_id is not null then
    select *
    into v_previous
    from public.schedule_changes as schedule_changes
    where schedule_changes.id = v_schedule_change_id
    for update;

    if not found then
      raise exception 'Schedule change not found.';
    end if;
    if v_previous.status <> 'active' then
      raise exception 'Only active schedule changes can be edited. Completed or cancelled items stay locked as history.';
    end if;

    update public.schedule_changes as schedule_changes
    set
      member_id = p_member_id,
      change_type = p_change_type,
      effective_start_date = p_effective_start_date,
      effective_end_date = p_effective_end_date,
      original_days = coalesce(p_original_days, '{}'::text[]),
      new_days = coalesce(p_new_days, '{}'::text[]),
      suspend_base_schedule = coalesce(p_suspend_base_schedule, false),
      reason = trim(p_reason),
      notes = nullif(trim(coalesce(p_notes, '')), ''),
      updated_at = v_now
    where schedule_changes.id = v_schedule_change_id
    returning * into v_saved;
  else
    v_schedule_change_id := 'schedule-change-' || gen_random_uuid()::text;
    v_entered_by := coalesce(v_entered_by, v_actor_name, 'Unknown');

    insert into public.schedule_changes (
      id,
      member_id,
      change_type,
      effective_start_date,
      effective_end_date,
      original_days,
      new_days,
      suspend_base_schedule,
      reason,
      notes,
      entered_by,
      entered_by_user_id,
      status,
      created_at,
      updated_at,
      closed_at,
      closed_by,
      closed_by_user_id
    )
    values (
      v_schedule_change_id,
      p_member_id,
      p_change_type,
      p_effective_start_date,
      p_effective_end_date,
      coalesce(p_original_days, '{}'::text[]),
      coalesce(p_new_days, '{}'::text[]),
      coalesce(p_suspend_base_schedule, false),
      trim(p_reason),
      nullif(trim(coalesce(p_notes, '')), ''),
      v_entered_by,
      p_entered_by_user_id,
      'active',
      v_now,
      v_now,
      null,
      null,
      null
    )
    returning * into v_saved;
  end if;

  if v_saved.change_type = 'Permanent Schedule Change' then
    v_target_days := coalesce(v_saved.new_days, '{}'::text[]);
  elsif v_previous.id is not null and v_previous.change_type = 'Permanent Schedule Change' then
    v_target_days := coalesce(v_previous.original_days, '{}'::text[]);
  end if;

  if v_target_days is not null then
    update public.member_attendance_schedules as member_attendance_schedules
    set
      monday = 'monday' = any(v_target_days),
      tuesday = 'tuesday' = any(v_target_days),
      wednesday = 'wednesday' = any(v_target_days),
      thursday = 'thursday' = any(v_target_days),
      friday = 'friday' = any(v_target_days),
      attendance_days_per_week =
        case when 'monday' = any(v_target_days) then 1 else 0 end +
        case when 'tuesday' = any(v_target_days) then 1 else 0 end +
        case when 'wednesday' = any(v_target_days) then 1 else 0 end +
        case when 'thursday' = any(v_target_days) then 1 else 0 end +
        case when 'friday' = any(v_target_days) then 1 else 0 end,
      updated_by_user_id = p_actor_user_id,
      updated_by_name = v_actor_name,
      updated_at = v_now
    where member_attendance_schedules.id = v_attendance_schedule_id;
  end if;

  return query
  select
    v_saved.id,
    v_saved.member_id,
    v_saved.change_type,
    v_saved.effective_start_date,
    v_saved.effective_end_date,
    v_saved.original_days,
    v_saved.new_days,
    v_saved.suspend_base_schedule,
    v_saved.reason,
    v_saved.notes,
    v_saved.entered_by,
    v_saved.entered_by_user_id,
    v_saved.status,
    v_saved.created_at,
    v_saved.updated_at,
    v_saved.closed_at,
    v_saved.closed_by,
    v_saved.closed_by_user_id;
end;
$$;

create or replace function public.rpc_update_schedule_change_status_with_attendance_sync(
  p_schedule_change_id text,
  p_status text,
  p_actor_user_id uuid default null,
  p_actor_name text default null,
  p_now timestamptz default now()
)
returns table (
  id text,
  member_id uuid,
  change_type text,
  effective_start_date date,
  effective_end_date date,
  original_days text[],
  new_days text[],
  suspend_base_schedule boolean,
  reason text,
  notes text,
  entered_by text,
  entered_by_user_id uuid,
  status text,
  created_at timestamptz,
  updated_at timestamptz,
  closed_at timestamptz,
  closed_by text,
  closed_by_user_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_actor_name text := nullif(trim(coalesce(p_actor_name, '')), '');
  v_schedule_change_id text := nullif(trim(coalesce(p_schedule_change_id, '')), '');
  v_saved public.schedule_changes%rowtype;
  v_member public.members%rowtype;
  v_attendance_schedule_id text;
  v_target_days text[] := null;
begin
  if v_schedule_change_id is null then
    raise exception 'rpc_update_schedule_change_status_with_attendance_sync requires p_schedule_change_id';
  end if;
  if p_status not in ('active', 'cancelled', 'completed') then
    raise exception 'Invalid schedule change status.';
  end if;

  select *
  into v_saved
  from public.schedule_changes as schedule_changes
  where schedule_changes.id = v_schedule_change_id
  for update;

  if not found then
    raise exception 'Schedule change not found.';
  end if;

  select *
  into v_member
  from public.members as members
  where members.id = v_saved.member_id
  for update;

  if not found then
    raise exception 'Member % not found for schedule change status update.', v_saved.member_id;
  end if;

  select member_attendance_schedules.id
  into v_attendance_schedule_id
  from public.member_attendance_schedules as member_attendance_schedules
  where member_attendance_schedules.member_id = v_saved.member_id
  for update;
  if v_attendance_schedule_id is null then
    raise exception 'Missing canonical member_attendance_schedules row for member %. Provision Member Command Center shells via canonical lifecycle or explicit repair before updating schedule change status.', v_saved.member_id;
  end if;

  update public.schedule_changes as schedule_changes
  set
    status = p_status,
    closed_at = case when p_status = 'active' then null else v_now end,
    closed_by = case when p_status = 'active' then null else v_actor_name end,
    closed_by_user_id = case when p_status = 'active' then null else p_actor_user_id end,
    updated_at = v_now
  where schedule_changes.id = v_schedule_change_id
  returning * into v_saved;

  if v_saved.change_type = 'Permanent Schedule Change' then
    if p_status = 'cancelled' then
      v_target_days := coalesce(v_saved.original_days, '{}'::text[]);
    elsif p_status in ('active', 'completed') then
      v_target_days := coalesce(v_saved.new_days, '{}'::text[]);
    end if;
  end if;

  if v_target_days is not null then
    update public.member_attendance_schedules as member_attendance_schedules
    set
      monday = 'monday' = any(v_target_days),
      tuesday = 'tuesday' = any(v_target_days),
      wednesday = 'wednesday' = any(v_target_days),
      thursday = 'thursday' = any(v_target_days),
      friday = 'friday' = any(v_target_days),
      attendance_days_per_week =
        case when 'monday' = any(v_target_days) then 1 else 0 end +
        case when 'tuesday' = any(v_target_days) then 1 else 0 end +
        case when 'wednesday' = any(v_target_days) then 1 else 0 end +
        case when 'thursday' = any(v_target_days) then 1 else 0 end +
        case when 'friday' = any(v_target_days) then 1 else 0 end,
      updated_by_user_id = p_actor_user_id,
      updated_by_name = v_actor_name,
      updated_at = v_now
    where member_attendance_schedules.id = v_attendance_schedule_id;
  end if;

  return query
  select
    v_saved.id,
    v_saved.member_id,
    v_saved.change_type,
    v_saved.effective_start_date,
    v_saved.effective_end_date,
    v_saved.original_days,
    v_saved.new_days,
    v_saved.suspend_base_schedule,
    v_saved.reason,
    v_saved.notes,
    v_saved.entered_by,
    v_saved.entered_by_user_id,
    v_saved.status,
    v_saved.created_at,
    v_saved.updated_at,
    v_saved.closed_at,
    v_saved.closed_by,
    v_saved.closed_by_user_id;
end;
$$;
