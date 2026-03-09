insert into public.sites (site_code, site_name, latitude, longitude, fence_radius_meters)
values ('TSFM', 'Town Square Fort Mill', 34.9925600, -80.9629550, 75)
on conflict (site_code) do nothing;

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
