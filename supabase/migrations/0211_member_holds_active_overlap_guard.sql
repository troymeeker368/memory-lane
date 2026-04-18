-- Enforce concurrency-safe non-overlap for active member holds.
-- Application-level checks alone are race-prone under concurrent writes.

create extension if not exists btree_gist with schema public;

do $$
begin
  if exists (
    select 1
    from public.member_holds as left_hold
    join public.member_holds as right_hold
      on left_hold.member_id = right_hold.member_id
     and left_hold.id <> right_hold.id
    where left_hold.status = 'active'
      and right_hold.status = 'active'
      and daterange(left_hold.start_date, coalesce(left_hold.end_date, 'infinity'::date), '[]')
          && daterange(right_hold.start_date, coalesce(right_hold.end_date, 'infinity'::date), '[]')
    limit 1
  ) then
    raise exception
      'Cannot enforce member_holds overlap guard: overlapping active hold rows already exist. Resolve overlaps first.';
  end if;
end;
$$;

alter table public.member_holds
  drop constraint if exists member_holds_no_overlapping_active_ranges;

alter table public.member_holds
  add constraint member_holds_no_overlapping_active_ranges
  exclude using gist (
    member_id with =,
    daterange(start_date, coalesce(end_date, 'infinity'::date), '[]') with &&
  )
  where (status = 'active');
