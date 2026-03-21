create table if not exists public.medication_orders (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  physician_order_id uuid references public.physician_orders(id) on delete set null,
  pof_medication_id uuid references public.pof_medications(id) on delete set null,
  source_medication_id text,
  order_type text not null check (order_type in ('scheduled', 'prn')),
  medication_name text not null,
  strength text,
  form text,
  route text,
  directions text,
  prn_reason text,
  frequency_text text,
  min_interval_minutes integer check (min_interval_minutes is null or min_interval_minutes >= 0),
  max_doses_per_24h integer check (max_doses_per_24h is null or max_doses_per_24h > 0),
  max_daily_dose numeric,
  start_date date,
  end_date date,
  provider_name text,
  order_source text not null check (order_source in ('pof', 'manual_provider_order', 'legacy_mhp')),
  status text not null default 'active' check (status in ('active', 'inactive', 'expired', 'discontinued')),
  created_by uuid references public.profiles(id),
  verified_by uuid references public.profiles(id),
  requires_review boolean not null default false,
  requires_effectiveness_followup boolean not null default false,
  created_by_name text,
  verified_by_name text,
  source_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_medication_orders_member_status
  on public.medication_orders (member_id, order_type, status, start_date, end_date);

create index if not exists idx_medication_orders_member_source
  on public.medication_orders (member_id, order_source, created_at desc);

create index if not exists idx_medication_orders_physician_order
  on public.medication_orders (physician_order_id);

create unique index if not exists uniq_medication_orders_pof_medication
  on public.medication_orders (pof_medication_id);

create unique index if not exists uniq_medication_orders_pof_source
  on public.medication_orders (physician_order_id, source_medication_id)
  where order_source = 'pof'
    and physician_order_id is not null
    and source_medication_id is not null;

create table if not exists public.med_administration_logs (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  medication_order_id uuid not null references public.medication_orders(id) on delete restrict,
  legacy_mar_administration_id uuid references public.mar_administrations(id) on delete set null,
  admin_type text not null check (admin_type in ('scheduled', 'prn')),
  admin_datetime timestamptz not null,
  dose_given text,
  route_given text,
  indication text,
  symptom_score_before integer check (symptom_score_before is null or (symptom_score_before >= 0 and symptom_score_before <= 10)),
  followup_due_at timestamptz,
  followup_status text not null default 'not_required' check (followup_status in ('not_required', 'due', 'completed', 'overdue')),
  effectiveness_result text check (effectiveness_result in ('Effective', 'Ineffective')),
  followup_notes text,
  administered_by uuid references public.profiles(id),
  administered_by_name text,
  status text not null check (status in ('Given', 'Refused', 'Held', 'Omitted')),
  notes text,
  idempotency_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint med_administration_logs_followup_due_scope check (
    (followup_status = 'not_required' and followup_due_at is null)
    or (followup_status in ('due', 'completed', 'overdue') and followup_due_at is not null)
  ),
  constraint med_administration_logs_effectiveness_scope check (
    (followup_status = 'completed' and effectiveness_result is not null)
    or (followup_status in ('not_required', 'due', 'overdue') and effectiveness_result is null)
  )
);

create index if not exists idx_med_administration_logs_member_datetime
  on public.med_administration_logs (member_id, admin_datetime desc);

create index if not exists idx_med_administration_logs_order_datetime
  on public.med_administration_logs (medication_order_id, admin_datetime desc);

create unique index if not exists uniq_med_administration_logs_legacy_mar
  on public.med_administration_logs (legacy_mar_administration_id);

create unique index if not exists uniq_med_administration_logs_idempotency
  on public.med_administration_logs (idempotency_key)
  where idempotency_key is not null;

drop trigger if exists trg_medication_orders_updated on public.medication_orders;
create trigger trg_medication_orders_updated before update on public.medication_orders
for each row execute function public.set_updated_at();

drop trigger if exists trg_med_administration_logs_updated on public.med_administration_logs;
create trigger trg_med_administration_logs_updated before update on public.med_administration_logs
for each row execute function public.set_updated_at();

alter table public.medication_orders enable row level security;
alter table public.med_administration_logs enable row level security;

drop policy if exists "medication_orders_select" on public.medication_orders;
create policy "medication_orders_select" on public.medication_orders
for select using (public.current_role() in ('admin', 'manager', 'director', 'nurse'));

drop policy if exists "medication_orders_insert" on public.medication_orders;
create policy "medication_orders_insert" on public.medication_orders
for insert with check (public.current_role() in ('admin', 'manager', 'director', 'nurse'));

drop policy if exists "medication_orders_update" on public.medication_orders;
create policy "medication_orders_update" on public.medication_orders
for update using (public.current_role() in ('admin', 'manager', 'director', 'nurse'))
with check (public.current_role() in ('admin', 'manager', 'director', 'nurse'));

drop policy if exists "medication_orders_delete" on public.medication_orders;
create policy "medication_orders_delete" on public.medication_orders
for delete using (public.current_role() in ('admin', 'director'));

drop policy if exists "med_administration_logs_select" on public.med_administration_logs;
create policy "med_administration_logs_select" on public.med_administration_logs
for select using (public.current_role() in ('admin', 'manager', 'director', 'nurse'));

drop policy if exists "med_administration_logs_insert" on public.med_administration_logs;
create policy "med_administration_logs_insert" on public.med_administration_logs
for insert with check (
  public.current_role() in ('admin', 'manager', 'director')
  or administered_by = auth.uid()
);

drop policy if exists "med_administration_logs_update" on public.med_administration_logs;
create policy "med_administration_logs_update" on public.med_administration_logs
for update using (public.current_role() in ('admin', 'manager', 'director', 'nurse'))
with check (public.current_role() in ('admin', 'manager', 'director', 'nurse'));

insert into public.medication_orders (
  member_id,
  physician_order_id,
  pof_medication_id,
  source_medication_id,
  order_type,
  medication_name,
  strength,
  form,
  route,
  directions,
  prn_reason,
  frequency_text,
  start_date,
  end_date,
  provider_name,
  order_source,
  status,
  created_by,
  verified_by,
  requires_review,
  requires_effectiveness_followup,
  created_by_name,
  verified_by_name,
  source_payload,
  created_at,
  updated_at
)
select
  pm.member_id,
  pm.physician_order_id,
  pm.id,
  pm.source_medication_id,
  case when pm.prn then 'prn' else 'scheduled' end,
  pm.medication_name,
  coalesce(nullif(trim(coalesce(src.item ->> 'strength', '')), ''), pm.strength, nullif(trim(coalesce(src.item ->> 'quantity', '')), '')),
  nullif(trim(coalesce(src.item ->> 'form', '')), ''),
  pm.route,
  coalesce(
    nullif(trim(coalesce(src.item ->> 'instructions', '')), ''),
    nullif(trim(coalesce(src.item ->> 'comments', '')), ''),
    pm.instructions
  ),
  coalesce(nullif(trim(coalesce(src.item ->> 'prnInstructions', '')), ''), pm.prn_instructions),
  coalesce(nullif(trim(coalesce(src.item ->> 'frequency', '')), ''), pm.frequency),
  coalesce(nullif(trim(coalesce(src.item ->> 'startDate', '')), '')::date, pm.start_date),
  coalesce(nullif(trim(coalesce(src.item ->> 'endDate', '')), '')::date, pm.end_date),
  coalesce(nullif(trim(coalesce(src.item ->> 'provider', '')), ''), pm.provider, po.provider_name),
  case when pm.source_medication_id like 'mhp-%' then 'legacy_mhp' else 'pof' end,
  case
    when coalesce(pm.active, true) = false then 'inactive'
    when coalesce(nullif(trim(coalesce(src.item ->> 'endDate', '')), '')::date, pm.end_date) is not null
      and coalesce(nullif(trim(coalesce(src.item ->> 'endDate', '')), '')::date, pm.end_date) < current_date then 'expired'
    else 'active'
  end,
  pm.created_by_user_id,
  pm.updated_by_user_id,
  false,
  coalesce(pm.prn, false),
  pm.created_by_name,
  pm.updated_by_name,
  jsonb_build_object(
    'backfilled_from', 'pof_medications',
    'source_medication_id', pm.source_medication_id
  ) || case when src.item is null then '{}'::jsonb else jsonb_build_object('pof_medication_json', src.item) end,
  pm.created_at,
  pm.updated_at
from public.pof_medications pm
left join public.physician_orders po
  on po.id = pm.physician_order_id
left join lateral (
  select med.item
  from jsonb_array_elements(coalesce(po.medications, '[]'::jsonb)) with ordinality as med(item, ordinality)
  where coalesce(nullif(trim(med.item ->> 'id'), ''), format('medication-%s', med.ordinality)) = pm.source_medication_id
  limit 1
) src on true
on conflict (pof_medication_id) do update
set
  source_medication_id = excluded.source_medication_id,
  order_type = excluded.order_type,
  medication_name = excluded.medication_name,
  strength = excluded.strength,
  form = excluded.form,
  route = excluded.route,
  directions = excluded.directions,
  prn_reason = excluded.prn_reason,
  frequency_text = excluded.frequency_text,
  start_date = excluded.start_date,
  end_date = excluded.end_date,
  provider_name = excluded.provider_name,
  order_source = excluded.order_source,
  status = excluded.status,
  created_by = excluded.created_by,
  verified_by = excluded.verified_by,
  requires_review = excluded.requires_review,
  requires_effectiveness_followup = excluded.requires_effectiveness_followup,
  created_by_name = excluded.created_by_name,
  verified_by_name = excluded.verified_by_name,
  source_payload = excluded.source_payload,
  updated_at = excluded.updated_at;

insert into public.med_administration_logs (
  member_id,
  medication_order_id,
  legacy_mar_administration_id,
  admin_type,
  admin_datetime,
  dose_given,
  route_given,
  indication,
  followup_due_at,
  followup_status,
  effectiveness_result,
  followup_notes,
  administered_by,
  administered_by_name,
  status,
  notes,
  created_at,
  updated_at
)
select
  ma.member_id,
  mo.id,
  ma.id,
  'prn',
  ma.administered_at,
  ma.dose,
  ma.route,
  ma.prn_reason,
  case
    when ma.prn_outcome is not null then coalesce(ma.prn_outcome_assessed_at, ma.administered_at + interval '1 hour')
    else ma.administered_at + interval '1 hour'
  end,
  case
    when ma.prn_outcome is not null then 'completed'
    when ma.administered_at + interval '1 hour' < now() then 'overdue'
    else 'due'
  end,
  ma.prn_outcome,
  ma.prn_followup_note,
  ma.administered_by_user_id,
  ma.administered_by,
  'Given',
  ma.notes,
  ma.created_at,
  ma.updated_at
from public.mar_administrations ma
join public.medication_orders mo
  on mo.pof_medication_id = ma.pof_medication_id
where ma.source = 'prn'
on conflict (legacy_mar_administration_id) do update
set
  medication_order_id = excluded.medication_order_id,
  admin_datetime = excluded.admin_datetime,
  dose_given = excluded.dose_given,
  route_given = excluded.route_given,
  indication = excluded.indication,
  followup_due_at = excluded.followup_due_at,
  followup_status = excluded.followup_status,
  effectiveness_result = excluded.effectiveness_result,
  followup_notes = excluded.followup_notes,
  administered_by = excluded.administered_by,
  administered_by_name = excluded.administered_by_name,
  status = excluded.status,
  notes = excluded.notes,
  updated_at = excluded.updated_at;

create or replace function public.rpc_sync_active_prn_medication_orders(
  p_now timestamptz default now()
)
returns table (
  synced_orders integer,
  inactivated_orders integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_inactivated_current integer := 0;
  v_inactivated_stale integer := 0;
begin
  with active_signed_orders as (
    select
      po.id,
      po.member_id,
      po.provider_name,
      po.created_by_user_id,
      po.created_by_name,
      po.updated_by_user_id,
      po.updated_by_name,
      po.medications
    from public.physician_orders po
    where po.status = 'signed'
      and coalesce(po.is_active_signed, false) = true
  ), source_rows as (
    select
      aso.member_id,
      aso.id as physician_order_id,
      pm.id as pof_medication_id,
      src.source_medication_id,
      nullif(trim(src.item ->> 'name'), '') as medication_name,
      coalesce(nullif(trim(src.item ->> 'strength'), ''), nullif(trim(src.item ->> 'quantity'), ''), pm.strength) as strength,
      nullif(trim(src.item ->> 'form'), '') as form,
      nullif(trim(src.item ->> 'route'), '') as route,
      coalesce(nullif(trim(src.item ->> 'instructions'), ''), nullif(trim(src.item ->> 'comments'), ''), pm.instructions) as directions,
      nullif(trim(src.item ->> 'prnInstructions'), '') as prn_reason,
      nullif(trim(src.item ->> 'frequency'), '') as frequency_text,
      nullif(trim(src.item ->> 'startDate'), '')::date as start_date,
      nullif(trim(src.item ->> 'endDate'), '')::date as end_date,
      coalesce(nullif(trim(src.item ->> 'provider'), ''), pm.provider, aso.provider_name) as provider_name,
      case
        when coalesce(nullif(trim(src.item ->> 'active'), '')::boolean, true) = false then 'inactive'
        when nullif(trim(src.item ->> 'endDate'), '')::date is not null and nullif(trim(src.item ->> 'endDate'), '')::date < (v_now at time zone 'America/New_York')::date then 'expired'
        else 'active'
      end as status,
      aso.created_by_user_id as created_by,
      aso.updated_by_user_id as verified_by,
      aso.created_by_name,
      aso.updated_by_name as verified_by_name,
      jsonb_build_object(
        'source', 'pof',
        'physician_order_id', aso.id,
        'source_medication_id', src.source_medication_id,
        'medication_json', src.item
      ) as source_payload
    from active_signed_orders aso
    cross join lateral (
      select
        med.item,
        coalesce(nullif(trim(med.item ->> 'id'), ''), format('medication-%s', med.ordinality)) as source_medication_id
      from jsonb_array_elements(coalesce(aso.medications, '[]'::jsonb)) with ordinality as med(item, ordinality)
    ) src
    left join public.pof_medications pm
      on pm.physician_order_id = aso.id
     and pm.source_medication_id = src.source_medication_id
    where nullif(trim(src.item ->> 'name'), '') is not null
      and coalesce(nullif(trim(src.item ->> 'prn'), '')::boolean, false) = true
      and coalesce(nullif(trim(src.item ->> 'givenAtCenter'), '')::boolean, false) = true
  ), upserted as (
    insert into public.medication_orders (
      member_id,
      physician_order_id,
      pof_medication_id,
      source_medication_id,
      order_type,
      medication_name,
      strength,
      form,
      route,
      directions,
      prn_reason,
      frequency_text,
      start_date,
      end_date,
      provider_name,
      order_source,
      status,
      created_by,
      verified_by,
      requires_review,
      requires_effectiveness_followup,
      created_by_name,
      verified_by_name,
      source_payload,
      created_at,
      updated_at
    )
    select
      source_rows.member_id,
      source_rows.physician_order_id,
      source_rows.pof_medication_id,
      source_rows.source_medication_id,
      'prn',
      source_rows.medication_name,
      source_rows.strength,
      source_rows.form,
      source_rows.route,
      source_rows.directions,
      source_rows.prn_reason,
      source_rows.frequency_text,
      source_rows.start_date,
      source_rows.end_date,
      source_rows.provider_name,
      'pof',
      source_rows.status,
      source_rows.created_by,
      source_rows.verified_by,
      false,
      true,
      source_rows.created_by_name,
      source_rows.verified_by_name,
      source_rows.source_payload,
      v_now,
      v_now
    from source_rows
    on conflict (physician_order_id, source_medication_id) where order_source = 'pof'
    do update
    set
      member_id = excluded.member_id,
      pof_medication_id = excluded.pof_medication_id,
      medication_name = excluded.medication_name,
      strength = excluded.strength,
      form = excluded.form,
      route = excluded.route,
      directions = excluded.directions,
      prn_reason = excluded.prn_reason,
      frequency_text = excluded.frequency_text,
      start_date = excluded.start_date,
      end_date = excluded.end_date,
      provider_name = excluded.provider_name,
      status = excluded.status,
      verified_by = excluded.verified_by,
      requires_effectiveness_followup = excluded.requires_effectiveness_followup,
      verified_by_name = excluded.verified_by_name,
      source_payload = excluded.source_payload,
      updated_at = excluded.updated_at
    returning 1
  )
  select count(*) into synced_orders from upserted;

  update public.medication_orders mo
  set
    status = case
      when mo.end_date is not null and mo.end_date < (v_now at time zone 'America/New_York')::date then 'expired'
      else 'inactive'
    end,
    updated_at = v_now
  where mo.order_source = 'pof'
    and exists (
      select 1
      from public.physician_orders po
      where po.id = mo.physician_order_id
        and po.status = 'signed'
        and coalesce(po.is_active_signed, false) = true
    )
    and not exists (
      select 1
      from public.physician_orders po
      cross join lateral jsonb_array_elements(coalesce(po.medications, '[]'::jsonb)) with ordinality as med(item, ordinality)
      where po.id = mo.physician_order_id
        and po.status = 'signed'
        and coalesce(po.is_active_signed, false) = true
        and coalesce(nullif(trim(med.item ->> 'id'), ''), format('medication-%s', med.ordinality)) = mo.source_medication_id
        and nullif(trim(med.item ->> 'name'), '') is not null
        and coalesce(nullif(trim(med.item ->> 'prn'), '')::boolean, false) = true
        and coalesce(nullif(trim(med.item ->> 'givenAtCenter'), '')::boolean, false) = true
    );
  get diagnostics v_inactivated_current = row_count;

  update public.medication_orders mo
  set
    status = case
      when mo.end_date is not null and mo.end_date < (v_now at time zone 'America/New_York')::date then 'expired'
      else 'inactive'
    end,
    updated_at = v_now
  where mo.order_source = 'pof'
    and not exists (
      select 1
      from public.physician_orders po
      where po.id = mo.physician_order_id
        and po.status = 'signed'
        and coalesce(po.is_active_signed, false) = true
    );
  get diagnostics v_inactivated_stale = row_count;

  inactivated_orders := v_inactivated_current + v_inactivated_stale;
  return next;
end;
$$;

grant execute on function public.rpc_sync_active_prn_medication_orders(timestamptz) to authenticated, service_role;

create or replace function public.rpc_record_prn_medication_administration(
  p_medication_order_id uuid,
  p_admin_datetime timestamptz,
  p_dose_given text default null,
  p_route_given text default null,
  p_indication text default null,
  p_symptom_score_before integer default null,
  p_followup_due_at timestamptz default null,
  p_status text default 'Given',
  p_notes text default null,
  p_administered_by uuid default null,
  p_administered_by_name text default null,
  p_idempotency_key text default null,
  p_now timestamptz default now()
)
returns table (
  log_id uuid,
  member_id uuid,
  medication_order_id uuid,
  followup_due_at timestamptz,
  followup_status text,
  duplicate_safe boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_admin_datetime timestamptz := coalesce(p_admin_datetime, v_now);
  v_status text := coalesce(nullif(trim(p_status), ''), 'Given');
  v_order public.medication_orders%rowtype;
  v_existing_id uuid;
  v_last_given timestamptz;
  v_given_count integer := 0;
  v_current_dose numeric;
  v_previous_total numeric := 0;
  v_followup_due_at timestamptz;
begin
  if p_medication_order_id is null then
    raise exception 'PRN administration requires medication_order_id';
  end if;

  if v_status not in ('Given', 'Refused', 'Held', 'Omitted') then
    raise exception 'PRN administration status must be Given, Refused, Held, or Omitted';
  end if;

  if p_symptom_score_before is not null and (p_symptom_score_before < 0 or p_symptom_score_before > 10) then
    raise exception 'Symptom score must be between 0 and 10.';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_medication_order_id::text)::bigint);

  if nullif(trim(coalesce(p_idempotency_key, '')), '') is not null then
    select logs.id
    into v_existing_id
    from public.med_administration_logs logs
    where logs.idempotency_key = p_idempotency_key
    limit 1;

    if v_existing_id is not null then
      select
        logs.id,
        logs.member_id,
        logs.medication_order_id,
        logs.followup_due_at,
        logs.followup_status,
        true
      into
        log_id,
        member_id,
        medication_order_id,
        followup_due_at,
        followup_status,
        duplicate_safe
      from public.med_administration_logs logs
      where logs.id = v_existing_id;
      return next;
      return;
    end if;
  end if;

  select *
  into v_order
  from public.medication_orders
  where id = p_medication_order_id;

  if v_order.id is null then
    raise exception 'Selected PRN medication order was not found.';
  end if;

  if v_order.order_type <> 'prn' then
    raise exception 'Selected medication order is not a PRN order.';
  end if;

  if v_order.status <> 'active' then
    raise exception 'The selected PRN medication order is no longer active.';
  end if;

  if v_order.start_date is not null and v_admin_datetime::date < v_order.start_date then
    raise exception 'The selected PRN medication order is not active yet.';
  end if;

  if v_order.end_date is not null and v_admin_datetime::date > v_order.end_date then
    raise exception 'The selected PRN medication order has expired.';
  end if;

  if nullif(trim(coalesce(p_indication, '')), '') is null then
    raise exception 'Indication is required for PRN administration.';
  end if;

  if v_status = 'Given' then
    if v_order.min_interval_minutes is not null then
      select max(logs.admin_datetime)
      into v_last_given
      from public.med_administration_logs logs
      where logs.medication_order_id = v_order.id
        and logs.status = 'Given';

      if v_last_given is not null and v_admin_datetime < v_last_given + make_interval(mins => v_order.min_interval_minutes) then
        raise exception 'Minimum PRN interval has not been met for this medication order.';
      end if;
    end if;

    if v_order.max_doses_per_24h is not null then
      select count(*)
      into v_given_count
      from public.med_administration_logs logs
      where logs.medication_order_id = v_order.id
        and logs.status = 'Given'
        and logs.admin_datetime > v_admin_datetime - interval '24 hours'
        and logs.admin_datetime <= v_admin_datetime;

      if v_given_count >= v_order.max_doses_per_24h then
        raise exception 'Maximum PRN doses in 24 hours would be exceeded for this medication order.';
      end if;
    end if;

    if v_order.max_daily_dose is not null then
      v_current_dose := nullif(regexp_replace(coalesce(p_dose_given, ''), '[^0-9\.]+', '', 'g'), '')::numeric;

      if v_current_dose is not null then
        select coalesce(sum(nullif(regexp_replace(coalesce(logs.dose_given, ''), '[^0-9\.]+', '', 'g'), '')::numeric), 0)
        into v_previous_total
        from public.med_administration_logs logs
        where logs.medication_order_id = v_order.id
          and logs.status = 'Given'
          and logs.admin_datetime > v_admin_datetime - interval '24 hours'
          and logs.admin_datetime <= v_admin_datetime;

        if v_previous_total + v_current_dose > v_order.max_daily_dose then
          raise exception 'Maximum PRN daily dose would be exceeded for this medication order.';
        end if;
      end if;
    end if;
  end if;

  if v_status = 'Given' and v_order.requires_effectiveness_followup then
    v_followup_due_at := coalesce(p_followup_due_at, v_admin_datetime + interval '1 hour');
    followup_status := case when v_followup_due_at < v_now then 'overdue' else 'due' end;
  else
    v_followup_due_at := null;
    followup_status := 'not_required';
  end if;

  insert into public.med_administration_logs (
    member_id,
    medication_order_id,
    admin_type,
    admin_datetime,
    dose_given,
    route_given,
    indication,
    symptom_score_before,
    followup_due_at,
    followup_status,
    effectiveness_result,
    followup_notes,
    administered_by,
    administered_by_name,
    status,
    notes,
    idempotency_key,
    created_at,
    updated_at
  )
  values (
    v_order.member_id,
    v_order.id,
    'prn',
    v_admin_datetime,
    nullif(trim(coalesce(p_dose_given, '')), ''),
    nullif(trim(coalesce(p_route_given, '')), ''),
    nullif(trim(coalesce(p_indication, '')), ''),
    p_symptom_score_before,
    v_followup_due_at,
    followup_status,
    null,
    null,
    p_administered_by,
    nullif(trim(coalesce(p_administered_by_name, '')), ''),
    v_status,
    nullif(trim(coalesce(p_notes, '')), ''),
    nullif(trim(coalesce(p_idempotency_key, '')), ''),
    v_now,
    v_now
  )
  returning
    id,
    member_id,
    medication_order_id
  into
    log_id,
    member_id,
    medication_order_id;

  duplicate_safe := false;
  followup_due_at := v_followup_due_at;
  return next;
end;
$$;

grant execute on function public.rpc_record_prn_medication_administration(
  uuid,
  timestamptz,
  text,
  text,
  text,
  integer,
  timestamptz,
  text,
  text,
  uuid,
  text,
  text,
  timestamptz
) to authenticated, service_role;

create or replace function public.rpc_create_prn_medication_order_and_administer(
  p_member_id uuid,
  p_order_payload jsonb default '{}'::jsonb,
  p_admin_payload jsonb default '{}'::jsonb,
  p_actor_user_id uuid default null,
  p_actor_name text default null,
  p_now timestamptz default now()
)
returns table (
  medication_order_id uuid,
  log_id uuid,
  member_id uuid,
  followup_due_at timestamptz,
  followup_status text,
  duplicate_safe boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_order public.medication_orders%rowtype;
  v_requires_review boolean := coalesce((p_order_payload ->> 'requires_review')::boolean, true);
  v_requires_followup boolean := coalesce((p_order_payload ->> 'requires_effectiveness_followup')::boolean, true);
begin
  if p_member_id is null then
    raise exception 'PRN medication order creation requires member_id';
  end if;

  if nullif(trim(coalesce(p_order_payload ->> 'medication_name', '')), '') is null then
    raise exception 'Medication name is required for new PRN orders.';
  end if;

  if nullif(trim(coalesce(p_order_payload ->> 'provider_name', '')), '') is null then
    raise exception 'Provider name is required for new PRN orders.';
  end if;

  if nullif(trim(coalesce(p_order_payload ->> 'directions', '')), '') is null then
    raise exception 'Directions are required for new PRN orders.';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_member_id::text)::bigint);

  insert into public.medication_orders (
    member_id,
    physician_order_id,
    pof_medication_id,
    source_medication_id,
    order_type,
    medication_name,
    strength,
    form,
    route,
    directions,
    prn_reason,
    frequency_text,
    min_interval_minutes,
    max_doses_per_24h,
    max_daily_dose,
    start_date,
    end_date,
    provider_name,
    order_source,
    status,
    created_by,
    verified_by,
    requires_review,
    requires_effectiveness_followup,
    created_by_name,
    verified_by_name,
    source_payload,
    created_at,
    updated_at
  )
  values (
    p_member_id,
    nullif(trim(coalesce(p_order_payload ->> 'physician_order_id', '')), '')::uuid,
    nullif(trim(coalesce(p_order_payload ->> 'pof_medication_id', '')), '')::uuid,
    nullif(trim(coalesce(p_order_payload ->> 'source_medication_id', '')), ''),
    'prn',
    nullif(trim(coalesce(p_order_payload ->> 'medication_name', '')), ''),
    nullif(trim(coalesce(p_order_payload ->> 'strength', '')), ''),
    nullif(trim(coalesce(p_order_payload ->> 'form', '')), ''),
    nullif(trim(coalesce(p_order_payload ->> 'route', '')), ''),
    nullif(trim(coalesce(p_order_payload ->> 'directions', '')), ''),
    nullif(trim(coalesce(p_order_payload ->> 'prn_reason', '')), ''),
    nullif(trim(coalesce(p_order_payload ->> 'frequency_text', '')), ''),
    nullif(trim(coalesce(p_order_payload ->> 'min_interval_minutes', '')), '')::integer,
    nullif(trim(coalesce(p_order_payload ->> 'max_doses_per_24h', '')), '')::integer,
    nullif(trim(coalesce(p_order_payload ->> 'max_daily_dose', '')), '')::numeric,
    nullif(trim(coalesce(p_order_payload ->> 'start_date', '')), '')::date,
    nullif(trim(coalesce(p_order_payload ->> 'end_date', '')), '')::date,
    nullif(trim(coalesce(p_order_payload ->> 'provider_name', '')), ''),
    'manual_provider_order',
    coalesce(nullif(trim(coalesce(p_order_payload ->> 'status', '')), ''), 'active'),
    p_actor_user_id,
    nullif(trim(coalesce(p_order_payload ->> 'verified_by', '')), '')::uuid,
    v_requires_review,
    v_requires_followup,
    nullif(trim(coalesce(p_actor_name, '')), ''),
    nullif(trim(coalesce(p_order_payload ->> 'verified_by_name', '')), ''),
    jsonb_build_object(
      'source', 'manual_provider_order',
      'order_payload', p_order_payload
    ),
    v_now,
    v_now
  )
  returning * into v_order;

  select
    logged.medication_order_id,
    logged.log_id,
    logged.member_id,
    logged.followup_due_at,
    logged.followup_status,
    logged.duplicate_safe
  into
    medication_order_id,
    log_id,
    member_id,
    followup_due_at,
    followup_status,
    duplicate_safe
  from public.rpc_record_prn_medication_administration(
    v_order.id,
    nullif(trim(coalesce(p_admin_payload ->> 'admin_datetime', '')), '')::timestamptz,
    nullif(trim(coalesce(p_admin_payload ->> 'dose_given', '')), ''),
    nullif(trim(coalesce(p_admin_payload ->> 'route_given', '')), ''),
    nullif(trim(coalesce(p_admin_payload ->> 'indication', '')), ''),
    nullif(trim(coalesce(p_admin_payload ->> 'symptom_score_before', '')), '')::integer,
    nullif(trim(coalesce(p_admin_payload ->> 'followup_due_at', '')), '')::timestamptz,
    coalesce(nullif(trim(coalesce(p_admin_payload ->> 'status', '')), ''), 'Given'),
    nullif(trim(coalesce(p_admin_payload ->> 'notes', '')), ''),
    p_actor_user_id,
    nullif(trim(coalesce(p_actor_name, '')), ''),
    nullif(trim(coalesce(p_admin_payload ->> 'idempotency_key', '')), ''),
    v_now
  ) as logged;

  return next;
end;
$$;

grant execute on function public.rpc_create_prn_medication_order_and_administer(
  uuid,
  jsonb,
  jsonb,
  uuid,
  text,
  timestamptz
) to authenticated, service_role;

create or replace function public.rpc_complete_prn_administration_followup(
  p_log_id uuid,
  p_effectiveness_result text,
  p_followup_notes text default null,
  p_assessed_at timestamptz default now(),
  p_now timestamptz default now()
)
returns table (
  log_id uuid,
  member_id uuid,
  medication_order_id uuid,
  followup_due_at timestamptz,
  followup_status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_assessed_at timestamptz := coalesce(p_assessed_at, v_now);
begin
  if p_log_id is null then
    raise exception 'PRN follow-up requires log_id';
  end if;

  if p_effectiveness_result not in ('Effective', 'Ineffective') then
    raise exception 'PRN follow-up result must be Effective or Ineffective.';
  end if;

  if p_effectiveness_result = 'Ineffective' and nullif(trim(coalesce(p_followup_notes, '')), '') is null then
    raise exception 'Follow-up note is required when PRN outcome is Ineffective.';
  end if;

  update public.med_administration_logs logs
  set
    followup_due_at = coalesce(logs.followup_due_at, v_assessed_at),
    followup_status = 'completed',
    effectiveness_result = p_effectiveness_result,
    followup_notes = nullif(trim(coalesce(p_followup_notes, '')), ''),
    updated_at = v_now
  where logs.id = p_log_id
    and logs.admin_type = 'prn'
    and logs.status = 'Given'
    and logs.followup_status <> 'not_required'
  returning
    logs.id,
    logs.member_id,
    logs.medication_order_id,
    logs.followup_due_at,
    logs.followup_status
  into
    log_id,
    member_id,
    medication_order_id,
    followup_due_at,
    followup_status;

  if log_id is null then
    raise exception 'PRN follow-up can only be completed for given PRN administrations that require follow-up.';
  end if;

  return next;
end;
$$;

grant execute on function public.rpc_complete_prn_administration_followup(
  uuid,
  text,
  text,
  timestamptz,
  timestamptz
) to authenticated, service_role;
