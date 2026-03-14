create table if not exists public.system_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  event_type text not null,
  entity_type text not null,
  entity_id uuid,
  actor_type text,
  actor_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  request_id text,
  correlation_id text
);

create index if not exists idx_system_events_created_at on public.system_events(created_at desc);
create index if not exists idx_system_events_entity_id on public.system_events(entity_id);
create index if not exists idx_system_events_event_type on public.system_events(event_type);

alter table public.system_events enable row level security;

drop policy if exists "system_events_select" on public.system_events;
drop policy if exists "system_events_insert" on public.system_events;
create policy "system_events_select" on public.system_events for select to authenticated using (true);
create policy "system_events_insert" on public.system_events for insert to authenticated with check (true);
