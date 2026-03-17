create table if not exists public.transportation_runs (
  id uuid primary key default gen_random_uuid(),
  service_date date not null,
  shift text not null check (shift in ('AM', 'PM')),
  bus_number text not null,
  status text not null default 'Posted' check (status in ('Posted')),
  submitted_by_user_id uuid references public.profiles(id) on delete set null,
  submitted_by_name text,
  posted_at timestamptz not null default now(),
  last_submitted_at timestamptz not null default now(),
  submission_count integer not null default 1 check (submission_count > 0),
  total_expected integer not null default 0,
  total_posted integer not null default 0,
  total_excluded integer not null default 0,
  total_duplicates integer not null default 0,
  total_nonbillable integer not null default 0,
  last_attempt_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_transportation_runs_unique_scope
  on public.transportation_runs (service_date, shift, bus_number);

create index if not exists idx_transportation_runs_service_date
  on public.transportation_runs (service_date desc, shift, bus_number);

create table if not exists public.transportation_run_results (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.transportation_runs(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  service_date date not null,
  shift text not null check (shift in ('AM', 'PM')),
  bus_number text not null,
  result_status text not null check (result_status in ('posted', 'excluded', 'duplicate_skipped')),
  reason_code text check (
    reason_code in (
      'none',
      'no-show',
      'family-transported',
      'refused',
      'absent',
      'hospital',
      'excluded',
      'other',
      'inactive',
      'outside-route-dates',
      'already-posted',
      'billing-waived',
      'included-in-program-rate',
      'member-hold'
    )
  ),
  reason_notes text,
  rider_source text not null check (rider_source in ('schedule', 'manual-add')),
  transport_type text check (transport_type in ('Door to Door', 'Bus Stop')),
  bus_stop_name text,
  door_to_door_address text,
  caregiver_contact_id text references public.member_contacts(id) on delete set null,
  caregiver_contact_name_snapshot text,
  caregiver_contact_phone_snapshot text,
  caregiver_contact_address_snapshot text,
  transportation_billing_status_snapshot text not null check (
    transportation_billing_status_snapshot in ('BillNormally', 'Waived', 'IncludedInProgramRate')
  ),
  billable boolean not null default true,
  transport_log_id uuid references public.transportation_logs(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, member_id)
);

create index if not exists idx_transportation_run_results_run
  on public.transportation_run_results (run_id, result_status, created_at desc);

create index if not exists idx_transportation_run_results_member_date
  on public.transportation_run_results (member_id, service_date desc, shift);

alter table public.transportation_logs
  add column if not exists transport_run_id uuid references public.transportation_runs(id) on delete set null,
  add column if not exists transport_run_result_id uuid references public.transportation_run_results(id) on delete set null,
  add column if not exists bus_number text,
  add column if not exists posting_source text not null default 'legacy-documentation',
  add column if not exists posting_scope_key text,
  add column if not exists posted_by_user_id uuid references public.profiles(id) on delete set null,
  add column if not exists posted_by_name text,
  add column if not exists transportation_billing_status_snapshot text,
  add column if not exists transport_one_way_rate_snapshot numeric(10,2) not null default 0,
  add column if not exists transport_round_trip_rate_snapshot numeric(10,2) not null default 0;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'transportation_logs_posting_source_check'
      and conrelid = 'public.transportation_logs'::regclass
  ) then
    alter table public.transportation_logs
      add constraint transportation_logs_posting_source_check
      check (posting_source in ('legacy-documentation', 'transportation-run-post'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'transportation_logs_transportation_billing_status_snapshot_check'
      and conrelid = 'public.transportation_logs'::regclass
  ) then
    alter table public.transportation_logs
      add constraint transportation_logs_transportation_billing_status_snapshot_check
      check (
        transportation_billing_status_snapshot is null
        or transportation_billing_status_snapshot in ('BillNormally', 'Waived', 'IncludedInProgramRate')
      );
  end if;
end $$;

create unique index if not exists idx_transportation_logs_posting_scope_key
  on public.transportation_logs (posting_scope_key)
  where posting_scope_key is not null;

create index if not exists idx_transportation_logs_run_member_period
  on public.transportation_logs (member_id, service_date desc, period, transport_run_id);

update public.transportation_logs
set posting_source = coalesce(nullif(posting_source, ''), 'legacy-documentation'),
    transport_one_way_rate_snapshot = coalesce(transport_one_way_rate_snapshot, 0),
    transport_round_trip_rate_snapshot = coalesce(transport_round_trip_rate_snapshot, 0),
    updated_at = coalesce(updated_at, created_at, now())
where posting_source is null
   or transport_one_way_rate_snapshot is null
   or transport_round_trip_rate_snapshot is null
   or updated_at is null;

drop trigger if exists trg_transportation_runs_updated on public.transportation_runs;
create trigger trg_transportation_runs_updated before update on public.transportation_runs
for each row execute function public.set_updated_at();

drop trigger if exists trg_transportation_run_results_updated on public.transportation_run_results;
create trigger trg_transportation_run_results_updated before update on public.transportation_run_results
for each row execute function public.set_updated_at();

alter table public.transportation_runs enable row level security;
alter table public.transportation_run_results enable row level security;

drop policy if exists "transportation_runs_select" on public.transportation_runs;
create policy "transportation_runs_select"
on public.transportation_runs
for select
to authenticated
using (true);

drop policy if exists "transportation_run_results_select" on public.transportation_run_results;
create policy "transportation_run_results_select"
on public.transportation_run_results
for select
to authenticated
using (true);

create or replace function public.rpc_post_transportation_run(
  p_run jsonb,
  p_result_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_service_date date;
  v_shift text;
  v_bus_number text;
  v_submitted_by_user_id uuid;
  v_submitted_by_name text;
  v_submitted_at timestamptz;
  v_run_id uuid;
  v_expected_count integer := 0;
  v_posted_count integer := 0;
  v_excluded_count integer := 0;
  v_duplicate_count integer := 0;
  v_nonbillable_count integer := 0;
begin
  if jsonb_typeof(coalesce(p_result_rows, '[]'::jsonb)) <> 'array' then
    raise exception 'p_result_rows must be a JSON array';
  end if;

  v_service_date := nullif(trim(coalesce(p_run ->> 'service_date', '')), '')::date;
  v_shift := nullif(trim(coalesce(p_run ->> 'shift', '')), '');
  v_bus_number := nullif(trim(coalesce(p_run ->> 'bus_number', '')), '');
  v_submitted_by_user_id := nullif(trim(coalesce(p_run ->> 'submitted_by_user_id', '')), '')::uuid;
  v_submitted_by_name := nullif(trim(coalesce(p_run ->> 'submitted_by_name', '')), '');
  v_submitted_at := coalesce(nullif(trim(coalesce(p_run ->> 'submitted_at', '')), '')::timestamptz, now());

  if v_service_date is null then
    raise exception 'Transportation run service_date is required';
  end if;
  if v_shift not in ('AM', 'PM') then
    raise exception 'Transportation run shift must be AM or PM';
  end if;
  if v_bus_number is null then
    raise exception 'Transportation run bus_number is required';
  end if;

  create temporary table tmp_transportation_run_rows (
    member_id uuid not null,
    member_name text not null,
    first_name text,
    service_date date not null,
    shift text not null,
    bus_number text not null,
    result_status text not null,
    reason_code text,
    reason_notes text,
    rider_source text not null,
    transport_type text,
    bus_stop_name text,
    door_to_door_address text,
    caregiver_contact_id text,
    caregiver_contact_name_snapshot text,
    caregiver_contact_phone_snapshot text,
    caregiver_contact_address_snapshot text,
    transportation_billing_status_snapshot text not null,
    billable boolean not null,
    one_way_rate numeric(10,2) not null,
    round_trip_rate numeric(10,2) not null,
    posting_scope_key text
  ) on commit drop;

  insert into tmp_transportation_run_rows (
    member_id,
    member_name,
    first_name,
    service_date,
    shift,
    bus_number,
    result_status,
    reason_code,
    reason_notes,
    rider_source,
    transport_type,
    bus_stop_name,
    door_to_door_address,
    caregiver_contact_id,
    caregiver_contact_name_snapshot,
    caregiver_contact_phone_snapshot,
    caregiver_contact_address_snapshot,
    transportation_billing_status_snapshot,
    billable,
    one_way_rate,
    round_trip_rate,
    posting_scope_key
  )
  select
    row_data.member_id,
    row_data.member_name,
    row_data.first_name,
    row_data.service_date,
    row_data.shift,
    row_data.bus_number,
    row_data.result_status,
    nullif(trim(coalesce(row_data.reason_code, '')), ''),
    nullif(trim(coalesce(row_data.reason_notes, '')), ''),
    row_data.rider_source,
    nullif(trim(coalesce(row_data.transport_type, '')), ''),
    nullif(trim(coalesce(row_data.bus_stop_name, '')), ''),
    nullif(trim(coalesce(row_data.door_to_door_address, '')), ''),
    nullif(trim(coalesce(row_data.caregiver_contact_id, '')), ''),
    nullif(trim(coalesce(row_data.caregiver_contact_name_snapshot, '')), ''),
    nullif(trim(coalesce(row_data.caregiver_contact_phone_snapshot, '')), ''),
    nullif(trim(coalesce(row_data.caregiver_contact_address_snapshot, '')), ''),
    row_data.transportation_billing_status_snapshot,
    coalesce(row_data.billable, false),
    coalesce(row_data.one_way_rate, 0),
    coalesce(row_data.round_trip_rate, 0),
    nullif(trim(coalesce(row_data.posting_scope_key, '')), '')
  from jsonb_to_recordset(p_result_rows) as row_data(
    member_id uuid,
    member_name text,
    first_name text,
    service_date date,
    shift text,
    bus_number text,
    result_status text,
    reason_code text,
    reason_notes text,
    rider_source text,
    transport_type text,
    bus_stop_name text,
    door_to_door_address text,
    caregiver_contact_id text,
    caregiver_contact_name_snapshot text,
    caregiver_contact_phone_snapshot text,
    caregiver_contact_address_snapshot text,
    transportation_billing_status_snapshot text,
    billable boolean,
    one_way_rate numeric,
    round_trip_rate numeric,
    posting_scope_key text
  );

  if not exists (select 1 from tmp_transportation_run_rows) then
    raise exception 'Transportation run posting requires at least one manifest row';
  end if;

  if exists (
    select 1
    from tmp_transportation_run_rows
    where service_date <> v_service_date
       or shift <> v_shift
       or bus_number <> v_bus_number
       or result_status not in ('posted', 'excluded', 'duplicate_skipped')
       or rider_source not in ('schedule', 'manual-add')
       or transportation_billing_status_snapshot not in ('BillNormally', 'Waived', 'IncludedInProgramRate')
  ) then
    raise exception 'Transportation run payload contains invalid manifest rows';
  end if;

  insert into public.transportation_runs (
    service_date,
    shift,
    bus_number,
    status,
    submitted_by_user_id,
    submitted_by_name,
    posted_at,
    last_submitted_at,
    submission_count,
    total_expected,
    total_posted,
    total_excluded,
    total_duplicates,
    total_nonbillable,
    last_attempt_summary
  )
  values (
    v_service_date,
    v_shift,
    v_bus_number,
    'Posted',
    v_submitted_by_user_id,
    v_submitted_by_name,
    v_submitted_at,
    v_submitted_at,
    1,
    0,
    0,
    0,
    0,
    0,
    '{}'::jsonb
  )
  on conflict (service_date, shift, bus_number)
  do update set
    submitted_by_user_id = excluded.submitted_by_user_id,
    submitted_by_name = excluded.submitted_by_name,
    last_submitted_at = excluded.last_submitted_at,
    submission_count = public.transportation_runs.submission_count + 1,
    updated_at = now()
  returning id into v_run_id;

  create temporary table tmp_existing_transport_logs on commit drop as
  select
    row_data.member_id,
    row_data.service_date,
    row_data.shift,
    min(tl.id) as transport_log_id
  from tmp_transportation_run_rows as row_data
  join public.transportation_logs as tl
    on tl.member_id = row_data.member_id
   and tl.service_date = row_data.service_date
   and tl.period = row_data.shift
  group by row_data.member_id, row_data.service_date, row_data.shift;

  create temporary table tmp_transportation_logs_inserted on commit drop as
  with inserted_rows as (
    insert into public.transportation_logs (
      member_id,
      first_name,
      period,
      transport_type,
      trip_type,
      service_date,
      staff_user_id,
      billable,
      billing_status,
      billing_exclusion_reason,
      quantity,
      unit_rate,
      total_amount,
      transport_run_id,
      bus_number,
      posting_source,
      posting_scope_key,
      posted_by_user_id,
      posted_by_name,
      transportation_billing_status_snapshot,
      transport_one_way_rate_snapshot,
      transport_round_trip_rate_snapshot,
      created_at,
      updated_at
    )
    select
      row_data.member_id,
      nullif(trim(coalesce(row_data.first_name, split_part(row_data.member_name, ' ', 1))), ''),
      row_data.shift,
      row_data.transport_type,
      case when row_data.billable then 'OneWay' else 'NonBillableOperational' end,
      row_data.service_date,
      v_submitted_by_user_id,
      row_data.billable,
      case when row_data.billable then 'Unbilled' else 'Excluded' end,
      case
        when row_data.billable then null
        when row_data.transportation_billing_status_snapshot = 'Waived' then 'Waived'
        when row_data.transportation_billing_status_snapshot = 'IncludedInProgramRate' then 'IncludedInProgramRate'
        else coalesce(row_data.reason_code, 'Excluded')
      end,
      1,
      case when row_data.billable then row_data.one_way_rate else 0 end,
      case when row_data.billable then row_data.one_way_rate else 0 end,
      v_run_id,
      row_data.bus_number,
      'transportation-run-post',
      row_data.posting_scope_key,
      v_submitted_by_user_id,
      v_submitted_by_name,
      row_data.transportation_billing_status_snapshot,
      row_data.one_way_rate,
      row_data.round_trip_rate,
      v_submitted_at,
      v_submitted_at
    from tmp_transportation_run_rows as row_data
    where row_data.result_status = 'posted'
      and not exists (
        select 1
        from tmp_existing_transport_logs as existing_log
        where existing_log.member_id = row_data.member_id
          and existing_log.service_date = row_data.service_date
          and existing_log.shift = row_data.shift
      )
    on conflict (posting_scope_key) do nothing
    returning id, member_id, service_date, period, posting_scope_key
  )
  select * from inserted_rows;

  update public.transportation_logs as tl
  set trip_type = rate_payload.trip_type,
      unit_rate = rate_payload.unit_rate,
      total_amount = rate_payload.total_amount,
      updated_at = v_submitted_at
  from (
    select
      paired_logs.id,
      case when pair_summary.billable_leg_count >= 2 then 'RoundTrip' else 'OneWay' end as trip_type,
      case
        when pair_summary.billable_leg_count >= 2 and paired_logs.period = 'AM'
          then round(pair_summary.round_trip_rate / 2.0, 2)
        when pair_summary.billable_leg_count >= 2 and paired_logs.period = 'PM'
          then pair_summary.round_trip_rate - round(pair_summary.round_trip_rate / 2.0, 2)
        else pair_summary.one_way_rate
      end as unit_rate,
      case
        when pair_summary.billable_leg_count >= 2 and paired_logs.period = 'AM'
          then round(pair_summary.round_trip_rate / 2.0, 2)
        when pair_summary.billable_leg_count >= 2 and paired_logs.period = 'PM'
          then pair_summary.round_trip_rate - round(pair_summary.round_trip_rate / 2.0, 2)
        else pair_summary.one_way_rate
      end as total_amount
    from public.transportation_logs as paired_logs
    join (
      select
        member_id,
        service_date,
        max(transport_one_way_rate_snapshot) as one_way_rate,
        max(transport_round_trip_rate_snapshot) as round_trip_rate,
        count(*) filter (where billable = true and coalesce(billing_status, 'Unbilled') <> 'Billed') as billable_leg_count
      from public.transportation_logs
      where posting_source = 'transportation-run-post'
        and billable = true
        and coalesce(billing_status, 'Unbilled') <> 'Billed'
        and (member_id, service_date) in (
          select member_id, service_date
          from tmp_transportation_logs_inserted
        )
      group by member_id, service_date
    ) as pair_summary
      on pair_summary.member_id = paired_logs.member_id
     and pair_summary.service_date = paired_logs.service_date
    where paired_logs.posting_source = 'transportation-run-post'
      and paired_logs.billable = true
      and coalesce(paired_logs.billing_status, 'Unbilled') <> 'Billed'
  ) as rate_payload
  where tl.id = rate_payload.id;

  insert into public.transportation_run_results (
    run_id,
    member_id,
    service_date,
    shift,
    bus_number,
    result_status,
    reason_code,
    reason_notes,
    rider_source,
    transport_type,
    bus_stop_name,
    door_to_door_address,
    caregiver_contact_id,
    caregiver_contact_name_snapshot,
    caregiver_contact_phone_snapshot,
    caregiver_contact_address_snapshot,
    transportation_billing_status_snapshot,
    billable,
    transport_log_id,
    created_at,
    updated_at
  )
  select
    v_run_id,
    row_data.member_id,
    row_data.service_date,
    row_data.shift,
    row_data.bus_number,
    'posted',
    coalesce(row_data.reason_code, 'none'),
    row_data.reason_notes,
    row_data.rider_source,
    row_data.transport_type,
    row_data.bus_stop_name,
    row_data.door_to_door_address,
    row_data.caregiver_contact_id,
    row_data.caregiver_contact_name_snapshot,
    row_data.caregiver_contact_phone_snapshot,
    row_data.caregiver_contact_address_snapshot,
    row_data.transportation_billing_status_snapshot,
    row_data.billable,
    inserted_log.id,
    v_submitted_at,
    v_submitted_at
  from tmp_transportation_run_rows as row_data
  join tmp_transportation_logs_inserted as inserted_log
    on inserted_log.member_id = row_data.member_id
   and inserted_log.service_date = row_data.service_date
   and inserted_log.period = row_data.shift
  on conflict (run_id, member_id) do nothing;

  insert into public.transportation_run_results (
    run_id,
    member_id,
    service_date,
    shift,
    bus_number,
    result_status,
    reason_code,
    reason_notes,
    rider_source,
    transport_type,
    bus_stop_name,
    door_to_door_address,
    caregiver_contact_id,
    caregiver_contact_name_snapshot,
    caregiver_contact_phone_snapshot,
    caregiver_contact_address_snapshot,
    transportation_billing_status_snapshot,
    billable,
    transport_log_id,
    created_at,
    updated_at
  )
  select
    v_run_id,
    row_data.member_id,
    row_data.service_date,
    row_data.shift,
    row_data.bus_number,
    'excluded',
    coalesce(row_data.reason_code, 'excluded'),
    row_data.reason_notes,
    row_data.rider_source,
    row_data.transport_type,
    row_data.bus_stop_name,
    row_data.door_to_door_address,
    row_data.caregiver_contact_id,
    row_data.caregiver_contact_name_snapshot,
    row_data.caregiver_contact_phone_snapshot,
    row_data.caregiver_contact_address_snapshot,
    row_data.transportation_billing_status_snapshot,
    false,
    null,
    v_submitted_at,
    v_submitted_at
  from tmp_transportation_run_rows as row_data
  where row_data.result_status = 'excluded'
  on conflict (run_id, member_id) do nothing;

  insert into public.transportation_run_results (
    run_id,
    member_id,
    service_date,
    shift,
    bus_number,
    result_status,
    reason_code,
    reason_notes,
    rider_source,
    transport_type,
    bus_stop_name,
    door_to_door_address,
    caregiver_contact_id,
    caregiver_contact_name_snapshot,
    caregiver_contact_phone_snapshot,
    caregiver_contact_address_snapshot,
    transportation_billing_status_snapshot,
    billable,
    transport_log_id,
    created_at,
    updated_at
  )
  select
    v_run_id,
    row_data.member_id,
    row_data.service_date,
    row_data.shift,
    row_data.bus_number,
    'duplicate_skipped',
    'already-posted',
    row_data.reason_notes,
    row_data.rider_source,
    row_data.transport_type,
    row_data.bus_stop_name,
    row_data.door_to_door_address,
    row_data.caregiver_contact_id,
    row_data.caregiver_contact_name_snapshot,
    row_data.caregiver_contact_phone_snapshot,
    row_data.caregiver_contact_address_snapshot,
    row_data.transportation_billing_status_snapshot,
    false,
    existing_log.transport_log_id,
    v_submitted_at,
    v_submitted_at
  from tmp_transportation_run_rows as row_data
  left join tmp_existing_transport_logs as existing_log
    on existing_log.member_id = row_data.member_id
   and existing_log.service_date = row_data.service_date
   and existing_log.shift = row_data.shift
  where row_data.result_status = 'duplicate_skipped'
     or (
       row_data.result_status = 'posted'
       and not exists (
         select 1
         from tmp_transportation_logs_inserted as inserted_log
         where inserted_log.member_id = row_data.member_id
           and inserted_log.service_date = row_data.service_date
           and inserted_log.period = row_data.shift
       )
     )
  on conflict (run_id, member_id) do nothing;

  select count(*) into v_expected_count
  from tmp_transportation_run_rows;

  select count(*) into v_posted_count
  from tmp_transportation_logs_inserted;

  select count(*) into v_excluded_count
  from tmp_transportation_run_rows
  where result_status = 'excluded';

  select count(*) into v_duplicate_count
  from tmp_transportation_run_rows
  where result_status = 'duplicate_skipped'
     or (
       result_status = 'posted'
       and not exists (
         select 1
         from tmp_transportation_logs_inserted as inserted_log
         where inserted_log.member_id = tmp_transportation_run_rows.member_id
           and inserted_log.service_date = tmp_transportation_run_rows.service_date
           and inserted_log.period = tmp_transportation_run_rows.shift
       )
     );

  select count(*) into v_nonbillable_count
  from tmp_transportation_run_rows
  where result_status = 'posted'
    and billable = false;

  update public.transportation_runs
  set total_expected = v_expected_count,
      total_posted = v_posted_count,
      total_excluded = v_excluded_count,
      total_duplicates = v_duplicate_count,
      total_nonbillable = v_nonbillable_count,
      last_attempt_summary = jsonb_build_object(
        'expected_riders', v_expected_count,
        'posted_riders', v_posted_count,
        'excluded_riders', v_excluded_count,
        'skipped_duplicates', v_duplicate_count,
        'waived_nonbillable_riders', v_nonbillable_count
      ),
      updated_at = now()
  where id = v_run_id;

  return jsonb_build_object(
    'run_id', v_run_id,
    'expected_riders', v_expected_count,
    'posted_riders', v_posted_count,
    'excluded_riders', v_excluded_count,
    'skipped_duplicates', v_duplicate_count,
    'waived_nonbillable_riders', v_nonbillable_count
  );
end;
$$;

revoke all on function public.rpc_post_transportation_run(jsonb, jsonb) from public;
grant execute on function public.rpc_post_transportation_run(jsonb, jsonb) to service_role;
