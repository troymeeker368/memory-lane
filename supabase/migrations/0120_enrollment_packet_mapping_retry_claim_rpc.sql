alter table public.enrollment_packet_requests
  add column if not exists mapping_sync_claimed_at timestamptz,
  add column if not exists mapping_sync_claimed_by_user_id uuid references public.profiles(id) on delete set null,
  add column if not exists mapping_sync_claimed_by_name text;

create index if not exists idx_enrollment_packet_requests_mapping_sync_claimed_at
  on public.enrollment_packet_requests(mapping_sync_claimed_at);

create or replace function public.rpc_claim_enrollment_packet_mapping_retries(
  p_limit integer default 25,
  p_now timestamptz default now(),
  p_actor_user_id uuid default null,
  p_actor_name text default null
)
returns table (
  id uuid,
  member_id uuid,
  lead_id uuid,
  sender_user_id uuid,
  caregiver_email text,
  status text,
  mapping_sync_status text,
  mapping_sync_error text,
  mapping_sync_attempted_at timestamptz,
  latest_mapping_run_id uuid
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
    from public.enrollment_packet_requests q
    where q.mapping_sync_status = 'failed'
      and q.status in ('completed', 'filed')
      and (
        q.mapping_sync_claimed_at is null
        or q.mapping_sync_claimed_at <= (p_now - interval '10 minutes')
      )
    order by coalesce(q.mapping_sync_attempted_at, q.updated_at, q.created_at), q.created_at, q.id
    for update skip locked
    limit v_limit
  )
  update public.enrollment_packet_requests q
  set
    mapping_sync_claimed_at = p_now,
    mapping_sync_claimed_by_user_id = p_actor_user_id,
    mapping_sync_claimed_by_name = v_actor_name,
    updated_at = p_now
  from claimable
  where q.id = claimable.id
  returning
    q.id,
    q.member_id,
    q.lead_id,
    q.sender_user_id,
    q.caregiver_email,
    q.status,
    q.mapping_sync_status,
    q.mapping_sync_error,
    q.mapping_sync_attempted_at,
    q.latest_mapping_run_id;
end;
$$;
