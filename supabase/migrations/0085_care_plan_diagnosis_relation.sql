create extension if not exists pgcrypto;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'care_plans_id_member_unique'
      and conrelid = 'public.care_plans'::regclass
  ) then
    alter table public.care_plans
      add constraint care_plans_id_member_unique unique (id, member_id);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'member_diagnoses_id_member_unique'
      and conrelid = 'public.member_diagnoses'::regclass
  ) then
    alter table public.member_diagnoses
      add constraint member_diagnoses_id_member_unique unique (id, member_id);
  end if;
end
$$;

create table if not exists public.care_plan_diagnoses (
  id uuid primary key default gen_random_uuid(),
  care_plan_id uuid not null,
  member_id uuid not null references public.members(id) on delete cascade,
  member_diagnosis_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_user_id uuid null references public.profiles(id) on delete set null,
  created_by_name text null,
  updated_by_user_id uuid null references public.profiles(id) on delete set null,
  updated_by_name text null,
  constraint care_plan_diagnoses_care_plan_member_fkey
    foreign key (care_plan_id, member_id)
    references public.care_plans(id, member_id)
    on delete cascade,
  constraint care_plan_diagnoses_member_diagnosis_member_fkey
    foreign key (member_diagnosis_id, member_id)
    references public.member_diagnoses(id, member_id),
  constraint care_plan_diagnoses_unique unique (care_plan_id, member_diagnosis_id)
);

create index if not exists idx_care_plan_diagnoses_care_plan_id
  on public.care_plan_diagnoses(care_plan_id);

create index if not exists idx_care_plan_diagnoses_member_id
  on public.care_plan_diagnoses(member_id);

create index if not exists idx_care_plan_diagnoses_member_diagnosis_id
  on public.care_plan_diagnoses(member_diagnosis_id);

alter table public.care_plan_diagnoses enable row level security;

drop policy if exists "care_plan_diagnoses_select" on public.care_plan_diagnoses;
create policy "care_plan_diagnoses_select"
on public.care_plan_diagnoses
for select
to authenticated
using (true);

drop policy if exists "care_plan_diagnoses_insert" on public.care_plan_diagnoses;
create policy "care_plan_diagnoses_insert"
on public.care_plan_diagnoses
for insert
to service_role
with check (true);

drop policy if exists "care_plan_diagnoses_update" on public.care_plan_diagnoses;
create policy "care_plan_diagnoses_update"
on public.care_plan_diagnoses
for update
to service_role
using (true)
with check (true);

drop policy if exists "care_plan_diagnoses_delete" on public.care_plan_diagnoses;
create policy "care_plan_diagnoses_delete"
on public.care_plan_diagnoses
for delete
to service_role
using (true);

drop trigger if exists trg_care_plan_diagnoses_updated on public.care_plan_diagnoses;
create trigger trg_care_plan_diagnoses_updated
before update on public.care_plan_diagnoses
for each row execute function public.set_updated_at();

drop function if exists public.rpc_upsert_care_plan_core(
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
);

create function public.rpc_upsert_care_plan_core(
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
  p_diagnosis_ids jsonb default '[]'::jsonb,
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
  v_actor_name text := nullif(trim(coalesce(p_actor_name, '')), '');
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
  if jsonb_typeof(coalesce(p_diagnosis_ids, '[]'::jsonb)) <> 'array' then
    raise exception 'rpc_upsert_care_plan_core requires p_diagnosis_ids to be a JSON array';
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
  if exists (
    select 1
    from jsonb_array_elements_text(coalesce(p_diagnosis_ids, '[]'::jsonb)) diagnosis_id(value)
    where nullif(trim(value), '') is null
       or trim(value) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ) then
    raise exception 'rpc_upsert_care_plan_core requires diagnosis ids to be UUID strings';
  end if;
  if exists (
    select 1
    from (
      select distinct trim(value)::uuid as diagnosis_id
      from jsonb_array_elements_text(coalesce(p_diagnosis_ids, '[]'::jsonb)) diagnosis_id(value)
    ) diagnosis_ids
    left join public.member_diagnoses as md
      on md.id = diagnosis_ids.diagnosis_id
     and md.member_id = p_member_id
    where md.id is null
  ) then
    raise exception 'rpc_upsert_care_plan_core received diagnosis ids that do not belong to member %', p_member_id;
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
      v_actor_name,
      p_actor_user_id,
      v_actor_name,
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
      updated_by_name = v_actor_name,
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

  delete from public.care_plan_diagnoses as cpd
  where cpd.care_plan_id = v_care_plan_id;

  insert into public.care_plan_diagnoses (
    care_plan_id,
    member_id,
    member_diagnosis_id,
    created_at,
    updated_at,
    created_by_user_id,
    created_by_name,
    updated_by_user_id,
    updated_by_name
  )
  select
    v_care_plan_id,
    p_member_id,
    md.id,
    v_now,
    v_now,
    p_actor_user_id,
    v_actor_name,
    p_actor_user_id,
    v_actor_name
  from (
    select distinct trim(value)::uuid as diagnosis_id
    from jsonb_array_elements_text(coalesce(p_diagnosis_ids, '[]'::jsonb)) diagnosis_id(value)
  ) diagnosis_ids
  join public.member_diagnoses as md
    on md.id = diagnosis_ids.diagnosis_id
   and md.member_id = p_member_id;

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
  jsonb,
  jsonb
) to authenticated, service_role;
