create or replace view public.v_mar_overdue_today as
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
  and ma.id is null
  and ms.scheduled_time < now()
order by ms.scheduled_time asc, m.display_name asc, ms.medication_name asc;
