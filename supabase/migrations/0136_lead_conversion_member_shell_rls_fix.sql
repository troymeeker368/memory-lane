create or replace function public.apply_lead_stage_transition_with_member_upsert(
  p_lead_id uuid,
  p_to_stage text,
  p_to_status text,
  p_business_status text,
  p_actor_user_id uuid,
  p_actor_name text,
  p_source text,
  p_reason text default null,
  p_member_display_name text default null,
  p_member_dob date default null,
  p_member_enrollment_date date default null,
  p_existing_member_id uuid default null,
  p_additional_lead_patch jsonb default '{}'::jsonb,
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
  v_from_stage text;
  v_from_status text;
  v_closed_date date;
  v_lost_reason text;
  v_member_id uuid;
  v_stage_changed boolean;
  v_patch jsonb := coalesce(p_additional_lead_patch, '{}'::jsonb);
  v_member_enrollment_date date;
  v_member_display_name text;
  v_actor_name text;
begin
  if p_lead_id is null then
    raise exception 'Lead id is required.';
  end if;
  if nullif(trim(coalesce(p_to_stage, '')), '') is null then
    raise exception 'Target stage is required.';
  end if;
  if p_to_status not in ('open', 'won', 'lost') then
    raise exception 'Target status must be open, won, or lost.';
  end if;
  if p_business_status not in ('Open', 'Won', 'Lost', 'Nurture') then
    raise exception 'Business status is invalid.';
  end if;

  select l.stage, l.status::text
  into v_from_stage, v_from_status
  from public.leads l
  where l.id = p_lead_id
  for update;

  if not found then
    raise exception 'Lead not found.';
  end if;

  if p_business_status = 'Lost' then
    if v_patch ? 'closed_date' then
      v_closed_date := nullif(v_patch->>'closed_date', '')::date;
    else
      v_closed_date := p_today;
    end if;
    if v_patch ? 'lost_reason' then
      v_lost_reason := nullif(v_patch->>'lost_reason', '');
    else
      v_lost_reason := null;
    end if;
  elsif p_business_status = 'Won' then
    if v_patch ? 'closed_date' then
      v_closed_date := nullif(v_patch->>'closed_date', '')::date;
    else
      v_closed_date := p_today;
    end if;
    if v_patch ? 'lost_reason' then
      v_lost_reason := nullif(v_patch->>'lost_reason', '');
    else
      v_lost_reason := null;
    end if;
  else
    if v_patch ? 'closed_date' then
      v_closed_date := nullif(v_patch->>'closed_date', '')::date;
    else
      v_closed_date := null;
    end if;
    if v_patch ? 'lost_reason' then
      v_lost_reason := nullif(v_patch->>'lost_reason', '');
    else
      v_lost_reason := null;
    end if;
  end if;

  update public.leads l
  set
    stage = p_to_stage,
    status = p_to_status::public.lead_status,
    stage_updated_at = p_now,
    inquiry_date = case when v_patch ? 'inquiry_date' then nullif(v_patch->>'inquiry_date', '')::date else l.inquiry_date end,
    tour_date = case when v_patch ? 'tour_date' then nullif(v_patch->>'tour_date', '')::date else l.tour_date end,
    tour_completed = case when v_patch ? 'tour_completed' then coalesce((v_patch->>'tour_completed')::boolean, false) else l.tour_completed end,
    discovery_date = case when v_patch ? 'discovery_date' then nullif(v_patch->>'discovery_date', '')::date else l.discovery_date end,
    member_start_date = case when v_patch ? 'member_start_date' then nullif(v_patch->>'member_start_date', '')::date else l.member_start_date end,
    caregiver_name = case when v_patch ? 'caregiver_name' then nullif(v_patch->>'caregiver_name', '') else l.caregiver_name end,
    caregiver_relationship = case when v_patch ? 'caregiver_relationship' then nullif(v_patch->>'caregiver_relationship', '') else l.caregiver_relationship end,
    caregiver_email = case when v_patch ? 'caregiver_email' then nullif(v_patch->>'caregiver_email', '') else l.caregiver_email end,
    caregiver_phone = case when v_patch ? 'caregiver_phone' then nullif(v_patch->>'caregiver_phone', '') else l.caregiver_phone end,
    member_name = case when v_patch ? 'member_name' then coalesce(nullif(v_patch->>'member_name', ''), l.member_name) else l.member_name end,
    member_dob = case when v_patch ? 'member_dob' then nullif(v_patch->>'member_dob', '')::date else l.member_dob end,
    lead_source = case when v_patch ? 'lead_source' then nullif(v_patch->>'lead_source', '') else l.lead_source end,
    lead_source_other = case when v_patch ? 'lead_source_other' then nullif(v_patch->>'lead_source_other', '') else l.lead_source_other end,
    partner_id = case when v_patch ? 'partner_id' then nullif(v_patch->>'partner_id', '') else l.partner_id end,
    referral_source_id = case when v_patch ? 'referral_source_id' then nullif(v_patch->>'referral_source_id', '') else l.referral_source_id end,
    referral_name = case when v_patch ? 'referral_name' then nullif(v_patch->>'referral_name', '') else l.referral_name end,
    likelihood = case when v_patch ? 'likelihood' then nullif(v_patch->>'likelihood', '') else l.likelihood end,
    next_follow_up_date = case when v_patch ? 'next_follow_up_date' then nullif(v_patch->>'next_follow_up_date', '')::date else l.next_follow_up_date end,
    next_follow_up_type = case when v_patch ? 'next_follow_up_type' then nullif(v_patch->>'next_follow_up_type', '') else l.next_follow_up_type end,
    notes_summary = case when v_patch ? 'notes_summary' then nullif(v_patch->>'notes_summary', '') else l.notes_summary end,
    lost_reason = v_lost_reason,
    closed_date = v_closed_date,
    updated_at = p_now
  where l.id = p_lead_id;

  v_member_display_name := nullif(trim(coalesce(p_member_display_name, '')), '');
  if v_member_display_name is null then
    raise exception 'Member display name is required for conversion.';
  end if;

  v_member_enrollment_date := coalesce(
    p_member_enrollment_date,
    nullif(v_patch->>'member_start_date', '')::date,
    p_today
  );
  v_actor_name := nullif(trim(coalesce(p_actor_name, '')), '');

  if p_existing_member_id is not null then
    update public.members m
    set
      display_name = v_member_display_name,
      status = 'active',
      enrollment_date = v_member_enrollment_date,
      dob = p_member_dob,
      source_lead_id = p_lead_id,
      updated_at = p_now
    where m.id = p_existing_member_id;

    if not found then
      raise exception 'Linked member not found.';
    end if;
    v_member_id := p_existing_member_id;
  else
    select m.id
    into v_member_id
    from public.members m
    where m.source_lead_id = p_lead_id
    order by m.created_at asc, m.id asc
    limit 1
    for update;

    if v_member_id is null then
      insert into public.members (
        display_name,
        status,
        enrollment_date,
        dob,
        source_lead_id,
        updated_at
      )
      values (
        v_member_display_name,
        'active',
        v_member_enrollment_date,
        p_member_dob,
        p_lead_id,
        p_now
      )
      returning id into v_member_id;
    else
      update public.members m
      set
        display_name = v_member_display_name,
        status = 'active',
        enrollment_date = v_member_enrollment_date,
        dob = p_member_dob,
        source_lead_id = p_lead_id,
        updated_at = p_now
      where m.id = v_member_id;
    end if;
  end if;

  insert into public.member_command_centers (
    id,
    member_id,
    primary_language,
    diet_type,
    diet_texture,
    updated_by_user_id,
    updated_by_name,
    created_at,
    updated_at
  )
  values (
    'mcc-' || v_member_id::text,
    v_member_id,
    'English',
    'Regular',
    'Regular',
    p_actor_user_id,
    v_actor_name,
    p_now,
    p_now
  )
  on conflict on constraint member_command_centers_member_id_key do nothing;

  insert into public.member_attendance_schedules (
    id,
    member_id,
    enrollment_date,
    full_day,
    transportation_billing_status,
    billing_rate_effective_date,
    attendance_days_per_week,
    use_custom_daily_rate,
    make_up_days_available,
    updated_by_user_id,
    updated_by_name,
    created_at,
    updated_at
  )
  values (
    'attendance-' || v_member_id::text,
    v_member_id,
    v_member_enrollment_date,
    true,
    'BillNormally',
    v_member_enrollment_date,
    0,
    false,
    0,
    p_actor_user_id,
    v_actor_name,
    p_now,
    p_now
  )
  on conflict on constraint member_attendance_schedules_member_id_key do nothing;

  v_stage_changed := coalesce(v_from_stage, '') <> p_to_stage
    or lower(coalesce(v_from_status, '')) <> lower(p_to_status);

  if v_stage_changed then
    insert into public.lead_stage_history (
      lead_id,
      from_stage,
      to_stage,
      from_status,
      to_status,
      changed_by_user_id,
      changed_by_name,
      reason,
      source,
      changed_at,
      created_at
    )
    values (
      p_lead_id,
      nullif(v_from_stage, ''),
      p_to_stage,
      nullif(v_from_status, ''),
      p_to_status,
      p_actor_user_id,
      p_actor_name,
      p_reason,
      p_source,
      p_now,
      p_now
    );
  end if;

  return query
  select
    p_lead_id,
    v_member_id,
    nullif(v_from_stage, ''),
    p_to_stage,
    nullif(v_from_status, ''),
    p_to_status,
    p_business_status;
end;
$$;
