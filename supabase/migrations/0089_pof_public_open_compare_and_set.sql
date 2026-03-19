drop function if exists public.rpc_transition_pof_request_delivery_state(
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
);

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
  p_update_physician_order_sent boolean default false,
  p_expected_current_status text default null
)
returns table (
  request_id uuid,
  status text,
  delivery_status text,
  physician_order_id uuid,
  did_transition boolean
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

  if nullif(trim(coalesce(p_expected_current_status, '')), '') is not null
     and v_request.status is distinct from trim(p_expected_current_status) then
    return query
    select
      p_request_id,
      v_request.status,
      v_request.delivery_status,
      v_request.physician_order_id,
      false;
    return;
  end if;

  v_status := coalesce(nullif(trim(coalesce(p_status, '')), ''), v_request.status);
  v_sent_at := coalesce(p_sent_at, v_request.sent_at);

  update public.pof_requests as pof_requests
  set
    status = v_status,
    delivery_status = trim(p_delivery_status),
    last_delivery_attempt_at = p_attempt_at,
    delivery_failed_at = case when trim(p_delivery_status) = 'send_failed' then p_attempt_at else null end,
    delivery_error = nullif(trim(coalesce(p_delivery_error, '')), ''),
    sent_at = case when p_sent_at is distinct from null then p_sent_at else pof_requests.sent_at end,
    opened_at = case when p_opened_at is distinct from null then p_opened_at else pof_requests.opened_at end,
    signed_at = case when p_signed_at is distinct from null then p_signed_at else pof_requests.signed_at end,
    updated_by_user_id = p_actor_user_id,
    updated_by_name = nullif(trim(coalesce(p_actor_name, '')), ''),
    updated_at = p_attempt_at
  where pof_requests.id = p_request_id;

  if p_update_physician_order_sent and v_status = 'sent' then
    update public.physician_orders as physician_orders
    set
      status = 'sent',
      provider_name = coalesce(nullif(trim(coalesce(p_provider_name, '')), ''), v_request.provider_name),
      sent_at = coalesce(v_sent_at, p_attempt_at),
      updated_by_user_id = p_actor_user_id,
      updated_by_name = nullif(trim(coalesce(p_actor_name, '')), ''),
      updated_at = p_attempt_at
    where physician_orders.id = v_request.physician_order_id
      and physician_orders.status <> 'signed';
  end if;

  return query
  select
    p_request_id,
    v_status,
    trim(p_delivery_status),
    v_request.physician_order_id,
    true;
end;
$$;

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
  boolean,
  text
) to authenticated, service_role;
