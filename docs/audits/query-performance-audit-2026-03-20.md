# Supabase Query Performance Audit
Date: 2026-03-20
Scope: Memory Lane codebase, read-only audit

## 1. Executive Summary

This run found that some of the March 19 performance issues were partially reduced, but the main scaling risks are still concentrated in a few shared read paths:

- `getMemberHealthProfileIndexSupabase()` still does a paged member read, a second full filtered member read for counts, then extra aggregate reads and per-member ensure calls when profiles are missing.
  File: `lib/services/member-health-profiles-supabase.ts:309`
- `getMemberCommandCenterIndexSupabase()` now pages the member list correctly, but it still loads `member_command_centers` and `member_attendance_schedules` with `select("*")` and can still fan out into ensure-on-read writes per missing member.
  File: `lib/services/member-command-center-supabase.ts:728`
- `getMarWorkflowSnapshot()` still runs `syncTodayMarSchedules()` before every MAR snapshot, and that sync can fan out into one reconcile RPC per affected member before the page even reads.
  File: `lib/services/mar-workflow.ts:207`
- `getCarePlans()` still does separate member-name lookup work and four repeated count queries on every request.
  File: `lib/services/care-plans-supabase.ts:421`
- Member file list reads still load `file_data_url`, which is a heavy field for a list view.
  File: `lib/services/member-command-center-supabase.ts:601`
- Admin reporting improved for documentation summary reads, but invoice, transportation, and lead export/report reads still pull full date ranges into app memory.
  File: `lib/services/admin-reporting-foundation.ts:338`
- Staff activity and staff detail read models still load many large table slices directly and do not yet have complete supporting staff/date indexes.
  Files:
  - `lib/services/activity-snapshots.ts:129`
  - `lib/services/staff-detail-read-model.ts:42`
- Sales summary and referral-source pages still do more work than needed through repeated counts and a 500-row partner preload.
  File: `lib/services/sales-crm-supabase.ts:598`

Biggest changes since the last run:

- The new migration `0094_admin_reporting_and_mar_read_hardening.sql` added member/date indexes for several documentation tables and introduced a database-side RPC now used for member documentation summary reporting.
- `listMembersSupabase()` now pushes text search into SQL instead of filtering in memory.
- `listAdminAuditTrailRows()` now pushes `areaFilter` into SQL.
- MAR view reads now use explicit column lists instead of raw `select("*")`.

Residual validation gap:

- I still do not have production row counts, `EXPLAIN ANALYZE`, or slow-query telemetry, so `likely` findings are based on code and migration evidence, not live query plans.

## 2. Missing Indexes

### Confirmed

- `members.display_name` still has no repo evidence of a trigram/GIN search index, even though member search is now pushed into SQL in multiple places.
  Files:
  - `lib/services/member-command-center-supabase.ts:189`
  - `lib/services/member-health-profiles-supabase.ts:330`
  - `lib/services/care-plans-supabase.ts:379`
  Severity: High
  Scaling risk: Near-term
  Why it matters: these `ilike` paths are safer than in-memory filtering, but they can still turn into expensive scans as the member table grows.

- `care_plans` still has only the member-scoped `(member_id, next_due_date)` index, not a global `next_due_date` index for all-member dashboards and list ordering.
  Files:
  - `lib/services/care-plans-supabase.ts:448`
  - `supabase/migrations/0013_care_plans_and_billing_execution.sql:28`
  Severity: High
  Scaling risk: Near-term
  Why it matters: all-member care plan views sort by `next_due_date` without filtering to one member first.

- `system_events` still has no repo evidence of a correlation-based index for alert de-dup checks.
  Files:
  - `lib/services/workflow-observability.ts:106`
  - `supabase/migrations/0046_operational_reliability_observability.sql:12`
  - `supabase/migrations/0050_workflow_reliability_indexes.sql:14`
  Severity: Medium
  Scaling risk: Near-term
  Why it matters: repeated alert checks filter by `event_type`, `entity_type`, `correlation_id`, `status`, and sometimes `entity_id`.

- Staff/date index coverage is still incomplete for several high-volume activity tables.
  Files:
  - `lib/services/activity-snapshots.ts:129`
  - `lib/services/staff-detail-read-model.ts:48`
  Severity: High
  Scaling risk: Near-term
  Missing index families still visible from code + migrations:
  - `blood_sugar_logs(nurse_user_id, checked_at desc)`
  - `blood_sugar_logs(member_id, checked_at desc)`
  - `member_photo_uploads(uploaded_by, uploaded_at desc)`
  - `member_photo_uploads(member_id, uploaded_at desc)`
  - `ancillary_charge_logs(staff_user_id, created_at desc)`
  - `ancillary_charge_logs(member_id, service_date desc)`
  Why it matters: March 19 added some member/date documentation indexes, but these remaining tables still support broad date-range screens without matching composite indexes.

### Likely

- `billing_invoices(invoice_date desc)` is still not visible in migrations, even though reporting exports filter and order directly on `invoice_date`.
  File: `lib/services/admin-reporting-foundation.ts:384`
  Severity: Medium
  Scaling risk: Near-term

- `leads(created_at desc)` and `leads(inquiry_date desc)` are still not visible in migrations, even though reporting and sales summary reads filter by those columns directly.
  File: `lib/services/admin-reporting-foundation.ts:444`
  File: `lib/services/sales-crm-supabase.ts:621`
  Severity: Medium
  Scaling risk: Near-term

- Sales text-search paths still have no repo evidence of search indexes for partner and referral-source directories.
  Files:
  - `lib/services/sales-crm-supabase.ts:772`
  - `lib/services/sales-crm-supabase.ts:803`
  Severity: Medium
  Scaling risk: Long-term

## 3. Potential Table Scans

- Confirmed: the MHP index still performs a second full filtered member read just to calculate counts.
  File: `lib/services/member-health-profiles-supabase.ts:338`
  Severity: High
  Scaling risk: Near-term
  Why it could become slow: even on a paged screen, the aggregate path grows with the entire filtered member set, not the current page.

- Confirmed: care plan search still starts with a separate `members.display_name ilike` lookup and then turns that result into a `member_id IN (...)` filter.
  File: `lib/services/care-plans-supabase.ts:375`
  Severity: High
  Scaling risk: Near-term
  Why it could become slow: the member search can scan widely, and the care plan query then inherits a potentially large `IN` list.

- Confirmed: billing, transportation, and leads on-demand reports still read full date-range datasets without pagination.
  Files:
  - `lib/services/admin-reporting-foundation.ts:384`
  - `lib/services/admin-reporting-foundation.ts:415`
  - `lib/services/admin-reporting-foundation.ts:444`
  Severity: High
  Scaling risk: Near-term
  Why it could become slow: report/export pages are still pushing whole date ranges into the app process instead of using more database-side aggregation or batching.

- Likely: `listMemberNameLookupSupabase()` is still an unpaged ordered lookup reused by dashboard and operations screens.
  Files:
  - `lib/services/member-command-center-supabase.ts:201`
  - `app/(portal)/dashboard/page.tsx:95`
  Severity: Medium
  Scaling risk: Long-term
  Why it could become slow: it is narrower than the old full member read, but it still grows with the full member directory.

## 4. N+1 Query Patterns

- Confirmed: the MHP index still calls `ensureMemberHealthProfileSupabase()` once per missing member on the current page.
  File: `lib/services/member-health-profiles-supabase.ts:398`
  Severity: High
  Scaling risk: Near-term
  Why it could become slow: a list page can turn into many follow-up reads and writes.
  Recommended fix: move missing-row backfill into a batched job or RPC instead of doing ensure-on-read in the list page.

- Confirmed: the MCC index still calls `ensureMemberCommandCenterProfileSupabase()` and `ensureMemberAttendanceScheduleSupabase()` once per missing member.
  Files:
  - `lib/services/member-command-center-supabase.ts:778`
  - `lib/services/member-command-center-supabase.ts:791`
  Severity: High
  Scaling risk: Near-term
  Why it could become slow: one page request can fan out into many extra writes before rendering.
  Recommended fix: use the same approach as MHP and backfill missing canonical rows outside the read path.

## 5. Inefficient Data Fetching

- Confirmed: the MAR dashboard still performs write-like reconciliation work on every read.
  Files:
  - `lib/services/mar-workflow.ts:207`
  - `lib/services/mar-workflow.ts:293`
  Severity: Critical
  Scaling risk: Immediate
  Why it could become slow: `syncTodayMarSchedules()` first scans today’s center medications and schedules, then can run one reconcile RPC per affected member before the actual snapshot query starts.

- Confirmed: the MCC index still uses `select("*")` for profile and attendance schedule rows.
  Files:
  - `lib/services/member-command-center-supabase.ts:748`
  - `lib/services/member-command-center-supabase.ts:749`
  Severity: Medium
  Scaling risk: Near-term
  Why it could become slow: the list page only needs a subset of fields, but it still pulls every column for each page row.

- Confirmed: member file list reads still load `file_data_url`.
  File: `lib/services/member-command-center-supabase.ts:605`
  Severity: High
  Scaling risk: Near-term
  Why it could become slow: list pages do not need large inline file payloads, but they still fetch them.

- Confirmed: care plan list pages still pay for one main query plus four separate count queries.
  File: `lib/services/care-plans-supabase.ts:474`
  Severity: High
  Scaling risk: Near-term
  Why it could become slow: the same dataset is re-queried repeatedly for summary cards.

- Confirmed: staff detail still loads unbounded `select("*")` activity history across eight tables.
  File: `lib/services/staff-detail-read-model.ts:48`
  Severity: High
  Scaling risk: Near-term
  Why it could become slow: one detail page grows forever with staff history.

- Confirmed: staff and member activity snapshots still fan out into many date-range queries every time the page loads.
  Files:
  - `lib/services/activity-snapshots.ts:128`
  - `lib/services/activity-snapshots.ts:278`
  Severity: Medium
  Scaling risk: Near-term
  Why it could become slow: each snapshot does many parallel reads over large tables and relies on incomplete index coverage.

- Confirmed: sales summary still issues many separate count queries over `leads`.
  File: `lib/services/sales-crm-supabase.ts:601`
  Severity: Medium
  Scaling risk: Near-term
  Why it could become slow: one summary page request fans out into many near-duplicate lead counts.

- Confirmed: referral-source directory still reloads up to 500 partner rows on every request before running the paged query.
  File: `lib/services/sales-crm-supabase.ts:790`
  Severity: Medium
  Scaling risk: Near-term
  Why it could become slow: every request pays for a second directory read even when the user only needs one page of referral sources.

## 6. Duplicate Query Logic

- Confirmed: member-name search logic is still spread across MCC, MHP, and care plan services.
  Files:
  - `lib/services/member-command-center-supabase.ts:237`
  - `lib/services/member-health-profiles-supabase.ts:330`
  - `lib/services/care-plans-supabase.ts:375`
  Severity: Medium
  Scaling risk: Near-term
  Why it matters: one search/index improvement has to be repeated across multiple services, which increases drift risk.

- Confirmed: member file reads are still split between the MCC service and the broader member-files service.
  Files:
  - `lib/services/member-command-center-supabase.ts:601`
  - `lib/services/member-files.ts:129`
  Severity: Medium
  Scaling risk: Long-term
  Why it matters: metadata-only list reads and full-row detail reads are not standardized in one canonical place.

- Confirmed: activity/report reads over the same documentation tables are still duplicated across snapshots, staff detail, and admin reporting.
  Files:
  - `lib/services/activity-snapshots.ts:128`
  - `lib/services/staff-detail-read-model.ts:48`
  - `lib/services/admin-reporting-foundation.ts:186`
  Severity: Medium
  Scaling risk: Near-term
  Why it matters: index planning and query hardening are harder when the same operational data is queried three different ways.

- Confirmed: audit log read logic still exists in more than one service.
  Files:
  - `lib/services/admin-audit-trail.ts:49`
  - `lib/services/user-management.ts:593`
  Severity: Low
  Scaling risk: Long-term
  Why it matters: if one path gets pagination or filtering improvements and the other does not, audit behavior drifts.

## 7. Recommended Index Additions

These are the safest high-value index additions still missing after the March 19 changes:

```sql
create extension if not exists pg_trgm;

create index if not exists idx_members_display_name_trgm
  on public.members using gin (display_name gin_trgm_ops);

create index if not exists idx_care_plans_next_due_date_desc
  on public.care_plans (next_due_date desc);

create index if not exists idx_system_events_alert_dedupe
  on public.system_events (event_type, entity_type, correlation_id, status, entity_id, created_at desc);

create index if not exists idx_member_photo_uploads_uploaded_by_uploaded_at_desc
  on public.member_photo_uploads (uploaded_by, uploaded_at desc);

create index if not exists idx_member_photo_uploads_member_uploaded_at_desc
  on public.member_photo_uploads (member_id, uploaded_at desc);

create index if not exists idx_blood_sugar_logs_nurse_checked_at_desc
  on public.blood_sugar_logs (nurse_user_id, checked_at desc);

create index if not exists idx_blood_sugar_logs_member_checked_at_desc
  on public.blood_sugar_logs (member_id, checked_at desc);

create index if not exists idx_ancillary_charge_logs_staff_created_at_desc
  on public.ancillary_charge_logs (staff_user_id, created_at desc);

create index if not exists idx_ancillary_charge_logs_member_service_date_desc
  on public.ancillary_charge_logs (member_id, service_date desc);

create index if not exists idx_billing_invoices_invoice_date_desc
  on public.billing_invoices (invoice_date desc);

create index if not exists idx_leads_created_at_desc
  on public.leads (created_at desc);

create index if not exists idx_leads_inquiry_date_desc
  on public.leads (inquiry_date desc);

create index if not exists idx_mar_schedules_active_scheduled_time
  on public.mar_schedules (scheduled_time asc, member_id)
  where active = true;

create index if not exists idx_mar_administrations_date_status_time
  on public.mar_administrations (administration_date, status, administered_at desc);

create index if not exists idx_mar_administrations_source_administered_at_desc
  on public.mar_administrations (source, administered_at desc);
```

## 8. Performance Hardening Plan

1. Fix the MHP and MCC list-page read paths first.
   - Remove ensure-on-read behavior from both index pages.
   - Replace `select("*")` with explicit list-view selects.
   - If missing canonical rows still exist, backfill them outside the page request.

2. Harden the MAR dashboard path.
   - Keep the newer explicit select lists.
   - Move `syncTodayMarSchedules()` off the hot read path or guard it behind a real freshness check.
   - Add MAR indexes that match today/history/PRN view filters.

3. Simplify care plan list/dashboard reads.
   - Add the global `next_due_date` index.
   - Replace repeated count fan-out with one grouped SQL/RPC path.
   - Keep member search on an indexed path instead of a wide name-scan plus `IN` list.

4. Split metadata reads from heavy file payload reads.
   - Member file list pages should load metadata only.
   - Full file payloads or signed URLs should stay in detail/download flows.

5. Tighten reporting and staff-history reads.
   - Keep the new documentation summary RPC.
   - Push more invoice, transportation, and lead reporting work into SQL or RPCs.
   - Add pagination or date caps to staff detail/history screens.

6. Reduce repeated lead-query work.
   - Replace sales summary count fan-out with one summary RPC/view where practical.
   - Stop preloading 500 partner rows on each referral-source directory request.

## 9. Suggested Codex Prompts

### Prompt 1

Refactor the Memory Lane MHP and Member Command Center index pages so they stop doing ensure-on-read work for missing canonical rows. Preserve the current canonical Supabase service boundaries, keep Supabase as the source of truth, replace `select("*")` with explicit list-view selects where safe, and prefer a batched backfill or RPC-based repair path over per-row ensure calls during page loads.

### Prompt 2

Harden the Memory Lane MAR dashboard read path so `getMarWorkflowSnapshot()` no longer runs heavy schedule reconciliation on every page load. Keep the current explicit MAR select lists, add the smallest safe supporting MAR indexes for today/history/PRN reads, and preserve the canonical RPC-backed write path for schedule generation and reconciliation.

### Prompt 3

Optimize Memory Lane care plan list and dashboard queries. Replace repeated count fan-out with one grouped query or canonical RPC, keep pagination intact, add the smallest safe global `care_plans(next_due_date)` index support, and keep member-name search on an indexed path.

### Prompt 4

Harden Memory Lane member file list reads so list pages do not fetch heavy payload fields like `file_data_url`. Keep canonical member-file service boundaries, preserve download/detail behavior, and clearly separate metadata-only list queries from full document retrieval flows.

### Prompt 5

Review Memory Lane admin reporting and staff history read paths for full-range and unbounded Supabase queries. Keep the new documentation summary RPC, push more invoice/transportation/lead aggregation into SQL where practical, add safe pagination or date windows to staff detail/history pages, and recommend the smallest index migration bundle needed for the remaining report paths.

### Prompt 6

Reduce read amplification in Memory Lane sales summary and referral-source directory queries. Replace repeated lead count queries with a canonical summary read path, stop reloading large partner directories on every referral-source page request, and add the smallest safe search/index support for any `ilike` paths that still do not scale.

## 10. Founder Summary: What changed since the last run

- One previously flagged audit issue was materially improved:
  - `listAdminAuditTrailRows()` now pushes `areaFilter` into SQL before the query limit instead of filtering that area in memory afterward.
  - File: `lib/services/admin-audit-trail.ts:66`

- One previously flagged member-list issue was partially improved:
  - `listMembersSupabase()` still returns an unpaged result set, but search text is now pushed into Supabase with `ilike` instead of filtering in JavaScript after the read.
  - It is also now used in fewer places than the March 19 report suggested.
  - File: `lib/services/member-command-center-supabase.ts:180`

- One previously flagged reporting gap was partially improved:
  - new migration `0094_admin_reporting_and_mar_read_hardening.sql` adds member/date indexes for `daily_activity_logs`, `toilet_logs`, `shower_logs`, and `transportation_logs`;
  - the new `rpc_get_member_documentation_summary` is now used in `admin-reporting-foundation.ts`, so that one documentation report path is no longer doing four separate raw table scans in app code.
  - Files:
    - `supabase/migrations/0094_admin_reporting_and_mar_read_hardening.sql:1`
    - `lib/services/admin-reporting-foundation.ts:186`

- One previously flagged MAR over-fetch issue was partially improved:
  - MAR views no longer use raw `select("*")`; they now use explicit column lists.
  - The larger MAR risk is still present because schedule reconciliation still runs before every snapshot read.
  - File: `lib/services/mar-workflow.ts:50`

- The biggest remaining unresolved risks are still:
  - MHP index double reads plus ensure-on-read
  - MCC index `select("*")` plus ensure-on-read
  - MAR pre-sync on every dashboard load
  - care plan repeated count queries and non-indexed member-name search path
  - member file list reads that still load heavy payload fields
  - full date-range report/export reads for invoices, transportation, and leads
  - incomplete staff/date index support for blood sugar, photo upload, and ancillary activity reads
  - sales summary count fan-out and referral-source partner preloading

- No application code was changed in this audit run. This was a read-only audit plus documentation update.
