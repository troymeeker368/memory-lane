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

grant execute on function public.rpc_update_member_command_center_bundle(
  uuid,
  jsonb,
  jsonb,
  uuid,
  text,
  timestamptz
) to authenticated, service_role;

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

  insert into public.member_attendance_schedules (
    id, member_id, enrollment_date, monday, tuesday, wednesday, thursday, friday, full_day,
    transportation_required, transportation_billing_status, attendance_days_per_week, make_up_days_available,
    created_at, updated_at
  )
  values (
    'attendance-' || p_member_id::text, p_member_id, v_member.enrollment_date, false, false, false, false, false, true,
    null, 'BillNormally', 0, 0, v_now, v_now
  )
  on conflict (member_id) do nothing;

  select id
  into v_schedule_id
  from public.member_attendance_schedules
  where member_id = p_member_id
  for update;

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

grant execute on function public.rpc_save_member_command_center_attendance_billing(
  uuid,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  uuid,
  text,
  timestamptz
) to authenticated, service_role;

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

  select * into v_member
  from public.members
  where id = p_member_id
  for update;
  if not found then
    raise exception 'Member % not found', p_member_id;
  end if;

  insert into public.member_attendance_schedules (
    id, member_id, enrollment_date, monday, tuesday, wednesday, thursday, friday, full_day,
    transportation_required, transportation_billing_status, attendance_days_per_week, make_up_days_available,
    created_at, updated_at
  )
  values (
    'attendance-' || p_member_id::text, p_member_id, v_member.enrollment_date, false, false, false, false, false, true,
    null, 'BillNormally', 0, 0, v_now, v_now
  )
  on conflict (member_id) do nothing;

  select id into v_schedule_id
  from public.member_attendance_schedules
  where member_id = p_member_id
  for update;

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

grant execute on function public.rpc_save_member_command_center_transportation(
  uuid,
  jsonb,
  jsonb,
  uuid,
  text,
  timestamptz
) to authenticated, service_role;

create or replace function public.rpc_update_member_health_profile_bundle(
  p_member_id uuid,
  p_mhp_patch jsonb default '{}'::jsonb,
  p_member_patch jsonb default '{}'::jsonb,
  p_actor_user_id uuid default null,
  p_actor_name text default null,
  p_now timestamptz default now(),
  p_sync_to_mcc boolean default true,
  p_hospital_name text default null
)
returns table (
  member_health_profile_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_mhp_patch public.member_health_profiles%rowtype;
  v_member_patch public.members%rowtype;
  v_profile_id uuid;
begin
  if p_member_id is null then
    raise exception 'rpc_update_member_health_profile_bundle requires p_member_id';
  end if;

  insert into public.member_health_profiles (
    member_id, created_at, updated_at, updated_by_user_id, updated_by_name
  )
  values (
    p_member_id, v_now, v_now, p_actor_user_id, nullif(trim(coalesce(p_actor_name, '')), '')
  )
  on conflict (member_id) do nothing;

  select id into v_profile_id
  from public.member_health_profiles
  where member_id = p_member_id
  for update;

  select * into v_mhp_patch
  from jsonb_populate_record(null::public.member_health_profiles, coalesce(p_mhp_patch, '{}'::jsonb));

  update public.member_health_profiles
  set
    gender = case when p_mhp_patch ? 'gender' then v_mhp_patch.gender else gender end,
    payor = case when p_mhp_patch ? 'payor' then v_mhp_patch.payor else payor end,
    original_referral_source = case when p_mhp_patch ? 'original_referral_source' then v_mhp_patch.original_referral_source else original_referral_source end,
    photo_consent = case when p_mhp_patch ? 'photo_consent' then v_mhp_patch.photo_consent else photo_consent end,
    profile_image_url = case when p_mhp_patch ? 'profile_image_url' then v_mhp_patch.profile_image_url else profile_image_url end,
    primary_caregiver_name = case when p_mhp_patch ? 'primary_caregiver_name' then v_mhp_patch.primary_caregiver_name else primary_caregiver_name end,
    primary_caregiver_phone = case when p_mhp_patch ? 'primary_caregiver_phone' then v_mhp_patch.primary_caregiver_phone else primary_caregiver_phone end,
    responsible_party_name = case when p_mhp_patch ? 'responsible_party_name' then v_mhp_patch.responsible_party_name else responsible_party_name end,
    responsible_party_phone = case when p_mhp_patch ? 'responsible_party_phone' then v_mhp_patch.responsible_party_phone else responsible_party_phone end,
    important_alerts = case when p_mhp_patch ? 'important_alerts' then v_mhp_patch.important_alerts else important_alerts end,
    diet_type = case when p_mhp_patch ? 'diet_type' then v_mhp_patch.diet_type else diet_type end,
    dietary_restrictions = case when p_mhp_patch ? 'dietary_restrictions' then v_mhp_patch.dietary_restrictions else dietary_restrictions end,
    swallowing_difficulty = case when p_mhp_patch ? 'swallowing_difficulty' then v_mhp_patch.swallowing_difficulty else swallowing_difficulty end,
    diet_texture = case when p_mhp_patch ? 'diet_texture' then v_mhp_patch.diet_texture else diet_texture end,
    supplements = case when p_mhp_patch ? 'supplements' then v_mhp_patch.supplements else supplements end,
    foods_to_omit = case when p_mhp_patch ? 'foods_to_omit' then v_mhp_patch.foods_to_omit else foods_to_omit end,
    code_status = case when p_mhp_patch ? 'code_status' then v_mhp_patch.code_status else code_status end,
    dnr = case when p_mhp_patch ? 'dnr' then v_mhp_patch.dnr else dnr end,
    dni = case when p_mhp_patch ? 'dni' then v_mhp_patch.dni else dni end,
    polst_molst_colst = case when p_mhp_patch ? 'polst_molst_colst' then v_mhp_patch.polst_molst_colst else polst_molst_colst end,
    hospice = case when p_mhp_patch ? 'hospice' then v_mhp_patch.hospice else hospice end,
    advanced_directives_obtained = case when p_mhp_patch ? 'advanced_directives_obtained' then v_mhp_patch.advanced_directives_obtained else advanced_directives_obtained end,
    power_of_attorney = case when p_mhp_patch ? 'power_of_attorney' then v_mhp_patch.power_of_attorney else power_of_attorney end,
    hospital_preference = case when p_mhp_patch ? 'hospital_preference' then v_mhp_patch.hospital_preference else hospital_preference end,
    legal_comments = case when p_mhp_patch ? 'legal_comments' then v_mhp_patch.legal_comments else legal_comments end,
    updated_by_user_id = p_actor_user_id,
    updated_by_name = nullif(trim(coalesce(p_actor_name, '')), ''),
    updated_at = v_now
  where id = v_profile_id;

  select * into v_member_patch
  from jsonb_populate_record(null::public.members, coalesce(p_member_patch, '{}'::jsonb));

  update public.members
  set
    dob = case when p_member_patch ? 'dob' then v_member_patch.dob else dob end,
    code_status = case when p_member_patch ? 'code_status' then v_member_patch.code_status else code_status end
  where id = p_member_id;

  if nullif(trim(coalesce(p_hospital_name, '')), '') is not null then
    insert into public.hospital_preference_directory (
      id, hospital_name, created_by_user_id, created_by_name, created_at, updated_at
    )
    values (
      'hospital-' || replace(gen_random_uuid()::text, '-', ''), nullif(trim(coalesce(p_hospital_name, '')), ''),
      p_actor_user_id, nullif(trim(coalesce(p_actor_name, '')), ''), v_now, v_now
    )
    on conflict ((lower(btrim(hospital_name))))
    do update
    set hospital_name = excluded.hospital_name, updated_at = excluded.updated_at;
  end if;

  if coalesce(p_sync_to_mcc, true) then
    perform 1
    from public.rpc_sync_member_health_profile_to_command_center(
      p_member_id, p_actor_user_id, p_actor_name, v_now
    );
  end if;

  member_health_profile_id := v_profile_id;
  return next;
end;
$$;

grant execute on function public.rpc_update_member_health_profile_bundle(
  uuid,
  jsonb,
  jsonb,
  uuid,
  text,
  timestamptz,
  boolean,
  text
) to authenticated, service_role;

create or replace function public.rpc_update_member_track_with_note(
  p_member_id uuid,
  p_track text,
  p_actor_user_id uuid default null,
  p_actor_name text default null,
  p_now timestamptz default now()
)
returns table (
  changed boolean,
  member_note_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_existing_track text;
  v_note_id uuid;
begin
  if p_member_id is null then
    raise exception 'rpc_update_member_track_with_note requires p_member_id';
  end if;

  if p_track is null or p_track not in ('Track 1', 'Track 2', 'Track 3') then
    raise exception 'rpc_update_member_track_with_note requires a valid track';
  end if;

  select latest_assessment_track
  into v_existing_track
  from public.members
  where id = p_member_id
  for update;

  if not found then
    raise exception 'Member % not found', p_member_id;
  end if;

  if coalesce(v_existing_track, '') = p_track then
    changed := false;
    member_note_id := null;
    return next;
    return;
  end if;

  update public.members
  set latest_assessment_track = p_track
  where id = p_member_id;

  insert into public.member_notes (
    member_id,
    note_type,
    note_text,
    created_by_user_id,
    created_by_name,
    created_at,
    updated_at
  )
  values (
    p_member_id,
    'Care Plan',
    format('Track changed to %s. Care plan review requested.', p_track),
    p_actor_user_id,
    nullif(trim(coalesce(p_actor_name, '')), ''),
    v_now,
    v_now
  )
  returning id into v_note_id;

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
  on conflict (member_id) do update
  set
    updated_at = excluded.updated_at,
    updated_by_user_id = excluded.updated_by_user_id,
    updated_by_name = excluded.updated_by_name;

  changed := true;
  member_note_id := v_note_id;
  return next;
end;
$$;

grant execute on function public.rpc_update_member_track_with_note(
  uuid,
  text,
  uuid,
  text,
  timestamptz
) to authenticated, service_role;
