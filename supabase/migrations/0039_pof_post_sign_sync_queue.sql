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
