-- Reconciles closure/care-plan/billing execution schema for environments
-- where migrations 0012/0013 were not fully applied.

create table if not exists public.closure_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  rule_type text not null,
  month integer not null,
  day integer,
  weekday text,
  occurrence text,
  observed_when_weekend text not null default 'none',
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
  closure_type text not null,
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

create table if not exists public.care_plans (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  track text not null,
  enrollment_date date not null,
  review_date date not null,
  last_completed_date date,
  next_due_date date not null,
  status text not null,
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

create table if not exists public.care_plan_sections (
  id uuid primary key default gen_random_uuid(),
  care_plan_id uuid not null references public.care_plans(id) on delete cascade,
  section_type text not null,
  short_term_goals text not null,
  long_term_goals text not null,
  display_order integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.care_plan_versions (
  id uuid primary key default gen_random_uuid(),
  care_plan_id uuid not null references public.care_plans(id) on delete cascade,
  version_number integer not null,
  snapshot_type text not null,
  snapshot_date date not null,
  reviewed_by text,
  status text not null,
  next_due_date date not null,
  no_changes_needed boolean not null default false,
  modifications_required boolean not null default false,
  modifications_description text not null default '',
  care_team_notes text not null default '',
  sections_snapshot jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

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

create table if not exists public.billing_batches (
  id uuid primary key default gen_random_uuid(),
  batch_type text not null,
  billing_month date not null,
  run_date date not null,
  batch_status text not null default 'Draft',
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

create table if not exists public.billing_invoices (
  id uuid primary key default gen_random_uuid(),
  billing_batch_id uuid references public.billing_batches(id) on delete set null,
  member_id uuid not null references public.members(id) on delete cascade,
  payor_id text references public.payors(id) on delete set null,
  invoice_number text not null,
  invoice_month date not null,
  invoice_source text not null default 'BatchGenerated',
  invoice_status text not null default 'Draft',
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

create table if not exists public.billing_adjustments (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  payor_id text references public.payors(id) on delete set null,
  adjustment_date date not null,
  adjustment_type text not null,
  description text not null,
  quantity numeric(10,2) not null default 1,
  unit_rate numeric(10,2) not null default 0,
  amount numeric(12,2) not null default 0,
  billing_status text not null default 'Unbilled',
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

create table if not exists public.billing_invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.billing_invoices(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  payor_id text references public.payors(id) on delete set null,
  service_date date,
  service_period_start date,
  service_period_end date,
  line_type text not null,
  description text not null,
  quantity numeric(10,2) not null default 1,
  unit_rate numeric(10,2) not null default 0,
  amount numeric(12,2) not null default 0,
  source_table text,
  source_record_id text,
  billing_status text not null default 'Unbilled',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.billing_coverages (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  coverage_type text not null,
  coverage_start_date date not null,
  coverage_end_date date not null,
  source_invoice_id uuid not null references public.billing_invoices(id) on delete cascade,
  source_invoice_line_id uuid references public.billing_invoice_lines(id) on delete set null,
  source_table text,
  source_record_id text,
  created_at timestamptz not null default now()
);

create table if not exists public.billing_export_jobs (
  id uuid primary key default gen_random_uuid(),
  billing_batch_id uuid references public.billing_batches(id) on delete set null,
  export_type text not null,
  quickbooks_detail_level text not null default 'Summary',
  file_name text not null,
  file_data_url text,
  generated_at timestamptz not null default now(),
  generated_by text,
  status text not null default 'Generated',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists public.closure_rules
  add column if not exists name text,
  add column if not exists rule_type text,
  add column if not exists month integer,
  add column if not exists day integer,
  add column if not exists weekday text,
  add column if not exists occurrence text,
  add column if not exists observed_when_weekend text default 'none',
  add column if not exists active boolean default true,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists updated_by_user_id uuid references public.profiles(id) on delete set null,
  add column if not exists updated_by_name text;

alter table if exists public.center_closures
  add column if not exists closure_date date,
  add column if not exists closure_name text,
  add column if not exists closure_type text,
  add column if not exists auto_generated boolean default false,
  add column if not exists closure_rule_id uuid references public.closure_rules(id) on delete set null,
  add column if not exists billable_override boolean default false,
  add column if not exists notes text,
  add column if not exists active boolean default true,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists updated_by_user_id uuid references public.profiles(id) on delete set null,
  add column if not exists updated_by_name text;

alter table if exists public.care_plans
  add column if not exists member_id uuid references public.members(id) on delete cascade,
  add column if not exists track text,
  add column if not exists enrollment_date date,
  add column if not exists review_date date,
  add column if not exists next_due_date date,
  add column if not exists status text,
  add column if not exists no_changes_needed boolean not null default false,
  add column if not exists modifications_required boolean not null default false,
  add column if not exists modifications_description text not null default '',
  add column if not exists care_team_notes text not null default '',
  add column if not exists updated_at timestamptz not null default now();

alter table if exists public.care_plan_sections
  add column if not exists care_plan_id uuid references public.care_plans(id) on delete cascade,
  add column if not exists section_type text,
  add column if not exists short_term_goals text,
  add column if not exists long_term_goals text,
  add column if not exists display_order integer,
  add column if not exists updated_at timestamptz not null default now();

alter table if exists public.care_plan_versions
  add column if not exists care_plan_id uuid references public.care_plans(id) on delete cascade,
  add column if not exists version_number integer,
  add column if not exists snapshot_type text,
  add column if not exists snapshot_date date,
  add column if not exists status text,
  add column if not exists next_due_date date,
  add column if not exists no_changes_needed boolean not null default false,
  add column if not exists modifications_required boolean not null default false,
  add column if not exists modifications_description text not null default '',
  add column if not exists care_team_notes text not null default '',
  add column if not exists sections_snapshot jsonb not null default '[]'::jsonb;

alter table if exists public.care_plan_review_history
  add column if not exists care_plan_id uuid references public.care_plans(id) on delete cascade,
  add column if not exists review_date date,
  add column if not exists reviewed_by text,
  add column if not exists summary text,
  add column if not exists changes_made boolean not null default false,
  add column if not exists next_due_date date,
  add column if not exists version_id uuid references public.care_plan_versions(id) on delete set null;

alter table if exists public.billing_batches
  add column if not exists batch_type text,
  add column if not exists billing_month date,
  add column if not exists run_date date,
  add column if not exists batch_status text not null default 'Draft',
  add column if not exists invoice_count integer not null default 0,
  add column if not exists total_amount numeric(12,2) not null default 0,
  add column if not exists completion_date date,
  add column if not exists next_due_date date,
  add column if not exists finalized_by text,
  add column if not exists finalized_at timestamptz,
  add column if not exists reopened_by text,
  add column if not exists reopened_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

alter table if exists public.billing_invoices
  add column if not exists billing_batch_id uuid references public.billing_batches(id) on delete set null,
  add column if not exists member_id uuid references public.members(id) on delete cascade,
  add column if not exists payor_id text references public.payors(id) on delete set null,
  add column if not exists invoice_number text,
  add column if not exists invoice_month date,
  add column if not exists invoice_source text not null default 'BatchGenerated',
  add column if not exists invoice_status text not null default 'Draft',
  add column if not exists export_status text not null default 'NotExported',
  add column if not exists billing_mode_snapshot text,
  add column if not exists monthly_billing_basis_snapshot text,
  add column if not exists transportation_billing_status_snapshot text,
  add column if not exists billing_method_snapshot text,
  add column if not exists base_period_start date,
  add column if not exists base_period_end date,
  add column if not exists variable_charge_period_start date,
  add column if not exists variable_charge_period_end date,
  add column if not exists base_program_billed_days numeric(10,2) not null default 0,
  add column if not exists member_daily_rate_snapshot numeric(10,2) not null default 0,
  add column if not exists base_program_amount numeric(12,2) not null default 0,
  add column if not exists transportation_amount numeric(12,2) not null default 0,
  add column if not exists ancillary_amount numeric(12,2) not null default 0,
  add column if not exists adjustment_amount numeric(12,2) not null default 0,
  add column if not exists total_amount numeric(12,2) not null default 0,
  add column if not exists updated_at timestamptz not null default now();

alter table if exists public.billing_adjustments
  add column if not exists member_id uuid references public.members(id) on delete cascade,
  add column if not exists payor_id text references public.payors(id) on delete set null,
  add column if not exists adjustment_date date,
  add column if not exists adjustment_type text,
  add column if not exists description text,
  add column if not exists quantity numeric(10,2) not null default 1,
  add column if not exists unit_rate numeric(10,2) not null default 0,
  add column if not exists amount numeric(12,2) not null default 0,
  add column if not exists billing_status text not null default 'Unbilled',
  add column if not exists exclusion_reason text,
  add column if not exists invoice_id uuid references public.billing_invoices(id) on delete set null,
  add column if not exists created_by_system boolean not null default false,
  add column if not exists source_table text,
  add column if not exists source_record_id text,
  add column if not exists updated_at timestamptz not null default now();

alter table if exists public.billing_invoice_lines
  add column if not exists invoice_id uuid references public.billing_invoices(id) on delete cascade,
  add column if not exists member_id uuid references public.members(id) on delete cascade,
  add column if not exists payor_id text references public.payors(id) on delete set null,
  add column if not exists service_date date,
  add column if not exists service_period_start date,
  add column if not exists service_period_end date,
  add column if not exists line_type text,
  add column if not exists description text,
  add column if not exists quantity numeric(10,2) not null default 1,
  add column if not exists unit_rate numeric(10,2) not null default 0,
  add column if not exists amount numeric(12,2) not null default 0,
  add column if not exists source_table text,
  add column if not exists source_record_id text,
  add column if not exists billing_status text not null default 'Unbilled',
  add column if not exists updated_at timestamptz not null default now();

alter table if exists public.billing_coverages
  add column if not exists member_id uuid references public.members(id) on delete cascade,
  add column if not exists coverage_type text,
  add column if not exists coverage_start_date date,
  add column if not exists coverage_end_date date,
  add column if not exists source_invoice_id uuid references public.billing_invoices(id) on delete cascade,
  add column if not exists source_invoice_line_id uuid references public.billing_invoice_lines(id) on delete set null,
  add column if not exists source_table text,
  add column if not exists source_record_id text;

alter table if exists public.billing_export_jobs
  add column if not exists billing_batch_id uuid references public.billing_batches(id) on delete set null,
  add column if not exists export_type text,
  add column if not exists quickbooks_detail_level text not null default 'Summary',
  add column if not exists file_name text,
  add column if not exists file_data_url text,
  add column if not exists generated_at timestamptz not null default now(),
  add column if not exists generated_by text,
  add column if not exists status text not null default 'Generated',
  add column if not exists notes text,
  add column if not exists updated_at timestamptz not null default now();

alter table if exists public.transportation_logs
  add column if not exists trip_type text,
  add column if not exists quantity numeric(10,2) not null default 1,
  add column if not exists unit_rate numeric(10,2) not null default 0,
  add column if not exists total_amount numeric(12,2) not null default 0,
  add column if not exists billable boolean not null default true,
  add column if not exists billing_status text,
  add column if not exists billing_exclusion_reason text,
  add column if not exists invoice_id uuid references public.billing_invoices(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

alter table if exists public.ancillary_charge_logs
  add column if not exists quantity numeric(10,2) not null default 1,
  add column if not exists unit_rate numeric(10,2) not null default 0,
  add column if not exists amount numeric(12,2) not null default 0,
  add column if not exists billing_status text,
  add column if not exists billing_exclusion_reason text,
  add column if not exists invoice_id uuid references public.billing_invoices(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

create index if not exists idx_center_closures_date on public.center_closures (closure_date desc);
create index if not exists idx_care_plans_member_due on public.care_plans (member_id, next_due_date desc);
create index if not exists idx_care_plan_sections_plan_order on public.care_plan_sections (care_plan_id, display_order);
create index if not exists idx_care_plan_versions_plan_snapshot on public.care_plan_versions (care_plan_id, snapshot_date desc);
create index if not exists idx_care_plan_review_history_plan_date on public.care_plan_review_history (care_plan_id, review_date desc);
create index if not exists idx_billing_batches_month_status on public.billing_batches (billing_month desc, batch_status);
create unique index if not exists idx_billing_invoices_invoice_number on public.billing_invoices (invoice_number);
create index if not exists idx_billing_invoices_member_month on public.billing_invoices (member_id, invoice_month desc);
create index if not exists idx_billing_adjustments_member_date on public.billing_adjustments (member_id, adjustment_date desc);
create index if not exists idx_billing_adjustments_status on public.billing_adjustments (billing_status);
create index if not exists idx_billing_invoice_lines_invoice on public.billing_invoice_lines (invoice_id);
create index if not exists idx_billing_invoice_lines_member_date on public.billing_invoice_lines (member_id, service_date desc);
create index if not exists idx_billing_coverages_member_type_range on public.billing_coverages (member_id, coverage_type, coverage_start_date, coverage_end_date);
create index if not exists idx_billing_export_jobs_batch_generated on public.billing_export_jobs (billing_batch_id, generated_at desc);

update public.transportation_logs
set billing_status = coalesce(billing_status, case when coalesce(billable, true) then 'Unbilled' else 'Excluded' end),
    quantity = coalesce(quantity, 1),
    unit_rate = coalesce(unit_rate, 0),
    total_amount = coalesce(total_amount, 0),
    updated_at = coalesce(updated_at, created_at, now())
where billing_status is null or quantity is null or unit_rate is null or total_amount is null or updated_at is null;

update public.ancillary_charge_logs acl
set quantity = coalesce(acl.quantity, 1),
    unit_rate = coalesce(acl.unit_rate, (acc.price_cents / 100.0)::numeric(10,2), 0),
    amount = coalesce(acl.amount, ((coalesce(acl.quantity, 1) * coalesce(acc.price_cents, 0)) / 100.0)::numeric(12,2), 0),
    billing_status = coalesce(acl.billing_status, 'Unbilled'),
    updated_at = coalesce(acl.updated_at, acl.created_at, now())
from public.ancillary_charge_categories acc
where acc.id = acl.category_id;

update public.ancillary_charge_logs
set quantity = coalesce(quantity, 1),
    unit_rate = coalesce(unit_rate, 0),
    amount = coalesce(amount, 0),
    billing_status = coalesce(billing_status, 'Unbilled'),
    updated_at = coalesce(updated_at, created_at, now())
where quantity is null or unit_rate is null or amount is null or billing_status is null or updated_at is null;

drop trigger if exists trg_closure_rules_updated on public.closure_rules;
create trigger trg_closure_rules_updated before update on public.closure_rules
for each row execute function public.set_updated_at();

drop trigger if exists trg_center_closures_updated on public.center_closures;
create trigger trg_center_closures_updated before update on public.center_closures
for each row execute function public.set_updated_at();

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

do $$
declare
  t text;
begin
  foreach t in array array[
    'closure_rules',
    'center_closures',
    'care_plans',
    'care_plan_sections',
    'care_plan_versions',
    'care_plan_review_history',
    'billing_batches',
    'billing_invoices',
    'billing_adjustments',
    'billing_invoice_lines',
    'billing_coverages',
    'billing_export_jobs'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);

    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_select') then
      execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_select', t);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_insert') then
      execute format('create policy %I on public.%I for insert to authenticated with check (true)', t || '_insert', t);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_update') then
      execute format('create policy %I on public.%I for update to authenticated using (true) with check (true)', t || '_update', t);
    end if;
  end loop;

  foreach t in array array['center_closures', 'care_plan_sections', 'billing_invoice_lines', 'billing_coverages']
  loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_delete') then
      execute format('create policy %I on public.%I for delete to authenticated using (true)', t || '_delete', t);
    end if;
  end loop;
end
$$;
