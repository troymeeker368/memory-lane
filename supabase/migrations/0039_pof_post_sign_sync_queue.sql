create table if not exists public.pof_post_sign_sync_queue (
  id uuid primary key default gen_random_uuid(),
  physician_order_id uuid not null unique references public.physician_orders(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  pof_request_id uuid references public.pof_requests(id) on delete set null,
  status text not null default 'queued' check (status in ('queued', 'completed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_attempt_at timestamptz,
  next_retry_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  last_failed_step text check (last_failed_step in ('mhp_mcc', 'mar_medications', 'mar_schedules')),
  signature_completed_at timestamptz not null,
  queued_at timestamptz not null default now(),
  queued_by_user_id uuid references public.profiles(id) on delete set null,
  queued_by_name text,
  resolved_at timestamptz,
  resolved_by_user_id uuid references public.profiles(id) on delete set null,
  resolved_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_pof_post_sign_sync_queue_status_retry
  on public.pof_post_sign_sync_queue(status, next_retry_at);

create index if not exists idx_pof_post_sign_sync_queue_member_status
  on public.pof_post_sign_sync_queue(member_id, status, updated_at desc);

drop trigger if exists trg_pof_post_sign_sync_queue_updated on public.pof_post_sign_sync_queue;
create trigger trg_pof_post_sign_sync_queue_updated before update on public.pof_post_sign_sync_queue
for each row execute function public.set_updated_at();

alter table public.pof_post_sign_sync_queue enable row level security;

drop policy if exists "pof_post_sign_sync_queue_select" on public.pof_post_sign_sync_queue;
drop policy if exists "pof_post_sign_sync_queue_insert" on public.pof_post_sign_sync_queue;
drop policy if exists "pof_post_sign_sync_queue_update" on public.pof_post_sign_sync_queue;
create policy "pof_post_sign_sync_queue_select" on public.pof_post_sign_sync_queue for select to authenticated using (true);
create policy "pof_post_sign_sync_queue_insert" on public.pof_post_sign_sync_queue for insert to authenticated with check (true);
create policy "pof_post_sign_sync_queue_update" on public.pof_post_sign_sync_queue for update to authenticated using (true) with check (true);
