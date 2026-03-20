-- Harden enrollment packet RLS by removing broad authenticated policies
-- and scoping access to internal reviewers, sender ownership, and canonical packet/member joins.

create or replace function public.is_enrollment_packet_internal_viewer()
returns boolean
language sql
stable
as $$
  select (select public.current_role()) in ('admin', 'manager', 'director', 'nurse', 'coordinator')
$$;

create or replace function public.is_enrollment_packet_sender_role()
returns boolean
language sql
stable
as $$
  select (select public.current_role()) in ('admin', 'manager', 'director', 'sales')
$$;

create or replace function public.can_access_enrollment_packet_child(
  p_packet_id uuid,
  p_member_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.enrollment_packet_requests req
    where req.id = p_packet_id
      and (p_member_id is null or req.member_id = p_member_id)
      and (
        public.is_enrollment_packet_internal_viewer()
        or req.sender_user_id = public.current_profile_id()
      )
  )
$$;

create or replace function public.can_write_enrollment_packet_request(
  p_member_id uuid,
  p_lead_id uuid,
  p_sender_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.members m
    where m.id = p_member_id
  )
  and (
    p_lead_id is null
    or exists (
      select 1
      from public.leads l
      where l.id = p_lead_id
    )
  )
  and exists (
    select 1
    from public.profiles p
    where p.id = p_sender_user_id
      and p.role in ('admin', 'manager', 'director', 'sales')
  )
$$;

create or replace function public.can_write_enrollment_packet_child(
  p_packet_id uuid,
  p_member_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.enrollment_packet_requests req
    where req.id = p_packet_id
      and (p_member_id is null or req.member_id = p_member_id)
  )
$$;

grant execute on function public.is_enrollment_packet_internal_viewer() to authenticated, service_role;
grant execute on function public.is_enrollment_packet_sender_role() to authenticated, service_role;
grant execute on function public.can_access_enrollment_packet_child(uuid, uuid) to authenticated, service_role;
grant execute on function public.can_write_enrollment_packet_request(uuid, uuid, uuid) to authenticated, service_role;
grant execute on function public.can_write_enrollment_packet_child(uuid, uuid) to authenticated, service_role;

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
  public.is_enrollment_packet_internal_viewer()
  or sender_user_id = public.current_profile_id()
);

create policy "enrollment_packet_requests_service_insert"
on public.enrollment_packet_requests
for insert
to service_role
with check (public.can_write_enrollment_packet_request(member_id, lead_id, sender_user_id));

create policy "enrollment_packet_requests_service_update"
on public.enrollment_packet_requests
for update
to service_role
using (public.can_write_enrollment_packet_request(member_id, lead_id, sender_user_id))
with check (public.can_write_enrollment_packet_request(member_id, lead_id, sender_user_id));

drop policy if exists "enrollment_packet_fields_select" on public.enrollment_packet_fields;
drop policy if exists "enrollment_packet_fields_insert" on public.enrollment_packet_fields;
drop policy if exists "enrollment_packet_fields_update" on public.enrollment_packet_fields;
drop policy if exists "enrollment_packet_fields_read_internal" on public.enrollment_packet_fields;
drop policy if exists "enrollment_packet_fields_service_insert" on public.enrollment_packet_fields;
drop policy if exists "enrollment_packet_fields_service_update" on public.enrollment_packet_fields;

create policy "enrollment_packet_fields_read_internal"
on public.enrollment_packet_fields
for select
to authenticated
using (public.can_access_enrollment_packet_child(packet_id));

create policy "enrollment_packet_fields_service_insert"
on public.enrollment_packet_fields
for insert
to service_role
with check (public.can_write_enrollment_packet_child(packet_id));

create policy "enrollment_packet_fields_service_update"
on public.enrollment_packet_fields
for update
to service_role
using (public.can_write_enrollment_packet_child(packet_id))
with check (public.can_write_enrollment_packet_child(packet_id));

drop policy if exists "enrollment_packet_events_select" on public.enrollment_packet_events;
drop policy if exists "enrollment_packet_events_insert" on public.enrollment_packet_events;
drop policy if exists "enrollment_packet_events_read_internal" on public.enrollment_packet_events;
drop policy if exists "enrollment_packet_events_service_insert" on public.enrollment_packet_events;

create policy "enrollment_packet_events_read_internal"
on public.enrollment_packet_events
for select
to authenticated
using (public.can_access_enrollment_packet_child(packet_id));

create policy "enrollment_packet_events_service_insert"
on public.enrollment_packet_events
for insert
to service_role
with check (
  public.can_write_enrollment_packet_child(packet_id)
  and (
    actor_user_id is null
    or exists (
      select 1
      from public.profiles p
      where p.id = actor_user_id
    )
  )
);

drop policy if exists "enrollment_packet_signatures_select" on public.enrollment_packet_signatures;
drop policy if exists "enrollment_packet_signatures_insert" on public.enrollment_packet_signatures;
drop policy if exists "enrollment_packet_signatures_update" on public.enrollment_packet_signatures;
drop policy if exists "enrollment_packet_signatures_read_internal" on public.enrollment_packet_signatures;
drop policy if exists "enrollment_packet_signatures_service_insert" on public.enrollment_packet_signatures;
drop policy if exists "enrollment_packet_signatures_service_update" on public.enrollment_packet_signatures;

create policy "enrollment_packet_signatures_read_internal"
on public.enrollment_packet_signatures
for select
to authenticated
using (public.can_access_enrollment_packet_child(packet_id));

create policy "enrollment_packet_signatures_service_insert"
on public.enrollment_packet_signatures
for insert
to service_role
with check (public.can_write_enrollment_packet_child(packet_id));

create policy "enrollment_packet_signatures_service_update"
on public.enrollment_packet_signatures
for update
to service_role
using (public.can_write_enrollment_packet_child(packet_id))
with check (public.can_write_enrollment_packet_child(packet_id));

drop policy if exists "enrollment_packet_sender_signatures_select" on public.enrollment_packet_sender_signatures;
drop policy if exists "enrollment_packet_sender_signatures_insert" on public.enrollment_packet_sender_signatures;
drop policy if exists "enrollment_packet_sender_signatures_update" on public.enrollment_packet_sender_signatures;
drop policy if exists "enrollment_packet_sender_signatures_service_insert" on public.enrollment_packet_sender_signatures;
drop policy if exists "enrollment_packet_sender_signatures_service_update" on public.enrollment_packet_sender_signatures;

create policy "enrollment_packet_sender_signatures_select"
on public.enrollment_packet_sender_signatures
for select
to authenticated
using (
  user_id = public.current_profile_id()
  and public.is_enrollment_packet_sender_role()
);

create policy "enrollment_packet_sender_signatures_insert"
on public.enrollment_packet_sender_signatures
for insert
to authenticated
with check (
  user_id = public.current_profile_id()
  and public.is_enrollment_packet_sender_role()
);

create policy "enrollment_packet_sender_signatures_update"
on public.enrollment_packet_sender_signatures
for update
to authenticated
using (
  user_id = public.current_profile_id()
  and public.is_enrollment_packet_sender_role()
)
with check (
  user_id = public.current_profile_id()
  and public.is_enrollment_packet_sender_role()
);

create policy "enrollment_packet_sender_signatures_service_insert"
on public.enrollment_packet_sender_signatures
for insert
to service_role
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = user_id
      and p.role in ('admin', 'manager', 'director', 'sales')
  )
);

create policy "enrollment_packet_sender_signatures_service_update"
on public.enrollment_packet_sender_signatures
for update
to service_role
using (
  exists (
    select 1
    from public.profiles p
    where p.id = user_id
      and p.role in ('admin', 'manager', 'director', 'sales')
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = user_id
      and p.role in ('admin', 'manager', 'director', 'sales')
  )
);

drop policy if exists "enrollment_packet_uploads_select" on public.enrollment_packet_uploads;
drop policy if exists "enrollment_packet_uploads_insert" on public.enrollment_packet_uploads;
drop policy if exists "enrollment_packet_uploads_update" on public.enrollment_packet_uploads;
drop policy if exists "enrollment_packet_uploads_read_internal" on public.enrollment_packet_uploads;
drop policy if exists "enrollment_packet_uploads_service_insert" on public.enrollment_packet_uploads;
drop policy if exists "enrollment_packet_uploads_service_update" on public.enrollment_packet_uploads;

create policy "enrollment_packet_uploads_read_internal"
on public.enrollment_packet_uploads
for select
to authenticated
using (public.can_access_enrollment_packet_child(packet_id, member_id));

create policy "enrollment_packet_uploads_service_insert"
on public.enrollment_packet_uploads
for insert
to service_role
with check (public.can_write_enrollment_packet_child(packet_id, member_id));

create policy "enrollment_packet_uploads_service_update"
on public.enrollment_packet_uploads
for update
to service_role
using (public.can_write_enrollment_packet_child(packet_id, member_id))
with check (public.can_write_enrollment_packet_child(packet_id, member_id));
