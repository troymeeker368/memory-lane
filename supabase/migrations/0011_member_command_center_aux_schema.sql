alter table public.members
  add column if not exists locker_number text,
  add column if not exists city text,
  add column if not exists code_status text,
  add column if not exists discharged_by text,
  add column if not exists latest_assessment_id uuid references public.intake_assessments(id) on delete set null,
  add column if not exists latest_assessment_date date,
  add column if not exists latest_assessment_score integer,
  add column if not exists latest_assessment_track text,
  add column if not exists latest_assessment_admission_review_required boolean;

create table if not exists public.member_command_centers (
  id text primary key,
  member_id uuid not null unique references public.members(id) on delete cascade,
  gender text check (gender in ('M', 'F')),
  payor text,
  original_referral_source text,
  photo_consent boolean,
  profile_image_url text,
  location text,
  street_address text,
  city text,
  state text,
  zip text,
  marital_status text,
  primary_language text,
  secondary_language text,
  religion text,
  ethnicity text,
  is_veteran boolean,
  veteran_branch text,
  code_status text,
  dnr boolean,
  dni boolean,
  polst_molst_colst text,
  hospice boolean,
  advanced_directives_obtained boolean,
  power_of_attorney text,
  funeral_home text,
  legal_comments text,
  diet_type text,
  dietary_preferences_restrictions text,
  swallowing_difficulty text,
  supplements text,
  food_dislikes text,
  foods_to_omit text,
  diet_texture text,
  no_known_allergies boolean,
  medication_allergies text,
  food_allergies text,
  environmental_allergies text,
  command_center_notes text,
  source_assessment_id uuid references public.intake_assessments(id) on delete set null,
  source_assessment_at date,
  updated_by_user_id uuid references public.profiles(id) on delete set null,
  updated_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.member_attendance_schedules (
  id text primary key,
  member_id uuid not null unique references public.members(id) on delete cascade,
  enrollment_date date,
  monday boolean not null default false,
  tuesday boolean not null default false,
  wednesday boolean not null default false,
  thursday boolean not null default false,
  friday boolean not null default false,
  full_day boolean not null default true,
  transportation_required boolean,
  transportation_mode text check (transportation_mode in ('Door to Door', 'Bus Stop')),
  transport_bus_number text,
  transportation_bus_stop text,
  transport_monday_period text check (transport_monday_period in ('AM', 'PM')),
  transport_tuesday_period text check (transport_tuesday_period in ('AM', 'PM')),
  transport_wednesday_period text check (transport_wednesday_period in ('AM', 'PM')),
  transport_thursday_period text check (transport_thursday_period in ('AM', 'PM')),
  transport_friday_period text check (transport_friday_period in ('AM', 'PM')),
  transport_monday_am_mode text check (transport_monday_am_mode in ('Door to Door', 'Bus Stop')),
  transport_monday_am_door_to_door_address text,
  transport_monday_am_bus_number text,
  transport_monday_am_bus_stop text,
  transport_monday_pm_mode text check (transport_monday_pm_mode in ('Door to Door', 'Bus Stop')),
  transport_monday_pm_door_to_door_address text,
  transport_monday_pm_bus_number text,
  transport_monday_pm_bus_stop text,
  transport_tuesday_am_mode text check (transport_tuesday_am_mode in ('Door to Door', 'Bus Stop')),
  transport_tuesday_am_door_to_door_address text,
  transport_tuesday_am_bus_number text,
  transport_tuesday_am_bus_stop text,
  transport_tuesday_pm_mode text check (transport_tuesday_pm_mode in ('Door to Door', 'Bus Stop')),
  transport_tuesday_pm_door_to_door_address text,
  transport_tuesday_pm_bus_number text,
  transport_tuesday_pm_bus_stop text,
  transport_wednesday_am_mode text check (transport_wednesday_am_mode in ('Door to Door', 'Bus Stop')),
  transport_wednesday_am_door_to_door_address text,
  transport_wednesday_am_bus_number text,
  transport_wednesday_am_bus_stop text,
  transport_wednesday_pm_mode text check (transport_wednesday_pm_mode in ('Door to Door', 'Bus Stop')),
  transport_wednesday_pm_door_to_door_address text,
  transport_wednesday_pm_bus_number text,
  transport_wednesday_pm_bus_stop text,
  transport_thursday_am_mode text check (transport_thursday_am_mode in ('Door to Door', 'Bus Stop')),
  transport_thursday_am_door_to_door_address text,
  transport_thursday_am_bus_number text,
  transport_thursday_am_bus_stop text,
  transport_thursday_pm_mode text check (transport_thursday_pm_mode in ('Door to Door', 'Bus Stop')),
  transport_thursday_pm_door_to_door_address text,
  transport_thursday_pm_bus_number text,
  transport_thursday_pm_bus_stop text,
  transport_friday_am_mode text check (transport_friday_am_mode in ('Door to Door', 'Bus Stop')),
  transport_friday_am_door_to_door_address text,
  transport_friday_am_bus_number text,
  transport_friday_am_bus_stop text,
  transport_friday_pm_mode text check (transport_friday_pm_mode in ('Door to Door', 'Bus Stop')),
  transport_friday_pm_door_to_door_address text,
  transport_friday_pm_bus_number text,
  transport_friday_pm_bus_stop text,
  daily_rate numeric(10,2),
  transportation_billing_status text not null default 'BillNormally' check (transportation_billing_status in ('BillNormally', 'Waived', 'IncludedInProgramRate')),
  billing_rate_effective_date date,
  billing_notes text,
  attendance_days_per_week integer,
  default_daily_rate numeric(10,2),
  use_custom_daily_rate boolean not null default false,
  custom_daily_rate numeric(10,2),
  make_up_days_available integer not null default 0,
  attendance_notes text,
  updated_by_user_id uuid references public.profiles(id) on delete set null,
  updated_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.member_contacts (
  id text primary key,
  member_id uuid not null references public.members(id) on delete cascade,
  contact_name text not null,
  relationship_to_member text,
  category text not null,
  category_other text,
  email text,
  cellular_number text,
  work_number text,
  home_number text,
  street_address text,
  city text,
  state text,
  zip text,
  created_by_user_id uuid references public.profiles(id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.member_files (
  id text primary key,
  member_id uuid not null references public.members(id) on delete cascade,
  file_name text not null,
  file_type text not null,
  file_data_url text,
  category text not null,
  category_other text,
  document_source text,
  uploaded_by_user_id uuid references public.profiles(id) on delete set null,
  uploaded_by_name text,
  uploaded_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bus_stop_directory (
  id text primary key,
  bus_stop_name text not null,
  created_by_user_id uuid references public.profiles(id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_bus_stop_directory_unique_name
  on public.bus_stop_directory ((lower(btrim(bus_stop_name))));

create table if not exists public.transportation_manifest_adjustments (
  id text primary key,
  selected_date date not null,
  shift text not null check (shift in ('AM', 'PM')),
  member_id uuid not null references public.members(id) on delete cascade,
  adjustment_type text not null check (adjustment_type in ('add', 'exclude')),
  bus_number text,
  transport_type text check (transport_type in ('Door to Door', 'Bus Stop')),
  bus_stop_name text,
  door_to_door_address text,
  caregiver_contact_id text references public.member_contacts(id) on delete set null,
  caregiver_contact_name_snapshot text,
  caregiver_contact_phone_snapshot text,
  caregiver_contact_address_snapshot text,
  notes text,
  created_by_user_id uuid references public.profiles(id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_transport_manifest_adjustment_unique_scope
  on public.transportation_manifest_adjustments (selected_date, shift, member_id, adjustment_type);

create table if not exists public.member_allergies (
  id text primary key,
  member_id uuid not null references public.members(id) on delete cascade,
  allergy_group text not null check (allergy_group in ('food', 'medication', 'environmental')),
  allergy_name text not null,
  severity text,
  comments text,
  created_by_user_id uuid references public.profiles(id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_member_allergies_unique_member_group_name
  on public.member_allergies (member_id, allergy_group, lower(btrim(allergy_name)));

create table if not exists public.payors (
  id text primary key,
  payor_name text not null,
  payor_type text not null,
  billing_contact_name text,
  billing_email text,
  billing_phone text,
  billing_method text not null check (billing_method in ('InvoiceEmail', 'ACHDraft', 'CardOnFile', 'Manual', 'External')),
  auto_draft_enabled boolean not null default false,
  quickbooks_customer_name text,
  quickbooks_customer_ref text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by_user_id uuid references public.profiles(id) on delete set null,
  updated_by_name text
);

create table if not exists public.member_billing_settings (
  id text primary key,
  member_id uuid not null references public.members(id) on delete cascade,
  payor_id text references public.payors(id) on delete set null,
  use_center_default_billing_mode boolean not null default true,
  billing_mode text check (billing_mode in ('Membership', 'Monthly', 'Custom')),
  monthly_billing_basis text not null default 'ScheduledMonthBehind' check (monthly_billing_basis in ('ScheduledMonthBehind', 'ActualAttendanceMonthBehind')),
  use_center_default_rate boolean not null default false,
  custom_daily_rate numeric(10,2),
  flat_monthly_rate numeric(10,2),
  bill_extra_days boolean not null default true,
  transportation_billing_status text not null default 'BillNormally' check (transportation_billing_status in ('BillNormally', 'Waived', 'IncludedInProgramRate')),
  bill_ancillary_arrears boolean not null default true,
  active boolean not null default true,
  effective_start_date date not null,
  effective_end_date date,
  billing_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by_user_id uuid references public.profiles(id) on delete set null,
  updated_by_name text
);

create index if not exists idx_member_billing_settings_member_dates
  on public.member_billing_settings (member_id, effective_start_date desc);

create table if not exists public.billing_schedule_templates (
  id text primary key,
  member_id uuid not null references public.members(id) on delete cascade,
  effective_start_date date not null,
  effective_end_date date,
  monday boolean not null default false,
  tuesday boolean not null default false,
  wednesday boolean not null default false,
  thursday boolean not null default false,
  friday boolean not null default false,
  saturday boolean not null default false,
  sunday boolean not null default false,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by_user_id uuid references public.profiles(id) on delete set null,
  updated_by_name text
);

create index if not exists idx_billing_schedule_templates_member_dates
  on public.billing_schedule_templates (member_id, effective_start_date desc);

create table if not exists public.center_billing_settings (
  id text primary key,
  default_daily_rate numeric(10,2) not null default 0,
  default_extra_day_rate numeric(10,2),
  default_transport_one_way_rate numeric(10,2) not null default 0,
  default_transport_round_trip_rate numeric(10,2) not null default 0,
  billing_cutoff_day integer not null default 25 check (billing_cutoff_day between 1 and 31),
  default_billing_mode text not null default 'Membership' check (default_billing_mode in ('Membership', 'Monthly')),
  effective_start_date date not null,
  effective_end_date date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by_user_id uuid references public.profiles(id) on delete set null,
  updated_by_name text
);

create index if not exists idx_center_billing_settings_effective_start
  on public.center_billing_settings (effective_start_date desc);

drop trigger if exists trg_member_command_centers_updated on public.member_command_centers;
create trigger trg_member_command_centers_updated before update on public.member_command_centers
for each row execute function public.set_updated_at();

drop trigger if exists trg_member_attendance_schedules_updated on public.member_attendance_schedules;
create trigger trg_member_attendance_schedules_updated before update on public.member_attendance_schedules
for each row execute function public.set_updated_at();

drop trigger if exists trg_member_contacts_updated on public.member_contacts;
create trigger trg_member_contacts_updated before update on public.member_contacts
for each row execute function public.set_updated_at();

drop trigger if exists trg_member_files_updated on public.member_files;
create trigger trg_member_files_updated before update on public.member_files
for each row execute function public.set_updated_at();

drop trigger if exists trg_bus_stop_directory_updated on public.bus_stop_directory;
create trigger trg_bus_stop_directory_updated before update on public.bus_stop_directory
for each row execute function public.set_updated_at();

drop trigger if exists trg_member_allergies_updated on public.member_allergies;
create trigger trg_member_allergies_updated before update on public.member_allergies
for each row execute function public.set_updated_at();

drop trigger if exists trg_payors_updated on public.payors;
create trigger trg_payors_updated before update on public.payors
for each row execute function public.set_updated_at();

drop trigger if exists trg_member_billing_settings_updated on public.member_billing_settings;
create trigger trg_member_billing_settings_updated before update on public.member_billing_settings
for each row execute function public.set_updated_at();

drop trigger if exists trg_billing_schedule_templates_updated on public.billing_schedule_templates;
create trigger trg_billing_schedule_templates_updated before update on public.billing_schedule_templates
for each row execute function public.set_updated_at();

drop trigger if exists trg_center_billing_settings_updated on public.center_billing_settings;
create trigger trg_center_billing_settings_updated before update on public.center_billing_settings
for each row execute function public.set_updated_at();

alter table public.member_command_centers enable row level security;
alter table public.member_attendance_schedules enable row level security;
alter table public.member_contacts enable row level security;
alter table public.member_files enable row level security;
alter table public.bus_stop_directory enable row level security;
alter table public.transportation_manifest_adjustments enable row level security;
alter table public.member_allergies enable row level security;
alter table public.payors enable row level security;
alter table public.member_billing_settings enable row level security;
alter table public.billing_schedule_templates enable row level security;
alter table public.center_billing_settings enable row level security;

drop policy if exists "member_command_centers_select" on public.member_command_centers;
drop policy if exists "member_command_centers_insert" on public.member_command_centers;
drop policy if exists "member_command_centers_update" on public.member_command_centers;
create policy "member_command_centers_select" on public.member_command_centers for select to authenticated using (true);
create policy "member_command_centers_insert" on public.member_command_centers for insert to authenticated with check (true);
create policy "member_command_centers_update" on public.member_command_centers for update to authenticated using (true) with check (true);

drop policy if exists "member_attendance_schedules_select" on public.member_attendance_schedules;
drop policy if exists "member_attendance_schedules_insert" on public.member_attendance_schedules;
drop policy if exists "member_attendance_schedules_update" on public.member_attendance_schedules;
create policy "member_attendance_schedules_select" on public.member_attendance_schedules for select to authenticated using (true);
create policy "member_attendance_schedules_insert" on public.member_attendance_schedules for insert to authenticated with check (true);
create policy "member_attendance_schedules_update" on public.member_attendance_schedules for update to authenticated using (true) with check (true);

drop policy if exists "member_contacts_select" on public.member_contacts;
drop policy if exists "member_contacts_insert" on public.member_contacts;
drop policy if exists "member_contacts_update" on public.member_contacts;
drop policy if exists "member_contacts_delete" on public.member_contacts;
create policy "member_contacts_select" on public.member_contacts for select to authenticated using (true);
create policy "member_contacts_insert" on public.member_contacts for insert to authenticated with check (true);
create policy "member_contacts_update" on public.member_contacts for update to authenticated using (true) with check (true);
create policy "member_contacts_delete" on public.member_contacts for delete to authenticated using (true);

drop policy if exists "member_files_select" on public.member_files;
drop policy if exists "member_files_insert" on public.member_files;
drop policy if exists "member_files_update" on public.member_files;
drop policy if exists "member_files_delete" on public.member_files;
create policy "member_files_select" on public.member_files for select to authenticated using (true);
create policy "member_files_insert" on public.member_files for insert to authenticated with check (true);
create policy "member_files_update" on public.member_files for update to authenticated using (true) with check (true);
create policy "member_files_delete" on public.member_files for delete to authenticated using (true);

drop policy if exists "bus_stop_directory_select" on public.bus_stop_directory;
drop policy if exists "bus_stop_directory_insert" on public.bus_stop_directory;
drop policy if exists "bus_stop_directory_update" on public.bus_stop_directory;
create policy "bus_stop_directory_select" on public.bus_stop_directory for select to authenticated using (true);
create policy "bus_stop_directory_insert" on public.bus_stop_directory for insert to authenticated with check (true);
create policy "bus_stop_directory_update" on public.bus_stop_directory for update to authenticated using (true) with check (true);

drop policy if exists "transportation_manifest_adjustments_select" on public.transportation_manifest_adjustments;
drop policy if exists "transportation_manifest_adjustments_insert" on public.transportation_manifest_adjustments;
drop policy if exists "transportation_manifest_adjustments_update" on public.transportation_manifest_adjustments;
drop policy if exists "transportation_manifest_adjustments_delete" on public.transportation_manifest_adjustments;
create policy "transportation_manifest_adjustments_select" on public.transportation_manifest_adjustments for select to authenticated using (true);
create policy "transportation_manifest_adjustments_insert" on public.transportation_manifest_adjustments for insert to authenticated with check (true);
create policy "transportation_manifest_adjustments_update" on public.transportation_manifest_adjustments for update to authenticated using (true) with check (true);
create policy "transportation_manifest_adjustments_delete" on public.transportation_manifest_adjustments for delete to authenticated using (true);

drop policy if exists "member_allergies_select" on public.member_allergies;
drop policy if exists "member_allergies_insert" on public.member_allergies;
drop policy if exists "member_allergies_update" on public.member_allergies;
drop policy if exists "member_allergies_delete" on public.member_allergies;
create policy "member_allergies_select" on public.member_allergies for select to authenticated using (true);
create policy "member_allergies_insert" on public.member_allergies for insert to authenticated with check (true);
create policy "member_allergies_update" on public.member_allergies for update to authenticated using (true) with check (true);
create policy "member_allergies_delete" on public.member_allergies for delete to authenticated using (true);

drop policy if exists "payors_select" on public.payors;
drop policy if exists "payors_insert" on public.payors;
drop policy if exists "payors_update" on public.payors;
create policy "payors_select" on public.payors for select to authenticated using (true);
create policy "payors_insert" on public.payors for insert to authenticated with check (true);
create policy "payors_update" on public.payors for update to authenticated using (true) with check (true);

drop policy if exists "member_billing_settings_select" on public.member_billing_settings;
drop policy if exists "member_billing_settings_insert" on public.member_billing_settings;
drop policy if exists "member_billing_settings_update" on public.member_billing_settings;
create policy "member_billing_settings_select" on public.member_billing_settings for select to authenticated using (true);
create policy "member_billing_settings_insert" on public.member_billing_settings for insert to authenticated with check (true);
create policy "member_billing_settings_update" on public.member_billing_settings for update to authenticated using (true) with check (true);

drop policy if exists "billing_schedule_templates_select" on public.billing_schedule_templates;
drop policy if exists "billing_schedule_templates_insert" on public.billing_schedule_templates;
drop policy if exists "billing_schedule_templates_update" on public.billing_schedule_templates;
create policy "billing_schedule_templates_select" on public.billing_schedule_templates for select to authenticated using (true);
create policy "billing_schedule_templates_insert" on public.billing_schedule_templates for insert to authenticated with check (true);
create policy "billing_schedule_templates_update" on public.billing_schedule_templates for update to authenticated using (true) with check (true);

drop policy if exists "center_billing_settings_select" on public.center_billing_settings;
drop policy if exists "center_billing_settings_insert" on public.center_billing_settings;
drop policy if exists "center_billing_settings_update" on public.center_billing_settings;
create policy "center_billing_settings_select" on public.center_billing_settings for select to authenticated using (true);
create policy "center_billing_settings_insert" on public.center_billing_settings for insert to authenticated with check (true);
create policy "center_billing_settings_update" on public.center_billing_settings for update to authenticated using (true) with check (true);
