create table if not exists public.intake_post_sign_follow_up_queue (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.intake_assessments(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  task_type text not null,
  status text not null default 'action_required',
  title text not null,
  message text not null,
  action_url text not null,
  attempt_count integer not null default 0,
  last_error text,
  last_attempted_at timestamptz,
  resolved_at timestamptz,
  created_by_user_id uuid references public.profiles(id) on delete set null,
  created_by_name text,
  updated_by_user_id uuid references public.profiles(id) on delete set null,
  updated_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint intake_post_sign_follow_up_queue_task_type_check
    check (task_type in ('draft_pof_creation', 'member_file_pdf_persistence')),
  constraint intake_post_sign_follow_up_queue_status_check
    check (status in ('action_required', 'completed')),
  constraint intake_post_sign_follow_up_queue_attempt_count_check
    check (attempt_count >= 0),
  constraint intake_post_sign_follow_up_queue_assessment_task_unique
    unique (assessment_id, task_type)
);

create index if not exists idx_intake_post_sign_follow_up_queue_status_updated
  on public.intake_post_sign_follow_up_queue(status, updated_at desc);

create index if not exists idx_intake_post_sign_follow_up_queue_assessment_status
  on public.intake_post_sign_follow_up_queue(assessment_id, status, updated_at desc);

drop trigger if exists trg_intake_post_sign_follow_up_queue_updated on public.intake_post_sign_follow_up_queue;
create trigger trg_intake_post_sign_follow_up_queue_updated
before update on public.intake_post_sign_follow_up_queue
for each row execute function public.set_updated_at();

alter table public.intake_post_sign_follow_up_queue enable row level security;

drop policy if exists "intake_post_sign_follow_up_queue_read_internal" on public.intake_post_sign_follow_up_queue;
drop policy if exists "intake_post_sign_follow_up_queue_service_insert" on public.intake_post_sign_follow_up_queue;
drop policy if exists "intake_post_sign_follow_up_queue_service_update" on public.intake_post_sign_follow_up_queue;

create policy "intake_post_sign_follow_up_queue_read_internal"
on public.intake_post_sign_follow_up_queue
for select
to authenticated
using (public.current_role() in ('admin', 'manager', 'director', 'nurse'));

create policy "intake_post_sign_follow_up_queue_service_insert"
on public.intake_post_sign_follow_up_queue
for insert
to service_role
with check (true);

create policy "intake_post_sign_follow_up_queue_service_update"
on public.intake_post_sign_follow_up_queue
for update
to service_role
using (true)
with check (true);

create or replace function public.convert_enrollment_packet_to_member(
  p_packet_id uuid,
  p_member_id uuid,
  p_actor_user_id uuid,
  p_actor_name text,
  p_actor_email text default null,
  p_started_at timestamptz default now(),
  p_member_patch jsonb default '{}'::jsonb,
  p_mcc_patch jsonb default '{}'::jsonb,
  p_attendance_patch jsonb default '{}'::jsonb,
  p_contacts jsonb default '[]'::jsonb,
  p_mhp_patch jsonb default '{}'::jsonb,
  p_pof_stage_payload jsonb default '{}'::jsonb,
  p_record_rows jsonb default '[]'::jsonb,
  p_summary jsonb default '{}'::jsonb
)
returns table (
  packet_id uuid,
  member_id uuid,
  lead_id uuid,
  conversion_status text,
  mapping_run_id uuid,
  systems jsonb,
  downstream_systems_updated text[],
  conflicts_requiring_review integer,
  records_persisted integer,
  conflict_ids uuid[],
  entity_references jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.enrollment_packet_requests%rowtype;
  v_summary jsonb := coalesce(p_summary, '{}'::jsonb);
  v_existing_summary jsonb := '{}'::jsonb;
  v_mapping_run_id uuid;
  v_completed_at timestamptz := now();
  v_records_persisted integer := jsonb_array_length(coalesce(p_record_rows, '[]'::jsonb));
  v_conflict_ids uuid[] := array[]::uuid[];
  v_contact jsonb;
  v_existing_contact_id text;
  v_resolved_contact_id text;
  v_payor_contact_id text := null;
  v_created_contact_ids text[] := array[]::text[];
  v_contact_ids text[] := array[]::text[];
  v_member_file_ids text[] := array[]::text[];
  v_mcc_id text;
  v_attendance_id text;
  v_mhp_id uuid;
  v_pof_stage_id uuid;
  v_systems jsonb := '{}'::jsonb;
  v_downstream_systems_updated text[] := array[]::text[];
  v_conflicts_requiring_review integer := 0;
  v_entity_references jsonb := '{}'::jsonb;
begin
  if p_packet_id is null then
    raise exception 'convert_enrollment_packet_to_member requires p_packet_id';
  end if;
  if p_member_id is null then
    raise exception 'convert_enrollment_packet_to_member requires p_member_id';
  end if;

  select *
  into v_request
  from public.enrollment_packet_requests
  where id = p_packet_id
  for update;

  if not found then
    raise exception 'Enrollment packet request % was not found.', p_packet_id;
  end if;
  if v_request.member_id <> p_member_id then
    raise exception 'Enrollment packet request % does not belong to member %.', p_packet_id, p_member_id;
  end if;
  if coalesce(v_request.status, '') not in ('filed', 'completed') then
    raise exception 'Enrollment packet request % must be filed before downstream conversion.', p_packet_id;
  end if;

  perform 1
  from public.members
  where id = p_member_id
  for update;
  if not found then
    raise exception 'Member % was not found for enrollment conversion.', p_member_id;
  end if;

  if coalesce(v_request.mapping_sync_status, '') = 'completed' and v_request.latest_mapping_run_id is not null then
    select coalesce(epmr.summary, '{}'::jsonb)
    into v_existing_summary
    from public.enrollment_packet_mapping_runs as epmr
    where epmr.id = v_request.latest_mapping_run_id;

    select mcc.id into v_mcc_id from public.member_command_centers as mcc where mcc.member_id = p_member_id;
    select mas.id into v_attendance_id from public.member_attendance_schedules as mas where mas.member_id = p_member_id;
    select mhp.id into v_mhp_id from public.member_health_profiles as mhp where mhp.member_id = p_member_id;
    select epps.id into v_pof_stage_id from public.enrollment_packet_pof_staging as epps where epps.packet_id = p_packet_id;
    select coalesce(array_agg(mc.id order by mc.updated_at desc), array[]::text[]) into v_contact_ids
    from public.member_contacts as mc
    where mc.member_id = p_member_id
      and lower(btrim(mc.category)) in ('responsible party', 'emergency contact');
    select coalesce(array_agg(epu.member_file_id order by epu.uploaded_at asc), array[]::text[]) into v_member_file_ids
    from public.enrollment_packet_uploads as epu
    where epu.packet_id = p_packet_id
      and epu.member_file_id is not null;

    v_systems := coalesce(v_existing_summary -> 'systems', '{}'::jsonb);
    v_downstream_systems_updated := array(
      select jsonb_array_elements_text(coalesce(v_existing_summary -> 'downstreamSystemsUpdated', '[]'::jsonb))
    );
    v_conflicts_requiring_review := coalesce(nullif(v_existing_summary ->> 'conflictsRequiringReview', '')::integer, 0);
    v_records_persisted := coalesce(nullif(v_existing_summary ->> 'recordsPersisted', '')::integer, 0);
    v_conflict_ids := array(
      select value::uuid
      from jsonb_array_elements_text(coalesce(v_existing_summary -> 'conflictIds', '[]'::jsonb)) value
    );
    v_entity_references := jsonb_build_object(
      'memberId', p_member_id,
      'leadId', v_request.lead_id,
      'mccProfileId', v_mcc_id,
      'attendanceScheduleId', v_attendance_id,
      'memberHealthProfileId', v_mhp_id,
      'pofStagingId', v_pof_stage_id,
      'contactIds', to_jsonb(v_contact_ids),
      'createdContactIds', to_jsonb(array[]::text[]),
      'memberFileIds', to_jsonb(v_member_file_ids)
    );

    return query
    select
      v_request.id,
      p_member_id,
      v_request.lead_id,
      'already_completed',
      v_request.latest_mapping_run_id,
      v_systems,
      v_downstream_systems_updated,
      v_conflicts_requiring_review,
      v_records_persisted,
      v_conflict_ids,
      v_entity_references;
    return;
  end if;

  insert into public.enrollment_packet_mapping_runs (
    packet_id,
    member_id,
    actor_user_id,
    actor_email,
    actor_name,
    status,
    summary,
    started_at
  )
  values (
    p_packet_id,
    p_member_id,
    p_actor_user_id,
    nullif(trim(coalesce(p_actor_email, '')), ''),
    nullif(trim(coalesce(p_actor_name, '')), ''),
    'running',
    '{}'::jsonb,
    coalesce(p_started_at, now())
  )
  returning id into v_mapping_run_id;

  insert into public.member_command_centers (
    id,
    member_id,
    primary_language,
    diet_type,
    diet_texture,
    updated_by_user_id,
    updated_by_name,
    created_at,
    updated_at
  )
  values (
    'mcc-' || p_member_id::text,
    p_member_id,
    'English',
    'Regular',
    'Regular',
    p_actor_user_id,
    nullif(trim(coalesce(p_actor_name, '')), ''),
    coalesce(p_started_at, now()),
    coalesce(p_started_at, now())
  )
  on conflict on constraint member_command_centers_member_id_key do nothing;

  insert into public.member_attendance_schedules (
    id,
    member_id,
    enrollment_date,
    full_day,
    transportation_billing_status,
    billing_rate_effective_date,
    updated_by_user_id,
    updated_by_name,
    created_at,
    updated_at
  )
  values (
    'attendance-' || p_member_id::text,
    p_member_id,
    (select enrollment_date from public.members where id = p_member_id),
    true,
    'BillNormally',
    (select enrollment_date from public.members where id = p_member_id),
    p_actor_user_id,
    nullif(trim(coalesce(p_actor_name, '')), ''),
    coalesce(p_started_at, now()),
    coalesce(p_started_at, now())
  )
  on conflict on constraint member_attendance_schedules_member_id_key do nothing;

  insert into public.member_health_profiles (
    member_id,
    created_at,
    updated_at,
    updated_by_user_id,
    updated_by_name
  )
  values (
    p_member_id,
    coalesce(p_started_at, now()),
    coalesce(p_started_at, now()),
    p_actor_user_id,
    nullif(trim(coalesce(p_actor_name, '')), '')
  )
  on conflict on constraint member_health_profiles_member_id_key do nothing;

  update public.members
  set
    legal_first_name = case when p_member_patch ? 'legal_first_name' then nullif(trim(coalesce(p_member_patch ->> 'legal_first_name', '')), '') else legal_first_name end,
    legal_last_name = case when p_member_patch ? 'legal_last_name' then nullif(trim(coalesce(p_member_patch ->> 'legal_last_name', '')), '') else legal_last_name end,
    preferred_name = case when p_member_patch ? 'preferred_name' then nullif(trim(coalesce(p_member_patch ->> 'preferred_name', '')), '') else preferred_name end,
    ssn_last4 = case when p_member_patch ? 'ssn_last4' then nullif(trim(coalesce(p_member_patch ->> 'ssn_last4', '')), '') else ssn_last4 end,
    dob = case when p_member_patch ? 'dob' then nullif(trim(coalesce(p_member_patch ->> 'dob', '')), '')::date else dob end,
    enrollment_date = case when p_member_patch ? 'enrollment_date' then nullif(trim(coalesce(p_member_patch ->> 'enrollment_date', '')), '')::date else enrollment_date end,
    updated_at = case when p_member_patch ? 'updated_at' then coalesce(nullif(p_member_patch ->> 'updated_at', '')::timestamptz, updated_at) else updated_at end
  where id = p_member_id;

  update public.member_command_centers as mcc
  set
    marital_status = case when p_mcc_patch ? 'marital_status' then nullif(trim(coalesce(p_mcc_patch ->> 'marital_status', '')), '') else mcc.marital_status end,
    street_address = case when p_mcc_patch ? 'street_address' then nullif(trim(coalesce(p_mcc_patch ->> 'street_address', '')), '') else mcc.street_address end,
    city = case when p_mcc_patch ? 'city' then nullif(trim(coalesce(p_mcc_patch ->> 'city', '')), '') else mcc.city end,
    state = case when p_mcc_patch ? 'state' then nullif(trim(coalesce(p_mcc_patch ->> 'state', '')), '') else mcc.state end,
    zip = case when p_mcc_patch ? 'zip' then nullif(trim(coalesce(p_mcc_patch ->> 'zip', '')), '') else mcc.zip end,
    guardian_poa_status = case when p_mcc_patch ? 'guardian_poa_status' then nullif(trim(coalesce(p_mcc_patch ->> 'guardian_poa_status', '')), '') else mcc.guardian_poa_status end,
    power_of_attorney = case when p_mcc_patch ? 'power_of_attorney' then nullif(trim(coalesce(p_mcc_patch ->> 'power_of_attorney', '')), '') else mcc.power_of_attorney end,
    original_referral_source = case when p_mcc_patch ? 'original_referral_source' then nullif(trim(coalesce(p_mcc_patch ->> 'original_referral_source', '')), '') else mcc.original_referral_source end,
    pcp_name = case when p_mcc_patch ? 'pcp_name' then nullif(trim(coalesce(p_mcc_patch ->> 'pcp_name', '')), '') else mcc.pcp_name end,
    pcp_phone = case when p_mcc_patch ? 'pcp_phone' then nullif(trim(coalesce(p_mcc_patch ->> 'pcp_phone', '')), '') else mcc.pcp_phone end,
    pcp_fax = case when p_mcc_patch ? 'pcp_fax' then nullif(trim(coalesce(p_mcc_patch ->> 'pcp_fax', '')), '') else mcc.pcp_fax end,
    pcp_address = case when p_mcc_patch ? 'pcp_address' then nullif(trim(coalesce(p_mcc_patch ->> 'pcp_address', '')), '') else mcc.pcp_address end,
    pharmacy = case when p_mcc_patch ? 'pharmacy' then nullif(trim(coalesce(p_mcc_patch ->> 'pharmacy', '')), '') else mcc.pharmacy end,
    living_situation = case when p_mcc_patch ? 'living_situation' then nullif(trim(coalesce(p_mcc_patch ->> 'living_situation', '')), '') else mcc.living_situation end,
    insurance_summary_reference = case when p_mcc_patch ? 'insurance_summary_reference' then nullif(trim(coalesce(p_mcc_patch ->> 'insurance_summary_reference', '')), '') else mcc.insurance_summary_reference end,
    veteran_branch = case when p_mcc_patch ? 'veteran_branch' then nullif(trim(coalesce(p_mcc_patch ->> 'veteran_branch', '')), '') else mcc.veteran_branch end,
    gender = case when p_mcc_patch ? 'gender' then nullif(trim(coalesce(p_mcc_patch ->> 'gender', '')), '') else mcc.gender end,
    is_veteran = case when p_mcc_patch ? 'is_veteran' then (p_mcc_patch ->> 'is_veteran')::boolean else mcc.is_veteran end,
    photo_consent = case when p_mcc_patch ? 'photo_consent' then (p_mcc_patch ->> 'photo_consent')::boolean else mcc.photo_consent end,
    updated_by_user_id = case when p_mcc_patch ? 'updated_by_user_id' then nullif(p_mcc_patch ->> 'updated_by_user_id', '')::uuid else mcc.updated_by_user_id end,
    updated_by_name = case when p_mcc_patch ? 'updated_by_name' then nullif(trim(coalesce(p_mcc_patch ->> 'updated_by_name', '')), '') else mcc.updated_by_name end,
    updated_at = case when p_mcc_patch ? 'updated_at' then coalesce(nullif(p_mcc_patch ->> 'updated_at', '')::timestamptz, mcc.updated_at) else mcc.updated_at end
  where mcc.member_id = p_member_id;

  update public.member_attendance_schedules as mas
  set
    monday = case when p_attendance_patch ? 'monday' then (p_attendance_patch ->> 'monday')::boolean else mas.monday end,
    tuesday = case when p_attendance_patch ? 'tuesday' then (p_attendance_patch ->> 'tuesday')::boolean else mas.tuesday end,
    wednesday = case when p_attendance_patch ? 'wednesday' then (p_attendance_patch ->> 'wednesday')::boolean else mas.wednesday end,
    thursday = case when p_attendance_patch ? 'thursday' then (p_attendance_patch ->> 'thursday')::boolean else mas.thursday end,
    friday = case when p_attendance_patch ? 'friday' then (p_attendance_patch ->> 'friday')::boolean else mas.friday end,
    attendance_days_per_week = case when p_attendance_patch ? 'attendance_days_per_week' then nullif(p_attendance_patch ->> 'attendance_days_per_week', '')::integer else mas.attendance_days_per_week end,
    transportation_mode = case when p_attendance_patch ? 'transportation_mode' then nullif(trim(coalesce(p_attendance_patch ->> 'transportation_mode', '')), '') else mas.transportation_mode end,
    transportation_required = case when p_attendance_patch ? 'transportation_required' then (p_attendance_patch ->> 'transportation_required')::boolean else mas.transportation_required end,
    daily_rate = case when p_attendance_patch ? 'daily_rate' then nullif(p_attendance_patch ->> 'daily_rate', '')::numeric else mas.daily_rate end,
    updated_by_user_id = case when p_attendance_patch ? 'updated_by_user_id' then nullif(p_attendance_patch ->> 'updated_by_user_id', '')::uuid else mas.updated_by_user_id end,
    updated_by_name = case when p_attendance_patch ? 'updated_by_name' then nullif(trim(coalesce(p_attendance_patch ->> 'updated_by_name', '')), '') else mas.updated_by_name end,
    updated_at = case when p_attendance_patch ? 'updated_at' then coalesce(nullif(p_attendance_patch ->> 'updated_at', '')::timestamptz, mas.updated_at) else mas.updated_at end
  where mas.member_id = p_member_id;

  for v_contact in
    select value from jsonb_array_elements(coalesce(p_contacts, '[]'::jsonb)) value
  loop
    select mc.id
    into v_existing_contact_id
    from public.member_contacts as mc
    where mc.member_id = p_member_id
      and lower(btrim(mc.category)) = lower(btrim(coalesce(v_contact ->> 'category', '')))
      and lower(btrim(mc.contact_name)) = lower(btrim(coalesce(v_contact ->> 'contact_name', '')))
    order by mc.updated_at desc
    limit 1;

    if v_existing_contact_id is null then
      insert into public.member_contacts (
        id, member_id, contact_name, relationship_to_member, category, category_other, email, cellular_number,
        work_number, home_number, street_address, city, state, zip, is_payor, created_by_user_id, created_by_name, created_at, updated_at
      )
      values (
        v_contact ->> 'id',
        p_member_id,
        v_contact ->> 'contact_name',
        nullif(trim(coalesce(v_contact ->> 'relationship_to_member', '')), ''),
        v_contact ->> 'category',
        nullif(trim(coalesce(v_contact ->> 'category_other', '')), ''),
        nullif(trim(coalesce(v_contact ->> 'email', '')), ''),
        nullif(trim(coalesce(v_contact ->> 'cellular_number', '')), ''),
        nullif(trim(coalesce(v_contact ->> 'work_number', '')), ''),
        nullif(trim(coalesce(v_contact ->> 'home_number', '')), ''),
        nullif(trim(coalesce(v_contact ->> 'street_address', '')), ''),
        nullif(trim(coalesce(v_contact ->> 'city', '')), ''),
        nullif(trim(coalesce(v_contact ->> 'state', '')), ''),
        nullif(trim(coalesce(v_contact ->> 'zip', '')), ''),
        false,
        p_actor_user_id,
        nullif(trim(coalesce(p_actor_name, '')), ''),
        coalesce(p_started_at, now()),
        coalesce(p_started_at, now())
      );
      v_resolved_contact_id := v_contact ->> 'id';
      v_created_contact_ids := array_append(v_created_contact_ids, v_resolved_contact_id);
    else
      update public.member_contacts as mc
      set
        contact_name = v_contact ->> 'contact_name',
        relationship_to_member = nullif(trim(coalesce(v_contact ->> 'relationship_to_member', '')), ''),
        category = v_contact ->> 'category',
        category_other = nullif(trim(coalesce(v_contact ->> 'category_other', '')), ''),
        email = nullif(trim(coalesce(v_contact ->> 'email', '')), ''),
        cellular_number = nullif(trim(coalesce(v_contact ->> 'cellular_number', '')), ''),
        work_number = nullif(trim(coalesce(v_contact ->> 'work_number', '')), ''),
        home_number = nullif(trim(coalesce(v_contact ->> 'home_number', '')), ''),
        street_address = nullif(trim(coalesce(v_contact ->> 'street_address', '')), ''),
        city = nullif(trim(coalesce(v_contact ->> 'city', '')), ''),
        state = nullif(trim(coalesce(v_contact ->> 'state', '')), ''),
        zip = nullif(trim(coalesce(v_contact ->> 'zip', '')), ''),
        updated_at = coalesce(p_started_at, now())
      where mc.id = v_existing_contact_id;
      v_resolved_contact_id := v_existing_contact_id;
    end if;

    if coalesce((v_contact ->> 'is_payor')::boolean, false) then
      v_payor_contact_id := v_resolved_contact_id;
    end if;
  end loop;

  if v_payor_contact_id is not null then
    perform public.rpc_set_member_contact_payor(p_member_id, v_payor_contact_id);
  end if;

  update public.member_health_profiles as mhp
  set
    provider_name = case when p_mhp_patch ? 'provider_name' then nullif(trim(coalesce(p_mhp_patch ->> 'provider_name', '')), '') else mhp.provider_name end,
    provider_phone = case when p_mhp_patch ? 'provider_phone' then nullif(trim(coalesce(p_mhp_patch ->> 'provider_phone', '')), '') else mhp.provider_phone end,
    hospital_preference = case when p_mhp_patch ? 'hospital_preference' then nullif(trim(coalesce(p_mhp_patch ->> 'hospital_preference', '')), '') else mhp.hospital_preference end,
    dietary_restrictions = case when p_mhp_patch ? 'dietary_restrictions' then nullif(trim(coalesce(p_mhp_patch ->> 'dietary_restrictions', '')), '') else mhp.dietary_restrictions end,
    oxygen_use = case when p_mhp_patch ? 'oxygen_use' then nullif(trim(coalesce(p_mhp_patch ->> 'oxygen_use', '')), '') else mhp.oxygen_use end,
    memory_severity = case when p_mhp_patch ? 'memory_severity' then nullif(trim(coalesce(p_mhp_patch ->> 'memory_severity', '')), '') else mhp.memory_severity end,
    falls_history = case when p_mhp_patch ? 'falls_history' then nullif(trim(coalesce(p_mhp_patch ->> 'falls_history', '')), '') else mhp.falls_history end,
    physical_health_problems = case when p_mhp_patch ? 'physical_health_problems' then nullif(trim(coalesce(p_mhp_patch ->> 'physical_health_problems', '')), '') else mhp.physical_health_problems end,
    cognitive_behavior_comments = case when p_mhp_patch ? 'cognitive_behavior_comments' then nullif(trim(coalesce(p_mhp_patch ->> 'cognitive_behavior_comments', '')), '') else mhp.cognitive_behavior_comments end,
    communication_style = case when p_mhp_patch ? 'communication_style' then nullif(trim(coalesce(p_mhp_patch ->> 'communication_style', '')), '') else mhp.communication_style end,
    ambulation = case when p_mhp_patch ? 'ambulation' then nullif(trim(coalesce(p_mhp_patch ->> 'ambulation', '')), '') else mhp.ambulation end,
    transferring = case when p_mhp_patch ? 'transferring' then nullif(trim(coalesce(p_mhp_patch ->> 'transferring', '')), '') else mhp.transferring end,
    bathing = case when p_mhp_patch ? 'bathing' then nullif(trim(coalesce(p_mhp_patch ->> 'bathing', '')), '') else mhp.bathing end,
    toileting = case when p_mhp_patch ? 'toileting' then nullif(trim(coalesce(p_mhp_patch ->> 'toileting', '')), '') else mhp.toileting end,
    bladder_continence = case when p_mhp_patch ? 'bladder_continence' then nullif(trim(coalesce(p_mhp_patch ->> 'bladder_continence', '')), '') else mhp.bladder_continence end,
    bowel_continence = case when p_mhp_patch ? 'bowel_continence' then nullif(trim(coalesce(p_mhp_patch ->> 'bowel_continence', '')), '') else mhp.bowel_continence end,
    incontinence_products = case when p_mhp_patch ? 'incontinence_products' then nullif(trim(coalesce(p_mhp_patch ->> 'incontinence_products', '')), '') else mhp.incontinence_products end,
    hearing = case when p_mhp_patch ? 'hearing' then nullif(trim(coalesce(p_mhp_patch ->> 'hearing', '')), '') else mhp.hearing end,
    dressing = case when p_mhp_patch ? 'dressing' then nullif(trim(coalesce(p_mhp_patch ->> 'dressing', '')), '') else mhp.dressing end,
    eating = case when p_mhp_patch ? 'eating' then nullif(trim(coalesce(p_mhp_patch ->> 'eating', '')), '') else mhp.eating end,
    dental = case when p_mhp_patch ? 'dental' then nullif(trim(coalesce(p_mhp_patch ->> 'dental', '')), '') else mhp.dental end,
    speech_comments = case when p_mhp_patch ? 'speech_comments' then nullif(trim(coalesce(p_mhp_patch ->> 'speech_comments', '')), '') else mhp.speech_comments end,
    glasses_hearing_aids_cataracts = case when p_mhp_patch ? 'glasses_hearing_aids_cataracts' then nullif(trim(coalesce(p_mhp_patch ->> 'glasses_hearing_aids_cataracts', '')), '') else mhp.glasses_hearing_aids_cataracts end,
    intake_notes = case when p_mhp_patch ? 'intake_notes' then nullif(trim(coalesce(p_mhp_patch ->> 'intake_notes', '')), '') else mhp.intake_notes end,
    mental_health_history = case when p_mhp_patch ? 'mental_health_history' then nullif(trim(coalesce(p_mhp_patch ->> 'mental_health_history', '')), '') else mhp.mental_health_history end,
    mobility_aids = case when p_mhp_patch ? 'mobility_aids' then nullif(trim(coalesce(p_mhp_patch ->> 'mobility_aids', '')), '') else mhp.mobility_aids end,
    wandering = case when p_mhp_patch ? 'wandering' then (p_mhp_patch ->> 'wandering')::boolean else mhp.wandering end,
    combative_disruptive = case when p_mhp_patch ? 'combative_disruptive' then (p_mhp_patch ->> 'combative_disruptive')::boolean else mhp.combative_disruptive end,
    disorientation = case when p_mhp_patch ? 'disorientation' then (p_mhp_patch ->> 'disorientation')::boolean else mhp.disorientation end,
    agitation_resistive = case when p_mhp_patch ? 'agitation_resistive' then (p_mhp_patch ->> 'agitation_resistive')::boolean else mhp.agitation_resistive end,
    sleep_issues = case when p_mhp_patch ? 'sleep_issues' then (p_mhp_patch ->> 'sleep_issues')::boolean else mhp.sleep_issues end,
    updated_by_user_id = case when p_mhp_patch ? 'updated_by_user_id' then nullif(p_mhp_patch ->> 'updated_by_user_id', '')::uuid else mhp.updated_by_user_id end,
    updated_by_name = case when p_mhp_patch ? 'updated_by_name' then nullif(trim(coalesce(p_mhp_patch ->> 'updated_by_name', '')), '') else mhp.updated_by_name end,
    updated_at = case when p_mhp_patch ? 'updated_at' then coalesce(nullif(p_mhp_patch ->> 'updated_at', '')::timestamptz, mhp.updated_at) else mhp.updated_at end
  where mhp.member_id = p_member_id;

  insert into public.enrollment_packet_pof_staging (
    packet_id, member_id, pcp_name, physician_phone, physician_fax, physician_address, pharmacy, allergies_summary,
    dietary_restrictions, oxygen_use, mobility_support, adl_support, diagnosis_placeholders, intake_notes, prefill_payload,
    review_required, updated_by_user_id, updated_by_name, updated_at
  )
  values (
    p_packet_id,
    p_member_id,
    nullif(trim(coalesce(p_pof_stage_payload ->> 'pcp_name', '')), ''),
    nullif(trim(coalesce(p_pof_stage_payload ->> 'physician_phone', '')), ''),
    nullif(trim(coalesce(p_pof_stage_payload ->> 'physician_fax', '')), ''),
    nullif(trim(coalesce(p_pof_stage_payload ->> 'physician_address', '')), ''),
    nullif(trim(coalesce(p_pof_stage_payload ->> 'pharmacy', '')), ''),
    nullif(trim(coalesce(p_pof_stage_payload ->> 'allergies_summary', '')), ''),
    nullif(trim(coalesce(p_pof_stage_payload ->> 'dietary_restrictions', '')), ''),
    nullif(trim(coalesce(p_pof_stage_payload ->> 'oxygen_use', '')), ''),
    nullif(trim(coalesce(p_pof_stage_payload ->> 'mobility_support', '')), ''),
    coalesce(p_pof_stage_payload -> 'adl_support', '{}'::jsonb),
    nullif(trim(coalesce(p_pof_stage_payload ->> 'diagnosis_placeholders', '')), ''),
    nullif(trim(coalesce(p_pof_stage_payload ->> 'intake_notes', '')), ''),
    coalesce(p_pof_stage_payload -> 'prefill_payload', '{}'::jsonb),
    coalesce((p_pof_stage_payload ->> 'review_required')::boolean, true),
    nullif(p_pof_stage_payload ->> 'updated_by_user_id', '')::uuid,
    nullif(trim(coalesce(p_pof_stage_payload ->> 'updated_by_name', '')), ''),
    coalesce(nullif(p_pof_stage_payload ->> 'updated_at', '')::timestamptz, coalesce(p_started_at, now()))
  )
  on conflict on constraint enrollment_packet_pof_staging_packet_id_key
  do update
  set
    member_id = excluded.member_id,
    pcp_name = excluded.pcp_name,
    physician_phone = excluded.physician_phone,
    physician_fax = excluded.physician_fax,
    physician_address = excluded.physician_address,
    pharmacy = excluded.pharmacy,
    allergies_summary = excluded.allergies_summary,
    dietary_restrictions = excluded.dietary_restrictions,
    oxygen_use = excluded.oxygen_use,
    mobility_support = excluded.mobility_support,
    adl_support = excluded.adl_support,
    diagnosis_placeholders = excluded.diagnosis_placeholders,
    intake_notes = excluded.intake_notes,
    prefill_payload = excluded.prefill_payload,
    review_required = excluded.review_required,
    updated_by_user_id = excluded.updated_by_user_id,
    updated_by_name = excluded.updated_by_name,
    updated_at = excluded.updated_at;

  insert into public.enrollment_packet_mapping_records (
    mapping_run_id, packet_id, member_id, target_system, target_table, target_field, source_field, status,
    source_value, destination_value, note, created_at
  )
  select
    v_mapping_run_id,
    p_packet_id,
    p_member_id,
    row.target_system,
    row.target_table,
    row.target_field,
    row.source_field,
    row.status,
    row.source_value,
    row.destination_value,
    row.note,
    coalesce(p_started_at, now())
  from jsonb_to_recordset(coalesce(p_record_rows, '[]'::jsonb)) as row(
    target_system text,
    target_table text,
    target_field text,
    source_field text,
    status text,
    source_value text,
    destination_value text,
    note text
  );

  with inserted as (
    insert into public.enrollment_packet_field_conflicts (
      mapping_run_id, packet_id, member_id, target_system, target_table, target_field, source_field,
      source_value, destination_value, status, created_at
    )
    select
      v_mapping_run_id,
      p_packet_id,
      p_member_id,
      row.target_system,
      row.target_table,
      row.target_field,
      row.source_field,
      row.source_value,
      row.destination_value,
      'open',
      coalesce(p_started_at, now())
    from jsonb_to_recordset(coalesce(p_record_rows, '[]'::jsonb)) as row(
      target_system text,
      target_table text,
      target_field text,
      source_field text,
      status text,
      source_value text,
      destination_value text,
      note text
    )
    where row.status = 'conflict'
    returning id
  )
  select coalesce(array_agg(id), array[]::uuid[]) into v_conflict_ids from inserted;

  select mcc.id into v_mcc_id from public.member_command_centers as mcc where mcc.member_id = p_member_id;
  select mas.id into v_attendance_id from public.member_attendance_schedules as mas where mas.member_id = p_member_id;
  select mhp.id into v_mhp_id from public.member_health_profiles as mhp where mhp.member_id = p_member_id;
  select epps.id into v_pof_stage_id from public.enrollment_packet_pof_staging as epps where epps.packet_id = p_packet_id;
  select coalesce(array_agg(mc.id order by mc.updated_at desc), array[]::text[]) into v_contact_ids
  from public.member_contacts as mc
  where mc.member_id = p_member_id
    and lower(btrim(mc.category)) in ('responsible party', 'emergency contact');
  select coalesce(array_agg(epu.member_file_id order by epu.uploaded_at asc), array[]::text[]) into v_member_file_ids
  from public.enrollment_packet_uploads as epu
  where epu.packet_id = p_packet_id
    and epu.member_file_id is not null;

  v_systems := coalesce(v_summary -> 'systems', '{}'::jsonb);
  v_downstream_systems_updated := array(
    select jsonb_array_elements_text(coalesce(v_summary -> 'downstreamSystemsUpdated', '[]'::jsonb))
  );
  v_conflicts_requiring_review := coalesce(nullif(v_summary ->> 'conflictsRequiringReview', '')::integer, 0);
  v_entity_references := jsonb_build_object(
    'memberId', p_member_id,
    'leadId', v_request.lead_id,
    'mccProfileId', v_mcc_id,
    'attendanceScheduleId', v_attendance_id,
    'memberHealthProfileId', v_mhp_id,
    'pofStagingId', v_pof_stage_id,
    'contactIds', to_jsonb(v_contact_ids),
    'createdContactIds', to_jsonb(v_created_contact_ids),
    'memberFileIds', to_jsonb(v_member_file_ids)
  );

  update public.enrollment_packet_mapping_runs
  set
    status = 'completed',
    summary = jsonb_build_object(
      'systems', v_systems,
      'downstreamSystemsUpdated', to_jsonb(v_downstream_systems_updated),
      'conflictsRequiringReview', v_conflicts_requiring_review,
      'recordsPersisted', v_records_persisted,
      'conflictIds', to_jsonb(v_conflict_ids),
      'entityReferences', v_entity_references
    ),
    completed_at = v_completed_at
  where id = v_mapping_run_id;

  update public.enrollment_packet_requests
  set
    mapping_sync_status = 'completed',
    mapping_sync_error = null,
    mapping_sync_attempted_at = v_completed_at,
    latest_mapping_run_id = v_mapping_run_id,
    updated_at = v_completed_at
  where id = p_packet_id;

  return query
  select
    p_packet_id,
    p_member_id,
    v_request.lead_id,
    'completed',
    v_mapping_run_id,
    v_systems,
    v_downstream_systems_updated,
    v_conflicts_requiring_review,
    v_records_persisted,
    v_conflict_ids,
    v_entity_references;
end;
$$;

grant execute on function public.convert_enrollment_packet_to_member(
  uuid,
  uuid,
  uuid,
  text,
  text,
  timestamptz,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb
) to service_role;
