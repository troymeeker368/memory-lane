create or replace function public.rpc_get_sales_dashboard_summary(
  p_recent_inquiry_start_date date,
  p_follow_up_as_of_date date
)
returns table (
  open_lead_count bigint,
  won_lead_count bigint,
  lost_lead_count bigint,
  unresolved_inquiry_lead_count bigint,
  eip_lead_count bigint,
  total_lead_count bigint,
  converted_or_enrolled_count bigint,
  recent_inquiry_activity_count bigint,
  lead_activity_count bigint,
  partner_count bigint,
  referral_source_count bigint,
  partner_activity_count bigint,
  follow_up_overdue_count bigint,
  follow_up_due_today_count bigint,
  follow_up_upcoming_count bigint,
  follow_up_missing_date_count bigint,
  stage_counts jsonb,
  recent_inquiries jsonb
)
language sql
security definer
set search_path = public
as $$
  with stage_order as (
    select *
    from (values
      (1, 'Inquiry'::text),
      (2, 'Tour'::text),
      (3, 'Enrollment in Progress'::text),
      (4, 'Nurture'::text),
      (5, 'Referrals Only'::text),
      (6, 'Closed - Won'::text),
      (7, 'Closed - Lost'::text)
    ) as stage_order(ord, stage)
  ),
  canonical_leads as (
    select
      l.id,
      l.created_at,
      l.inquiry_date,
      l.member_name,
      l.caregiver_name,
      l.caregiver_relationship,
      l.caregiver_phone,
      l.caregiver_email,
      l.member_dob,
      l.lead_source,
      l.lead_source_other,
      l.partner_id,
      l.referral_source_id,
      l.referral_name,
      l.likelihood,
      l.next_follow_up_date,
      l.next_follow_up_type,
      l.tour_date,
      l.tour_completed,
      l.discovery_date,
      l.member_start_date,
      l.notes_summary,
      l.lost_reason,
      l.closed_date,
      l.created_by_name,
      l.status,
      case
        when lower(trim(coalesce(l.stage, ''))) = 'eip' then 'Enrollment in Progress'
        when lower(trim(coalesce(l.stage, ''))) = 'closed - enrolled' then 'Closed - Won'
        when trim(coalesce(l.stage, '')) = '' then 'Inquiry'
        when trim(coalesce(l.stage, '')) in (
          'Inquiry',
          'Tour',
          'Enrollment in Progress',
          'Nurture',
          'Closed - Won',
          'Closed - Lost'
        ) then trim(coalesce(l.stage, ''))
        else 'Inquiry'
      end as canonical_stage,
      case
        when lower(trim(coalesce(l.stage, ''))) in ('closed - won', 'closed - enrolled') then 'Won'
        when lower(trim(coalesce(l.stage, ''))) = 'closed - lost' then 'Lost'
        when lower(trim(coalesce(l.stage, ''))) = 'nurture' then 'Nurture'
        when lower(trim(coalesce(l.status::text, ''))) = 'won' then 'Won'
        when lower(trim(coalesce(l.status::text, ''))) = 'lost' then 'Lost'
        when lower(trim(coalesce(l.status::text, ''))) = 'nurture' then 'Nurture'
        else 'Open'
      end as canonical_status,
      lower(trim(coalesce(l.lead_source, ''))) as normalized_lead_source,
      lower(trim(coalesce(l.status::text, ''))) as normalized_status
    from public.leads l
  ),
  resolved_leads as (
    select
      cl.*,
      case
        when cl.canonical_status = 'Lost' then 'Closed - Lost'
        when cl.canonical_status = 'Won' then 'Closed - Won'
        when cl.canonical_status = 'Nurture' and cl.canonical_stage <> 'Nurture' then 'Nurture'
        else cl.canonical_stage
      end as resolved_stage
    from canonical_leads cl
  ),
  summary_counts as (
    select
      count(*) filter (where canonical_status in ('Open', 'Nurture'))::bigint as open_lead_count,
      count(*) filter (where canonical_status = 'Won')::bigint as won_lead_count,
      count(*) filter (where canonical_status = 'Lost')::bigint as lost_lead_count,
      count(*) filter (
        where canonical_status in ('Open', 'Nurture')
          and resolved_stage = 'Inquiry'
      )::bigint as unresolved_inquiry_lead_count,
      count(*) filter (
        where canonical_status in ('Open', 'Nurture')
          and resolved_stage = 'Enrollment in Progress'
      )::bigint as eip_lead_count,
      count(*)::bigint as total_lead_count,
      count(*) filter (
        where normalized_status = 'won' or member_start_date is not null
      )::bigint as converted_or_enrolled_count,
      count(*) filter (
        where p_recent_inquiry_start_date is not null
          and inquiry_date >= p_recent_inquiry_start_date
      )::bigint as recent_inquiry_activity_count,
      count(*) filter (
        where normalized_status = 'open'
          and p_follow_up_as_of_date is not null
          and next_follow_up_date < p_follow_up_as_of_date
      )::bigint as follow_up_overdue_count,
      count(*) filter (
        where normalized_status = 'open'
          and p_follow_up_as_of_date is not null
          and next_follow_up_date = p_follow_up_as_of_date
      )::bigint as follow_up_due_today_count,
      count(*) filter (
        where normalized_status = 'open'
          and p_follow_up_as_of_date is not null
          and next_follow_up_date > p_follow_up_as_of_date
      )::bigint as follow_up_upcoming_count,
      count(*) filter (
        where normalized_status = 'open'
          and next_follow_up_date is null
      )::bigint as follow_up_missing_date_count
    from resolved_leads
  ),
  stage_totals as (
    select resolved_stage as stage, count(*)::bigint as count
    from resolved_leads
    group by resolved_stage
  ),
  referral_only as (
    select count(*)::bigint as count
    from resolved_leads
    where canonical_status in ('Open', 'Nurture')
      and normalized_lead_source like '%referral%'
  ),
  stage_count_rows as (
    select
      so.ord,
      so.stage,
      case
        when so.stage = 'Referrals Only' then ro.count
        else coalesce(st.count, 0)::bigint
      end as count
    from stage_order so
    cross join referral_only ro
    left join stage_totals st on st.stage = so.stage
  ),
  stage_count_payload as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'stage', stage_count_rows.stage,
          'count', stage_count_rows.count
        )
        order by stage_count_rows.ord
      ),
      '[]'::jsonb
    ) as stage_counts
    from stage_count_rows
  ),
  recent_inquiry_rows as (
    select
      rl.id,
      rl.resolved_stage as stage,
      rl.canonical_status as status,
      rl.created_at,
      rl.inquiry_date,
      rl.member_name,
      rl.caregiver_name,
      rl.caregiver_relationship,
      rl.caregiver_phone,
      rl.caregiver_email,
      rl.member_dob,
      rl.lead_source,
      rl.lead_source_other,
      rl.partner_id,
      rl.referral_source_id,
      rl.referral_name,
      rl.likelihood,
      rl.next_follow_up_date,
      rl.next_follow_up_type,
      rl.tour_date,
      rl.tour_completed,
      rl.discovery_date,
      rl.member_start_date,
      rl.notes_summary,
      rl.lost_reason,
      rl.closed_date,
      rl.created_by_name
    from resolved_leads rl
    where p_recent_inquiry_start_date is not null
      and rl.inquiry_date >= p_recent_inquiry_start_date
    order by rl.inquiry_date desc nulls last, rl.created_at desc
    limit 10
  ),
  recent_inquiry_payload as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', recent_inquiry_rows.id,
          'stage', recent_inquiry_rows.stage,
          'status', recent_inquiry_rows.status,
          'created_at', recent_inquiry_rows.created_at,
          'inquiry_date', recent_inquiry_rows.inquiry_date,
          'member_name', recent_inquiry_rows.member_name,
          'caregiver_name', recent_inquiry_rows.caregiver_name,
          'caregiver_relationship', recent_inquiry_rows.caregiver_relationship,
          'caregiver_phone', recent_inquiry_rows.caregiver_phone,
          'caregiver_email', recent_inquiry_rows.caregiver_email,
          'member_dob', recent_inquiry_rows.member_dob,
          'lead_source', recent_inquiry_rows.lead_source,
          'lead_source_other', recent_inquiry_rows.lead_source_other,
          'partner_id', recent_inquiry_rows.partner_id,
          'referral_source_id', recent_inquiry_rows.referral_source_id,
          'referral_name', recent_inquiry_rows.referral_name,
          'likelihood', recent_inquiry_rows.likelihood,
          'next_follow_up_date', recent_inquiry_rows.next_follow_up_date,
          'next_follow_up_type', recent_inquiry_rows.next_follow_up_type,
          'tour_date', recent_inquiry_rows.tour_date,
          'tour_completed', recent_inquiry_rows.tour_completed,
          'discovery_date', recent_inquiry_rows.discovery_date,
          'member_start_date', recent_inquiry_rows.member_start_date,
          'notes_summary', recent_inquiry_rows.notes_summary,
          'lost_reason', recent_inquiry_rows.lost_reason,
          'closed_date', recent_inquiry_rows.closed_date,
          'created_by_name', recent_inquiry_rows.created_by_name
        )
        order by recent_inquiry_rows.inquiry_date desc nulls last, recent_inquiry_rows.created_at desc
      ),
      '[]'::jsonb
    ) as recent_inquiries
    from recent_inquiry_rows
  )
  select
    summary_counts.open_lead_count,
    summary_counts.won_lead_count,
    summary_counts.lost_lead_count,
    summary_counts.unresolved_inquiry_lead_count,
    summary_counts.eip_lead_count,
    summary_counts.total_lead_count,
    summary_counts.converted_or_enrolled_count,
    summary_counts.recent_inquiry_activity_count,
    (select count(*)::bigint from public.lead_activities) as lead_activity_count,
    (select count(*)::bigint from public.community_partner_organizations) as partner_count,
    (select count(*)::bigint from public.referral_sources) as referral_source_count,
    (select count(*)::bigint from public.partner_activities) as partner_activity_count,
    summary_counts.follow_up_overdue_count,
    summary_counts.follow_up_due_today_count,
    summary_counts.follow_up_upcoming_count,
    summary_counts.follow_up_missing_date_count,
    stage_count_payload.stage_counts,
    recent_inquiry_payload.recent_inquiries
  from summary_counts
  cross join stage_count_payload
  cross join recent_inquiry_payload;
$$;

create or replace function public.rpc_get_sales_dashboard_summary(
  p_recent_inquiry_start_date date default null
)
returns table (
  open_lead_count bigint,
  won_lead_count bigint,
  lost_lead_count bigint,
  unresolved_inquiry_lead_count bigint,
  eip_lead_count bigint,
  total_lead_count bigint,
  converted_or_enrolled_count bigint,
  recent_inquiry_activity_count bigint,
  lead_activity_count bigint,
  partner_count bigint,
  referral_source_count bigint,
  partner_activity_count bigint,
  follow_up_overdue_count bigint,
  follow_up_due_today_count bigint,
  follow_up_upcoming_count bigint,
  follow_up_missing_date_count bigint,
  stage_counts jsonb,
  recent_inquiries jsonb
)
language sql
security definer
set search_path = public
as $$
  select *
  from public.rpc_get_sales_dashboard_summary(p_recent_inquiry_start_date, null::date);
$$;

grant execute on function public.rpc_get_sales_dashboard_summary(date) to authenticated, service_role;
grant execute on function public.rpc_get_sales_dashboard_summary(date, date) to authenticated, service_role;
