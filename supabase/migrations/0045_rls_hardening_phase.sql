-- RLS hardening phase for sensitive operational and clinical tables.
-- Note: 0044 is already used by the atomic workflow migration, so this
-- hardening pass lands as 0045 to preserve ordered forward-only migrations.

-- POF signature artifacts: readable to internal clinical/ops users, writable only through service/RPC.
drop policy if exists "pof_signatures_select" on public.pof_signatures;
drop policy if exists "pof_signatures_insert" on public.pof_signatures;
drop policy if exists "pof_signatures_update" on public.pof_signatures;
drop policy if exists "pof_signatures_read_internal" on public.pof_signatures;
drop policy if exists "pof_signatures_service_insert" on public.pof_signatures;

create policy "pof_signatures_read_internal"
on public.pof_signatures
for select
to authenticated
using (public.current_role() in ('admin', 'manager', 'director', 'nurse'));

create policy "pof_signatures_service_insert"
on public.pof_signatures
for insert
to service_role
with check (true);

-- POF document timeline: append-only service writes, internal reads only.
drop policy if exists "document_events_select" on public.document_events;
drop policy if exists "document_events_insert" on public.document_events;
drop policy if exists "document_events_read_internal" on public.document_events;
drop policy if exists "document_events_service_insert" on public.document_events;

create policy "document_events_read_internal"
on public.document_events
for select
to authenticated
using (public.current_role() in ('admin', 'manager', 'director', 'nurse'));

create policy "document_events_service_insert"
on public.document_events
for insert
to service_role
with check (true);

-- Notifications: recipient-scoped reads and mark-read updates, service-only inserts.
drop policy if exists "user_notifications_select" on public.user_notifications;
drop policy if exists "user_notifications_insert" on public.user_notifications;
drop policy if exists "user_notifications_update" on public.user_notifications;
drop policy if exists "user_notifications_read_recipient" on public.user_notifications;
drop policy if exists "user_notifications_service_insert" on public.user_notifications;
drop policy if exists "user_notifications_mark_read_recipient" on public.user_notifications;

create policy "user_notifications_read_recipient"
on public.user_notifications
for select
to authenticated
using (recipient_user_id = public.current_profile_id());

create policy "user_notifications_service_insert"
on public.user_notifications
for insert
to service_role
with check (true);

create policy "user_notifications_mark_read_recipient"
on public.user_notifications
for update
to authenticated
using (recipient_user_id = public.current_profile_id())
with check (recipient_user_id = public.current_profile_id());

-- Enrollment packet requests: internal visibility, service/RPC writes only.
drop policy if exists "enrollment_packet_requests_select" on public.enrollment_packet_requests;
drop policy if exists "enrollment_packet_requests_insert" on public.enrollment_packet_requests;
drop policy if exists "enrollment_packet_requests_update" on public.enrollment_packet_requests;
drop policy if exists "enrollment_packet_requests_read_internal" on public.enrollment_packet_requests;
drop policy if exists "enrollment_packet_requests_service_insert" on public.enrollment_packet_requests;
drop policy if exists "enrollment_packet_requests_service_update" on public.enrollment_packet_requests;

create policy "enrollment_packet_requests_read_internal"
on public.enrollment_packet_requests
for select
to authenticated
using (
  public.current_role() in ('admin', 'manager', 'director', 'nurse', 'coordinator')
  or sender_user_id = public.current_profile_id()
);

create policy "enrollment_packet_requests_service_insert"
on public.enrollment_packet_requests
for insert
to service_role
with check (true);

create policy "enrollment_packet_requests_service_update"
on public.enrollment_packet_requests
for update
to service_role
using (true)
with check (true);

-- Enrollment packet field conflicts: read by internal reviewers or sender, writes only from mapping service.
drop policy if exists "enrollment_packet_field_conflicts_select" on public.enrollment_packet_field_conflicts;
drop policy if exists "enrollment_packet_field_conflicts_insert" on public.enrollment_packet_field_conflicts;
drop policy if exists "enrollment_packet_field_conflicts_update" on public.enrollment_packet_field_conflicts;
drop policy if exists "enrollment_packet_field_conflicts_read_internal" on public.enrollment_packet_field_conflicts;
drop policy if exists "enrollment_packet_field_conflicts_service_insert" on public.enrollment_packet_field_conflicts;
drop policy if exists "enrollment_packet_field_conflicts_service_update" on public.enrollment_packet_field_conflicts;

create policy "enrollment_packet_field_conflicts_read_internal"
on public.enrollment_packet_field_conflicts
for select
to authenticated
using (
  public.current_role() in ('admin', 'manager', 'director', 'nurse', 'coordinator')
  or exists (
    select 1
    from public.enrollment_packet_requests req
    where req.id = public.enrollment_packet_field_conflicts.packet_id
      and req.sender_user_id = public.current_profile_id()
  )
);

create policy "enrollment_packet_field_conflicts_service_insert"
on public.enrollment_packet_field_conflicts
for insert
to service_role
with check (true);

create policy "enrollment_packet_field_conflicts_service_update"
on public.enrollment_packet_field_conflicts
for update
to service_role
using (true)
with check (true);

-- Care plan nurse signatures: internal reads, service-only writes.
drop policy if exists "care_plan_nurse_signatures_select" on public.care_plan_nurse_signatures;
drop policy if exists "care_plan_nurse_signatures_insert" on public.care_plan_nurse_signatures;
drop policy if exists "care_plan_nurse_signatures_update" on public.care_plan_nurse_signatures;
drop policy if exists "care_plan_nurse_signatures_read_internal" on public.care_plan_nurse_signatures;
drop policy if exists "care_plan_nurse_signatures_service_insert" on public.care_plan_nurse_signatures;
drop policy if exists "care_plan_nurse_signatures_service_update" on public.care_plan_nurse_signatures;

create policy "care_plan_nurse_signatures_read_internal"
on public.care_plan_nurse_signatures
for select
to authenticated
using (public.current_role() in ('admin', 'manager', 'director', 'nurse'));

create policy "care_plan_nurse_signatures_service_insert"
on public.care_plan_nurse_signatures
for insert
to service_role
with check (true);

create policy "care_plan_nurse_signatures_service_update"
on public.care_plan_nurse_signatures
for update
to service_role
using (true)
with check (true);

-- POF post-sign retry queue: internal reads, service/RPC writes only.
drop policy if exists "pof_post_sign_sync_queue_select" on public.pof_post_sign_sync_queue;
drop policy if exists "pof_post_sign_sync_queue_insert" on public.pof_post_sign_sync_queue;
drop policy if exists "pof_post_sign_sync_queue_update" on public.pof_post_sign_sync_queue;
drop policy if exists "pof_post_sign_sync_queue_read_internal" on public.pof_post_sign_sync_queue;
drop policy if exists "pof_post_sign_sync_queue_service_insert" on public.pof_post_sign_sync_queue;
drop policy if exists "pof_post_sign_sync_queue_service_update" on public.pof_post_sign_sync_queue;

create policy "pof_post_sign_sync_queue_read_internal"
on public.pof_post_sign_sync_queue
for select
to authenticated
using (public.current_role() in ('admin', 'manager', 'director', 'nurse'));

create policy "pof_post_sign_sync_queue_service_insert"
on public.pof_post_sign_sync_queue
for insert
to service_role
with check (true);

create policy "pof_post_sign_sync_queue_service_update"
on public.pof_post_sign_sync_queue
for update
to service_role
using (true)
with check (true);

-- System events: append-only service log with internal admin/ops reads.
drop policy if exists "system_events_select" on public.system_events;
drop policy if exists "system_events_insert" on public.system_events;
drop policy if exists "system_events_read_internal" on public.system_events;
drop policy if exists "system_events_service_insert" on public.system_events;

create policy "system_events_read_internal"
on public.system_events
for select
to authenticated
using (public.current_role() in ('admin', 'manager', 'director'));

create policy "system_events_service_insert"
on public.system_events
for insert
to service_role
with check (true);

-- Member health profiles: internal clinical/ops reads, service/RPC writes only.
drop policy if exists "member_health_profiles_select" on public.member_health_profiles;
drop policy if exists "member_health_profiles_insert" on public.member_health_profiles;
drop policy if exists "member_health_profiles_update" on public.member_health_profiles;
drop policy if exists "member_health_profiles_read_internal" on public.member_health_profiles;
drop policy if exists "member_health_profiles_service_insert" on public.member_health_profiles;
drop policy if exists "member_health_profiles_service_update" on public.member_health_profiles;

create policy "member_health_profiles_read_internal"
on public.member_health_profiles
for select
to authenticated
using (public.current_role() in ('admin', 'manager', 'director', 'nurse', 'coordinator'));

create policy "member_health_profiles_service_insert"
on public.member_health_profiles
for insert
to service_role
with check (true);

create policy "member_health_profiles_service_update"
on public.member_health_profiles
for update
to service_role
using (true)
with check (true);

-- Clinical child tables: readable to internal clinical/ops roles, writable only through service/RPC paths.
drop policy if exists "member_diagnoses_select" on public.member_diagnoses;
drop policy if exists "member_diagnoses_insert" on public.member_diagnoses;
drop policy if exists "member_diagnoses_update" on public.member_diagnoses;
drop policy if exists "member_diagnoses_delete" on public.member_diagnoses;
drop policy if exists "member_diagnoses_read_internal" on public.member_diagnoses;
drop policy if exists "member_diagnoses_service_insert" on public.member_diagnoses;
drop policy if exists "member_diagnoses_service_update" on public.member_diagnoses;
drop policy if exists "member_diagnoses_service_delete" on public.member_diagnoses;

create policy "member_diagnoses_read_internal"
on public.member_diagnoses
for select
to authenticated
using (public.current_role() in ('admin', 'manager', 'director', 'nurse', 'coordinator'));

create policy "member_diagnoses_service_insert"
on public.member_diagnoses
for insert
to service_role
with check (true);

create policy "member_diagnoses_service_update"
on public.member_diagnoses
for update
to service_role
using (true)
with check (true);

create policy "member_diagnoses_service_delete"
on public.member_diagnoses
for delete
to service_role
using (true);

drop policy if exists "member_medications_select" on public.member_medications;
drop policy if exists "member_medications_insert" on public.member_medications;
drop policy if exists "member_medications_update" on public.member_medications;
drop policy if exists "member_medications_delete" on public.member_medications;
drop policy if exists "member_medications_read_internal" on public.member_medications;
drop policy if exists "member_medications_service_insert" on public.member_medications;
drop policy if exists "member_medications_service_update" on public.member_medications;
drop policy if exists "member_medications_service_delete" on public.member_medications;

create policy "member_medications_read_internal"
on public.member_medications
for select
to authenticated
using (public.current_role() in ('admin', 'manager', 'director', 'nurse', 'coordinator'));

create policy "member_medications_service_insert"
on public.member_medications
for insert
to service_role
with check (true);

create policy "member_medications_service_update"
on public.member_medications
for update
to service_role
using (true)
with check (true);

create policy "member_medications_service_delete"
on public.member_medications
for delete
to service_role
using (true);

drop policy if exists "member_allergies_select" on public.member_allergies;
drop policy if exists "member_allergies_insert" on public.member_allergies;
drop policy if exists "member_allergies_update" on public.member_allergies;
drop policy if exists "member_allergies_delete" on public.member_allergies;
drop policy if exists "member_allergies_read_internal" on public.member_allergies;
drop policy if exists "member_allergies_service_insert" on public.member_allergies;
drop policy if exists "member_allergies_service_update" on public.member_allergies;
drop policy if exists "member_allergies_service_delete" on public.member_allergies;

create policy "member_allergies_read_internal"
on public.member_allergies
for select
to authenticated
using (public.current_role() in ('admin', 'manager', 'director', 'nurse', 'coordinator'));

create policy "member_allergies_service_insert"
on public.member_allergies
for insert
to service_role
with check (true);

create policy "member_allergies_service_update"
on public.member_allergies
for update
to service_role
using (true)
with check (true);

create policy "member_allergies_service_delete"
on public.member_allergies
for delete
to service_role
using (true);
