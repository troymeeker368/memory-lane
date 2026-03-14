create table if not exists public.pof_medications (
  id uuid primary key default gen_random_uuid(),
  physician_order_id uuid not null references public.physician_orders(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  source_medication_id text not null,
  medication_name text not null,
  strength text,
  dose text,
  route text,
  frequency text,
  scheduled_times text[] not null default '{}'::text[],
  given_at_center boolean not null default false,
  prn boolean not null default false,
  prn_instructions text,
  start_date date,
  end_date date,
  active boolean not null default true,
  provider text,
  instructions text,
  created_by_user_id uuid references public.profiles(id),
  created_by_name text,
  updated_by_user_id uuid references public.profiles(id),
  updated_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uniq_pof_medications_order_source unique (physician_order_id, source_medication_id)
);

create index if not exists idx_pof_medications_member_active
  on public.pof_medications (member_id, active, given_at_center);

create index if not exists idx_pof_medications_physician_order
  on public.pof_medications (physician_order_id);

create table if not exists public.mar_schedules (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  pof_medication_id uuid not null references public.pof_medications(id) on delete restrict,
  medication_name text not null,
  dose text,
  route text,
  scheduled_time timestamptz not null,
  frequency text,
  instructions text,
  prn boolean not null default false,
  active boolean not null default true,
  start_date date,
  end_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uniq_mar_schedule_expected_dose unique (member_id, pof_medication_id, scheduled_time)
);

create index if not exists idx_mar_schedules_member_scheduled
  on public.mar_schedules (member_id, scheduled_time, active);

create index if not exists idx_mar_schedules_pof_medication
  on public.mar_schedules (pof_medication_id);

create table if not exists public.mar_administrations (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  pof_medication_id uuid not null references public.pof_medications(id) on delete restrict,
  mar_schedule_id uuid references public.mar_schedules(id) on delete set null,
  administration_date date not null,
  scheduled_time timestamptz,
  medication_name text not null,
  dose text,
  route text,
  status text not null check (status in ('Given', 'Not Given')),
  not_given_reason text check (not_given_reason in ('Refused', 'Absent', 'Medication unavailable', 'Clinical hold', 'Other')),
  prn_reason text,
  notes text,
  administered_by text not null,
  administered_by_user_id uuid references public.profiles(id),
  administered_at timestamptz not null,
  source text not null check (source in ('scheduled', 'prn')),
  prn_outcome text check (prn_outcome in ('Effective', 'Ineffective')),
  prn_outcome_assessed_at timestamptz,
  prn_followup_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mar_not_given_reason_required check (
    (status = 'Not Given' and not_given_reason is not null) or (status = 'Given' and not_given_reason is null)
  ),
  constraint mar_schedule_source_alignment check (
    (source = 'scheduled' and mar_schedule_id is not null) or (source = 'prn' and mar_schedule_id is null)
  ),
  constraint mar_prn_reason_required check (
    (source = 'prn' and prn_reason is not null) or (source = 'scheduled' and prn_reason is null)
  ),
  constraint mar_prn_outcome_scope check (
    source = 'prn' or (prn_outcome is null and prn_outcome_assessed_at is null and prn_followup_note is null)
  ),
  constraint mar_prn_outcome_assessed_at_required check (
    (prn_outcome is null and prn_outcome_assessed_at is null) or (prn_outcome is not null and prn_outcome_assessed_at is not null)
  ),
  constraint mar_prn_ineffective_note_required check (
    prn_outcome is distinct from 'Ineffective' or nullif(trim(coalesce(prn_followup_note, '')), '') is not null
  )
);

create unique index if not exists uniq_mar_administrations_schedule_once
  on public.mar_administrations (mar_schedule_id)
  where mar_schedule_id is not null;

create index if not exists idx_mar_administrations_member_date
  on public.mar_administrations (member_id, administration_date desc, administered_at desc);

create index if not exists idx_mar_administrations_pof_medication
  on public.mar_administrations (pof_medication_id);

drop trigger if exists trg_pof_medications_updated on public.pof_medications;
create trigger trg_pof_medications_updated before update on public.pof_medications
for each row execute function public.set_updated_at();

drop trigger if exists trg_mar_schedules_updated on public.mar_schedules;
create trigger trg_mar_schedules_updated before update on public.mar_schedules
for each row execute function public.set_updated_at();

drop trigger if exists trg_mar_administrations_updated on public.mar_administrations;
create trigger trg_mar_administrations_updated before update on public.mar_administrations
for each row execute function public.set_updated_at();

alter table public.pof_medications enable row level security;
alter table public.mar_schedules enable row level security;
alter table public.mar_administrations enable row level security;

drop policy if exists "pof_medications_select" on public.pof_medications;
create policy "pof_medications_select" on public.pof_medications
for select using (public.current_role() in ('admin', 'manager', 'director', 'nurse'));

drop policy if exists "pof_medications_insert" on public.pof_medications;
create policy "pof_medications_insert" on public.pof_medications
for insert with check (public.current_role() in ('admin', 'manager', 'director', 'nurse'));

drop policy if exists "pof_medications_update" on public.pof_medications;
create policy "pof_medications_update" on public.pof_medications
for update using (public.current_role() in ('admin', 'manager', 'director', 'nurse'))
with check (public.current_role() in ('admin', 'manager', 'director', 'nurse'));

drop policy if exists "pof_medications_delete" on public.pof_medications;
create policy "pof_medications_delete" on public.pof_medications
for delete using (public.current_role() in ('admin', 'director'));

drop policy if exists "mar_schedules_select" on public.mar_schedules;
create policy "mar_schedules_select" on public.mar_schedules
for select using (public.current_role() in ('admin', 'manager', 'director', 'nurse'));

drop policy if exists "mar_schedules_insert" on public.mar_schedules;
create policy "mar_schedules_insert" on public.mar_schedules
for insert with check (public.current_role() in ('admin', 'manager', 'director', 'nurse'));

drop policy if exists "mar_schedules_update" on public.mar_schedules;
create policy "mar_schedules_update" on public.mar_schedules
for update using (public.current_role() in ('admin', 'manager', 'director', 'nurse'))
with check (public.current_role() in ('admin', 'manager', 'director', 'nurse'));

drop policy if exists "mar_schedules_delete" on public.mar_schedules;
create policy "mar_schedules_delete" on public.mar_schedules
for delete using (public.current_role() in ('admin', 'director'));

drop policy if exists "mar_administrations_select" on public.mar_administrations;
create policy "mar_administrations_select" on public.mar_administrations
for select using (public.current_role() in ('admin', 'manager', 'director', 'nurse'));

drop policy if exists "mar_administrations_insert" on public.mar_administrations;
create policy "mar_administrations_insert" on public.mar_administrations
for insert with check (
  public.current_role() in ('admin', 'manager', 'director') or administered_by_user_id = auth.uid()
);

drop policy if exists "mar_administrations_update" on public.mar_administrations;
create policy "mar_administrations_update" on public.mar_administrations
for update using (public.current_role() in ('admin', 'manager', 'director', 'nurse'))
with check (public.current_role() in ('admin', 'manager', 'director', 'nurse'));

insert into public.pof_medications (
  physician_order_id,
  member_id,
  source_medication_id,
  medication_name,
  strength,
  dose,
  route,
  frequency,
  scheduled_times,
  given_at_center,
  prn,
  prn_instructions,
  start_date,
  end_date,
  active,
  provider,
  instructions,
  created_by_user_id,
  created_by_name,
  updated_by_user_id,
  updated_by_name,
  created_at,
  updated_at
)
select
  po.id as physician_order_id,
  po.member_id,
  coalesce(nullif(trim(med.item->>'id'), ''), format('medication-%s', med.ordinality)) as source_medication_id,
  trim(med.item->>'name') as medication_name,
  nullif(trim(med.item->>'quantity'), '') as strength,
  nullif(trim(med.item->>'dose'), '') as dose,
  nullif(trim(med.item->>'route'), '') as route,
  nullif(trim(med.item->>'frequency'), '') as frequency,
  case
    when nullif(trim(med.item->>'givenAtCenterTime24h'), '') is not null then array[trim(med.item->>'givenAtCenterTime24h')]
    else '{}'::text[]
  end as scheduled_times,
  coalesce(nullif(trim(med.item->>'givenAtCenter'), '')::boolean, false) as given_at_center,
  coalesce(nullif(trim(med.item->>'prn'), '')::boolean, false) as prn,
  nullif(trim(med.item->>'prnInstructions'), '') as prn_instructions,
  nullif(trim(med.item->>'startDate'), '')::date as start_date,
  nullif(trim(med.item->>'endDate'), '')::date as end_date,
  coalesce(nullif(trim(med.item->>'active'), '')::boolean, true) as active,
  coalesce(nullif(trim(med.item->>'provider'), ''), po.provider_name) as provider,
  coalesce(nullif(trim(med.item->>'instructions'), ''), nullif(trim(med.item->>'comments'), '')) as instructions,
  po.created_by_user_id,
  po.created_by_name,
  po.updated_by_user_id,
  po.updated_by_name,
  coalesce(po.created_at, now()) as created_at,
  coalesce(po.updated_at, now()) as updated_at
from public.physician_orders po
cross join lateral jsonb_array_elements(coalesce(po.medications, '[]'::jsonb)) with ordinality as med(item, ordinality)
where po.status = 'signed'
  and nullif(trim(med.item->>'name'), '') is not null
on conflict (physician_order_id, source_medication_id) do update
set
  medication_name = excluded.medication_name,
  strength = excluded.strength,
  dose = excluded.dose,
  route = excluded.route,
  frequency = excluded.frequency,
  scheduled_times = excluded.scheduled_times,
  given_at_center = excluded.given_at_center,
  prn = excluded.prn,
  prn_instructions = excluded.prn_instructions,
  start_date = excluded.start_date,
  end_date = excluded.end_date,
  active = excluded.active,
  provider = excluded.provider,
  instructions = excluded.instructions,
  updated_by_user_id = excluded.updated_by_user_id,
  updated_by_name = excluded.updated_by_name,
  updated_at = excluded.updated_at;

create or replace view public.v_mar_today as
select
  ms.id as mar_schedule_id,
  ms.member_id,
  m.display_name as member_name,
  ms.pof_medication_id,
  ms.medication_name,
  ms.dose,
  ms.route,
  ms.frequency,
  ms.instructions,
  ms.prn,
  ms.scheduled_time,
  ms.active as schedule_active,
  ma.id as administration_id,
  ma.status,
  ma.not_given_reason,
  ma.prn_reason,
  ma.notes,
  ma.administered_by,
  ma.administered_by_user_id,
  ma.administered_at,
  ma.source
from public.mar_schedules ms
join public.members m on m.id = ms.member_id
left join public.mar_administrations ma on ma.mar_schedule_id = ms.id
where ms.active = true
  and timezone('America/New_York', ms.scheduled_time)::date = timezone('America/New_York', now())::date
order by ms.scheduled_time asc, m.display_name asc, ms.medication_name asc;

create or replace view public.v_mar_not_given_today as
select
  ma.id,
  ma.member_id,
  m.display_name as member_name,
  ma.pof_medication_id,
  ma.mar_schedule_id,
  ma.administration_date,
  ma.scheduled_time,
  ma.medication_name,
  ma.dose,
  ma.route,
  ma.status,
  ma.not_given_reason,
  ma.notes,
  ma.administered_by,
  ma.administered_by_user_id,
  ma.administered_at,
  ma.source
from public.mar_administrations ma
join public.members m on m.id = ma.member_id
where ma.status = 'Not Given'
  and ma.administration_date = timezone('America/New_York', now())::date
order by ma.administered_at desc, m.display_name asc;

create or replace view public.v_mar_administration_history as
select
  ma.id,
  ma.member_id,
  m.display_name as member_name,
  ma.pof_medication_id,
  ma.mar_schedule_id,
  ma.administration_date,
  ma.scheduled_time,
  ma.medication_name,
  ma.dose,
  ma.route,
  ma.status,
  ma.not_given_reason,
  ma.prn_reason,
  ma.prn_outcome,
  ma.prn_outcome_assessed_at,
  ma.prn_followup_note,
  ma.notes,
  ma.administered_by,
  ma.administered_by_user_id,
  ma.administered_at,
  ma.source,
  ma.created_at,
  ma.updated_at
from public.mar_administrations ma
join public.members m on m.id = ma.member_id
order by ma.administered_at desc, m.display_name asc, ma.medication_name asc;

create or replace view public.v_mar_prn_log as
select
  ma.id,
  ma.member_id,
  m.display_name as member_name,
  ma.pof_medication_id,
  ma.mar_schedule_id,
  ma.administration_date,
  ma.scheduled_time,
  ma.medication_name,
  ma.dose,
  ma.route,
  ma.status,
  ma.prn_reason,
  ma.prn_outcome,
  ma.prn_outcome_assessed_at,
  ma.prn_followup_note,
  ma.notes,
  ma.administered_by,
  ma.administered_by_user_id,
  ma.administered_at,
  ma.created_at,
  ma.updated_at
from public.mar_administrations ma
join public.members m on m.id = ma.member_id
where ma.source = 'prn'
order by ma.administered_at desc, m.display_name asc, ma.medication_name asc;

create or replace view public.v_mar_prn_given_awaiting_outcome as
select *
from public.v_mar_prn_log
where status = 'Given'
  and prn_outcome is null;

create or replace view public.v_mar_prn_effective as
select *
from public.v_mar_prn_log
where prn_outcome = 'Effective';

create or replace view public.v_mar_prn_ineffective as
select *
from public.v_mar_prn_log
where prn_outcome = 'Ineffective';
