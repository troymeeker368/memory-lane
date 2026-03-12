alter table public.care_plans
  add column if not exists nurse_designee_user_id uuid references public.profiles(id) on delete set null,
  add column if not exists nurse_designee_name text,
  add column if not exists nurse_signed_at timestamptz,
  add column if not exists caregiver_name text,
  add column if not exists caregiver_email text,
  add column if not exists caregiver_signature_status text not null default 'not_requested',
  add column if not exists caregiver_sent_at timestamptz,
  add column if not exists caregiver_sent_by_user_id uuid references public.profiles(id) on delete set null,
  add column if not exists caregiver_viewed_at timestamptz,
  add column if not exists caregiver_signed_at timestamptz,
  add column if not exists caregiver_signature_request_token text,
  add column if not exists caregiver_signature_expires_at timestamptz,
  add column if not exists caregiver_signature_request_url text,
  add column if not exists caregiver_signed_name text,
  add column if not exists caregiver_signature_image_url text,
  add column if not exists caregiver_signature_ip text,
  add column if not exists caregiver_signature_user_agent text,
  add column if not exists caregiver_signature_error text,
  add column if not exists final_member_file_id text references public.member_files(id) on delete set null,
  add column if not exists legacy_cleanup_flag boolean not null default false;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'care_plans_caregiver_signature_status_check'
  ) then
    alter table public.care_plans
      add constraint care_plans_caregiver_signature_status_check
      check (
        caregiver_signature_status in (
          'not_requested',
          'ready_to_send',
          'send_failed',
          'sent',
          'viewed',
          'signed',
          'expired'
        )
      );
  end if;
end
$$;

create index if not exists idx_care_plans_nurse_designee on public.care_plans(nurse_designee_user_id);
create index if not exists idx_care_plans_caregiver_status on public.care_plans(caregiver_signature_status, caregiver_signed_at desc);
create unique index if not exists idx_care_plans_caregiver_token
  on public.care_plans(caregiver_signature_request_token)
  where caregiver_signature_request_token is not null;

alter table public.member_files
  add column if not exists care_plan_id uuid references public.care_plans(id) on delete set null;

create index if not exists idx_member_files_care_plan on public.member_files(care_plan_id);

create table if not exists public.care_plan_signature_events (
  id uuid primary key default gen_random_uuid(),
  care_plan_id uuid not null references public.care_plans(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  event_type text not null check (event_type in ('sent', 'send_failed', 'opened', 'signed', 'expired')),
  actor_type text not null check (actor_type in ('user', 'caregiver', 'system')),
  actor_user_id uuid references public.profiles(id) on delete set null,
  actor_name text,
  actor_email text,
  actor_ip text,
  actor_user_agent text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_care_plan_signature_events_plan_created
  on public.care_plan_signature_events(care_plan_id, created_at asc);

create index if not exists idx_care_plan_signature_events_member_created
  on public.care_plan_signature_events(member_id, created_at desc);

alter table public.care_plan_signature_events enable row level security;

drop policy if exists "care_plan_signature_events_select" on public.care_plan_signature_events;
drop policy if exists "care_plan_signature_events_insert" on public.care_plan_signature_events;
create policy "care_plan_signature_events_select"
  on public.care_plan_signature_events
  for select to authenticated
  using (true);
create policy "care_plan_signature_events_insert"
  on public.care_plan_signature_events
  for insert to authenticated
  with check (true);

with resolved_designee as (
  select
    cp.id,
    candidate.id as designee_user_id,
    candidate.full_name as designee_name
  from public.care_plans cp
  left join lateral (
    select p.id, p.full_name
    from public.profiles p
    where p.id in (cp.nurse_designee_user_id, cp.created_by_user_id, cp.updated_by_user_id)
      and p.role in ('admin', 'nurse')
      and coalesce(p.active, true) = true
    order by
      case
        when p.id = cp.nurse_designee_user_id then 1
        when p.id = cp.created_by_user_id then 2
        else 3
      end
    limit 1
  ) candidate on true
)
update public.care_plans cp
set
  nurse_designee_user_id = rd.designee_user_id,
  nurse_designee_name = coalesce(rd.designee_name, cp.nurse_designee_name, cp.administrator_signature, cp.completed_by),
  nurse_signed_at = coalesce(
    cp.nurse_signed_at,
    case
      when cp.administrator_signature_date is not null then (cp.administrator_signature_date::text || 'T12:00:00.000Z')::timestamptz
      when cp.date_of_completion is not null then (cp.date_of_completion::text || 'T12:00:00.000Z')::timestamptz
      else null
    end
  ),
  caregiver_name = coalesce(cp.caregiver_name, nullif(cp.responsible_party_signature, '')),
  caregiver_email = nullif(lower(btrim(coalesce(cp.caregiver_email, ''))), ''),
  caregiver_signed_name = coalesce(cp.caregiver_signed_name, nullif(cp.responsible_party_signature, '')),
  caregiver_signed_at = coalesce(
    cp.caregiver_signed_at,
    case
      when cp.responsible_party_signature_date is not null then (cp.responsible_party_signature_date::text || 'T12:00:00.000Z')::timestamptz
      else null
    end
  ),
  caregiver_signature_status = case
    when coalesce(cp.caregiver_signed_at, case when cp.responsible_party_signature_date is not null then (cp.responsible_party_signature_date::text || 'T12:00:00.000Z')::timestamptz else null end) is not null then 'signed'
    when cp.caregiver_signature_status in ('ready_to_send', 'send_failed', 'sent', 'viewed', 'expired') then cp.caregiver_signature_status
    when cp.nurse_signed_at is not null then 'ready_to_send'
    else 'not_requested'
  end,
  legacy_cleanup_flag = rd.designee_user_id is null
from resolved_designee rd
where cp.id = rd.id;

with canonical_sections(track, section_type, short_term_goals, long_term_goals, display_order) as (
  values
    ('Track 1', 'Activities of Daily Living (ADLs) Assistance', 'Member will complete daily self-care tasks (dressing, grooming, toileting) independently with minimal reminders.' || E'\n' || 'Member will participate in light physical activity on most program days to support mobility, as tolerated.', 'Member will maintain independence in ADLs with occasional prompts as needed.' || E'\n' || 'Member will follow a consistent daily routine that supports comfort and participation.', 1),
    ('Track 1', 'Cognitive & Memory Support', 'Member will participate in structured memory activities (puzzles, word games) at least once weekly.' || E'\n' || 'Member will use memory aids (calendar, whiteboard, labeled objects) for orientation on program days.', 'Member will continue to participate actively in memory and orientation activities.' || E'\n' || 'Member will engage in reminiscence activities (storytelling, group discussions) at least monthly to support identity and confidence.', 2),
    ('Track 1', 'Socialization & Emotional Well-Being', 'Member will attend at least one group activity per week to strengthen social connections.' || E'\n' || 'Member will engage in a preferred hobby or creative activity at least twice per month.', 'Member will maintain friendships within the center community and participate in discussions regularly.' || E'\n' || 'Member will demonstrate consistent positive social engagement to prevent isolation.', 3),
    ('Track 1', 'Safety & Fall Prevention', 'Member will use safe mobility practices (assistive devices if applicable) during program attendance.' || E'\n' || 'Staff will maintain an environment free of tripping hazards.', 'Member will maintain steady mobility and independence in movement.' || E'\n' || 'Member will continue strength and stability activities regularly to reduce fall risk.', 4),
    ('Track 1', 'Medical & Medication Management', 'Member will demonstrate awareness of medication schedule with minimal reminders as appropriate, with nurse oversight.' || E'\n' || 'Member will attend routine health check-ups as scheduled or as warranted.', 'Member will maintain stable health through consistent medication use and wellness monitoring.' || E'\n' || 'Member will demonstrate continued independence in medication management where appropriate.', 5),
    ('Track 2', 'Activities of Daily Living (ADLs) Assistance', 'Member will complete self-care tasks (dressing, grooming, toileting) with verbal or visual prompts as needed.' || E'\n' || 'Member will participate in structured light physical activity on program days to support mobility.', 'Member will maintain independence in personal care tasks with structured assistance.' || E'\n' || 'Member will demonstrate reduced frustration and greater comfort with ADLs through familiar routines.', 1),
    ('Track 2', 'Cognitive & Memory Support', 'Member will engage in simplified memory or cognitive activities at least once weekly with staff support.' || E'\n' || 'Member will use orientation supports (visual aids, daily reminders) during program attendance.', 'Member will maintain participation in familiar activities that promote memory and confidence.' || E'\n' || 'Member will respond positively to structured prompts that encourage recall and orientation.', 2),
    ('Track 2', 'Socialization & Emotional Well-Being', 'Member will participate in small group activities with staff guidance at least weekly.' || E'\n' || 'Member will engage in a familiar hobby or simple creative project at least monthly.', 'Member will maintain regular socialization through structured, staff-supported interactions.' || E'\n' || 'Member will demonstrate increased comfort and reduced isolation through ongoing engagement.', 3),
    ('Track 2', 'Safety & Fall Prevention', 'Member will use safe mobility practices with staff supervision during transitions.' || E'\n' || 'Member will participate in scheduled walking or movement activities to support stability.', 'Member will maintain mobility and safe movement patterns with ongoing staff support.' || E'\n' || 'Member will reduce fall risk by participating in balance and stability activities regularly.', 4),
    ('Track 2', 'Medical & Medication Management', 'Member will adhere to medication schedule with nurse-directed assistance.' || E'\n' || 'Member will be monitored for changes in health status, and concerns will be communicated promptly.', 'Member will maintain stable health through consistent medication and wellness tracking.' || E'\n' || 'Member will continue to access appropriate healthcare services and provider follow-up as needed.', 5),
    ('Track 3', 'Activities of Daily Living (ADLs) Assistance', 'Member will participate in daily self-care routines with frequent verbal prompts and partial assistance as needed.' || E'\n' || 'Member will demonstrate reduced frustration during grooming, dressing, and toileting when steps are simplified.', 'Member will continue to engage in basic self-care tasks with structured support.' || E'\n' || 'Member will maintain comfort and dignity through a predictable ADL routine.', 1),
    ('Track 3', 'Cognitive & Memory Support', 'Member will engage in simplified cognitive or sensory activities (music, photos, familiar objects) at least weekly.' || E'\n' || 'Member will respond to orientation cues (gentle reminders, familiar prompts) during program days.', 'Member will maintain participation in familiar or sensory-based activities that support confidence and emotional well-being.' || E'\n' || 'Member will demonstrate reduced distress through structured, supportive approaches to recall and engagement.', 2),
    ('Track 3', 'Socialization & Emotional Well-Being', 'Member will participate in one-on-one or small group activities with staff support at least weekly.' || E'\n' || 'Member will demonstrate comfort in social settings through positive engagement (smiling, responding, or joining in).', 'Member will sustain meaningful social interaction with peers or staff through guided participation.' || E'\n' || 'Member will demonstrate improved emotional comfort through ongoing social engagement.', 3),
    ('Track 3', 'Safety & Fall Prevention', 'Member will complete mobility transitions (e.g., sitting to standing) safely with staff supervision.' || E'\n' || 'Member will participate in movement or walking breaks to support stability.', 'Member will maintain safe mobility patterns with continued supervision and environmental support.' || E'\n' || 'Member will reduce fall risk through consistent staff assistance and structured movement activities.', 4),
    ('Track 3', 'Medical & Medication Management', 'Member will receive medication with direct staff assistance to ensure accuracy.' || E'\n' || 'Member will be monitored for changes in comfort, pain, or health status during program attendance.', 'Member will maintain stable health with ongoing supervision of medications and wellness needs.' || E'\n' || 'Member will prevent unnecessary complications through proactive communication with caregivers and providers.', 5)
),
section_updates as (
  select
    cps.id as section_id,
    cs.short_term_goals,
    cs.long_term_goals,
    cs.display_order
  from public.care_plan_sections cps
  join public.care_plans cp on cp.id = cps.care_plan_id
  join canonical_sections cs
    on cs.track = cp.track
   and cs.section_type = cps.section_type
)
update public.care_plan_sections cps
set
  short_term_goals = su.short_term_goals,
  long_term_goals = su.long_term_goals,
  display_order = su.display_order,
  updated_at = now()
from section_updates su
where cps.id = su.section_id;

with canonical_sections(track, section_type, short_term_goals, long_term_goals, display_order) as (
  values
    ('Track 1', 'Activities of Daily Living (ADLs) Assistance', 'Member will complete daily self-care tasks (dressing, grooming, toileting) independently with minimal reminders.' || E'\n' || 'Member will participate in light physical activity on most program days to support mobility, as tolerated.', 'Member will maintain independence in ADLs with occasional prompts as needed.' || E'\n' || 'Member will follow a consistent daily routine that supports comfort and participation.', 1),
    ('Track 1', 'Cognitive & Memory Support', 'Member will participate in structured memory activities (puzzles, word games) at least once weekly.' || E'\n' || 'Member will use memory aids (calendar, whiteboard, labeled objects) for orientation on program days.', 'Member will continue to participate actively in memory and orientation activities.' || E'\n' || 'Member will engage in reminiscence activities (storytelling, group discussions) at least monthly to support identity and confidence.', 2),
    ('Track 1', 'Socialization & Emotional Well-Being', 'Member will attend at least one group activity per week to strengthen social connections.' || E'\n' || 'Member will engage in a preferred hobby or creative activity at least twice per month.', 'Member will maintain friendships within the center community and participate in discussions regularly.' || E'\n' || 'Member will demonstrate consistent positive social engagement to prevent isolation.', 3),
    ('Track 1', 'Safety & Fall Prevention', 'Member will use safe mobility practices (assistive devices if applicable) during program attendance.' || E'\n' || 'Staff will maintain an environment free of tripping hazards.', 'Member will maintain steady mobility and independence in movement.' || E'\n' || 'Member will continue strength and stability activities regularly to reduce fall risk.', 4),
    ('Track 1', 'Medical & Medication Management', 'Member will demonstrate awareness of medication schedule with minimal reminders as appropriate, with nurse oversight.' || E'\n' || 'Member will attend routine health check-ups as scheduled or as warranted.', 'Member will maintain stable health through consistent medication use and wellness monitoring.' || E'\n' || 'Member will demonstrate continued independence in medication management where appropriate.', 5),
    ('Track 2', 'Activities of Daily Living (ADLs) Assistance', 'Member will complete self-care tasks (dressing, grooming, toileting) with verbal or visual prompts as needed.' || E'\n' || 'Member will participate in structured light physical activity on program days to support mobility.', 'Member will maintain independence in personal care tasks with structured assistance.' || E'\n' || 'Member will demonstrate reduced frustration and greater comfort with ADLs through familiar routines.', 1),
    ('Track 2', 'Cognitive & Memory Support', 'Member will engage in simplified memory or cognitive activities at least once weekly with staff support.' || E'\n' || 'Member will use orientation supports (visual aids, daily reminders) during program attendance.', 'Member will maintain participation in familiar activities that promote memory and confidence.' || E'\n' || 'Member will respond positively to structured prompts that encourage recall and orientation.', 2),
    ('Track 2', 'Socialization & Emotional Well-Being', 'Member will participate in small group activities with staff guidance at least weekly.' || E'\n' || 'Member will engage in a familiar hobby or simple creative project at least monthly.', 'Member will maintain regular socialization through structured, staff-supported interactions.' || E'\n' || 'Member will demonstrate increased comfort and reduced isolation through ongoing engagement.', 3),
    ('Track 2', 'Safety & Fall Prevention', 'Member will use safe mobility practices with staff supervision during transitions.' || E'\n' || 'Member will participate in scheduled walking or movement activities to support stability.', 'Member will maintain mobility and safe movement patterns with ongoing staff support.' || E'\n' || 'Member will reduce fall risk by participating in balance and stability activities regularly.', 4),
    ('Track 2', 'Medical & Medication Management', 'Member will adhere to medication schedule with nurse-directed assistance.' || E'\n' || 'Member will be monitored for changes in health status, and concerns will be communicated promptly.', 'Member will maintain stable health through consistent medication and wellness tracking.' || E'\n' || 'Member will continue to access appropriate healthcare services and provider follow-up as needed.', 5),
    ('Track 3', 'Activities of Daily Living (ADLs) Assistance', 'Member will participate in daily self-care routines with frequent verbal prompts and partial assistance as needed.' || E'\n' || 'Member will demonstrate reduced frustration during grooming, dressing, and toileting when steps are simplified.', 'Member will continue to engage in basic self-care tasks with structured support.' || E'\n' || 'Member will maintain comfort and dignity through a predictable ADL routine.', 1),
    ('Track 3', 'Cognitive & Memory Support', 'Member will engage in simplified cognitive or sensory activities (music, photos, familiar objects) at least weekly.' || E'\n' || 'Member will respond to orientation cues (gentle reminders, familiar prompts) during program days.', 'Member will maintain participation in familiar or sensory-based activities that support confidence and emotional well-being.' || E'\n' || 'Member will demonstrate reduced distress through structured, supportive approaches to recall and engagement.', 2),
    ('Track 3', 'Socialization & Emotional Well-Being', 'Member will participate in one-on-one or small group activities with staff support at least weekly.' || E'\n' || 'Member will demonstrate comfort in social settings through positive engagement (smiling, responding, or joining in).', 'Member will sustain meaningful social interaction with peers or staff through guided participation.' || E'\n' || 'Member will demonstrate improved emotional comfort through ongoing social engagement.', 3),
    ('Track 3', 'Safety & Fall Prevention', 'Member will complete mobility transitions (e.g., sitting to standing) safely with staff supervision.' || E'\n' || 'Member will participate in movement or walking breaks to support stability.', 'Member will maintain safe mobility patterns with continued supervision and environmental support.' || E'\n' || 'Member will reduce fall risk through consistent staff assistance and structured movement activities.', 4),
    ('Track 3', 'Medical & Medication Management', 'Member will receive medication with direct staff assistance to ensure accuracy.' || E'\n' || 'Member will be monitored for changes in comfort, pain, or health status during program attendance.', 'Member will maintain stable health with ongoing supervision of medications and wellness needs.' || E'\n' || 'Member will prevent unnecessary complications through proactive communication with caregivers and providers.', 5)
),
snapshots as (
  select
    cp.id as care_plan_id,
    jsonb_agg(
      jsonb_build_object(
        'sectionType', cs.section_type,
        'shortTermGoals', cs.short_term_goals,
        'longTermGoals', cs.long_term_goals,
        'displayOrder', cs.display_order
      )
      order by cs.display_order
    ) as section_snapshot
  from public.care_plans cp
  join canonical_sections cs on cs.track = cp.track
  group by cp.id
)
update public.care_plan_versions cpv
set sections_snapshot = snapshots.section_snapshot
from snapshots
where cpv.care_plan_id = snapshots.care_plan_id;
