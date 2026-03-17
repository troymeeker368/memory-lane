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
    gender = mhp.gender,
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
    gender = mcc.gender,
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
