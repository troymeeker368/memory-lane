create or replace function public.rpc_create_draft_physician_order_from_intake(
  p_assessment_id uuid,
  p_member_id uuid,
  p_payload jsonb,
  p_attempted_at timestamptz default now()
)
returns table (
  physician_order_id uuid,
  draft_pof_status text,
  was_existing boolean
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_assessment public.intake_assessments%rowtype;
  v_existing public.physician_orders%rowtype;
  v_member public.members%rowtype;
  v_order public.physician_orders%rowtype;
  v_attempted_at timestamptz := coalesce(p_attempted_at, now());
  v_version_number integer;
begin
  if p_assessment_id is null then
    raise exception 'assessment id is required';
  end if;
  if p_member_id is null then
    raise exception 'member id is required';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'p_payload must be a JSON object';
  end if;

  select *
  into v_assessment
  from public.intake_assessments
  where id = p_assessment_id
  for update;

  if not found then
    raise exception 'Intake assessment % was not found.', p_assessment_id;
  end if;

  if v_assessment.member_id is distinct from p_member_id then
    raise exception 'Intake assessment % does not belong to member %.', p_assessment_id, p_member_id;
  end if;

  if coalesce(lower(v_assessment.signature_status), '') <> 'signed' then
    raise exception 'Intake assessment % must be signed before draft POF creation.', p_assessment_id;
  end if;

  select *
  into v_member
  from public.members
  where id = p_member_id
  for update;

  if not found then
    raise exception 'Member % was not found.', p_member_id;
  end if;

  select *
  into v_existing
  from public.physician_orders
  where intake_assessment_id = p_assessment_id
    and status in ('draft', 'sent')
  order by created_at desc
  limit 1
  for update;

  if found then
    update public.intake_assessments
    set
      draft_pof_status = 'created',
      draft_pof_attempted_at = v_attempted_at,
      draft_pof_error = null,
      updated_at = v_attempted_at
    where id = p_assessment_id;

    return query
    select
      v_existing.id,
      'created',
      true;
    return;
  end if;

  select coalesce(max(po.version_number), 0) + 1
  into v_version_number
  from public.physician_orders po
  where po.member_id = p_member_id;

  v_order := jsonb_populate_record(null::public.physician_orders, p_payload);
  v_order.id := coalesce(v_order.id, gen_random_uuid());
  v_order.member_id := p_member_id;
  v_order.intake_assessment_id := p_assessment_id;
  v_order.version_number := v_version_number;
  v_order.status := coalesce(nullif(trim(coalesce(v_order.status, '')), ''), 'draft');
  v_order.is_active_signed := false;
  v_order.superseded_by := null;
  v_order.superseded_at := null;
  v_order.sent_at := null;
  v_order.signed_at := null;
  v_order.effective_at := null;
  v_order.next_renewal_due_date := null;
  v_order.created_at := coalesce(v_order.created_at, v_attempted_at);
  v_order.updated_at := coalesce(v_order.updated_at, v_attempted_at);

  begin
    insert into public.physician_orders
    select (v_order).*;
  exception
    when unique_violation then
      select *
      into v_existing
      from public.physician_orders
      where intake_assessment_id = p_assessment_id
        and status in ('draft', 'sent')
      order by created_at desc
      limit 1
      for update;

      if found then
        update public.intake_assessments
        set
          draft_pof_status = 'created',
          draft_pof_attempted_at = v_attempted_at,
          draft_pof_error = null,
          updated_at = v_attempted_at
        where id = p_assessment_id;

        return query
        select
          v_existing.id,
          'created',
          true;
        return;
      end if;

      raise;
  end;

  update public.intake_assessments
  set
    draft_pof_status = 'created',
    draft_pof_attempted_at = v_attempted_at,
    draft_pof_error = null,
    updated_at = v_attempted_at
  where id = p_assessment_id;

  return query
  select
    v_order.id,
    'created',
    false;
end;
$$;

grant execute on function public.rpc_create_draft_physician_order_from_intake(
  uuid,
  uuid,
  jsonb,
  timestamptz
) to authenticated, service_role;
