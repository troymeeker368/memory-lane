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

  update public.physician_orders as po
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

  update public.physician_orders as po
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

  insert into public.pof_post_sign_sync_queue as sync_queue (
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
  on conflict on constraint pof_post_sign_sync_queue_physician_order_id_key
  do update
  set
    member_id = excluded.member_id,
    pof_request_id = coalesce(excluded.pof_request_id, sync_queue.pof_request_id),
    signature_completed_at = excluded.signature_completed_at,
    queued_by_user_id = coalesce(excluded.queued_by_user_id, sync_queue.queued_by_user_id),
    queued_by_name = coalesce(excluded.queued_by_name, sync_queue.queued_by_name)
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
grant execute on function public.rpc_sign_physician_order(
  uuid,
  uuid,
  text,
  timestamptz,
  uuid
) to authenticated, service_role;
