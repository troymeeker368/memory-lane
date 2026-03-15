create or replace function public.rpc_mutate_member_diagnosis_workflow(
  p_member_id uuid,
  p_operation text,
  p_diagnosis_id uuid default null,
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
  v_row public.member_diagnoses%rowtype;
  v_operation text := lower(coalesce(p_operation, ''));
  v_diagnosis_type text;
  v_event_type text;
  v_status text;
begin
  if p_member_id is null then
    raise exception 'rpc_mutate_member_diagnosis_workflow requires p_member_id';
  end if;

  if v_operation not in ('create', 'update', 'delete') then
    raise exception 'rpc_mutate_member_diagnosis_workflow requires create/update/delete';
  end if;

  perform pg_advisory_xact_lock(hashtext('mhp-diagnosis:' || p_member_id::text)::bigint);

  if v_operation = 'create' then
    select case when exists (
      select 1 from public.member_diagnoses where member_id = p_member_id
    ) then 'secondary' else 'primary' end
    into v_diagnosis_type;

    insert into public.member_diagnoses (
      member_id,
      diagnosis_type,
      diagnosis_name,
      diagnosis_code,
      date_added,
      comments,
      created_by_user_id,
      created_by_name,
      created_at,
      updated_at
    )
    values (
      p_member_id,
      v_diagnosis_type,
      nullif(trim(coalesce(p_payload ->> 'diagnosis_name', '')), ''),
      nullif(trim(coalesce(p_payload ->> 'diagnosis_code', '')), ''),
      coalesce(nullif(p_payload ->> 'date_added', '')::date, v_now::date),
      nullif(trim(coalesce(p_payload ->> 'comments', '')), ''),
      p_actor_user_id,
      nullif(trim(coalesce(p_actor_name, '')), ''),
      v_now,
      v_now
    )
    returning * into v_row;
  elsif v_operation = 'update' then
    update public.member_diagnoses
    set
      diagnosis_name = case when p_payload ? 'diagnosis_name' then nullif(trim(coalesce(p_payload ->> 'diagnosis_name', '')), '') else diagnosis_name end,
      diagnosis_code = case when p_payload ? 'diagnosis_code' then nullif(trim(coalesce(p_payload ->> 'diagnosis_code', '')), '') else diagnosis_code end,
      date_added = case when p_payload ? 'date_added' then nullif(p_payload ->> 'date_added', '')::date else date_added end,
      comments = case when p_payload ? 'comments' then nullif(trim(coalesce(p_payload ->> 'comments', '')), '') else comments end,
      updated_at = v_now
    where id = p_diagnosis_id
      and member_id = p_member_id
    returning * into v_row;
  else
    delete from public.member_diagnoses
    where id = p_diagnosis_id
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
    when v_operation = 'create' then 'member_diagnosis_created'
    when v_operation = 'update' then 'member_diagnosis_updated'
    else 'member_diagnosis_deleted'
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
    'member_diagnosis',
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

grant execute on function public.rpc_mutate_member_diagnosis_workflow(
  uuid,
  text,
  uuid,
  jsonb,
  uuid,
  text,
  timestamptz
) to authenticated, service_role;

create or replace function public.rpc_mutate_member_medication_workflow(
  p_member_id uuid,
  p_operation text,
  p_medication_id uuid default null,
  p_payload jsonb default '{}'::jsonb,
  p_actor_user_id uuid default null,
  p_actor_name text default null,
  p_now timestamptz default now(),
  p_mar_start_date date default null,
  p_mar_end_date date default null
)
returns table (
  entity_row jsonb,
  changed boolean,
  anchor_physician_order_id uuid,
  synced_medications integer,
  inserted_schedules integer,
  patched_schedules integer,
  reactivated_schedules integer,
  deactivated_schedules integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_operation text := lower(coalesce(p_operation, ''));
  v_row public.member_medications%rowtype;
  v_event_type text;
  v_status text;
  v_start_date date := coalesce(p_mar_start_date, v_now::date);
  v_end_date date := coalesce(p_mar_end_date, (v_now::date + 30));
  v_scheduled_times text[] := coalesce(
    array(select jsonb_array_elements_text(coalesce(p_payload -> 'scheduled_times', '[]'::jsonb))),
    '{}'::text[]
  );
begin
  if p_member_id is null then
    raise exception 'rpc_mutate_member_medication_workflow requires p_member_id';
  end if;

  if v_operation not in ('create', 'update', 'delete', 'inactivate', 'reactivate') then
    raise exception 'rpc_mutate_member_medication_workflow requires create/update/delete/inactivate/reactivate';
  end if;

  if v_start_date > v_end_date then
    v_start_date := p_mar_end_date;
    v_end_date := p_mar_start_date;
  end if;

  if v_operation = 'create' then
    insert into public.member_medications (
      member_id,
      medication_name,
      date_started,
      medication_status,
      inactivated_at,
      dose,
      quantity,
      form,
      frequency,
      route,
      route_laterality,
      given_at_center,
      prn,
      prn_instructions,
      scheduled_times,
      comments,
      created_by_user_id,
      created_by_name,
      created_at,
      updated_at
    )
    values (
      p_member_id,
      nullif(trim(coalesce(p_payload ->> 'medication_name', '')), ''),
      coalesce(nullif(p_payload ->> 'date_started', '')::date, v_now::date),
      coalesce(nullif(p_payload ->> 'medication_status', ''), 'active'),
      nullif(p_payload ->> 'inactivated_at', '')::date,
      nullif(trim(coalesce(p_payload ->> 'dose', '')), ''),
      nullif(trim(coalesce(p_payload ->> 'quantity', '')), ''),
      nullif(trim(coalesce(p_payload ->> 'form', '')), ''),
      nullif(trim(coalesce(p_payload ->> 'frequency', '')), ''),
      nullif(trim(coalesce(p_payload ->> 'route', '')), ''),
      nullif(trim(coalesce(p_payload ->> 'route_laterality', '')), ''),
      coalesce((p_payload ->> 'given_at_center')::boolean, true),
      coalesce((p_payload ->> 'prn')::boolean, false),
      nullif(trim(coalesce(p_payload ->> 'prn_instructions', '')), ''),
      v_scheduled_times,
      nullif(trim(coalesce(p_payload ->> 'comments', '')), ''),
      p_actor_user_id,
      nullif(trim(coalesce(p_actor_name, '')), ''),
      v_now,
      v_now
    )
    returning * into v_row;
  elsif v_operation = 'update' then
    update public.member_medications
    set
      medication_name = case when p_payload ? 'medication_name' then nullif(trim(coalesce(p_payload ->> 'medication_name', '')), '') else medication_name end,
      date_started = case when p_payload ? 'date_started' then coalesce(nullif(p_payload ->> 'date_started', '')::date, date_started) else date_started end,
      dose = case when p_payload ? 'dose' then nullif(trim(coalesce(p_payload ->> 'dose', '')), '') else dose end,
      quantity = case when p_payload ? 'quantity' then nullif(trim(coalesce(p_payload ->> 'quantity', '')), '') else quantity end,
      form = case when p_payload ? 'form' then nullif(trim(coalesce(p_payload ->> 'form', '')), '') else form end,
      frequency = case when p_payload ? 'frequency' then nullif(trim(coalesce(p_payload ->> 'frequency', '')), '') else frequency end,
      route = case when p_payload ? 'route' then nullif(trim(coalesce(p_payload ->> 'route', '')), '') else route end,
      route_laterality = case when p_payload ? 'route_laterality' then nullif(trim(coalesce(p_payload ->> 'route_laterality', '')), '') else route_laterality end,
      given_at_center = case when p_payload ? 'given_at_center' then coalesce((p_payload ->> 'given_at_center')::boolean, given_at_center) else given_at_center end,
      prn = case when p_payload ? 'prn' then coalesce((p_payload ->> 'prn')::boolean, prn) else prn end,
      prn_instructions = case when p_payload ? 'prn_instructions' then nullif(trim(coalesce(p_payload ->> 'prn_instructions', '')), '') else prn_instructions end,
      scheduled_times = case when p_payload ? 'scheduled_times' then v_scheduled_times else scheduled_times end,
      comments = case when p_payload ? 'comments' then nullif(trim(coalesce(p_payload ->> 'comments', '')), '') else comments end,
      updated_at = v_now
    where id = p_medication_id
      and member_id = p_member_id
    returning * into v_row;
  elsif v_operation = 'delete' then
    delete from public.member_medications
    where id = p_medication_id
      and member_id = p_member_id
    returning * into v_row;
  elsif v_operation = 'inactivate' then
    update public.member_medications
    set
      medication_status = 'inactive',
      inactivated_at = coalesce(nullif(p_payload ->> 'inactivated_at', '')::date, v_now::date),
      updated_at = v_now
    where id = p_medication_id
      and member_id = p_member_id
    returning * into v_row;
  else
    update public.member_medications
    set
      medication_status = 'active',
      date_started = coalesce(nullif(p_payload ->> 'date_started', '')::date, v_now::date),
      inactivated_at = null,
      updated_at = v_now
    where id = p_medication_id
      and member_id = p_member_id
    returning * into v_row;
  end if;

  if v_row.id is null then
    entity_row := null;
    changed := false;
    anchor_physician_order_id := null;
    synced_medications := 0;
    inserted_schedules := 0;
    patched_schedules := 0;
    reactivated_schedules := 0;
    deactivated_schedules := 0;
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
    when v_operation = 'create' then 'member_medication_created'
    when v_operation = 'update' then 'member_medication_updated'
    when v_operation = 'delete' then 'member_medication_deleted'
    when v_operation = 'inactivate' then 'member_medication_inactivated'
    else 'member_medication_reactivated'
  end;
  v_status := case
    when v_operation = 'create' then 'created'
    when v_operation = 'update' then 'updated'
    when v_operation = 'delete' then 'deleted'
    when v_operation = 'inactivate' then 'updated'
    else 'updated'
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
    'member_medication',
    v_row.id,
    'user',
    p_actor_user_id,
    p_actor_user_id,
    jsonb_build_object('member_id', p_member_id),
    v_status,
    'low',
    v_now
  );

  select
    sync.anchor_physician_order_id,
    sync.synced_medications,
    sync.inserted_schedules,
    sync.patched_schedules,
    sync.reactivated_schedules,
    sync.deactivated_schedules
  into
    anchor_physician_order_id,
    synced_medications,
    inserted_schedules,
    patched_schedules,
    reactivated_schedules,
    deactivated_schedules
  from public.rpc_reconcile_member_mar_state(
    p_member_id,
    v_start_date,
    v_end_date,
    null,
    v_now
  ) as sync;

  entity_row := to_jsonb(v_row);
  changed := true;
  return next;
end;
$$;

grant execute on function public.rpc_mutate_member_medication_workflow(
  uuid,
  text,
  uuid,
  jsonb,
  uuid,
  text,
  timestamptz,
  date,
  date
) to authenticated, service_role;

create or replace function public.rpc_mutate_member_allergy_workflow(
  p_member_id uuid,
  p_operation text,
  p_allergy_id text default null,
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
  v_row public.member_allergies%rowtype;
  v_event_type text;
  v_status text;
begin
  if p_member_id is null then
    raise exception 'rpc_mutate_member_allergy_workflow requires p_member_id';
  end if;

  if v_operation not in ('create', 'update', 'delete') then
    raise exception 'rpc_mutate_member_allergy_workflow requires create/update/delete';
  end if;

  if v_operation = 'create' then
    insert into public.member_allergies (
      id,
      member_id,
      allergy_group,
      allergy_name,
      severity,
      comments,
      created_by_user_id,
      created_by_name,
      created_at,
      updated_at
    )
    values (
      'allergy-' || replace(gen_random_uuid()::text, '-', ''),
      p_member_id,
      nullif(trim(coalesce(p_payload ->> 'allergy_group', '')), ''),
      nullif(trim(coalesce(p_payload ->> 'allergy_name', '')), ''),
      nullif(trim(coalesce(p_payload ->> 'severity', '')), ''),
      nullif(trim(coalesce(p_payload ->> 'comments', '')), ''),
      p_actor_user_id,
      nullif(trim(coalesce(p_actor_name, '')), ''),
      v_now,
      v_now
    )
    returning * into v_row;
  elsif v_operation = 'update' then
    update public.member_allergies
    set
      allergy_group = case when p_payload ? 'allergy_group' then nullif(trim(coalesce(p_payload ->> 'allergy_group', '')), '') else allergy_group end,
      allergy_name = case when p_payload ? 'allergy_name' then nullif(trim(coalesce(p_payload ->> 'allergy_name', '')), '') else allergy_name end,
      severity = case when p_payload ? 'severity' then nullif(trim(coalesce(p_payload ->> 'severity', '')), '') else severity end,
      comments = case when p_payload ? 'comments' then nullif(trim(coalesce(p_payload ->> 'comments', '')), '') else comments end,
      updated_at = v_now
    where id = p_allergy_id
      and member_id = p_member_id
    returning * into v_row;
  else
    delete from public.member_allergies
    where id = p_allergy_id
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
    when v_operation = 'create' then 'member_allergy_created'
    when v_operation = 'update' then 'member_allergy_updated'
    else 'member_allergy_deleted'
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
    'member_allergy',
    null,
    'user',
    p_actor_user_id,
    p_actor_user_id,
    jsonb_build_object('member_id', p_member_id, 'entity_id_text', v_row.id),
    v_status,
    'low',
    v_now
  );

  entity_row := to_jsonb(v_row);
  changed := true;
  return next;
end;
$$;

grant execute on function public.rpc_mutate_member_allergy_workflow(
  uuid,
  text,
  text,
  jsonb,
  uuid,
  text,
  timestamptz
) to authenticated, service_role;

create or replace function public.rpc_mutate_member_provider_workflow(
  p_member_id uuid,
  p_operation text,
  p_provider_id uuid default null,
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
  v_row public.member_providers%rowtype;
  v_event_type text;
  v_status text;
  v_provider_name text;
  v_practice_name text;
begin
  if p_member_id is null then
    raise exception 'rpc_mutate_member_provider_workflow requires p_member_id';
  end if;

  if v_operation not in ('create', 'update', 'delete') then
    raise exception 'rpc_mutate_member_provider_workflow requires create/update/delete';
  end if;

  if v_operation = 'create' then
    insert into public.member_providers (
      member_id,
      provider_name,
      specialty,
      specialty_other,
      practice_name,
      provider_phone,
      created_by_user_id,
      created_by_name,
      created_at,
      updated_at
    )
    values (
      p_member_id,
      nullif(trim(coalesce(p_payload ->> 'provider_name', '')), ''),
      nullif(trim(coalesce(p_payload ->> 'specialty', '')), ''),
      nullif(trim(coalesce(p_payload ->> 'specialty_other', '')), ''),
      nullif(trim(coalesce(p_payload ->> 'practice_name', '')), ''),
      nullif(trim(coalesce(p_payload ->> 'provider_phone', '')), ''),
      p_actor_user_id,
      nullif(trim(coalesce(p_actor_name, '')), ''),
      v_now,
      v_now
    )
    returning * into v_row;
  elsif v_operation = 'update' then
    update public.member_providers
    set
      provider_name = case when p_payload ? 'provider_name' then nullif(trim(coalesce(p_payload ->> 'provider_name', '')), '') else provider_name end,
      specialty = case when p_payload ? 'specialty' then nullif(trim(coalesce(p_payload ->> 'specialty', '')), '') else specialty end,
      specialty_other = case when p_payload ? 'specialty_other' then nullif(trim(coalesce(p_payload ->> 'specialty_other', '')), '') else specialty_other end,
      practice_name = case when p_payload ? 'practice_name' then nullif(trim(coalesce(p_payload ->> 'practice_name', '')), '') else practice_name end,
      provider_phone = case when p_payload ? 'provider_phone' then nullif(trim(coalesce(p_payload ->> 'provider_phone', '')), '') else provider_phone end,
      updated_at = v_now
    where id = p_provider_id
      and member_id = p_member_id
    returning * into v_row;
  else
    delete from public.member_providers
    where id = p_provider_id
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

  if v_operation in ('create', 'update') then
    v_provider_name := nullif(trim(coalesce(v_row.provider_name, '')), '');
    v_practice_name := nullif(trim(coalesce(v_row.practice_name, '')), '');
    if v_provider_name is not null then
      insert into public.provider_directory (
        id,
        provider_name,
        specialty,
        specialty_other,
        practice_name,
        provider_phone,
        created_by_user_id,
        created_by_name,
        created_at,
        updated_at
      )
      values (
        gen_random_uuid(),
        v_provider_name,
        nullif(trim(coalesce(v_row.specialty, '')), ''),
        nullif(trim(coalesce(v_row.specialty_other, '')), ''),
        v_practice_name,
        nullif(trim(coalesce(v_row.provider_phone, '')), ''),
        p_actor_user_id,
        nullif(trim(coalesce(p_actor_name, '')), ''),
        v_now,
        v_now
      )
      on conflict ((lower(btrim(provider_name))), (lower(btrim(coalesce(practice_name, '')))))
      do update
      set
        specialty = excluded.specialty,
        specialty_other = excluded.specialty_other,
        provider_phone = excluded.provider_phone,
        updated_at = excluded.updated_at;
    end if;
  end if;

  v_event_type := case
    when v_operation = 'create' then 'member_provider_created'
    when v_operation = 'update' then 'member_provider_updated'
    else 'member_provider_deleted'
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
    'member_provider',
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

grant execute on function public.rpc_mutate_member_provider_workflow(
  uuid,
  text,
  uuid,
  jsonb,
  uuid,
  text,
  timestamptz
) to authenticated, service_role;
