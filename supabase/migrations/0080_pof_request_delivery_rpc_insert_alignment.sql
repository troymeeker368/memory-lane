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

  if p_request_id is not null then
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

    if found then
      was_created := false;
      request_id := v_request_id;
      return next;
      return;
    end if;
  end if;

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

  request_id := v_request_id;
  return next;
end;
$$;
