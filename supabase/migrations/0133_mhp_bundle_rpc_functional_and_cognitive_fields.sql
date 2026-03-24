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
    ambulation = case when p_mhp_patch ? 'ambulation' then v_mhp_patch.ambulation else ambulation end,
    transferring = case when p_mhp_patch ? 'transferring' then v_mhp_patch.transferring else transferring end,
    bathing = case when p_mhp_patch ? 'bathing' then v_mhp_patch.bathing else bathing end,
    dressing = case when p_mhp_patch ? 'dressing' then v_mhp_patch.dressing else dressing end,
    eating = case when p_mhp_patch ? 'eating' then v_mhp_patch.eating else eating end,
    bladder_continence = case when p_mhp_patch ? 'bladder_continence' then v_mhp_patch.bladder_continence else bladder_continence end,
    bowel_continence = case when p_mhp_patch ? 'bowel_continence' then v_mhp_patch.bowel_continence else bowel_continence end,
    toileting = case when p_mhp_patch ? 'toileting' then v_mhp_patch.toileting else toileting end,
    toileting_needs = case when p_mhp_patch ? 'toileting_needs' then v_mhp_patch.toileting_needs else toileting_needs end,
    toileting_comments = case when p_mhp_patch ? 'toileting_comments' then v_mhp_patch.toileting_comments else toileting_comments end,
    hearing = case when p_mhp_patch ? 'hearing' then v_mhp_patch.hearing else hearing end,
    vision = case when p_mhp_patch ? 'vision' then v_mhp_patch.vision else vision end,
    dental = case when p_mhp_patch ? 'dental' then v_mhp_patch.dental else dental end,
    speech_verbal_status = case when p_mhp_patch ? 'speech_verbal_status' then v_mhp_patch.speech_verbal_status else speech_verbal_status end,
    speech_comments = case when p_mhp_patch ? 'speech_comments' then v_mhp_patch.speech_comments else speech_comments end,
    personal_appearance_hygiene_grooming = case when p_mhp_patch ? 'personal_appearance_hygiene_grooming' then v_mhp_patch.personal_appearance_hygiene_grooming else personal_appearance_hygiene_grooming end,
    may_self_medicate = case when p_mhp_patch ? 'may_self_medicate' then v_mhp_patch.may_self_medicate else may_self_medicate end,
    medication_manager_name = case when p_mhp_patch ? 'medication_manager_name' then v_mhp_patch.medication_manager_name else medication_manager_name end,
    orientation_dob = case when p_mhp_patch ? 'orientation_dob' then v_mhp_patch.orientation_dob else orientation_dob end,
    orientation_city = case when p_mhp_patch ? 'orientation_city' then v_mhp_patch.orientation_city else orientation_city end,
    orientation_current_year = case when p_mhp_patch ? 'orientation_current_year' then v_mhp_patch.orientation_current_year else orientation_current_year end,
    orientation_former_occupation = case when p_mhp_patch ? 'orientation_former_occupation' then v_mhp_patch.orientation_former_occupation else orientation_former_occupation end,
    memory_impairment = case when p_mhp_patch ? 'memory_impairment' then v_mhp_patch.memory_impairment else memory_impairment end,
    memory_severity = case when p_mhp_patch ? 'memory_severity' then v_mhp_patch.memory_severity else memory_severity end,
    wandering = case when p_mhp_patch ? 'wandering' then v_mhp_patch.wandering else wandering end,
    combative_disruptive = case when p_mhp_patch ? 'combative_disruptive' then v_mhp_patch.combative_disruptive else combative_disruptive end,
    sleep_issues = case when p_mhp_patch ? 'sleep_issues' then v_mhp_patch.sleep_issues else sleep_issues end,
    self_harm_unsafe = case when p_mhp_patch ? 'self_harm_unsafe' then v_mhp_patch.self_harm_unsafe else self_harm_unsafe end,
    impaired_judgement = case when p_mhp_patch ? 'impaired_judgement' then v_mhp_patch.impaired_judgement else impaired_judgement end,
    delirium = case when p_mhp_patch ? 'delirium' then v_mhp_patch.delirium else delirium end,
    disorientation = case when p_mhp_patch ? 'disorientation' then v_mhp_patch.disorientation else disorientation end,
    agitation_resistive = case when p_mhp_patch ? 'agitation_resistive' then v_mhp_patch.agitation_resistive else agitation_resistive end,
    screaming_loud_noises = case when p_mhp_patch ? 'screaming_loud_noises' then v_mhp_patch.screaming_loud_noises else screaming_loud_noises end,
    exhibitionism_disrobing = case when p_mhp_patch ? 'exhibitionism_disrobing' then v_mhp_patch.exhibitionism_disrobing else exhibitionism_disrobing end,
    exit_seeking = case when p_mhp_patch ? 'exit_seeking' then v_mhp_patch.exit_seeking else exit_seeking end,
    cognitive_behavior_comments = case when p_mhp_patch ? 'cognitive_behavior_comments' then v_mhp_patch.cognitive_behavior_comments else cognitive_behavior_comments end,
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
