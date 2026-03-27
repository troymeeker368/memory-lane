create or replace function public.rpc_transition_care_plan_caregiver_status(
  p_care_plan_id uuid,
  p_status text,
  p_updated_at timestamptz default now(),
  p_actor_user_id uuid default null,
  p_actor_name text default null,
  p_caregiver_sent_at timestamptz default null,
  p_caregiver_viewed_at timestamptz default null,
  p_caregiver_signature_error text default null,
  p_expected_current_statuses text[] default null
)
returns table (
  care_plan_id uuid,
  caregiver_signature_status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text := trim(coalesce(p_status, ''));
  v_expected_statuses text[] := (
    select case
      when p_expected_current_statuses is null then null
      else array_agg(nullif(trim(value), ''))
    end
    from unnest(coalesce(p_expected_current_statuses, array[]::text[])) as value
    where nullif(trim(value), '') is not null
  );
  v_current_status text;
begin
  if p_care_plan_id is null then
    raise exception 'rpc_transition_care_plan_caregiver_status requires p_care_plan_id';
  end if;
  if v_status = '' then
    raise exception 'rpc_transition_care_plan_caregiver_status requires p_status';
  end if;

  select cp.caregiver_signature_status
  into v_current_status
  from public.care_plans as cp
  where cp.id = p_care_plan_id
  for update;

  if not found then
    raise exception 'Care plan was not found.';
  end if;

  if v_expected_statuses is null and v_status in ('viewed', 'expired') then
    v_expected_statuses := array['ready_to_send', 'send_failed', 'sent', 'viewed', 'expired'];
  end if;

  if coalesce(v_current_status, '') = 'signed'
     and v_status in ('send_failed', 'viewed', 'expired', 'ready_to_send', 'sent') then
    raise exception 'Care plan % caregiver signature is already signed and cannot move backward to %.', p_care_plan_id, v_status;
  end if;

  if v_expected_statuses is not null and coalesce(array_length(v_expected_statuses, 1), 0) > 0 then
    if coalesce(v_current_status, '') <> all(v_expected_statuses) then
      raise exception
        'Care plan % caregiver signature transition expected current status % but found %.',
        p_care_plan_id,
        array_to_string(v_expected_statuses, ', '),
        coalesce(v_current_status, 'null');
    end if;
  end if;

  update public.care_plans
  set
    caregiver_signature_status = v_status,
    caregiver_sent_at = case when p_caregiver_sent_at is distinct from null then p_caregiver_sent_at else caregiver_sent_at end,
    caregiver_viewed_at = case when p_caregiver_viewed_at is distinct from null then p_caregiver_viewed_at else caregiver_viewed_at end,
    caregiver_signature_error = case
      when p_caregiver_signature_error is null then null
      else nullif(trim(p_caregiver_signature_error), '')
    end,
    updated_by_user_id = p_actor_user_id,
    updated_by_name = nullif(trim(coalesce(p_actor_name, '')), ''),
    updated_at = p_updated_at
  where id = p_care_plan_id;

  return query
  select
    p_care_plan_id,
    v_status;
end;
$$;

grant execute on function public.rpc_transition_care_plan_caregiver_status(
  uuid,
  text,
  timestamptz,
  uuid,
  text,
  timestamptz,
  timestamptz,
  text,
  text[]
) to authenticated, service_role;
