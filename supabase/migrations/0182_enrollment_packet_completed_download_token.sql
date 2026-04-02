alter table public.enrollment_packet_requests
  add column if not exists completed_packet_download_token_hash text,
  add column if not exists completed_packet_download_token_issued_at timestamptz;

create unique index if not exists idx_enrollment_packet_requests_completed_packet_download_token_hash
  on public.enrollment_packet_requests (completed_packet_download_token_hash)
  where completed_packet_download_token_hash is not null;
