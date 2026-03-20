alter table public.pof_post_sign_sync_queue
  add column if not exists claimed_at timestamptz,
  add column if not exists claimed_by_user_id uuid references public.profiles(id) on delete set null,
  add column if not exists claimed_by_name text;

alter table public.pof_post_sign_sync_queue
  drop constraint if exists pof_post_sign_sync_queue_status_check;

alter table public.pof_post_sign_sync_queue
  add constraint pof_post_sign_sync_queue_status_check
  check (status in ('queued', 'processing', 'completed'));

create or replace function public.rpc_claim_pof_post_sign_sync_queue(
  p_limit integer default 25,
  p_now timestamptz default now(),
  p_actor_user_id uuid default null,
  p_actor_name text default null
)
returns table (
  id uuid,
  physician_order_id uuid,
  member_id uuid,
  pof_request_id uuid,
  status text,
  attempt_count integer,
  next_retry_at timestamptz,
  signature_completed_at timestamptz,
  queued_at timestamptz,
  last_error text,
  last_failed_step text
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 25), 100));
  v_actor_name text := nullif(trim(coalesce(p_actor_name, '')), '');
begin
  return query
  with claimable as (
    select q.id
    from public.pof_post_sign_sync_queue q
    where
      (
        q.status = 'queued'
        and (q.next_retry_at is null or q.next_retry_at <= p_now)
      )
      or (
        q.status = 'processing'
        and q.claimed_at is not null
        and q.claimed_at <= (p_now - interval '10 minutes')
      )
    order by coalesce(q.next_retry_at, q.signature_completed_at, q.queued_at, q.created_at), q.created_at, q.id
    for update skip locked
    limit v_limit
  )
  update public.pof_post_sign_sync_queue q
  set
    status = 'processing',
    claimed_at = p_now,
    claimed_by_user_id = p_actor_user_id,
    claimed_by_name = v_actor_name,
    updated_at = p_now
  from claimable
  where q.id = claimable.id
  returning
    q.id,
    q.physician_order_id,
    q.member_id,
    q.pof_request_id,
    q.status,
    q.attempt_count,
    q.next_retry_at,
    q.signature_completed_at,
    q.queued_at,
    q.last_error,
    q.last_failed_step;
end;
$$;
