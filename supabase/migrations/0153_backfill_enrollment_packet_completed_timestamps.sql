update public.enrollment_packet_requests
set
  completed_at = coalesce(completed_at, last_family_activity_at, updated_at, sent_at, created_at),
  last_family_activity_at = coalesce(last_family_activity_at, completed_at, updated_at, sent_at, created_at)
where status = 'completed'
  and (completed_at is null or last_family_activity_at is null);

update public.enrollment_packet_requests
set last_family_activity_at = coalesce(last_family_activity_at, updated_at, opened_at, sent_at, created_at)
where status in ('sent', 'in_progress')
  and last_family_activity_at is null;
