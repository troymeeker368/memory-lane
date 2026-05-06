begin;

-- Attendance / schedule operational reads should require explicit operations view permission.
drop policy if exists "attendance_records_select" on public.attendance_records;
create policy "attendance_records_select"
on public.attendance_records
for select
to authenticated
using (
  (select public.current_profile_has_permission('operations', 'can_view'))
);

-- Transportation manifest adjustments are operational workflow data.
drop policy if exists "transportation_manifest_adjustments_select" on public.transportation_manifest_adjustments;
create policy "transportation_manifest_adjustments_select"
on public.transportation_manifest_adjustments
for select
to authenticated
using (
  (select public.current_profile_has_permission('operations', 'can_view'))
);

-- Center closure calendar and closure rules are operational read surfaces.
drop policy if exists "closure_rules_select" on public.closure_rules;
create policy "closure_rules_select"
on public.closure_rules
for select
to authenticated
using (
  (select public.current_profile_has_permission('operations', 'can_view'))
);

drop policy if exists "center_closures_select" on public.center_closures;
create policy "center_closures_select"
on public.center_closures
for select
to authenticated
using (
  (select public.current_profile_has_permission('operations', 'can_view'))
);

-- Billing configuration reads must stay on explicit operations view permission.
drop policy if exists "center_billing_settings_select" on public.center_billing_settings;
create policy "center_billing_settings_select"
on public.center_billing_settings
for select
to authenticated
using (
  (select public.current_profile_has_permission('operations', 'can_view'))
);

drop policy if exists "billing_schedule_templates_select" on public.billing_schedule_templates;
create policy "billing_schedule_templates_select"
on public.billing_schedule_templates
for select
to authenticated
using (
  (select public.current_profile_has_permission('operations', 'can_view'))
);

drop policy if exists "payors_select" on public.payors;
create policy "payors_select"
on public.payors
for select
to authenticated
using (
  (select public.current_profile_has_permission('operations', 'can_view'))
);

drop policy if exists "member_billing_settings_select" on public.member_billing_settings;
create policy "member_billing_settings_select"
on public.member_billing_settings
for select
to authenticated
using (
  (select public.current_profile_has_permission('operations', 'can_view'))
);

commit;