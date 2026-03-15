create index if not exists idx_enrollment_packet_requests_delivery_status_updated_at
  on public.enrollment_packet_requests(delivery_status, updated_at desc);

create index if not exists idx_pof_requests_delivery_status_updated_at
  on public.pof_requests(delivery_status, updated_at desc);

create index if not exists idx_pof_requests_delivery_status_status_updated_at
  on public.pof_requests(delivery_status, status, updated_at desc);

create index if not exists idx_care_plans_caregiver_status_updated_at
  on public.care_plans(caregiver_signature_status, updated_at desc);

create index if not exists idx_system_events_event_type_status_created_at
  on public.system_events(event_type, status, created_at desc);

create index if not exists idx_system_events_event_type_created_at_desc
  on public.system_events(event_type, created_at desc);
