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
declare
  v_current_status text;
  v_existing_final_member_file_id text;
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

  select cp.caregiver_signature_status, cp.final_member_file_id
  into v_current_status, v_existing_final_member_file_id
  from public.care_plans cp
  where cp.id = p_care_plan_id
  for update;

  if not found then
    raise exception 'Care plan was not found.';
  end if;

  if v_current_status = 'signed' then
    raise exception 'Care plan is already caregiver-signed and cannot be reset for resend.';
  end if;

  if nullif(trim(coalesce(v_existing_final_member_file_id, '')), '') is not null then
    raise exception 'Care plan already has a finalized member-file artifact and cannot be reset for resend.';
  end if;

  if coalesce(v_current_status, '') not in ('not_requested', 'ready_to_send', 'send_failed', 'sent', 'viewed', 'expired') then
    raise exception 'Care plan caregiver request cannot transition from status "%".', coalesce(v_current_status, '(null)');
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

  return query
  select
    p_care_plan_id,
    'ready_to_send'::text;
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
