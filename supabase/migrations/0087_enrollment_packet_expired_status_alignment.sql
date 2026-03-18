alter table public.enrollment_packet_requests
  drop constraint if exists enrollment_packet_requests_status_check;

alter table public.enrollment_packet_requests
  add constraint enrollment_packet_requests_status_check
  check (status in ('draft', 'prepared', 'sent', 'opened', 'partially_completed', 'expired', 'completed', 'filed'));

update public.enrollment_packet_requests
set
  status = 'expired',
  updated_at = greatest(coalesce(updated_at, token_expires_at), token_expires_at)
where status in ('draft', 'prepared', 'sent', 'opened', 'partially_completed')
  and token_expires_at < now();
