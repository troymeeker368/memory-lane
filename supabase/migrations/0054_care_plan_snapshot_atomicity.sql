create or replace function public.rpc_record_care_plan_snapshot(
  p_care_plan_id uuid,
  p_snapshot_type text,
  p_snapshot_date date,
  p_reviewed_by text,
  p_status text,
  p_next_due_date date,
  p_no_changes_needed boolean,
  p_modifications_required boolean,
  p_modifications_description text,
  p_care_team_notes text,
  p_sections_snapshot jsonb,
  p_review_date date default null,
  p_review_summary text default null,
  p_review_changes_made boolean default null
)
returns table (
  version_id uuid,
  version_number integer
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_care_plan public.care_plans%rowtype;
  v_version_id uuid;
  v_version_number integer;
  v_created_at timestamptz := now();
begin
  if p_care_plan_id is null then
    raise exception 'care plan id is required';
  end if;
  if nullif(trim(coalesce(p_snapshot_type, '')), '') is null then
    raise exception 'snapshot type is required';
  end if;
  if p_snapshot_date is null then
    raise exception 'snapshot date is required';
  end if;
  if nullif(trim(coalesce(p_status, '')), '') is null then
    raise exception 'status is required';
  end if;
  if p_next_due_date is null then
    raise exception 'next due date is required';
  end if;
  if p_sections_snapshot is null then
    raise exception 'sections snapshot is required';
  end if;

  select *
  into v_care_plan
  from public.care_plans
  where id = p_care_plan_id
  for update;

  if not found then
    raise exception 'Care plan % was not found.', p_care_plan_id;
  end if;

  select coalesce(max(cp.version_number), 0) + 1
  into v_version_number
  from public.care_plan_versions cp
  where cp.care_plan_id = p_care_plan_id;

  insert into public.care_plan_versions (
    care_plan_id,
    version_number,
    snapshot_type,
    snapshot_date,
    reviewed_by,
    status,
    next_due_date,
    no_changes_needed,
    modifications_required,
    modifications_description,
    care_team_notes,
    sections_snapshot,
    created_at
  )
  values (
    p_care_plan_id,
    v_version_number,
    p_snapshot_type,
    p_snapshot_date,
    nullif(trim(coalesce(p_reviewed_by, '')), ''),
    p_status,
    p_next_due_date,
    coalesce(p_no_changes_needed, false),
    coalesce(p_modifications_required, false),
    coalesce(p_modifications_description, ''),
    coalesce(p_care_team_notes, ''),
    p_sections_snapshot,
    v_created_at
  )
  returning id into v_version_id;

  if p_review_date is not null then
    insert into public.care_plan_review_history (
      care_plan_id,
      review_date,
      reviewed_by,
      summary,
      changes_made,
      next_due_date,
      version_id,
      created_at
    )
    values (
      p_care_plan_id,
      p_review_date,
      nullif(trim(coalesce(p_reviewed_by, '')), ''),
      coalesce(p_review_summary, ''),
      coalesce(p_review_changes_made, false),
      p_next_due_date,
      v_version_id,
      v_created_at
    );
  end if;

  return query
  select
    v_version_id,
    v_version_number;
end;
$$;

grant execute on function public.rpc_record_care_plan_snapshot(
  uuid,
  text,
  date,
  text,
  text,
  date,
  boolean,
  boolean,
  text,
  text,
  jsonb,
  date,
  text,
  boolean
) to authenticated, service_role;
