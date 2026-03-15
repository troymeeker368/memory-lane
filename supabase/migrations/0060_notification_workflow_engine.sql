alter table public.user_notifications
  add column if not exists actor_user_id uuid references public.profiles(id) on delete set null,
  add column if not exists event_type text not null default 'legacy_notification',
  add column if not exists status text not null default 'unread',
  add column if not exists priority text not null default 'medium',
  add column if not exists action_url text,
  add column if not exists event_key text not null default gen_random_uuid()::text;

update public.user_notifications
set status = case when read_at is null then 'unread' else 'read' end
where status not in ('unread', 'read', 'dismissed');

alter table public.user_notifications
  drop constraint if exists user_notifications_status_check;

alter table public.user_notifications
  add constraint user_notifications_status_check
  check (status in ('unread', 'read', 'dismissed'));

alter table public.user_notifications
  drop constraint if exists user_notifications_priority_check;

alter table public.user_notifications
  add constraint user_notifications_priority_check
  check (priority in ('low', 'medium', 'high', 'critical'));

create unique index if not exists idx_user_notifications_event_key
  on public.user_notifications(event_key);

create index if not exists idx_user_notifications_recipient_status_created
  on public.user_notifications(recipient_user_id, status, created_at desc);

create index if not exists idx_user_notifications_event_type_created
  on public.user_notifications(event_type, created_at desc);
