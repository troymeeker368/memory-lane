create table if not exists public.care_plans (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  track text not null check (track in ('Track 1', 'Track 2', 'Track 3')),
  enrollment_date date not null,
  review_date date not null,
  last_completed_date date,
  next_due_date date not null,
  status text not null check (status in ('Due Soon', 'Due Now', 'Overdue', 'Completed')),
  completed_by text,
  date_of_completion date,
  responsible_party_signature text,
  responsible_party_signature_date date,
  administrator_signature text,
  administrator_signature_date date,
  care_team_notes text not null default '',
  no_changes_needed boolean not null default false,
  modifications_required boolean not null default false,
  modifications_description text not null default '',
  created_by_user_id uuid references public.profiles(id) on delete set null,
  created_by_name text,
  updated_by_user_id uuid references public.profiles(id) on delete set null,
  updated_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_care_plans_member_due
  on public.care_plans (member_id, next_due_date desc);

create table if not exists public.care_plan_sections (
  id uuid primary key default gen_random_uuid(),
  care_plan_id uuid not null references public.care_plans(id) on delete cascade,
  section_type text not null check (
    section_type in (
      'Activities of Daily Living (ADLs) Assistance',
      'Cognitive & Memory Support',
      'Socialization & Emotional Well-Being',
      'Safety & Fall Prevention',
      'Medical & Medication Management'
    )
  ),
  short_term_goals text not null,
  long_term_goals text not null,
  display_order integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (care_plan_id, section_type)
);

create index if not exists idx_care_plan_sections_plan_order
  on public.care_plan_sections (care_plan_id, display_order);

create table if not exists public.care_plan_versions (
  id uuid primary key default gen_random_uuid(),
  care_plan_id uuid not null references public.care_plans(id) on delete cascade,
  version_number integer not null,
  snapshot_type text not null check (snapshot_type in ('initial', 'review')),
  snapshot_date date not null,
  reviewed_by text,
  status text not null check (status in ('Due Soon', 'Due Now', 'Overdue', 'Completed')),
  next_due_date date not null,
  no_changes_needed boolean not null default false,
  modifications_required boolean not null default false,
  modifications_description text not null default '',
  care_team_notes text not null default '',
  sections_snapshot jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (care_plan_id, version_number)
);

create index if not exists idx_care_plan_versions_plan_snapshot
  on public.care_plan_versions (care_plan_id, snapshot_date desc);

create table if not exists public.care_plan_review_history (
  id uuid primary key default gen_random_uuid(),
  care_plan_id uuid not null references public.care_plans(id) on delete cascade,
  review_date date not null,
  reviewed_by text not null,
  summary text not null,
  changes_made boolean not null default false,
  next_due_date date not null,
  version_id uuid references public.care_plan_versions(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_care_plan_review_history_plan_date
  on public.care_plan_review_history (care_plan_id, review_date desc);

create table if not exists public.billing_batches (
  id uuid primary key default gen_random_uuid(),
  batch_type text not null check (batch_type in ('Membership', 'Monthly', 'Mixed', 'Custom')),
  billing_month date not null,
  run_date date not null,
  batch_status text not null default 'Draft' check (batch_status in ('Draft', 'Reviewed', 'Finalized', 'Exported', 'Closed')),
  invoice_count integer not null default 0,
  total_amount numeric(12,2) not null default 0,
  completion_date date,
  next_due_date date,
  generated_by_user_id uuid references public.profiles(id) on delete set null,
  generated_by_name text,
  finalized_by text,
  finalized_at timestamptz,
  reopened_by text,
  reopened_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_billing_batches_month_status
  on public.billing_batches (billing_month desc, batch_status);

create table if not exists public.billing_invoices (
  id uuid primary key default gen_random_uuid(),
  billing_batch_id uuid references public.billing_batches(id) on delete set null,
  member_id uuid not null references public.members(id) on delete cascade,
  payor_id text references public.payors(id) on delete set null,
  invoice_number text not null,
  invoice_month date not null,
  invoice_source text not null default 'BatchGenerated' check (invoice_source in ('BatchGenerated', 'Custom')),
  invoice_status text not null default 'Draft' check (invoice_status in ('Draft', 'Finalized', 'Sent', 'Paid', 'PartiallyPaid', 'Void')),
  export_status text not null default 'NotExported',
  billing_mode_snapshot text,
  monthly_billing_basis_snapshot text,
  transportation_billing_status_snapshot text,
  billing_method_snapshot text,
  base_period_start date,
  base_period_end date,
  variable_charge_period_start date,
  variable_charge_period_end date,
  invoice_date date,
  due_date date,
  base_program_billed_days numeric(10,2) not null default 0,
  member_daily_rate_snapshot numeric(10,2) not null default 0,
  base_program_amount numeric(12,2) not null default 0,
  transportation_amount numeric(12,2) not null default 0,
  ancillary_amount numeric(12,2) not null default 0,
  adjustment_amount numeric(12,2) not null default 0,
  total_amount numeric(12,2) not null default 0,
  notes text,
  created_by_user_id uuid references public.profiles(id) on delete set null,
  created_by_name text,
  finalized_by text,
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_billing_invoices_invoice_number
  on public.billing_invoices (invoice_number);

create index if not exists idx_billing_invoices_member_month
  on public.billing_invoices (member_id, invoice_month desc);

create table if not exists public.billing_adjustments (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  payor_id text references public.payors(id) on delete set null,
  adjustment_date date not null,
  adjustment_type text not null check (adjustment_type in ('ExtraDay', 'Credit', 'Discount', 'Refund', 'ManualCharge', 'ManualCredit', 'PriorBalance', 'Other')),
  description text not null,
  quantity numeric(10,2) not null default 1,
  unit_rate numeric(10,2) not null default 0,
  amount numeric(12,2) not null default 0,
  billing_status text not null default 'Unbilled' check (billing_status in ('Unbilled', 'Billed', 'Excluded')),
  exclusion_reason text,
  invoice_id uuid references public.billing_invoices(id) on delete set null,
  created_by_system boolean not null default false,
  source_table text,
  source_record_id text,
  created_by_user_id uuid references public.profiles(id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_billing_adjustments_member_date
  on public.billing_adjustments (member_id, adjustment_date desc);

create index if not exists idx_billing_adjustments_status
  on public.billing_adjustments (billing_status);

create table if not exists public.billing_invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.billing_invoices(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  payor_id text references public.payors(id) on delete set null,
  service_date date,
  service_period_start date,
  service_period_end date,
  line_type text not null check (line_type in ('BaseProgram', 'Transportation', 'Ancillary', 'Adjustment', 'Credit', 'PriorBalance')),
  description text not null,
  quantity numeric(10,2) not null default 1,
  unit_rate numeric(10,2) not null default 0,
  amount numeric(12,2) not null default 0,
  source_table text,
  source_record_id text,
  billing_status text not null default 'Unbilled' check (billing_status in ('Unbilled', 'Billed', 'Excluded')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_billing_invoice_lines_invoice
  on public.billing_invoice_lines (invoice_id);

create index if not exists idx_billing_invoice_lines_member_date
  on public.billing_invoice_lines (member_id, service_date desc);

create table if not exists public.billing_coverages (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  coverage_type text not null check (coverage_type in ('BaseProgram', 'Transportation', 'Ancillary', 'Adjustment')),
  coverage_start_date date not null,
  coverage_end_date date not null,
  source_invoice_id uuid not null references public.billing_invoices(id) on delete cascade,
  source_invoice_line_id uuid references public.billing_invoice_lines(id) on delete set null,
  source_table text,
  source_record_id text,
  created_at timestamptz not null default now()
);

create index if not exists idx_billing_coverages_member_type_range
  on public.billing_coverages (member_id, coverage_type, coverage_start_date, coverage_end_date);

create table if not exists public.billing_export_jobs (
  id uuid primary key default gen_random_uuid(),
  billing_batch_id uuid references public.billing_batches(id) on delete set null,
  export_type text not null check (export_type in ('QuickBooksCSV', 'InternalReviewCSV', 'InvoiceSummaryCSV')),
  quickbooks_detail_level text not null default 'Summary' check (quickbooks_detail_level in ('Summary', 'Detailed')),
  file_name text not null,
  file_data_url text,
  generated_at timestamptz not null default now(),
  generated_by text,
  status text not null default 'Generated' check (status in ('Generated', 'Failed')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_billing_export_jobs_batch_generated
  on public.billing_export_jobs (billing_batch_id, generated_at desc);

alter table public.transportation_logs
  add column if not exists trip_type text,
  add column if not exists quantity numeric(10,2) not null default 1,
  add column if not exists unit_rate numeric(10,2) not null default 0,
  add column if not exists total_amount numeric(12,2) not null default 0,
  add column if not exists billable boolean not null default true,
  add column if not exists billing_status text check (billing_status in ('Unbilled', 'Billed', 'Excluded')),
  add column if not exists billing_exclusion_reason text,
  add column if not exists invoice_id uuid references public.billing_invoices(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

alter table public.ancillary_charge_logs
  add column if not exists quantity numeric(10,2) not null default 1,
  add column if not exists unit_rate numeric(10,2) not null default 0,
  add column if not exists amount numeric(12,2) not null default 0,
  add column if not exists billing_status text check (billing_status in ('Unbilled', 'Billed', 'Excluded')),
  add column if not exists billing_exclusion_reason text,
  add column if not exists invoice_id uuid references public.billing_invoices(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

update public.transportation_logs
set billing_status = coalesce(billing_status, case when coalesce(billable, true) then 'Unbilled' else 'Excluded' end),
    total_amount = coalesce(total_amount, 0),
    unit_rate = coalesce(unit_rate, 0),
    quantity = coalesce(quantity, 1),
    updated_at = coalesce(updated_at, created_at, now())
where billing_status is null or updated_at is null;

update public.ancillary_charge_logs acl
set unit_rate = coalesce(acl.unit_rate, (acc.price_cents / 100.0)::numeric(10,2), 0),
    amount = coalesce(acl.amount, ((coalesce(acl.quantity, 1) * coalesce(acc.price_cents, 0)) / 100.0)::numeric(12,2), 0),
    billing_status = coalesce(acl.billing_status, 'Unbilled'),
    quantity = coalesce(acl.quantity, 1),
    updated_at = coalesce(acl.updated_at, acl.created_at, now())
from public.ancillary_charge_categories acc
where acc.id = acl.category_id;

drop trigger if exists trg_care_plans_updated on public.care_plans;
create trigger trg_care_plans_updated before update on public.care_plans
for each row execute function public.set_updated_at();

drop trigger if exists trg_care_plan_sections_updated on public.care_plan_sections;
create trigger trg_care_plan_sections_updated before update on public.care_plan_sections
for each row execute function public.set_updated_at();

drop trigger if exists trg_billing_batches_updated on public.billing_batches;
create trigger trg_billing_batches_updated before update on public.billing_batches
for each row execute function public.set_updated_at();

drop trigger if exists trg_billing_invoices_updated on public.billing_invoices;
create trigger trg_billing_invoices_updated before update on public.billing_invoices
for each row execute function public.set_updated_at();

drop trigger if exists trg_billing_adjustments_updated on public.billing_adjustments;
create trigger trg_billing_adjustments_updated before update on public.billing_adjustments
for each row execute function public.set_updated_at();

drop trigger if exists trg_billing_invoice_lines_updated on public.billing_invoice_lines;
create trigger trg_billing_invoice_lines_updated before update on public.billing_invoice_lines
for each row execute function public.set_updated_at();

drop trigger if exists trg_billing_export_jobs_updated on public.billing_export_jobs;
create trigger trg_billing_export_jobs_updated before update on public.billing_export_jobs
for each row execute function public.set_updated_at();

drop trigger if exists trg_transportation_logs_updated on public.transportation_logs;
create trigger trg_transportation_logs_updated before update on public.transportation_logs
for each row execute function public.set_updated_at();

drop trigger if exists trg_ancillary_charge_logs_updated on public.ancillary_charge_logs;
create trigger trg_ancillary_charge_logs_updated before update on public.ancillary_charge_logs
for each row execute function public.set_updated_at();

alter table public.care_plans enable row level security;
alter table public.care_plan_sections enable row level security;
alter table public.care_plan_versions enable row level security;
alter table public.care_plan_review_history enable row level security;
alter table public.billing_batches enable row level security;
alter table public.billing_invoices enable row level security;
alter table public.billing_adjustments enable row level security;
alter table public.billing_invoice_lines enable row level security;
alter table public.billing_coverages enable row level security;
alter table public.billing_export_jobs enable row level security;

drop policy if exists "care_plans_select" on public.care_plans;
drop policy if exists "care_plans_insert" on public.care_plans;
drop policy if exists "care_plans_update" on public.care_plans;
create policy "care_plans_select" on public.care_plans for select to authenticated using (true);
create policy "care_plans_insert" on public.care_plans for insert to authenticated with check (true);
create policy "care_plans_update" on public.care_plans for update to authenticated using (true) with check (true);

drop policy if exists "care_plan_sections_select" on public.care_plan_sections;
drop policy if exists "care_plan_sections_insert" on public.care_plan_sections;
drop policy if exists "care_plan_sections_update" on public.care_plan_sections;
drop policy if exists "care_plan_sections_delete" on public.care_plan_sections;
create policy "care_plan_sections_select" on public.care_plan_sections for select to authenticated using (true);
create policy "care_plan_sections_insert" on public.care_plan_sections for insert to authenticated with check (true);
create policy "care_plan_sections_update" on public.care_plan_sections for update to authenticated using (true) with check (true);
create policy "care_plan_sections_delete" on public.care_plan_sections for delete to authenticated using (true);

drop policy if exists "care_plan_versions_select" on public.care_plan_versions;
drop policy if exists "care_plan_versions_insert" on public.care_plan_versions;
create policy "care_plan_versions_select" on public.care_plan_versions for select to authenticated using (true);
create policy "care_plan_versions_insert" on public.care_plan_versions for insert to authenticated with check (true);

drop policy if exists "care_plan_review_history_select" on public.care_plan_review_history;
drop policy if exists "care_plan_review_history_insert" on public.care_plan_review_history;
create policy "care_plan_review_history_select" on public.care_plan_review_history for select to authenticated using (true);
create policy "care_plan_review_history_insert" on public.care_plan_review_history for insert to authenticated with check (true);

drop policy if exists "billing_batches_select" on public.billing_batches;
drop policy if exists "billing_batches_insert" on public.billing_batches;
drop policy if exists "billing_batches_update" on public.billing_batches;
create policy "billing_batches_select" on public.billing_batches for select to authenticated using (true);
create policy "billing_batches_insert" on public.billing_batches for insert to authenticated with check (true);
create policy "billing_batches_update" on public.billing_batches for update to authenticated using (true) with check (true);

drop policy if exists "billing_invoices_select" on public.billing_invoices;
drop policy if exists "billing_invoices_insert" on public.billing_invoices;
drop policy if exists "billing_invoices_update" on public.billing_invoices;
create policy "billing_invoices_select" on public.billing_invoices for select to authenticated using (true);
create policy "billing_invoices_insert" on public.billing_invoices for insert to authenticated with check (true);
create policy "billing_invoices_update" on public.billing_invoices for update to authenticated using (true) with check (true);

drop policy if exists "billing_adjustments_select" on public.billing_adjustments;
drop policy if exists "billing_adjustments_insert" on public.billing_adjustments;
drop policy if exists "billing_adjustments_update" on public.billing_adjustments;
create policy "billing_adjustments_select" on public.billing_adjustments for select to authenticated using (true);
create policy "billing_adjustments_insert" on public.billing_adjustments for insert to authenticated with check (true);
create policy "billing_adjustments_update" on public.billing_adjustments for update to authenticated using (true) with check (true);

drop policy if exists "billing_invoice_lines_select" on public.billing_invoice_lines;
drop policy if exists "billing_invoice_lines_insert" on public.billing_invoice_lines;
drop policy if exists "billing_invoice_lines_update" on public.billing_invoice_lines;
drop policy if exists "billing_invoice_lines_delete" on public.billing_invoice_lines;
create policy "billing_invoice_lines_select" on public.billing_invoice_lines for select to authenticated using (true);
create policy "billing_invoice_lines_insert" on public.billing_invoice_lines for insert to authenticated with check (true);
create policy "billing_invoice_lines_update" on public.billing_invoice_lines for update to authenticated using (true) with check (true);
create policy "billing_invoice_lines_delete" on public.billing_invoice_lines for delete to authenticated using (true);

drop policy if exists "billing_coverages_select" on public.billing_coverages;
drop policy if exists "billing_coverages_insert" on public.billing_coverages;
drop policy if exists "billing_coverages_delete" on public.billing_coverages;
create policy "billing_coverages_select" on public.billing_coverages for select to authenticated using (true);
create policy "billing_coverages_insert" on public.billing_coverages for insert to authenticated with check (true);
create policy "billing_coverages_delete" on public.billing_coverages for delete to authenticated using (true);

drop policy if exists "billing_export_jobs_select" on public.billing_export_jobs;
drop policy if exists "billing_export_jobs_insert" on public.billing_export_jobs;
drop policy if exists "billing_export_jobs_update" on public.billing_export_jobs;
create policy "billing_export_jobs_select" on public.billing_export_jobs for select to authenticated using (true);
create policy "billing_export_jobs_insert" on public.billing_export_jobs for insert to authenticated with check (true);
create policy "billing_export_jobs_update" on public.billing_export_jobs for update to authenticated using (true) with check (true);