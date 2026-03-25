update public.member_files child
set member_id = parent.member_id
from public.enrollment_packet_requests parent
where parent.id = child.enrollment_packet_request_id
  and child.enrollment_packet_request_id is not null
  and child.member_id is distinct from parent.member_id;

do $$
declare
  v_count bigint;
begin
  select count(*)
  into v_count
  from public.member_files child
  join public.enrollment_packet_requests parent on parent.id = child.enrollment_packet_request_id
  where child.enrollment_packet_request_id is not null
    and child.member_id <> parent.member_id;

  if v_count > 0 then
    raise exception 'Cannot enforce member_files enrollment packet lineage: % mismatched rows found.', v_count;
  end if;
end
$$;

create or replace function public.enforce_member_files_enrollment_packet_lineage()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_packet_member_id uuid;
begin
  if new.enrollment_packet_request_id is null then
    return new;
  end if;

  select req.member_id
  into v_packet_member_id
  from public.enrollment_packet_requests req
  where req.id = new.enrollment_packet_request_id;

  if v_packet_member_id is null then
    raise exception 'Enrollment packet request % was not found for member_files lineage enforcement.', new.enrollment_packet_request_id;
  end if;

  if new.member_id is distinct from v_packet_member_id then
    raise exception 'member_files.member_id % does not match enrollment packet request % member_id %.',
      new.member_id,
      new.enrollment_packet_request_id,
      v_packet_member_id;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_member_files_enrollment_packet_lineage on public.member_files;
create trigger trg_member_files_enrollment_packet_lineage
before insert or update of member_id, enrollment_packet_request_id
on public.member_files
for each row
execute function public.enforce_member_files_enrollment_packet_lineage();

