-- Harden sensitive domain RLS by replacing permissive authenticated rules
-- with explicit role-aware and ownership-aware policies.

create or replace function public.current_profile_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.id
  from public.profiles p
  where p.auth_user_id = auth.uid()
     or p.id = auth.uid()
  order by
    case when p.auth_user_id = auth.uid() then 0 else 1 end,
    p.updated_at desc nulls last
  limit 1
$$;

grant execute on function public.current_profile_id() to authenticated;

-- leads
drop policy if exists "leads_read" on public.leads;
drop policy if exists "leads_insert" on public.leads;
drop policy if exists "leads_update" on public.leads;

create policy "leads_read"
on public.leads
for select
to authenticated
using (
  public.current_role() in ('admin', 'manager', 'director')
  or (
    public.current_role() = 'sales'
    and created_by_user_id = public.current_profile_id()
  )
);

create policy "leads_insert"
on public.leads
for insert
to authenticated
with check (
  public.current_role() in ('admin', 'manager', 'director')
  or (
    public.current_role() = 'sales'
    and created_by_user_id = public.current_profile_id()
  )
);

create policy "leads_update"
on public.leads
for update
to authenticated
using (
  public.current_role() in ('admin', 'manager', 'director')
  or (
    public.current_role() = 'sales'
    and created_by_user_id = public.current_profile_id()
  )
)
with check (
  public.current_role() in ('admin', 'manager', 'director')
  or (
    public.current_role() = 'sales'
    and created_by_user_id = public.current_profile_id()
  )
);

-- members
drop policy if exists "members_read" on public.members;
drop policy if exists "members_insert" on public.members;
drop policy if exists "members_update" on public.members;

create policy "members_read"
on public.members
for select
to authenticated
using (
  public.current_role() in ('admin', 'manager', 'director', 'nurse', 'coordinator', 'program-assistant')
  or (
    public.current_role() = 'sales'
    and exists (
      select 1
      from public.leads l
      where l.id = public.members.source_lead_id
        and l.created_by_user_id = public.current_profile_id()
    )
  )
);

create policy "members_insert"
on public.members
for insert
to authenticated
with check (
  public.current_role() in ('admin', 'manager', 'director', 'nurse', 'coordinator')
  or (
    public.current_role() = 'sales'
    and exists (
      select 1
      from public.leads l
      where l.id = source_lead_id
        and l.created_by_user_id = public.current_profile_id()
    )
  )
);

create policy "members_update"
on public.members
for update
to authenticated
using (
  public.current_role() in ('admin', 'manager', 'director', 'nurse', 'coordinator')
  or (
    public.current_role() = 'sales'
    and exists (
      select 1
      from public.leads l
      where l.id = public.members.source_lead_id
        and l.created_by_user_id = public.current_profile_id()
    )
  )
)
with check (
  public.current_role() in ('admin', 'manager', 'director', 'nurse', 'coordinator')
  or (
    public.current_role() = 'sales'
    and exists (
      select 1
      from public.leads l
      where l.id = source_lead_id
        and l.created_by_user_id = public.current_profile_id()
    )
  )
);

-- physician orders
drop policy if exists "physician_orders_select" on public.physician_orders;
drop policy if exists "physician_orders_insert" on public.physician_orders;
drop policy if exists "physician_orders_update" on public.physician_orders;

create policy "physician_orders_select"
on public.physician_orders
for select
to authenticated
using (public.current_role() in ('admin', 'manager', 'director', 'nurse'));

create policy "physician_orders_insert"
on public.physician_orders
for insert
to authenticated
with check (
  public.current_role() in ('admin', 'manager', 'director', 'nurse')
  and created_by_user_id = public.current_profile_id()
  and updated_by_user_id = public.current_profile_id()
);

create policy "physician_orders_update"
on public.physician_orders
for update
to authenticated
using (public.current_role() in ('admin', 'manager', 'director', 'nurse'))
with check (
  public.current_role() in ('admin', 'manager', 'director', 'nurse')
  and updated_by_user_id = public.current_profile_id()
);

-- member health profiles
drop policy if exists "member_health_profiles_select" on public.member_health_profiles;
drop policy if exists "member_health_profiles_insert" on public.member_health_profiles;
drop policy if exists "member_health_profiles_update" on public.member_health_profiles;

create policy "member_health_profiles_select"
on public.member_health_profiles
for select
to authenticated
using (public.current_role() in ('admin', 'manager', 'director', 'nurse', 'coordinator'));

create policy "member_health_profiles_insert"
on public.member_health_profiles
for insert
to authenticated
with check (
  public.current_role() in ('admin', 'nurse')
  and (
    updated_by_user_id is null
    or updated_by_user_id = public.current_profile_id()
  )
);

create policy "member_health_profiles_update"
on public.member_health_profiles
for update
to authenticated
using (public.current_role() in ('admin', 'nurse'))
with check (
  public.current_role() in ('admin', 'nurse')
  and (
    updated_by_user_id is null
    or updated_by_user_id = public.current_profile_id()
  )
);

-- care plans
drop policy if exists "care_plans_select" on public.care_plans;
drop policy if exists "care_plans_insert" on public.care_plans;
drop policy if exists "care_plans_update" on public.care_plans;

create policy "care_plans_select"
on public.care_plans
for select
to authenticated
using (public.current_role() in ('admin', 'manager', 'director', 'nurse'));

create policy "care_plans_insert"
on public.care_plans
for insert
to authenticated
with check (
  public.current_role() in ('admin', 'nurse')
  and created_by_user_id = public.current_profile_id()
  and updated_by_user_id = public.current_profile_id()
  and (
    nurse_designee_user_id is null
    or nurse_designee_user_id = public.current_profile_id()
    or public.current_role() = 'admin'
  )
);

create policy "care_plans_update"
on public.care_plans
for update
to authenticated
using (public.current_role() in ('admin', 'nurse'))
with check (
  public.current_role() in ('admin', 'nurse')
  and (
    updated_by_user_id is null
    or updated_by_user_id = public.current_profile_id()
  )
  and (
    nurse_designee_user_id is null
    or nurse_designee_user_id = public.current_profile_id()
    or public.current_role() = 'admin'
  )
);

-- member files
drop policy if exists "member_files_select" on public.member_files;
drop policy if exists "member_files_insert" on public.member_files;
drop policy if exists "member_files_update" on public.member_files;
drop policy if exists "member_files_delete" on public.member_files;

create policy "member_files_select"
on public.member_files
for select
to authenticated
using (
  public.current_role() in ('admin', 'manager', 'director', 'nurse', 'coordinator')
  or uploaded_by_user_id = public.current_profile_id()
);

create policy "member_files_insert"
on public.member_files
for insert
to authenticated
with check (
  public.current_role() in ('admin', 'manager', 'director', 'nurse')
  and uploaded_by_user_id = public.current_profile_id()
);

create policy "member_files_update"
on public.member_files
for update
to authenticated
using (
  public.current_role() in ('admin', 'director')
  or (
    public.current_role() in ('manager', 'nurse')
    and uploaded_by_user_id = public.current_profile_id()
  )
)
with check (
  public.current_role() in ('admin', 'director')
  or (
    public.current_role() in ('manager', 'nurse')
    and uploaded_by_user_id = public.current_profile_id()
  )
);

create policy "member_files_delete"
on public.member_files
for delete
to authenticated
using (
  public.current_role() in ('admin', 'director')
  or (
    public.current_role() in ('manager', 'nurse')
    and uploaded_by_user_id = public.current_profile_id()
  )
);

-- pof requests
drop policy if exists "pof_requests_select" on public.pof_requests;
drop policy if exists "pof_requests_insert" on public.pof_requests;
drop policy if exists "pof_requests_update" on public.pof_requests;

create policy "pof_requests_select"
on public.pof_requests
for select
to authenticated
using (
  public.current_role() in ('admin', 'manager', 'director', 'nurse')
  or sent_by_user_id = public.current_profile_id()
);

create policy "pof_requests_insert"
on public.pof_requests
for insert
to authenticated
with check (
  public.current_role() in ('admin', 'manager', 'director', 'nurse')
  and sent_by_user_id = public.current_profile_id()
  and created_by_user_id = public.current_profile_id()
  and updated_by_user_id = public.current_profile_id()
);

create policy "pof_requests_update"
on public.pof_requests
for update
to authenticated
using (
  public.current_role() in ('admin', 'manager', 'director', 'nurse')
  or sent_by_user_id = public.current_profile_id()
)
with check (
  (
    public.current_role() in ('admin', 'manager', 'director', 'nurse')
    or sent_by_user_id = public.current_profile_id()
  )
  and (
    updated_by_user_id is null
    or updated_by_user_id = public.current_profile_id()
  )
);

-- enrollment packet requests
drop policy if exists "enrollment_packet_requests_select" on public.enrollment_packet_requests;
drop policy if exists "enrollment_packet_requests_insert" on public.enrollment_packet_requests;
drop policy if exists "enrollment_packet_requests_update" on public.enrollment_packet_requests;

create policy "enrollment_packet_requests_select"
on public.enrollment_packet_requests
for select
to authenticated
using (
  public.current_role() in ('admin', 'manager', 'director')
  or sender_user_id = public.current_profile_id()
);

create policy "enrollment_packet_requests_insert"
on public.enrollment_packet_requests
for insert
to authenticated
with check (
  public.current_role() in ('admin', 'manager', 'director', 'sales')
  and sender_user_id = public.current_profile_id()
);

create policy "enrollment_packet_requests_update"
on public.enrollment_packet_requests
for update
to authenticated
using (
  public.current_role() in ('admin', 'manager', 'director')
  or sender_user_id = public.current_profile_id()
)
with check (
  public.current_role() in ('admin', 'manager', 'director')
  or (
    public.current_role() = 'sales'
    and sender_user_id = public.current_profile_id()
  )
);
