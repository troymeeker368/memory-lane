drop function if exists public.rpc_get_operational_reliability_snapshot(integer, integer, integer, integer);

create or replace function public.rpc_get_operational_reliability_snapshot(
  p_retry_age_minutes integer default 15,
  p_care_plan_age_minutes integer default 30,
  p_billing_lookback_hours integer default 72,
  p_limit integer default 25
)
returns table (
  pending_enrollment_packets bigint,
  failed_enrollment_packets bigint,
  pending_pof_requests bigint,
  failed_pof_requests bigint,
  pending_care_plan_signatures bigint,
  failed_care_plan_signatures bigint,
  recent_billing_failures bigint,
  open_system_alerts bigint,
  stuck_enrollment_packets jsonb,
  stuck_pof_requests jsonb,
  stuck_care_plan_requests jsonb,
  recent_billing_failure_rows jsonb
)
language sql
security definer
set search_path = public
as $$
  with params as (
    select
      greatest(5, coalesce(p_retry_age_minutes, 15)) as retry_age_minutes,
      greatest(5, coalesce(p_care_plan_age_minutes, 30)) as care_plan_age_minutes,
      greatest(1, coalesce(p_billing_lookback_hours, 72)) as billing_lookback_hours,
      greatest(1, least(coalesce(p_limit, 25), 100)) as row_limit
  ),
  summary as (
    select
      (select count(*)::bigint
       from public.enrollment_packet_requests
       where delivery_status in ('pending_preparation', 'ready_to_send', 'retry_pending')) as pending_enrollment_packets,
      (select count(*)::bigint
       from public.enrollment_packet_requests
       where delivery_status = 'send_failed') as failed_enrollment_packets,
      (select count(*)::bigint
       from public.pof_requests
       where delivery_status in ('pending_preparation', 'ready_to_send', 'retry_pending')
         and status in ('draft', 'sent', 'opened')) as pending_pof_requests,
      (select count(*)::bigint
       from public.pof_requests
       where delivery_status = 'send_failed') as failed_pof_requests,
      (select count(*)::bigint
       from public.care_plans
       where caregiver_signature_status in ('ready_to_send', 'sent', 'viewed')) as pending_care_plan_signatures,
      (select count(*)::bigint
       from public.care_plans
       where caregiver_signature_status = 'send_failed') as failed_care_plan_signatures,
      (select count(*)::bigint
       from public.system_events se
       cross join params p
       where se.event_type in ('billing_batch_failed', 'billing_export_failed')
         and se.created_at >= now() - make_interval(hours => p.billing_lookback_hours)) as recent_billing_failures,
      (select count(*)::bigint
       from public.system_events
       where event_type = 'system_alert'
         and status = 'open') as open_system_alerts
  ),
  stuck_enrollment_rows as (
    select
      jsonb_build_object(
        'workflowType', 'enrollment_packet',
        'entityId', epr.id,
        'memberId', nullif(btrim(coalesce(epr.member_id::text, '')), ''),
        'status', coalesce(epr.delivery_status, 'unknown'),
        'updatedAt', coalesce(epr.updated_at, epr.created_at, now()),
        'ageMinutes', greatest(
          0,
          floor(extract(epoch from (now() - coalesce(epr.updated_at, epr.created_at, now()))) / 60)
        )::integer,
        'error', nullif(btrim(coalesce(epr.delivery_error, '')), '')
      ) as row_payload
    from public.enrollment_packet_requests epr
    cross join params p
    where epr.delivery_status in ('send_failed', 'retry_pending')
      and coalesce(epr.updated_at, epr.created_at, now()) <= now() - make_interval(mins => p.retry_age_minutes)
    order by coalesce(epr.updated_at, epr.created_at, now()) asc
    limit (select row_limit from params)
  ),
  stuck_pof_rows as (
    select
      jsonb_build_object(
        'workflowType', 'pof_request',
        'entityId', pr.id,
        'memberId', nullif(btrim(coalesce(pr.member_id::text, '')), ''),
        'status', coalesce(pr.delivery_status, 'unknown'),
        'updatedAt', coalesce(pr.updated_at, pr.created_at, now()),
        'ageMinutes', greatest(
          0,
          floor(extract(epoch from (now() - coalesce(pr.updated_at, pr.created_at, now()))) / 60)
        )::integer,
        'error', nullif(btrim(coalesce(pr.delivery_error, '')), '')
      ) as row_payload
    from public.pof_requests pr
    cross join params p
    where pr.delivery_status in ('send_failed', 'retry_pending')
      and coalesce(pr.updated_at, pr.created_at, now()) <= now() - make_interval(mins => p.retry_age_minutes)
    order by coalesce(pr.updated_at, pr.created_at, now()) asc
    limit (select row_limit from params)
  ),
  stuck_care_plan_rows as (
    select
      jsonb_build_object(
        'workflowType', 'care_plan',
        'entityId', cp.id,
        'memberId', nullif(btrim(coalesce(cp.member_id::text, '')), ''),
        'status', coalesce(cp.caregiver_signature_status, 'unknown'),
        'updatedAt', coalesce(cp.updated_at, cp.created_at, now()),
        'ageMinutes', greatest(
          0,
          floor(extract(epoch from (now() - coalesce(cp.updated_at, cp.created_at, now()))) / 60)
        )::integer,
        'error', nullif(btrim(coalesce(cp.caregiver_signature_error, '')), '')
      ) as row_payload
    from public.care_plans cp
    cross join params p
    where cp.caregiver_signature_status in ('send_failed', 'ready_to_send')
      and coalesce(cp.updated_at, cp.created_at, now()) <= now() - make_interval(mins => p.care_plan_age_minutes)
    order by coalesce(cp.updated_at, cp.created_at, now()) asc
    limit (select row_limit from params)
  ),
  recent_billing_failure_rows as (
    select
      jsonb_build_object(
        'id', se.id,
        'eventType', se.event_type,
        'entityId', nullif(btrim(coalesce(se.entity_id::text, '')), ''),
        'createdAt', se.created_at,
        'severity', nullif(btrim(coalesce(se.severity, '')), ''),
        'metadata', coalesce(se.metadata, '{}'::jsonb)
      ) as row_payload
    from public.system_events se
    cross join params p
    where se.event_type in ('billing_batch_failed', 'billing_export_failed')
      and se.created_at >= now() - make_interval(hours => p.billing_lookback_hours)
    order by se.created_at desc
    limit (select row_limit from params)
  )
  select
    summary.pending_enrollment_packets,
    summary.failed_enrollment_packets,
    summary.pending_pof_requests,
    summary.failed_pof_requests,
    summary.pending_care_plan_signatures,
    summary.failed_care_plan_signatures,
    summary.recent_billing_failures,
    summary.open_system_alerts,
    coalesce((select jsonb_agg(row_payload) from stuck_enrollment_rows), '[]'::jsonb) as stuck_enrollment_packets,
    coalesce((select jsonb_agg(row_payload) from stuck_pof_rows), '[]'::jsonb) as stuck_pof_requests,
    coalesce((select jsonb_agg(row_payload) from stuck_care_plan_rows), '[]'::jsonb) as stuck_care_plan_requests,
    coalesce((select jsonb_agg(row_payload) from recent_billing_failure_rows), '[]'::jsonb) as recent_billing_failure_rows
  from summary;
$$;

grant execute on function public.rpc_get_operational_reliability_snapshot(integer, integer, integer, integer) to authenticated;
grant execute on function public.rpc_get_operational_reliability_snapshot(integer, integer, integer, integer) to service_role;
