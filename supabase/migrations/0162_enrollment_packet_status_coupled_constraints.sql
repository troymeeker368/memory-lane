-- Backfill and enforce lifecycle invariants for enrollment packet requests.
-- Use NOT VALID -> VALIDATE so the deploy sequence remains production-safe.

update public.enrollment_packet_requests
set
  completed_at = coalesce(completed_at, last_family_activity_at, opened_at, sent_at, updated_at, created_at),
  last_family_activity_at = coalesce(last_family_activity_at, completed_at, opened_at, sent_at, updated_at, created_at)
where status = 'completed'
  and (completed_at is null or last_family_activity_at is null);

update public.enrollment_packet_requests
set
  voided_at = coalesce(voided_at, updated_at, last_family_activity_at, opened_at, sent_at, created_at),
  voided_by_user_id = coalesce(voided_by_user_id, sender_user_id),
  void_reason = coalesce(nullif(trim(coalesce(void_reason, '')), ''), 'Voided before lifecycle constraint hardening.')
where status = 'voided'
  and (
    voided_at is null
    or voided_by_user_id is null
    or nullif(trim(coalesce(void_reason, '')), '') is null
  );

do $$
declare
  v_invalid_completed integer;
  v_invalid_voided integer;
begin
  select count(*)
  into v_invalid_completed
  from public.enrollment_packet_requests
  where status = 'completed'
    and completed_at is null;

  if v_invalid_completed > 0 then
    raise exception 'Enrollment packet lifecycle hardening aborted: % completed row(s) still missing completed_at after backfill.', v_invalid_completed;
  end if;

  select count(*)
  into v_invalid_voided
  from public.enrollment_packet_requests
  where status = 'voided'
    and (
      voided_at is null
      or voided_by_user_id is null
      or nullif(trim(coalesce(void_reason, '')), '') is null
    );

  if v_invalid_voided > 0 then
    raise exception 'Enrollment packet lifecycle hardening aborted: % voided row(s) still missing void metadata after backfill.', v_invalid_voided;
  end if;
end
$$;

alter table public.enrollment_packet_requests
  drop constraint if exists enrollment_packet_requests_completed_requires_completed_at;

alter table public.enrollment_packet_requests
  add constraint enrollment_packet_requests_completed_requires_completed_at
  check (
    status <> 'completed'
    or completed_at is not null
  ) not valid;

alter table public.enrollment_packet_requests
  drop constraint if exists enrollment_packet_requests_voided_requires_void_metadata;

alter table public.enrollment_packet_requests
  add constraint enrollment_packet_requests_voided_requires_void_metadata
  check (
    status <> 'voided'
    or (
      voided_at is not null
      and voided_by_user_id is not null
      and nullif(trim(coalesce(void_reason, '')), '') is not null
    )
  ) not valid;

alter table public.enrollment_packet_requests
  validate constraint enrollment_packet_requests_completed_requires_completed_at;

alter table public.enrollment_packet_requests
  validate constraint enrollment_packet_requests_voided_requires_void_metadata;
