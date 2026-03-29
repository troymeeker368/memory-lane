insert into public.sites (site_code, site_name, latitude, longitude, fence_radius_meters)
values ('TSFM', 'Town Square Fort Mill', 34.9925600, -80.9629550, 75)
on conflict (site_code) do nothing;
insert into public.roles (key, name, rank, is_system_role)
values
  ('program-assistant', 'Program Assistant', 1, true),
  ('coordinator', 'Coordinator', 2, true),
  ('nurse', 'Nurse', 3, true),
  ('sales', 'Sales', 4, true),
  ('manager', 'Manager', 5, true),
  ('director', 'Director', 6, true),
  ('admin', 'Admin', 7, true)
on conflict (key) do update set
  name = excluded.name,
  rank = excluded.rank,
  is_system_role = excluded.is_system_role;

with module_defaults as (
  select *
  from (values
    ('program-assistant','documentation', true,  true,  true,  false),
    ('program-assistant','operations',     false, false, false, false),
    ('program-assistant','reports',        false, false, false, false),
    ('program-assistant','time-hr',        true,  true,  true,  false),
    ('program-assistant','sales-activities',false,false, false, false),
    ('program-assistant','health-unit',    false, false, false, false),
    ('program-assistant','admin-reports',  false, false, false, false),
    ('program-assistant','user-management',false, false, false, false),

    ('coordinator','documentation', true,  true,  true,  false),
    ('coordinator','operations',    true,  true,  true,  false),
    ('coordinator','reports',       true,  false, false, false),
    ('coordinator','time-hr',       true,  true,  true,  false),
    ('coordinator','sales-activities',false,false, false, false),
    ('coordinator','health-unit',   true,  false, false, false),
    ('coordinator','admin-reports', false, false, false, false),
    ('coordinator','user-management',false,false, false, false),

    ('nurse','documentation', true,  true,  true,  false),
    ('nurse','operations',    true,  false, true,  false),
    ('nurse','reports',       true,  false, false, false),
    ('nurse','time-hr',       true,  true,  true,  false),
    ('nurse','sales-activities',false,false, false, false),
    ('nurse','health-unit',   true,  true,  true,  false),
    ('nurse','admin-reports', false, false, false, false),
    ('nurse','user-management',false,false, false, false),

    ('sales','documentation', false, false, false, false),
    ('sales','operations',    false, false, false, false),
    ('sales','reports',       true,  false, false, false),
    ('sales','time-hr',       true,  true,  true,  false),
    ('sales','sales-activities',true,true, true,  false),
    ('sales','health-unit',   false, false, false, false),
    ('sales','admin-reports', false, false, false, false),
    ('sales','user-management',false,false, false, false),

    ('manager','documentation', true,  true,  true,  false),
    ('manager','operations',    true,  true,  true,  false),
    ('manager','reports',       true,  true,  true,  false),
    ('manager','time-hr',       true,  true,  true,  false),
    ('manager','sales-activities',true,false, false, false),
    ('manager','health-unit',   true,  false, false, false),
    ('manager','admin-reports', true,  false, false, false),
    ('manager','user-management',false,false, false, false),

    ('director','documentation', true,  true,  true,  false),
    ('director','operations',    true,  true,  true,  false),
    ('director','reports',       true,  true,  true,  false),
    ('director','time-hr',       true,  true,  true,  false),
    ('director','sales-activities',true,true, true,  false),
    ('director','health-unit',   true,  true,  true,  false),
    ('director','admin-reports', true,  true,  true,  false),
    ('director','user-management',false, false, false, false),

    ('admin','documentation', true,  true,  true,  true),
    ('admin','operations',    true,  true,  true,  true),
    ('admin','reports',       true,  true,  true,  true),
    ('admin','time-hr',       true,  true,  true,  true),
    ('admin','sales-activities',true,true, true,  true),
    ('admin','health-unit',   true,  true,  true,  true),
    ('admin','admin-reports', true,  true,  true,  true),
    ('admin','user-management',true, true,  true,  true)
  ) as x(role_key, module_key, can_view, can_create, can_edit, can_admin)
)
insert into public.role_permissions (role_id, module_key, can_view, can_create, can_edit, can_admin)
select r.id, m.module_key, m.can_view, m.can_create, m.can_edit, m.can_admin
from module_defaults m
join public.roles r on r.key = m.role_key
on conflict (role_id, module_key) do update set
  can_view = excluded.can_view,
  can_create = excluded.can_create,
  can_edit = excluded.can_edit,
  can_admin = excluded.can_admin;


update public.profiles p
set role_id = r.id
from public.roles r
where r.key = case p.role::text
  when 'staff' then 'program-assistant'
  else p.role::text
end;

insert into public.members (display_name, status, qr_code)
values
  ('Jean Carter', 'active', '10103020241016220537'),
  ('Martha Diaz', 'active', '10101720241243070531'),
  ('George Meeker', 'active', '10101020241243123456'),
  ('Brian Phillips', 'active', '10101020241243123457')
on conflict do nothing;

insert into public.ancillary_charge_categories (name, price_cents)
values
  ('Laundry', 1200),
  ('Late Pickup', 2500),
  ('Special Supplies', 800)
on conflict (name) do update set price_cents = excluded.price_cents;

insert into public.operations_settings (
  id,
  bus_numbers,
  makeup_policy,
  late_pickup_grace_start_time,
  late_pickup_first_window_minutes,
  late_pickup_first_window_fee_cents,
  late_pickup_additional_per_minute_cents,
  late_pickup_additional_minutes_cap
)
values (
  'default',
  array['1', '2', '3']::text[],
  'rolling_30_day_expiration',
  '16:30',
  15,
  2500,
  200,
  30
)
on conflict (id) do update set
  late_pickup_grace_start_time = excluded.late_pickup_grace_start_time,
  late_pickup_first_window_minutes = excluded.late_pickup_first_window_minutes,
  late_pickup_first_window_fee_cents = excluded.late_pickup_first_window_fee_cents,
  late_pickup_additional_per_minute_cents = excluded.late_pickup_additional_per_minute_cents,
  late_pickup_additional_minutes_cap = excluded.late_pickup_additional_minutes_cap;

insert into public.lookup_lists (list_name, value, sort_order)
values
  ('lead_stage', 'Inquiry', 1),
  ('lead_stage', 'Tour', 2),
  ('lead_stage', 'Enrollment in Progress', 3),
  ('lead_stage', 'Closed - Enrolled', 4),
  ('lead_stage', 'Closed - Lost', 5),
  ('lead_source', 'Referral', 1),
  ('lead_source', 'Website', 2),
  ('lead_source', 'Social media', 3),
  ('lead_source', 'Walk-in', 4),
  ('lead_source', 'Word of mouth', 5),
  ('follow_up_type', 'Call', 1),
  ('follow_up_type', 'Text', 2),
  ('follow_up_type', 'Email', 3),
  ('follow_up_type', 'Tour', 4)
on conflict (list_name, value) do nothing;

insert into public.community_partner_organizations (organization_name, category, location, primary_phone, primary_email, active)
values
  ('Encompass Health Rehabilitation Hospital of Fort Mill', 'Senior Care', 'SC-Fort Mill', '839-400-2400', 'contact@encompasshealth.com', true),
  ('Memory and Movement', 'Senior Care', 'NC-Charlotte', '704-577-3186', 'hello@mmclt.org', true)
on conflict do nothing;

insert into public.referral_sources (partner_id, contact_name, organization_name, job_title, primary_phone, primary_email, active)
select id, 'Mellen Shugart', organization_name, 'Case Manager', '839-400-2400', 'mellen.shugart@encompasshealth.com', true
from public.community_partner_organizations where organization_name = 'Encompass Health Rehabilitation Hospital of Fort Mill'
on conflict do nothing;

with any_staff as (
  select id, full_name from public.profiles where active = true order by role limit 1
),
member_rows as (
  select id, display_name from public.members where status = 'active'
)
insert into public.documentation_tracker (
  member_id,
  member_name,
  start_date,
  last_care_plan_update,
  next_care_plan_due,
  care_plan_done,
  last_progress_note,
  next_progress_note_due,
  note_done,
  assigned_staff_user_id,
  assigned_staff_name
)
select
  m.id,
  m.display_name,
  current_date - 180,
  current_date - 20,
  current_date + 160,
  true,
  current_date - 15,
  current_date + 75,
  true,
  s.id,
  s.full_name
from member_rows m
cross join any_staff s
on conflict do nothing;

with actor as (
  select id, full_name from public.profiles where role in ('admin', 'manager') and active = true limit 1
),
member_ref as (
  select display_name from public.members limit 2
)
insert into public.leads (
  status,
  stage,
  inquiry_date,
  caregiver_name,
  caregiver_relationship,
  caregiver_email,
  caregiver_phone,
  member_name,
  lead_source,
  likelihood,
  next_follow_up_date,
  next_follow_up_type,
  notes_summary,
  created_by_user_id
)
select
  'open',
  'Inquiry',
  current_date,
  'Example Caregiver',
  'Daughter',
  'caregiver@example.com',
  '8035551234',
  m.display_name,
  'Referral',
  'Warm',
  current_date + 1,
  'Call',
  'Wants care during weekdays.',
  a.id
from actor a
cross join member_ref m
on conflict do nothing;

with actor as (
  select id, full_name from public.profiles where role in ('admin', 'manager') and active = true limit 1
),
lead_ref as (
  select id, member_name from public.leads order by created_at desc limit 1
)
insert into public.lead_activities (
  lead_id,
  member_name,
  activity_at,
  activity_type,
  outcome,
  notes,
  next_follow_up_date,
  next_follow_up_type,
  completed_by_user_id,
  completed_by_name
)
select
  l.id,
  l.member_name,
  now(),
  'Call',
  'Spoke with caregiver',
  'Scheduled tour for next week',
  current_date + 2,
  'Tour',
  a.id,
  a.full_name
from actor a
cross join lead_ref l
on conflict do nothing;
