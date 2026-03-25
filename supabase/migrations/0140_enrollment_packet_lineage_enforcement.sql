update public.enrollment_packet_pof_staging child
set member_id = parent.member_id
from public.enrollment_packet_requests parent
where parent.id = child.packet_id
  and child.member_id is distinct from parent.member_id;

update public.enrollment_packet_mapping_runs child
set member_id = parent.member_id
from public.enrollment_packet_requests parent
where parent.id = child.packet_id
  and child.member_id is distinct from parent.member_id;

update public.enrollment_packet_uploads child
set member_id = parent.member_id
from public.enrollment_packet_requests parent
where parent.id = child.packet_id
  and child.member_id is distinct from parent.member_id;

update public.enrollment_packet_mapping_records child
set
  packet_id = parent.packet_id,
  member_id = parent.member_id
from public.enrollment_packet_mapping_runs parent
where parent.id = child.mapping_run_id
  and (
    child.packet_id is distinct from parent.packet_id
    or child.member_id is distinct from parent.member_id
  );

update public.enrollment_packet_field_conflicts child
set
  packet_id = parent.packet_id,
  member_id = parent.member_id
from public.enrollment_packet_mapping_runs parent
where parent.id = child.mapping_run_id
  and (
    child.packet_id is distinct from parent.packet_id
    or child.member_id is distinct from parent.member_id
  );

update public.enrollment_packet_follow_up_queue child
set member_id = parent.member_id
from public.enrollment_packet_requests parent
where parent.id = child.packet_id
  and child.member_id is distinct from parent.member_id;

do $$
declare
  v_count bigint;
begin
  select count(*)
  into v_count
  from public.enrollment_packet_pof_staging child
  join public.enrollment_packet_requests parent on parent.id = child.packet_id
  where child.member_id <> parent.member_id;
  if v_count > 0 then
    raise exception 'Cannot enforce enrollment_packet_pof_staging lineage: % mismatched rows found.', v_count;
  end if;

  select count(*)
  into v_count
  from public.enrollment_packet_mapping_runs child
  join public.enrollment_packet_requests parent on parent.id = child.packet_id
  where child.member_id <> parent.member_id;
  if v_count > 0 then
    raise exception 'Cannot enforce enrollment_packet_mapping_runs lineage: % mismatched rows found.', v_count;
  end if;

  select count(*)
  into v_count
  from public.enrollment_packet_uploads child
  join public.enrollment_packet_requests parent on parent.id = child.packet_id
  where child.member_id <> parent.member_id;
  if v_count > 0 then
    raise exception 'Cannot enforce enrollment_packet_uploads lineage: % mismatched rows found.', v_count;
  end if;

  select count(*)
  into v_count
  from public.enrollment_packet_mapping_records child
  join public.enrollment_packet_mapping_runs parent on parent.id = child.mapping_run_id
  where child.packet_id <> parent.packet_id
     or child.member_id <> parent.member_id;
  if v_count > 0 then
    raise exception 'Cannot enforce enrollment_packet_mapping_records lineage: % mismatched rows found.', v_count;
  end if;

  select count(*)
  into v_count
  from public.enrollment_packet_field_conflicts child
  join public.enrollment_packet_mapping_runs parent on parent.id = child.mapping_run_id
  where child.packet_id <> parent.packet_id
     or child.member_id <> parent.member_id;
  if v_count > 0 then
    raise exception 'Cannot enforce enrollment_packet_field_conflicts lineage: % mismatched rows found.', v_count;
  end if;

  select count(*)
  into v_count
  from public.enrollment_packet_follow_up_queue child
  join public.enrollment_packet_requests parent on parent.id = child.packet_id
  where child.member_id <> parent.member_id;
  if v_count > 0 then
    raise exception 'Cannot enforce enrollment_packet_follow_up_queue lineage: % mismatched rows found.', v_count;
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'enrollment_packet_requests_id_member_unique'
  ) then
    alter table public.enrollment_packet_requests
      add constraint enrollment_packet_requests_id_member_unique unique (id, member_id);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'enrollment_packet_mapping_runs_id_packet_member_unique'
  ) then
    alter table public.enrollment_packet_mapping_runs
      add constraint enrollment_packet_mapping_runs_id_packet_member_unique unique (id, packet_id, member_id);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'enrollment_packet_pof_staging_packet_member_fkey'
  ) then
    alter table public.enrollment_packet_pof_staging
      add constraint enrollment_packet_pof_staging_packet_member_fkey
      foreign key (packet_id, member_id)
      references public.enrollment_packet_requests(id, member_id)
      on delete cascade
      not valid;
    alter table public.enrollment_packet_pof_staging
      validate constraint enrollment_packet_pof_staging_packet_member_fkey;
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'enrollment_packet_mapping_runs_packet_member_fkey'
  ) then
    alter table public.enrollment_packet_mapping_runs
      add constraint enrollment_packet_mapping_runs_packet_member_fkey
      foreign key (packet_id, member_id)
      references public.enrollment_packet_requests(id, member_id)
      on delete cascade
      not valid;
    alter table public.enrollment_packet_mapping_runs
      validate constraint enrollment_packet_mapping_runs_packet_member_fkey;
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'enrollment_packet_mapping_records_packet_member_fkey'
  ) then
    alter table public.enrollment_packet_mapping_records
      add constraint enrollment_packet_mapping_records_packet_member_fkey
      foreign key (packet_id, member_id)
      references public.enrollment_packet_requests(id, member_id)
      on delete cascade
      not valid;
    alter table public.enrollment_packet_mapping_records
      validate constraint enrollment_packet_mapping_records_packet_member_fkey;
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'enrollment_packet_uploads_packet_member_fkey'
  ) then
    alter table public.enrollment_packet_uploads
      add constraint enrollment_packet_uploads_packet_member_fkey
      foreign key (packet_id, member_id)
      references public.enrollment_packet_requests(id, member_id)
      on delete cascade
      not valid;
    alter table public.enrollment_packet_uploads
      validate constraint enrollment_packet_uploads_packet_member_fkey;
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'enrollment_packet_mapping_records_run_packet_member_fkey'
  ) then
    alter table public.enrollment_packet_mapping_records
      add constraint enrollment_packet_mapping_records_run_packet_member_fkey
      foreign key (mapping_run_id, packet_id, member_id)
      references public.enrollment_packet_mapping_runs(id, packet_id, member_id)
      on delete cascade
      not valid;
    alter table public.enrollment_packet_mapping_records
      validate constraint enrollment_packet_mapping_records_run_packet_member_fkey;
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'enrollment_packet_field_conflicts_packet_member_fkey'
  ) then
    alter table public.enrollment_packet_field_conflicts
      add constraint enrollment_packet_field_conflicts_packet_member_fkey
      foreign key (packet_id, member_id)
      references public.enrollment_packet_requests(id, member_id)
      on delete cascade
      not valid;
    alter table public.enrollment_packet_field_conflicts
      validate constraint enrollment_packet_field_conflicts_packet_member_fkey;
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'enrollment_packet_field_conflicts_run_packet_member_fkey'
  ) then
    alter table public.enrollment_packet_field_conflicts
      add constraint enrollment_packet_field_conflicts_run_packet_member_fkey
      foreign key (mapping_run_id, packet_id, member_id)
      references public.enrollment_packet_mapping_runs(id, packet_id, member_id)
      on delete cascade
      not valid;
    alter table public.enrollment_packet_field_conflicts
      validate constraint enrollment_packet_field_conflicts_run_packet_member_fkey;
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'enrollment_packet_follow_up_queue_packet_member_fkey'
  ) then
    alter table public.enrollment_packet_follow_up_queue
      add constraint enrollment_packet_follow_up_queue_packet_member_fkey
      foreign key (packet_id, member_id)
      references public.enrollment_packet_requests(id, member_id)
      on delete cascade
      not valid;
    alter table public.enrollment_packet_follow_up_queue
      validate constraint enrollment_packet_follow_up_queue_packet_member_fkey;
  end if;
end
$$;
