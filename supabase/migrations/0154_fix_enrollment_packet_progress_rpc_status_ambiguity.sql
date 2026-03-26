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

  update public.enrollment_packet_requests as requests
  set
    status = 'in_progress',
    opened_at = coalesce(requests.opened_at, p_updated_at),
    last_family_activity_at = p_updated_at,
    updated_at = p_updated_at
  where requests.id = p_packet_id
    and requests.status in ('draft', 'sent', 'in_progress')
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
