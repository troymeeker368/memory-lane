create index if not exists idx_leads_open_enrollment_packet_lookup_inquiry_sort
  on public.leads (inquiry_date desc, member_name)
  where status = 'open'
    and stage in ('Tour', 'Enrollment in Progress', 'EIP', 'Nurture');
