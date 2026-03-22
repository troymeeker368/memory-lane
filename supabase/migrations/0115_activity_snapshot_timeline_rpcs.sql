create or replace function public.rpc_get_staff_activity_snapshot_rows(
  p_staff_user_id uuid,
  p_staff_name text,
  p_from_ts timestamptz,
  p_to_ts timestamptz,
  p_from_date date,
  p_to_date date,
  p_source_limit integer default 200
)
returns table (
  id uuid,
  activity_type text,
  occurred_at timestamptz,
  member_id uuid,
  member_name text,
  staff_user_id uuid,
  staff_name text,
  details_summary text,
  source_href text,
  source_table text,
  source_kind text
)
language sql
stable
set search_path = public
as $$
with bounds as (
  select
    least(p_from_ts, p_to_ts) as from_ts,
    greatest(p_from_ts, p_to_ts) as to_ts,
    least(p_from_date, p_to_date) as from_date,
    greatest(p_from_date, p_to_date) as to_date,
    greatest(coalesce(p_source_limit, 200), 0) as source_limit,
    nullif(trim(p_staff_name), '') as normalized_staff_name
),
daily_rows as (
  select *
  from (
    select
      dal.id,
      'Participation Log'::text as activity_type,
      coalesce(dal.created_at, timezone('America/New_York', dal.activity_date::timestamp)) as occurred_at,
      dal.member_id as member_id,
      nullif(trim(m.display_name), '') as member_name,
      dal.staff_user_id as staff_user_id,
      nullif(trim(p.full_name), '') as staff_name,
      'Participation log submitted'::text as details_summary,
      '/documentation/activity'::text as source_href,
      'daily_activity_logs'::text as source_table,
      'daily_activity'::text as source_kind
    from public.daily_activity_logs dal
    left join public.members m on m.id = dal.member_id
    left join public.profiles p on p.id = dal.staff_user_id
    cross join bounds b
    where dal.staff_user_id = p_staff_user_id
      and dal.created_at >= b.from_ts
      and dal.created_at <= b.to_ts
    order by dal.created_at desc
    limit (select source_limit from bounds)
  ) daily_rows
),
toilet_rows as (
  select *
  from (
    select
      tl.id,
      'Toilet Log'::text as activity_type,
      coalesce(tl.event_at, timezone('America/New_York', now()::timestamp)) as occurred_at,
      tl.member_id as member_id,
      nullif(trim(m.display_name), '') as member_name,
      tl.staff_user_id as staff_user_id,
      nullif(trim(p.full_name), '') as staff_name,
      coalesce(tl.use_type, 'Toilet') || case when tl.briefs then ' | Briefs changed' else '' end as details_summary,
      '/documentation/toilet'::text as source_href,
      'toilet_logs'::text as source_table,
      'toilet_log'::text as source_kind
    from public.toilet_logs tl
    left join public.members m on m.id = tl.member_id
    left join public.profiles p on p.id = tl.staff_user_id
    cross join bounds b
    where tl.staff_user_id = p_staff_user_id
      and tl.event_at >= b.from_ts
      and tl.event_at <= b.to_ts
    order by tl.event_at desc
    limit (select source_limit from bounds)
  ) toilet_rows
),
shower_rows as (
  select *
  from (
    select
      sl.id,
      'Shower Log'::text as activity_type,
      coalesce(sl.event_at, timezone('America/New_York', now()::timestamp)) as occurred_at,
      sl.member_id as member_id,
      nullif(trim(m.display_name), '') as member_name,
      sl.staff_user_id as staff_user_id,
      nullif(trim(p.full_name), '') as staff_name,
      case when sl.laundry then 'Laundry included' else 'Shower only' end as details_summary,
      '/documentation/shower'::text as source_href,
      'shower_logs'::text as source_table,
      'shower_log'::text as source_kind
    from public.shower_logs sl
    left join public.members m on m.id = sl.member_id
    left join public.profiles p on p.id = sl.staff_user_id
    cross join bounds b
    where sl.staff_user_id = p_staff_user_id
      and sl.event_at >= b.from_ts
      and sl.event_at <= b.to_ts
    order by sl.event_at desc
    limit (select source_limit from bounds)
  ) shower_rows
),
transport_rows as (
  select *
  from (
    select
      tl.id,
      'Transportation'::text as activity_type,
      coalesce(tl.created_at, timezone('America/New_York', tl.service_date::timestamp)) as occurred_at,
      tl.member_id as member_id,
      nullif(trim(coalesce(m.display_name, tl.first_name)), '') as member_name,
      tl.staff_user_id as staff_user_id,
      nullif(trim(p.full_name), '') as staff_name,
      trim(coalesce(tl.period, '') || ' ' || coalesce(tl.transport_type, 'Transportation')) as details_summary,
      '/documentation/transportation'::text as source_href,
      'transportation_logs'::text as source_table,
      'transportation'::text as source_kind
    from public.transportation_logs tl
    left join public.members m on m.id = tl.member_id
    left join public.profiles p on p.id = tl.staff_user_id
    cross join bounds b
    where tl.staff_user_id = p_staff_user_id
      and tl.service_date >= b.from_date
      and tl.service_date <= b.to_date
    order by tl.service_date desc
    limit (select source_limit from bounds)
  ) transport_rows
),
blood_rows as (
  select *
  from (
    select
      bsl.id,
      'Blood Sugar'::text as activity_type,
      bsl.checked_at as occurred_at,
      bsl.member_id as member_id,
      nullif(trim(m.display_name), '') as member_name,
      bsl.nurse_user_id as staff_user_id,
      nullif(trim(p.full_name), '') as staff_name,
      coalesce(bsl.reading_mg_dl::text, '0') || ' mg/dL' as details_summary,
      '/documentation/blood-sugar'::text as source_href,
      'blood_sugar_logs'::text as source_table,
      'blood_sugar'::text as source_kind
    from public.blood_sugar_logs bsl
    left join public.members m on m.id = bsl.member_id
    left join public.profiles p on p.id = bsl.nurse_user_id
    cross join bounds b
    where bsl.nurse_user_id = p_staff_user_id
      and bsl.checked_at >= b.from_ts
      and bsl.checked_at <= b.to_ts
    order by bsl.checked_at desc
    limit (select source_limit from bounds)
  ) blood_rows
),
photo_rows as (
  select *
  from (
    select
      mpu.id,
      'Photo Upload'::text as activity_type,
      mpu.uploaded_at as occurred_at,
      mpu.member_id as member_id,
      nullif(trim(m.display_name), '') as member_name,
      mpu.uploaded_by as staff_user_id,
      nullif(trim(p.full_name), '') as staff_name,
      'Member photo uploaded'::text as details_summary,
      '/documentation/photo-upload'::text as source_href,
      'member_photo_uploads'::text as source_table,
      'photo_upload'::text as source_kind
    from public.member_photo_uploads mpu
    left join public.members m on m.id = mpu.member_id
    left join public.profiles p on p.id = mpu.uploaded_by
    cross join bounds b
    where mpu.uploaded_by = p_staff_user_id
      and mpu.uploaded_at >= b.from_ts
      and mpu.uploaded_at <= b.to_ts
    order by mpu.uploaded_at desc
    limit (select source_limit from bounds)
  ) photo_rows
),
punch_rows as (
  select *
  from (
    select
      tp.id,
      'Time Punch'::text as activity_type,
      tp.punch_at as occurred_at,
      null::uuid as member_id,
      case
        when tp.within_fence is null then 'Unknown'
        when tp.within_fence then 'Yes'
        else 'No'
      end as member_name,
      tp.staff_user_id as staff_user_id,
      nullif(trim(p.full_name), '') as staff_name,
      coalesce(upper(tp.punch_type::text), '') as details_summary,
      '/time-card'::text as source_href,
      'time_punches'::text as source_table,
      'time_punch'::text as source_kind
    from public.time_punches tp
    left join public.profiles p on p.id = tp.staff_user_id
    cross join bounds b
    where tp.staff_user_id = p_staff_user_id
      and tp.punch_at >= b.from_ts
      and tp.punch_at <= b.to_ts
    order by tp.punch_at desc
    limit (select source_limit from bounds)
  ) punch_rows
),
lead_rows as (
  select *
  from (
    select
      la.id,
      'Lead Activity'::text as activity_type,
      la.activity_at as occurred_at,
      null::uuid as member_id,
      nullif(trim(coalesce(la.member_name, 'Unknown Prospect')), '') as member_name,
      la.completed_by_user_id as staff_user_id,
      nullif(trim(la.completed_by_name), '') as staff_name,
      coalesce(la.activity_type, 'Activity') || coalesce(' | ' || nullif(trim(la.outcome), ''), '') as details_summary,
      case
        when la.lead_id is null then '/sales'
        else '/sales/leads/' || la.lead_id::text
      end as source_href,
      'lead_activities'::text as source_table,
      'lead_activity'::text as source_kind
    from public.lead_activities la
    cross join bounds b
    where la.completed_by_user_id = p_staff_user_id
      and la.activity_at >= b.from_ts
      and la.activity_at <= b.to_ts
    order by la.activity_at desc
    limit (select source_limit from bounds)
  ) lead_rows
),
partner_rows as (
  select *
  from (
    select
      pa.id,
      'Partner Activity'::text as activity_type,
      pa.activity_at as occurred_at,
      null::uuid as member_id,
      nullif(trim(coalesce(pa.organization_name, 'Community Partner')), '') as member_name,
      null::uuid as staff_user_id,
      nullif(trim(pa.completed_by_name), '') as staff_name,
      coalesce(pa.activity_type, 'Partner activity') as details_summary,
      '/sales/new-entries/log-partner-activities'::text as source_href,
      'partner_activities'::text as source_table,
      'partner_activity'::text as source_kind
    from public.partner_activities pa
    cross join bounds b
    where pa.completed_by_name = b.normalized_staff_name
      and pa.activity_at >= b.from_ts
      and pa.activity_at <= b.to_ts
    order by pa.activity_at desc
    limit (select source_limit from bounds)
  ) partner_rows
),
assessment_rows as (
  select *
  from (
    select
      ia.id,
      'Assessment'::text as activity_type,
      coalesce(ia.created_at, timezone('America/New_York', ia.assessment_date::timestamp)) as occurred_at,
      ia.member_id as member_id,
      nullif(trim(m.display_name), '') as member_name,
      ia.completed_by_user_id as staff_user_id,
      nullif(trim(p.full_name), '') as staff_name,
      'Intake assessment completed'::text as details_summary,
      '/health/assessment/' || ia.id::text as source_href,
      'intake_assessments'::text as source_table,
      'intake_assessment'::text as source_kind
    from public.intake_assessments ia
    left join public.members m on m.id = ia.member_id
    left join public.profiles p on p.id = ia.completed_by_user_id
    cross join bounds b
    where ia.completed_by_user_id = p_staff_user_id
      and ia.created_at >= b.from_ts
      and ia.created_at <= b.to_ts
    order by ia.created_at desc
    limit (select source_limit from bounds)
  ) assessment_rows
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
  select * from blood_rows
  union all
  select * from photo_rows
  union all
  select * from punch_rows
  union all
  select * from lead_rows
  union all
  select * from partner_rows
  union all
  select * from assessment_rows
)
select *
from combined
order by occurred_at desc, source_kind asc, activity_type asc, id asc;
$$;

grant execute on function public.rpc_get_staff_activity_snapshot_rows(
  uuid,
  text,
  timestamptz,
  timestamptz,
  date,
  date,
  integer
) to authenticated, service_role;

create or replace function public.rpc_get_member_activity_snapshot_rows(
  p_member_id uuid,
  p_from_ts timestamptz,
  p_to_ts timestamptz,
  p_from_date date,
  p_to_date date,
  p_source_limit integer default 200
)
returns table (
  id uuid,
  activity_type text,
  occurred_at timestamptz,
  member_id uuid,
  member_name text,
  staff_user_id uuid,
  staff_name text,
  details_summary text,
  source_href text,
  source_table text,
  source_kind text
)
language sql
stable
set search_path = public
as $$
with bounds as (
  select
    least(p_from_ts, p_to_ts) as from_ts,
    greatest(p_from_ts, p_to_ts) as to_ts,
    least(p_from_date, p_to_date) as from_date,
    greatest(p_from_date, p_to_date) as to_date,
    greatest(coalesce(p_source_limit, 200), 0) as source_limit
),
daily_rows as (
  select *
  from (
    select
      dal.id,
      'Participation Log'::text as activity_type,
      coalesce(dal.created_at, timezone('America/New_York', dal.activity_date::timestamp)) as occurred_at,
      dal.member_id as member_id,
      nullif(trim(m.display_name), '') as member_name,
      dal.staff_user_id as staff_user_id,
      nullif(trim(p.full_name), '') as staff_name,
      coalesce(nullif(trim(p.full_name), ''), 'Staff') || ' | Participation log' as details_summary,
      '/documentation/activity'::text as source_href,
      'daily_activity_logs'::text as source_table,
      'daily_activity'::text as source_kind
    from public.daily_activity_logs dal
    left join public.members m on m.id = dal.member_id
    left join public.profiles p on p.id = dal.staff_user_id
    cross join bounds b
    where dal.member_id = p_member_id
      and dal.created_at >= b.from_ts
      and dal.created_at <= b.to_ts
    order by dal.created_at desc
    limit (select source_limit from bounds)
  ) daily_rows
),
toilet_rows as (
  select *
  from (
    select
      tl.id,
      'Toilet Log'::text as activity_type,
      coalesce(tl.event_at, timezone('America/New_York', now()::timestamp)) as occurred_at,
      tl.member_id as member_id,
      nullif(trim(m.display_name), '') as member_name,
      tl.staff_user_id as staff_user_id,
      nullif(trim(p.full_name), '') as staff_name,
      coalesce(nullif(trim(p.full_name), 'Staff'), 'Staff') || ' | ' || coalesce(tl.use_type, 'Toilet') as details_summary,
      '/documentation/toilet'::text as source_href,
      'toilet_logs'::text as source_table,
      'toilet_log'::text as source_kind
    from public.toilet_logs tl
    left join public.members m on m.id = tl.member_id
    left join public.profiles p on p.id = tl.staff_user_id
    cross join bounds b
    where tl.member_id = p_member_id
      and tl.event_at >= b.from_ts
      and tl.event_at <= b.to_ts
    order by tl.event_at desc
    limit (select source_limit from bounds)
  ) toilet_rows
),
shower_rows as (
  select *
  from (
    select
      sl.id,
      'Shower Log'::text as activity_type,
      coalesce(sl.event_at, timezone('America/New_York', now()::timestamp)) as occurred_at,
      sl.member_id as member_id,
      nullif(trim(m.display_name), '') as member_name,
      sl.staff_user_id as staff_user_id,
      nullif(trim(p.full_name), '') as staff_name,
      coalesce(nullif(trim(p.full_name), 'Staff'), 'Staff') || case when sl.laundry then ' | Laundry' else '' end as details_summary,
      '/documentation/shower'::text as source_href,
      'shower_logs'::text as source_table,
      'shower_log'::text as source_kind
    from public.shower_logs sl
    left join public.members m on m.id = sl.member_id
    left join public.profiles p on p.id = sl.staff_user_id
    cross join bounds b
    where sl.member_id = p_member_id
      and sl.event_at >= b.from_ts
      and sl.event_at <= b.to_ts
    order by sl.event_at desc
    limit (select source_limit from bounds)
  ) shower_rows
),
transport_rows as (
  select *
  from (
    select
      tl.id,
      'Transportation'::text as activity_type,
      coalesce(tl.created_at, timezone('America/New_York', tl.service_date::timestamp)) as occurred_at,
      tl.member_id as member_id,
      nullif(trim(m.display_name), '') as member_name,
      tl.staff_user_id as staff_user_id,
      nullif(trim(p.full_name), '') as staff_name,
      coalesce(nullif(trim(p.full_name), 'Staff'), 'Staff') || ' | ' || coalesce(tl.transport_type, 'Transportation') as details_summary,
      '/documentation/transportation'::text as source_href,
      'transportation_logs'::text as source_table,
      'transportation'::text as source_kind
    from public.transportation_logs tl
    left join public.members m on m.id = tl.member_id
    left join public.profiles p on p.id = tl.staff_user_id
    cross join bounds b
    where tl.member_id = p_member_id
      and tl.service_date >= b.from_date
      and tl.service_date <= b.to_date
    order by tl.service_date desc
    limit (select source_limit from bounds)
  ) transport_rows
),
blood_rows as (
  select *
  from (
    select
      bsl.id,
      'Blood Sugar'::text as activity_type,
      bsl.checked_at as occurred_at,
      bsl.member_id as member_id,
      nullif(trim(m.display_name), '') as member_name,
      bsl.nurse_user_id as staff_user_id,
      nullif(trim(p.full_name), '') as staff_name,
      coalesce(bsl.reading_mg_dl::text, '0') || ' mg/dL | ' || coalesce(nullif(trim(p.full_name), ''), 'Nurse') as details_summary,
      '/documentation/blood-sugar'::text as source_href,
      'blood_sugar_logs'::text as source_table,
      'blood_sugar'::text as source_kind
    from public.blood_sugar_logs bsl
    left join public.members m on m.id = bsl.member_id
    left join public.profiles p on p.id = bsl.nurse_user_id
    cross join bounds b
    where bsl.member_id = p_member_id
      and bsl.checked_at >= b.from_ts
      and bsl.checked_at <= b.to_ts
    order by bsl.checked_at desc
    limit (select source_limit from bounds)
  ) blood_rows
),
photo_rows as (
  select *
  from (
    select
      mpu.id,
      'Photo Upload'::text as activity_type,
      mpu.uploaded_at as occurred_at,
      mpu.member_id as member_id,
      nullif(trim(m.display_name), '') as member_name,
      mpu.uploaded_by as staff_user_id,
      nullif(trim(p.full_name), '') as staff_name,
      coalesce(nullif(trim(p.full_name), ''), 'Staff') || ' | Photo upload' as details_summary,
      '/documentation/photo-upload'::text as source_href,
      'member_photo_uploads'::text as source_table,
      'photo_upload'::text as source_kind
    from public.member_photo_uploads mpu
    left join public.members m on m.id = mpu.member_id
    left join public.profiles p on p.id = mpu.uploaded_by
    cross join bounds b
    where mpu.member_id = p_member_id
      and mpu.uploaded_at >= b.from_ts
      and mpu.uploaded_at <= b.to_ts
    order by mpu.uploaded_at desc
    limit (select source_limit from bounds)
  ) photo_rows
),
ancillary_rows as (
  select *
  from (
    select
      acl.id,
      'Ancillary Charge'::text as activity_type,
      coalesce(acl.created_at, timezone('America/New_York', acl.service_date::timestamp)) as occurred_at,
      acl.member_id as member_id,
      nullif(trim(m.display_name), '') as member_name,
      acl.staff_user_id as staff_user_id,
      nullif(trim(p.full_name), '') as staff_name,
      coalesce(c.name, 'Ancillary') || ' | $' || to_char((coalesce(c.price_cents, 0)::numeric / 100), 'FM999999990.00') as details_summary,
      '/reports/monthly-ancillary'::text as source_href,
      'ancillary_charge_logs'::text as source_table,
      'ancillary_charge'::text as source_kind
    from public.ancillary_charge_logs acl
    left join public.ancillary_charge_categories c on c.id = acl.category_id
    left join public.members m on m.id = acl.member_id
    left join public.profiles p on p.id = acl.staff_user_id
    cross join bounds b
    where acl.member_id = p_member_id
      and acl.service_date >= b.from_date
      and acl.service_date <= b.to_date
    order by acl.service_date desc
    limit (select source_limit from bounds)
  ) ancillary_rows
),
assessment_rows as (
  select *
  from (
    select
      ia.id,
      'Assessment'::text as activity_type,
      coalesce(ia.created_at, timezone('America/New_York', ia.assessment_date::timestamp)) as occurred_at,
      ia.member_id as member_id,
      nullif(trim(m.display_name), '') as member_name,
      ia.completed_by_user_id as staff_user_id,
      nullif(trim(p.full_name), '') as staff_name,
      'Intake assessment completed'::text as details_summary,
      '/health/assessment/' || ia.id::text as source_href,
      'intake_assessments'::text as source_table,
      'intake_assessment'::text as source_kind
    from public.intake_assessments ia
    left join public.members m on m.id = ia.member_id
    left join public.profiles p on p.id = ia.completed_by_user_id
    cross join bounds b
    where ia.member_id = p_member_id
      and ia.created_at >= b.from_ts
      and ia.created_at <= b.to_ts
    order by ia.created_at desc
    limit (select source_limit from bounds)
  ) assessment_rows
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
  select * from blood_rows
  union all
  select * from photo_rows
  union all
  select * from ancillary_rows
  union all
  select * from assessment_rows
)
select *
from combined
order by occurred_at desc, source_kind asc, activity_type asc, id asc;
$$;

grant execute on function public.rpc_get_member_activity_snapshot_rows(
  uuid,
  timestamptz,
  timestamptz,
  date,
  date,
  integer
) to authenticated, service_role;

create index if not exists idx_blood_sugar_logs_nurse_user_id_checked_at_desc
  on public.blood_sugar_logs (nurse_user_id, checked_at desc);

create index if not exists idx_blood_sugar_logs_member_id_checked_at_desc
  on public.blood_sugar_logs (member_id, checked_at desc);

create index if not exists idx_member_photo_uploads_uploaded_by_uploaded_at_desc
  on public.member_photo_uploads (uploaded_by, uploaded_at desc);

create index if not exists idx_member_photo_uploads_member_id_uploaded_at_desc
  on public.member_photo_uploads (member_id, uploaded_at desc);

create index if not exists idx_daily_activity_logs_member_id_created_at_desc
  on public.daily_activity_logs (member_id, created_at desc);

create index if not exists idx_intake_assessments_member_id_created_at_desc
  on public.intake_assessments (member_id, created_at desc);

create index if not exists idx_transportation_logs_member_id_service_date_desc
  on public.transportation_logs (member_id, service_date desc);

create index if not exists idx_partner_activities_completed_by_name_activity_at_desc
  on public.partner_activities (completed_by_name, activity_at desc);

