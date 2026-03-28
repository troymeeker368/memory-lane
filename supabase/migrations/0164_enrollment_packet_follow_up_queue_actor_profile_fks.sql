-- Clean up orphaned actor ids before adding profile foreign keys.
-- Leave the columns null-tolerant so background/system writes can omit actor identity safely.

update public.enrollment_packet_follow_up_queue as queue
set created_by_user_id = null
where created_by_user_id is not null
  and not exists (
    select 1
    from public.profiles as profiles
    where profiles.id = queue.created_by_user_id
  );

update public.enrollment_packet_follow_up_queue as queue
set updated_by_user_id = null
where updated_by_user_id is not null
  and not exists (
    select 1
    from public.profiles as profiles
    where profiles.id = queue.updated_by_user_id
  );

do $$
declare
  v_orphaned_created integer;
  v_orphaned_updated integer;
begin
  select count(*)
  into v_orphaned_created
  from public.enrollment_packet_follow_up_queue as queue
  where created_by_user_id is not null
    and not exists (
      select 1
      from public.profiles as profiles
      where profiles.id = queue.created_by_user_id
    );

  if v_orphaned_created > 0 then
    raise exception 'Enrollment packet follow-up queue FK hardening aborted: % orphaned created_by_user_id row(s) remain after cleanup.', v_orphaned_created;
  end if;

  select count(*)
  into v_orphaned_updated
  from public.enrollment_packet_follow_up_queue as queue
  where updated_by_user_id is not null
    and not exists (
      select 1
      from public.profiles as profiles
      where profiles.id = queue.updated_by_user_id
    );

  if v_orphaned_updated > 0 then
    raise exception 'Enrollment packet follow-up queue FK hardening aborted: % orphaned updated_by_user_id row(s) remain after cleanup.', v_orphaned_updated;
  end if;
end
$$;

alter table public.enrollment_packet_follow_up_queue
  drop constraint if exists enrollment_packet_follow_up_queue_created_by_profile_fkey;

alter table public.enrollment_packet_follow_up_queue
  add constraint enrollment_packet_follow_up_queue_created_by_profile_fkey
  foreign key (created_by_user_id)
  references public.profiles(id)
  on delete set null
  not valid;

alter table public.enrollment_packet_follow_up_queue
  drop constraint if exists enrollment_packet_follow_up_queue_updated_by_profile_fkey;

alter table public.enrollment_packet_follow_up_queue
  add constraint enrollment_packet_follow_up_queue_updated_by_profile_fkey
  foreign key (updated_by_user_id)
  references public.profiles(id)
  on delete set null
  not valid;

alter table public.enrollment_packet_follow_up_queue
  validate constraint enrollment_packet_follow_up_queue_created_by_profile_fkey;

alter table public.enrollment_packet_follow_up_queue
  validate constraint enrollment_packet_follow_up_queue_updated_by_profile_fkey;
