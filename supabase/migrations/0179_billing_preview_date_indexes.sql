create index if not exists idx_billing_adjustments_adjustment_date_desc
  on public.billing_adjustments (adjustment_date desc);

create index if not exists idx_center_closures_active_nonbillable_date
  on public.center_closures (closure_date desc)
  where active = true and billable_override = false;
