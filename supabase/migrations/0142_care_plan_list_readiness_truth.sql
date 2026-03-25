create or replace function public.rpc_get_care_plan_list(
  p_member_id uuid default null,
  p_track text default null,
  p_query_member_ids uuid[] default null,
  p_status_filter text default 'All',
  p_page integer default 1,
  p_page_size integer default 25,
  p_today date default current_date
)
returns table (
  total_count bigint,
  due_soon_count bigint,
  due_now_count bigint,
  overdue_count bigint,
  completed_recently_count bigint,
  total_rows bigint,
  page_rows jsonb
)
language sql
stable
set search_path = public
as $$
  with bounds as (
    select
      p_today as today,
      (p_today + 14) as due_soon_end
  ),
  base as (
    select
      cp.id,
      cp.member_id,
      cp.track,
      cp.enrollment_date,
      cp.review_date,
      cp.last_completed_date,
      cp.next_due_date,
      cp.status,
      cp.completed_by,
      cp.post_sign_readiness_status,
      cp.post_sign_readiness_reason,
      m.display_name as member_name
    from public.care_plans cp
    join public.members m on m.id = cp.member_id
    cross join bounds b
    where (p_member_id is null or cp.member_id = p_member_id)
      and (nullif(trim(coalesce(p_track, '')), '') is null or cp.track = trim(p_track))
      and (
        p_query_member_ids is null
        or cardinality(p_query_member_ids) = 0
        or cp.member_id = any(p_query_member_ids)
      )
  ),
  summary as (
    select
      count(*)::bigint as total_count,
      count(*) filter (where base.next_due_date > b.today and base.next_due_date <= b.due_soon_end)::bigint as due_soon_count,
      count(*) filter (where base.next_due_date = b.today)::bigint as due_now_count,
      count(*) filter (where base.next_due_date < b.today)::bigint as overdue_count,
      count(*) filter (where base.next_due_date > b.due_soon_end)::bigint as completed_recently_count
    from base
    cross join bounds b
  ),
  filtered as (
    select *
    from base
    cross join bounds b
    where case
      when p_status_filter = 'Overdue' then base.next_due_date < b.today
      when p_status_filter = 'Due Now' then base.next_due_date = b.today
      when p_status_filter = 'Due Soon' then base.next_due_date > b.today and base.next_due_date <= b.due_soon_end
      when p_status_filter = 'Completed' then base.next_due_date > b.due_soon_end
      else true
    end
  ),
  total_rows as (
    select count(*)::bigint as total_rows
    from filtered
  ),
  paged as (
    select
      id,
      member_id,
      track,
      enrollment_date,
      review_date,
      last_completed_date,
      next_due_date,
      status,
      completed_by,
      post_sign_readiness_status,
      post_sign_readiness_reason,
      member_name
    from filtered
    order by next_due_date asc, id asc
    offset (greatest(coalesce(p_page, 1), 1) - 1) * greatest(coalesce(p_page_size, 25), 1)
    limit greatest(coalesce(p_page_size, 25), 1)
  ),
  row_payload as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', paged.id,
          'member_id', paged.member_id,
          'member_name', paged.member_name,
          'track', paged.track,
          'enrollment_date', paged.enrollment_date,
          'review_date', paged.review_date,
          'last_completed_date', paged.last_completed_date,
          'next_due_date', paged.next_due_date,
          'status', paged.status,
          'completed_by', paged.completed_by,
          'post_sign_readiness_status', paged.post_sign_readiness_status,
          'post_sign_readiness_reason', paged.post_sign_readiness_reason
        )
        order by paged.next_due_date asc, paged.id asc
      ),
      '[]'::jsonb
    ) as page_rows
    from paged
  )
  select
    summary.total_count,
    summary.due_soon_count,
    summary.due_now_count,
    summary.overdue_count,
    summary.completed_recently_count,
    total_rows.total_rows,
    row_payload.page_rows
  from summary
  cross join total_rows
  cross join row_payload;
$$;

grant execute on function public.rpc_get_care_plan_list(uuid, text, uuid[], text, integer, integer, date) to authenticated, service_role;
