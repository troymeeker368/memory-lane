create index if not exists idx_enrollment_packet_requests_status_completed_created_desc
  on public.enrollment_packet_requests (status, completed_at desc, created_at desc);

create index if not exists idx_enrollment_packet_requests_status_updated_at_desc
  on public.enrollment_packet_requests (status, updated_at desc);
