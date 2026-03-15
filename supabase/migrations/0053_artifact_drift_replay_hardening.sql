alter table public.pof_requests
  add column if not exists last_consumed_signature_token_hash text;

create index if not exists idx_pof_requests_last_consumed_signature_token_hash
  on public.pof_requests(last_consumed_signature_token_hash)
  where last_consumed_signature_token_hash is not null;

alter table public.care_plans
  add column if not exists last_consumed_caregiver_signature_token_hash text;

create index if not exists idx_care_plans_last_consumed_caregiver_signature_token_hash
  on public.care_plans(last_consumed_caregiver_signature_token_hash)
  where last_consumed_caregiver_signature_token_hash is not null;

alter table public.enrollment_packet_requests
  add column if not exists last_consumed_submission_token_hash text,
  add column if not exists mapping_sync_status text not null default 'not_started',
  add column if not exists mapping_sync_error text,
  add column if not exists mapping_sync_attempted_at timestamptz,
  add column if not exists latest_mapping_run_id uuid references public.enrollment_packet_mapping_runs(id) on delete set null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'enrollment_packet_requests_mapping_sync_status_check'
  ) then
    alter table public.enrollment_packet_requests
      add constraint enrollment_packet_requests_mapping_sync_status_check
      check (mapping_sync_status in ('not_started', 'pending', 'completed', 'failed'));
  end if;
end
$$;

create index if not exists idx_enrollment_packet_requests_last_consumed_submission_token_hash
  on public.enrollment_packet_requests(last_consumed_submission_token_hash)
  where last_consumed_submission_token_hash is not null;

create index if not exists idx_enrollment_packet_requests_mapping_sync_status_updated_at
  on public.enrollment_packet_requests(mapping_sync_status, updated_at desc);

alter table public.enrollment_packet_uploads
  add column if not exists finalization_batch_id uuid,
  add column if not exists finalization_status text not null default 'staged',
  add column if not exists finalized_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'enrollment_packet_uploads_finalization_status_check'
  ) then
    alter table public.enrollment_packet_uploads
      add constraint enrollment_packet_uploads_finalization_status_check
      check (finalization_status in ('staged', 'finalized'));
  end if;
end
$$;

create index if not exists idx_enrollment_packet_uploads_packet_batch_status
  on public.enrollment_packet_uploads(packet_id, finalization_batch_id, finalization_status, uploaded_at asc);

update public.enrollment_packet_uploads epu
set
  finalization_status = 'finalized',
  finalized_at = coalesce(epu.finalized_at, req.completed_at, req.updated_at, now())
from public.enrollment_packet_requests req
where req.id = epu.packet_id
  and req.status in ('completed', 'filed')
  and epu.finalization_status <> 'finalized';

update public.enrollment_packet_requests
set
  mapping_sync_status = case
    when status = 'filed' then 'completed'
    else mapping_sync_status
  end
where mapping_sync_status = 'not_started'
  and status = 'filed';

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
  p_signature_metadata jsonb default '{}'::jsonb,
  p_consumed_signature_token_hash text default null
)
returns table (
  request_id uuid,
  physician_order_id uuid,
  member_id uuid,
  member_file_id text,
  queue_id uuid,
  queue_attempt_count integer,
  queue_next_retry_at timestamptz,
  was_already_signed boolean
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
  v_queue public.pof_post_sign_sync_queue%rowtype;
  v_consumed_signature_token_hash text := nullif(trim(coalesce(p_consumed_signature_token_hash, '')), '');
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
    if v_consumed_signature_token_hash is not null
       and v_request.last_consumed_signature_token_hash = v_consumed_signature_token_hash then
      select q.*
      into v_queue
      from public.pof_post_sign_sync_queue q
      where q.physician_order_id = v_request.physician_order_id
      for update;

      return query
      select
        v_request.id,
        v_request.physician_order_id,
        v_request.member_id,
        v_request.member_file_id,
        v_queue.id,
        coalesce(v_queue.attempt_count, 0),
        v_queue.next_retry_at,
        true;
      return;
    end if;
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
    last_consumed_signature_token_hash = coalesce(v_consumed_signature_token_hash, pr.last_consumed_signature_token_hash),
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
    jsonb_strip_nulls(
      jsonb_build_object(
        'memberFileId', v_member_file_id,
        'queueId', v_sign.queue_id,
        'providerSignatureImageUrl', p_provider_signature_image_url
      )
    ) || v_signature_metadata,
    v_signed_at
  );

  return query
  select
    p_request_id,
    v_request.physician_order_id,
    v_request.member_id,
    v_member_file_id,
    v_sign.queue_id,
    v_sign.queue_attempt_count,
    v_sign.queue_next_retry_at,
    false;
end;
$$;

create or replace function public.rpc_finalize_care_plan_caregiver_signature(
  p_care_plan_id uuid,
  p_rotated_token text,
  p_consumed_signature_token_hash text,
  p_signed_at timestamptz,
  p_updated_at timestamptz,
  p_final_member_file_id text,
  p_final_member_file_name text,
  p_final_member_file_data_url text,
  p_final_member_file_storage_object_path text,
  p_uploaded_by_user_id uuid,
  p_uploaded_by_name text,
  p_actor_name text,
  p_actor_email text,
  p_actor_ip text,
  p_actor_user_agent text,
  p_signature_image_url text,
  p_metadata jsonb default '{}'::jsonb
)
returns table (
  care_plan_id uuid,
  member_id uuid,
  final_member_file_id text,
  was_already_signed boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_care_plan public.care_plans%rowtype;
  v_final_member_file_id text;
  v_signed_at timestamptz := coalesce(p_signed_at, now());
  v_updated_at timestamptz := coalesce(p_updated_at, v_signed_at);
  v_consumed_signature_token_hash text := nullif(trim(coalesce(p_consumed_signature_token_hash, '')), '');
begin
  if p_care_plan_id is null then
    raise exception 'care plan id is required';
  end if;
  if nullif(trim(coalesce(p_actor_name, '')), '') is null then
    raise exception 'actor name is required';
  end if;
  if nullif(trim(coalesce(p_signature_image_url, '')), '') is null then
    raise exception 'signature image url is required';
  end if;
  if nullif(trim(coalesce(p_final_member_file_name, '')), '') is null then
    raise exception 'final member file name is required';
  end if;
  if nullif(trim(coalesce(p_final_member_file_data_url, '')), '') is null then
    raise exception 'final member file payload is required';
  end if;

  select *
  into v_care_plan
  from public.care_plans
  where id = p_care_plan_id
  for update;

  if not found then
    raise exception 'Care plan % was not found.', p_care_plan_id;
  end if;

  if coalesce(v_care_plan.caregiver_signature_status, '') = 'signed' then
    if v_consumed_signature_token_hash is not null
       and v_care_plan.last_consumed_caregiver_signature_token_hash = v_consumed_signature_token_hash then
      return query
      select
        v_care_plan.id,
        v_care_plan.member_id,
        v_care_plan.final_member_file_id,
        true;
      return;
    end if;
    raise exception 'Care plan % caregiver signature is already finalized.', p_care_plan_id;
  end if;

  if coalesce(v_care_plan.caregiver_signature_status, '') not in ('sent', 'viewed') then
    raise exception 'Care plan % caregiver signature cannot be finalized from status %.', p_care_plan_id, coalesce(v_care_plan.caregiver_signature_status, 'null');
  end if;

  v_final_member_file_id := nullif(trim(coalesce(v_care_plan.final_member_file_id, '')), '');
  if v_final_member_file_id is null then
    v_final_member_file_id := nullif(trim(coalesce(p_final_member_file_id, '')), '');
  end if;
  if v_final_member_file_id is null then
    v_final_member_file_id := 'mf_' || replace(gen_random_uuid()::text, '-', '');
  end if;

  insert into public.member_files (
    id,
    member_id,
    file_name,
    file_type,
    file_data_url,
    category,
    category_other,
    document_source,
    care_plan_id,
    storage_object_path,
    uploaded_by_user_id,
    uploaded_by_name,
    uploaded_at,
    updated_at
  )
  values (
    v_final_member_file_id,
    v_care_plan.member_id,
    p_final_member_file_name,
    'application/pdf',
    p_final_member_file_data_url,
    'Care Plan',
    null,
    'Care Plan Final Signed',
    p_care_plan_id,
    nullif(trim(coalesce(p_final_member_file_storage_object_path, '')), ''),
    p_uploaded_by_user_id,
    nullif(trim(coalesce(p_uploaded_by_name, '')), ''),
    v_signed_at,
    v_updated_at
  )
  on conflict (id)
  do update
  set
    member_id = excluded.member_id,
    file_name = excluded.file_name,
    file_type = excluded.file_type,
    file_data_url = excluded.file_data_url,
    category = excluded.category,
    category_other = excluded.category_other,
    document_source = excluded.document_source,
    care_plan_id = excluded.care_plan_id,
    storage_object_path = excluded.storage_object_path,
    uploaded_by_user_id = excluded.uploaded_by_user_id,
    uploaded_by_name = excluded.uploaded_by_name,
    uploaded_at = excluded.uploaded_at,
    updated_at = excluded.updated_at;

  update public.care_plans
  set
    caregiver_signature_status = 'signed',
    caregiver_signed_at = v_signed_at,
    caregiver_signature_request_token = p_rotated_token,
    caregiver_signature_request_url = null,
    caregiver_signed_name = nullif(trim(coalesce(p_actor_name, '')), ''),
    caregiver_signature_image_url = nullif(trim(coalesce(p_signature_image_url, '')), ''),
    caregiver_signature_ip = nullif(trim(coalesce(p_actor_ip, '')), ''),
    caregiver_signature_user_agent = nullif(trim(coalesce(p_actor_user_agent, '')), ''),
    responsible_party_signature = nullif(trim(coalesce(p_actor_name, '')), ''),
    responsible_party_signature_date = (v_signed_at at time zone 'America/New_York')::date,
    final_member_file_id = v_final_member_file_id,
    caregiver_signature_error = null,
    last_consumed_caregiver_signature_token_hash = coalesce(v_consumed_signature_token_hash, last_consumed_caregiver_signature_token_hash),
    updated_at = v_updated_at
  where id = p_care_plan_id;

  insert into public.care_plan_signature_events (
    care_plan_id,
    member_id,
    event_type,
    actor_type,
    actor_name,
    actor_email,
    actor_ip,
    actor_user_agent,
    metadata,
    created_at
  )
  values (
    p_care_plan_id,
    v_care_plan.member_id,
    'signed',
    'caregiver',
    nullif(trim(coalesce(p_actor_name, '')), ''),
    nullif(trim(coalesce(p_actor_email, '')), ''),
    nullif(trim(coalesce(p_actor_ip, '')), ''),
    nullif(trim(coalesce(p_actor_user_agent, '')), ''),
    jsonb_strip_nulls(
      jsonb_build_object(
        'finalMemberFileId', v_final_member_file_id,
        'signatureImageUrl', nullif(trim(coalesce(p_signature_image_url, '')), '')
      )
    ) || coalesce(p_metadata, '{}'::jsonb),
    v_signed_at
  );

  return query
  select
    p_care_plan_id,
    v_care_plan.member_id,
    v_final_member_file_id,
    false;
end;
$$;

create or replace function public.rpc_finalize_care_plan_nurse_signature(
  p_care_plan_id uuid,
  p_member_id uuid,
  p_signed_by_user_id uuid,
  p_signed_by_name text,
  p_signed_at timestamptz,
  p_signature_artifact_storage_path text default null,
  p_signature_artifact_member_file_id text default null,
  p_signature_metadata jsonb default '{}'::jsonb
)
returns table (
  care_plan_id uuid,
  member_id uuid,
  signed_by_user_id uuid,
  signed_by_name text,
  signed_at timestamptz,
  status text,
  signature_artifact_storage_path text,
  signature_artifact_member_file_id text,
  signature_metadata jsonb,
  caregiver_signature_status text,
  was_already_signed boolean
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_care_plan public.care_plans%rowtype;
  v_signature public.care_plan_nurse_signatures%rowtype;
  v_signed_by_name text := nullif(trim(coalesce(p_signed_by_name, '')), '');
  v_signed_at timestamptz := coalesce(p_signed_at, now());
  v_signature_artifact_storage_path text := nullif(trim(coalesce(p_signature_artifact_storage_path, '')), '');
  v_signature_artifact_member_file_id text := nullif(trim(coalesce(p_signature_artifact_member_file_id, '')), '');
  v_signature_metadata jsonb := coalesce(p_signature_metadata, '{}'::jsonb);
  v_completion_date date;
  v_next_caregiver_status text;
begin
  if p_care_plan_id is null then
    raise exception 'care plan id is required';
  end if;
  if p_member_id is null then
    raise exception 'member id is required';
  end if;
  if p_signed_by_user_id is null then
    raise exception 'signed by user id is required';
  end if;
  if v_signed_by_name is null then
    raise exception 'signed by name is required';
  end if;

  select *
  into v_care_plan
  from public.care_plans
  where id = p_care_plan_id
  for update;

  if not found then
    raise exception 'Care plan % was not found.', p_care_plan_id;
  end if;

  if v_care_plan.member_id is distinct from p_member_id then
    raise exception 'Care plan % does not belong to member %.', p_care_plan_id, p_member_id;
  end if;

  select *
  into v_signature
  from public.care_plan_nurse_signatures
  where care_plan_id = p_care_plan_id
  for update;

  if found and coalesce(v_signature.status, '') = 'voided' then
    raise exception 'Care plan % nurse signature has been voided.', p_care_plan_id;
  end if;

  if coalesce(v_care_plan.nurse_signature_status, '') = 'voided' then
    raise exception 'Care plan % nurse signature is voided.', p_care_plan_id;
  end if;

  v_next_caregiver_status := case
    when coalesce(v_care_plan.caregiver_signature_status, '') = 'signed' then 'signed'
    else 'ready_to_send'
  end;

  if found and coalesce(v_signature.status, '') = 'signed' then
    update public.care_plans
    set
      nurse_signature_status = 'signed',
      nurse_signed_by_user_id = v_signature.signed_by_user_id,
      nurse_signed_by_name = v_signature.signed_by_name,
      nurse_signed_at = v_signature.signed_at,
      nurse_signature_artifact_storage_path = v_signature.signature_artifact_storage_path,
      nurse_signature_artifact_member_file_id = v_signature.signature_artifact_member_file_id,
      nurse_signature_metadata = coalesce(v_signature.signature_metadata, '{}'::jsonb),
      completed_by = v_signature.signed_by_name,
      administrator_signature = v_signature.signed_by_name,
      nurse_designee_user_id = v_signature.signed_by_user_id,
      nurse_designee_name = v_signature.signed_by_name,
      legacy_cleanup_flag = false,
      caregiver_signature_status = v_next_caregiver_status,
      updated_at = coalesce(v_signature.signed_at, v_signed_at, now())
    where id = p_care_plan_id;

    return query
    select
      v_signature.care_plan_id,
      v_signature.member_id,
      v_signature.signed_by_user_id,
      v_signature.signed_by_name,
      v_signature.signed_at,
      v_signature.status,
      v_signature.signature_artifact_storage_path,
      v_signature.signature_artifact_member_file_id,
      coalesce(v_signature.signature_metadata, '{}'::jsonb),
      v_next_caregiver_status,
      true;
    return;
  end if;

  if coalesce(v_care_plan.nurse_signature_status, '') = 'signed' then
    insert into public.care_plan_nurse_signatures (
      care_plan_id,
      member_id,
      signed_by_user_id,
      signed_by_name,
      signed_at,
      status,
      signature_artifact_storage_path,
      signature_artifact_member_file_id,
      signature_metadata,
      created_at,
      updated_at
    )
    values (
      v_care_plan.id,
      v_care_plan.member_id,
      coalesce(v_care_plan.nurse_signed_by_user_id, p_signed_by_user_id),
      coalesce(nullif(trim(coalesce(v_care_plan.nurse_signed_by_name, '')), ''), v_signed_by_name),
      coalesce(v_care_plan.nurse_signed_at, v_signed_at),
      'signed',
      coalesce(v_care_plan.nurse_signature_artifact_storage_path, v_signature_artifact_storage_path),
      coalesce(v_care_plan.nurse_signature_artifact_member_file_id, v_signature_artifact_member_file_id),
      coalesce(v_care_plan.nurse_signature_metadata, v_signature_metadata, '{}'::jsonb),
      coalesce(v_care_plan.created_at, now()),
      coalesce(v_care_plan.updated_at, v_signed_at, now())
    )
    on conflict (care_plan_id) do update
    set
      signed_by_user_id = excluded.signed_by_user_id,
      signed_by_name = excluded.signed_by_name,
      signed_at = excluded.signed_at,
      status = 'signed',
      signature_artifact_storage_path = coalesce(excluded.signature_artifact_storage_path, public.care_plan_nurse_signatures.signature_artifact_storage_path),
      signature_artifact_member_file_id = coalesce(excluded.signature_artifact_member_file_id, public.care_plan_nurse_signatures.signature_artifact_member_file_id),
      signature_metadata = coalesce(excluded.signature_metadata, public.care_plan_nurse_signatures.signature_metadata),
      updated_at = excluded.updated_at
    returning * into v_signature;

    return query
    select
      v_signature.care_plan_id,
      v_signature.member_id,
      v_signature.signed_by_user_id,
      v_signature.signed_by_name,
      v_signature.signed_at,
      v_signature.status,
      v_signature.signature_artifact_storage_path,
      v_signature.signature_artifact_member_file_id,
      coalesce(v_signature.signature_metadata, '{}'::jsonb),
      v_next_caregiver_status,
      true;
    return;
  end if;

  v_completion_date := coalesce(v_care_plan.review_date, (v_signed_at at time zone 'America/New_York')::date);

  insert into public.care_plan_nurse_signatures (
    care_plan_id,
    member_id,
    signed_by_user_id,
    signed_by_name,
    signed_at,
    status,
    signature_artifact_storage_path,
    signature_artifact_member_file_id,
    signature_metadata,
    created_at,
    updated_at
  )
  values (
    p_care_plan_id,
    p_member_id,
    p_signed_by_user_id,
    v_signed_by_name,
    v_signed_at,
    'signed',
    v_signature_artifact_storage_path,
    v_signature_artifact_member_file_id,
    v_signature_metadata,
    v_signed_at,
    v_signed_at
  )
  on conflict (care_plan_id) do update
  set
    signed_by_user_id = excluded.signed_by_user_id,
    signed_by_name = excluded.signed_by_name,
    signed_at = excluded.signed_at,
    status = 'signed',
    signature_artifact_storage_path = coalesce(excluded.signature_artifact_storage_path, public.care_plan_nurse_signatures.signature_artifact_storage_path),
    signature_artifact_member_file_id = coalesce(excluded.signature_artifact_member_file_id, public.care_plan_nurse_signatures.signature_artifact_member_file_id),
    signature_metadata = coalesce(excluded.signature_metadata, public.care_plan_nurse_signatures.signature_metadata),
    updated_at = excluded.updated_at
  returning * into v_signature;

  update public.care_plans
  set
    nurse_signature_status = 'signed',
    nurse_signed_by_user_id = p_signed_by_user_id,
    nurse_signed_by_name = v_signed_by_name,
    nurse_signed_at = v_signed_at,
    nurse_signature_artifact_storage_path = v_signature_artifact_storage_path,
    nurse_signature_artifact_member_file_id = v_signature_artifact_member_file_id,
    nurse_signature_metadata = v_signature_metadata,
    completed_by = v_signed_by_name,
    date_of_completion = v_completion_date,
    administrator_signature = v_signed_by_name,
    administrator_signature_date = v_completion_date,
    nurse_designee_user_id = p_signed_by_user_id,
    nurse_designee_name = v_signed_by_name,
    legacy_cleanup_flag = false,
    caregiver_signature_status = v_next_caregiver_status,
    updated_at = v_signed_at
  where id = p_care_plan_id;

  return query
  select
    v_signature.care_plan_id,
    v_signature.member_id,
    v_signature.signed_by_user_id,
    v_signature.signed_by_name,
    v_signature.signed_at,
    v_signature.status,
    v_signature.signature_artifact_storage_path,
    v_signature.signature_artifact_member_file_id,
    coalesce(v_signature.signature_metadata, '{}'::jsonb),
    v_next_caregiver_status,
    false;
end;
$$;

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

  if coalesce(v_request.status, '') in ('completed', 'filed') then
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

  if coalesce(v_request.status, '') not in ('prepared', 'sent', 'opened', 'partially_completed') then
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
    coalesce(p_completed_at, now()),
    coalesce(p_completed_at, now()),
    coalesce(p_completed_at, now())
  );

  update public.enrollment_packet_uploads
  set
    finalization_status = 'finalized',
    finalized_at = coalesce(p_filed_at, now())
  where packet_id = p_packet_id
    and finalization_status = 'staged'
    and (
      p_upload_batch_id is null
      or finalization_batch_id = p_upload_batch_id
    );

  update public.enrollment_packet_requests
  set
    status = 'filed',
    completed_at = coalesce(p_completed_at, now()),
    token = p_rotated_token,
    last_consumed_submission_token_hash = coalesce(v_consumed_submission_token_hash, last_consumed_submission_token_hash),
    mapping_sync_status = 'pending',
    mapping_sync_error = null,
    mapping_sync_attempted_at = null,
    updated_at = coalesce(p_filed_at, now())
  where id = p_packet_id;

  insert into public.enrollment_packet_events (
    packet_id,
    event_type,
    actor_user_id,
    actor_email,
    timestamp,
    metadata
  )
  values
    (
      p_packet_id,
      'Enrollment Packet Completed',
      null,
      nullif(trim(coalesce(p_actor_email, '')), ''),
      coalesce(p_completed_at, now()),
      coalesce(p_completed_metadata, '{}'::jsonb)
    ),
    (
      p_packet_id,
      'filed',
      p_actor_user_id,
      null,
      coalesce(p_filed_at, now()),
      coalesce(p_filed_metadata, '{}'::jsonb)
    );

  return query
  select
    p_packet_id,
    'filed',
    'pending',
    false;
end;
$$;

grant execute on function public.rpc_finalize_pof_signature(
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
  uuid,
  text,
  timestamptz,
  timestamptz,
  text,
  jsonb,
  text
) to authenticated, service_role;

grant execute on function public.rpc_finalize_care_plan_caregiver_signature(
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
  text,
  text,
  text,
  text,
  text,
  jsonb
) to authenticated, service_role;

grant execute on function public.rpc_finalize_care_plan_nurse_signature(
  uuid,
  uuid,
  uuid,
  text,
  timestamptz,
  text,
  text,
  jsonb
) to authenticated, service_role;

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
