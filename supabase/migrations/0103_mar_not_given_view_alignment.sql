drop view if exists public.v_mar_not_given_today;

create view public.v_mar_not_given_today as
select
  mah.id,
  mah.member_id,
  mah.member_name,
  mah.pof_medication_id,
  mah.mar_schedule_id,
  mah.administration_date,
  mah.scheduled_time,
  mah.medication_name,
  mah.dose,
  mah.route,
  mah.status,
  mah.not_given_reason,
  mah.prn_reason,
  mah.prn_outcome,
  mah.prn_outcome_assessed_at,
  mah.prn_followup_note,
  mah.notes,
  mah.administered_by,
  mah.administered_by_user_id,
  mah.administered_at,
  mah.source,
  mah.created_at,
  mah.updated_at
from public.v_mar_administration_history mah
where mah.status = 'Not Given'
  and mah.administration_date = timezone('America/New_York', now())::date
order by mah.administered_at desc, mah.member_name asc, mah.medication_name asc;

alter view if exists public.v_mar_not_given_today set (security_invoker = true);
