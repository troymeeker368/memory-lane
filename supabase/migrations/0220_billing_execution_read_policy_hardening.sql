begin;

-- Billing execution read surfaces should require explicit operations view permission.

drop policy if exists "billing_batches_select" on public.billing_batches;
create policy "billing_batches_select"
on public.billing_batches
for select
to authenticated
using (
  (select public.current_profile_has_permission('operations', 'can_view'))
);

drop policy if exists "billing_invoices_select" on public.billing_invoices;
create policy "billing_invoices_select"
on public.billing_invoices
for select
to authenticated
using (
  (select public.current_profile_has_permission('operations', 'can_view'))
);

drop policy if exists "billing_invoice_lines_select" on public.billing_invoice_lines;
create policy "billing_invoice_lines_select"
on public.billing_invoice_lines
for select
to authenticated
using (
  (select public.current_profile_has_permission('operations', 'can_view'))
);

drop policy if exists "billing_coverages_select" on public.billing_coverages;
create policy "billing_coverages_select"
on public.billing_coverages
for select
to authenticated
using (
  (select public.current_profile_has_permission('operations', 'can_view'))
);

drop policy if exists "billing_export_jobs_select" on public.billing_export_jobs;
create policy "billing_export_jobs_select"
on public.billing_export_jobs
for select
to authenticated
using (
  (select public.current_profile_has_permission('operations', 'can_view'))
);

commit;