-- Canonical identity backfill:
-- 1) Fill missing members.source_lead_id where there is a unique, high-confidence name match.
-- 2) Propagate canonical lead_id into downstream records that already reference member_id.

with normalized_members as (
  select
    m.id as member_id,
    lower(trim(m.display_name)) as normalized_member_name
  from public.members m
  where m.source_lead_id is null
    and trim(coalesce(m.display_name, '')) <> ''
),
normalized_leads as (
  select
    l.id as lead_id,
    lower(trim(l.member_name)) as normalized_member_name
  from public.leads l
  where trim(coalesce(l.member_name, '')) <> ''
    and (
      coalesce(lower(trim(l.status::text)), '') = 'won'
      or coalesce(lower(trim(l.stage::text)), '') in ('closed - won', 'enrollment in progress')
    )
    and not exists (
      select 1
      from public.members existing
      where existing.source_lead_id = l.id
    )
),
unique_member_names as (
  select nm.normalized_member_name
  from normalized_members nm
  group by nm.normalized_member_name
  having count(*) = 1
),
unique_lead_names as (
  select nl.normalized_member_name
  from normalized_leads nl
  group by nl.normalized_member_name
  having count(*) = 1
),
candidate_links as (
  select
    nm.member_id,
    nl.lead_id
  from normalized_members nm
  join normalized_leads nl
    on nl.normalized_member_name = nm.normalized_member_name
  join unique_member_names um
    on um.normalized_member_name = nm.normalized_member_name
  join unique_lead_names ul
    on ul.normalized_member_name = nl.normalized_member_name
)
update public.members m
set source_lead_id = c.lead_id
from candidate_links c
where m.id = c.member_id
  and m.source_lead_id is null;

update public.intake_assessments ia
set lead_id = m.source_lead_id
from public.members m
where ia.member_id = m.id
  and ia.lead_id is null
  and m.source_lead_id is not null;

update public.enrollment_packet_requests epr
set lead_id = m.source_lead_id
from public.members m
where epr.member_id = m.id
  and epr.lead_id is null
  and m.source_lead_id is not null;
