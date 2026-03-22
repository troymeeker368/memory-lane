create table if not exists public.enrollment_packet_follow_up_queue (
  id uuid primary key default gen_random_uuid(),
  packet_id uuid not null references public.enrollment_packet_requests(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete set null,
  task_type text not null,
  status text not null default 'action_required',
  title text not null,
  message text not null,
  action_url text not null,
  payload jsonb not null default '{}'::jsonb,
  attempt_count integer not null default 1,
  last_error text,
  last_attempted_at timestamptz,
  resolved_at timestamptz,
  created_by_user_id uuid,
  created_by_name text,
  updated_by_user_id uuid,
  updated_by_name text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint enrollment_packet_follow_up_queue_task_type_check
    check (task_type in ('lead_activity_sync', 'critical_notification_delivery')),
  constraint enrollment_packet_follow_up_queue_status_check
    check (status in ('action_required', 'completed')),
  constraint enrollment_packet_follow_up_queue_attempt_count_check
    check (attempt_count >= 0),
  constraint enrollment_packet_follow_up_queue_packet_task_unique
    unique (packet_id, task_type)
);

create index if not exists idx_enrollment_packet_follow_up_queue_status_updated
  on public.enrollment_packet_follow_up_queue(status, updated_at desc);

create index if not exists idx_enrollment_packet_follow_up_queue_packet_status
  on public.enrollment_packet_follow_up_queue(packet_id, status, updated_at desc);

drop trigger if exists trg_enrollment_packet_follow_up_queue_updated on public.enrollment_packet_follow_up_queue;
create trigger trg_enrollment_packet_follow_up_queue_updated
before update on public.enrollment_packet_follow_up_queue
for each row execute function public.set_updated_at();

alter table public.enrollment_packet_follow_up_queue enable row level security;

drop policy if exists "enrollment_packet_follow_up_queue_read_internal" on public.enrollment_packet_follow_up_queue;
drop policy if exists "enrollment_packet_follow_up_queue_service_insert" on public.enrollment_packet_follow_up_queue;
drop policy if exists "enrollment_packet_follow_up_queue_service_update" on public.enrollment_packet_follow_up_queue;

create policy "enrollment_packet_follow_up_queue_read_internal"
on public.enrollment_packet_follow_up_queue
for select
to authenticated
using (true);

create policy "enrollment_packet_follow_up_queue_service_insert"
on public.enrollment_packet_follow_up_queue
for insert
to service_role
with check (true);

create policy "enrollment_packet_follow_up_queue_service_update"
on public.enrollment_packet_follow_up_queue
for update
to service_role
using (true)
with check (true);
