create or replace view public.v_mar_today as
with eastern_bounds as (
  select
    (date_trunc('day', timezone('America/New_York', now())) at time zone 'America/New_York') as day_start,
    ((date_trunc('day', timezone('America/New_York', now())) + interval '1 day') at time zone 'America/New_York') as day_end
)
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
cross join eastern_bounds eb
join public.members m on m.id = ms.member_id
left join public.mar_administrations ma on ma.mar_schedule_id = ms.id
where ms.active = true
  and ms.scheduled_time >= eb.day_start
  and ms.scheduled_time < eb.day_end
order by ms.scheduled_time asc, m.display_name asc, ms.medication_name asc;

create or replace view public.v_mar_overdue_today as
with eastern_bounds as (
  select
    (date_trunc('day', timezone('America/New_York', now())) at time zone 'America/New_York') as day_start,
    ((date_trunc('day', timezone('America/New_York', now())) + interval '1 day') at time zone 'America/New_York') as day_end
)
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
cross join eastern_bounds eb
join public.members m on m.id = ms.member_id
left join public.mar_administrations ma on ma.mar_schedule_id = ms.id
where ms.active = true
  and ms.scheduled_time >= eb.day_start
  and ms.scheduled_time < eb.day_end
  and ma.id is null
  and ms.scheduled_time < now()
order by ms.scheduled_time asc, m.display_name asc, ms.medication_name asc;

create index if not exists idx_mar_administrations_status_date_administered_at
  on public.mar_administrations (status, administration_date desc, administered_at desc);

create index if not exists idx_mar_administrations_administered_at_desc
  on public.mar_administrations (administered_at desc);

alter view if exists public.v_mar_today set (security_invoker = true);
alter view if exists public.v_mar_overdue_today set (security_invoker = true);
alter view if exists public.v_mar_administration_history set (security_invoker = true);
