-- Workflow hardening guardrails for intake follow-up state and canonical uniqueness.
-- Preflight checks (run before production rollout if this migration raises):
-- 1) Duplicate members per lead
-- select source_lead_id, count(*) as member_count
-- from public.members
-- where source_lead_id is not null
-- group by source_lead_id
-- having count(*) > 1;
--
-- 2) Duplicate active enrollment packets
-- select member_id, count(*) as active_packet_count
-- from public.enrollment_packet_requests
-- where status in ('draft', 'prepared', 'sent', 'opened', 'partially_completed')
-- group by member_id
-- having count(*) > 1;
--
-- 3) Duplicate care-plan roots
-- select member_id, track, count(*) as root_count
-- from public.care_plans
-- group by member_id, track
-- having count(*) > 1;

alter table public.intake_assessments
  add column if not exists draft_pof_status text not null default 'pending'
    check (draft_pof_status in ('pending', 'created', 'failed')),
  add column if not exists draft_pof_attempted_at timestamptz,
  add column if not exists draft_pof_error text;

update public.intake_assessments as ia
set
  draft_pof_status = case
    when exists (
      select 1
      from public.physician_orders po
      where po.intake_assessment_id = ia.id
    ) then 'created'
    when coalesce(lower(ia.signature_status), '') = 'signed' then 'pending'
    else 'pending'
  end,
  draft_pof_attempted_at = case
    when exists (
      select 1
      from public.physician_orders po
      where po.intake_assessment_id = ia.id
    ) then coalesce(ia.signed_at, ia.updated_at, ia.created_at)
    else ia.draft_pof_attempted_at
  end,
  draft_pof_error = null
where ia.draft_pof_status is null
   or ia.draft_pof_status not in ('pending', 'created', 'failed');

do $$
begin
  if exists (
    select 1
    from public.members
    where source_lead_id is not null
    group by source_lead_id
    having count(*) > 1
  ) then
    raise exception 'Workflow hardening blocked: duplicate members.source_lead_id rows exist. Clean duplicates before applying 0049_workflow_hardening_constraints.sql.';
  end if;

  if exists (
    select 1
    from public.enrollment_packet_requests
    where status in ('draft', 'prepared', 'sent', 'opened', 'partially_completed')
    group by member_id
    having count(*) > 1
  ) then
    raise exception 'Workflow hardening blocked: duplicate active enrollment packets exist per member. Clean duplicates before applying 0049_workflow_hardening_constraints.sql.';
  end if;

  if exists (
    select 1
    from public.care_plans
    group by member_id, track
    having count(*) > 1
  ) then
    raise exception 'Workflow hardening blocked: duplicate care-plan roots exist per member/track. Clean duplicates before applying 0049_workflow_hardening_constraints.sql.';
  end if;
end;
$$;

create unique index if not exists idx_members_source_lead_id_unique
  on public.members (source_lead_id)
  where source_lead_id is not null;

create unique index if not exists idx_enrollment_packet_requests_active_member_unique
  on public.enrollment_packet_requests (member_id)
  where status in ('draft', 'prepared', 'sent', 'opened', 'partially_completed');

create unique index if not exists idx_care_plans_member_track_unique
  on public.care_plans (member_id, track);
