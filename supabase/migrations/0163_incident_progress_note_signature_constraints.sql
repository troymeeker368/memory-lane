-- Backfill and enforce status-coupled signature invariants for incidents and progress notes.
-- Validate only after remediation so deploys fail loudly on non-remediable legacy rows.

update public.incidents
set
  submitter_signature_attested = false,
  submitter_signature_name = null,
  submitter_signed_at = null,
  submitter_signature_artifact_storage_path = null
where status in ('draft', 'returned')
  and (
    coalesce(submitter_signature_attested, false) = true
    or nullif(trim(coalesce(submitter_signature_name, '')), '') is not null
    or submitter_signed_at is not null
    or nullif(trim(coalesce(submitter_signature_artifact_storage_path, '')), '') is not null
  );

update public.incidents
set
  submitter_signature_attested = true,
  submitter_signature_name = coalesce(
    nullif(trim(coalesce(submitter_signature_name, '')), ''),
    nullif(trim(coalesce(submitted_by_name_snapshot, '')), ''),
    nullif(trim(coalesce(reporter_name_snapshot, '')), '')
  ),
  submitter_signed_at = coalesce(submitter_signed_at, submitted_at, director_reviewed_at, updated_at, created_at)
where status in ('submitted', 'approved', 'closed')
  and (
    coalesce(submitter_signature_attested, false) = false
    or nullif(trim(coalesce(submitter_signature_name, '')), '') is null
    or submitter_signed_at is null
  );

do $$
declare
  v_invalid_incidents integer;
begin
  select count(*)
  into v_invalid_incidents
  from public.incidents
  where status in ('submitted', 'approved', 'closed')
    and (
      coalesce(submitter_signature_attested, false) = false
      or nullif(trim(coalesce(submitter_signature_name, '')), '') is null
      or submitter_signed_at is null
      or nullif(trim(coalesce(submitter_signature_artifact_storage_path, '')), '') is null
    );

  if v_invalid_incidents > 0 then
    raise exception 'Incident signature hardening aborted: % submitted/approved/closed row(s) still missing submitter signature data after remediation.', v_invalid_incidents;
  end if;
end
$$;

alter table public.incidents
  drop constraint if exists incidents_submitter_signature_status_scope;

alter table public.incidents
  add constraint incidents_submitter_signature_status_scope
  check (
    (
      status in ('submitted', 'approved', 'closed')
      and submitter_signature_attested = true
      and nullif(trim(coalesce(submitter_signature_name, '')), '') is not null
      and submitter_signed_at is not null
      and nullif(trim(coalesce(submitter_signature_artifact_storage_path, '')), '') is not null
    )
    or (
      status in ('draft', 'returned')
      and coalesce(submitter_signature_attested, false) = false
      and submitter_signature_name is null
      and submitter_signed_at is null
      and submitter_signature_artifact_storage_path is null
    )
  ) not valid;

alter table public.incidents
  validate constraint incidents_submitter_signature_status_scope;

update public.progress_notes
set
  signature_attested = false,
  signature_blob = null,
  signature_metadata = '{}'::jsonb
where status = 'draft'
  and (
    coalesce(signature_attested, false) = true
    or nullif(trim(coalesce(signature_blob, '')), '') is not null
    or coalesce(signature_metadata, '{}'::jsonb) <> '{}'::jsonb
  );

update public.progress_notes
set
  signature_attested = true,
  signature_metadata = case
    when coalesce(jsonb_typeof(signature_metadata), '') = 'object'
         and coalesce(signature_metadata, '{}'::jsonb) <> '{}'::jsonb
      then signature_metadata
    else jsonb_strip_nulls(
      jsonb_build_object(
        'signedVia', 'progress-note-signature-hardening-backfill',
        'attested', true,
        'signedAt', signed_at,
        'signedByUserId', signed_by_user_id,
        'signedByName', signed_by_name,
        'noteDate', note_date
      )
    )
  end
where status = 'signed'
  and (
    coalesce(signature_attested, false) = false
    or coalesce(jsonb_typeof(signature_metadata), '') <> 'object'
    or coalesce(signature_metadata, '{}'::jsonb) = '{}'::jsonb
  );

do $$
declare
  v_invalid_progress_notes integer;
begin
  select count(*)
  into v_invalid_progress_notes
  from public.progress_notes
  where status = 'signed'
    and (
      coalesce(signature_attested, false) = false
      or nullif(trim(coalesce(signature_blob, '')), '') is null
      or coalesce(jsonb_typeof(signature_metadata), '') <> 'object'
      or coalesce(signature_metadata, '{}'::jsonb) = '{}'::jsonb
    );

  if v_invalid_progress_notes > 0 then
    raise exception 'Progress note signature hardening aborted: % signed row(s) still missing signature blob or metadata after remediation.', v_invalid_progress_notes;
  end if;
end
$$;

alter table public.progress_notes
  drop constraint if exists progress_notes_signature_status_scope;

alter table public.progress_notes
  add constraint progress_notes_signature_status_scope
  check (
    (
      status = 'draft'
      and coalesce(signature_attested, false) = false
      and signature_blob is null
      and coalesce(signature_metadata, '{}'::jsonb) = '{}'::jsonb
    )
    or (
      status = 'signed'
      and signature_attested = true
      and nullif(trim(coalesce(signature_blob, '')), '') is not null
      and coalesce(jsonb_typeof(signature_metadata), '') = 'object'
      and coalesce(signature_metadata, '{}'::jsonb) <> '{}'::jsonb
    )
  ) not valid;

alter table public.progress_notes
  validate constraint progress_notes_signature_status_scope;
