begin;

-- Harden member_files policies so authenticated users cannot directly enumerate
-- or mutate clinical categories without explicit health-unit permissions.

drop policy if exists "member_files_select" on public.member_files;
create policy "member_files_select"
on public.member_files
for select
to authenticated
using (
  (select public.current_profile_has_permission('operations', 'can_view'))
  and (
    category not in ('Assessment', 'Care Plan', 'Orders / POF', 'Health Unit')
    or (
      (select public.current_role()) in ('admin', 'manager', 'nurse')
      and (select public.current_profile_has_permission('health-unit', 'can_view'))
    )
  )
);

drop policy if exists "member_files_insert" on public.member_files;
create policy "member_files_insert"
on public.member_files
for insert
to authenticated
with check (
  (select public.current_profile_has_permission('operations', 'can_edit'))
  and (
    category not in ('Assessment', 'Care Plan', 'Orders / POF', 'Health Unit')
    or (
      (select public.current_role()) in ('admin', 'nurse')
      and (select public.current_profile_has_permission('health-unit', 'can_edit'))
    )
  )
);

drop policy if exists "member_files_update" on public.member_files;
create policy "member_files_update"
on public.member_files
for update
to authenticated
using (
  (select public.current_profile_has_permission('operations', 'can_edit'))
  and (
    category not in ('Assessment', 'Care Plan', 'Orders / POF', 'Health Unit')
    or (
      (select public.current_role()) in ('admin', 'nurse')
      and (select public.current_profile_has_permission('health-unit', 'can_edit'))
    )
  )
)
with check (
  (select public.current_profile_has_permission('operations', 'can_edit'))
  and (
    category not in ('Assessment', 'Care Plan', 'Orders / POF', 'Health Unit')
    or (
      (select public.current_role()) in ('admin', 'nurse')
      and (select public.current_profile_has_permission('health-unit', 'can_edit'))
    )
  )
);

drop policy if exists "member_files_delete" on public.member_files;
create policy "member_files_delete"
on public.member_files
for delete
to authenticated
using (
  (select public.current_profile_has_permission('operations', 'can_edit'))
  and (
    category not in ('Assessment', 'Care Plan', 'Orders / POF', 'Health Unit')
    or (
      (select public.current_role()) in ('admin', 'nurse')
      and (select public.current_profile_has_permission('health-unit', 'can_edit'))
    )
  )
);

commit;