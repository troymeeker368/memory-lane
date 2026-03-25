create or replace function public.rpc_get_sales_summary_report(
  p_start_date date,
  p_end_date date,
  p_location text default null
)
returns table (
  available_locations jsonb,
  summary_sales_metrics_rows jsonb,
  summary_sales_metrics_totals jsonb,
  total_leads_status_rows jsonb,
  total_leads_status_totals jsonb,
  closed_lead_disposition_rows jsonb,
  closed_lead_disposition_totals jsonb
)
language sql
security definer
set search_path = public
as $$
  with canonical_leads as (
    select
      l.id,
      coalesce(l.inquiry_date, (l.created_at at time zone 'America/New_York')::date) as inquiry_or_created_date,
      l.discovery_date,
      l.tour_date,
      l.tour_completed,
      l.member_start_date,
      l.lost_reason,
      l.closed_date,
      lower(trim(coalesce(l.likelihood, ''))) as likelihood,
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
      end as canonical_status
    from public.leads l
  ),
  linked_member_locations as (
    select
      m.source_lead_id as lead_id,
      coalesce(nullif(trim(mcc.location), ''), 'Unassigned') as location
    from public.members m
    left join public.member_command_centers mcc on mcc.member_id = m.id
    where m.source_lead_id is not null
  ),
  located_leads as (
    select
      cl.*,
      coalesce(lml.location, 'Unassigned') as location
    from canonical_leads cl
    left join linked_member_locations lml on lml.lead_id = cl.id
  ),
  discharge_rows as (
    select
      coalesce(nullif(trim(mcc.location), ''), 'Unassigned') as location,
      m.discharge_date
    from public.members m
    left join public.member_command_centers mcc on mcc.member_id = m.id
    where m.source_lead_id is not null
      and m.discharge_date is not null
  ),
  available_location_rows as (
    select distinct location from located_leads
    union
    select distinct location from discharge_rows
  ),
  visible_locations as (
    select distinct location
    from (
      select location from available_location_rows where p_location is null
      union all
      select p_location as location where p_location is not null
    ) visible
    where location is not null
  ),
  summary_rows as (
    select
      vl.location,
      count(*) filter (
        where ll.discovery_date between p_start_date and p_end_date
      )::bigint as osa,
      count(*) filter (
        where ll.inquiry_or_created_date between p_start_date and p_end_date
      )::bigint as inquiries,
      count(*) filter (
        where ll.tour_date between p_start_date and p_end_date
          and ll.tour_completed is distinct from false
      )::bigint as tours,
      count(*) filter (
        where ll.member_start_date between p_start_date and p_end_date
      )::bigint as enrollments,
      (
        select count(*)::bigint
        from discharge_rows dr
        where dr.location = vl.location
          and dr.discharge_date between p_start_date and p_end_date
      ) as discharges
    from visible_locations vl
    left join located_leads ll on ll.location = vl.location
    group by vl.location
  ),
  summary_rows_enriched as (
    select
      location,
      osa,
      inquiries,
      case when inquiries = 0 then 0 else round((osa::numeric * 100) / inquiries, 2) end as osa_inquiry_rate,
      tours,
      case when inquiries = 0 then 0 else round((tours::numeric * 100) / inquiries, 2) end as inquiry_tour_rate,
      enrollments,
      case when tours = 0 then 0 else round((enrollments::numeric * 100) / tours, 2) end as tour_enrollment_rate,
      discharges,
      enrollments - discharges as net_growth
    from summary_rows
  ),
  summary_totals as (
    select
      'Totals'::text as location,
      coalesce(sum(osa), 0)::bigint as osa,
      coalesce(sum(inquiries), 0)::bigint as inquiries,
      case when coalesce(sum(inquiries), 0) = 0 then 0 else round((coalesce(sum(osa), 0)::numeric * 100) / coalesce(sum(inquiries), 0), 2) end as osa_inquiry_rate,
      coalesce(sum(tours), 0)::bigint as tours,
      case when coalesce(sum(inquiries), 0) = 0 then 0 else round((coalesce(sum(tours), 0)::numeric * 100) / coalesce(sum(inquiries), 0), 2) end as inquiry_tour_rate,
      coalesce(sum(enrollments), 0)::bigint as enrollments,
      case when coalesce(sum(tours), 0) = 0 then 0 else round((coalesce(sum(enrollments), 0)::numeric * 100) / coalesce(sum(tours), 0), 2) end as tour_enrollment_rate,
      coalesce(sum(discharges), 0)::bigint as discharges,
      coalesce(sum(net_growth), 0)::bigint as net_growth
    from summary_rows_enriched
  ),
  status_source as (
    select *
    from located_leads
    where inquiry_or_created_date <= p_end_date
      and (p_location is null or location = p_location)
  ),
  status_rows as (
    select
      vl.location,
      count(*) filter (
        where ss.location = vl.location
          and ss.canonical_status in ('Open', 'Nurture')
          and ss.canonical_stage = 'Enrollment in Progress'
      )::bigint as eip,
      count(*) filter (
        where ss.location = vl.location
          and ss.canonical_status in ('Open', 'Nurture')
          and ss.likelihood = 'hot'
      )::bigint as hot,
      count(*) filter (
        where ss.location = vl.location
          and ss.canonical_status in ('Open', 'Nurture')
          and ss.likelihood = 'warm'
      )::bigint as warm,
      count(*) filter (
        where ss.location = vl.location
          and ss.canonical_status in ('Open', 'Nurture')
          and ss.likelihood = 'cold'
      )::bigint as cold,
      count(*) filter (
        where ss.location = vl.location
          and (
            (ss.member_start_date is not null and ss.member_start_date <= p_end_date)
            or ss.canonical_status = 'Won'
          )
      )::bigint as enrolled,
      round(
        avg(
          case
            when ss.location = vl.location
              and ss.member_start_date is not null
              and ss.member_start_date <= p_end_date
            then greatest(ss.member_start_date - ss.inquiry_or_created_date, 0)
            else null
          end
        )
      )::bigint as avg_sales_cycle
    from visible_locations vl
    left join status_source ss on ss.location = vl.location
    group by vl.location
  ),
  status_totals as (
    select
      'Totals'::text as location,
      count(*) filter (
        where canonical_status in ('Open', 'Nurture')
          and canonical_stage = 'Enrollment in Progress'
      )::bigint as eip,
      count(*) filter (
        where canonical_status in ('Open', 'Nurture')
          and likelihood = 'hot'
      )::bigint as hot,
      count(*) filter (
        where canonical_status in ('Open', 'Nurture')
          and likelihood = 'warm'
      )::bigint as warm,
      count(*) filter (
        where canonical_status in ('Open', 'Nurture')
          and likelihood = 'cold'
      )::bigint as cold,
      count(*) filter (
        where (member_start_date is not null and member_start_date <= p_end_date)
          or canonical_status = 'Won'
      )::bigint as enrolled,
      round(
        avg(
          case
            when member_start_date is not null
              and member_start_date <= p_end_date
            then greatest(member_start_date - inquiry_or_created_date, 0)
            else null
          end
        )
      )::bigint as avg_sales_cycle
    from status_source
  ),
  disposition_source as (
    select
      location,
      case
        when lower(trim(coalesce(lost_reason, ''))) like '%spam%'
          or lower(trim(coalesce(lost_reason, ''))) like '%wrong number%'
          or lower(trim(coalesce(lost_reason, ''))) like '%test%'
          then 'spam'
        when lower(trim(coalesce(lost_reason, ''))) like '%deceas%'
          or lower(trim(coalesce(lost_reason, ''))) like '%passed%'
          then 'deceased'
        when lower(trim(coalesce(lost_reason, ''))) like '%price%'
          or lower(trim(coalesce(lost_reason, ''))) like '%cost%'
          or lower(trim(coalesce(lost_reason, ''))) like '%financial%'
          or lower(trim(coalesce(lost_reason, ''))) like '%afford%'
          then 'cost'
        when lower(trim(coalesce(lost_reason, ''))) like '%respond%'
          or lower(trim(coalesce(lost_reason, ''))) like '%reach%'
          or lower(trim(coalesce(lost_reason, ''))) like '%voicemail%'
          or lower(trim(coalesce(lost_reason, ''))) like '%ghost%'
          then 'did_not_respond'
        when lower(trim(coalesce(lost_reason, ''))) like '%distance%'
          or lower(trim(coalesce(lost_reason, ''))) like '%too far%'
          or lower(trim(coalesce(lost_reason, ''))) like '%service area%'
          or lower(trim(coalesce(lost_reason, ''))) like '%out of area%'
          then 'distance_to_center'
        when lower(trim(coalesce(lost_reason, ''))) like '%high acuity%'
          or lower(trim(coalesce(lost_reason, ''))) like '%acuity%'
          or lower(trim(coalesce(lost_reason, ''))) like '%not eligible%'
          or lower(trim(coalesce(lost_reason, ''))) like '%care needs%'
          or lower(trim(coalesce(lost_reason, ''))) like '%medical%'
          then 'high_acuity'
        when lower(trim(coalesce(lost_reason, ''))) like '%home care%'
          or lower(trim(coalesce(lost_reason, ''))) like '%home health%'
          then 'opted_for_home_care'
        when lower(trim(coalesce(lost_reason, ''))) like '%placed%'
          or lower(trim(coalesce(lost_reason, ''))) like '%assisted living%'
          or lower(trim(coalesce(lost_reason, ''))) like '%memory care%'
          or lower(trim(coalesce(lost_reason, ''))) like '%skilled nursing%'
          or lower(trim(coalesce(lost_reason, ''))) like '%facility%'
          or lower(trim(coalesce(lost_reason, ''))) like '%hospice%'
          then 'placed'
        when lower(trim(coalesce(lost_reason, ''))) like '%transport%'
          then 'transportation_issues'
        else 'declined_enrollment'
      end as bucket
    from located_leads
    where canonical_status = 'Lost'
      and closed_date between p_start_date and p_end_date
      and (p_location is null or location = p_location)
  ),
  disposition_rows as (
    select
      vl.location,
      count(*) filter (where ds.location = vl.location and ds.bucket = 'cost')::bigint as cost,
      count(*) filter (where ds.location = vl.location and ds.bucket = 'deceased')::bigint as deceased,
      count(*) filter (where ds.location = vl.location and ds.bucket = 'declined_enrollment')::bigint as declined_enrollment,
      count(*) filter (where ds.location = vl.location and ds.bucket = 'did_not_respond')::bigint as did_not_respond,
      count(*) filter (where ds.location = vl.location and ds.bucket = 'distance_to_center')::bigint as distance_to_center,
      count(*) filter (where ds.location = vl.location and ds.bucket = 'high_acuity')::bigint as high_acuity,
      count(*) filter (where ds.location = vl.location and ds.bucket = 'opted_for_home_care')::bigint as opted_for_home_care,
      count(*) filter (where ds.location = vl.location and ds.bucket = 'placed')::bigint as placed,
      count(*) filter (where ds.location = vl.location and ds.bucket = 'transportation_issues')::bigint as transportation_issues,
      count(*) filter (where ds.location = vl.location and ds.bucket = 'spam')::bigint as spam,
      count(*) filter (where ds.location = vl.location)::bigint as total_closed_leads
    from visible_locations vl
    left join disposition_source ds on ds.location = vl.location
    group by vl.location
  ),
  disposition_totals as (
    select
      'Totals'::text as location,
      coalesce(sum(cost), 0)::bigint as cost,
      coalesce(sum(deceased), 0)::bigint as deceased,
      coalesce(sum(declined_enrollment), 0)::bigint as declined_enrollment,
      coalesce(sum(did_not_respond), 0)::bigint as did_not_respond,
      coalesce(sum(distance_to_center), 0)::bigint as distance_to_center,
      coalesce(sum(high_acuity), 0)::bigint as high_acuity,
      coalesce(sum(opted_for_home_care), 0)::bigint as opted_for_home_care,
      coalesce(sum(placed), 0)::bigint as placed,
      coalesce(sum(transportation_issues), 0)::bigint as transportation_issues,
      coalesce(sum(spam), 0)::bigint as spam,
      coalesce(sum(total_closed_leads), 0)::bigint as total_closed_leads
    from disposition_rows
  )
  select
    coalesce(
      (
        select jsonb_agg(location order by case when location = 'Unassigned' then 1 else 0 end, location)
        from available_location_rows
      ),
      '[]'::jsonb
    ) as available_locations,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'location', location,
            'osa', osa,
            'inquiries', inquiries,
            'osa_inquiry_rate', osa_inquiry_rate,
            'tours', tours,
            'inquiry_tour_rate', inquiry_tour_rate,
            'enrollments', enrollments,
            'tour_enrollment_rate', tour_enrollment_rate,
            'discharges', discharges,
            'net_growth', net_growth
          )
          order by case when location = 'Unassigned' then 1 else 0 end, location
        )
        from summary_rows_enriched
      ),
      '[]'::jsonb
    ) as summary_sales_metrics_rows,
    (
      select jsonb_build_object(
        'location', location,
        'osa', osa,
        'inquiries', inquiries,
        'osa_inquiry_rate', osa_inquiry_rate,
        'tours', tours,
        'inquiry_tour_rate', inquiry_tour_rate,
        'enrollments', enrollments,
        'tour_enrollment_rate', tour_enrollment_rate,
        'discharges', discharges,
        'net_growth', net_growth
      )
      from summary_totals
    ) as summary_sales_metrics_totals,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'location', location,
            'eip', eip,
            'hot', hot,
            'warm', warm,
            'cold', cold,
            'enrolled', enrolled,
            'avg_sales_cycle', avg_sales_cycle
          )
          order by case when location = 'Unassigned' then 1 else 0 end, location
        )
        from status_rows
      ),
      '[]'::jsonb
    ) as total_leads_status_rows,
    (
      select jsonb_build_object(
        'location', location,
        'eip', eip,
        'hot', hot,
        'warm', warm,
        'cold', cold,
        'enrolled', enrolled,
        'avg_sales_cycle', avg_sales_cycle
      )
      from status_totals
    ) as total_leads_status_totals,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'location', location,
            'cost', cost,
            'deceased', deceased,
            'declined_enrollment', declined_enrollment,
            'did_not_respond', did_not_respond,
            'distance_to_center', distance_to_center,
            'high_acuity', high_acuity,
            'opted_for_home_care', opted_for_home_care,
            'placed', placed,
            'transportation_issues', transportation_issues,
            'spam', spam,
            'total_closed_leads', total_closed_leads
          )
          order by case when location = 'Unassigned' then 1 else 0 end, location
        )
        from disposition_rows
      ),
      '[]'::jsonb
    ) as closed_lead_disposition_rows,
    (
      select jsonb_build_object(
        'location', location,
        'cost', cost,
        'deceased', deceased,
        'declined_enrollment', declined_enrollment,
        'did_not_respond', did_not_respond,
        'distance_to_center', distance_to_center,
        'high_acuity', high_acuity,
        'opted_for_home_care', opted_for_home_care,
        'placed', placed,
        'transportation_issues', transportation_issues,
        'spam', spam,
        'total_closed_leads', total_closed_leads
      )
      from disposition_totals
    ) as closed_lead_disposition_totals;
$$;

grant execute on function public.rpc_get_sales_summary_report(date, date, text) to authenticated, service_role;
