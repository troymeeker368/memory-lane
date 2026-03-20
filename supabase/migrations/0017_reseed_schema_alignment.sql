-- Align payroll + documentation trigger expectations with active runtime/seed paths.

-- 1) Payroll canonical sync:
--    Archive duplicate linked legacy punches for review and only enforce
--    uniqueness after deterministic remediation.
alter table public.punches
  add column if not exists linked_time_punch_id uuid references public.time_punches(id);

create table if not exists public.punches_linked_time_punch_review (
  id uuid primary key default gen_random_uuid(),
  archived_punch_id uuid not null,
  linked_time_punch_id uuid not null,
  canonical_punch_id uuid not null,
  archive_reason text not null,
  archived_at timestamptz not null default now(),
  punch_snapshot jsonb not null
);

create unique index if not exists idx_punches_linked_time_punch_review_archived_punch
  on public.punches_linked_time_punch_review (archived_punch_id);

create index if not exists idx_punches_linked_time_punch_review_linked_time_punch
  on public.punches_linked_time_punch_review (linked_time_punch_id, archived_at desc);

do $$
declare
  v_duplicate_groups integer := 0;
  v_duplicate_rows integer := 0;
begin
  select
    count(*),
    coalesce(sum(duplicate_count - 1), 0)
  into
    v_duplicate_groups,
    v_duplicate_rows
  from (
    select linked_time_punch_id, count(*) as duplicate_count
    from public.punches
    where linked_time_punch_id is not null
    group by linked_time_punch_id
    having count(*) > 1
  ) duplicates;

  raise notice
    '0017 punches preflight: % duplicate linked_time_punch_id groups, % rows queued for archive review.',
    v_duplicate_groups,
    v_duplicate_rows;
end
$$;

with ranked as (
  select
    p.id,
    p.linked_time_punch_id,
    first_value(p.id) over (
      partition by p.linked_time_punch_id
      order by p.created_at desc nulls last, p.updated_at desc nulls last, p.id desc
    ) as canonical_punch_id,
    row_number() over (
      partition by p.linked_time_punch_id
      order by p.created_at desc nulls last, p.updated_at desc nulls last, p.id desc
    ) as duplicate_rank
  from public.punches p
  where p.linked_time_punch_id is not null
)
insert into public.punches_linked_time_punch_review (
  archived_punch_id,
  linked_time_punch_id,
  canonical_punch_id,
  archive_reason,
  punch_snapshot
)
select
  ranked.id,
  ranked.linked_time_punch_id,
  ranked.canonical_punch_id,
  '0017 duplicate linked_time_punch_id remediation',
  to_jsonb(p)
from ranked
join public.punches p
  on p.id = ranked.id
where ranked.duplicate_rank > 1
on conflict (archived_punch_id) do nothing;

delete from public.punches p
using public.punches_linked_time_punch_review review
where review.archived_punch_id = p.id
  and review.archive_reason = '0017 duplicate linked_time_punch_id remediation';

do $$
declare
  v_remaining_groups integer := 0;
begin
  select count(*)
  into v_remaining_groups
  from (
    select linked_time_punch_id
    from public.punches
    where linked_time_punch_id is not null
    group by linked_time_punch_id
    having count(*) > 1
  ) duplicates;

  if v_remaining_groups > 0 then
    raise exception
      '0017 abort: % linked_time_punch_id duplicate groups remain after archival cleanup.',
      v_remaining_groups;
  end if;
end
$$;

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
