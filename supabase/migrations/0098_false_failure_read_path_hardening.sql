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
  boolean,
  text
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
  p_expected_current_status text default null,
  p_expected_current_delivery_status text default null,
  p_require_opened_at_null boolean default false
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

  if nullif(trim(coalesce(p_expected_current_delivery_status, '')), '') is not null
     and coalesce(v_request.delivery_status, '') is distinct from trim(p_expected_current_delivery_status) then
    return query
    select
      p_request_id,
      v_request.status,
      v_request.delivery_status,
      v_request.physician_order_id,
      false;
    return;
  end if;

  if p_require_opened_at_null and v_request.opened_at is not null then
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
  text,
  text,
  boolean
) to authenticated, service_role;

create or replace function public.rpc_get_care_plan_summary_counts(
  p_member_id uuid default null,
  p_track text default null,
  p_query_member_ids uuid[] default null,
  p_today date default current_date
)
returns table (
  total_count bigint,
  due_soon_count bigint,
  due_now_count bigint,
  overdue_count bigint,
  completed_recently_count bigint
)
language sql
stable
set search_path = public
as $$
  with bounds as (
    select
      p_today as today,
      (p_today + 14) as due_soon_end
  ),
  filtered as (
    select cp.next_due_date
    from public.care_plans cp
    cross join bounds b
    where (p_member_id is null or cp.member_id = p_member_id)
      and (nullif(trim(coalesce(p_track, '')), '') is null or cp.track = trim(p_track))
      and (
        p_query_member_ids is null
        or cardinality(p_query_member_ids) = 0
        or cp.member_id = any(p_query_member_ids)
      )
  )
  select
    count(*)::bigint as total_count,
    count(*) filter (where filtered.next_due_date > b.today and filtered.next_due_date <= b.due_soon_end)::bigint as due_soon_count,
    count(*) filter (where filtered.next_due_date = b.today)::bigint as due_now_count,
    count(*) filter (where filtered.next_due_date < b.today)::bigint as overdue_count,
    count(*) filter (where filtered.next_due_date > b.due_soon_end)::bigint as completed_recently_count
  from filtered
  cross join bounds b;
$$;

grant execute on function public.rpc_get_care_plan_summary_counts(uuid, text, uuid[], date) to authenticated, service_role;

create index if not exists idx_mar_schedules_active_scheduled_time
  on public.mar_schedules (scheduled_time)
  where active = true;

create index if not exists idx_care_plans_next_due_date
  on public.care_plans (next_due_date asc);
