-- Supabase advisor performance cleanup:
-- 1. Avoid per-row re-evaluation of auth and role lookups in flagged RLS policies.
-- 2. Remove confirmed duplicate indexes while preserving one equivalent index per access path.

alter policy "profiles_self_or_admin" on public.profiles
using (
  id = (select auth.uid())
  or (select public.current_role()) in ('admin', 'manager')
);

alter policy "time_punches_read" on public.time_punches
using (
  staff_user_id = (select auth.uid())
  or (select public.current_role()) in ('admin', 'manager')
);

alter policy "time_punches_insert" on public.time_punches
with check (
  staff_user_id = (select auth.uid())
  or (select public.current_role()) in ('admin', 'manager')
);

alter policy "doc_read" on public.daily_activity_logs
using ((select auth.uid()) is not null);

alter policy "doc_insert" on public.daily_activity_logs
with check (
  staff_user_id = (select auth.uid())
  or (select public.current_role()) in ('manager', 'admin')
);

alter policy "toilet_read" on public.toilet_logs
using ((select auth.uid()) is not null);

alter policy "toilet_insert" on public.toilet_logs
with check (
  staff_user_id = (select auth.uid())
  or (select public.current_role()) in ('admin', 'manager', 'director')
);

alter policy "shower_read" on public.shower_logs
using ((select auth.uid()) is not null);

alter policy "shower_insert" on public.shower_logs
with check (
  staff_user_id = (select auth.uid())
  or (select public.current_role()) in ('admin', 'manager', 'director')
);

alter policy "transport_read" on public.transportation_logs
using ((select auth.uid()) is not null);

alter policy "transport_insert" on public.transportation_logs
with check (
  staff_user_id = (select auth.uid())
  or (select public.current_role()) in ('admin', 'manager', 'director')
);

alter policy "tracker_read" on public.documentation_tracker
using ((select auth.uid()) is not null);

alter policy "assign_read" on public.documentation_assignments
using ((select auth.uid()) is not null);

alter policy "events_read" on public.documentation_events
using ((select auth.uid()) is not null);

alter policy "events_insert" on public.documentation_events
with check (
  staff_user_id = (select auth.uid())
  or (select public.current_role()) in ('admin', 'manager', 'director')
);

alter policy "ancillary_categories_read" on public.ancillary_charge_categories
using ((select auth.uid()) is not null);

alter policy "ancillary_read" on public.ancillary_charge_logs
using ((select auth.uid()) is not null);

alter policy "ancillary_insert" on public.ancillary_charge_logs
with check (
  staff_user_id = (select auth.uid())
  or (select public.current_role()) in ('manager', 'admin')
);

alter policy "audit_insert" on public.audit_logs
with check (actor_user_id = (select auth.uid()));

alter policy "pto_read" on public.pto_requests
using (
  staff_user_id = (select auth.uid())
  or (select public.current_role()) in ('admin', 'manager')
);

alter policy "pto_insert" on public.pto_requests
with check (staff_user_id = (select auth.uid()));

alter policy "pay_periods_read" on public.pay_periods
using ((select auth.uid()) is not null);

alter policy "punches_read" on public.punches
using (
  employee_id = (select auth.uid())
  or (select public.current_role()) in ('admin', 'director', 'manager')
);

alter policy "punches_insert" on public.punches
with check (
  employee_id = (select auth.uid())
  or (select public.current_role()) in ('admin', 'director', 'manager')
);

alter policy "daily_timecards_read" on public.daily_timecards
using (
  employee_id = (select auth.uid())
  or (select public.current_role()) in ('admin', 'director', 'manager')
);

alter policy "forgotten_punch_requests_read" on public.forgotten_punch_requests
using (
  employee_id = (select auth.uid())
  or (select public.current_role()) in ('admin', 'director', 'manager')
);

alter policy "forgotten_punch_requests_insert" on public.forgotten_punch_requests
with check (
  employee_id = (select auth.uid())
  or (select public.current_role()) in ('admin', 'director', 'manager')
);

alter policy "pto_entries_read" on public.pto_entries
using (
  employee_id = (select auth.uid())
  or (select public.current_role()) in ('admin', 'director', 'manager')
);

alter policy "pto_entries_insert" on public.pto_entries
with check (
  employee_id = (select auth.uid())
  or (select public.current_role()) in ('admin', 'director', 'manager')
);

alter policy "photo_read" on public.member_photo_uploads
using ((select auth.uid()) is not null);

alter policy "photo_insert" on public.member_photo_uploads
with check (
  uploaded_by = (select auth.uid())
  or (select public.current_role()) in ('admin', 'manager', 'director')
);

alter policy "member_holds_read" on public.member_holds
using ((select auth.uid()) is not null);

alter policy "operations_settings_select" on public.operations_settings
using ((select auth.uid()) is not null);

alter policy "mar_administrations_insert" on public.mar_administrations
with check (
  (select public.current_role()) in ('admin', 'manager', 'director')
  or administered_by_user_id = (select auth.uid())
);

alter policy "staff_auth_events_insert_actor_or_service" on public.staff_auth_events
with check (
  actor_user_id = (select auth.uid())
  or staff_user_id = (select auth.uid())
  or (select auth.role()) = 'service_role'
);

alter policy "incidents_select_internal" on public.incidents
using ((select auth.uid()) is not null);

alter policy "incident_history_select_internal" on public.incident_history
using ((select auth.uid()) is not null);

drop index if exists public.idx_member_files_member_document_source;
drop index if exists public.idx_documentation_assignments_due_at_open;
