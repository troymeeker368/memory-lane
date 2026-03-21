create extension if not exists pg_trgm;

create or replace function public.rpc_get_sales_pipeline_summary_counts()
returns table (
  ord integer,
  stage text,
  count bigint,
  open_count bigint,
  won_count bigint,
  lost_count bigint,
  unresolved_inquiry_count bigint
)
language sql
stable
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
      lower(trim(coalesce(l.lead_source, ''))) as normalized_lead_source
    from public.leads l
  ),
  resolved_leads as (
    select
      case
        when canonical_status = 'Lost' then 'Closed - Lost'
        when canonical_status = 'Won' then 'Closed - Won'
        when canonical_status = 'Nurture' and canonical_stage <> 'Nurture' then 'Nurture'
        else canonical_stage
      end as resolved_stage,
      canonical_status,
      normalized_lead_source
    from canonical_leads
  ),
  summary_counts as (
    select
      count(*) filter (where canonical_status in ('Open', 'Nurture'))::bigint as open_count,
      count(*) filter (where canonical_status = 'Won')::bigint as won_count,
      count(*) filter (where canonical_status = 'Lost')::bigint as lost_count,
      count(*) filter (
        where canonical_status in ('Open', 'Nurture')
          and resolved_stage = 'Inquiry'
      )::bigint as unresolved_inquiry_count
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
  )
  select
    so.ord,
    so.stage,
    case
      when so.stage = 'Referrals Only' then ro.count
      else coalesce(st.count, 0)::bigint
    end as count,
    sc.open_count,
    sc.won_count,
    sc.lost_count,
    sc.unresolved_inquiry_count
  from stage_order so
  cross join summary_counts sc
  cross join referral_only ro
  left join stage_totals st on st.stage = so.stage
  order by so.ord;
$$;

grant execute on function public.rpc_get_sales_pipeline_summary_counts() to authenticated, service_role;

create index if not exists idx_members_display_name
  on public.members (display_name);

create index if not exists idx_members_display_name_trgm
  on public.members using gin (display_name gin_trgm_ops);

create index if not exists idx_audit_logs_entity_type_trgm
  on public.audit_logs using gin (entity_type gin_trgm_ops);

create index if not exists idx_system_events_correlation_id
  on public.system_events (correlation_id);

create index if not exists idx_community_partner_organizations_organization_name_trgm
  on public.community_partner_organizations using gin (organization_name gin_trgm_ops);

create index if not exists idx_community_partner_organizations_category_trgm
  on public.community_partner_organizations using gin (category gin_trgm_ops);

create index if not exists idx_community_partner_organizations_location_trgm
  on public.community_partner_organizations using gin (location gin_trgm_ops);

create index if not exists idx_community_partner_organizations_primary_phone_trgm
  on public.community_partner_organizations using gin (primary_phone gin_trgm_ops);

create index if not exists idx_community_partner_organizations_primary_email_trgm
  on public.community_partner_organizations using gin (primary_email gin_trgm_ops);

create index if not exists idx_referral_sources_contact_name_trgm
  on public.referral_sources using gin (contact_name gin_trgm_ops);

create index if not exists idx_referral_sources_organization_name_trgm
  on public.referral_sources using gin (organization_name gin_trgm_ops);

create index if not exists idx_referral_sources_job_title_trgm
  on public.referral_sources using gin (job_title gin_trgm_ops);

create index if not exists idx_referral_sources_primary_phone_trgm
  on public.referral_sources using gin (primary_phone gin_trgm_ops);

create index if not exists idx_referral_sources_primary_email_trgm
  on public.referral_sources using gin (primary_email gin_trgm_ops);

create index if not exists idx_referral_sources_preferred_contact_method_trgm
  on public.referral_sources using gin (preferred_contact_method gin_trgm_ops);
