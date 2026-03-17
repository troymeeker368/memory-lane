create or replace function public.rpc_finalize_intake_assessment_signature(
  p_assessment_id uuid,
  p_member_id uuid,
  p_signed_by_user_id uuid,
  p_signed_by_name text,
  p_signed_at timestamptz,
  p_signature_artifact_storage_path text default null,
  p_signature_artifact_member_file_id text default null,
  p_signature_metadata jsonb default '{}'::jsonb
)
returns table (
  assessment_id uuid,
  member_id uuid,
  signed_by_user_id uuid,
  signed_by_name text,
  signed_at timestamptz,
  status text,
  signature_artifact_storage_path text,
  signature_artifact_member_file_id text,
  signature_metadata jsonb,
  was_already_signed boolean
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_assessment public.intake_assessments%rowtype;
  v_signature public.intake_assessment_signatures%rowtype;
  v_signed_by_name text := nullif(trim(coalesce(p_signed_by_name, '')), '');
  v_signed_at timestamptz := coalesce(p_signed_at, now());
  v_signature_artifact_storage_path text := nullif(trim(coalesce(p_signature_artifact_storage_path, '')), '');
  v_signature_artifact_member_file_id text := nullif(trim(coalesce(p_signature_artifact_member_file_id, '')), '');
  v_signature_metadata jsonb := coalesce(p_signature_metadata, '{}'::jsonb);
begin
  if p_assessment_id is null then
    raise exception 'assessment id is required';
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
  into v_assessment
  from public.intake_assessments ia
  where ia.id = p_assessment_id
  for update;

  if not found then
    raise exception 'Intake assessment % was not found.', p_assessment_id;
  end if;

  if v_assessment.member_id is distinct from p_member_id then
    raise exception 'Intake assessment % does not belong to member %.', p_assessment_id, p_member_id;
  end if;

  select *
  into v_signature
  from public.intake_assessment_signatures ias
  where ias.assessment_id = p_assessment_id
  for update;

  if found and coalesce(v_signature.status, '') = 'voided' then
    raise exception 'Intake assessment % signature has been voided.', p_assessment_id;
  end if;

  if coalesce(v_assessment.signature_status, '') = 'voided' then
    raise exception 'Intake assessment % cannot be signed because it is voided.', p_assessment_id;
  end if;

  if found and coalesce(v_signature.status, '') = 'signed' then
    update public.intake_assessments ia
    set
      signed_by = v_signature.signed_by_name,
      signed_by_user_id = v_signature.signed_by_user_id,
      signed_at = v_signature.signed_at,
      signature_status = 'signed',
      signature_metadata = coalesce(v_signature.signature_metadata, '{}'::jsonb),
      updated_at = coalesce(v_signature.signed_at, v_signed_at, now())
    where ia.id = p_assessment_id;

    return query
    select
      v_signature.assessment_id,
      v_signature.member_id,
      v_signature.signed_by_user_id,
      v_signature.signed_by_name,
      v_signature.signed_at,
      v_signature.status,
      v_signature.signature_artifact_storage_path,
      v_signature.signature_artifact_member_file_id,
      coalesce(v_signature.signature_metadata, '{}'::jsonb),
      true;
    return;
  end if;

  if coalesce(v_assessment.signature_status, '') = 'signed' then
    insert into public.intake_assessment_signatures (
      assessment_id,
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
      v_assessment.id,
      v_assessment.member_id,
      coalesce(v_assessment.signed_by_user_id, p_signed_by_user_id),
      coalesce(nullif(trim(coalesce(v_assessment.signed_by, '')), ''), v_signed_by_name),
      coalesce(v_assessment.signed_at, v_signed_at),
      'signed',
      v_signature_artifact_storage_path,
      v_signature_artifact_member_file_id,
      coalesce(v_assessment.signature_metadata, v_signature_metadata, '{}'::jsonb),
      coalesce(v_assessment.created_at, now()),
      coalesce(v_assessment.updated_at, v_signed_at, now())
    )
    on conflict (assessment_id) do update
    set
      signed_by_user_id = excluded.signed_by_user_id,
      signed_by_name = excluded.signed_by_name,
      signed_at = excluded.signed_at,
      status = 'signed',
      signature_artifact_storage_path = coalesce(
        excluded.signature_artifact_storage_path,
        public.intake_assessment_signatures.signature_artifact_storage_path
      ),
      signature_artifact_member_file_id = coalesce(
        excluded.signature_artifact_member_file_id,
        public.intake_assessment_signatures.signature_artifact_member_file_id
      ),
      signature_metadata = coalesce(excluded.signature_metadata, public.intake_assessment_signatures.signature_metadata),
      updated_at = excluded.updated_at
    returning * into v_signature;

    return query
    select
      v_signature.assessment_id,
      v_signature.member_id,
      v_signature.signed_by_user_id,
      v_signature.signed_by_name,
      v_signature.signed_at,
      v_signature.status,
      v_signature.signature_artifact_storage_path,
      v_signature.signature_artifact_member_file_id,
      coalesce(v_signature.signature_metadata, '{}'::jsonb),
      true;
    return;
  end if;

  insert into public.intake_assessment_signatures (
    assessment_id,
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
    p_assessment_id,
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
  on conflict (assessment_id) do update
  set
    signed_by_user_id = excluded.signed_by_user_id,
    signed_by_name = excluded.signed_by_name,
    signed_at = excluded.signed_at,
    status = 'signed',
    signature_artifact_storage_path = coalesce(
      excluded.signature_artifact_storage_path,
      public.intake_assessment_signatures.signature_artifact_storage_path
    ),
    signature_artifact_member_file_id = coalesce(
      excluded.signature_artifact_member_file_id,
      public.intake_assessment_signatures.signature_artifact_member_file_id
    ),
    signature_metadata = coalesce(excluded.signature_metadata, public.intake_assessment_signatures.signature_metadata),
    updated_at = excluded.updated_at
  returning * into v_signature;

  update public.intake_assessments ia
  set
    signed_by = v_signed_by_name,
    signed_by_user_id = p_signed_by_user_id,
    signed_at = v_signed_at,
    signature_status = 'signed',
    signature_metadata = v_signature_metadata,
    updated_at = v_signed_at
  where ia.id = p_assessment_id;

  return query
  select
    v_signature.assessment_id,
    v_signature.member_id,
    v_signature.signed_by_user_id,
    v_signature.signed_by_name,
    v_signature.signed_at,
    v_signature.status,
    v_signature.signature_artifact_storage_path,
    v_signature.signature_artifact_member_file_id,
    coalesce(v_signature.signature_metadata, '{}'::jsonb),
    false;
end;
$$;

grant execute on function public.rpc_finalize_intake_assessment_signature(
  uuid,
  uuid,
  uuid,
  text,
  timestamptz,
  text,
  text,
  jsonb
) to authenticated, service_role;
