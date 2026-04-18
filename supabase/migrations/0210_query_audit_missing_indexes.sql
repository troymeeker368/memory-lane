create index if not exists idx_lead_activities_activity_at_desc
  on public.lead_activities(activity_at desc);

create index if not exists idx_member_files_member_id_file_name
  on public.member_files(member_id, file_name);

create index if not exists idx_billing_invoices_status_month_created_desc
  on public.billing_invoices(invoice_status, invoice_month desc, created_at desc);

create index if not exists idx_billing_invoices_source_status_month_created_desc
  on public.billing_invoices(invoice_source, invoice_status, invoice_month desc, created_at desc);
