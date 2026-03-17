create or replace function public.rpc_upsert_care_plan_core(
  p_care_plan_id uuid,
  p_member_id uuid,
  p_track text,
  p_enrollment_date date,
  p_review_date date,
  p_last_completed_date date,
  p_next_due_date date,
  p_status text,
  p_care_team_notes text,
  p_no_changes_needed boolean,
  p_modifications_required boolean,
  p_modifications_description text,
  p_caregiver_name text,
  p_caregiver_email text,
  p_actor_user_id uuid,
  p_actor_name text,
  p_now timestamptz default now(),
  p_sections jsonb default '[]'::jsonb
)
returns table (
  care_plan_id uuid,
  was_created boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_care_plan_id uuid;
  v_now timestamptz := coalesce(p_now, now());
begin
  if p_member_id is null then
    raise exception 'rpc_upsert_care_plan_core requires p_member_id';
  end if;
  if nullif(trim(coalesce(p_track, '')), '') is null then
    raise exception 'rpc_upsert_care_plan_core requires p_track';
  end if;
  if p_enrollment_date is null or p_review_date is null or p_next_due_date is null then
    raise exception 'rpc_upsert_care_plan_core requires enrollment, review, and next due dates';
  end if;
  if jsonb_typeof(coalesce(p_sections, '[]'::jsonb)) <> 'array' then
    raise exception 'rpc_upsert_care_plan_core requires p_sections to be a JSON array';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_sections, '[]'::jsonb)) section
    where nullif(trim(coalesce(section ->> 'sectionType', '')), '') is null
      or nullif(trim(coalesce(section ->> 'shortTermGoals', '')), '') is null
      or nullif(trim(coalesce(section ->> 'longTermGoals', '')), '') is null
      or nullif(trim(coalesce(section ->> 'displayOrder', '')), '') is null
  ) then
    raise exception 'rpc_upsert_care_plan_core requires populated sectionType, shortTermGoals, longTermGoals, and displayOrder values';
  end if;

  if p_care_plan_id is null then
    insert into public.care_plans (
      member_id,
      track,
      enrollment_date,
      review_date,
      last_completed_date,
      next_due_date,
      status,
      completed_by,
      date_of_completion,
      responsible_party_signature,
      responsible_party_signature_date,
      administrator_signature,
      administrator_signature_date,
      care_team_notes,
      no_changes_needed,
      modifications_required,
      modifications_description,
      nurse_designee_user_id,
      nurse_designee_name,
      nurse_signed_at,
      nurse_signature_status,
      nurse_signed_by_user_id,
      nurse_signed_by_name,
      nurse_signature_artifact_storage_path,
      nurse_signature_artifact_member_file_id,
      nurse_signature_metadata,
      caregiver_name,
      caregiver_email,
      caregiver_signature_status,
      caregiver_sent_at,
      caregiver_sent_by_user_id,
      caregiver_viewed_at,
      caregiver_signed_at,
      caregiver_signature_request_token,
      caregiver_signature_expires_at,
      caregiver_signature_request_url,
      caregiver_signed_name,
      caregiver_signature_image_url,
      caregiver_signature_ip,
      caregiver_signature_user_agent,
      final_member_file_id,
      legacy_cleanup_flag,
      created_by_user_id,
      created_by_name,
      updated_by_user_id,
      updated_by_name,
      created_at,
      updated_at
    )
    values (
      p_member_id,
      p_track,
      p_enrollment_date,
      p_review_date,
      p_last_completed_date,
      p_next_due_date,
      p_status,
      null,
      null,
      null,
      null,
      null,
      null,
      coalesce(p_care_team_notes, ''),
      coalesce(p_no_changes_needed, false),
      coalesce(p_modifications_required, false),
      coalesce(p_modifications_description, ''),
      null,
      null,
      null,
      'unsigned',
      null,
      null,
      null,
      null,
      '{}'::jsonb,
      nullif(trim(coalesce(p_caregiver_name, '')), ''),
      nullif(trim(coalesce(p_caregiver_email, '')), ''),
      'not_requested',
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      false,
      p_actor_user_id,
      nullif(trim(coalesce(p_actor_name, '')), ''),
      p_actor_user_id,
      nullif(trim(coalesce(p_actor_name, '')), ''),
      v_now,
      v_now
    )
    returning id into v_care_plan_id;
    was_created := true;
  else
    select cp.id
    into v_care_plan_id
    from public.care_plans as cp
    where cp.id = p_care_plan_id
    for update;

    if v_care_plan_id is null then
      raise exception 'Care plan % not found for update', p_care_plan_id;
    end if;

    update public.care_plans
    set
      track = p_track,
      enrollment_date = p_enrollment_date,
      review_date = p_review_date,
      last_completed_date = p_last_completed_date,
      next_due_date = p_next_due_date,
      status = p_status,
      completed_by = null,
      date_of_completion = null,
      responsible_party_signature = null,
      responsible_party_signature_date = null,
      administrator_signature = null,
      administrator_signature_date = null,
      care_team_notes = coalesce(p_care_team_notes, ''),
      no_changes_needed = coalesce(p_no_changes_needed, false),
      modifications_required = coalesce(p_modifications_required, false),
      modifications_description = coalesce(p_modifications_description, ''),
      nurse_designee_user_id = null,
      nurse_designee_name = null,
      nurse_signed_at = null,
      nurse_signature_status = 'unsigned',
      nurse_signed_by_user_id = null,
      nurse_signed_by_name = null,
      nurse_signature_artifact_storage_path = null,
      nurse_signature_artifact_member_file_id = null,
      nurse_signature_metadata = '{}'::jsonb,
      caregiver_name = nullif(trim(coalesce(p_caregiver_name, '')), ''),
      caregiver_email = nullif(trim(coalesce(p_caregiver_email, '')), ''),
      caregiver_signature_status = 'not_requested',
      caregiver_sent_at = null,
      caregiver_sent_by_user_id = null,
      caregiver_viewed_at = null,
      caregiver_signed_at = null,
      caregiver_signature_request_token = null,
      caregiver_signature_expires_at = null,
      caregiver_signature_request_url = null,
      caregiver_signed_name = null,
      caregiver_signature_image_url = null,
      caregiver_signature_ip = null,
      caregiver_signature_user_agent = null,
      final_member_file_id = null,
      legacy_cleanup_flag = false,
      updated_by_user_id = p_actor_user_id,
      updated_by_name = nullif(trim(coalesce(p_actor_name, '')), ''),
      updated_at = v_now
    where id = v_care_plan_id;

    was_created := false;
  end if;

  delete from public.care_plan_sections as cps
  where cps.care_plan_id = v_care_plan_id;

  insert into public.care_plan_sections (
    care_plan_id,
    section_type,
    short_term_goals,
    long_term_goals,
    display_order
  )
  select
    v_care_plan_id,
    section ->> 'sectionType',
    section ->> 'shortTermGoals',
    section ->> 'longTermGoals',
    (section ->> 'displayOrder')::integer
  from jsonb_array_elements(coalesce(p_sections, '[]'::jsonb)) section;

  care_plan_id := v_care_plan_id;
  return next;
end;
$$;

grant execute on function public.rpc_upsert_care_plan_core(
  uuid,
  uuid,
  text,
  date,
  date,
  date,
  date,
  text,
  text,
  boolean,
  boolean,
  text,
  text,
  text,
  uuid,
  text,
  timestamptz,
  jsonb
) to authenticated, service_role;

create or replace function public.rpc_finalize_care_plan_nurse_signature(
  p_care_plan_id uuid,
  p_member_id uuid,
  p_signed_by_user_id uuid,
  p_signed_by_name text,
  p_signed_at timestamptz,
  p_signature_artifact_storage_path text default null,
  p_signature_artifact_member_file_id text default null,
  p_signature_metadata jsonb default '{}'::jsonb
)
returns table (
  care_plan_id uuid,
  member_id uuid,
  signed_by_user_id uuid,
  signed_by_name text,
  signed_at timestamptz,
  status text,
  signature_artifact_storage_path text,
  signature_artifact_member_file_id text,
  signature_metadata jsonb,
  caregiver_signature_status text,
  was_already_signed boolean
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_care_plan public.care_plans%rowtype;
  v_signature public.care_plan_nurse_signatures%rowtype;
  v_signed_by_name text := nullif(trim(coalesce(p_signed_by_name, '')), '');
  v_signed_at timestamptz := coalesce(p_signed_at, now());
  v_signature_artifact_storage_path text := nullif(trim(coalesce(p_signature_artifact_storage_path, '')), '');
  v_signature_artifact_member_file_id text := nullif(trim(coalesce(p_signature_artifact_member_file_id, '')), '');
  v_signature_metadata jsonb := coalesce(p_signature_metadata, '{}'::jsonb);
  v_completion_date date;
  v_next_caregiver_status text;
begin
  if p_care_plan_id is null then
    raise exception 'care plan id is required';
  end if;
  if p_member_id is null then
    raise exception 'member id is required';
  end if;
  if p_signed_by_user_id is null then
    raise exception 'signed by user id is required';
  end if;
  if v_signed_by_name is null then
    raise exception 'signed by name is required';
  end if;

  select *
  into v_care_plan
  from public.care_plans
  where id = p_care_plan_id
  for update;

  if not found then
    raise exception 'Care plan % was not found.', p_care_plan_id;
  end if;

  if v_care_plan.member_id is distinct from p_member_id then
    raise exception 'Care plan % does not belong to member %.', p_care_plan_id, p_member_id;
  end if;

  select *
  into v_signature
  from public.care_plan_nurse_signatures as cpns
  where cpns.care_plan_id = p_care_plan_id
  for update;

  if found and coalesce(v_signature.status, '') = 'voided' then
    raise exception 'Care plan % nurse signature has been voided.', p_care_plan_id;
  end if;

  if coalesce(v_care_plan.nurse_signature_status, '') = 'voided' then
    raise exception 'Care plan % nurse signature is voided.', p_care_plan_id;
  end if;

  v_next_caregiver_status := case
    when coalesce(v_care_plan.caregiver_signature_status, '') = 'signed' then 'signed'
    else 'ready_to_send'
  end;

  if found and coalesce(v_signature.status, '') = 'signed' then
    update public.care_plans
    set
      nurse_signature_status = 'signed',
      nurse_signed_by_user_id = v_signature.signed_by_user_id,
      nurse_signed_by_name = v_signature.signed_by_name,
      nurse_signed_at = v_signature.signed_at,
      nurse_signature_artifact_storage_path = v_signature.signature_artifact_storage_path,
      nurse_signature_artifact_member_file_id = v_signature.signature_artifact_member_file_id,
      nurse_signature_metadata = coalesce(v_signature.signature_metadata, '{}'::jsonb),
      completed_by = v_signature.signed_by_name,
      administrator_signature = v_signature.signed_by_name,
      nurse_designee_user_id = v_signature.signed_by_user_id,
      nurse_designee_name = v_signature.signed_by_name,
      legacy_cleanup_flag = false,
      caregiver_signature_status = v_next_caregiver_status,
      updated_at = coalesce(v_signature.signed_at, v_signed_at, now())
    where id = p_care_plan_id;

    return query
    select
      v_signature.care_plan_id,
      v_signature.member_id,
      v_signature.signed_by_user_id,
      v_signature.signed_by_name,
      v_signature.signed_at,
      v_signature.status,
      v_signature.signature_artifact_storage_path,
      v_signature.signature_artifact_member_file_id,
      coalesce(v_signature.signature_metadata, '{}'::jsonb),
      v_next_caregiver_status,
      true;
    return;
  end if;

  if coalesce(v_care_plan.nurse_signature_status, '') = 'signed' then
    insert into public.care_plan_nurse_signatures (
      care_plan_id,
      member_id,
      signed_by_user_id,
      signed_by_name,
      signed_at,
      status,
      signature_artifact_storage_path,
      signature_artifact_member_file_id,
      signature_metadata,
      created_at,
      updated_at
    )
    values (
      v_care_plan.id,
      v_care_plan.member_id,
      coalesce(v_care_plan.nurse_signed_by_user_id, p_signed_by_user_id),
      coalesce(nullif(trim(coalesce(v_care_plan.nurse_signed_by_name, '')), ''), v_signed_by_name),
      coalesce(v_care_plan.nurse_signed_at, v_signed_at),
      'signed',
      coalesce(v_care_plan.nurse_signature_artifact_storage_path, v_signature_artifact_storage_path),
      coalesce(v_care_plan.nurse_signature_artifact_member_file_id, v_signature_artifact_member_file_id),
      coalesce(v_care_plan.nurse_signature_metadata, v_signature_metadata, '{}'::jsonb),
      coalesce(v_care_plan.created_at, now()),
      coalesce(v_care_plan.updated_at, v_signed_at, now())
    )
    on conflict on constraint care_plan_nurse_signatures_pkey do update
    set
      signed_by_user_id = excluded.signed_by_user_id,
      signed_by_name = excluded.signed_by_name,
      signed_at = excluded.signed_at,
      status = 'signed',
      signature_artifact_storage_path = coalesce(excluded.signature_artifact_storage_path, public.care_plan_nurse_signatures.signature_artifact_storage_path),
      signature_artifact_member_file_id = coalesce(excluded.signature_artifact_member_file_id, public.care_plan_nurse_signatures.signature_artifact_member_file_id),
      signature_metadata = coalesce(excluded.signature_metadata, public.care_plan_nurse_signatures.signature_metadata),
      updated_at = excluded.updated_at
    returning * into v_signature;

    return query
    select
      v_signature.care_plan_id,
      v_signature.member_id,
      v_signature.signed_by_user_id,
      v_signature.signed_by_name,
      v_signature.signed_at,
      v_signature.status,
      v_signature.signature_artifact_storage_path,
      v_signature.signature_artifact_member_file_id,
      coalesce(v_signature.signature_metadata, '{}'::jsonb),
      v_next_caregiver_status,
      true;
    return;
  end if;

  v_completion_date := coalesce(v_care_plan.review_date, (v_signed_at at time zone 'America/New_York')::date);

  insert into public.care_plan_nurse_signatures (
    care_plan_id,
    member_id,
    signed_by_user_id,
    signed_by_name,
    signed_at,
    status,
    signature_artifact_storage_path,
    signature_artifact_member_file_id,
    signature_metadata,
    created_at,
    updated_at
  )
  values (
    p_care_plan_id,
    p_member_id,
    p_signed_by_user_id,
    v_signed_by_name,
    v_signed_at,
    'signed',
    v_signature_artifact_storage_path,
    v_signature_artifact_member_file_id,
    v_signature_metadata,
    v_signed_at,
    v_signed_at
  )
  on conflict on constraint care_plan_nurse_signatures_pkey do update
  set
    signed_by_user_id = excluded.signed_by_user_id,
    signed_by_name = excluded.signed_by_name,
    signed_at = excluded.signed_at,
    status = 'signed',
    signature_artifact_storage_path = coalesce(excluded.signature_artifact_storage_path, public.care_plan_nurse_signatures.signature_artifact_storage_path),
    signature_artifact_member_file_id = coalesce(excluded.signature_artifact_member_file_id, public.care_plan_nurse_signatures.signature_artifact_member_file_id),
    signature_metadata = coalesce(excluded.signature_metadata, public.care_plan_nurse_signatures.signature_metadata),
    updated_at = excluded.updated_at
  returning * into v_signature;

  update public.care_plans
  set
    nurse_signature_status = 'signed',
    nurse_signed_by_user_id = p_signed_by_user_id,
    nurse_signed_by_name = v_signed_by_name,
    nurse_signed_at = v_signed_at,
    nurse_signature_artifact_storage_path = v_signature_artifact_storage_path,
    nurse_signature_artifact_member_file_id = v_signature_artifact_member_file_id,
    nurse_signature_metadata = v_signature_metadata,
    completed_by = v_signed_by_name,
    date_of_completion = v_completion_date,
    administrator_signature = v_signed_by_name,
    administrator_signature_date = v_completion_date,
    nurse_designee_user_id = p_signed_by_user_id,
    nurse_designee_name = v_signed_by_name,
    legacy_cleanup_flag = false,
    caregiver_signature_status = v_next_caregiver_status,
    updated_at = v_signed_at
  where id = p_care_plan_id;

  return query
  select
    v_signature.care_plan_id,
    v_signature.member_id,
    v_signature.signed_by_user_id,
    v_signature.signed_by_name,
    v_signature.signed_at,
    v_signature.status,
    v_signature.signature_artifact_storage_path,
    v_signature.signature_artifact_member_file_id,
    coalesce(v_signature.signature_metadata, '{}'::jsonb),
    v_next_caregiver_status,
    false;
end;
$$;

grant execute on function public.rpc_finalize_care_plan_nurse_signature(
  uuid,
  uuid,
  uuid,
  text,
  timestamptz,
  text,
  text,
  jsonb
) to authenticated, service_role;

create or replace function public.rpc_finalize_enrollment_packet_submission(
  p_packet_id uuid,
  p_rotated_token text,
  p_consumed_submission_token_hash text,
  p_completed_at timestamptz,
  p_filed_at timestamptz,
  p_signer_name text,
  p_signer_email text,
  p_signature_blob text,
  p_ip_address text,
  p_actor_user_id uuid,
  p_actor_email text,
  p_upload_batch_id uuid,
  p_completed_metadata jsonb default '{}'::jsonb,
  p_filed_metadata jsonb default '{}'::jsonb
)
returns table (
  packet_id uuid,
  status text,
  mapping_sync_status text,
  was_already_filed boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.enrollment_packet_requests%rowtype;
  v_consumed_submission_token_hash text := nullif(trim(coalesce(p_consumed_submission_token_hash, '')), '');
begin
  if p_packet_id is null then
    raise exception 'packet id is required';
  end if;

  select *
  into v_request
  from public.enrollment_packet_requests
  where id = p_packet_id
  for update;

  if not found then
    raise exception 'Enrollment packet request % was not found.', p_packet_id;
  end if;

  if coalesce(v_request.status, '') in ('completed', 'filed') then
    if v_consumed_submission_token_hash is not null
       and v_request.last_consumed_submission_token_hash = v_consumed_submission_token_hash then
      return query
      select
        v_request.id,
        v_request.status,
        v_request.mapping_sync_status,
        true;
      return;
    end if;
    raise exception 'Enrollment packet request % has already been finalized.', p_packet_id;
  end if;

  if coalesce(v_request.status, '') not in ('prepared', 'sent', 'opened', 'partially_completed') then
    raise exception 'Enrollment packet request % cannot be finalized from status %.', p_packet_id, coalesce(v_request.status, 'null');
  end if;

  insert into public.enrollment_packet_signatures (
    packet_id,
    signer_name,
    signer_email,
    signer_role,
    signature_blob,
    ip_address,
    signed_at,
    created_at,
    updated_at
  )
  values (
    p_packet_id,
    p_signer_name,
    nullif(trim(coalesce(p_signer_email, '')), ''),
    'caregiver',
    p_signature_blob,
    nullif(trim(coalesce(p_ip_address, '')), ''),
    coalesce(p_completed_at, now()),
    coalesce(p_completed_at, now()),
    coalesce(p_completed_at, now())
  );

  update public.enrollment_packet_uploads as epu
  set
    finalization_status = 'finalized',
    finalized_at = coalesce(p_filed_at, now())
  where epu.packet_id = p_packet_id
    and epu.finalization_status = 'staged'
    and (
      p_upload_batch_id is null
      or epu.finalization_batch_id = p_upload_batch_id
    );

  update public.enrollment_packet_requests
  set
    status = 'filed',
    completed_at = coalesce(p_completed_at, now()),
    token = p_rotated_token,
    last_consumed_submission_token_hash = coalesce(v_consumed_submission_token_hash, last_consumed_submission_token_hash),
    mapping_sync_status = 'pending',
    mapping_sync_error = null,
    mapping_sync_attempted_at = null,
    updated_at = coalesce(p_filed_at, now())
  where id = p_packet_id;

  insert into public.enrollment_packet_events (
    packet_id,
    event_type,
    actor_user_id,
    actor_email,
    timestamp,
    metadata
  )
  values
    (
      p_packet_id,
      'Enrollment Packet Completed',
      null,
      nullif(trim(coalesce(p_actor_email, '')), ''),
      coalesce(p_completed_at, now()),
      coalesce(p_completed_metadata, '{}'::jsonb)
    ),
    (
      p_packet_id,
      'filed',
      p_actor_user_id,
      null,
      coalesce(p_filed_at, now()),
      coalesce(p_filed_metadata, '{}'::jsonb)
    );

  return query
  select
    p_packet_id,
    'filed',
    'pending',
    false;
end;
$$;

grant execute on function public.rpc_finalize_enrollment_packet_submission(
  uuid,
  text,
  text,
  timestamptz,
  timestamptz,
  text,
  text,
  text,
  text,
  uuid,
  text,
  uuid,
  jsonb,
  jsonb
) to authenticated, service_role;

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
        work_number, home_number, street_address, city, state, zip, created_by_user_id, created_by_name, created_at, updated_at
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
        p_actor_user_id,
        nullif(trim(coalesce(p_actor_name, '')), ''),
        coalesce(p_started_at, now()),
        coalesce(p_started_at, now())
      );
      v_created_contact_ids := array_append(v_created_contact_ids, v_contact ->> 'id');
    end if;
  end loop;

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

create or replace function public.rpc_prepare_enrollment_packet_request(
  p_member_id uuid,
  p_sender_user_id uuid,
  p_caregiver_email text,
  p_token text,
  p_token_expires_at timestamptz,
  p_requested_days text[],
  p_transportation text,
  p_community_fee numeric,
  p_daily_rate numeric,
  p_signature_name text,
  p_signature_blob text,
  p_packet_id uuid default null,
  p_lead_id uuid default null,
  p_pricing_community_fee_id uuid default null,
  p_pricing_daily_rate_id uuid default null,
  p_pricing_snapshot jsonb default '{}'::jsonb,
  p_caregiver_name text default null,
  p_caregiver_phone text default null,
  p_intake_payload jsonb default '{}'::jsonb,
  p_sender_email text default null,
  p_prepared_at timestamptz default now()
)
returns table (
  packet_id uuid,
  was_created boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_packet_id uuid := coalesce(p_packet_id, gen_random_uuid());
begin
  if p_member_id is null then
    raise exception 'rpc_prepare_enrollment_packet_request requires p_member_id';
  end if;
  if p_sender_user_id is null then
    raise exception 'rpc_prepare_enrollment_packet_request requires p_sender_user_id';
  end if;
  if nullif(trim(coalesce(p_caregiver_email, '')), '') is null then
    raise exception 'rpc_prepare_enrollment_packet_request requires p_caregiver_email';
  end if;
  if nullif(trim(coalesce(p_token, '')), '') is null then
    raise exception 'rpc_prepare_enrollment_packet_request requires p_token';
  end if;
  if p_token_expires_at is null then
    raise exception 'rpc_prepare_enrollment_packet_request requires p_token_expires_at';
  end if;
  if nullif(trim(coalesce(p_signature_name, '')), '') is null then
    raise exception 'rpc_prepare_enrollment_packet_request requires p_signature_name';
  end if;
  if nullif(trim(coalesce(p_signature_blob, '')), '') is null then
    raise exception 'rpc_prepare_enrollment_packet_request requires p_signature_blob';
  end if;

  if p_packet_id is null then
    insert into public.enrollment_packet_requests (
      id,
      member_id,
      lead_id,
      sender_user_id,
      caregiver_email,
      status,
      delivery_status,
      token,
      token_expires_at,
      sent_at,
      completed_at,
      delivery_error,
      delivery_failed_at,
      created_at,
      updated_at
    )
    values (
      v_packet_id,
      p_member_id,
      p_lead_id,
      p_sender_user_id,
      lower(trim(p_caregiver_email)),
      'prepared',
      'ready_to_send',
      trim(p_token),
      p_token_expires_at,
      null,
      null,
      null,
      null,
      p_prepared_at,
      p_prepared_at
    );
    was_created := true;
  else
    update public.enrollment_packet_requests
    set
      member_id = p_member_id,
      lead_id = p_lead_id,
      sender_user_id = p_sender_user_id,
      caregiver_email = lower(trim(p_caregiver_email)),
      status = 'prepared',
      delivery_status = 'ready_to_send',
      token = trim(p_token),
      token_expires_at = p_token_expires_at,
      sent_at = null,
      completed_at = null,
      delivery_error = null,
      delivery_failed_at = null,
      updated_at = p_prepared_at
    where id = v_packet_id;

    if not found then
      raise exception 'Enrollment packet request % was not found.', v_packet_id;
    end if;
    was_created := false;
  end if;

  insert into public.enrollment_packet_fields (
    packet_id,
    requested_days,
    transportation,
    community_fee,
    daily_rate,
    pricing_community_fee_id,
    pricing_daily_rate_id,
    pricing_snapshot,
    caregiver_name,
    caregiver_phone,
    caregiver_email,
    intake_payload,
    updated_at
  )
  values (
    v_packet_id,
    coalesce(p_requested_days, array[]::text[]),
    p_transportation,
    p_community_fee,
    p_daily_rate,
    p_pricing_community_fee_id,
    p_pricing_daily_rate_id,
    coalesce(p_pricing_snapshot, '{}'::jsonb),
    nullif(trim(coalesce(p_caregiver_name, '')), ''),
    nullif(trim(coalesce(p_caregiver_phone, '')), ''),
    lower(trim(p_caregiver_email)),
    coalesce(p_intake_payload, '{}'::jsonb),
    p_prepared_at
  )
  on conflict on constraint enrollment_packet_fields_packet_id_key
  do update
  set
    requested_days = excluded.requested_days,
    transportation = excluded.transportation,
    community_fee = excluded.community_fee,
    daily_rate = excluded.daily_rate,
    pricing_community_fee_id = excluded.pricing_community_fee_id,
    pricing_daily_rate_id = excluded.pricing_daily_rate_id,
    pricing_snapshot = excluded.pricing_snapshot,
    caregiver_name = excluded.caregiver_name,
    caregiver_phone = excluded.caregiver_phone,
    caregiver_email = excluded.caregiver_email,
    intake_payload = excluded.intake_payload,
    updated_at = excluded.updated_at;

  insert into public.enrollment_packet_signatures (
    packet_id,
    signer_name,
    signer_email,
    signer_role,
    signature_blob,
    ip_address,
    signed_at,
    created_at,
    updated_at
  )
  values (
    v_packet_id,
    trim(p_signature_name),
    lower(nullif(trim(coalesce(p_sender_email, '')), '')),
    'sender_staff',
    trim(p_signature_blob),
    null,
    p_prepared_at,
    p_prepared_at,
    p_prepared_at
  );

  packet_id := v_packet_id;
  return next;
end;
$$;

grant execute on function public.rpc_prepare_enrollment_packet_request(
  uuid,
  uuid,
  text,
  text,
  timestamptz,
  text[],
  text,
  numeric,
  numeric,
  text,
  text,
  uuid,
  uuid,
  uuid,
  uuid,
  jsonb,
  text,
  text,
  jsonb,
  text,
  timestamptz
) to authenticated, service_role;

create or replace function public.rpc_save_enrollment_packet_progress(
  p_packet_id uuid,
  p_caregiver_name text default null,
  p_caregiver_phone text default null,
  p_caregiver_email text default null,
  p_caregiver_address_line1 text default null,
  p_caregiver_address_line2 text default null,
  p_caregiver_city text default null,
  p_caregiver_state text default null,
  p_caregiver_zip text default null,
  p_secondary_contact_name text default null,
  p_secondary_contact_phone text default null,
  p_secondary_contact_email text default null,
  p_secondary_contact_relationship text default null,
  p_notes text default null,
  p_intake_payload jsonb default '{}'::jsonb,
  p_updated_at timestamptz default now()
)
returns table (
  packet_id uuid,
  status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.enrollment_packet_requests%rowtype;
begin
  if p_packet_id is null then
    raise exception 'rpc_save_enrollment_packet_progress requires p_packet_id';
  end if;

  update public.enrollment_packet_fields as epf
  set
    caregiver_name = nullif(trim(coalesce(p_caregiver_name, '')), ''),
    caregiver_phone = nullif(trim(coalesce(p_caregiver_phone, '')), ''),
    caregiver_email = lower(nullif(trim(coalesce(p_caregiver_email, '')), '')),
    caregiver_address_line1 = nullif(trim(coalesce(p_caregiver_address_line1, '')), ''),
    caregiver_address_line2 = nullif(trim(coalesce(p_caregiver_address_line2, '')), ''),
    caregiver_city = nullif(trim(coalesce(p_caregiver_city, '')), ''),
    caregiver_state = nullif(trim(coalesce(p_caregiver_state, '')), ''),
    caregiver_zip = nullif(trim(coalesce(p_caregiver_zip, '')), ''),
    secondary_contact_name = nullif(trim(coalesce(p_secondary_contact_name, '')), ''),
    secondary_contact_phone = nullif(trim(coalesce(p_secondary_contact_phone, '')), ''),
    secondary_contact_email = lower(nullif(trim(coalesce(p_secondary_contact_email, '')), '')),
    secondary_contact_relationship = nullif(trim(coalesce(p_secondary_contact_relationship, '')), ''),
    notes = nullif(trim(coalesce(p_notes, '')), ''),
    intake_payload = coalesce(p_intake_payload, '{}'::jsonb),
    updated_at = p_updated_at
  where epf.packet_id = p_packet_id;

  if not found then
    raise exception 'Enrollment packet fields were not found.';
  end if;

  update public.enrollment_packet_requests
  set
    status = 'partially_completed',
    updated_at = p_updated_at
  where id = p_packet_id
    and status in ('prepared', 'sent', 'opened', 'partially_completed')
  returning *
  into v_request;

  if not found then
    raise exception 'Unable to save enrollment packet progress because the packet is no longer in an editable state.';
  end if;

  return query
  select
    p_packet_id,
    v_request.status;
end;
$$;

grant execute on function public.rpc_save_enrollment_packet_progress(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  jsonb,
  timestamptz
) to authenticated, service_role;
