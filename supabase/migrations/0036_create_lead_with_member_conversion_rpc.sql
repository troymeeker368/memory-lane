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
    updated_at
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
    coalesce(nullif(v_patch->>'updated_at', '')::timestamptz, p_now)
  )
  returning id into v_lead_id;

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
