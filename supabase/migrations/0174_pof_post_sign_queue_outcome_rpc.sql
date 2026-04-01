create or replace function public.rpc_finalize_pof_post_sign_sync_queue(
  p_queue_id uuid,
  p_status text,
  p_attempt_count integer,
  p_last_attempt_at timestamptz,
  p_next_retry_at timestamptz default null,
  p_last_error text default null,
  p_last_error_at timestamptz default null,
  p_last_failed_step text default null,
  p_pof_request_id uuid default null,
  p_actor_user_id uuid default null,
  p_actor_name text default null
)
returns table (
  queue_id uuid,
  status text,
  attempt_count integer,
  next_retry_at timestamptz,
  last_error text,
  last_failed_step text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.pof_post_sign_sync_queue%rowtype;
  v_status text := lower(trim(coalesce(p_status, '')));
  v_last_failed_step text := nullif(trim(coalesce(p_last_failed_step, '')), '');
begin
  if p_queue_id is null then
    raise exception 'rpc_finalize_pof_post_sign_sync_queue requires p_queue_id';
  end if;
  if v_status not in ('queued', 'completed') then
    raise exception 'rpc_finalize_pof_post_sign_sync_queue requires queued or completed status';
  end if;
  if coalesce(p_attempt_count, -1) < 0 then
    raise exception 'rpc_finalize_pof_post_sign_sync_queue requires non-negative p_attempt_count';
  end if;
  if v_status = 'queued' and p_next_retry_at is null then
    raise exception 'rpc_finalize_pof_post_sign_sync_queue requires p_next_retry_at when queueing';
  end if;
  if v_status = 'queued' and v_last_failed_step is null then
    raise exception 'rpc_finalize_pof_post_sign_sync_queue requires p_last_failed_step when queueing';
  end if;

  select *
  into v_row
  from public.pof_post_sign_sync_queue
  where id = p_queue_id
  for update;

  if not found then
    raise exception 'POF post-sign sync queue row % was not found.', p_queue_id;
  end if;

  update public.pof_post_sign_sync_queue
  set
    status = v_status,
    attempt_count = p_attempt_count,
    last_attempt_at = p_last_attempt_at,
    next_retry_at = case when v_status = 'completed' then null else p_next_retry_at end,
    last_error = case when v_status = 'completed' then null else nullif(trim(coalesce(p_last_error, '')), '') end,
    last_error_at = case when v_status = 'completed' then null else p_last_error_at end,
    last_failed_step = case when v_status = 'completed' then null else v_last_failed_step end,
    pof_request_id = coalesce(p_pof_request_id, pof_request_id),
    claimed_at = null,
    claimed_by_user_id = null,
    claimed_by_name = null,
    queued_by_user_id = case when v_status = 'queued' then p_actor_user_id else queued_by_user_id end,
    queued_by_name = case when v_status = 'queued' then nullif(trim(coalesce(p_actor_name, '')), '') else queued_by_name end,
    resolved_at = case when v_status = 'completed' then p_last_attempt_at else null end,
    resolved_by_user_id = case when v_status = 'completed' then p_actor_user_id else null end,
    resolved_by_name = case when v_status = 'completed' then nullif(trim(coalesce(p_actor_name, '')), '') else null end
  where id = p_queue_id;

  return query
  select
    v_row.id,
    v_status,
    p_attempt_count,
    case when v_status = 'completed' then null else p_next_retry_at end,
    case when v_status = 'completed' then null else nullif(trim(coalesce(p_last_error, '')), '') end,
    case when v_status = 'completed' then null else v_last_failed_step end;
end;
$$;

grant execute on function public.rpc_finalize_pof_post_sign_sync_queue(
  uuid,
  text,
  integer,
  timestamptz,
  timestamptz,
  text,
  timestamptz,
  text,
  uuid,
  uuid,
  text
) to authenticated, service_role;
