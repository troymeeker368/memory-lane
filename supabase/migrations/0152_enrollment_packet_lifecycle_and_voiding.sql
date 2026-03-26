alter table public.enrollment_packet_requests
  add column if not exists opened_at timestamptz,
  add column if not exists last_family_activity_at timestamptz,
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by_user_id uuid references public.profiles(id) on delete set null,
  add column if not exists void_reason text;

update public.enrollment_packet_requests
set
  status = case
    when status = 'prepared' then 'draft'
    when status = 'opened' then 'in_progress'
    when status = 'partially_completed' then 'in_progress'
    when status = 'filed' then 'completed'
    else status
  end,
  opened_at = case
    when opened_at is not null then opened_at
    when status in ('opened', 'partially_completed') then coalesce(sent_at, updated_at, created_at)
    when status in ('completed', 'filed') then coalesce(completed_at, sent_at, updated_at, created_at)
    else opened_at
  end,
  last_family_activity_at = case
    when last_family_activity_at is not null then last_family_activity_at
    when status in ('opened', 'partially_completed') then coalesce(updated_at, sent_at, created_at)
    when status in ('completed', 'filed') then coalesce(completed_at, updated_at, created_at)
    else last_family_activity_at
  end,
  updated_at = coalesce(updated_at, created_at)
where status in ('prepared', 'opened', 'partially_completed', 'filed')
   or opened_at is null;

alter table public.enrollment_packet_requests
  drop constraint if exists enrollment_packet_requests_status_check;

alter table public.enrollment_packet_requests
  add constraint enrollment_packet_requests_status_check
  check (status in ('draft', 'sent', 'in_progress', 'expired', 'completed', 'voided'));

drop index if exists idx_enrollment_packet_requests_active_member_unique;

create unique index if not exists idx_enrollment_packet_requests_active_member_unique
  on public.enrollment_packet_requests (member_id)
  where status in ('draft', 'sent', 'in_progress');

create unique index if not exists idx_enrollment_packet_requests_active_lead_unique
  on public.enrollment_packet_requests (lead_id)
  where lead_id is not null
    and status in ('draft', 'sent', 'in_progress');

create index if not exists idx_enrollment_packet_requests_status_updated_at
  on public.enrollment_packet_requests(status, updated_at desc);

create index if not exists idx_enrollment_packet_requests_voided_at
  on public.enrollment_packet_requests(voided_at desc)
  where voided_at is not null;

create index if not exists idx_enrollment_packet_requests_opened_at
  on public.enrollment_packet_requests(opened_at desc)
  where opened_at is not null;

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
      opened_at,
      last_family_activity_at,
      completed_at,
      voided_at,
      voided_by_user_id,
      void_reason,
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
      'draft',
      'ready_to_send',
      trim(p_token),
      p_token_expires_at,
      null,
      null,
      null,
      null,
      null,
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
      status = 'draft',
      delivery_status = 'ready_to_send',
      token = trim(p_token),
      token_expires_at = p_token_expires_at,
      sent_at = null,
      opened_at = null,
      last_family_activity_at = null,
      completed_at = null,
      voided_at = null,
      voided_by_user_id = null,
      void_reason = null,
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
  on conflict on constraint enrollment_packet_fields_packet_id_key
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

create or replace function public.rpc_transition_enrollment_packet_delivery_state(
  p_packet_id uuid,
  p_delivery_status text,
  p_attempt_at timestamptz default now(),
  p_status text default null,
  p_sent_at timestamptz default null,
  p_opened_at timestamptz default null,
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
    opened_at = case when p_opened_at is distinct from null then coalesce(opened_at, p_opened_at) else opened_at end,
    last_family_activity_at = case
      when p_opened_at is distinct from null then coalesce(last_family_activity_at, p_opened_at)
      else last_family_activity_at
    end,
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

grant execute on function public.rpc_transition_enrollment_packet_delivery_state(
  uuid,
  text,
  timestamptz,
  text,
  timestamptz,
  timestamptz,
  text,
  text
) to authenticated, service_role;

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

  update public.enrollment_packet_fields as epf
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
  where epf.packet_id = p_packet_id;

  if not found then
    raise exception 'Enrollment packet fields were not found.';
  end if;

  update public.enrollment_packet_requests
  set
    status = 'in_progress',
    opened_at = coalesce(opened_at, p_updated_at),
    last_family_activity_at = p_updated_at,
    updated_at = p_updated_at
  where id = p_packet_id
    and status in ('draft', 'sent', 'in_progress')
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

create or replace function public.rpc_finalize_enrollment_packet_submission(
  p_packet_id uuid,
  p_rotated_token text,
  p_consumed_submission_token_hash text,
  p_completed_at timestamptz,
  p_filed_at timestamptz,
  p_signer_name text,
  p_signer_email text,
  p_signature_blob text,
  p_ip_address text,
  p_actor_user_id uuid,
  p_actor_email text,
  p_upload_batch_id uuid,
  p_completed_metadata jsonb default '{}'::jsonb,
  p_filed_metadata jsonb default '{}'::jsonb
)
returns table (
  packet_id uuid,
  status text,
  mapping_sync_status text,
  was_already_filed boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.enrollment_packet_requests%rowtype;
  v_consumed_submission_token_hash text := nullif(trim(coalesce(p_consumed_submission_token_hash, '')), '');
  v_completed_at timestamptz := coalesce(p_completed_at, now());
  v_updated_at timestamptz := coalesce(p_filed_at, p_completed_at, now());
begin
  if p_packet_id is null then
    raise exception 'packet id is required';
  end if;

  select *
  into v_request
  from public.enrollment_packet_requests
  where id = p_packet_id
  for update;

  if not found then
    raise exception 'Enrollment packet request % was not found.', p_packet_id;
  end if;

  if coalesce(v_request.status, '') = 'completed' then
    if v_consumed_submission_token_hash is not null
       and v_request.last_consumed_submission_token_hash = v_consumed_submission_token_hash then
      return query
      select
        v_request.id,
        v_request.status,
        v_request.mapping_sync_status,
        true;
      return;
    end if;
    raise exception 'Enrollment packet request % has already been finalized.', p_packet_id;
  end if;

  if coalesce(v_request.status, '') not in ('draft', 'sent', 'in_progress') then
    raise exception 'Enrollment packet request % cannot be finalized from status %.', p_packet_id, coalesce(v_request.status, 'null');
  end if;

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
    p_packet_id,
    p_signer_name,
    nullif(trim(coalesce(p_signer_email, '')), ''),
    'caregiver',
    p_signature_blob,
    nullif(trim(coalesce(p_ip_address, '')), ''),
    v_completed_at,
    v_completed_at,
    v_completed_at
  );

  update public.enrollment_packet_uploads as epu
  set
    finalization_status = 'finalized',
    finalized_at = v_updated_at
  where epu.packet_id = p_packet_id
    and epu.finalization_status = 'staged'
    and (
      p_upload_batch_id is null
      or epu.finalization_batch_id = p_upload_batch_id
    );

  update public.enrollment_packet_requests
  set
    status = 'completed',
    opened_at = coalesce(opened_at, v_completed_at),
    completed_at = v_completed_at,
    token = p_rotated_token,
    last_consumed_submission_token_hash = coalesce(v_consumed_submission_token_hash, last_consumed_submission_token_hash),
    mapping_sync_status = 'pending',
    mapping_sync_error = null,
    mapping_sync_attempted_at = null,
    last_family_activity_at = v_completed_at,
    updated_at = v_updated_at
  where id = p_packet_id;

  insert into public.enrollment_packet_events (
    packet_id,
    event_type,
    actor_user_id,
    actor_email,
    timestamp,
    metadata
  )
  values (
    p_packet_id,
    'completed',
    p_actor_user_id,
    nullif(trim(coalesce(p_actor_email, '')), ''),
    v_completed_at,
    coalesce(p_completed_metadata, '{}'::jsonb) || coalesce(p_filed_metadata, '{}'::jsonb)
  );

  return query
  select
    p_packet_id,
    'completed',
    'pending',
    false;
end;
$$;

grant execute on function public.rpc_finalize_enrollment_packet_submission(
  uuid,
  text,
  text,
  timestamptz,
  timestamptz,
  text,
  text,
  text,
  text,
  uuid,
  text,
  uuid,
  jsonb,
  jsonb
) to authenticated, service_role;

create or replace function public.rpc_void_enrollment_packet_request(
  p_packet_id uuid,
  p_actor_user_id uuid,
  p_actor_email text default null,
  p_void_reason text default null,
  p_voided_at timestamptz default now()
)
returns table (
  packet_id uuid,
  status text,
  voided_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.enrollment_packet_requests%rowtype;
  v_void_reason text := nullif(trim(coalesce(p_void_reason, '')), '');
  v_voided_at timestamptz := coalesce(p_voided_at, now());
begin
  if p_packet_id is null then
    raise exception 'rpc_void_enrollment_packet_request requires p_packet_id';
  end if;
  if p_actor_user_id is null then
    raise exception 'rpc_void_enrollment_packet_request requires p_actor_user_id';
  end if;
  if v_void_reason is null then
    raise exception 'A void reason is required.';
  end if;

  select *
  into v_request
  from public.enrollment_packet_requests
  where id = p_packet_id
  for update;

  if not found then
    raise exception 'Enrollment packet request was not found.';
  end if;

  if coalesce(v_request.status, '') = 'voided' then
    return query
    select
      v_request.id,
      v_request.status,
      v_request.voided_at;
    return;
  end if;

  if coalesce(v_request.status, '') in ('completed', 'expired') then
    raise exception 'Completed or expired enrollment packets cannot be voided.';
  end if;

  update public.enrollment_packet_requests
  set
    status = 'voided',
    voided_at = v_voided_at,
    voided_by_user_id = p_actor_user_id,
    void_reason = v_void_reason,
    token_expires_at = coalesce(least(token_expires_at, v_voided_at), v_voided_at),
    updated_at = v_voided_at
  where id = p_packet_id;

  insert into public.enrollment_packet_events (
    packet_id,
    event_type,
    actor_user_id,
    actor_email,
    timestamp,
    metadata
  )
  values (
    p_packet_id,
    'voided',
    p_actor_user_id,
    nullif(trim(coalesce(p_actor_email, '')), ''),
    v_voided_at,
    jsonb_build_object(
      'reason',
      v_void_reason,
      'voided_at',
      v_voided_at
    )
  );

  return query
  select
    p_packet_id,
    'voided',
    v_voided_at;
end;
$$;

grant execute on function public.rpc_void_enrollment_packet_request(
  uuid,
  uuid,
  text,
  text,
  timestamptz
) to authenticated, service_role;
