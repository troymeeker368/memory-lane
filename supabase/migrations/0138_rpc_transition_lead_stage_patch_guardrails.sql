create or replace function public.rpc_transition_lead_stage(
  p_lead_id uuid,
  p_to_stage text,
  p_to_status text,
  p_business_status text,
  p_actor_user_id uuid,
  p_actor_name text,
  p_source text,
  p_reason text default null,
  p_additional_lead_patch jsonb default '{}'::jsonb,
  p_now timestamptz default now(),
  p_today date default current_date
)
returns table (
  lead_id uuid,
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
  v_lead public.leads%rowtype;
  v_patch jsonb := (coalesce(p_additional_lead_patch, '{}'::jsonb) - 'stage' - 'status');
  v_now timestamptz := coalesce(p_now, now());
  v_today date := coalesce(p_today, current_date);
  v_next_stage text := nullif(trim(coalesce(p_to_stage, '')), '');
  v_next_status text := nullif(trim(coalesce(p_to_status, '')), '');
  v_business_status text := nullif(trim(coalesce(p_business_status, '')), '');
begin
  if p_lead_id is null then
    raise exception 'rpc_transition_lead_stage requires p_lead_id';
  end if;
  if v_next_stage is null then
    raise exception 'rpc_transition_lead_stage requires p_to_stage';
  end if;
  if v_next_status is null then
    raise exception 'rpc_transition_lead_stage requires p_to_status';
  end if;
  if v_business_status is null then
    raise exception 'rpc_transition_lead_stage requires p_business_status';
  end if;

  select *
  into v_lead
  from public.leads
  where id = p_lead_id
  for update;

  if not found then
    raise exception 'Lead not found.';
  end if;

  update public.leads
  set
    stage = v_next_stage,
    status = v_next_status::public.lead_status,
    stage_updated_at = case
      when v_patch ? 'stage_updated_at' then nullif(trim(coalesce(v_patch ->> 'stage_updated_at', '')), '')::timestamptz
      else v_now
    end,
    inquiry_date = case
      when v_patch ? 'inquiry_date' then nullif(trim(coalesce(v_patch ->> 'inquiry_date', '')), '')::date
      else inquiry_date
    end,
    tour_date = case
      when v_patch ? 'tour_date' then nullif(trim(coalesce(v_patch ->> 'tour_date', '')), '')::date
      else tour_date
    end,
    tour_completed = case
      when v_patch ? 'tour_completed' then coalesce((v_patch ->> 'tour_completed')::boolean, false)
      else tour_completed
    end,
    discovery_date = case
      when v_patch ? 'discovery_date' then nullif(trim(coalesce(v_patch ->> 'discovery_date', '')), '')::date
      else discovery_date
    end,
    member_start_date = case
      when v_patch ? 'member_start_date' then nullif(trim(coalesce(v_patch ->> 'member_start_date', '')), '')::date
      else member_start_date
    end,
    caregiver_name = case
      when v_patch ? 'caregiver_name' then nullif(trim(coalesce(v_patch ->> 'caregiver_name', '')), '')
      else caregiver_name
    end,
    caregiver_relationship = case
      when v_patch ? 'caregiver_relationship' then nullif(trim(coalesce(v_patch ->> 'caregiver_relationship', '')), '')
      else caregiver_relationship
    end,
    caregiver_email = case
      when v_patch ? 'caregiver_email' then nullif(trim(coalesce(v_patch ->> 'caregiver_email', '')), '')
      else caregiver_email
    end,
    caregiver_phone = case
      when v_patch ? 'caregiver_phone' then nullif(trim(coalesce(v_patch ->> 'caregiver_phone', '')), '')
      else caregiver_phone
    end,
    member_name = case
      when v_patch ? 'member_name' then nullif(trim(coalesce(v_patch ->> 'member_name', '')), '')
      else member_name
    end,
    member_dob = case
      when v_patch ? 'member_dob' then nullif(trim(coalesce(v_patch ->> 'member_dob', '')), '')::date
      else member_dob
    end,
    lead_source = case
      when v_patch ? 'lead_source' then nullif(trim(coalesce(v_patch ->> 'lead_source', '')), '')
      else lead_source
    end,
    lead_source_other = case
      when v_patch ? 'lead_source_other' then nullif(trim(coalesce(v_patch ->> 'lead_source_other', '')), '')
      else lead_source_other
    end,
    partner_id = case
      when v_patch ? 'partner_id' then nullif(trim(coalesce(v_patch ->> 'partner_id', '')), '')
      else partner_id::text
    end::text,
    referral_source_id = case
      when v_patch ? 'referral_source_id' then nullif(trim(coalesce(v_patch ->> 'referral_source_id', '')), '')
      else referral_source_id::text
    end::text,
    referral_name = case
      when v_patch ? 'referral_name' then nullif(trim(coalesce(v_patch ->> 'referral_name', '')), '')
      else referral_name
    end,
    likelihood = case
      when v_patch ? 'likelihood' then nullif(trim(coalesce(v_patch ->> 'likelihood', '')), '')
      else likelihood
    end,
    next_follow_up_date = case
      when v_patch ? 'next_follow_up_date' then nullif(trim(coalesce(v_patch ->> 'next_follow_up_date', '')), '')::date
      else next_follow_up_date
    end,
    next_follow_up_type = case
      when v_patch ? 'next_follow_up_type' then nullif(trim(coalesce(v_patch ->> 'next_follow_up_type', '')), '')
      else next_follow_up_type
    end,
    notes_summary = case
      when v_patch ? 'notes_summary' then nullif(trim(coalesce(v_patch ->> 'notes_summary', '')), '')
      else notes_summary
    end,
    lost_reason = case
      when v_patch ? 'lost_reason' then nullif(trim(coalesce(v_patch ->> 'lost_reason', '')), '')
      when lower(v_business_status) = 'lost' then lost_reason
      else null
    end,
    closed_date = case
      when v_patch ? 'closed_date' then nullif(trim(coalesce(v_patch ->> 'closed_date', '')), '')::date
      when lower(v_business_status) in ('won', 'lost') then v_today
      else null
    end,
    updated_at = case
      when v_patch ? 'updated_at' then nullif(trim(coalesce(v_patch ->> 'updated_at', '')), '')::timestamptz
      else v_now
    end
  where id = p_lead_id;

  if coalesce(v_lead.stage, '') is distinct from v_next_stage
    or coalesce(v_lead.status, '') is distinct from v_next_status then
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
      nullif(trim(coalesce(v_lead.stage, '')), ''),
      v_next_stage,
      nullif(trim(coalesce(v_lead.status, '')), ''),
      v_next_status,
      p_actor_user_id,
      nullif(trim(coalesce(p_actor_name, '')), ''),
      nullif(trim(coalesce(p_reason, '')), ''),
      nullif(trim(coalesce(p_source, '')), ''),
      v_now,
      v_now
    );
  end if;

  return query
  select
    p_lead_id,
    nullif(trim(coalesce(v_lead.stage, '')), ''),
    v_next_stage,
    nullif(trim(coalesce(v_lead.status, '')), ''),
    v_next_status,
    v_business_status;
end;
$$;

grant execute on function public.rpc_transition_lead_stage(
  uuid,
  text,
  text,
  text,
  uuid,
  text,
  text,
  text,
  jsonb,
  timestamptz,
  date
) to authenticated, service_role;
