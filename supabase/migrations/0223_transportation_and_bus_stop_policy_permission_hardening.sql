begin;

-- Transportation operational logs should require explicit operations read permission.
drop policy if exists "transportation_runs_select" on public.transportation_runs;
create policy "transportation_runs_select"
on public.transportation_runs
for select
to authenticated
using (
  (select public.current_profile_has_permission('operations', 'can_view'))
);

drop policy if exists "transportation_run_results_select" on public.transportation_run_results;
create policy "transportation_run_results_select"
on public.transportation_run_results
for select
to authenticated
using (
  (select public.current_profile_has_permission('operations', 'can_view'))
);

-- Bus stop directory should not be globally readable/writable to all authenticated sessions.
drop policy if exists "bus_stop_directory_select" on public.bus_stop_directory;
create policy "bus_stop_directory_select"
on public.bus_stop_directory
for select
to authenticated
using (
  (select public.current_profile_has_permission('operations', 'can_view'))
);

drop policy if exists "bus_stop_directory_insert" on public.bus_stop_directory;
create policy "bus_stop_directory_insert"
on public.bus_stop_directory
for insert
to authenticated
with check (
  (select public.current_profile_has_permission('operations', 'can_edit'))
);

drop policy if exists "bus_stop_directory_update" on public.bus_stop_directory;
create policy "bus_stop_directory_update"
on public.bus_stop_directory
for update
to authenticated
using (
  (select public.current_profile_has_permission('operations', 'can_edit'))
)
with check (
  (select public.current_profile_has_permission('operations', 'can_edit'))
);

commit;
