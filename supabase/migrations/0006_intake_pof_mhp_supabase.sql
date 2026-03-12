create table if not exists public.intake_assessments (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete set null,
  assessment_date date not null,
  status text not null default 'completed' check (status in ('draft','completed','archived')),
  completed_by_user_id uuid references public.profiles(id),
  completed_by text,
  signed_by text,
  complete boolean not null default true,
  feeling_today text,
  health_lately text,
  allergies text,
  code_status text,
  orientation_dob_verified boolean,
  orientation_city_verified boolean,
  orientation_year_verified boolean,
  orientation_occupation_verified boolean,
  orientation_notes text,
  medication_management_status text,
  dressing_support_status text,
  assistive_devices text,
  incontinence_products text,
  on_site_medication_use text,
  on_site_medication_list text,
  independence_notes text,
  diet_type text,
  diet_other text,
  diet_restrictions_notes text,
  mobility_steadiness text,
  falls_history text,
  mobility_aids text,
  mobility_safety_notes text,
  overwhelmed_by_noise boolean,
  social_triggers text,
  emotional_wellness_notes text,
  joy_sparks text,
  personal_notes text,
  score_orientation_general_health smallint,
  score_daily_routines_independence smallint,
  score_nutrition_dietary_needs smallint,
  score_mobility_safety smallint,
  score_social_emotional_wellness smallint,
  total_score smallint,
  recommended_track text,
  admission_review_required boolean,
  transport_can_enter_exit_vehicle text,
  transport_assistance_level text,
  transport_mobility_aid text,
  transport_can_remain_seated_buckled boolean,
  transport_behavior_concern text,
  transport_appropriate boolean,
  transport_notes text,
  vitals_hr integer,
  vitals_bp text,
  vitals_o2_percent integer,
  vitals_rr integer,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_intake_assessments_member_date on public.intake_assessments(member_id, assessment_date desc);
create index if not exists idx_intake_assessments_created_at on public.intake_assessments(created_at desc);

create table if not exists public.assessment_responses (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.intake_assessments(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  field_key text not null,
  field_label text not null,
  section_type text not null,
  field_value text,
  field_value_type text,
  created_at timestamptz not null default now()
);

create index if not exists idx_assessment_responses_assessment on public.assessment_responses(assessment_id);

create table if not exists public.physician_orders (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  intake_assessment_id uuid references public.intake_assessments(id) on delete set null,
  version_number integer not null,
  status text not null check (status in ('draft','sent','signed','expired','superseded')),
  is_active_signed boolean not null default false,
  superseded_by uuid references public.physician_orders(id) on delete set null,
  superseded_at timestamptz,
  sent_at timestamptz,
  signed_at timestamptz,
  effective_at timestamptz,
  next_renewal_due_date date,
  member_name_snapshot text,
  member_dob_snapshot text,
  sex text,
  level_of_care text,
  dnr_selected boolean not null default false,
  vitals_blood_pressure text,
  vitals_pulse text,
  vitals_oxygen_saturation text,
  vitals_respiration text,
  diagnoses jsonb not null default '[]'::jsonb,
  allergies jsonb not null default '[]'::jsonb,
  medications jsonb not null default '[]'::jsonb,
  standing_orders jsonb not null default '[]'::jsonb,
  diet_order jsonb not null default '{}'::jsonb,
  mobility_order jsonb not null default '{}'::jsonb,
  adl_support jsonb not null default '{}'::jsonb,
  continence_support jsonb not null default '{}'::jsonb,
  behavior_orientation jsonb not null default '{}'::jsonb,
  clinical_support jsonb not null default '{}'::jsonb,
  nutrition_orders jsonb not null default '{}'::jsonb,
  operational_flags jsonb not null default '{}'::jsonb,
  provider_name text,
  provider_signature text,
  provider_signature_date date,
  signed_by_name text,
  signature_metadata jsonb not null default '{}'::jsonb,
  created_by_user_id uuid references public.profiles(id),
  created_by_name text,
  updated_by_user_id uuid references public.profiles(id),
  updated_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uniq_physician_orders_member_version on public.physician_orders(member_id, version_number);
create index if not exists idx_physician_orders_member_status on public.physician_orders(member_id, status, updated_at desc);
create index if not exists idx_physician_orders_intake on public.physician_orders(intake_assessment_id);
create unique index if not exists uniq_physician_orders_active_signed on public.physician_orders(member_id) where is_active_signed = true;

create table if not exists public.member_health_profiles (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null unique references public.members(id) on delete cascade,
  active_physician_order_id uuid references public.physician_orders(id) on delete set null,
  diagnoses jsonb not null default '[]'::jsonb,
  allergies jsonb not null default '[]'::jsonb,
  medications jsonb not null default '[]'::jsonb,
  diet jsonb not null default '{}'::jsonb,
  mobility jsonb not null default '{}'::jsonb,
  adl_support jsonb not null default '{}'::jsonb,
  continence jsonb not null default '{}'::jsonb,
  behavior_orientation jsonb not null default '{}'::jsonb,
  clinical_support jsonb not null default '{}'::jsonb,
  operational_flags jsonb not null default '{}'::jsonb,
  profile_notes text,
  joy_sparks text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_member_health_profiles_active_order on public.member_health_profiles(active_physician_order_id);

drop trigger if exists trg_intake_assessments_updated on public.intake_assessments;
create trigger trg_intake_assessments_updated before update on public.intake_assessments
for each row execute function public.set_updated_at();

drop trigger if exists trg_physician_orders_updated on public.physician_orders;
create trigger trg_physician_orders_updated before update on public.physician_orders
for each row execute function public.set_updated_at();

drop trigger if exists trg_member_health_profiles_updated on public.member_health_profiles;
create trigger trg_member_health_profiles_updated before update on public.member_health_profiles
for each row execute function public.set_updated_at();

alter table public.intake_assessments enable row level security;
alter table public.assessment_responses enable row level security;
alter table public.physician_orders enable row level security;
alter table public.member_health_profiles enable row level security;

drop policy if exists "intake_assessments_select" on public.intake_assessments;
drop policy if exists "intake_assessments_insert" on public.intake_assessments;
drop policy if exists "intake_assessments_update" on public.intake_assessments;
create policy "intake_assessments_select" on public.intake_assessments for select to authenticated using (true);
create policy "intake_assessments_insert" on public.intake_assessments for insert to authenticated with check (true);
create policy "intake_assessments_update" on public.intake_assessments for update to authenticated using (true) with check (true);

drop policy if exists "assessment_responses_select" on public.assessment_responses;
drop policy if exists "assessment_responses_insert" on public.assessment_responses;
drop policy if exists "assessment_responses_update" on public.assessment_responses;
create policy "assessment_responses_select" on public.assessment_responses for select to authenticated using (true);
create policy "assessment_responses_insert" on public.assessment_responses for insert to authenticated with check (true);
create policy "assessment_responses_update" on public.assessment_responses for update to authenticated using (true) with check (true);

drop policy if exists "physician_orders_select" on public.physician_orders;
drop policy if exists "physician_orders_insert" on public.physician_orders;
drop policy if exists "physician_orders_update" on public.physician_orders;
create policy "physician_orders_select" on public.physician_orders for select to authenticated using (true);
create policy "physician_orders_insert" on public.physician_orders for insert to authenticated with check (true);
create policy "physician_orders_update" on public.physician_orders for update to authenticated using (true) with check (true);

drop policy if exists "member_health_profiles_select" on public.member_health_profiles;
drop policy if exists "member_health_profiles_insert" on public.member_health_profiles;
drop policy if exists "member_health_profiles_update" on public.member_health_profiles;
create policy "member_health_profiles_select" on public.member_health_profiles for select to authenticated using (true);
create policy "member_health_profiles_insert" on public.member_health_profiles for insert to authenticated with check (true);
create policy "member_health_profiles_update" on public.member_health_profiles for update to authenticated using (true) with check (true);
