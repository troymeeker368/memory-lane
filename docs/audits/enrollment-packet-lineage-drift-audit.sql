-- Read-only preflight for enrollment packet packet/member lineage drift.
-- Safe to run in Supabase SQL editor before or after applying 0140_enrollment_packet_lineage_enforcement.sql.
-- This file must stay read-only: no INSERT/UPDATE/DELETE/ALTER statements.

-- 1) Summary counts by lineage check
select
  'enrollment_packet_pof_staging_packet_member' as check_name,
  count(*)::bigint as mismatch_count
from public.enrollment_packet_pof_staging child
join public.enrollment_packet_requests parent on parent.id = child.packet_id
where child.member_id is distinct from parent.member_id

union all

select
  'enrollment_packet_mapping_runs_packet_member' as check_name,
  count(*)::bigint as mismatch_count
from public.enrollment_packet_mapping_runs child
join public.enrollment_packet_requests parent on parent.id = child.packet_id
where child.member_id is distinct from parent.member_id

union all

select
  'enrollment_packet_uploads_packet_member' as check_name,
  count(*)::bigint as mismatch_count
from public.enrollment_packet_uploads child
join public.enrollment_packet_requests parent on parent.id = child.packet_id
where child.member_id is distinct from parent.member_id

union all

select
  'enrollment_packet_mapping_records_run_packet_member' as check_name,
  count(*)::bigint as mismatch_count
from public.enrollment_packet_mapping_records child
join public.enrollment_packet_mapping_runs parent on parent.id = child.mapping_run_id
where child.packet_id is distinct from parent.packet_id
   or child.member_id is distinct from parent.member_id

union all

select
  'enrollment_packet_field_conflicts_run_packet_member' as check_name,
  count(*)::bigint as mismatch_count
from public.enrollment_packet_field_conflicts child
join public.enrollment_packet_mapping_runs parent on parent.id = child.mapping_run_id
where child.packet_id is distinct from parent.packet_id
   or child.member_id is distinct from parent.member_id

union all

select
  'enrollment_packet_follow_up_queue_packet_member' as check_name,
  count(*)::bigint as mismatch_count
from public.enrollment_packet_follow_up_queue child
join public.enrollment_packet_requests parent on parent.id = child.packet_id
where child.member_id is distinct from parent.member_id

union all

select
  'member_files_enrollment_packet_member' as check_name,
  count(*)::bigint as mismatch_count
from public.member_files child
join public.enrollment_packet_requests parent on parent.id = child.enrollment_packet_request_id
where child.enrollment_packet_request_id is not null
  and child.member_id is distinct from parent.member_id
order by check_name;

-- 2) Detailed mismatch rows for cleanup review
select
  'enrollment_packet_pof_staging_packet_member' as check_name,
  child.id as child_id,
  child.packet_id as packet_id,
  child.member_id as child_member_id,
  parent.member_id as canonical_member_id,
  null::uuid as mapping_run_id
from public.enrollment_packet_pof_staging child
join public.enrollment_packet_requests parent on parent.id = child.packet_id
where child.member_id is distinct from parent.member_id

union all

select
  'enrollment_packet_mapping_runs_packet_member' as check_name,
  child.id as child_id,
  child.packet_id as packet_id,
  child.member_id as child_member_id,
  parent.member_id as canonical_member_id,
  child.id as mapping_run_id
from public.enrollment_packet_mapping_runs child
join public.enrollment_packet_requests parent on parent.id = child.packet_id
where child.member_id is distinct from parent.member_id

union all

select
  'enrollment_packet_uploads_packet_member' as check_name,
  child.id as child_id,
  child.packet_id as packet_id,
  child.member_id as child_member_id,
  parent.member_id as canonical_member_id,
  null::uuid as mapping_run_id
from public.enrollment_packet_uploads child
join public.enrollment_packet_requests parent on parent.id = child.packet_id
where child.member_id is distinct from parent.member_id

union all

select
  'enrollment_packet_mapping_records_run_packet_member' as check_name,
  child.id as child_id,
  child.packet_id as packet_id,
  child.member_id as child_member_id,
  parent.member_id as canonical_member_id,
  child.mapping_run_id as mapping_run_id
from public.enrollment_packet_mapping_records child
join public.enrollment_packet_mapping_runs parent on parent.id = child.mapping_run_id
where child.packet_id is distinct from parent.packet_id
   or child.member_id is distinct from parent.member_id

union all

select
  'enrollment_packet_field_conflicts_run_packet_member' as check_name,
  child.id as child_id,
  child.packet_id as packet_id,
  child.member_id as child_member_id,
  parent.member_id as canonical_member_id,
  child.mapping_run_id as mapping_run_id
from public.enrollment_packet_field_conflicts child
join public.enrollment_packet_mapping_runs parent on parent.id = child.mapping_run_id
where child.packet_id is distinct from parent.packet_id
   or child.member_id is distinct from parent.member_id

union all

select
  'enrollment_packet_follow_up_queue_packet_member' as check_name,
  child.id as child_id,
  child.packet_id as packet_id,
  child.member_id as child_member_id,
  parent.member_id as canonical_member_id,
  null::uuid as mapping_run_id
from public.enrollment_packet_follow_up_queue child
join public.enrollment_packet_requests parent on parent.id = child.packet_id
where child.member_id is distinct from parent.member_id

union all

select
  'member_files_enrollment_packet_member' as check_name,
  child.id as child_id,
  child.enrollment_packet_request_id as packet_id,
  child.member_id as child_member_id,
  parent.member_id as canonical_member_id,
  null::uuid as mapping_run_id
from public.member_files child
join public.enrollment_packet_requests parent on parent.id = child.enrollment_packet_request_id
where child.enrollment_packet_request_id is not null
  and child.member_id is distinct from parent.member_id
order by check_name, child_id;
