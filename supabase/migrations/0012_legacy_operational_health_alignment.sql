create table if not exists public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  attendance_date date not null,
  status text not null check (status in ('present', 'absent')),
  absent_reason text,
  absent_reason_other text,
  check_in_at timestamptz,
  check_out_at timestamptz,
  notes text,
  recorded_by_user_id uuid references public.profiles(id) on delete set null,
  recorded_by_name text,
  scheduled_day boolean,
  unscheduled_day boolean,
  billable_extra_day boolean,
  billing_status text check (billing_status in ('Unbilled', 'Billed', 'Excluded')),
  linked_adjustment_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(member_id, attendance_date)
);

create index if not exists idx_attendance_records_member_date
  on public.attendance_records (member_id, attendance_date desc);

create table if not exists public.closure_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  rule_type text not null check (rule_type in ('fixed', 'nth_weekday')),
  month integer not null check (month between 1 and 12),
  day integer check (day between 1 and 31),
  weekday text check (weekday in ('sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday')),
  occurrence text check (occurrence in ('first', 'second', 'third', 'fourth', 'last')),
  observed_when_weekend text not null default 'none'
    check (observed_when_weekend in ('none', 'friday', 'monday', 'nearest_weekday')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by_user_id uuid references public.profiles(id) on delete set null,
  updated_by_name text
);

create table if not exists public.center_closures (
  id uuid primary key default gen_random_uuid(),
  closure_date date not null,
  closure_name text not null,
  closure_type text not null check (closure_type in ('Holiday', 'Weather', 'Planned', 'Emergency', 'Other')),
  auto_generated boolean not null default false,
  closure_rule_id uuid references public.closure_rules(id) on delete set null,
  billable_override boolean not null default false,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by_user_id uuid references public.profiles(id) on delete set null,
  updated_by_name text
);

create index if not exists idx_center_closures_date
  on public.center_closures (closure_date desc);

create table if not exists public.member_diagnoses (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  diagnosis_type text not null check (diagnosis_type in ('primary', 'secondary')),
  diagnosis_name text not null,
  diagnosis_code text,
  date_added date not null,
  comments text,
  created_by_user_id uuid references public.profiles(id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_member_diagnoses_member
  on public.member_diagnoses (member_id, date_added desc);

create table if not exists public.member_medications (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  medication_name text not null,
  date_started date,
  medication_status text not null check (medication_status in ('active', 'inactive')),
  inactivated_at date,
  dose text,
  quantity text,
  form text,
  frequency text,
  route text,
  route_laterality text,
  comments text,
  created_by_user_id uuid references public.profiles(id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_member_medications_member
  on public.member_medications (member_id, updated_at desc);

create table if not exists public.member_providers (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  provider_name text not null,
  specialty text,
  specialty_other text,
  practice_name text,
  provider_phone text,
  created_by_user_id uuid references public.profiles(id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_member_providers_member
  on public.member_providers (member_id, updated_at desc);

create table if not exists public.provider_directory (
  id uuid primary key default gen_random_uuid(),
  provider_name text not null,
  specialty text,
  specialty_other text,
  practice_name text,
  provider_phone text,
  created_by_user_id uuid references public.profiles(id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_provider_directory_name_practice
  on public.provider_directory ((lower(btrim(provider_name))), (lower(btrim(coalesce(practice_name, '')))));

create table if not exists public.hospital_preference_directory (
  id uuid primary key default gen_random_uuid(),
  hospital_name text not null,
  created_by_user_id uuid references public.profiles(id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_hospital_preference_directory_name
  on public.hospital_preference_directory ((lower(btrim(hospital_name))));

create table if not exists public.member_equipment (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  equipment_type text not null,
  provider_source text,
  status text,
  comments text,
  created_by_user_id uuid references public.profiles(id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_member_equipment_member
  on public.member_equipment (member_id, updated_at desc);

create table if not exists public.member_notes (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  note_type text not null,
  note_text text not null,
  created_by_user_id uuid references public.profiles(id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_member_notes_member
  on public.member_notes (member_id, created_at desc);

drop trigger if exists trg_attendance_records_updated on public.attendance_records;
create trigger trg_attendance_records_updated before update on public.attendance_records
for each row execute function public.set_updated_at();

drop trigger if exists trg_closure_rules_updated on public.closure_rules;
create trigger trg_closure_rules_updated before update on public.closure_rules
for each row execute function public.set_updated_at();

drop trigger if exists trg_center_closures_updated on public.center_closures;
create trigger trg_center_closures_updated before update on public.center_closures
for each row execute function public.set_updated_at();

drop trigger if exists trg_member_diagnoses_updated on public.member_diagnoses;
create trigger trg_member_diagnoses_updated before update on public.member_diagnoses
for each row execute function public.set_updated_at();

drop trigger if exists trg_member_medications_updated on public.member_medications;
create trigger trg_member_medications_updated before update on public.member_medications
for each row execute function public.set_updated_at();

drop trigger if exists trg_member_providers_updated on public.member_providers;
create trigger trg_member_providers_updated before update on public.member_providers
for each row execute function public.set_updated_at();

drop trigger if exists trg_provider_directory_updated on public.provider_directory;
create trigger trg_provider_directory_updated before update on public.provider_directory
for each row execute function public.set_updated_at();

drop trigger if exists trg_hospital_preference_directory_updated on public.hospital_preference_directory;
create trigger trg_hospital_preference_directory_updated before update on public.hospital_preference_directory
for each row execute function public.set_updated_at();

drop trigger if exists trg_member_equipment_updated on public.member_equipment;
create trigger trg_member_equipment_updated before update on public.member_equipment
for each row execute function public.set_updated_at();

drop trigger if exists trg_member_notes_updated on public.member_notes;
create trigger trg_member_notes_updated before update on public.member_notes
for each row execute function public.set_updated_at();

alter table public.attendance_records enable row level security;
alter table public.closure_rules enable row level security;
alter table public.center_closures enable row level security;
alter table public.member_diagnoses enable row level security;
alter table public.member_medications enable row level security;
alter table public.member_providers enable row level security;
alter table public.provider_directory enable row level security;
alter table public.hospital_preference_directory enable row level security;
alter table public.member_equipment enable row level security;
alter table public.member_notes enable row level security;

drop policy if exists "attendance_records_select" on public.attendance_records;
drop policy if exists "attendance_records_insert" on public.attendance_records;
drop policy if exists "attendance_records_update" on public.attendance_records;
create policy "attendance_records_select" on public.attendance_records for select to authenticated using (true);
create policy "attendance_records_insert" on public.attendance_records for insert to authenticated with check (true);
create policy "attendance_records_update" on public.attendance_records for update to authenticated using (true) with check (true);

drop policy if exists "closure_rules_select" on public.closure_rules;
drop policy if exists "closure_rules_insert" on public.closure_rules;
drop policy if exists "closure_rules_update" on public.closure_rules;
create policy "closure_rules_select" on public.closure_rules for select to authenticated using (true);
create policy "closure_rules_insert" on public.closure_rules for insert to authenticated with check (true);
create policy "closure_rules_update" on public.closure_rules for update to authenticated using (true) with check (true);

drop policy if exists "center_closures_select" on public.center_closures;
drop policy if exists "center_closures_insert" on public.center_closures;
drop policy if exists "center_closures_update" on public.center_closures;
drop policy if exists "center_closures_delete" on public.center_closures;
create policy "center_closures_select" on public.center_closures for select to authenticated using (true);
create policy "center_closures_insert" on public.center_closures for insert to authenticated with check (true);
create policy "center_closures_update" on public.center_closures for update to authenticated using (true) with check (true);
create policy "center_closures_delete" on public.center_closures for delete to authenticated using (true);

drop policy if exists "member_diagnoses_select" on public.member_diagnoses;
drop policy if exists "member_diagnoses_insert" on public.member_diagnoses;
drop policy if exists "member_diagnoses_update" on public.member_diagnoses;
drop policy if exists "member_diagnoses_delete" on public.member_diagnoses;
create policy "member_diagnoses_select" on public.member_diagnoses for select to authenticated using (true);
create policy "member_diagnoses_insert" on public.member_diagnoses for insert to authenticated with check (true);
create policy "member_diagnoses_update" on public.member_diagnoses for update to authenticated using (true) with check (true);
create policy "member_diagnoses_delete" on public.member_diagnoses for delete to authenticated using (true);

drop policy if exists "member_medications_select" on public.member_medications;
drop policy if exists "member_medications_insert" on public.member_medications;
drop policy if exists "member_medications_update" on public.member_medications;
drop policy if exists "member_medications_delete" on public.member_medications;
create policy "member_medications_select" on public.member_medications for select to authenticated using (true);
create policy "member_medications_insert" on public.member_medications for insert to authenticated with check (true);
create policy "member_medications_update" on public.member_medications for update to authenticated using (true) with check (true);
create policy "member_medications_delete" on public.member_medications for delete to authenticated using (true);

drop policy if exists "member_providers_select" on public.member_providers;
drop policy if exists "member_providers_insert" on public.member_providers;
drop policy if exists "member_providers_update" on public.member_providers;
drop policy if exists "member_providers_delete" on public.member_providers;
create policy "member_providers_select" on public.member_providers for select to authenticated using (true);
create policy "member_providers_insert" on public.member_providers for insert to authenticated with check (true);
create policy "member_providers_update" on public.member_providers for update to authenticated using (true) with check (true);
create policy "member_providers_delete" on public.member_providers for delete to authenticated using (true);

drop policy if exists "provider_directory_select" on public.provider_directory;
drop policy if exists "provider_directory_insert" on public.provider_directory;
drop policy if exists "provider_directory_update" on public.provider_directory;
drop policy if exists "provider_directory_delete" on public.provider_directory;
create policy "provider_directory_select" on public.provider_directory for select to authenticated using (true);
create policy "provider_directory_insert" on public.provider_directory for insert to authenticated with check (true);
create policy "provider_directory_update" on public.provider_directory for update to authenticated using (true) with check (true);
create policy "provider_directory_delete" on public.provider_directory for delete to authenticated using (true);

drop policy if exists "hospital_preference_directory_select" on public.hospital_preference_directory;
drop policy if exists "hospital_preference_directory_insert" on public.hospital_preference_directory;
drop policy if exists "hospital_preference_directory_update" on public.hospital_preference_directory;
drop policy if exists "hospital_preference_directory_delete" on public.hospital_preference_directory;
create policy "hospital_preference_directory_select" on public.hospital_preference_directory for select to authenticated using (true);
create policy "hospital_preference_directory_insert" on public.hospital_preference_directory for insert to authenticated with check (true);
create policy "hospital_preference_directory_update" on public.hospital_preference_directory for update to authenticated using (true) with check (true);
create policy "hospital_preference_directory_delete" on public.hospital_preference_directory for delete to authenticated using (true);

drop policy if exists "member_equipment_select" on public.member_equipment;
drop policy if exists "member_equipment_insert" on public.member_equipment;
drop policy if exists "member_equipment_update" on public.member_equipment;
drop policy if exists "member_equipment_delete" on public.member_equipment;
create policy "member_equipment_select" on public.member_equipment for select to authenticated using (true);
create policy "member_equipment_insert" on public.member_equipment for insert to authenticated with check (true);
create policy "member_equipment_update" on public.member_equipment for update to authenticated using (true) with check (true);
create policy "member_equipment_delete" on public.member_equipment for delete to authenticated using (true);

drop policy if exists "member_notes_select" on public.member_notes;
drop policy if exists "member_notes_insert" on public.member_notes;
drop policy if exists "member_notes_update" on public.member_notes;
drop policy if exists "member_notes_delete" on public.member_notes;
create policy "member_notes_select" on public.member_notes for select to authenticated using (true);
create policy "member_notes_insert" on public.member_notes for insert to authenticated with check (true);
create policy "member_notes_update" on public.member_notes for update to authenticated using (true) with check (true);
create policy "member_notes_delete" on public.member_notes for delete to authenticated using (true);
