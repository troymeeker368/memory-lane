create extension if not exists pg_trgm;

create index if not exists idx_leads_created_at_desc
  on public.leads (created_at desc);

create index if not exists idx_members_status_display_name
  on public.members (status, display_name);

create index if not exists idx_members_locker_number_trgm
  on public.members using gin (locker_number gin_trgm_ops);

create or replace function public.rpc_get_member_detail_counts(
  p_member_id uuid,
  p_staff_user_id uuid default null
)
returns table (
  daily_activities bigint,
  toilets bigint,
  showers bigint,
  transportation bigint,
  blood_sugar bigint,
  ancillary bigint,
  assessments bigint,
  photos bigint
)
language sql
security definer
set search_path = public
as $$
  with scoped_counts as (
    select
      (select count(*)
       from public.daily_activity_logs dal
       where dal.member_id = p_member_id
         and (p_staff_user_id is null or dal.staff_user_id = p_staff_user_id)) as daily_activities,
      (select count(*)
       from public.toilet_logs tl
       where tl.member_id = p_member_id
         and (p_staff_user_id is null or tl.staff_user_id = p_staff_user_id)) as toilets,
      (select count(*)
       from public.shower_logs sl
       where sl.member_id = p_member_id
         and (p_staff_user_id is null or sl.staff_user_id = p_staff_user_id)) as showers,
      (select count(*)
       from public.transportation_logs trl
       where trl.member_id = p_member_id
         and (p_staff_user_id is null or trl.staff_user_id = p_staff_user_id)) as transportation,
      (select count(*)
       from public.blood_sugar_logs bsl
       where bsl.member_id = p_member_id
         and (p_staff_user_id is null or bsl.nurse_user_id = p_staff_user_id)) as blood_sugar,
      (select count(*)
       from public.ancillary_charge_logs acl
       where acl.member_id = p_member_id
         and (p_staff_user_id is null or acl.staff_user_id = p_staff_user_id)) as ancillary,
      (select count(*)
       from public.intake_assessments ia
       where ia.member_id = p_member_id
         and (p_staff_user_id is null or ia.completed_by_user_id = p_staff_user_id)) as assessments,
      (select count(*)
       from public.member_photo_uploads mpu
       where mpu.member_id = p_member_id
         and (p_staff_user_id is null or mpu.uploaded_by = p_staff_user_id)) as photos
  )
  select
    scoped_counts.daily_activities,
    scoped_counts.toilets,
    scoped_counts.showers,
    scoped_counts.transportation,
    scoped_counts.blood_sugar,
    scoped_counts.ancillary,
    scoped_counts.assessments,
    scoped_counts.photos
  from scoped_counts;
$$;

grant execute on function public.rpc_get_member_detail_counts(uuid, uuid) to authenticated, service_role;

create or replace function public.rpc_get_care_plan_participation_summary(
  p_member_id uuid,
  p_window_start_date date,
  p_window_end_date date
)
returns table (
  attendance_days bigint,
  participation_days bigint
)
language sql
security definer
set search_path = public
as $$
  with attendance_count as (
    select count(*)::bigint as attendance_days
    from public.attendance_records ar
    where ar.member_id = p_member_id
      and ar.attendance_date >= p_window_start_date
      and ar.attendance_date <= p_window_end_date
  ),
  participation_count as (
    select count(distinct dal.activity_date)::bigint as participation_days
    from public.daily_activity_logs dal
    where dal.member_id = p_member_id
      and dal.activity_date >= p_window_start_date
      and dal.activity_date <= p_window_end_date
  )
  select
    attendance_count.attendance_days,
    participation_count.participation_days
  from attendance_count, participation_count;
$$;

grant execute on function public.rpc_get_care_plan_participation_summary(uuid, date, date) to authenticated, service_role;
