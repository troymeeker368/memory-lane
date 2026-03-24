alter table public.intake_post_sign_follow_up_queue
  add column if not exists claimed_at timestamptz,
  add column if not exists claimed_by_user_id uuid references public.profiles(id) on delete set null,
  add column if not exists claimed_by_name text;

alter table public.enrollment_packet_follow_up_queue
  add column if not exists claimed_at timestamptz,
  add column if not exists claimed_by_user_id uuid references public.profiles(id) on delete set null,
  add column if not exists claimed_by_name text;

create index if not exists idx_intake_post_sign_follow_up_queue_claimed_at
  on public.intake_post_sign_follow_up_queue(claimed_at);

create index if not exists idx_enrollment_packet_follow_up_queue_claimed_at
  on public.enrollment_packet_follow_up_queue(claimed_at);

create or replace function public.rpc_claim_intake_post_sign_follow_up_task(
  p_assessment_id uuid,
  p_task_type text,
  p_now timestamptz default now(),
  p_actor_user_id uuid default null,
  p_actor_name text default null
)
returns table (
  id uuid,
  assessment_id uuid,
  member_id uuid,
  task_type text,
  status text,
  title text,
  message text,
  action_url text,
  attempt_count integer,
  last_error text,
  last_attempted_at timestamptz,
  claimed_at timestamptz,
  claimed_by_user_id uuid,
  claimed_by_name text,
  resolved_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_actor_name text := nullif(trim(coalesce(p_actor_name, '')), '');
begin
  return query
  with claimable as (
    select q.id
    from public.intake_post_sign_follow_up_queue q
    where q.assessment_id = p_assessment_id
      and q.task_type = p_task_type
      and q.status = 'action_required'
      and (
        q.claimed_at is null
        or q.claimed_at <= (p_now - interval '10 minutes')
      )
    for update skip locked
  )
  update public.intake_post_sign_follow_up_queue q
  set
    claimed_at = p_now,
    claimed_by_user_id = p_actor_user_id,
    claimed_by_name = v_actor_name,
    updated_at = p_now
  from claimable
  where q.id = claimable.id
  returning
    q.id,
    q.assessment_id,
    q.member_id,
    q.task_type,
    q.status,
    q.title,
    q.message,
    q.action_url,
    q.attempt_count,
    q.last_error,
    q.last_attempted_at,
    q.claimed_at,
    q.claimed_by_user_id,
    q.claimed_by_name,
    q.resolved_at,
    q.created_at,
    q.updated_at;
end;
$$;

create or replace function public.rpc_claim_enrollment_packet_follow_up_task(
  p_packet_id uuid,
  p_task_type text,
  p_now timestamptz default now(),
  p_actor_user_id uuid default null,
  p_actor_name text default null
)
returns table (
  id uuid,
  packet_id uuid,
  member_id uuid,
  lead_id uuid,
  task_type text,
  status text,
  title text,
  message text,
  action_url text,
  payload jsonb,
  attempt_count integer,
  last_error text,
  last_attempted_at timestamptz,
  claimed_at timestamptz,
  claimed_by_user_id uuid,
  claimed_by_name text,
  resolved_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_actor_name text := nullif(trim(coalesce(p_actor_name, '')), '');
begin
  return query
  with claimable as (
    select q.id
    from public.enrollment_packet_follow_up_queue q
    where q.packet_id = p_packet_id
      and q.task_type = p_task_type
      and q.status = 'action_required'
      and (
        q.claimed_at is null
        or q.claimed_at <= (p_now - interval '10 minutes')
      )
    for update skip locked
  )
  update public.enrollment_packet_follow_up_queue q
  set
    claimed_at = p_now,
    claimed_by_user_id = p_actor_user_id,
    claimed_by_name = v_actor_name,
    updated_at = p_now
  from claimable
  where q.id = claimable.id
  returning
    q.id,
    q.packet_id,
    q.member_id,
    q.lead_id,
    q.task_type,
    q.status,
    q.title,
    q.message,
    q.action_url,
    q.payload,
    q.attempt_count,
    q.last_error,
    q.last_attempted_at,
    q.claimed_at,
    q.claimed_by_user_id,
    q.claimed_by_name,
    q.resolved_at,
    q.created_at,
    q.updated_at;
end;
$$;

grant execute on function public.rpc_claim_intake_post_sign_follow_up_task(
  uuid,
  text,
  timestamptz,
  uuid,
  text
) to service_role;

grant execute on function public.rpc_claim_enrollment_packet_follow_up_task(
  uuid,
  text,
  timestamptz,
  uuid,
  text
) to service_role;
