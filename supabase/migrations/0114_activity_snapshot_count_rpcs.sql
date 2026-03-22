create or replace function public.rpc_get_staff_activity_snapshot_counts(
  p_staff_user_id uuid,
  p_staff_name text,
  p_from_ts timestamptz,
  p_to_ts timestamptz,
  p_from_date date,
  p_to_date date
)
returns table (
  daily_activity bigint,
  toilet bigint,
  shower bigint,
  transportation bigint,
  blood_sugar bigint,
  photo_upload bigint,
  assessments bigint,
  time_punches bigint,
  lead_activities bigint,
  partner_activities bigint
)
language sql
stable
set search_path = public
as $$
  select
    (select count(*) from public.daily_activity_logs where staff_user_id = p_staff_user_id and created_at >= p_from_ts and created_at <= p_to_ts)::bigint as daily_activity,
    (select count(*) from public.toilet_logs where staff_user_id = p_staff_user_id and event_at >= p_from_ts and event_at <= p_to_ts)::bigint as toilet,
    (select count(*) from public.shower_logs where staff_user_id = p_staff_user_id and event_at >= p_from_ts and event_at <= p_to_ts)::bigint as shower,
    (select count(*) from public.transportation_logs where staff_user_id = p_staff_user_id and service_date >= p_from_date and service_date <= p_to_date)::bigint as transportation,
    (select count(*) from public.v_blood_sugar_logs_detailed where nurse_user_id = p_staff_user_id and checked_at >= p_from_ts and checked_at <= p_to_ts)::bigint as blood_sugar,
    (select count(*) from public.member_photo_uploads where uploaded_by = p_staff_user_id and uploaded_at >= p_from_ts and uploaded_at <= p_to_ts)::bigint as photo_upload,
    (select count(*) from public.intake_assessments where completed_by_user_id = p_staff_user_id and created_at >= p_from_ts and created_at <= p_to_ts)::bigint as assessments,
    (select count(*) from public.time_punches where staff_user_id = p_staff_user_id and punch_at >= p_from_ts and punch_at <= p_to_ts)::bigint as time_punches,
    (select count(*) from public.lead_activities where completed_by_user_id = p_staff_user_id and activity_at >= p_from_ts and activity_at <= p_to_ts)::bigint as lead_activities,
    (select count(*) from public.partner_activities where completed_by_name = p_staff_name and activity_at >= p_from_ts and activity_at <= p_to_ts)::bigint as partner_activities;
$$;

grant execute on function public.rpc_get_staff_activity_snapshot_counts(uuid, text, timestamptz, timestamptz, date, date)
  to authenticated, service_role;

create or replace function public.rpc_get_member_activity_snapshot_counts(
  p_member_id uuid,
  p_from_ts timestamptz,
  p_to_ts timestamptz,
  p_from_date date,
  p_to_date date
)
returns table (
  daily_activity bigint,
  toilet bigint,
  shower bigint,
  transportation bigint,
  blood_sugar bigint,
  photos bigint,
  ancillary bigint,
  assessments bigint,
  ancillary_total_cents bigint
)
language sql
stable
set search_path = public
as $$
  select
    (select count(*) from public.daily_activity_logs where member_id = p_member_id and created_at >= p_from_ts and created_at <= p_to_ts)::bigint as daily_activity,
    (select count(*) from public.toilet_logs where member_id = p_member_id and event_at >= p_from_ts and event_at <= p_to_ts)::bigint as toilet,
    (select count(*) from public.shower_logs where member_id = p_member_id and event_at >= p_from_ts and event_at <= p_to_ts)::bigint as shower,
    (select count(*) from public.transportation_logs where member_id = p_member_id and service_date >= p_from_date and service_date <= p_to_date)::bigint as transportation,
    (select count(*) from public.v_blood_sugar_logs_detailed where member_id = p_member_id and checked_at >= p_from_ts and checked_at <= p_to_ts)::bigint as blood_sugar,
    (select count(*) from public.member_photo_uploads where member_id = p_member_id and uploaded_at >= p_from_ts and uploaded_at <= p_to_ts)::bigint as photos,
    (select count(*) from public.v_ancillary_charge_logs_detailed where member_id = p_member_id and service_date >= p_from_date and service_date <= p_to_date)::bigint as ancillary,
    (select count(*) from public.intake_assessments where member_id = p_member_id and created_at >= p_from_ts and created_at <= p_to_ts)::bigint as assessments,
    (select coalesce(sum(amount_cents), 0) from public.v_ancillary_charge_logs_detailed where member_id = p_member_id and service_date >= p_from_date and service_date <= p_to_date)::bigint as ancillary_total_cents;
$$;

grant execute on function public.rpc_get_member_activity_snapshot_counts(uuid, timestamptz, timestamptz, date, date)
  to authenticated, service_role;
