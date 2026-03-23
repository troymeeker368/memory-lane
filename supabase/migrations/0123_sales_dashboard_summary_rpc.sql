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
  partner_activity_count bigint
)
language sql
security definer
set search_path = public
as $$
  with pipeline_summary as (
    select *
    from public.rpc_get_sales_pipeline_summary_counts()
  ),
  pipeline_totals as (
    select
      coalesce(max(open_count), 0)::bigint as open_lead_count,
      coalesce(max(won_count), 0)::bigint as won_lead_count,
      coalesce(max(lost_count), 0)::bigint as lost_lead_count,
      coalesce(max(unresolved_inquiry_count), 0)::bigint as unresolved_inquiry_lead_count,
      coalesce(max(case when stage = 'Enrollment in Progress' then count else 0 end), 0)::bigint as eip_lead_count
    from pipeline_summary
  )
  select
    pipeline_totals.open_lead_count,
    pipeline_totals.won_lead_count,
    pipeline_totals.lost_lead_count,
    pipeline_totals.unresolved_inquiry_lead_count,
    pipeline_totals.eip_lead_count,
    (select count(*)::bigint from public.leads) as total_lead_count,
    (
      select count(*)::bigint
      from public.leads
      where status = 'won' or member_start_date is not null
    ) as converted_or_enrolled_count,
    (
      select count(*)::bigint
      from public.leads
      where p_recent_inquiry_start_date is not null
        and inquiry_date >= p_recent_inquiry_start_date
    ) as recent_inquiry_activity_count,
    (select count(*)::bigint from public.lead_activities) as lead_activity_count,
    (select count(*)::bigint from public.community_partner_organizations) as partner_count,
    (select count(*)::bigint from public.referral_sources) as referral_source_count,
    (select count(*)::bigint from public.partner_activities) as partner_activity_count
  from pipeline_totals;
$$;

grant execute on function public.rpc_get_sales_dashboard_summary(date) to authenticated, service_role;
