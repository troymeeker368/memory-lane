-- ACID hardening: enforce uniqueness on critical in-flight workflows.
-- Preflight checks (run manually before applying in production):
-- 1) Active POF request duplicates
-- select physician_order_id, count(*) as active_count
-- from public.pof_requests
-- where status in ('draft', 'sent', 'opened')
-- group by physician_order_id
-- having count(*) > 1;
--
-- 2) Draft/Sent physician order duplicates per intake assessment
-- select intake_assessment_id, count(*) as draft_or_sent_count
-- from public.physician_orders
-- where intake_assessment_id is not null
--   and status in ('draft', 'sent')
-- group by intake_assessment_id
-- having count(*) > 1;
--
-- 3) Member file duplicates linked to the same POF request
-- select pof_request_id, count(*) as member_file_count
-- from public.member_files
-- where pof_request_id is not null
-- group by pof_request_id
-- having count(*) > 1;

create unique index if not exists idx_pof_requests_active_per_order_unique
  on public.pof_requests (physician_order_id)
  where status in ('draft', 'sent', 'opened');

create unique index if not exists idx_physician_orders_intake_draft_sent_unique
  on public.physician_orders (intake_assessment_id)
  where intake_assessment_id is not null
    and status in ('draft', 'sent');

create unique index if not exists idx_member_files_pof_request_unique
  on public.member_files (pof_request_id)
  where pof_request_id is not null;
