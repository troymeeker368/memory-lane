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
  v_patch jsonb := coalesce(p_additional_lead_patch, '{}'::jsonb);
  v_now timestamptz := coalesce(p_now, now());
  v_today date := coalesce(p_today, current_date);
  v_next_stage text := nullif(trim(coalesce(v_patch ->> 'stage', p_to_stage, '')), '');
  v_next_status text := nullif(trim(coalesce(v_patch ->> 'status', p_to_status, '')), '');
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
    status = v_next_status,
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

create or replace function public.rpc_prepare_enrollment_packet_request(
  p_member_id uuid,
  p_sender_user_id uuid,
  p_caregiver_email text,
  p_token text,
  p_token_expires_at timestamptz,
  p_requested_days text[],
  p_transportation text,
  p_community_fee numeric,
  p_daily_rate numeric,
  p_signature_name text,
  p_signature_blob text,
  p_packet_id uuid default null,
  p_lead_id uuid default null,
  p_pricing_community_fee_id uuid default null,
  p_pricing_daily_rate_id uuid default null,
  p_pricing_snapshot jsonb default '{}'::jsonb,
  p_caregiver_name text default null,
  p_caregiver_phone text default null,
  p_intake_payload jsonb default '{}'::jsonb,
  p_sender_email text default null,
  p_prepared_at timestamptz default now()
)
returns table (
  packet_id uuid,
  was_created boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_packet_id uuid := coalesce(p_packet_id, gen_random_uuid());
begin
  if p_member_id is null then
    raise exception 'rpc_prepare_enrollment_packet_request requires p_member_id';
  end if;
  if p_sender_user_id is null then
    raise exception 'rpc_prepare_enrollment_packet_request requires p_sender_user_id';
  end if;
  if nullif(trim(coalesce(p_caregiver_email, '')), '') is null then
    raise exception 'rpc_prepare_enrollment_packet_request requires p_caregiver_email';
  end if;
  if nullif(trim(coalesce(p_token, '')), '') is null then
    raise exception 'rpc_prepare_enrollment_packet_request requires p_token';
  end if;
  if p_token_expires_at is null then
    raise exception 'rpc_prepare_enrollment_packet_request requires p_token_expires_at';
  end if;
  if nullif(trim(coalesce(p_signature_name, '')), '') is null then
    raise exception 'rpc_prepare_enrollment_packet_request requires p_signature_name';
  end if;
  if nullif(trim(coalesce(p_signature_blob, '')), '') is null then
    raise exception 'rpc_prepare_enrollment_packet_request requires p_signature_blob';
  end if;

  if p_packet_id is null then
    insert into public.enrollment_packet_requests (
      id,
      member_id,
      lead_id,
      sender_user_id,
      caregiver_email,
      status,
      delivery_status,
      token,
      token_expires_at,
      sent_at,
      completed_at,
      delivery_error,
      delivery_failed_at,
      created_at,
      updated_at
    )
    values (
      v_packet_id,
      p_member_id,
      p_lead_id,
      p_sender_user_id,
      lower(trim(p_caregiver_email)),
      'prepared',
      'ready_to_send',
      trim(p_token),
      p_token_expires_at,
      null,
      null,
      null,
      null,
      p_prepared_at,
      p_prepared_at
    );
    was_created := true;
  else
    update public.enrollment_packet_requests
    set
      member_id = p_member_id,
      lead_id = p_lead_id,
      sender_user_id = p_sender_user_id,
      caregiver_email = lower(trim(p_caregiver_email)),
      status = 'prepared',
      delivery_status = 'ready_to_send',
      token = trim(p_token),
      token_expires_at = p_token_expires_at,
      sent_at = null,
      completed_at = null,
      delivery_error = null,
      delivery_failed_at = null,
      updated_at = p_prepared_at
    where id = v_packet_id;

    if not found then
      raise exception 'Enrollment packet request % was not found.', v_packet_id;
    end if;
    was_created := false;
  end if;

  insert into public.enrollment_packet_fields (
    packet_id,
    requested_days,
    transportation,
    community_fee,
    daily_rate,
    pricing_community_fee_id,
    pricing_daily_rate_id,
    pricing_snapshot,
    caregiver_name,
    caregiver_phone,
    caregiver_email,
    intake_payload,
    updated_at
  )
  values (
    v_packet_id,
    coalesce(p_requested_days, array[]::text[]),
    p_transportation,
    p_community_fee,
    p_daily_rate,
    p_pricing_community_fee_id,
    p_pricing_daily_rate_id,
    coalesce(p_pricing_snapshot, '{}'::jsonb),
    nullif(trim(coalesce(p_caregiver_name, '')), ''),
    nullif(trim(coalesce(p_caregiver_phone, '')), ''),
    lower(trim(p_caregiver_email)),
    coalesce(p_intake_payload, '{}'::jsonb),
    p_prepared_at
  )
  on conflict (packet_id)
  do update
  set
    requested_days = excluded.requested_days,
    transportation = excluded.transportation,
    community_fee = excluded.community_fee,
    daily_rate = excluded.daily_rate,
    pricing_community_fee_id = excluded.pricing_community_fee_id,
    pricing_daily_rate_id = excluded.pricing_daily_rate_id,
    pricing_snapshot = excluded.pricing_snapshot,
    caregiver_name = excluded.caregiver_name,
    caregiver_phone = excluded.caregiver_phone,
    caregiver_email = excluded.caregiver_email,
    intake_payload = excluded.intake_payload,
    updated_at = excluded.updated_at;

  insert into public.enrollment_packet_signatures (
    packet_id,
    signer_name,
    signer_email,
    signer_role,
    signature_blob,
    ip_address,
    signed_at,
    created_at,
    updated_at
  )
  values (
    v_packet_id,
    trim(p_signature_name),
    lower(nullif(trim(coalesce(p_sender_email, '')), '')),
    'sender_staff',
    trim(p_signature_blob),
    null,
    p_prepared_at,
    p_prepared_at,
    p_prepared_at
  );

  packet_id := v_packet_id;
  return next;
end;
$$;

create or replace function public.rpc_transition_enrollment_packet_delivery_state(
  p_packet_id uuid,
  p_delivery_status text,
  p_attempt_at timestamptz default now(),
  p_status text default null,
  p_sent_at timestamptz default null,
  p_delivery_error text default null,
  p_expected_current_status text default null
)
returns table (
  packet_id uuid,
  status text,
  delivery_status text,
  did_transition boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.enrollment_packet_requests%rowtype;
  v_status text;
begin
  if p_packet_id is null then
    raise exception 'rpc_transition_enrollment_packet_delivery_state requires p_packet_id';
  end if;
  if nullif(trim(coalesce(p_delivery_status, '')), '') is null then
    raise exception 'rpc_transition_enrollment_packet_delivery_state requires p_delivery_status';
  end if;

  select *
  into v_request
  from public.enrollment_packet_requests
  where id = p_packet_id
  for update;

  if not found then
    raise exception 'Enrollment packet request was not found.';
  end if;

  if nullif(trim(coalesce(p_expected_current_status, '')), '') is not null
     and v_request.status is distinct from trim(p_expected_current_status) then
    return query
    select
      p_packet_id,
      v_request.status,
      v_request.delivery_status,
      false;
    return;
  end if;

  v_status := coalesce(nullif(trim(coalesce(p_status, '')), ''), v_request.status);

  update public.enrollment_packet_requests
  set
    status = v_status,
    delivery_status = trim(p_delivery_status),
    last_delivery_attempt_at = p_attempt_at,
    delivery_failed_at = case when trim(p_delivery_status) = 'send_failed' then p_attempt_at else null end,
    delivery_error = nullif(trim(coalesce(p_delivery_error, '')), ''),
    sent_at = case when p_sent_at is distinct from null then p_sent_at else sent_at end,
    updated_at = p_attempt_at
  where id = p_packet_id;

  return query
  select
    p_packet_id,
    v_status,
    trim(p_delivery_status),
    true;
end;
$$;

create or replace function public.rpc_save_enrollment_packet_progress(
  p_packet_id uuid,
  p_caregiver_name text default null,
  p_caregiver_phone text default null,
  p_caregiver_email text default null,
  p_caregiver_address_line1 text default null,
  p_caregiver_address_line2 text default null,
  p_caregiver_city text default null,
  p_caregiver_state text default null,
  p_caregiver_zip text default null,
  p_secondary_contact_name text default null,
  p_secondary_contact_phone text default null,
  p_secondary_contact_email text default null,
  p_secondary_contact_relationship text default null,
  p_notes text default null,
  p_intake_payload jsonb default '{}'::jsonb,
  p_updated_at timestamptz default now()
)
returns table (
  packet_id uuid,
  status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.enrollment_packet_requests%rowtype;
begin
  if p_packet_id is null then
    raise exception 'rpc_save_enrollment_packet_progress requires p_packet_id';
  end if;

  update public.enrollment_packet_fields
  set
    caregiver_name = nullif(trim(coalesce(p_caregiver_name, '')), ''),
    caregiver_phone = nullif(trim(coalesce(p_caregiver_phone, '')), ''),
    caregiver_email = lower(nullif(trim(coalesce(p_caregiver_email, '')), '')),
    caregiver_address_line1 = nullif(trim(coalesce(p_caregiver_address_line1, '')), ''),
    caregiver_address_line2 = nullif(trim(coalesce(p_caregiver_address_line2, '')), ''),
    caregiver_city = nullif(trim(coalesce(p_caregiver_city, '')), ''),
    caregiver_state = nullif(trim(coalesce(p_caregiver_state, '')), ''),
    caregiver_zip = nullif(trim(coalesce(p_caregiver_zip, '')), ''),
    secondary_contact_name = nullif(trim(coalesce(p_secondary_contact_name, '')), ''),
    secondary_contact_phone = nullif(trim(coalesce(p_secondary_contact_phone, '')), ''),
    secondary_contact_email = lower(nullif(trim(coalesce(p_secondary_contact_email, '')), '')),
    secondary_contact_relationship = nullif(trim(coalesce(p_secondary_contact_relationship, '')), ''),
    notes = nullif(trim(coalesce(p_notes, '')), ''),
    intake_payload = coalesce(p_intake_payload, '{}'::jsonb),
    updated_at = p_updated_at
  where packet_id = p_packet_id;

  if not found then
    raise exception 'Enrollment packet fields were not found.';
  end if;

  update public.enrollment_packet_requests
  set
    status = 'partially_completed',
    updated_at = p_updated_at
  where id = p_packet_id
    and status in ('prepared', 'sent', 'opened', 'partially_completed')
  returning *
  into v_request;

  if not found then
    raise exception 'Unable to save enrollment packet progress because the packet is no longer in an editable state.';
  end if;

  return query
  select
    p_packet_id,
    v_request.status;
end;
$$;

grant execute on function public.rpc_prepare_enrollment_packet_request(
  uuid,
  uuid,
  text,
  text,
  timestamptz,
  text[],
  text,
  numeric,
  numeric,
  text,
  text,
  uuid,
  uuid,
  uuid,
  uuid,
  jsonb,
  text,
  text,
  jsonb,
  text,
  timestamptz
) to authenticated, service_role;

grant execute on function public.rpc_transition_enrollment_packet_delivery_state(
  uuid,
  text,
  timestamptz,
  text,
  timestamptz,
  text,
  text
) to authenticated, service_role;

grant execute on function public.rpc_save_enrollment_packet_progress(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  jsonb,
  timestamptz
) to authenticated, service_role;

create or replace function public.rpc_prepare_pof_request_delivery(
  p_physician_order_id uuid,
  p_member_id uuid,
  p_provider_name text,
  p_provider_email text,
  p_nurse_name text,
  p_from_email text,
  p_sent_by_user_id uuid,
  p_expires_at timestamptz,
  p_signature_request_token text,
  p_signature_request_url text,
  p_unsigned_pdf_url text,
  p_pof_payload_json jsonb,
  p_actor_user_id uuid,
  p_actor_name text,
  p_request_id uuid default null,
  p_optional_message text default null,
  p_now timestamptz default now()
)
returns table (
  request_id uuid,
  was_created boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request_id uuid := coalesce(p_request_id, gen_random_uuid());
begin
  if p_physician_order_id is null then
    raise exception 'rpc_prepare_pof_request_delivery requires p_physician_order_id';
  end if;
  if p_member_id is null then
    raise exception 'rpc_prepare_pof_request_delivery requires p_member_id';
  end if;
  if nullif(trim(coalesce(p_provider_name, '')), '') is null then
    raise exception 'rpc_prepare_pof_request_delivery requires p_provider_name';
  end if;
  if nullif(trim(coalesce(p_provider_email, '')), '') is null then
    raise exception 'rpc_prepare_pof_request_delivery requires p_provider_email';
  end if;
  if nullif(trim(coalesce(p_nurse_name, '')), '') is null then
    raise exception 'rpc_prepare_pof_request_delivery requires p_nurse_name';
  end if;
  if nullif(trim(coalesce(p_from_email, '')), '') is null then
    raise exception 'rpc_prepare_pof_request_delivery requires p_from_email';
  end if;
  if p_sent_by_user_id is null then
    raise exception 'rpc_prepare_pof_request_delivery requires p_sent_by_user_id';
  end if;
  if p_expires_at is null then
    raise exception 'rpc_prepare_pof_request_delivery requires p_expires_at';
  end if;
  if nullif(trim(coalesce(p_signature_request_token, '')), '') is null then
    raise exception 'rpc_prepare_pof_request_delivery requires p_signature_request_token';
  end if;
  if nullif(trim(coalesce(p_signature_request_url, '')), '') is null then
    raise exception 'rpc_prepare_pof_request_delivery requires p_signature_request_url';
  end if;
  if nullif(trim(coalesce(p_unsigned_pdf_url, '')), '') is null then
    raise exception 'rpc_prepare_pof_request_delivery requires p_unsigned_pdf_url';
  end if;

  if p_request_id is null then
    insert into public.pof_requests (
      id,
      physician_order_id,
      member_id,
      provider_name,
      provider_email,
      nurse_name,
      from_email,
      sent_by_user_id,
      status,
      delivery_status,
      optional_message,
      sent_at,
      opened_at,
      signed_at,
      expires_at,
      signature_request_token,
      signature_request_url,
      unsigned_pdf_url,
      signed_pdf_url,
      pof_payload_json,
      member_file_id,
      created_by_user_id,
      created_by_name,
      created_at,
      updated_by_user_id,
      updated_by_name,
      updated_at,
      delivery_error,
      delivery_failed_at,
      last_delivery_attempt_at
    )
    values (
      v_request_id,
      p_physician_order_id,
      p_member_id,
      trim(p_provider_name),
      trim(p_provider_email),
      trim(p_nurse_name),
      trim(p_from_email),
      p_sent_by_user_id,
      'draft',
      'ready_to_send',
      nullif(trim(coalesce(p_optional_message, '')), ''),
      null,
      null,
      null,
      p_expires_at,
      trim(p_signature_request_token),
      trim(p_signature_request_url),
      trim(p_unsigned_pdf_url),
      null,
      coalesce(p_pof_payload_json, '{}'::jsonb),
      null,
      p_actor_user_id,
      nullif(trim(coalesce(p_actor_name, '')), ''),
      p_now,
      p_actor_user_id,
      nullif(trim(coalesce(p_actor_name, '')), ''),
      p_now,
      null,
      null,
      p_now
    );
    was_created := true;
  else
    update public.pof_requests
    set
      physician_order_id = p_physician_order_id,
      member_id = p_member_id,
      provider_name = trim(p_provider_name),
      provider_email = trim(p_provider_email),
      nurse_name = trim(p_nurse_name),
      from_email = trim(p_from_email),
      sent_by_user_id = p_sent_by_user_id,
      status = 'draft',
      delivery_status = 'ready_to_send',
      optional_message = nullif(trim(coalesce(p_optional_message, '')), ''),
      sent_at = null,
      opened_at = null,
      signed_at = null,
      expires_at = p_expires_at,
      signature_request_token = trim(p_signature_request_token),
      signature_request_url = trim(p_signature_request_url),
      unsigned_pdf_url = trim(p_unsigned_pdf_url),
      pof_payload_json = coalesce(p_pof_payload_json, '{}'::jsonb),
      updated_by_user_id = p_actor_user_id,
      updated_by_name = nullif(trim(coalesce(p_actor_name, '')), ''),
      updated_at = p_now,
      delivery_error = null,
      delivery_failed_at = null,
      last_delivery_attempt_at = p_now
    where id = v_request_id;

    if not found then
      raise exception 'POF signature request was not found.';
    end if;
    was_created := false;
  end if;

  request_id := v_request_id;
  return next;
end;
$$;

create or replace function public.rpc_transition_pof_request_delivery_state(
  p_request_id uuid,
  p_actor_user_id uuid,
  p_actor_name text,
  p_delivery_status text,
  p_attempt_at timestamptz default now(),
  p_status text default null,
  p_sent_at timestamptz default null,
  p_opened_at timestamptz default null,
  p_signed_at timestamptz default null,
  p_delivery_error text default null,
  p_provider_name text default null,
  p_update_physician_order_sent boolean default false
)
returns table (
  request_id uuid,
  status text,
  delivery_status text,
  physician_order_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.pof_requests%rowtype;
  v_status text;
  v_sent_at timestamptz;
begin
  if p_request_id is null then
    raise exception 'rpc_transition_pof_request_delivery_state requires p_request_id';
  end if;
  if nullif(trim(coalesce(p_delivery_status, '')), '') is null then
    raise exception 'rpc_transition_pof_request_delivery_state requires p_delivery_status';
  end if;

  select *
  into v_request
  from public.pof_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'POF signature request was not found.';
  end if;

  v_status := coalesce(nullif(trim(coalesce(p_status, '')), ''), v_request.status);
  v_sent_at := coalesce(p_sent_at, v_request.sent_at);

  update public.pof_requests
  set
    status = v_status,
    delivery_status = trim(p_delivery_status),
    last_delivery_attempt_at = p_attempt_at,
    delivery_failed_at = case when trim(p_delivery_status) = 'send_failed' then p_attempt_at else null end,
    delivery_error = nullif(trim(coalesce(p_delivery_error, '')), ''),
    sent_at = case when p_sent_at is distinct from null then p_sent_at else sent_at end,
    opened_at = case when p_opened_at is distinct from null then p_opened_at else opened_at end,
    signed_at = case when p_signed_at is distinct from null then p_signed_at else signed_at end,
    updated_by_user_id = p_actor_user_id,
    updated_by_name = nullif(trim(coalesce(p_actor_name, '')), ''),
    updated_at = p_attempt_at
  where id = p_request_id;

  if p_update_physician_order_sent and v_status = 'sent' then
    update public.physician_orders
    set
      status = 'sent',
      provider_name = coalesce(nullif(trim(coalesce(p_provider_name, '')), ''), v_request.provider_name),
      sent_at = coalesce(v_sent_at, p_attempt_at),
      updated_by_user_id = p_actor_user_id,
      updated_by_name = nullif(trim(coalesce(p_actor_name, '')), ''),
      updated_at = p_attempt_at
    where id = v_request.physician_order_id
      and status <> 'signed';
  end if;

  return query
  select
    p_request_id,
    v_status,
    trim(p_delivery_status),
    v_request.physician_order_id;
end;
$$;

grant execute on function public.rpc_prepare_pof_request_delivery(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  uuid,
  timestamptz,
  text,
  text,
  text,
  jsonb,
  uuid,
  text,
  uuid,
  text,
  timestamptz
) to authenticated, service_role;

grant execute on function public.rpc_transition_pof_request_delivery_state(
  uuid,
  uuid,
  text,
  text,
  timestamptz,
  text,
  timestamptz,
  timestamptz,
  timestamptz,
  text,
  text,
  boolean
) to authenticated, service_role;

create or replace function public.rpc_prepare_care_plan_caregiver_request(
  p_care_plan_id uuid,
  p_caregiver_name text,
  p_caregiver_email text,
  p_caregiver_sent_by_user_id uuid,
  p_caregiver_signature_request_token text,
  p_caregiver_signature_expires_at timestamptz,
  p_caregiver_signature_request_url text,
  p_actor_user_id uuid,
  p_actor_name text,
  p_updated_at timestamptz default now()
)
returns table (
  care_plan_id uuid,
  caregiver_signature_status text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_care_plan_id is null then
    raise exception 'rpc_prepare_care_plan_caregiver_request requires p_care_plan_id';
  end if;
  if nullif(trim(coalesce(p_caregiver_name, '')), '') is null then
    raise exception 'rpc_prepare_care_plan_caregiver_request requires p_caregiver_name';
  end if;
  if nullif(trim(coalesce(p_caregiver_email, '')), '') is null then
    raise exception 'rpc_prepare_care_plan_caregiver_request requires p_caregiver_email';
  end if;
  if p_caregiver_sent_by_user_id is null then
    raise exception 'rpc_prepare_care_plan_caregiver_request requires p_caregiver_sent_by_user_id';
  end if;
  if nullif(trim(coalesce(p_caregiver_signature_request_token, '')), '') is null then
    raise exception 'rpc_prepare_care_plan_caregiver_request requires p_caregiver_signature_request_token';
  end if;
  if p_caregiver_signature_expires_at is null then
    raise exception 'rpc_prepare_care_plan_caregiver_request requires p_caregiver_signature_expires_at';
  end if;
  if nullif(trim(coalesce(p_caregiver_signature_request_url, '')), '') is null then
    raise exception 'rpc_prepare_care_plan_caregiver_request requires p_caregiver_signature_request_url';
  end if;

  update public.care_plans
  set
    caregiver_name = trim(p_caregiver_name),
    caregiver_email = lower(trim(p_caregiver_email)),
    caregiver_signature_status = 'ready_to_send',
    caregiver_sent_at = null,
    caregiver_sent_by_user_id = p_caregiver_sent_by_user_id,
    caregiver_viewed_at = null,
    caregiver_signed_at = null,
    caregiver_signature_request_token = trim(p_caregiver_signature_request_token),
    caregiver_signature_expires_at = p_caregiver_signature_expires_at,
    caregiver_signature_request_url = trim(p_caregiver_signature_request_url),
    caregiver_signed_name = null,
    caregiver_signature_image_url = null,
    caregiver_signature_ip = null,
    caregiver_signature_user_agent = null,
    caregiver_signature_error = null,
    final_member_file_id = null,
    updated_by_user_id = p_actor_user_id,
    updated_by_name = nullif(trim(coalesce(p_actor_name, '')), ''),
    updated_at = p_updated_at
  where id = p_care_plan_id;

  if not found then
    raise exception 'Care plan was not found.';
  end if;

  return query
  select
    p_care_plan_id,
    'ready_to_send'::text;
end;
$$;

create or replace function public.rpc_transition_care_plan_caregiver_status(
  p_care_plan_id uuid,
  p_status text,
  p_updated_at timestamptz default now(),
  p_actor_user_id uuid default null,
  p_actor_name text default null,
  p_caregiver_sent_at timestamptz default null,
  p_caregiver_viewed_at timestamptz default null,
  p_caregiver_signature_error text default null
)
returns table (
  care_plan_id uuid,
  caregiver_signature_status text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_care_plan_id is null then
    raise exception 'rpc_transition_care_plan_caregiver_status requires p_care_plan_id';
  end if;
  if nullif(trim(coalesce(p_status, '')), '') is null then
    raise exception 'rpc_transition_care_plan_caregiver_status requires p_status';
  end if;

  update public.care_plans
  set
    caregiver_signature_status = trim(p_status),
    caregiver_sent_at = case when p_caregiver_sent_at is distinct from null then p_caregiver_sent_at else caregiver_sent_at end,
    caregiver_viewed_at = case when p_caregiver_viewed_at is distinct from null then p_caregiver_viewed_at else caregiver_viewed_at end,
    caregiver_signature_error = case
      when p_caregiver_signature_error is null then null
      else nullif(trim(p_caregiver_signature_error), '')
    end,
    updated_by_user_id = p_actor_user_id,
    updated_by_name = nullif(trim(coalesce(p_actor_name, '')), ''),
    updated_at = p_updated_at
  where id = p_care_plan_id;

  if not found then
    raise exception 'Care plan was not found.';
  end if;

  return query
  select
    p_care_plan_id,
    trim(p_status);
end;
$$;

create or replace function public.rpc_upsert_member_file_by_source(
  p_member_id uuid,
  p_document_source text,
  p_member_file_id text default null,
  p_file_name text default null,
  p_file_type text default null,
  p_file_data_url text default null,
  p_storage_object_path text default null,
  p_category text default null,
  p_category_other text default null,
  p_uploaded_by_user_id uuid default null,
  p_uploaded_by_name text default null,
  p_uploaded_at timestamptz default now(),
  p_updated_at timestamptz default now(),
  p_care_plan_id uuid default null,
  p_pof_request_id uuid default null,
  p_enrollment_packet_request_id uuid default null
)
returns table (
  member_file_id text,
  was_created boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing_id text;
  v_member_file_id text;
begin
  if p_member_id is null then
    raise exception 'rpc_upsert_member_file_by_source requires p_member_id';
  end if;

  if nullif(trim(coalesce(p_member_file_id, '')), '') is not null then
    select id
    into v_existing_id
    from public.member_files
    where id = trim(p_member_file_id)
      and member_id = p_member_id
    for update;
  end if;

  if v_existing_id is null and nullif(trim(coalesce(p_document_source, '')), '') is null then
    raise exception 'rpc_upsert_member_file_by_source requires p_document_source';
  end if;

  if v_existing_id is null then
    select id
    into v_existing_id
    from public.member_files
    where member_id = p_member_id
      and document_source = trim(p_document_source)
    for update;
  end if;

  if v_existing_id is not null then
    update public.member_files
    set
      file_name = coalesce(p_file_name, file_name),
      file_type = coalesce(p_file_type, file_type),
      file_data_url = p_file_data_url,
      storage_object_path = p_storage_object_path,
      category = coalesce(p_category, category),
      category_other = p_category_other,
      document_source = coalesce(nullif(trim(coalesce(p_document_source, '')), ''), document_source),
      uploaded_by_user_id = p_uploaded_by_user_id,
      uploaded_by_name = p_uploaded_by_name,
      uploaded_at = coalesce(p_uploaded_at, uploaded_at),
      updated_at = coalesce(p_updated_at, p_uploaded_at, updated_at),
      care_plan_id = p_care_plan_id,
      pof_request_id = p_pof_request_id,
      enrollment_packet_request_id = p_enrollment_packet_request_id
    where id = v_existing_id;

    member_file_id := v_existing_id;
    was_created := false;
    return next;
    return;
  end if;

  v_member_file_id := coalesce(
    nullif(trim(coalesce(p_member_file_id, '')), ''),
    'mf_' || replace(gen_random_uuid()::text, '-', '')
  );

  insert into public.member_files (
    id,
    member_id,
    file_name,
    file_type,
    file_data_url,
    storage_object_path,
    category,
    category_other,
    document_source,
    uploaded_by_user_id,
    uploaded_by_name,
    uploaded_at,
    updated_at,
    care_plan_id,
    pof_request_id,
    enrollment_packet_request_id
  )
  values (
    v_member_file_id,
    p_member_id,
    coalesce(p_file_name, v_member_file_id),
    coalesce(p_file_type, 'application/octet-stream'),
    p_file_data_url,
    p_storage_object_path,
    coalesce(p_category, 'Other'),
    p_category_other,
    trim(p_document_source),
    p_uploaded_by_user_id,
    p_uploaded_by_name,
    coalesce(p_uploaded_at, now()),
    coalesce(p_updated_at, p_uploaded_at, now()),
    p_care_plan_id,
    p_pof_request_id,
    p_enrollment_packet_request_id
  );

  member_file_id := v_member_file_id;
  was_created := true;
  return next;
end;
$$;

create or replace function public.rpc_delete_member_file_record(
  p_member_file_id text
)
returns table (
  member_file_id text,
  member_id uuid,
  deleted boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_file public.member_files%rowtype;
begin
  if nullif(trim(coalesce(p_member_file_id, '')), '') is null then
    raise exception 'rpc_delete_member_file_record requires p_member_file_id';
  end if;

  select *
  into v_file
  from public.member_files
  where id = trim(p_member_file_id)
  for update;

  if not found then
    member_file_id := trim(p_member_file_id);
    member_id := null;
    deleted := false;
    return next;
    return;
  end if;

  delete from public.member_files
  where id = v_file.id;

  member_file_id := v_file.id;
  member_id := v_file.member_id;
  deleted := true;
  return next;
end;
$$;

grant execute on function public.rpc_prepare_care_plan_caregiver_request(
  uuid,
  text,
  text,
  uuid,
  text,
  timestamptz,
  text,
  uuid,
  text,
  timestamptz
) to authenticated, service_role;

grant execute on function public.rpc_transition_care_plan_caregiver_status(
  uuid,
  text,
  timestamptz,
  uuid,
  text,
  timestamptz,
  timestamptz,
  text
) to authenticated, service_role;

grant execute on function public.rpc_upsert_member_file_by_source(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  uuid,
  text,
  timestamptz,
  timestamptz,
  uuid,
  uuid,
  uuid
) to authenticated, service_role;

grant execute on function public.rpc_delete_member_file_record(
  text
) to authenticated, service_role;
