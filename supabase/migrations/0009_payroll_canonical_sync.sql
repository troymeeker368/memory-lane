alter table public.punches
add column if not exists linked_time_punch_id uuid references public.time_punches(id);

create unique index if not exists uq_punches_linked_time_punch_id
on public.punches(linked_time_punch_id)
where linked_time_punch_id is not null;

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
  on conflict (linked_time_punch_id) do nothing;

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
left join public.punches p on p.linked_time_punch_id = tp.id
where p.id is null;
