-- Read-only preflight for clinical parent/member lineage drift.
-- Safe to run in Supabase SQL editor before or after applying 0127_clinical_lineage_enforcement.sql.
-- This file must stay read-only: no INSERT/UPDATE/DELETE/ALTER statements.

-- 1) Summary counts by lineage check
select
  'intake_assessment_signatures_assessment_member' as check_name,
  count(*)::bigint as mismatch_count
from public.intake_assessment_signatures sig
join public.intake_assessments ia on ia.id = sig.assessment_id
where sig.member_id is distinct from ia.member_id

union all

select
  'intake_post_sign_follow_up_queue_assessment_member' as check_name,
  count(*)::bigint as mismatch_count
from public.intake_post_sign_follow_up_queue q
join public.intake_assessments ia on ia.id = q.assessment_id
where q.member_id is distinct from ia.member_id

union all

select
  'pof_medications_physician_order_member' as check_name,
  count(*)::bigint as mismatch_count
from public.pof_medications pm
join public.physician_orders po on po.id = pm.physician_order_id
where pm.member_id is distinct from po.member_id

union all

select
  'mar_schedules_pof_medication_member' as check_name,
  count(*)::bigint as mismatch_count
from public.mar_schedules ms
join public.pof_medications pm on pm.id = ms.pof_medication_id
where ms.member_id is distinct from pm.member_id

union all

select
  'mar_administrations_pof_medication_member' as check_name,
  count(*)::bigint as mismatch_count
from public.mar_administrations ma
join public.pof_medications pm on pm.id = ma.pof_medication_id
where ma.member_id is distinct from pm.member_id

union all

select
  'mar_administrations_schedule_member_lineage' as check_name,
  count(*)::bigint as mismatch_count
from public.mar_administrations ma
join public.mar_schedules ms on ms.id = ma.mar_schedule_id
where ma.mar_schedule_id is not null
  and (
    ma.member_id is distinct from ms.member_id
    or ma.pof_medication_id is distinct from ms.pof_medication_id
  )
order by check_name;

-- 2) Detailed mismatch rows for cleanup review
select
  'intake_assessment_signatures_assessment_member' as check_name,
  sig.id as child_id,
  sig.assessment_id as parent_id,
  sig.member_id as child_member_id,
  ia.member_id as parent_member_id,
  null::uuid as child_pof_medication_id,
  null::uuid as parent_pof_medication_id
from public.intake_assessment_signatures sig
join public.intake_assessments ia on ia.id = sig.assessment_id
where sig.member_id is distinct from ia.member_id

union all

select
  'intake_post_sign_follow_up_queue_assessment_member' as check_name,
  q.id as child_id,
  q.assessment_id as parent_id,
  q.member_id as child_member_id,
  ia.member_id as parent_member_id,
  null::uuid as child_pof_medication_id,
  null::uuid as parent_pof_medication_id
from public.intake_post_sign_follow_up_queue q
join public.intake_assessments ia on ia.id = q.assessment_id
where q.member_id is distinct from ia.member_id

union all

select
  'pof_medications_physician_order_member' as check_name,
  pm.id as child_id,
  pm.physician_order_id as parent_id,
  pm.member_id as child_member_id,
  po.member_id as parent_member_id,
  null::uuid as child_pof_medication_id,
  null::uuid as parent_pof_medication_id
from public.pof_medications pm
join public.physician_orders po on po.id = pm.physician_order_id
where pm.member_id is distinct from po.member_id

union all

select
  'mar_schedules_pof_medication_member' as check_name,
  ms.id as child_id,
  ms.pof_medication_id as parent_id,
  ms.member_id as child_member_id,
  pm.member_id as parent_member_id,
  ms.pof_medication_id as child_pof_medication_id,
  pm.id as parent_pof_medication_id
from public.mar_schedules ms
join public.pof_medications pm on pm.id = ms.pof_medication_id
where ms.member_id is distinct from pm.member_id

union all

select
  'mar_administrations_pof_medication_member' as check_name,
  ma.id as child_id,
  ma.pof_medication_id as parent_id,
  ma.member_id as child_member_id,
  pm.member_id as parent_member_id,
  ma.pof_medication_id as child_pof_medication_id,
  pm.id as parent_pof_medication_id
from public.mar_administrations ma
join public.pof_medications pm on pm.id = ma.pof_medication_id
where ma.member_id is distinct from pm.member_id

union all

select
  'mar_administrations_schedule_member_lineage' as check_name,
  ma.id as child_id,
  ma.mar_schedule_id as parent_id,
  ma.member_id as child_member_id,
  ms.member_id as parent_member_id,
  ma.pof_medication_id as child_pof_medication_id,
  ms.pof_medication_id as parent_pof_medication_id
from public.mar_administrations ma
join public.mar_schedules ms on ms.id = ma.mar_schedule_id
where ma.mar_schedule_id is not null
  and (
    ma.member_id is distinct from ms.member_id
    or ma.pof_medication_id is distinct from ms.pof_medication_id
  )
order by check_name, child_id;
