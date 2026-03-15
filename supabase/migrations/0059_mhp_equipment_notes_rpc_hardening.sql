create or replace function public.rpc_mutate_member_equipment_workflow(
  p_member_id uuid,
  p_operation text,
  p_equipment_id uuid default null,
  p_payload jsonb default '{}'::jsonb,
  p_actor_user_id uuid default null,
  p_actor_name text default null,
  p_now timestamptz default now()
)
returns table (
  entity_row jsonb,
  changed boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_operation text := lower(coalesce(p_operation, ''));
  v_row public.member_equipment%rowtype;
  v_event_type text;
  v_status text;
begin
  if p_member_id is null then
    raise exception 'rpc_mutate_member_equipment_workflow requires p_member_id';
  end if;

  if v_operation not in ('create', 'update', 'delete') then
    raise exception 'rpc_mutate_member_equipment_workflow requires create/update/delete';
  end if;

  if v_operation = 'create' then
    insert into public.member_equipment (
      member_id,
      equipment_type,
      provider_source,
      status,
      comments,
      created_by_user_id,
      created_by_name,
      created_at,
      updated_at
    )
    values (
      p_member_id,
      nullif(trim(coalesce(p_payload ->> 'equipment_type', '')), ''),
      nullif(trim(coalesce(p_payload ->> 'provider_source', '')), ''),
      nullif(trim(coalesce(p_payload ->> 'status', '')), ''),
      nullif(trim(coalesce(p_payload ->> 'comments', '')), ''),
      p_actor_user_id,
      nullif(trim(coalesce(p_actor_name, '')), ''),
      v_now,
      v_now
    )
    returning * into v_row;
  elsif v_operation = 'update' then
    update public.member_equipment
    set
      equipment_type = case when p_payload ? 'equipment_type' then nullif(trim(coalesce(p_payload ->> 'equipment_type', '')), '') else equipment_type end,
      provider_source = case when p_payload ? 'provider_source' then nullif(trim(coalesce(p_payload ->> 'provider_source', '')), '') else provider_source end,
      status = case when p_payload ? 'status' then nullif(trim(coalesce(p_payload ->> 'status', '')), '') else status end,
      comments = case when p_payload ? 'comments' then nullif(trim(coalesce(p_payload ->> 'comments', '')), '') else comments end,
      updated_at = v_now
    where id = p_equipment_id
      and member_id = p_member_id
    returning * into v_row;
  else
    delete from public.member_equipment
    where id = p_equipment_id
      and member_id = p_member_id
    returning * into v_row;
  end if;

  if v_row.id is null then
    entity_row := null;
    changed := false;
    return next;
    return;
  end if;

  insert into public.member_health_profiles (
    member_id,
    created_at,
    updated_at,
    updated_by_user_id,
    updated_by_name
  )
  values (
    p_member_id,
    v_now,
    v_now,
    p_actor_user_id,
    nullif(trim(coalesce(p_actor_name, '')), '')
  )
  on conflict (member_id) do update
  set
    updated_at = excluded.updated_at,
    updated_by_user_id = excluded.updated_by_user_id,
    updated_by_name = excluded.updated_by_name;

  v_event_type := case
    when v_operation = 'create' then 'member_equipment_created'
    when v_operation = 'update' then 'member_equipment_updated'
    else 'member_equipment_deleted'
  end;
  v_status := case
    when v_operation = 'create' then 'created'
    when v_operation = 'update' then 'updated'
    else 'deleted'
  end;

  insert into public.system_events (
    event_type,
    entity_type,
    entity_id,
    actor_type,
    actor_id,
    actor_user_id,
    metadata,
    status,
    severity,
    created_at
  )
  values (
    v_event_type,
    'member_equipment',
    v_row.id,
    'user',
    p_actor_user_id,
    p_actor_user_id,
    jsonb_build_object('member_id', p_member_id),
    v_status,
    'low',
    v_now
  );

  entity_row := to_jsonb(v_row);
  changed := true;
  return next;
end;
$$;

grant execute on function public.rpc_mutate_member_equipment_workflow(
  uuid,
  text,
  uuid,
  jsonb,
  uuid,
  text,
  timestamptz
) to authenticated, service_role;

create or replace function public.rpc_mutate_member_note_workflow(
  p_member_id uuid,
  p_operation text,
  p_note_id uuid default null,
  p_payload jsonb default '{}'::jsonb,
  p_actor_user_id uuid default null,
  p_actor_name text default null,
  p_now timestamptz default now()
)
returns table (
  entity_row jsonb,
  changed boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_operation text := lower(coalesce(p_operation, ''));
  v_row public.member_notes%rowtype;
  v_event_type text;
  v_status text;
begin
  if p_member_id is null then
    raise exception 'rpc_mutate_member_note_workflow requires p_member_id';
  end if;

  if v_operation not in ('create', 'update', 'delete') then
    raise exception 'rpc_mutate_member_note_workflow requires create/update/delete';
  end if;

  if v_operation = 'create' then
    insert into public.member_notes (
      member_id,
      note_type,
      note_text,
      created_by_user_id,
      created_by_name,
      created_at,
      updated_at
    )
    values (
      p_member_id,
      nullif(trim(coalesce(p_payload ->> 'note_type', '')), ''),
      nullif(trim(coalesce(p_payload ->> 'note_text', '')), ''),
      p_actor_user_id,
      nullif(trim(coalesce(p_actor_name, '')), ''),
      v_now,
      v_now
    )
    returning * into v_row;
  elsif v_operation = 'update' then
    update public.member_notes
    set
      note_type = case when p_payload ? 'note_type' then nullif(trim(coalesce(p_payload ->> 'note_type', '')), '') else note_type end,
      note_text = case when p_payload ? 'note_text' then nullif(trim(coalesce(p_payload ->> 'note_text', '')), '') else note_text end,
      updated_at = v_now
    where id = p_note_id
      and member_id = p_member_id
    returning * into v_row;
  else
    delete from public.member_notes
    where id = p_note_id
      and member_id = p_member_id
    returning * into v_row;
  end if;

  if v_row.id is null then
    entity_row := null;
    changed := false;
    return next;
    return;
  end if;

  insert into public.member_health_profiles (
    member_id,
    created_at,
    updated_at,
    updated_by_user_id,
    updated_by_name
  )
  values (
    p_member_id,
    v_now,
    v_now,
    p_actor_user_id,
    nullif(trim(coalesce(p_actor_name, '')), '')
  )
  on conflict (member_id) do update
  set
    updated_at = excluded.updated_at,
    updated_by_user_id = excluded.updated_by_user_id,
    updated_by_name = excluded.updated_by_name;

  v_event_type := case
    when v_operation = 'create' then 'member_note_created'
    when v_operation = 'update' then 'member_note_updated'
    else 'member_note_deleted'
  end;
  v_status := case
    when v_operation = 'create' then 'created'
    when v_operation = 'update' then 'updated'
    else 'deleted'
  end;

  insert into public.system_events (
    event_type,
    entity_type,
    entity_id,
    actor_type,
    actor_id,
    actor_user_id,
    metadata,
    status,
    severity,
    created_at
  )
  values (
    v_event_type,
    'member_note',
    v_row.id,
    'user',
    p_actor_user_id,
    p_actor_user_id,
    jsonb_build_object('member_id', p_member_id),
    v_status,
    'low',
    v_now
  );

  entity_row := to_jsonb(v_row);
  changed := true;
  return next;
end;
$$;

grant execute on function public.rpc_mutate_member_note_workflow(
  uuid,
  text,
  uuid,
  jsonb,
  uuid,
  text,
  timestamptz
) to authenticated, service_role;
