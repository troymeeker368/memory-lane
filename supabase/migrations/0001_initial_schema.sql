create extension if not exists pgcrypto;

create type app_role as enum ('admin', 'director', 'manager', 'sales', 'nurse', 'coordinator', 'program-assistant', 'staff');
create type lead_status as enum ('open', 'won', 'lost');
create type punch_type as enum ('in', 'out');

create table if not exists public.sites (
  id uuid primary key default gen_random_uuid(),
  site_code text unique not null,
  site_name text not null,
  latitude numeric(10,7),
  longitude numeric(10,7),
  fence_radius_meters integer default 75,
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text not null,
  staff_id text unique,
  role app_role not null default 'program-assistant',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.members (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  status text not null default 'active',
  qr_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.time_punches (
  id uuid primary key default gen_random_uuid(),
  staff_user_id uuid not null references public.profiles(id),
  site_id uuid references public.sites(id),
  punch_type punch_type not null,
  punch_at timestamptz not null default now(),
  lat numeric(10,7),
  lng numeric(10,7),
  distance_meters integer,
  within_fence boolean,
  meal_deduct_minutes integer default 0,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.time_punch_exceptions (
  id uuid primary key default gen_random_uuid(),
  staff_user_id uuid not null references public.profiles(id),
  punch_id uuid references public.time_punches(id),
  exception_type text not null,
  message text not null,
  resolved boolean not null default false,
  resolved_by uuid references public.profiles(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.daily_activity_logs (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id),
  activity_date date not null,
  staff_user_id uuid not null references public.profiles(id),
  activity_1_level smallint,
  activity_2_level smallint,
  activity_3_level smallint,
  activity_4_level smallint,
  activity_5_level smallint,
  missing_reason_1 text,
  missing_reason_2 text,
  missing_reason_3 text,
  missing_reason_4 text,
  missing_reason_5 text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.toilet_logs (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id),
  event_at timestamptz not null default now(),
  briefs boolean,
  use_type text,
  staff_user_id uuid not null references public.profiles(id),
  notes text
);

create table if not exists public.shower_logs (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id),
  event_at timestamptz not null default now(),
  laundry boolean,
  briefs boolean,
  staff_user_id uuid not null references public.profiles(id)
);

create table if not exists public.transportation_logs (
  id uuid primary key default gen_random_uuid(),
  member_id uuid references public.members(id),
  first_name text,
  period text check (period in ('AM', 'PM')),
  transport_type text,
  service_date date not null,
  staff_user_id uuid references public.profiles(id),
  created_at timestamptz default now()
);

create table if not exists public.blood_sugar_logs (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id),
  checked_at timestamptz not null default now(),
  reading_mg_dl integer not null,
  nurse_user_id uuid references public.profiles(id),
  notes text
);

create table if not exists public.member_photo_uploads (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id),
  photo_url text not null,
  uploaded_by uuid not null references public.profiles(id),
  uploaded_at timestamptz not null default now()
);

create table if not exists public.documentation_tracker (
  id uuid primary key default gen_random_uuid(),
  member_id uuid references public.members(id),
  member_name text not null,
  start_date date,
  last_care_plan_update date,
  next_care_plan_due date,
  care_plan_done boolean default false,
  last_progress_note date,
  next_progress_note_due date,
  note_done boolean default false,
  assigned_staff_user_id uuid references public.profiles(id),
  assigned_staff_name text,
  qr_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.documentation_assignments (
  id uuid primary key default gen_random_uuid(),
  member_id uuid references public.members(id),
  assignment_type text not null,
  due_at timestamptz not null,
  completed boolean not null default false,
  completed_at timestamptz,
  assigned_staff_user_id uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.documentation_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  event_table text not null,
  event_row_id uuid not null,
  member_id uuid references public.members(id),
  staff_user_id uuid references public.profiles(id),
  event_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.mar_entries (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id),
  medication_name text not null,
  due_at timestamptz not null,
  administered_at timestamptz,
  nurse_user_id uuid references public.profiles(id),
  status text not null default 'scheduled',
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.ancillary_charge_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  price_cents integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.ancillary_charge_logs (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id),
  category_id uuid not null references public.ancillary_charge_categories(id),
  service_date date not null,
  late_pickup_time time,
  staff_user_id uuid references public.profiles(id),
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  status lead_status not null default 'open',
  stage text not null,
  stage_updated_at timestamptz not null default now(),
  inquiry_date date,
  tour_date date,
  tour_completed boolean default false,
  discovery_date date,
  member_start_date date,
  caregiver_name text,
  caregiver_relationship text,
  caregiver_email text,
  caregiver_phone text,
  member_name text not null,
  lead_source text,
  referral_name text,
  likelihood text,
  next_follow_up_date date,
  next_follow_up_type text,
  notes_summary text,
  lost_reason text,
  closed_date date,
  created_by_user_id uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.lead_activities (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  member_name text,
  activity_at timestamptz not null,
  activity_type text not null,
  outcome text,
  lost_reason text,
  notes text,
  next_follow_up_date date,
  next_follow_up_type text,
  completed_by_user_id uuid references public.profiles(id),
  completed_by_name text,
  created_at timestamptz default now()
);

create table if not exists public.community_partner_organizations (
  id uuid primary key default gen_random_uuid(),
  organization_name text not null,
  category text,
  location text,
  primary_phone text,
  secondary_phone text,
  primary_email text,
  active boolean not null default true,
  notes text,
  last_touched date
);

create table if not exists public.referral_sources (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid references public.community_partner_organizations(id),
  contact_name text,
  organization_name text,
  job_title text,
  primary_phone text,
  secondary_phone text,
  primary_email text,
  preferred_contact_method text,
  active boolean not null default true,
  notes text,
  last_touched date
);

create table if not exists public.partner_activities (
  id uuid primary key default gen_random_uuid(),
  referral_source_id uuid references public.referral_sources(id),
  partner_id uuid references public.community_partner_organizations(id),
  organization_name text,
  contact_name text,
  activity_at timestamptz,
  activity_type text,
  notes text,
  completed_by_name text,
  next_follow_up_date date,
  next_follow_up_type text,
  last_touched date
);

create table if not exists public.email_logs (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads(id),
  recipient_email text not null,
  subject text not null,
  template_key text,
  sent_at timestamptz not null default now(),
  sent_by_user_id uuid references public.profiles(id),
  status text not null,
  provider_message_id text,
  payload jsonb
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references public.profiles(id),
  actor_role app_role,
  action text not null,
  entity_type text not null,
  entity_id text,
  details jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.lookup_lists (
  id uuid primary key default gen_random_uuid(),
  list_name text not null,
  value text not null,
  sort_order integer default 0,
  active boolean default true,
  unique (list_name, value)
);

create table if not exists public.pto_requests (
  id uuid primary key default gen_random_uuid(),
  staff_user_id uuid references public.profiles(id),
  starts_on date not null,
  ends_on date not null,
  hours_requested numeric(6,2),
  reason text,
  status text not null default 'pending',
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  created_at timestamptz default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.log_documentation_event()
returns trigger
language plpgsql
as $$
begin
  insert into public.documentation_events(event_type, event_table, event_row_id, member_id, staff_user_id, event_at)
  values (tg_table_name, tg_table_name, new.id, new.member_id, new.staff_user_id, coalesce(new.created_at, now()));
  return new;
end;
$$;

drop trigger if exists trg_profiles_updated on public.profiles;
create trigger trg_profiles_updated before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists trg_members_updated on public.members;
create trigger trg_members_updated before update on public.members
for each row execute function public.set_updated_at();

drop trigger if exists trg_doc_tracker_updated on public.documentation_tracker;
create trigger trg_doc_tracker_updated before update on public.documentation_tracker
for each row execute function public.set_updated_at();

drop trigger if exists trg_leads_updated on public.leads;
create trigger trg_leads_updated before update on public.leads
for each row execute function public.set_updated_at();

drop trigger if exists trg_daily_activity_event on public.daily_activity_logs;
create trigger trg_daily_activity_event after insert on public.daily_activity_logs
for each row execute function public.log_documentation_event();

drop trigger if exists trg_toilet_event on public.toilet_logs;
create trigger trg_toilet_event after insert on public.toilet_logs
for each row execute function public.log_documentation_event();

drop trigger if exists trg_shower_event on public.shower_logs;
create trigger trg_shower_event after insert on public.shower_logs
for each row execute function public.log_documentation_event();

create or replace view public.v_today_at_a_glance as
select
  p.full_name as staff_name,
  count(*) filter (where de.event_table = 'daily_activity_logs') as participation_count,
  count(*) filter (where de.event_table = 'toilet_logs') as toilet_count,
  count(*) filter (where de.event_table = 'shower_logs') as shower_count,
  count(*) filter (where de.event_table = 'transportation_logs') as transport_count,
  count(*) filter (where de.event_table = 'ancillary_charge_logs') as ancillary_count,
  count(*) as total_count,
  (count(*) > 0) as uploaded_today
from public.profiles p
left join public.documentation_events de
  on de.staff_user_id = p.id
 and de.event_at >= date_trunc('day', now())
 and de.event_at < date_trunc('day', now()) + interval '1 day'
where p.active = true
group by p.id, p.full_name;

create or replace view public.v_timely_docs_summary as
select
  p.full_name as staff_name,
  count(*) filter (where de.event_at <= (date_trunc('day', de.event_at) + interval '20 hour')) as on_time,
  count(*) filter (where de.event_at > (date_trunc('day', de.event_at) + interval '20 hour')) as late,
  count(*) as total,
  coalesce(
    (count(*) filter (where de.event_at <= (date_trunc('day', de.event_at) + interval '20 hour'))::numeric / nullif(count(*), 0)),
    0
  ) as on_time_percent
from public.documentation_events de
join public.profiles p on p.id = de.staff_user_id
group by p.id, p.full_name;

create or replace view public.v_last_toileted as
select
  m.display_name as member_name,
  lt.last_toileted_at,
  lt.staff_name
from public.members m
left join lateral (
  select
    t.event_at as last_toileted_at,
    p.full_name as staff_name
  from public.toilet_logs t
  left join public.profiles p on p.id = t.staff_user_id
  where t.member_id = m.id
  order by t.event_at desc
  limit 1
) lt on true;

create or replace view public.v_biweekly_totals as
with ordered as (
  select
    tp.*,
    row_number() over (partition by staff_user_id order by punch_at) as rn
  from public.time_punches tp
  where punch_at >= now() - interval '14 day'
),
pairs as (
  select
    i.staff_user_id,
    i.punch_at as in_at,
    o.punch_at as out_at,
    greatest(extract(epoch from (o.punch_at - i.punch_at)) / 3600.0, 0) as raw_hours
  from ordered i
  join ordered o on o.staff_user_id = i.staff_user_id and o.rn = i.rn + 1
  where i.punch_type = 'in' and o.punch_type = 'out'
)
select
  p.full_name as staff_name,
  round(coalesce(sum(raw_hours), 0)::numeric, 2) as regular_hours,
  round(coalesce(sum(case when raw_hours >= 6 then 0.5 else 0 end), 0)::numeric, 2) as meal_deduct_hours,
  round(coalesce(sum(raw_hours - case when raw_hours >= 6 then 0.5 else 0 end), 0)::numeric, 2) as payable_hours,
  coalesce((select count(*) from public.time_punch_exceptions tpe where tpe.staff_user_id = pairs.staff_user_id and resolved = false), 0) as exception_count
from pairs
join public.profiles p on p.id = pairs.staff_user_id
group by pairs.staff_user_id, p.full_name;

create or replace view public.v_lead_pipeline_stage_counts as
select stage, count(*)::int as count
from public.leads
where status = 'open'
group by stage;

create or replace view public.v_monthly_ancillary_summary as
select
  to_char(date_trunc('month', service_date), 'Mon-YYYY') as month_label,
  c.name as category_name,
  count(*)::int as total_count,
  sum(c.price_cents)::int as total_amount_cents
from public.ancillary_charge_logs l
join public.ancillary_charge_categories c on c.id = l.category_id
group by date_trunc('month', service_date), c.name
order by date_trunc('month', service_date) desc, c.name;

create or replace view public.v_ancillary_charge_logs_detailed as
select
  l.id,
  l.member_id,
  m.display_name as member_name,
  l.category_id,
  c.name as category_name,
  c.price_cents as amount_cents,
  l.service_date,
  l.late_pickup_time,
  l.staff_user_id,
  p.full_name as staff_name,
  l.notes,
  l.created_at
from public.ancillary_charge_logs l
join public.members m on m.id = l.member_id
join public.ancillary_charge_categories c on c.id = l.category_id
left join public.profiles p on p.id = l.staff_user_id;

create or replace view public.v_mar_entries_detailed as
select
  me.id,
  me.member_id,
  m.display_name as member_name,
  me.medication_name,
  me.due_at,
  me.administered_at,
  me.nurse_user_id,
  p.full_name as nurse_name,
  me.status,
  me.notes,
  me.created_at
from public.mar_entries me
join public.members m on m.id = me.member_id
left join public.profiles p on p.id = me.nurse_user_id;

create or replace view public.v_blood_sugar_logs_detailed as
select
  b.id,
  b.member_id,
  m.display_name as member_name,
  b.checked_at,
  b.reading_mg_dl,
  b.nurse_user_id,
  p.full_name as nurse_name,
  b.notes
from public.blood_sugar_logs b
join public.members m on m.id = b.member_id
left join public.profiles p on p.id = b.nurse_user_id;

create or replace function public.current_role()
returns app_role
language sql
stable
as $$
  select role from public.profiles where id = auth.uid()
$$;

alter table public.profiles enable row level security;
alter table public.members enable row level security;
alter table public.time_punches enable row level security;
alter table public.time_punch_exceptions enable row level security;
alter table public.daily_activity_logs enable row level security;
alter table public.toilet_logs enable row level security;
alter table public.shower_logs enable row level security;
alter table public.transportation_logs enable row level security;
alter table public.documentation_tracker enable row level security;
alter table public.documentation_assignments enable row level security;
alter table public.documentation_events enable row level security;
alter table public.mar_entries enable row level security;
alter table public.blood_sugar_logs enable row level security;
alter table public.ancillary_charge_categories enable row level security;
alter table public.ancillary_charge_logs enable row level security;
alter table public.leads enable row level security;
alter table public.lead_activities enable row level security;
alter table public.referral_sources enable row level security;
alter table public.community_partner_organizations enable row level security;
alter table public.partner_activities enable row level security;
alter table public.email_logs enable row level security;
alter table public.audit_logs enable row level security;
alter table public.pto_requests enable row level security;

create policy "profiles_self_or_admin" on public.profiles
for select
using (id = auth.uid() or public.current_role() in ('admin', 'manager'));

create policy "members_read" on public.members
for select using (auth.uid() is not null);

create policy "time_punches_read" on public.time_punches
for select using (staff_user_id = auth.uid() or public.current_role() in ('admin', 'manager'));

create policy "time_punches_insert" on public.time_punches
for insert with check (staff_user_id = auth.uid() or public.current_role() in ('admin', 'manager'));

create policy "doc_read" on public.daily_activity_logs for select using (auth.uid() is not null);
create policy "doc_insert" on public.daily_activity_logs for insert with check (staff_user_id = auth.uid() or public.current_role() in ('manager', 'admin'));
create policy "toilet_read" on public.toilet_logs for select using (auth.uid() is not null);
create policy "shower_read" on public.shower_logs for select using (auth.uid() is not null);
create policy "transport_read" on public.transportation_logs for select using (auth.uid() is not null);

create policy "tracker_read" on public.documentation_tracker for select using (auth.uid() is not null);
create policy "assign_read" on public.documentation_assignments for select using (auth.uid() is not null);
create policy "events_read" on public.documentation_events for select using (auth.uid() is not null);

create policy "health_read" on public.mar_entries for select using (public.current_role() in ('admin', 'manager', 'nurse'));
create policy "health_read_glucose" on public.blood_sugar_logs for select using (public.current_role() in ('admin', 'manager', 'nurse'));

create policy "ancillary_categories_read" on public.ancillary_charge_categories for select using (auth.uid() is not null);
create policy "ancillary_read" on public.ancillary_charge_logs for select using (auth.uid() is not null);
create policy "ancillary_insert" on public.ancillary_charge_logs for insert with check (staff_user_id = auth.uid() or public.current_role() in ('manager', 'admin'));

create policy "leads_read" on public.leads for select using (public.current_role() in ('admin', 'manager'));
create policy "leads_insert" on public.leads for insert with check (public.current_role() in ('admin', 'manager'));
create policy "lead_activities_read" on public.lead_activities for select using (public.current_role() in ('admin', 'manager'));

create policy "referral_read" on public.referral_sources for select using (public.current_role() in ('admin', 'manager'));
create policy "partner_read" on public.community_partner_organizations for select using (public.current_role() in ('admin', 'manager'));

create policy "audit_read" on public.audit_logs for select using (public.current_role() in ('admin', 'manager'));
create policy "audit_insert" on public.audit_logs for insert with check (actor_user_id = auth.uid());

create policy "pto_read" on public.pto_requests for select using (staff_user_id = auth.uid() or public.current_role() in ('admin', 'manager'));
create policy "pto_insert" on public.pto_requests for insert with check (staff_user_id = auth.uid());


