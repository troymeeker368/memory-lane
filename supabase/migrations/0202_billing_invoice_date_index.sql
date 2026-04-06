create index if not exists idx_billing_invoices_invoice_date_desc
  on public.billing_invoices (invoice_date desc);
