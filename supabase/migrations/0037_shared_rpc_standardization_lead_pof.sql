create table if not exists public.pof_post_sign_sync_queue (
  id uuid primary key default gen_random_uuid(),
  physician_order_id uuid not null unique references public.physician_orders(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  pof_request_id uuid references public.pof_requests(id) on delete set null,
  status text not null default 'queued' check (status in ('queued', 'completed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_attempt_at timestamptz,
  next_retry_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  last_failed_step text check (last_failed_step in ('mhp_mcc', 'mar_medications', 'mar_schedules')),
  signature_completed_at timestamptz not null,
  queued_at timestamptz not null default now(),
  queued_by_user_id uuid references public.profiles(id) on delete set null,
  queued_by_name text,
  resolved_at timestamptz,
  resolved_by_user_id uuid references public.profiles(id) on delete set null,
  resolved_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.rpc_convert_lead_to_member(
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
language sql
security invoker
set search_path = public
as $$
  select
    converted.lead_id,
    converted.member_id,
    converted.from_stage,
    converted.to_stage,
    converted.from_status,
    converted.to_status,
    converted.business_status
  from public.apply_lead_stage_transition_with_member_upsert(
    p_lead_id => p_lead_id,
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
    p_existing_member_id => p_existing_member_id,
    p_additional_lead_patch => p_additional_lead_patch,
    p_now => p_now,
    p_today => p_today
  ) as converted;
$$;

create or replace function public.rpc_create_lead_with_member_conversion(
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
language sql
security invoker
set search_path = public
as $$
  select
    created.lead_id,
    created.member_id,
    created.from_stage,
    created.to_stage,
    created.from_status,
    created.to_status,
    created.business_status
  from public.create_lead_with_member_conversion(
    p_to_stage => p_to_stage,
    p_to_status => p_to_status,
    p_business_status => p_business_status,
    p_created_by_user_id => p_created_by_user_id,
    p_actor_user_id => p_actor_user_id,
    p_actor_name => p_actor_name,
    p_source => p_source,
    p_reason => p_reason,
    p_member_display_name => p_member_display_name,
    p_member_dob => p_member_dob,
    p_member_enrollment_date => p_member_enrollment_date,
    p_lead_patch => p_lead_patch,
    p_now => p_now,
    p_today => p_today
  ) as created;
$$;

create or replace function public.rpc_sign_physician_order(
  p_pof_id uuid,
  p_actor_user_id uuid default null,
  p_actor_name text default null,
  p_signed_at timestamptz default now(),
  p_pof_request_id uuid default null
)
returns table (
  physician_order_id uuid,
  member_id uuid,
  queue_id uuid,
  queue_attempt_count integer,
  queue_next_retry_at timestamptz
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_member_id uuid;
  v_provider_name text;
  v_actor_name text;
  v_queue public.pof_post_sign_sync_queue%rowtype;
begin
  if p_pof_id is null then
    raise exception 'Physician order id is required.';
  end if;

  select po.member_id, po.provider_name
  into v_member_id, v_provider_name
  from public.physician_orders po
  where po.id = p_pof_id
  for update;

  if not found then
    raise exception 'Physician order not found.';
  end if;

  v_actor_name := nullif(trim(coalesce(p_actor_name, '')), '');

  update public.physician_orders po
  set
    status = 'superseded',
    is_active_signed = false,
    superseded_by = p_pof_id,
    superseded_at = p_signed_at,
    updated_by_user_id = p_actor_user_id,
    updated_by_name = v_actor_name,
    updated_at = p_signed_at
  where po.member_id = v_member_id
    and po.is_active_signed = true
    and po.id <> p_pof_id;

  update public.physician_orders po
  set
    status = 'signed',
    is_active_signed = true,
    signed_at = p_signed_at,
    sent_at = p_signed_at,
    signed_by_name = coalesce(nullif(trim(coalesce(v_provider_name, '')), ''), v_actor_name, po.signed_by_name),
    effective_at = p_signed_at,
    updated_by_user_id = p_actor_user_id,
    updated_by_name = v_actor_name,
    updated_at = p_signed_at
  where po.id = p_pof_id;

  insert into public.pof_post_sign_sync_queue (
    physician_order_id,
    member_id,
    pof_request_id,
    status,
    attempt_count,
    next_retry_at,
    last_error,
    last_error_at,
    last_failed_step,
    signature_completed_at,
    queued_by_user_id,
    queued_by_name,
    resolved_at,
    resolved_by_user_id,
    resolved_by_name
  )
  values (
    p_pof_id,
    v_member_id,
    p_pof_request_id,
    'queued',
    0,
    p_signed_at,
    null,
    null,
    null,
    p_signed_at,
    p_actor_user_id,
    v_actor_name,
    null,
    null,
    null
  )
  on conflict (physician_order_id)
  do update
  set
    member_id = excluded.member_id,
    pof_request_id = coalesce(excluded.pof_request_id, public.pof_post_sign_sync_queue.pof_request_id),
    signature_completed_at = excluded.signature_completed_at,
    queued_by_user_id = coalesce(excluded.queued_by_user_id, public.pof_post_sign_sync_queue.queued_by_user_id),
    queued_by_name = coalesce(excluded.queued_by_name, public.pof_post_sign_sync_queue.queued_by_name)
  returning * into v_queue;

  return query
  select
    p_pof_id,
    v_member_id,
    v_queue.id,
    coalesce(v_queue.attempt_count, 0),
    v_queue.next_retry_at;
end;
$$;

create or replace function public.rpc_finalize_pof_signature(
  p_request_id uuid,
  p_provider_typed_name text,
  p_provider_signature_image_url text,
  p_provider_ip text default null,
  p_provider_user_agent text default null,
  p_signed_pdf_url text default null,
  p_member_file_id text default null,
  p_member_file_name text default null,
  p_member_file_data_url text default null,
  p_member_file_storage_object_path text default null,
  p_actor_user_id uuid default null,
  p_actor_name text default null,
  p_signed_at timestamptz default now(),
  p_opened_at timestamptz default null,
  p_signature_request_token text default null,
  p_signature_metadata jsonb default '{}'::jsonb
)
returns table (
  request_id uuid,
  physician_order_id uuid,
  member_id uuid,
  member_file_id text,
  queue_id uuid,
  queue_attempt_count integer,
  queue_next_retry_at timestamptz
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_request public.pof_requests%rowtype;
  v_actor_user_id uuid;
  v_actor_name text;
  v_member_file_id text;
  v_signature_metadata jsonb := coalesce(p_signature_metadata, '{}'::jsonb);
  v_signed_at timestamptz := coalesce(p_signed_at, now());
  v_sign record;
begin
  if p_request_id is null then
    raise exception 'POF request id is required.';
  end if;
  if nullif(trim(coalesce(p_provider_typed_name, '')), '') is null then
    raise exception 'Typed provider name is required.';
  end if;
  if nullif(trim(coalesce(p_provider_signature_image_url, '')), '') is null then
    raise exception 'Provider signature image URL is required.';
  end if;
  if nullif(trim(coalesce(p_member_file_name, '')), '') is null then
    raise exception 'Member file name is required.';
  end if;
  if nullif(trim(coalesce(p_member_file_data_url, '')), '') is null then
    raise exception 'Member file payload is required.';
  end if;
  if nullif(trim(coalesce(p_signed_pdf_url, '')), '') is null then
    raise exception 'Signed PDF storage URL is required.';
  end if;

  select *
  into v_request
  from public.pof_requests pr
  where pr.id = p_request_id
  for update;

  if not found then
    raise exception 'POF signature request was not found.';
  end if;
  if v_request.status = 'signed' then
    raise exception 'This signature link has already been used.';
  end if;
  if v_request.status = 'declined' then
    raise exception 'This signature request was voided.';
  end if;
  if v_request.status = 'expired' or v_request.expires_at < v_signed_at then
    raise exception 'This signature link has expired.';
  end if;

  v_actor_user_id := coalesce(p_actor_user_id, v_request.sent_by_user_id);
  v_actor_name := coalesce(nullif(trim(coalesce(p_actor_name, '')), ''), v_request.nurse_name);

  select mf.id
  into v_member_file_id
  from public.member_files mf
  where mf.pof_request_id = p_request_id
  for update;

  if v_member_file_id is null then
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
      category,
      category_other,
      document_source,
      pof_request_id,
      storage_object_path,
      uploaded_by_user_id,
      uploaded_by_name,
      uploaded_at,
      updated_at
    )
    values (
      v_member_file_id,
      v_request.member_id,
      p_member_file_name,
      'application/pdf',
      p_member_file_data_url,
      'Orders / POF',
      null,
      'POF E-Sign Signed',
      p_request_id,
      p_member_file_storage_object_path,
      v_actor_user_id,
      v_actor_name,
      v_signed_at,
      v_signed_at
    );
  else
    update public.member_files mf
    set
      file_name = p_member_file_name,
      file_type = 'application/pdf',
      file_data_url = p_member_file_data_url,
      category = 'Orders / POF',
      category_other = null,
      document_source = 'POF E-Sign Signed',
      pof_request_id = p_request_id,
      storage_object_path = p_member_file_storage_object_path,
      uploaded_by_user_id = v_actor_user_id,
      uploaded_by_name = v_actor_name,
      uploaded_at = v_signed_at,
      updated_at = v_signed_at
    where mf.id = v_member_file_id;
  end if;

  insert into public.pof_signatures (
    pof_request_id,
    provider_typed_name,
    provider_signature_image_url,
    provider_ip,
    provider_user_agent,
    signed_at,
    created_at,
    updated_at
  )
  values (
    p_request_id,
    p_provider_typed_name,
    p_provider_signature_image_url,
    nullif(trim(coalesce(p_provider_ip, '')), ''),
    nullif(trim(coalesce(p_provider_user_agent, '')), ''),
    v_signed_at,
    v_signed_at,
    v_signed_at
  )
  on conflict (pof_request_id)
  do update
  set
    provider_typed_name = excluded.provider_typed_name,
    provider_signature_image_url = excluded.provider_signature_image_url,
    provider_ip = excluded.provider_ip,
    provider_user_agent = excluded.provider_user_agent,
    signed_at = excluded.signed_at,
    updated_at = excluded.updated_at;

  update public.physician_orders po
  set
    provider_name = p_provider_typed_name,
    provider_signature = p_provider_typed_name,
    provider_signature_date = (v_signed_at at time zone 'America/New_York')::date,
    signature_metadata = v_signature_metadata,
    updated_by_user_id = v_actor_user_id,
    updated_by_name = v_actor_name,
    updated_at = v_signed_at
  where po.id = v_request.physician_order_id;

  select *
  into v_sign
  from public.rpc_sign_physician_order(
    p_pof_id => v_request.physician_order_id,
    p_actor_user_id => v_actor_user_id,
    p_actor_name => v_actor_name,
    p_signed_at => v_signed_at,
    p_pof_request_id => p_request_id
  );

  update public.pof_requests pr
  set
    status = 'signed',
    opened_at = coalesce(pr.opened_at, p_opened_at, v_signed_at),
    signed_at = v_signed_at,
    signed_pdf_url = p_signed_pdf_url,
    member_file_id = v_member_file_id,
    signature_request_token = coalesce(nullif(trim(coalesce(p_signature_request_token, '')), ''), pr.signature_request_token),
    updated_by_user_id = v_actor_user_id,
    updated_by_name = v_actor_name,
    updated_at = v_signed_at
  where pr.id = p_request_id;

  insert into public.document_events (
    document_type,
    document_id,
    member_id,
    physician_order_id,
    event_type,
    actor_type,
    actor_user_id,
    actor_name,
    actor_email,
    actor_ip,
    actor_user_agent,
    metadata,
    created_at
  )
  values (
    'pof_request',
    p_request_id,
    v_request.member_id,
    v_request.physician_order_id,
    'signed',
    'provider',
    null,
    p_provider_typed_name,
    v_request.provider_email,
    nullif(trim(coalesce(p_provider_ip, '')), ''),
    nullif(trim(coalesce(p_provider_user_agent, '')), ''),
    jsonb_build_object(
      'postSignStatus', 'queued',
      'postSignQueueId', v_sign.queue_id,
      'postSignAttemptCount', coalesce(v_sign.queue_attempt_count, 0),
      'postSignNextRetryAt', v_sign.queue_next_retry_at,
      'postSignLastError', null
    ),
    v_signed_at
  );

  return query
  select
    p_request_id,
    v_request.physician_order_id,
    v_request.member_id,
    v_member_file_id,
    v_sign.queue_id,
    coalesce(v_sign.queue_attempt_count, 0),
    v_sign.queue_next_retry_at;
end;
$$;
