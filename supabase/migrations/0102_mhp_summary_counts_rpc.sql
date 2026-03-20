create or replace function public.rpc_get_member_health_profile_summary_counts(
  p_status text default null,
  p_query text default null
)
returns table (
  active_count bigint,
  with_alerts_count bigint
)
language sql
stable
set search_path = public
as $$
  with filtered_members as (
    select m.id, m.status
    from public.members m
    where (
      nullif(trim(coalesce(p_status, '')), '') is null
      or m.status = trim(p_status)
    )
      and (
        nullif(trim(coalesce(p_query, '')), '') is null
        or m.display_name ilike ('%' || trim(p_query) || '%')
      )
  ),
  latest_assessments as (
    select distinct on (ia.member_id)
      ia.member_id,
      coalesce(ia.admission_review_required, false) as admission_review_required
    from public.intake_assessments ia
    join filtered_members fm on fm.id = ia.member_id
    order by ia.member_id, ia.assessment_date desc nulls last, ia.created_at desc nulls last, ia.id desc
  ),
  profile_alerts as (
    select
      mhp.member_id,
      nullif(btrim(coalesce(mhp.important_alerts, '')), '') as important_alerts
    from public.member_health_profiles mhp
    join filtered_members fm on fm.id = mhp.member_id
  )
  select
    count(*) filter (where fm.status = 'active')::bigint as active_count,
    count(*) filter (
      where coalesce(la.admission_review_required, false)
        or pa.important_alerts is not null
    )::bigint as with_alerts_count
  from filtered_members fm
  left join latest_assessments la on la.member_id = fm.id
  left join profile_alerts pa on pa.member_id = fm.id;
$$;

grant execute on function public.rpc_get_member_health_profile_summary_counts(text, text) to authenticated, service_role;
