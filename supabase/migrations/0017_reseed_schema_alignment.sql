-- Align payroll + documentation trigger expectations with active runtime/seed paths.

-- 1) Payroll canonical sync:
--    Ensure linked_time_punch_id conflict target is backed by an inferable UNIQUE constraint.
alter table public.punches
  add column if not exists linked_time_punch_id uuid references public.time_punches(id);

-- Keep only one canonical punch per linked legacy time punch (latest row wins).
with ranked as (
  select
    id,
    row_number() over (
      partition by linked_time_punch_id
      order by created_at desc nulls last, updated_at desc nulls last, id desc
    ) as rn
  from public.punches
  where linked_time_punch_id is not null
)
delete from public.punches p
using ranked r
where p.id = r.id
  and r.rn > 1;

drop index if exists public.uq_punches_linked_time_punch_id;

alter table public.punches
  drop constraint if exists punches_linked_time_punch_id_key;

alter table public.punches
  add constraint punches_linked_time_punch_id_key unique (linked_time_punch_id);

create or replace function public.sync_time_punch_to_canonical_punch()
returns trigger
language plpgsql
security definer
as $$
declare
  v_staff_name text;
begin
  select p.full_name into v_staff_name
  from public.profiles p
  where p.id = new.staff_user_id;

  insert into public.punches (
    employee_id,
    employee_name,
    "timestamp",
    type,
    source,
    status,
    note,
    created_by,
    created_at,
    updated_at,
    linked_time_punch_id
  )
  values (
    new.staff_user_id,
    coalesce(v_staff_name, 'Unknown Staff'),
    new.punch_at,
    new.punch_type,
    'employee',
    'active',
    new.note,
    coalesce(v_staff_name, 'System'),
    now(),
    now(),
    new.id
  )
  on conflict on constraint punches_linked_time_punch_id_key do nothing;

  return new;
end;
$$;

drop trigger if exists trg_time_punches_sync_canonical on public.time_punches;
create trigger trg_time_punches_sync_canonical
after insert on public.time_punches
for each row
execute function public.sync_time_punch_to_canonical_punch();

insert into public.punches (
  employee_id,
  employee_name,
  "timestamp",
  type,
  source,
  status,
  note,
  created_by,
  created_at,
  updated_at,
  linked_time_punch_id
)
select
  tp.staff_user_id as employee_id,
  coalesce(staff.full_name, 'Unknown Staff') as employee_name,
  tp.punch_at as "timestamp",
  tp.punch_type as type,
  'employee' as source,
  'active' as status,
  tp.note,
  coalesce(staff.full_name, 'System') as created_by,
  tp.punch_at as created_at,
  now() as updated_at,
  tp.id as linked_time_punch_id
from public.time_punches tp
left join public.profiles staff on staff.id = tp.staff_user_id
on conflict on constraint punches_linked_time_punch_id_key do nothing;

-- 2) Documentation trigger compatibility:
--    Ensure documentation-triggered tables expose created_at and make trigger tolerant across table variants.
alter table public.toilet_logs
  add column if not exists created_at timestamptz;

update public.toilet_logs
set created_at = coalesce(created_at, event_at, now())
where created_at is null;

alter table public.toilet_logs
  alter column created_at set default now(),
  alter column created_at set not null;

alter table public.shower_logs
  add column if not exists created_at timestamptz;

update public.shower_logs
set created_at = coalesce(created_at, event_at, now())
where created_at is null;

alter table public.shower_logs
  alter column created_at set default now(),
  alter column created_at set not null;

create or replace function public.log_documentation_event()
returns trigger
language plpgsql
as $$
declare
  v_payload jsonb;
  v_member_id uuid;
  v_staff_user_id uuid;
  v_event_at timestamptz;
begin
  v_payload := to_jsonb(new);

  v_member_id := nullif(v_payload->>'member_id', '')::uuid;
  v_staff_user_id := coalesce(
    nullif(v_payload->>'staff_user_id', '')::uuid,
    nullif(v_payload->>'nurse_user_id', '')::uuid,
    nullif(v_payload->>'uploaded_by', '')::uuid
  );
  v_event_at := coalesce(
    nullif(v_payload->>'created_at', '')::timestamptz,
    nullif(v_payload->>'event_at', '')::timestamptz,
    nullif(v_payload->>'checked_at', '')::timestamptz,
    nullif(v_payload->>'uploaded_at', '')::timestamptz,
    now()
  );

  insert into public.documentation_events (
    event_type,
    event_table,
    event_row_id,
    member_id,
    staff_user_id,
    event_at,
    created_at
  )
  values (
    tg_table_name,
    tg_table_name,
    new.id,
    v_member_id,
    v_staff_user_id,
    v_event_at,
    v_event_at
  );

  return new;
end;
$$;
