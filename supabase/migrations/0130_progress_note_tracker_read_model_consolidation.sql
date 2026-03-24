create or replace function public.rpc_get_progress_note_tracker(
  p_status_filter text default 'All',
  p_member_id uuid default null,
  p_query_pattern text default null,
  p_page integer default 1,
  p_page_size integer default 25
)
returns table (
  total bigint,
  overdue bigint,
  due_today bigint,
  due_soon bigint,
  upcoming bigint,
  data_issues bigint,
  total_rows bigint,
  page_rows jsonb
)
language sql
stable
set search_path = public
as $$
  with latest_signed as (
    select distinct on (pn.member_id)
      pn.member_id,
      pn.id as latest_signed_note_id,
      timezone('America/New_York', pn.signed_at)::date as last_signed_progress_note_date
    from public.progress_notes pn
    where pn.status = 'signed'
      and pn.signed_at is not null
    order by pn.member_id, pn.signed_at desc, pn.updated_at desc, pn.id desc
  ),
  latest_draft as (
    select distinct on (pn.member_id)
      pn.member_id,
      pn.id as latest_draft_id
    from public.progress_notes pn
    where pn.status = 'draft'
    order by pn.member_id, pn.updated_at desc, pn.id desc
  ),
  tracker_base as (
    select
      m.id as member_id,
      m.display_name as member_name,
      nullif(trim(m.status), '') as member_status,
      m.enrollment_date,
      ls.last_signed_progress_note_date,
      ld.latest_draft_id,
      ls.latest_signed_note_id,
      coalesce(ls.last_signed_progress_note_date, m.enrollment_date) as anchor_date,
      timezone('America/New_York', now())::date as today_eastern
    from public.members m
    left join latest_signed ls on ls.member_id = m.id
    left join latest_draft ld on ld.member_id = m.id
    where (p_member_id is null or m.id = p_member_id)
      and (
        p_query_pattern is null
        or m.display_name ilike p_query_pattern
      )
  ),
  tracker as (
    select
      member_id,
      member_name,
      member_status,
      enrollment_date,
      last_signed_progress_note_date,
      case
        when anchor_date is null then null
        else anchor_date + 90
      end as next_progress_note_due_date,
      case
        when anchor_date is null then null
        else (anchor_date + 90) - today_eastern
      end as days_until_due,
      case
        when anchor_date is null then 'data_issue'
        when anchor_date + 90 < today_eastern then 'overdue'
        when anchor_date + 90 = today_eastern then 'due'
        when anchor_date + 90 <= today_eastern + 14 then 'due_soon'
        else 'upcoming'
      end as compliance_status,
      (latest_draft_id is not null) as has_draft_in_progress,
      latest_draft_id,
      latest_signed_note_id,
      case
        when anchor_date is null then 'Enrollment date missing'
        else null
      end as data_issue
    from tracker_base
  ),
  summary as (
    select
      count(*)::bigint as total,
      count(*) filter (where compliance_status = 'overdue')::bigint as overdue,
      count(*) filter (where compliance_status = 'due')::bigint as due_today,
      count(*) filter (where compliance_status = 'due_soon')::bigint as due_soon,
      count(*) filter (where compliance_status = 'upcoming')::bigint as upcoming,
      count(*) filter (where compliance_status = 'data_issue')::bigint as data_issues
    from tracker
  ),
  filtered as (
    select
      t.*,
      case t.compliance_status
        when 'data_issue' then 0
        when 'overdue' then 1
        when 'due' then 2
        when 'due_soon' then 3
        else 4
      end as status_rank
    from tracker t
    where case
      when p_status_filter = 'Overdue' then t.compliance_status = 'overdue'
      when p_status_filter = 'Due Today' then t.compliance_status = 'due'
      when p_status_filter = 'Due Soon' then t.compliance_status = 'due_soon'
      when p_status_filter = 'Completed/Upcoming' then t.compliance_status = 'upcoming'
      else true
    end
  ),
  paged as (
    select *
    from filtered
    order by status_rank asc, next_progress_note_due_date asc nulls last, member_name asc, member_id asc
    offset (greatest(coalesce(p_page, 1), 1) - 1) * greatest(coalesce(p_page_size, 25), 1)
    limit greatest(coalesce(p_page_size, 25), 1)
  ),
  total_rows as (
    select count(*)::bigint as total_rows
    from filtered
  ),
  row_payload as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'member_id', paged.member_id,
          'member_name', paged.member_name,
          'member_status', paged.member_status,
          'enrollment_date', paged.enrollment_date,
          'last_signed_progress_note_date', paged.last_signed_progress_note_date,
          'next_progress_note_due_date', paged.next_progress_note_due_date,
          'days_until_due', paged.days_until_due,
          'compliance_status', paged.compliance_status,
          'has_draft_in_progress', paged.has_draft_in_progress,
          'latest_draft_id', paged.latest_draft_id,
          'latest_signed_note_id', paged.latest_signed_note_id,
          'data_issue', paged.data_issue
        )
        order by paged.status_rank asc, paged.next_progress_note_due_date asc nulls last, paged.member_name asc, paged.member_id asc
      ),
      '[]'::jsonb
    ) as page_rows
    from paged
  )
  select
    summary.total,
    summary.overdue,
    summary.due_today,
    summary.due_soon,
    summary.upcoming,
    summary.data_issues,
    total_rows.total_rows,
    row_payload.page_rows
  from summary
  cross join total_rows
  cross join row_payload;
$$;

grant execute on function public.rpc_get_progress_note_tracker(text, uuid, text, integer, integer) to authenticated, service_role;

drop function if exists public.rpc_get_progress_note_tracker_summary(uuid, text);
drop function if exists public.rpc_get_progress_note_tracker_page(text, uuid, text, integer, integer);
