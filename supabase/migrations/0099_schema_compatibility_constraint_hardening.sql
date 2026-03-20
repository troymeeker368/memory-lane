-- Follow-up hardening for 0015_schema_compatibility_backfill.sql.
-- Backfill safe legacy nulls, stop on unsafe rows, and explicitly apply
-- the NOT NULL, UNIQUE, and validation constraints that fresh installs
-- already receive from 0012/0013 create-table definitions.

update public.closure_rules
set
  observed_when_weekend = coalesce(observed_when_weekend, 'none'),
  active = coalesce(active, true),
  created_at = coalesce(created_at, updated_at, now()),
  updated_at = coalesce(updated_at, created_at, now())
where
  observed_when_weekend is null
  or active is null
  or created_at is null
  or updated_at is null;

update public.center_closures
set
  auto_generated = coalesce(auto_generated, false),
  billable_override = coalesce(billable_override, false),
  active = coalesce(active, true),
  created_at = coalesce(created_at, updated_at, now()),
  updated_at = coalesce(updated_at, created_at, now())
where
  auto_generated is null
  or billable_override is null
  or active is null
  or created_at is null
  or updated_at is null;

update public.care_plans
set
  care_team_notes = coalesce(care_team_notes, ''),
  no_changes_needed = coalesce(no_changes_needed, false),
  modifications_required = coalesce(modifications_required, false),
  modifications_description = coalesce(modifications_description, ''),
  created_at = coalesce(created_at, updated_at, now()),
  updated_at = coalesce(updated_at, created_at, now())
where
  care_team_notes is null
  or no_changes_needed is null
  or modifications_required is null
  or modifications_description is null
  or created_at is null
  or updated_at is null;

update public.care_plan_sections
set
  created_at = coalesce(created_at, updated_at, now()),
  updated_at = coalesce(updated_at, created_at, now())
where created_at is null or updated_at is null;

update public.care_plan_versions
set
  no_changes_needed = coalesce(no_changes_needed, false),
  modifications_required = coalesce(modifications_required, false),
  modifications_description = coalesce(modifications_description, ''),
  care_team_notes = coalesce(care_team_notes, ''),
  sections_snapshot = coalesce(sections_snapshot, '[]'::jsonb),
  created_at = coalesce(created_at, now())
where
  no_changes_needed is null
  or modifications_required is null
  or modifications_description is null
  or care_team_notes is null
  or sections_snapshot is null
  or created_at is null;

update public.care_plan_review_history
set
  changes_made = coalesce(changes_made, false),
  created_at = coalesce(created_at, now())
where changes_made is null or created_at is null;

update public.billing_batches
set
  batch_status = coalesce(batch_status, 'Draft'),
  invoice_count = coalesce(invoice_count, 0),
  total_amount = coalesce(total_amount, 0),
  created_at = coalesce(created_at, updated_at, now()),
  updated_at = coalesce(updated_at, created_at, now())
where
  batch_status is null
  or invoice_count is null
  or total_amount is null
  or created_at is null
  or updated_at is null;

update public.billing_invoices
set
  invoice_source = coalesce(invoice_source, 'BatchGenerated'),
  invoice_status = coalesce(invoice_status, 'Draft'),
  export_status = coalesce(export_status, 'NotExported'),
  base_program_billed_days = coalesce(base_program_billed_days, 0),
  member_daily_rate_snapshot = coalesce(member_daily_rate_snapshot, 0),
  base_program_amount = coalesce(base_program_amount, 0),
  transportation_amount = coalesce(transportation_amount, 0),
  ancillary_amount = coalesce(ancillary_amount, 0),
  adjustment_amount = coalesce(adjustment_amount, 0),
  total_amount = coalesce(total_amount, 0),
  created_at = coalesce(created_at, updated_at, now()),
  updated_at = coalesce(updated_at, created_at, now())
where
  invoice_source is null
  or invoice_status is null
  or export_status is null
  or base_program_billed_days is null
  or member_daily_rate_snapshot is null
  or base_program_amount is null
  or transportation_amount is null
  or ancillary_amount is null
  or adjustment_amount is null
  or total_amount is null
  or created_at is null
  or updated_at is null;

update public.billing_adjustments
set
  quantity = coalesce(quantity, 1),
  unit_rate = coalesce(unit_rate, 0),
  amount = coalesce(amount, 0),
  billing_status = coalesce(billing_status, 'Unbilled'),
  created_by_system = coalesce(created_by_system, false),
  created_at = coalesce(created_at, updated_at, now()),
  updated_at = coalesce(updated_at, created_at, now())
where
  quantity is null
  or unit_rate is null
  or amount is null
  or billing_status is null
  or created_by_system is null
  or created_at is null
  or updated_at is null;

update public.billing_invoice_lines
set
  quantity = coalesce(quantity, 1),
  unit_rate = coalesce(unit_rate, 0),
  amount = coalesce(amount, 0),
  billing_status = coalesce(billing_status, 'Unbilled'),
  created_at = coalesce(created_at, updated_at, now()),
  updated_at = coalesce(updated_at, created_at, now())
where
  quantity is null
  or unit_rate is null
  or amount is null
  or billing_status is null
  or created_at is null
  or updated_at is null;

update public.billing_coverages
set
  created_at = coalesce(created_at, now())
where created_at is null;

update public.billing_export_jobs
set
  quickbooks_detail_level = coalesce(quickbooks_detail_level, 'Summary'),
  generated_at = coalesce(generated_at, created_at, updated_at, now()),
  status = coalesce(status, 'Generated'),
  created_at = coalesce(created_at, updated_at, now()),
  updated_at = coalesce(updated_at, created_at, now())
where
  quickbooks_detail_level is null
  or generated_at is null
  or status is null
  or created_at is null
  or updated_at is null;

update public.transportation_logs
set
  quantity = coalesce(quantity, 1),
  unit_rate = coalesce(unit_rate, 0),
  total_amount = coalesce(total_amount, 0),
  billable = coalesce(billable, true),
  billing_status = coalesce(billing_status, case when coalesce(billable, true) then 'Unbilled' else 'Excluded' end),
  updated_at = coalesce(updated_at, created_at, now())
where
  quantity is null
  or unit_rate is null
  or total_amount is null
  or billable is null
  or billing_status is null
  or updated_at is null;

update public.ancillary_charge_logs acl
set
  quantity = coalesce(acl.quantity, 1),
  unit_rate = coalesce(acl.unit_rate, (acc.price_cents / 100.0)::numeric(10,2), 0),
  amount = coalesce(acl.amount, ((coalesce(acl.quantity, 1) * coalesce(acc.price_cents, 0)) / 100.0)::numeric(12,2), 0),
  billing_status = coalesce(acl.billing_status, 'Unbilled'),
  updated_at = coalesce(acl.updated_at, acl.created_at, now())
from public.ancillary_charge_categories acc
where acc.id = acl.category_id
  and (
    acl.quantity is null
    or acl.unit_rate is null
    or acl.amount is null
    or acl.billing_status is null
    or acl.updated_at is null
  );

update public.ancillary_charge_logs
set
  quantity = coalesce(quantity, 1),
  unit_rate = coalesce(unit_rate, 0),
  amount = coalesce(amount, 0),
  billing_status = coalesce(billing_status, 'Unbilled'),
  updated_at = coalesce(updated_at, created_at, now())
where
  quantity is null
  or unit_rate is null
  or amount is null
  or billing_status is null
  or updated_at is null;

do $$
declare
  v_count bigint := 0;
begin
  select count(*)
  into v_count
  from public.closure_rules
  where
    name is null
    or rule_type is null
    or month is null
    or observed_when_weekend is null
    or active is null
    or created_at is null
    or updated_at is null;

  if v_count > 0 then
    raise exception
      '0099 abort: closure_rules still has % unsafe rows with required values missing.',
      v_count;
  end if;
end
$$;

do $$
declare
  v_count bigint := 0;
begin
  select count(*)
  into v_count
  from public.center_closures
  where
    closure_date is null
    or closure_name is null
    or closure_type is null
    or auto_generated is null
    or billable_override is null
    or active is null
    or created_at is null
    or updated_at is null;

  if v_count > 0 then
    raise exception
      '0099 abort: center_closures still has % unsafe rows with required values missing.',
      v_count;
  end if;
end
$$;

do $$
declare
  v_count bigint := 0;
begin
  select count(*)
  into v_count
  from public.care_plans
  where
    member_id is null
    or track is null
    or enrollment_date is null
    or review_date is null
    or next_due_date is null
    or status is null
    or care_team_notes is null
    or no_changes_needed is null
    or modifications_required is null
    or modifications_description is null
    or created_at is null
    or updated_at is null;

  if v_count > 0 then
    raise exception
      '0099 abort: care_plans still has % unsafe rows with required values missing.',
      v_count;
  end if;
end
$$;

do $$
declare
  v_count bigint := 0;
begin
  select count(*)
  into v_count
  from public.care_plan_sections
  where
    care_plan_id is null
    or section_type is null
    or short_term_goals is null
    or long_term_goals is null
    or display_order is null
    or created_at is null
    or updated_at is null;

  if v_count > 0 then
    raise exception
      '0099 abort: care_plan_sections still has % unsafe rows with required values missing.',
      v_count;
  end if;
end
$$;

do $$
declare
  v_count bigint := 0;
begin
  select count(*)
  into v_count
  from public.care_plan_versions
  where
    care_plan_id is null
    or version_number is null
    or snapshot_type is null
    or snapshot_date is null
    or status is null
    or next_due_date is null
    or no_changes_needed is null
    or modifications_required is null
    or modifications_description is null
    or care_team_notes is null
    or sections_snapshot is null
    or created_at is null;

  if v_count > 0 then
    raise exception
      '0099 abort: care_plan_versions still has % unsafe rows with required values missing.',
      v_count;
  end if;
end
$$;

do $$
declare
  v_count bigint := 0;
begin
  select count(*)
  into v_count
  from public.care_plan_review_history
  where
    care_plan_id is null
    or review_date is null
    or reviewed_by is null
    or summary is null
    or changes_made is null
    or next_due_date is null
    or created_at is null;

  if v_count > 0 then
    raise exception
      '0099 abort: care_plan_review_history still has % unsafe rows with required values missing.',
      v_count;
  end if;
end
$$;

do $$
declare
  v_count bigint := 0;
begin
  select count(*)
  into v_count
  from public.billing_batches
  where
    batch_type is null
    or billing_month is null
    or run_date is null
    or batch_status is null
    or invoice_count is null
    or total_amount is null
    or created_at is null
    or updated_at is null;

  if v_count > 0 then
    raise exception
      '0099 abort: billing_batches still has % unsafe rows with required values missing.',
      v_count;
  end if;
end
$$;

do $$
declare
  v_count bigint := 0;
begin
  select count(*)
  into v_count
  from public.billing_invoices
  where
    member_id is null
    or invoice_number is null
    or invoice_month is null
    or invoice_source is null
    or invoice_status is null
    or export_status is null
    or base_program_billed_days is null
    or member_daily_rate_snapshot is null
    or base_program_amount is null
    or transportation_amount is null
    or ancillary_amount is null
    or adjustment_amount is null
    or total_amount is null
    or created_at is null
    or updated_at is null;

  if v_count > 0 then
    raise exception
      '0099 abort: billing_invoices still has % unsafe rows with required values missing.',
      v_count;
  end if;
end
$$;

do $$
declare
  v_count bigint := 0;
begin
  select count(*)
  into v_count
  from public.billing_adjustments
  where
    member_id is null
    or adjustment_date is null
    or adjustment_type is null
    or description is null
    or quantity is null
    or unit_rate is null
    or amount is null
    or billing_status is null
    or created_by_system is null
    or created_at is null
    or updated_at is null;

  if v_count > 0 then
    raise exception
      '0099 abort: billing_adjustments still has % unsafe rows with required values missing.',
      v_count;
  end if;
end
$$;

do $$
declare
  v_count bigint := 0;
begin
  select count(*)
  into v_count
  from public.billing_invoice_lines
  where
    invoice_id is null
    or member_id is null
    or line_type is null
    or description is null
    or quantity is null
    or unit_rate is null
    or amount is null
    or billing_status is null
    or created_at is null
    or updated_at is null;

  if v_count > 0 then
    raise exception
      '0099 abort: billing_invoice_lines still has % unsafe rows with required values missing.',
      v_count;
  end if;
end
$$;

do $$
declare
  v_count bigint := 0;
begin
  select count(*)
  into v_count
  from public.billing_coverages
  where
    member_id is null
    or coverage_type is null
    or coverage_start_date is null
    or coverage_end_date is null
    or source_invoice_id is null
    or created_at is null;

  if v_count > 0 then
    raise exception
      '0099 abort: billing_coverages still has % unsafe rows with required values missing.',
      v_count;
  end if;
end
$$;

do $$
declare
  v_count bigint := 0;
begin
  select count(*)
  into v_count
  from public.billing_export_jobs
  where
    export_type is null
    or quickbooks_detail_level is null
    or file_name is null
    or generated_at is null
    or status is null
    or created_at is null
    or updated_at is null;

  if v_count > 0 then
    raise exception
      '0099 abort: billing_export_jobs still has % unsafe rows with required values missing.',
      v_count;
  end if;
end
$$;

do $$
declare
  v_duplicate_groups bigint := 0;
begin
  select count(*)
  into v_duplicate_groups
  from (
    select care_plan_id, section_type
    from public.care_plan_sections
    group by care_plan_id, section_type
    having count(*) > 1
  ) duplicates;

  if v_duplicate_groups > 0 then
    raise exception
      '0099 abort: care_plan_sections has % duplicate (care_plan_id, section_type) groups.',
      v_duplicate_groups;
  end if;
end
$$;

do $$
declare
  v_duplicate_groups bigint := 0;
begin
  select count(*)
  into v_duplicate_groups
  from (
    select care_plan_id, version_number
    from public.care_plan_versions
    group by care_plan_id, version_number
    having count(*) > 1
  ) duplicates;

  if v_duplicate_groups > 0 then
    raise exception
      '0099 abort: care_plan_versions has % duplicate (care_plan_id, version_number) groups.',
      v_duplicate_groups;
  end if;
end
$$;

do $$
declare
  v_duplicate_groups bigint := 0;
begin
  select count(*)
  into v_duplicate_groups
  from (
    select invoice_number
    from public.billing_invoices
    group by invoice_number
    having count(*) > 1
  ) duplicates;

  if v_duplicate_groups > 0 then
    raise exception
      '0099 abort: billing_invoices has % duplicate invoice_number values.',
      v_duplicate_groups;
  end if;
end
$$;

alter table public.closure_rules
  alter column observed_when_weekend set default 'none',
  alter column active set default true,
  alter column updated_at set default now(),
  alter column name set not null,
  alter column rule_type set not null,
  alter column month set not null,
  alter column observed_when_weekend set not null,
  alter column active set not null,
  alter column created_at set not null,
  alter column updated_at set not null;

alter table public.center_closures
  alter column auto_generated set default false,
  alter column billable_override set default false,
  alter column active set default true,
  alter column updated_at set default now(),
  alter column closure_date set not null,
  alter column closure_name set not null,
  alter column closure_type set not null,
  alter column auto_generated set not null,
  alter column billable_override set not null,
  alter column active set not null,
  alter column created_at set not null,
  alter column updated_at set not null;

alter table public.care_plans
  alter column care_team_notes set default '',
  alter column no_changes_needed set default false,
  alter column modifications_required set default false,
  alter column modifications_description set default '',
  alter column updated_at set default now(),
  alter column member_id set not null,
  alter column track set not null,
  alter column enrollment_date set not null,
  alter column review_date set not null,
  alter column next_due_date set not null,
  alter column status set not null,
  alter column care_team_notes set not null,
  alter column no_changes_needed set not null,
  alter column modifications_required set not null,
  alter column modifications_description set not null,
  alter column created_at set not null,
  alter column updated_at set not null;

alter table public.care_plan_sections
  alter column updated_at set default now(),
  alter column care_plan_id set not null,
  alter column section_type set not null,
  alter column short_term_goals set not null,
  alter column long_term_goals set not null,
  alter column display_order set not null,
  alter column created_at set not null,
  alter column updated_at set not null;

alter table public.care_plan_versions
  alter column no_changes_needed set default false,
  alter column modifications_required set default false,
  alter column modifications_description set default '',
  alter column care_team_notes set default '',
  alter column sections_snapshot set default '[]'::jsonb,
  alter column care_plan_id set not null,
  alter column version_number set not null,
  alter column snapshot_type set not null,
  alter column snapshot_date set not null,
  alter column status set not null,
  alter column next_due_date set not null,
  alter column no_changes_needed set not null,
  alter column modifications_required set not null,
  alter column modifications_description set not null,
  alter column care_team_notes set not null,
  alter column sections_snapshot set not null,
  alter column created_at set not null;

alter table public.care_plan_review_history
  alter column changes_made set default false,
  alter column care_plan_id set not null,
  alter column review_date set not null,
  alter column reviewed_by set not null,
  alter column summary set not null,
  alter column changes_made set not null,
  alter column next_due_date set not null,
  alter column created_at set not null;

alter table public.billing_batches
  alter column batch_status set default 'Draft',
  alter column invoice_count set default 0,
  alter column total_amount set default 0,
  alter column updated_at set default now(),
  alter column batch_type set not null,
  alter column billing_month set not null,
  alter column run_date set not null,
  alter column batch_status set not null,
  alter column invoice_count set not null,
  alter column total_amount set not null,
  alter column created_at set not null,
  alter column updated_at set not null;

alter table public.billing_invoices
  alter column invoice_source set default 'BatchGenerated',
  alter column invoice_status set default 'Draft',
  alter column export_status set default 'NotExported',
  alter column base_program_billed_days set default 0,
  alter column member_daily_rate_snapshot set default 0,
  alter column base_program_amount set default 0,
  alter column transportation_amount set default 0,
  alter column ancillary_amount set default 0,
  alter column adjustment_amount set default 0,
  alter column total_amount set default 0,
  alter column updated_at set default now(),
  alter column member_id set not null,
  alter column invoice_number set not null,
  alter column invoice_month set not null,
  alter column invoice_source set not null,
  alter column invoice_status set not null,
  alter column export_status set not null,
  alter column base_program_billed_days set not null,
  alter column member_daily_rate_snapshot set not null,
  alter column base_program_amount set not null,
  alter column transportation_amount set not null,
  alter column ancillary_amount set not null,
  alter column adjustment_amount set not null,
  alter column total_amount set not null,
  alter column created_at set not null,
  alter column updated_at set not null;

alter table public.billing_adjustments
  alter column quantity set default 1,
  alter column unit_rate set default 0,
  alter column amount set default 0,
  alter column billing_status set default 'Unbilled',
  alter column created_by_system set default false,
  alter column updated_at set default now(),
  alter column member_id set not null,
  alter column adjustment_date set not null,
  alter column adjustment_type set not null,
  alter column description set not null,
  alter column quantity set not null,
  alter column unit_rate set not null,
  alter column amount set not null,
  alter column billing_status set not null,
  alter column created_by_system set not null,
  alter column created_at set not null,
  alter column updated_at set not null;

alter table public.billing_invoice_lines
  alter column quantity set default 1,
  alter column unit_rate set default 0,
  alter column amount set default 0,
  alter column billing_status set default 'Unbilled',
  alter column updated_at set default now(),
  alter column invoice_id set not null,
  alter column member_id set not null,
  alter column line_type set not null,
  alter column description set not null,
  alter column quantity set not null,
  alter column unit_rate set not null,
  alter column amount set not null,
  alter column billing_status set not null,
  alter column created_at set not null,
  alter column updated_at set not null;

alter table public.billing_coverages
  alter column created_at set default now(),
  alter column member_id set not null,
  alter column coverage_type set not null,
  alter column coverage_start_date set not null,
  alter column coverage_end_date set not null,
  alter column source_invoice_id set not null,
  alter column created_at set not null;

alter table public.billing_export_jobs
  alter column quickbooks_detail_level set default 'Summary',
  alter column generated_at set default now(),
  alter column status set default 'Generated',
  alter column updated_at set default now(),
  alter column export_type set not null,
  alter column quickbooks_detail_level set not null,
  alter column file_name set not null,
  alter column generated_at set not null,
  alter column status set not null,
  alter column created_at set not null,
  alter column updated_at set not null;

alter table public.transportation_logs
  alter column quantity set default 1,
  alter column unit_rate set default 0,
  alter column total_amount set default 0,
  alter column billable set default true,
  alter column updated_at set default now(),
  alter column quantity set not null,
  alter column unit_rate set not null,
  alter column total_amount set not null,
  alter column billable set not null,
  alter column updated_at set not null;

alter table public.ancillary_charge_logs
  alter column quantity set default 1,
  alter column unit_rate set default 0,
  alter column amount set default 0,
  alter column updated_at set default now(),
  alter column quantity set not null,
  alter column unit_rate set not null,
  alter column amount set not null,
  alter column updated_at set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.care_plan_sections'::regclass
      and conname = 'care_plan_sections_care_plan_id_section_type_key'
  ) and not exists (
    select 1
    from pg_class
    where relnamespace = 'public'::regnamespace
      and relname = 'care_plan_sections_care_plan_id_section_type_key'
  ) then
    alter table public.care_plan_sections
      add constraint care_plan_sections_care_plan_id_section_type_key unique (care_plan_id, section_type);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.care_plan_versions'::regclass
      and conname = 'care_plan_versions_care_plan_id_version_number_key'
  ) and not exists (
    select 1
    from pg_class
    where relnamespace = 'public'::regnamespace
      and relname = 'care_plan_versions_care_plan_id_version_number_key'
  ) then
    alter table public.care_plan_versions
      add constraint care_plan_versions_care_plan_id_version_number_key unique (care_plan_id, version_number);
  end if;
end
$$;

create unique index if not exists idx_billing_invoices_invoice_number
  on public.billing_invoices (invoice_number);

do $$
begin
  begin
    alter table public.closure_rules
      add constraint closure_rules_rule_type_check check (rule_type in ('fixed', 'nth_weekday')) not valid;
  exception
    when duplicate_object then null;
  end;

  begin
    alter table public.closure_rules
      add constraint closure_rules_month_check check (month between 1 and 12) not valid;
  exception
    when duplicate_object then null;
  end;

  begin
    alter table public.closure_rules
      add constraint closure_rules_day_check check (day between 1 and 31) not valid;
  exception
    when duplicate_object then null;
  end;

  begin
    alter table public.closure_rules
      add constraint closure_rules_weekday_check check (weekday in ('sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday')) not valid;
  exception
    when duplicate_object then null;
  end;

  begin
    alter table public.closure_rules
      add constraint closure_rules_occurrence_check check (occurrence in ('first', 'second', 'third', 'fourth', 'last')) not valid;
  exception
    when duplicate_object then null;
  end;

  begin
    alter table public.closure_rules
      add constraint closure_rules_observed_when_weekend_check check (observed_when_weekend in ('none', 'friday', 'monday', 'nearest_weekday')) not valid;
  exception
    when duplicate_object then null;
  end;

  begin
    alter table public.center_closures
      add constraint center_closures_closure_type_check check (closure_type in ('Holiday', 'Weather', 'Planned', 'Emergency', 'Other')) not valid;
  exception
    when duplicate_object then null;
  end;

  begin
    alter table public.care_plans
      add constraint care_plans_track_check check (track in ('Track 1', 'Track 2', 'Track 3')) not valid;
  exception
    when duplicate_object then null;
  end;

  begin
    alter table public.care_plans
      add constraint care_plans_status_check check (status in ('Due Soon', 'Due Now', 'Overdue', 'Completed')) not valid;
  exception
    when duplicate_object then null;
  end;

  begin
    alter table public.care_plan_sections
      add constraint care_plan_sections_section_type_check check (
        section_type in (
          'Activities of Daily Living (ADLs) Assistance',
          'Cognitive & Memory Support',
          'Socialization & Emotional Well-Being',
          'Safety & Fall Prevention',
          'Medical & Medication Management'
        )
      ) not valid;
  exception
    when duplicate_object then null;
  end;

  begin
    alter table public.care_plan_versions
      add constraint care_plan_versions_snapshot_type_check check (snapshot_type in ('initial', 'review')) not valid;
  exception
    when duplicate_object then null;
  end;

  begin
    alter table public.care_plan_versions
      add constraint care_plan_versions_status_check check (status in ('Due Soon', 'Due Now', 'Overdue', 'Completed')) not valid;
  exception
    when duplicate_object then null;
  end;

  begin
    alter table public.billing_batches
      add constraint billing_batches_batch_type_check check (batch_type in ('Membership', 'Monthly', 'Mixed', 'Custom')) not valid;
  exception
    when duplicate_object then null;
  end;

  begin
    alter table public.billing_batches
      add constraint billing_batches_batch_status_check check (batch_status in ('Draft', 'Reviewed', 'Finalized', 'Exported', 'Closed')) not valid;
  exception
    when duplicate_object then null;
  end;

  begin
    alter table public.billing_invoices
      add constraint billing_invoices_invoice_source_check check (invoice_source in ('BatchGenerated', 'Custom')) not valid;
  exception
    when duplicate_object then null;
  end;

  begin
    alter table public.billing_invoices
      add constraint billing_invoices_invoice_status_check check (invoice_status in ('Draft', 'Finalized', 'Sent', 'Paid', 'PartiallyPaid', 'Void')) not valid;
  exception
    when duplicate_object then null;
  end;

  begin
    alter table public.billing_adjustments
      add constraint billing_adjustments_adjustment_type_check check (adjustment_type in ('ExtraDay', 'Credit', 'Discount', 'Refund', 'ManualCharge', 'ManualCredit', 'PriorBalance', 'Other')) not valid;
  exception
    when duplicate_object then null;
  end;

  begin
    alter table public.billing_adjustments
      add constraint billing_adjustments_billing_status_check check (billing_status in ('Unbilled', 'Billed', 'Excluded')) not valid;
  exception
    when duplicate_object then null;
  end;

  begin
    alter table public.billing_invoice_lines
      add constraint billing_invoice_lines_line_type_check check (line_type in ('BaseProgram', 'Transportation', 'Ancillary', 'Adjustment', 'Credit', 'PriorBalance')) not valid;
  exception
    when duplicate_object then null;
  end;

  begin
    alter table public.billing_invoice_lines
      add constraint billing_invoice_lines_billing_status_check check (billing_status in ('Unbilled', 'Billed', 'Excluded')) not valid;
  exception
    when duplicate_object then null;
  end;

  begin
    alter table public.billing_coverages
      add constraint billing_coverages_coverage_type_check check (coverage_type in ('BaseProgram', 'Transportation', 'Ancillary', 'Adjustment')) not valid;
  exception
    when duplicate_object then null;
  end;

  begin
    alter table public.billing_export_jobs
      add constraint billing_export_jobs_export_type_check check (export_type in ('QuickBooksCSV', 'InternalReviewCSV', 'InvoiceSummaryCSV')) not valid;
  exception
    when duplicate_object then null;
  end;

  begin
    alter table public.billing_export_jobs
      add constraint billing_export_jobs_quickbooks_detail_level_check check (quickbooks_detail_level in ('Summary', 'Detailed')) not valid;
  exception
    when duplicate_object then null;
  end;

  begin
    alter table public.billing_export_jobs
      add constraint billing_export_jobs_status_check check (status in ('Generated', 'Failed')) not valid;
  exception
    when duplicate_object then null;
  end;

  begin
    alter table public.transportation_logs
      add constraint transportation_logs_billing_status_check check (billing_status in ('Unbilled', 'Billed', 'Excluded')) not valid;
  exception
    when duplicate_object then null;
  end;

  begin
    alter table public.ancillary_charge_logs
      add constraint ancillary_charge_logs_billing_status_check check (billing_status in ('Unbilled', 'Billed', 'Excluded')) not valid;
  exception
    when duplicate_object then null;
  end;
end
$$;

alter table public.closure_rules validate constraint closure_rules_rule_type_check;
alter table public.closure_rules validate constraint closure_rules_month_check;
alter table public.closure_rules validate constraint closure_rules_day_check;
alter table public.closure_rules validate constraint closure_rules_weekday_check;
alter table public.closure_rules validate constraint closure_rules_occurrence_check;
alter table public.closure_rules validate constraint closure_rules_observed_when_weekend_check;
alter table public.center_closures validate constraint center_closures_closure_type_check;
alter table public.care_plans validate constraint care_plans_track_check;
alter table public.care_plans validate constraint care_plans_status_check;
alter table public.care_plan_sections validate constraint care_plan_sections_section_type_check;
alter table public.care_plan_versions validate constraint care_plan_versions_snapshot_type_check;
alter table public.care_plan_versions validate constraint care_plan_versions_status_check;
alter table public.billing_batches validate constraint billing_batches_batch_type_check;
alter table public.billing_batches validate constraint billing_batches_batch_status_check;
alter table public.billing_invoices validate constraint billing_invoices_invoice_source_check;
alter table public.billing_invoices validate constraint billing_invoices_invoice_status_check;
alter table public.billing_adjustments validate constraint billing_adjustments_adjustment_type_check;
alter table public.billing_adjustments validate constraint billing_adjustments_billing_status_check;
alter table public.billing_invoice_lines validate constraint billing_invoice_lines_line_type_check;
alter table public.billing_invoice_lines validate constraint billing_invoice_lines_billing_status_check;
alter table public.billing_coverages validate constraint billing_coverages_coverage_type_check;
alter table public.billing_export_jobs validate constraint billing_export_jobs_export_type_check;
alter table public.billing_export_jobs validate constraint billing_export_jobs_quickbooks_detail_level_check;
alter table public.billing_export_jobs validate constraint billing_export_jobs_status_check;
alter table public.transportation_logs validate constraint transportation_logs_billing_status_check;
alter table public.ancillary_charge_logs validate constraint ancillary_charge_logs_billing_status_check;
