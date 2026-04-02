alter table public.enrollment_packet_requests
  add column if not exists completion_follow_up_status text not null default 'not_started',
  add column if not exists completion_follow_up_error text,
  add column if not exists completion_follow_up_checked_at timestamptz;

alter table public.enrollment_packet_requests
  drop constraint if exists enrollment_packet_requests_completion_follow_up_status_check;

alter table public.enrollment_packet_requests
  add constraint enrollment_packet_requests_completion_follow_up_status_check
  check (completion_follow_up_status in ('not_started', 'pending', 'completed', 'action_required'));

update public.enrollment_packet_requests
set
  completion_follow_up_status = case
    when status in ('completed', 'filed') and coalesce(mapping_sync_status, '') = 'completed' then 'completed'
    when status in ('completed', 'filed') and coalesce(mapping_sync_status, '') = 'failed' then 'action_required'
    when status in ('completed', 'filed') then 'pending'
    else 'not_started'
  end,
  completion_follow_up_error = case
    when status in ('completed', 'filed') and coalesce(mapping_sync_status, '') = 'failed'
      then coalesce(nullif(trim(coalesce(mapping_sync_error, '')), ''), 'Enrollment packet follow-up needs staff review.')
    else null
  end,
  completion_follow_up_checked_at = case
    when status in ('completed', 'filed')
      then coalesce(mapping_sync_attempted_at, completed_at, updated_at, created_at)
    else null
  end;

create index if not exists idx_enrollment_packet_requests_completion_follow_up_status_updated_at
  on public.enrollment_packet_requests(completion_follow_up_status, updated_at desc);

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
    completion_follow_up_status = 'pending',
    completion_follow_up_error = null,
    completion_follow_up_checked_at = null,
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
