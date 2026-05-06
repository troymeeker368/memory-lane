begin;

-- Harden hold reads: authenticated alone is too broad for operational PHI surfaces.
drop policy if exists "member_holds_read" on public.member_holds;
create policy "member_holds_read"
on public.member_holds
for select
to authenticated
using (
  (select public.current_profile_has_permission('operations', 'can_view'))
);

-- Billing adjustments feed invoicing/reporting and should share the same operations view boundary.
drop policy if exists "billing_adjustments_select" on public.billing_adjustments;
create policy "billing_adjustments_select"
on public.billing_adjustments
for select
to authenticated
using (
  (select public.current_profile_has_permission('operations', 'can_view'))
);

commit;