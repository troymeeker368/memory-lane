drop function if exists public.rpc_reconcile_expired_pof_requests(integer);

create or replace function public.rpc_reconcile_expired_pof_requests(
  p_limit integer default 100
)
returns table (
  request_id uuid,
  member_id uuid,
  physician_order_id uuid
)
language sql
security definer
set search_path = public
as $$
  with target_rows as (
    select
      pr.id,
      pr.member_id,
      pr.physician_order_id,
      pr.sent_by_user_id,
      pr.nurse_name
    from public.pof_requests pr
    where pr.expires_at < now()
      and pr.status not in ('expired', 'signed', 'declined')
    order by pr.expires_at asc
    limit greatest(1, least(coalesce(p_limit, 100), 500))
    for update skip locked
  ),
  updated_rows as (
    update public.pof_requests pr
    set
      status = 'expired',
      updated_by_user_id = target_rows.sent_by_user_id,
      updated_by_name = target_rows.nurse_name,
      updated_at = now()
    from target_rows
    where pr.id = target_rows.id
    returning
      pr.id,
      pr.member_id,
      pr.physician_order_id,
      target_rows.sent_by_user_id,
      target_rows.nurse_name
  ),
  inserted_events as (
    insert into public.document_events (
      document_type,
      document_id,
      member_id,
      physician_order_id,
      event_type,
      actor_type,
      actor_user_id,
      actor_name,
      metadata
    )
    select
      'pof_request',
      ur.id,
      ur.member_id,
      ur.physician_order_id,
      'expired',
      'system',
      ur.sent_by_user_id,
      ur.nurse_name,
      '{}'::jsonb
    from updated_rows ur
    returning document_id
  )
  select
    ur.id as request_id,
    ur.member_id,
    ur.physician_order_id
  from updated_rows ur;
$$;

grant execute on function public.rpc_reconcile_expired_pof_requests(integer) to authenticated;
grant execute on function public.rpc_reconcile_expired_pof_requests(integer) to service_role;
