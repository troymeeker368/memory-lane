begin;

-- Align care-plan read/write boundaries with explicit health-unit permissions.
-- This closes broad authenticated access on child care-plan tables.

drop policy if exists "care_plans_select" on public.care_plans;
create policy "care_plans_select"
on public.care_plans
for select
to authenticated
using (
  (select public.current_role()) in ('admin', 'manager', 'director', 'nurse')
  and (select public.current_profile_has_permission('health-unit', 'can_view'))
);

drop policy if exists "care_plans_insert" on public.care_plans;
create policy "care_plans_insert"
on public.care_plans
for insert
to authenticated
with check (
  (select public.current_role()) in ('admin', 'nurse')
  and (select public.current_profile_has_permission('health-unit', 'can_edit'))
  and created_by_user_id = (select public.current_profile_id())
  and updated_by_user_id = (select public.current_profile_id())
  and (
    nurse_designee_user_id is null
    or nurse_designee_user_id = (select public.current_profile_id())
    or (select public.current_role()) = 'admin'
  )
);

drop policy if exists "care_plans_update" on public.care_plans;
create policy "care_plans_update"
on public.care_plans
for update
to authenticated
using (
  (select public.current_role()) in ('admin', 'nurse')
  and (select public.current_profile_has_permission('health-unit', 'can_edit'))
)
with check (
  (select public.current_role()) in ('admin', 'nurse')
  and (select public.current_profile_has_permission('health-unit', 'can_edit'))
  and (
    updated_by_user_id is null
    or updated_by_user_id = (select public.current_profile_id())
  )
  and (
    nurse_designee_user_id is null
    or nurse_designee_user_id = (select public.current_profile_id())
    or (select public.current_role()) = 'admin'
  )
);

drop policy if exists "care_plan_sections_select" on public.care_plan_sections;
create policy "care_plan_sections_select"
on public.care_plan_sections
for select
to authenticated
using (
  (select public.current_role()) in ('admin', 'manager', 'director', 'nurse')
  and (select public.current_profile_has_permission('health-unit', 'can_view'))
);

drop policy if exists "care_plan_sections_insert" on public.care_plan_sections;
create policy "care_plan_sections_insert"
on public.care_plan_sections
for insert
to authenticated
with check (
  (select public.current_role()) in ('admin', 'nurse')
  and (select public.current_profile_has_permission('health-unit', 'can_edit'))
);

drop policy if exists "care_plan_sections_update" on public.care_plan_sections;
create policy "care_plan_sections_update"
on public.care_plan_sections
for update
to authenticated
using (
  (select public.current_role()) in ('admin', 'nurse')
  and (select public.current_profile_has_permission('health-unit', 'can_edit'))
)
with check (
  (select public.current_role()) in ('admin', 'nurse')
  and (select public.current_profile_has_permission('health-unit', 'can_edit'))
);

drop policy if exists "care_plan_sections_delete" on public.care_plan_sections;
create policy "care_plan_sections_delete"
on public.care_plan_sections
for delete
to authenticated
using (
  (select public.current_role()) in ('admin', 'nurse')
  and (select public.current_profile_has_permission('health-unit', 'can_edit'))
);

drop policy if exists "care_plan_versions_select" on public.care_plan_versions;
create policy "care_plan_versions_select"
on public.care_plan_versions
for select
to authenticated
using (
  (select public.current_role()) in ('admin', 'manager', 'director', 'nurse')
  and (select public.current_profile_has_permission('health-unit', 'can_view'))
);

drop policy if exists "care_plan_versions_insert" on public.care_plan_versions;
create policy "care_plan_versions_insert"
on public.care_plan_versions
for insert
to authenticated
with check (
  (select public.current_role()) in ('admin', 'nurse')
  and (select public.current_profile_has_permission('health-unit', 'can_edit'))
);

drop policy if exists "care_plan_review_history_select" on public.care_plan_review_history;
create policy "care_plan_review_history_select"
on public.care_plan_review_history
for select
to authenticated
using (
  (select public.current_role()) in ('admin', 'manager', 'director', 'nurse')
  and (select public.current_profile_has_permission('health-unit', 'can_view'))
);

drop policy if exists "care_plan_review_history_insert" on public.care_plan_review_history;
create policy "care_plan_review_history_insert"
on public.care_plan_review_history
for insert
to authenticated
with check (
  (select public.current_role()) in ('admin', 'nurse')
  and (select public.current_profile_has_permission('health-unit', 'can_edit'))
);

commit;