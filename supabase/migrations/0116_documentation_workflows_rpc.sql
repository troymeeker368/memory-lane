create or replace function public.rpc_get_documentation_workflows(
  p_staff_user_id uuid default null,
  p_staff_only boolean default false,
  p_limit integer default 50
)
returns table (
  id uuid,
  source_kind text,
  occurred_at timestamptz,
  member_name text,
  staff_name text,
  payload jsonb
)
language sql
stable
set search_path = public
as $$
with bounds as (
  select greatest(coalesce(p_limit, 50), 0) as row_limit
),
daily_rows as (
  select
    dal.id,
    'daily_activity'::text as source_kind,
    coalesce(dal.created_at, timezone('America/New_York', dal.activity_date::timestamp)) as occurred_at,
    nullif(trim(m.display_name), '') as member_name,
    nullif(trim(p.full_name), '') as staff_name,
    jsonb_build_object(
      'activity_date', dal.activity_date::text,
      'created_at', coalesce(dal.created_at, timezone('America/New_York', dal.activity_date::timestamp))::text,
      'activity_1_level', dal.activity_1_level,
      'activity_2_level', dal.activity_2_level,
      'activity_3_level', dal.activity_3_level,
      'activity_4_level', dal.activity_4_level,
      'activity_5_level', dal.activity_5_level,
      'missing_reason_1', dal.missing_reason_1,
      'missing_reason_2', dal.missing_reason_2,
      'missing_reason_3', dal.missing_reason_3,
      'missing_reason_4', dal.missing_reason_4,
      'missing_reason_5', dal.missing_reason_5,
      'notes', dal.notes
    ) as payload
  from public.daily_activity_logs dal
  left join public.members m on m.id = dal.member_id
  left join public.profiles p on p.id = dal.staff_user_id
  cross join bounds b
  where not p_staff_only
    or dal.staff_user_id = p_staff_user_id
  order by coalesce(dal.created_at, timezone('America/New_York', dal.activity_date::timestamp)) desc
  limit (select row_limit from bounds)
),
toilet_rows as (
  select
    tl.id,
    'toilet_log'::text as source_kind,
    coalesce(tl.event_at, timezone('America/New_York', now()::timestamp)) as occurred_at,
    nullif(trim(m.display_name), '') as member_name,
    nullif(trim(p.full_name), '') as staff_name,
    jsonb_build_object(
      'event_at', coalesce(tl.event_at, timezone('America/New_York', now()::timestamp))::text,
      'use_type', tl.use_type,
      'briefs', tl.briefs,
      'member_supplied', tl.member_supplied,
      'notes', tl.notes
    ) as payload
  from public.toilet_logs tl
  left join public.members m on m.id = tl.member_id
  left join public.profiles p on p.id = tl.staff_user_id
  cross join bounds b
  where not p_staff_only
    or tl.staff_user_id = p_staff_user_id
  order by coalesce(tl.event_at, timezone('America/New_York', now()::timestamp)) desc
  limit (select row_limit from bounds)
),
shower_rows as (
  select
    sl.id,
    'shower_log'::text as source_kind,
    coalesce(sl.event_at, timezone('America/New_York', now()::timestamp)) as occurred_at,
    nullif(trim(m.display_name), '') as member_name,
    nullif(trim(p.full_name), '') as staff_name,
    jsonb_build_object(
      'event_at', coalesce(sl.event_at, timezone('America/New_York', now()::timestamp))::text,
      'laundry', sl.laundry,
      'briefs', sl.briefs
    ) as payload
  from public.shower_logs sl
  left join public.members m on m.id = sl.member_id
  left join public.profiles p on p.id = sl.staff_user_id
  cross join bounds b
  where not p_staff_only
    or sl.staff_user_id = p_staff_user_id
  order by coalesce(sl.event_at, timezone('America/New_York', now()::timestamp)) desc
  limit (select row_limit from bounds)
),
transport_rows as (
  select
    tl.id,
    'transportation'::text as source_kind,
    coalesce(tl.created_at, timezone('America/New_York', tl.service_date::timestamp)) as occurred_at,
    nullif(trim(coalesce(m.display_name, tl.first_name)), '') as member_name,
    nullif(trim(p.full_name), '') as staff_name,
    jsonb_build_object(
      'service_date', tl.service_date::text,
      'period', tl.period,
      'transport_type', tl.transport_type
    ) as payload
  from public.transportation_logs tl
  left join public.members m on m.id = tl.member_id
  left join public.profiles p on p.id = tl.staff_user_id
  cross join bounds b
  where not p_staff_only
    or tl.staff_user_id = p_staff_user_id
  order by coalesce(tl.created_at, timezone('America/New_York', tl.service_date::timestamp)) desc
  limit (select row_limit from bounds)
),
photo_rows as (
  select
    mpu.id,
    'photo_upload'::text as source_kind,
    mpu.uploaded_at as occurred_at,
    nullif(trim(m.display_name), '') as member_name,
    nullif(trim(p.full_name), '') as staff_name,
    jsonb_build_object(
      'uploaded_at', mpu.uploaded_at::text,
      'photo_url', mpu.photo_url
    ) as payload
  from public.member_photo_uploads mpu
  left join public.members m on m.id = mpu.member_id
  left join public.profiles p on p.id = mpu.uploaded_by
  cross join bounds b
  where not p_staff_only
    or mpu.uploaded_by = p_staff_user_id
  order by mpu.uploaded_at desc
  limit (select row_limit from bounds)
),
assessment_rows as (
  select
    ia.id,
    'assessment'::text as source_kind,
    coalesce(ia.created_at, timezone('America/New_York', ia.assessment_date::timestamp)) as occurred_at,
    nullif(trim(m.display_name), '') as member_name,
    nullif(trim(p.full_name), '') as staff_name,
    jsonb_build_object(
      'assessment_date', ia.assessment_date::text,
      'total_score', ia.total_score,
      'recommended_track', ia.recommended_track,
      'admission_review_required', ia.admission_review_required,
      'transport_appropriate', ia.transport_appropriate,
      'complete', ia.complete,
      'completed_by', ia.completed_by,
      'signature_status', ia.signature_status,
      'signed_by', ia.signed_by,
      'signed_at', ia.signed_at::text,
      'draft_pof_status', ia.draft_pof_status,
      'created_at', ia.created_at::text
    ) as payload
  from public.intake_assessments ia
  left join public.members m on m.id = ia.member_id
  left join public.profiles p on p.id = ia.completed_by_user_id
  cross join bounds b
  where not p_staff_only
    or ia.completed_by_user_id = p_staff_user_id
  order by coalesce(ia.created_at, timezone('America/New_York', ia.assessment_date::timestamp)) desc
  limit (select row_limit from bounds)
),
combined as (
  select * from daily_rows
  union all
  select * from toilet_rows
  union all
  select * from shower_rows
  union all
  select * from transport_rows
  union all
  select * from photo_rows
  union all
  select * from assessment_rows
)
select *
from combined
order by occurred_at desc, source_kind asc, id asc;
$$;

grant execute on function public.rpc_get_documentation_workflows(uuid, boolean, integer) to authenticated, service_role;
