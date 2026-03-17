update public.member_health_profiles
set gender = case
  when lower(trim(gender)) in ('m', 'male') then 'M'
  when lower(trim(gender)) in ('f', 'female') then 'F'
  else null
end
where gender is not null;

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
  on conflict do nothing;

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
  on conflict do nothing;

  update public.member_health_profiles as mhp
  set
    gender = case
      when lower(trim(coalesce(mcc.gender, ''))) in ('m', 'male') then 'M'
      when lower(trim(coalesce(mcc.gender, ''))) in ('f', 'female') then 'F'
      else null
    end,
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
  from public.member_command_centers as mcc
  where mcc.member_id = p_member_id
    and mhp.member_id = p_member_id;

  update public.members as m
  set code_status = mcc.code_status
  from public.member_command_centers as mcc
  where mcc.member_id = p_member_id
    and m.id = p_member_id
    and nullif(trim(coalesce(mcc.code_status, '')), '') is not null;

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

grant execute on function public.rpc_sync_command_center_to_member_health_profile(
  uuid,
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
    gender = case
      when p_mhp_patch ? 'gender' then
        case
          when lower(trim(coalesce(v_mhp_patch.gender, ''))) in ('m', 'male') then 'M'
          when lower(trim(coalesce(v_mhp_patch.gender, ''))) in ('f', 'female') then 'F'
          else null
        end
      else gender
    end,
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
