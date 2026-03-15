alter table public.system_events
  add column if not exists actor_user_id uuid references public.profiles(id) on delete set null,
  add column if not exists status text,
  add column if not exists severity text;

update public.system_events
set actor_user_id = actor_id
where actor_user_id is null
  and actor_type = 'user'
  and actor_id is not null;

create index if not exists idx_system_events_status_created_at
  on public.system_events(status, created_at desc)
  where status is not null;

create index if not exists idx_system_events_severity_created_at
  on public.system_events(severity, created_at desc)
  where severity is not null;

create index if not exists idx_system_events_entity_type_created_at
  on public.system_events(entity_type, created_at desc);
