create sequence if not exists public.incident_number_seq start with 1 increment by 1;

create or replace function public.generate_incident_number()
returns text
language sql
as $$
  select 'IR-' || to_char(now() at time zone 'America/New_York', 'YYYY') || '-' || lpad(nextval('public.incident_number_seq')::text, 6, '0');
$$;

create table if not exists public.incidents (
  id uuid primary key default gen_random_uuid(),
  incident_number text not null unique default public.generate_incident_number(),
  incident_category text not null,
  reportable boolean not null default false,
  participant_id uuid references public.members(id) on delete set null,
  participant_name_snapshot text,
  staff_member_id uuid references public.profiles(id) on delete set null,
  staff_member_name_snapshot text,
  reporter_user_id uuid not null references public.profiles(id) on delete restrict,
  reporter_name_snapshot text not null,
  additional_parties text,
  incident_datetime timestamptz not null,
  reported_datetime timestamptz not null,
  location text not null,
  exact_location_details text,
  description text not null,
  unsafe_conditions_present boolean not null default false,
  unsafe_conditions_description text,
  injured_by text,
  injury_type text,
  body_part text,
  general_notes text,
  follow_up_note text,
  status text not null default 'draft',
  submitted_at timestamptz,
  submitted_by_user_id uuid references public.profiles(id) on delete set null,
  submitted_by_name_snapshot text,
  director_reviewed_by uuid references public.profiles(id) on delete set null,
  director_reviewed_at timestamptz,
  director_decision text,
  director_signature_name text,
  director_review_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint incidents_category_check
    check (
      incident_category in (
        'fall',
        'behavioral',
        'medication',
        'injury',
        'elopement',
        'transportation',
        'choking',
        'environmental',
        'staff_injury',
        'other'
      )
    ),
  constraint incidents_status_check
    check (status in ('draft', 'submitted', 'returned', 'approved', 'closed')),
  constraint incidents_director_decision_check
    check (director_decision is null or director_decision in ('approved', 'returned')),
  constraint incidents_unsafe_conditions_required
    check (
      unsafe_conditions_present = false
      or nullif(trim(coalesce(unsafe_conditions_description, '')), '') is not null
    )
);

create table if not exists public.incident_history (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents(id) on delete cascade,
  action text not null,
  user_id uuid references public.profiles(id) on delete set null,
  user_name_snapshot text,
  notes text,
  previous_value jsonb,
  new_value jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_incidents_status_updated_at
  on public.incidents(status, updated_at desc);

create index if not exists idx_incidents_incident_datetime
  on public.incidents(incident_datetime desc);

create index if not exists idx_incidents_reportable_status
  on public.incidents(reportable, status, incident_datetime desc);

create index if not exists idx_incidents_participant_incident_datetime
  on public.incidents(participant_id, incident_datetime desc);

create index if not exists idx_incident_history_incident_created_at
  on public.incident_history(incident_id, created_at asc);

drop trigger if exists trg_incidents_updated on public.incidents;
create trigger trg_incidents_updated
before update on public.incidents
for each row execute function public.set_updated_at();

alter table public.incidents enable row level security;
alter table public.incident_history enable row level security;

drop policy if exists "incidents_select_internal" on public.incidents;
drop policy if exists "incidents_service_insert" on public.incidents;
drop policy if exists "incidents_service_update" on public.incidents;
drop policy if exists "incident_history_select_internal" on public.incident_history;
drop policy if exists "incident_history_service_insert" on public.incident_history;

create policy "incidents_select_internal"
on public.incidents
for select
to authenticated
using (auth.uid() is not null);

create policy "incidents_service_insert"
on public.incidents
for insert
to service_role
with check (true);

create policy "incidents_service_update"
on public.incidents
for update
to service_role
using (true)
with check (true);

create policy "incident_history_select_internal"
on public.incident_history
for select
to authenticated
using (auth.uid() is not null);

create policy "incident_history_service_insert"
on public.incident_history
for insert
to service_role
with check (true);
