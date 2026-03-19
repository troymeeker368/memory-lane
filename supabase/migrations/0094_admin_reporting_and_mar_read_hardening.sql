create index if not exists idx_daily_activity_logs_activity_date_member_id
  on public.daily_activity_logs (activity_date desc, member_id);

create index if not exists idx_toilet_logs_event_at_member_id
  on public.toilet_logs (event_at desc, member_id);

create index if not exists idx_shower_logs_event_at_member_id
  on public.shower_logs (event_at desc, member_id);

create index if not exists idx_transportation_logs_service_date_member_id
  on public.transportation_logs (service_date desc, member_id);

create or replace function public.rpc_get_member_documentation_summary(
  p_start_date date,
  p_end_date date
)
returns table (
  member_id uuid,
  member_name text,
  participation_count bigint,
  toileting_count bigint,
  shower_count bigint,
  transportation_count bigint
)
language sql
stable
set search_path = public
as $$
  with bounds as (
    select
      least(p_start_date, p_end_date) as start_date,
      greatest(p_start_date, p_end_date) as end_date,
      ((least(p_start_date, p_end_date)::text || ' 00:00:00 America/New_York')::timestamptz) as start_ts,
      ((greatest(p_start_date, p_end_date)::text || ' 23:59:59 America/New_York')::timestamptz) as end_ts
  ),
  activity as (
    select dal.member_id, 'daily_activity'::text as source
    from public.daily_activity_logs dal
    cross join bounds b
    where dal.member_id is not null
      and dal.activity_date >= b.start_date
      and dal.activity_date <= b.end_date

    union all

    select tl.member_id, 'toilet'::text as source
    from public.toilet_logs tl
    cross join bounds b
    where tl.member_id is not null
      and tl.event_at >= b.start_ts
      and tl.event_at <= b.end_ts

    union all

    select sl.member_id, 'shower'::text as source
    from public.shower_logs sl
    cross join bounds b
    where sl.member_id is not null
      and sl.event_at >= b.start_ts
      and sl.event_at <= b.end_ts

    union all

    select tr.member_id, 'transportation'::text as source
    from public.transportation_logs tr
    cross join bounds b
    where tr.member_id is not null
      and tr.service_date >= b.start_date
      and tr.service_date <= b.end_date
  ),
  member_counts as (
    select
      activity.member_id,
      count(*) filter (where activity.source = 'daily_activity') as participation_count,
      count(*) filter (where activity.source = 'toilet') as toileting_count,
      count(*) filter (where activity.source = 'shower') as shower_count,
      count(*) filter (where activity.source = 'transportation') as transportation_count
    from activity
    group by activity.member_id
  )
  select
    member_counts.member_id,
    coalesce(nullif(trim(m.display_name), ''), 'Unknown Member') as member_name,
    member_counts.participation_count,
    member_counts.toileting_count,
    member_counts.shower_count,
    member_counts.transportation_count
  from member_counts
  left join public.members m
    on m.id = member_counts.member_id
  order by coalesce(nullif(trim(m.display_name), ''), 'Unknown Member') asc;
$$;

grant execute on function public.rpc_get_member_documentation_summary(date, date) to authenticated, service_role;
