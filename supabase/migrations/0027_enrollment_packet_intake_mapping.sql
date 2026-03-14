alter table public.enrollment_packet_fields
  add column if not exists intake_payload jsonb not null default '{}'::jsonb;

alter table public.members
  add column if not exists preferred_name text,
  add column if not exists legal_first_name text,
  add column if not exists legal_last_name text,
  add column if not exists ssn_last4 text;

alter table public.member_command_centers
  add column if not exists guardian_poa_status text,
  add column if not exists pcp_name text,
  add column if not exists pcp_phone text,
  add column if not exists pcp_fax text,
  add column if not exists pcp_address text,
  add column if not exists pharmacy text,
  add column if not exists living_situation text,
  add column if not exists insurance_summary_reference text;

alter table public.member_health_profiles
  add column if not exists oxygen_use text,
  add column if not exists mental_health_history text,
  add column if not exists falls_history text,
  add column if not exists physical_health_problems text,
  add column if not exists communication_style text,
  add column if not exists mobility_aids text,
  add column if not exists incontinence_products text,
  add column if not exists glasses_hearing_aids_cataracts text,
  add column if not exists intake_notes text;

create table if not exists public.enrollment_packet_pof_staging (
  id uuid primary key default gen_random_uuid(),
  packet_id uuid not null unique references public.enrollment_packet_requests(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  pcp_name text,
  physician_phone text,
  physician_fax text,
  physician_address text,
  pharmacy text,
  allergies_summary text,
  dietary_restrictions text,
  oxygen_use text,
  mobility_support text,
  adl_support jsonb not null default '{}'::jsonb,
  diagnosis_placeholders text,
  intake_notes text,
  prefill_payload jsonb not null default '{}'::jsonb,
  review_required boolean not null default true,
  updated_by_user_id uuid references public.profiles(id) on delete set null,
  updated_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_enrollment_packet_pof_staging_member_updated
  on public.enrollment_packet_pof_staging(member_id, updated_at desc);

create table if not exists public.enrollment_packet_mapping_runs (
  id uuid primary key default gen_random_uuid(),
  packet_id uuid not null references public.enrollment_packet_requests(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  actor_user_id uuid references public.profiles(id) on delete set null,
  actor_email text,
  actor_name text,
  status text not null default 'running' check (status in ('running', 'completed', 'failed')),
  summary jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_enrollment_packet_mapping_runs_packet_started
  on public.enrollment_packet_mapping_runs(packet_id, started_at desc);
create index if not exists idx_enrollment_packet_mapping_runs_member_started
  on public.enrollment_packet_mapping_runs(member_id, started_at desc);

create table if not exists public.enrollment_packet_mapping_records (
  id uuid primary key default gen_random_uuid(),
  mapping_run_id uuid not null references public.enrollment_packet_mapping_runs(id) on delete cascade,
  packet_id uuid not null references public.enrollment_packet_requests(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  target_system text not null check (target_system in ('mcc', 'mhp', 'pof_staging', 'member_files')),
  target_table text not null,
  target_field text not null,
  source_field text,
  status text not null check (status in ('written', 'skipped', 'conflict', 'staged', 'error')),
  source_value text,
  destination_value text,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists idx_enrollment_packet_mapping_records_run
  on public.enrollment_packet_mapping_records(mapping_run_id, created_at asc);
create index if not exists idx_enrollment_packet_mapping_records_packet
  on public.enrollment_packet_mapping_records(packet_id, created_at asc);

create table if not exists public.enrollment_packet_field_conflicts (
  id uuid primary key default gen_random_uuid(),
  mapping_run_id uuid not null references public.enrollment_packet_mapping_runs(id) on delete cascade,
  packet_id uuid not null references public.enrollment_packet_requests(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  target_system text not null check (target_system in ('mcc', 'mhp', 'pof_staging', 'member_files')),
  target_table text not null,
  target_field text not null,
  source_field text,
  source_value text,
  destination_value text,
  status text not null default 'open' check (status in ('open', 'resolved')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by_user_id uuid references public.profiles(id) on delete set null,
  resolution_notes text
);

create index if not exists idx_enrollment_packet_field_conflicts_packet_status
  on public.enrollment_packet_field_conflicts(packet_id, status, created_at desc);
create index if not exists idx_enrollment_packet_field_conflicts_member_status
  on public.enrollment_packet_field_conflicts(member_id, status, created_at desc);

alter table public.enrollment_packet_uploads
  drop constraint if exists enrollment_packet_uploads_upload_category_check;

alter table public.enrollment_packet_uploads
  add constraint enrollment_packet_uploads_upload_category_check
  check (
    upload_category in (
      'insurance',
      'poa',
      'supporting',
      'completed_packet',
      'signature_artifact',
      'other',
      'medicare_card',
      'private_insurance',
      'supplemental_insurance',
      'poa_guardianship',
      'dnr_dni_advance_directive',
      'signed_membership_agreement',
      'signed_exhibit_a_payment_authorization'
    )
  );

drop trigger if exists trg_enrollment_packet_pof_staging_updated on public.enrollment_packet_pof_staging;
create trigger trg_enrollment_packet_pof_staging_updated
before update on public.enrollment_packet_pof_staging
for each row execute function public.set_updated_at();

alter table public.enrollment_packet_pof_staging enable row level security;
alter table public.enrollment_packet_mapping_runs enable row level security;
alter table public.enrollment_packet_mapping_records enable row level security;
alter table public.enrollment_packet_field_conflicts enable row level security;

drop policy if exists "enrollment_packet_pof_staging_select" on public.enrollment_packet_pof_staging;
drop policy if exists "enrollment_packet_pof_staging_insert" on public.enrollment_packet_pof_staging;
drop policy if exists "enrollment_packet_pof_staging_update" on public.enrollment_packet_pof_staging;
create policy "enrollment_packet_pof_staging_select" on public.enrollment_packet_pof_staging
for select to authenticated using (true);
create policy "enrollment_packet_pof_staging_insert" on public.enrollment_packet_pof_staging
for insert to authenticated with check (true);
create policy "enrollment_packet_pof_staging_update" on public.enrollment_packet_pof_staging
for update to authenticated using (true) with check (true);

drop policy if exists "enrollment_packet_mapping_runs_select" on public.enrollment_packet_mapping_runs;
drop policy if exists "enrollment_packet_mapping_runs_insert" on public.enrollment_packet_mapping_runs;
drop policy if exists "enrollment_packet_mapping_runs_update" on public.enrollment_packet_mapping_runs;
create policy "enrollment_packet_mapping_runs_select" on public.enrollment_packet_mapping_runs
for select to authenticated using (true);
create policy "enrollment_packet_mapping_runs_insert" on public.enrollment_packet_mapping_runs
for insert to authenticated with check (true);
create policy "enrollment_packet_mapping_runs_update" on public.enrollment_packet_mapping_runs
for update to authenticated using (true) with check (true);

drop policy if exists "enrollment_packet_mapping_records_select" on public.enrollment_packet_mapping_records;
drop policy if exists "enrollment_packet_mapping_records_insert" on public.enrollment_packet_mapping_records;
create policy "enrollment_packet_mapping_records_select" on public.enrollment_packet_mapping_records
for select to authenticated using (true);
create policy "enrollment_packet_mapping_records_insert" on public.enrollment_packet_mapping_records
for insert to authenticated with check (true);

drop policy if exists "enrollment_packet_field_conflicts_select" on public.enrollment_packet_field_conflicts;
drop policy if exists "enrollment_packet_field_conflicts_insert" on public.enrollment_packet_field_conflicts;
drop policy if exists "enrollment_packet_field_conflicts_update" on public.enrollment_packet_field_conflicts;
create policy "enrollment_packet_field_conflicts_select" on public.enrollment_packet_field_conflicts
for select to authenticated using (true);
create policy "enrollment_packet_field_conflicts_insert" on public.enrollment_packet_field_conflicts
for insert to authenticated with check (true);
create policy "enrollment_packet_field_conflicts_update" on public.enrollment_packet_field_conflicts
for update to authenticated using (true) with check (true);