create or replace function public.rpc_get_reports_home_staff_aggregates()
returns table (
  staff_productivity jsonb,
  time_summary jsonb
)
language sql
security definer
set search_path = public
as $$
  with report_window as (
    select now() - interval '180 days' as from_ts
  ),
  documentation_counts as (
    select
      de.staff_user_id,
      count(*) filter (where de.event_table = 'daily_activity_logs')::bigint as activity_logs,
      count(*) filter (where de.event_table = 'toilet_logs')::bigint as toilet_logs,
      count(*) filter (where de.event_table = 'shower_logs')::bigint as shower_logs,
      count(*) filter (where de.event_table = 'transportation_logs')::bigint as transportation_logs
    from public.documentation_events de
    cross join report_window rw
    where de.staff_user_id is not null
      and de.event_at >= rw.from_ts
    group by de.staff_user_id
  ),
  punch_counts as (
    select
      tp.staff_user_id,
      count(*)::bigint as punches,
      count(*) filter (where tp.within_fence = false)::bigint as outside_fence
    from public.time_punches tp
    cross join report_window rw
    where tp.staff_user_id is not null
      and tp.punch_at >= rw.from_ts
    group by tp.staff_user_id
  ),
  report_staff as (
    select p.id as staff_user_id, coalesce(nullif(trim(p.full_name), ''), 'Unknown Staff') as staff_name
    from public.profiles p
    where p.active = true
    union
    select dc.staff_user_id, coalesce(nullif(trim(p.full_name), ''), 'Unknown Staff') as staff_name
    from documentation_counts dc
    left join public.profiles p on p.id = dc.staff_user_id
    union
    select pc.staff_user_id, coalesce(nullif(trim(p.full_name), ''), 'Unknown Staff') as staff_name
    from punch_counts pc
    left join public.profiles p on p.id = pc.staff_user_id
  ),
  staff_productivity_rows as (
    select
      rs.staff_name,
      coalesce(dc.activity_logs, 0)::bigint as activity_logs,
      coalesce(dc.toilet_logs, 0)::bigint as toilet_logs,
      coalesce(dc.shower_logs, 0)::bigint as shower_logs,
      coalesce(dc.transportation_logs, 0)::bigint as transportation_logs
    from report_staff rs
    left join documentation_counts dc on dc.staff_user_id = rs.staff_user_id
  ),
  time_summary_rows as (
    select
      rs.staff_name,
      coalesce(pc.punches, 0)::bigint as punches,
      coalesce(pc.outside_fence, 0)::bigint as outside_fence
    from report_staff rs
    left join punch_counts pc on pc.staff_user_id = rs.staff_user_id
  )
  select
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'staff_name', spr.staff_name,
            'activity_logs', spr.activity_logs,
            'toilet_logs', spr.toilet_logs,
            'shower_logs', spr.shower_logs,
            'transportation_logs', spr.transportation_logs
          )
          order by spr.staff_name
        )
        from staff_productivity_rows spr
      ),
      '[]'::jsonb
    ) as staff_productivity,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'staff_name', tsr.staff_name,
            'punches', tsr.punches,
            'outside_fence', tsr.outside_fence
          )
          order by tsr.staff_name
        )
        from time_summary_rows tsr
      ),
      '[]'::jsonb
    ) as time_summary;
$$;

grant execute on function public.rpc_get_reports_home_staff_aggregates() to authenticated, service_role;
