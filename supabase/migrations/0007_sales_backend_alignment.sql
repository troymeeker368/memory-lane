alter table public.members
  add column if not exists enrollment_date date,
  add column if not exists dob date,
  add column if not exists source_lead_id uuid references public.leads(id) on delete set null;

create index if not exists idx_members_source_lead_id on public.members(source_lead_id);

alter table public.leads
  add column if not exists member_dob date,
  add column if not exists lead_source_other text,
  add column if not exists partner_id text,
  add column if not exists referral_source_id text,
  add column if not exists created_by_name text;

create index if not exists idx_leads_partner_id on public.leads(partner_id);
create index if not exists idx_leads_referral_source_id on public.leads(referral_source_id);

alter table public.community_partner_organizations
  add column if not exists partner_id text unique;

alter table public.referral_sources
  add column if not exists referral_source_id text unique;

alter table public.lead_activities
  add column if not exists partner_id text,
  add column if not exists referral_source_id text;

create index if not exists idx_lead_activities_partner_id on public.lead_activities(partner_id);
create index if not exists idx_lead_activities_referral_source_id on public.lead_activities(referral_source_id);

alter table public.partner_activities
  add column if not exists lead_id uuid references public.leads(id) on delete set null,
  add column if not exists completed_by_user_id uuid references public.profiles(id),
  add column if not exists completed_by text;

create table if not exists public.lead_stage_history (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  from_stage text,
  to_stage text not null,
  from_status text,
  to_status text not null,
  changed_by_user_id uuid references public.profiles(id),
  changed_by_name text,
  reason text,
  source text,
  changed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_lead_stage_history_lead_id on public.lead_stage_history(lead_id, changed_at desc);

alter table public.lead_stage_history enable row level security;

drop policy if exists "leads_read" on public.leads;
drop policy if exists "leads_insert" on public.leads;
create policy "leads_read" on public.leads
for select using (public.current_role() in ('admin', 'manager', 'director', 'sales'));
create policy "leads_insert" on public.leads
for insert with check (public.current_role() in ('admin', 'manager', 'director', 'sales'));

drop policy if exists "leads_update" on public.leads;
create policy "leads_update" on public.leads
for update using (public.current_role() in ('admin', 'manager', 'director', 'sales'))
with check (public.current_role() in ('admin', 'manager', 'director', 'sales'));

drop policy if exists "lead_activities_read" on public.lead_activities;
create policy "lead_activities_read" on public.lead_activities
for select using (public.current_role() in ('admin', 'manager', 'director', 'sales'));

drop policy if exists "lead_activities_insert" on public.lead_activities;
create policy "lead_activities_insert" on public.lead_activities
for insert with check (public.current_role() in ('admin', 'manager', 'director', 'sales'));

drop policy if exists "referral_read" on public.referral_sources;
create policy "referral_read" on public.referral_sources
for select using (public.current_role() in ('admin', 'manager', 'director', 'sales'));

drop policy if exists "referral_insert" on public.referral_sources;
create policy "referral_insert" on public.referral_sources
for insert with check (public.current_role() in ('admin', 'manager', 'director', 'sales'));

drop policy if exists "referral_update" on public.referral_sources;
create policy "referral_update" on public.referral_sources
for update using (public.current_role() in ('admin', 'manager', 'director', 'sales'))
with check (public.current_role() in ('admin', 'manager', 'director', 'sales'));

drop policy if exists "partner_read" on public.community_partner_organizations;
create policy "partner_read" on public.community_partner_organizations
for select using (public.current_role() in ('admin', 'manager', 'director', 'sales'));

drop policy if exists "partner_insert" on public.community_partner_organizations;
create policy "partner_insert" on public.community_partner_organizations
for insert with check (public.current_role() in ('admin', 'manager', 'director', 'sales'));

drop policy if exists "partner_update" on public.community_partner_organizations;
create policy "partner_update" on public.community_partner_organizations
for update using (public.current_role() in ('admin', 'manager', 'director', 'sales'))
with check (public.current_role() in ('admin', 'manager', 'director', 'sales'));

alter table public.partner_activities enable row level security;
drop policy if exists "partner_activities_read" on public.partner_activities;
create policy "partner_activities_read" on public.partner_activities
for select using (public.current_role() in ('admin', 'manager', 'director', 'sales'));

drop policy if exists "partner_activities_insert" on public.partner_activities;
create policy "partner_activities_insert" on public.partner_activities
for insert with check (public.current_role() in ('admin', 'manager', 'director', 'sales'));

create policy "lead_stage_history_read" on public.lead_stage_history
for select using (public.current_role() in ('admin', 'manager', 'director', 'sales'));

create policy "lead_stage_history_insert" on public.lead_stage_history
for insert with check (public.current_role() in ('admin', 'manager', 'director', 'sales'));
