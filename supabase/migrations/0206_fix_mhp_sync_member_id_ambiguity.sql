-- Fix ambiguous member_id reference in MHP->MCC sync RPC by qualifying table column.
-- Forward-only: recreate function with deterministic qualification.

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
  from public.member_command_centers as member_command_centers
  where member_command_centers.member_id = p_member_id
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
