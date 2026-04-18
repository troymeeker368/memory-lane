-- Tighten high-risk operational write policies so role checks require explicit module edit permission.

-- Attendance / schedule / holds.
drop policy if exists "attendance_records_insert" on public.attendance_records;
create policy "attendance_records_insert"
on public.attendance_records
for insert
to authenticated
with check (
  public.current_role() in ('admin', 'manager', 'director', 'nurse', 'coordinator')
  and (select public.current_profile_has_permission('operations', 'can_edit'))
);

drop policy if exists "attendance_records_update" on public.attendance_records;
create policy "attendance_records_update"
on public.attendance_records
for update
to authenticated
using (
  public.current_role() in ('admin', 'manager', 'director', 'nurse', 'coordinator')
  and (select public.current_profile_has_permission('operations', 'can_edit'))
)
with check (
  public.current_role() in ('admin', 'manager', 'director', 'nurse', 'coordinator')
  and (select public.current_profile_has_permission('operations', 'can_edit'))
);

drop policy if exists "member_holds_insert" on public.member_holds;
create policy "member_holds_insert"
on public.member_holds
for insert
to authenticated
with check (
  public.current_role() in ('admin', 'manager', 'director')
  and (select public.current_profile_has_permission('operations', 'can_edit'))
);

drop policy if exists "member_holds_update" on public.member_holds;
create policy "member_holds_update"
on public.member_holds
for update
to authenticated
using (
  public.current_role() in ('admin', 'manager', 'director')
  and (select public.current_profile_has_permission('operations', 'can_edit'))
)
with check (
  public.current_role() in ('admin', 'manager', 'director')
  and (select public.current_profile_has_permission('operations', 'can_edit'))
);

drop policy if exists "schedule_changes_insert" on public.schedule_changes;
create policy "schedule_changes_insert"
on public.schedule_changes
for insert
to authenticated
with check (
  public.current_role() in ('admin', 'manager', 'director', 'nurse', 'coordinator')
  and (select public.current_profile_has_permission('operations', 'can_edit'))
);

drop policy if exists "schedule_changes_update" on public.schedule_changes;
create policy "schedule_changes_update"
on public.schedule_changes
for update
to authenticated
using (
  public.current_role() in ('admin', 'manager', 'director', 'nurse', 'coordinator')
  and (select public.current_profile_has_permission('operations', 'can_edit'))
)
with check (
  public.current_role() in ('admin', 'manager', 'director', 'nurse', 'coordinator')
  and (select public.current_profile_has_permission('operations', 'can_edit'))
);

-- Transportation station adjustments.
drop policy if exists "transportation_manifest_adjustments_delete" on public.transportation_manifest_adjustments;
create policy "transportation_manifest_adjustments_delete"
on public.transportation_manifest_adjustments
for delete
to authenticated
using (
  public.current_role() in ('admin', 'manager', 'director', 'coordinator')
  and (select public.current_profile_has_permission('operations', 'can_edit'))
);

drop policy if exists "transportation_manifest_adjustments_insert" on public.transportation_manifest_adjustments;
create policy "transportation_manifest_adjustments_insert"
on public.transportation_manifest_adjustments
for insert
to authenticated
with check (
  public.current_role() in ('admin', 'manager', 'director', 'coordinator')
  and (select public.current_profile_has_permission('operations', 'can_edit'))
);

drop policy if exists "transportation_manifest_adjustments_update" on public.transportation_manifest_adjustments;
create policy "transportation_manifest_adjustments_update"
on public.transportation_manifest_adjustments
for update
to authenticated
using (
  public.current_role() in ('admin', 'manager', 'director', 'coordinator')
  and (select public.current_profile_has_permission('operations', 'can_edit'))
)
with check (
  public.current_role() in ('admin', 'manager', 'director', 'coordinator')
  and (select public.current_profile_has_permission('operations', 'can_edit'))
);

-- Billing configuration write boundaries.
drop policy if exists "center_closures_delete" on public.center_closures;
create policy "center_closures_delete"
on public.center_closures
for delete
to authenticated
using (
  public.current_role() in ('admin', 'manager', 'director', 'coordinator')
  and (select public.current_profile_has_permission('operations', 'can_edit'))
);

drop policy if exists "center_closures_insert" on public.center_closures;
create policy "center_closures_insert"
on public.center_closures
for insert
to authenticated
with check (
  public.current_role() in ('admin', 'manager', 'director', 'coordinator')
  and (select public.current_profile_has_permission('operations', 'can_edit'))
);

drop policy if exists "center_closures_update" on public.center_closures;
create policy "center_closures_update"
on public.center_closures
for update
to authenticated
using (
  public.current_role() in ('admin', 'manager', 'director', 'coordinator')
  and (select public.current_profile_has_permission('operations', 'can_edit'))
)
with check (
  public.current_role() in ('admin', 'manager', 'director', 'coordinator')
  and (select public.current_profile_has_permission('operations', 'can_edit'))
);

drop policy if exists "closure_rules_insert" on public.closure_rules;
create policy "closure_rules_insert"
on public.closure_rules
for insert
to authenticated
with check (
  public.current_role() in ('admin', 'manager', 'director', 'coordinator')
  and (select public.current_profile_has_permission('operations', 'can_edit'))
);

drop policy if exists "closure_rules_update" on public.closure_rules;
create policy "closure_rules_update"
on public.closure_rules
for update
to authenticated
using (
  public.current_role() in ('admin', 'manager', 'director', 'coordinator')
  and (select public.current_profile_has_permission('operations', 'can_edit'))
)
with check (
  public.current_role() in ('admin', 'manager', 'director', 'coordinator')
  and (select public.current_profile_has_permission('operations', 'can_edit'))
);

drop policy if exists "center_billing_settings_insert" on public.center_billing_settings;
create policy "center_billing_settings_insert"
on public.center_billing_settings
for insert
to authenticated
with check (
  public.current_role() in ('admin', 'manager', 'director', 'coordinator')
  and (select public.current_profile_has_permission('operations', 'can_edit'))
);

drop policy if exists "center_billing_settings_update" on public.center_billing_settings;
create policy "center_billing_settings_update"
on public.center_billing_settings
for update
to authenticated
using (
  public.current_role() in ('admin', 'manager', 'director', 'coordinator')
  and (select public.current_profile_has_permission('operations', 'can_edit'))
)
with check (
  public.current_role() in ('admin', 'manager', 'director', 'coordinator')
  and (select public.current_profile_has_permission('operations', 'can_edit'))
);

drop policy if exists "payors_insert" on public.payors;
create policy "payors_insert"
on public.payors
for insert
to authenticated
with check (
  public.current_role() in ('admin', 'manager', 'director', 'coordinator')
  and (select public.current_profile_has_permission('operations', 'can_edit'))
);

drop policy if exists "payors_update" on public.payors;
create policy "payors_update"
on public.payors
for update
to authenticated
using (
  public.current_role() in ('admin', 'manager', 'director', 'coordinator')
  and (select public.current_profile_has_permission('operations', 'can_edit'))
)
with check (
  public.current_role() in ('admin', 'manager', 'director', 'coordinator')
  and (select public.current_profile_has_permission('operations', 'can_edit'))
);

drop policy if exists "payors_delete" on public.payors;
create policy "payors_delete"
on public.payors
for delete
to authenticated
using (
  public.current_role() in ('admin', 'manager', 'director')
  and (select public.current_profile_has_permission('operations', 'can_edit'))
);

drop policy if exists "member_billing_settings_insert" on public.member_billing_settings;
create policy "member_billing_settings_insert"
on public.member_billing_settings
for insert
to authenticated
with check (
  public.current_role() in ('admin', 'manager', 'director', 'coordinator')
  and (select public.current_profile_has_permission('operations', 'can_edit'))
);

drop policy if exists "member_billing_settings_update" on public.member_billing_settings;
create policy "member_billing_settings_update"
on public.member_billing_settings
for update
to authenticated
using (
  public.current_role() in ('admin', 'manager', 'director', 'coordinator')
  and (select public.current_profile_has_permission('operations', 'can_edit'))
)
with check (
  public.current_role() in ('admin', 'manager', 'director', 'coordinator')
  and (select public.current_profile_has_permission('operations', 'can_edit'))
);

drop policy if exists "member_billing_settings_delete" on public.member_billing_settings;
create policy "member_billing_settings_delete"
on public.member_billing_settings
for delete
to authenticated
using (
  public.current_role() in ('admin', 'manager', 'director')
  and (select public.current_profile_has_permission('operations', 'can_edit'))
);

drop policy if exists "billing_schedule_templates_insert" on public.billing_schedule_templates;
create policy "billing_schedule_templates_insert"
on public.billing_schedule_templates
for insert
to authenticated
with check (
  public.current_role() in ('admin', 'manager', 'director', 'coordinator')
  and (select public.current_profile_has_permission('operations', 'can_edit'))
);

drop policy if exists "billing_schedule_templates_update" on public.billing_schedule_templates;
create policy "billing_schedule_templates_update"
on public.billing_schedule_templates
for update
to authenticated
using (
  public.current_role() in ('admin', 'manager', 'director', 'coordinator')
  and (select public.current_profile_has_permission('operations', 'can_edit'))
)
with check (
  public.current_role() in ('admin', 'manager', 'director', 'coordinator')
  and (select public.current_profile_has_permission('operations', 'can_edit'))
);

drop policy if exists "billing_adjustments_insert" on public.billing_adjustments;
create policy "billing_adjustments_insert"
on public.billing_adjustments
for insert
to authenticated
with check (
  public.current_role() in ('admin', 'manager', 'director', 'coordinator')
  and (select public.current_profile_has_permission('operations', 'can_edit'))
);

drop policy if exists "billing_adjustments_update" on public.billing_adjustments;
create policy "billing_adjustments_update"
on public.billing_adjustments
for update
to authenticated
using (
  public.current_role() in ('admin', 'manager', 'director', 'coordinator')
  and (select public.current_profile_has_permission('operations', 'can_edit'))
)
with check (
  public.current_role() in ('admin', 'manager', 'director', 'coordinator')
  and (select public.current_profile_has_permission('operations', 'can_edit'))
);
