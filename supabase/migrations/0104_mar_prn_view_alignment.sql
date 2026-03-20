drop view if exists public.v_mar_prn_given_awaiting_outcome;
drop view if exists public.v_mar_prn_effective;
drop view if exists public.v_mar_prn_ineffective;
drop view if exists public.v_mar_prn_log;

create view public.v_mar_prn_log as
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
where ma.source = 'prn'
order by ma.administered_at desc, m.display_name asc, ma.medication_name asc;

create view public.v_mar_prn_given_awaiting_outcome as
select *
from public.v_mar_prn_log
where status = 'Given'
  and prn_outcome is null;

create view public.v_mar_prn_effective as
select *
from public.v_mar_prn_log
where prn_outcome = 'Effective';

create view public.v_mar_prn_ineffective as
select *
from public.v_mar_prn_log
where prn_outcome = 'Ineffective';

alter view if exists public.v_mar_prn_log set (security_invoker = true);
alter view if exists public.v_mar_prn_given_awaiting_outcome set (security_invoker = true);
alter view if exists public.v_mar_prn_effective set (security_invoker = true);
alter view if exists public.v_mar_prn_ineffective set (security_invoker = true);
