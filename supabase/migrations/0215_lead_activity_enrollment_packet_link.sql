begin;

alter table public.lead_activities
  add column if not exists enrollment_packet_request_id uuid;

update public.lead_activities as la
set enrollment_packet_request_id = epr.id
from public.enrollment_packet_requests as epr
where la.enrollment_packet_request_id is null
  and la.outcome = 'Enrollment Packet Completed'
  and la.lead_id = epr.lead_id
  and la.notes ilike ('%' || epr.id::text || '%');

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'lead_activities_enrollment_packet_request_id_fkey'
  ) then
    alter table public.lead_activities
      add constraint lead_activities_enrollment_packet_request_id_fkey
      foreign key (enrollment_packet_request_id)
      references public.enrollment_packet_requests(id)
      on delete set null;
  end if;
end $$;

create index if not exists idx_lead_activities_enrollment_packet_request
  on public.lead_activities(enrollment_packet_request_id);

commit;
