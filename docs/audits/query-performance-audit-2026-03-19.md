# Supabase Query Performance Audit
Date: 2026-03-19
Scope: Memory Lane codebase, read-only audit

## 1. Executive Summary

This run found that the main performance risks from the last audit are still present, and one new report-heavy risk area was added.

Highest-risk confirmed findings:

- `listMembersSupabase()` still loads the full member list, sorts it, and then applies text search in memory. That same full-table pattern is still reused by dashboard, payor, schedule-change, hold, and shared lookup pages.
  File: `lib/services/member-command-center-supabase.ts:175`
- `getMemberHealthProfileIndexSupabase()` still does a paged member read, then a second full filtered member read just to calculate counts, then loads aggregate MHP and intake rows for every matching member, not just the current page.
  File: `lib/services/member-health-profiles-supabase.ts:309`
- `getMemberCommandCenterIndexSupabase()` still loads `member_command_centers` and `member_attendance_schedules` with `select("*")` and can still call ensure helpers once per missing member on a read path.
  File: `lib/services/member-command-center-supabase.ts:708`
- `getMarWorkflowSnapshot()` still forces MAR schedule reconciliation before every snapshot read, then pulls eight MAR views with `select("*")`.
  File: `lib/services/mar-workflow.ts:192`
- `getCarePlans()` now pages the main list, but it still does a separate member-name search query plus four additional count queries for summary cards on every request.
  File: `lib/services/care-plans-supabase.ts:421`
- `listAdminAuditTrailRows()` still fetches the rows first and applies `areaFilter` in memory after the SQL limit, which can become both slow and incomplete as audit volume grows.
  File: `lib/services/admin-audit-trail.ts:26`
- `listMemberFilesSupabase()` still uses `select("*")`, so member file list pages can still pull large legacy payload columns that the UI does not need.
  File: `lib/services/member-command-center-supabase.ts:583`
- New since the last run: the new admin reporting foundation introduced several report/export reads that pull whole date ranges into app memory for invoices, transportation logs, sales leads, and documentation logs instead of pushing more aggregation into SQL.
  File: `lib/services/admin-reporting-foundation.ts:318`

Main founder takeaway:

- Yesterday’s big hotspots were not materially reduced in the current worktree.
- The biggest new change is report-related data loading, especially the new admin reporting foundation.
- I still do not have production query plans or row counts, so the audit is based on code and migration evidence, not live telemetry.

## 2. Missing Indexes

### Confirmed

- Missing search index for member name lookups used by `ilike` search.
  Why it matters: member list, MHP, and care plan search all depend on `members.display_name`, and there is no repo evidence of a trigram/GIN index to support that pattern.
  Evidence:
  - `lib/services/member-command-center-supabase.ts:219`
  - `lib/services/member-health-profiles-supabase.ts:331`
  - `lib/services/care-plans-supabase.ts:379`
  - only member-scoped indexes are present in migrations, not a `display_name` search index

- Missing global care plan due-date index.
  Why it matters: care plan dashboards sort and filter across all members by `next_due_date`, but the repo only defines `care_plans(member_id, next_due_date desc)`.
  Evidence:
  - `lib/services/care-plans-supabase.ts:448`
  - `supabase/migrations/0015_schema_compatibility_backfill.sql:416`

- Missing `system_events` correlation index for alert de-dup checks.
  Why it matters: alert checks filter by `event_type`, `entity_type`, `correlation_id`, `status`, and sometimes `entity_id`, but migrations only show generic `created_at`, `event_type`, `status`, and `entity_type` indexes.
  Evidence:
  - `lib/services/workflow-observability.ts:106`
  - `supabase/migrations/0042_system_events_audit_trail.sql`
  - `supabase/migrations/0046_operational_reliability_observability.sql`
  - `supabase/migrations/0050_workflow_reliability_indexes.sql`

- Missing range indexes for report and activity snapshot tables.
  Why it matters: multiple staff/member/report screens filter these tables by staff or member plus a time range, but there is no repo evidence of supporting composite indexes.
  Evidence:
  - `lib/services/activity-snapshots.ts:129`
  - `lib/services/activity-snapshots.ts:279`
  - `lib/services/admin-reporting-foundation.ts:404`
  Missing index families:
  - `daily_activity_logs(staff_user_id, created_at desc)`
  - `daily_activity_logs(member_id, created_at desc)`
  - `toilet_logs(staff_user_id, event_at desc)`
  - `toilet_logs(member_id, event_at desc)`
  - `shower_logs(staff_user_id, event_at desc)`
  - `shower_logs(member_id, event_at desc)`
  - `member_photo_uploads(uploaded_by, uploaded_at desc)`
  - `member_photo_uploads(member_id, uploaded_at desc)`
  - `blood_sugar_logs(nurse_user_id, checked_at desc)`
  - `blood_sugar_logs(member_id, checked_at desc)`
  - `ancillary_charge_logs(member_id, service_date desc)`
  - `ancillary_charge_logs(staff_user_id, created_at desc)`

- Missing MAR indexes for global today/history views.
  Why it matters: existing MAR indexes are mostly member-scoped, while the current views filter globally by today’s date, active status, source, and administered time.
  Evidence:
  - `lib/services/mar-workflow.ts:215`
  - `supabase/migrations/0028_pof_seeded_mar_workflow.sql:254`
  - `supabase/migrations/0030_mar_overdue_view.sql:1`

### Likely

- Missing search indexes for sales text search paths.
  Why it matters: lead, partner, and referral-source pages rely on `ilike` searches against names and contact fields, and I found no repo evidence of matching search indexes.
  Evidence:
  - `lib/services/sales-crm-supabase.ts:701`
  - `lib/services/sales-crm-supabase.ts:772`
  - `lib/services/sales-crm-supabase.ts:803`

## 3. Potential Table Scans

- Confirmed: full member-table reads still happen on the shared member lookup path, then search is applied in memory.
  File: `lib/services/member-command-center-supabase.ts:175`
  Why it could become slow: every reuse of this helper grows with total member count, not with the number of rows the page actually needs.
  Estimated scaling risk: Near-term

- Confirmed: MHP index still performs a second full filtered member read plus aggregate MHP/intake reads for all matching members.
  File: `lib/services/member-health-profiles-supabase.ts:338`
  Why it could become slow: even paged screens still force large aggregate scans for counts.
  Estimated scaling risk: Near-term

- Confirmed: care plan text search still starts with a separate `members` name search using `ilike`, then turns that result set into an `in(member_id, ...)` filter.
  File: `lib/services/care-plans-supabase.ts:375`
  Why it could become slow: the member-name search itself can become a wide scan, and then the care-plan query inherits a large `IN` list.
  Estimated scaling risk: Near-term

- Confirmed: new admin reporting queries pull entire date ranges for billing invoices, transportation logs, leads, and documentation rows without pagination.
  Files:
  - `lib/services/admin-reporting-foundation.ts:318`
  - `lib/services/admin-reporting-foundation.ts:349`
  - `lib/services/admin-reporting-foundation.ts:378`
  - `lib/services/admin-reporting-foundation.ts:404`
  Why it could become slow: these are report/export style reads, but the current implementation still pushes a lot of row scanning and aggregation into the app process.
  Estimated scaling risk: Near-term

- Likely: referral-source directory still reloads up to 500 partner rows on every request before it even runs the paged referral-source query.
  File: `lib/services/sales-crm-supabase.ts:786`
  Why it could become slow: the normalization step has a fixed extra read cost per request that grows with directory size.
  Estimated scaling risk: Near-term

## 4. N+1 Query Patterns

- Confirmed: MHP index can still call `ensureMemberHealthProfileSupabase()` once per missing member on the current page.
  File: `lib/services/member-health-profiles-supabase.ts:398`
  Why it could become slow: missing canonical rows turn one list read into many follow-up reads and writes.
  Estimated scaling risk: Near-term
  Recommended fix: stop ensuring rows inside list-page reads; backfill missing canonical records in a separate migration/job or a batched RPC path.

- Confirmed: MCC index can still call `ensureMemberCommandCenterProfileSupabase()` once per missing member and `ensureMemberAttendanceScheduleSupabase()` once per missing member.
  File: `lib/services/member-command-center-supabase.ts:755`
  Why it could become slow: one page request can fan out into many extra queries and writes.
  Estimated scaling risk: Near-term
  Recommended fix: same pattern as MHP; avoid ensure-on-read for index pages.

## 5. Inefficient Data Fetching

- Confirmed: MAR dashboard still performs write-like reconciliation work on every read.
  File: `lib/services/mar-workflow.ts:198`
  Why it could become slow or expensive: every MAR snapshot first calls `syncTodayMarSchedules()`, which scans active center medications and runs reconcile work per member before the page can read.
  Estimated scaling risk: Immediate
  Recommended fix: move reconciliation off the hot read path or add a freshness gate so the read only syncs when a real gap exists.

- Confirmed: MAR snapshot still uses `select("*")` across eight views.
  File: `lib/services/mar-workflow.ts:215`
  Why it could become slow or expensive: wide view payloads increase transfer cost and make Postgres do more work than the dashboard actually needs.
  Estimated scaling risk: Near-term
  Recommended fix: explicitly select only the fields the dashboard renders.

- Confirmed: member file lists still use `select("*")`.
  File: `lib/services/member-command-center-supabase.ts:586`
  Why it could become slow or expensive: legacy rows can still contain `file_data_url`, which is much heavier than simple file metadata.
  Estimated scaling risk: Near-term
  Recommended fix: use a metadata-only select for list pages and leave full-row reads to file detail/download flows.

- Confirmed: MCC index still uses `select("*")` for command center and attendance schedule rows.
  File: `lib/services/member-command-center-supabase.ts:727`
  Why it could become slow or expensive: page lists only need a subset of profile/schedule fields, but they still pull every column.
  Estimated scaling risk: Near-term
  Recommended fix: define a narrow list select for MCC index rows.

- Confirmed: care plan list still pays for one main query plus four separate summary count queries every time.
  File: `lib/services/care-plans-supabase.ts:474`
  Why it could become slow or expensive: the page request fans out into repeated near-duplicate queries over the same dataset.
  Estimated scaling risk: Near-term
  Recommended fix: compute counts in one grouped SQL/RPC path.

- Confirmed: admin audit trail still pushes `areaFilter` into JavaScript instead of SQL.
  File: `lib/services/admin-audit-trail.ts:69`
  Why it could become slow or expensive: large logs still need to be read before the app throws rows away, and the SQL limit can hide valid matches.
  Estimated scaling risk: Near-term
  Recommended fix: persist a canonical area/module field or push the entity-type grouping logic closer to SQL.

- Confirmed: staff detail read model still loads unbounded `select("*")` activity history across eight tables.
  File: `lib/services/staff-detail-read-model.ts:42`
  Why it could become slow or expensive: detail pages grow forever with staff history and can become one of the heaviest per-user pages in the app.
  Estimated scaling risk: Near-term
  Recommended fix: add date limits or pagination and switch to narrower selects.

- Confirmed: dashboard admin snapshot still calls the full shared member list even though it only needs id and display name.
  File: `app/(portal)/dashboard/page.tsx:92`
  Why it could become slow or expensive: this adds a broad member read to a high-traffic dashboard path.
  Estimated scaling risk: Near-term
  Recommended fix: replace with a dedicated lightweight lookup query.

- Likely: sales activity/new-entry pages still load capped but broad lookup sets.
  Files:
  - `lib/services/sales-crm-supabase.ts:504`
  - `app/(portal)/sales/activities/page.tsx:10`
  Why it could become slow or expensive: 500-row lookup caps are safer than full-table reads, but they still scale poorly and can become stale once directories grow past the cap.
  Estimated scaling risk: Long-term

## 6. Duplicate Query Logic

- Confirmed: audit log read logic is split between admin audit trail and user management recent activity.
  Files:
  - `lib/services/admin-audit-trail.ts:26`
  - `lib/services/user-management.ts:591`
  Why it matters: if one path gets pagination/index hardening and the other does not, audit behavior drifts.

- Confirmed: member lookup logic still fans out through the same full-table helper in multiple screens.
  Files:
  - `lib/services/member-command-center-supabase.ts:175`
  - `app/(portal)/dashboard/page.tsx:95`
  - `lib/services/shared-lookups-supabase.ts:28`
  - `app/(portal)/operations/member-command-center/actions-impl.ts:156`
  - `app/(portal)/operations/payor/billing-agreements/page.tsx:21`
  Why it matters: one slow shared helper now affects several workflows at once.

- Confirmed: activity snapshot/report logic is duplicated across multiple services over the same documentation tables.
  Files:
  - `lib/services/activity-snapshots.ts:128`
  - `lib/services/admin-reporting-foundation.ts:404`
  - `lib/services/staff-detail-read-model.ts:48`
  Why it matters: the same tables are queried three different ways, which makes index planning and future hardening harder.

- Confirmed: member file reads are split between MCC list code and the broader member-files service.
  Files:
  - `lib/services/member-command-center-supabase.ts:583`
  - `lib/services/member-files.ts:129`
  Why it matters: metadata vs full-row access is not standardized yet.

## 7. Recommended Index Additions

These are the safest high-value index additions based on the current code:

```sql
create extension if not exists pg_trgm;

create index if not exists idx_members_display_name_trgm
  on public.members using gin (display_name gin_trgm_ops);

create index if not exists idx_care_plans_next_due_date_desc
  on public.care_plans (next_due_date desc);

create index if not exists idx_system_events_alert_dedupe
  on public.system_events (event_type, entity_type, correlation_id, status, entity_id, created_at desc);

create index if not exists idx_daily_activity_logs_staff_created_at_desc
  on public.daily_activity_logs (staff_user_id, created_at desc);

create index if not exists idx_daily_activity_logs_member_created_at_desc
  on public.daily_activity_logs (member_id, created_at desc);

create index if not exists idx_toilet_logs_staff_event_at_desc
  on public.toilet_logs (staff_user_id, event_at desc);

create index if not exists idx_toilet_logs_member_event_at_desc
  on public.toilet_logs (member_id, event_at desc);

create index if not exists idx_shower_logs_staff_event_at_desc
  on public.shower_logs (staff_user_id, event_at desc);

create index if not exists idx_shower_logs_member_event_at_desc
  on public.shower_logs (member_id, event_at desc);

create index if not exists idx_member_photo_uploads_uploaded_by_uploaded_at_desc
  on public.member_photo_uploads (uploaded_by, uploaded_at desc);

create index if not exists idx_member_photo_uploads_member_uploaded_at_desc
  on public.member_photo_uploads (member_id, uploaded_at desc);

create index if not exists idx_blood_sugar_logs_nurse_checked_at_desc
  on public.blood_sugar_logs (nurse_user_id, checked_at desc);

create index if not exists idx_blood_sugar_logs_member_checked_at_desc
  on public.blood_sugar_logs (member_id, checked_at desc);

create index if not exists idx_ancillary_charge_logs_member_service_date_desc
  on public.ancillary_charge_logs (member_id, service_date desc);

create index if not exists idx_ancillary_charge_logs_staff_created_at_desc
  on public.ancillary_charge_logs (staff_user_id, created_at desc);

create index if not exists idx_mar_schedules_active_scheduled_time
  on public.mar_schedules (scheduled_time asc, member_id)
  where active = true;

create index if not exists idx_mar_administrations_date_status_time
  on public.mar_administrations (administration_date, status, administered_at desc);

create index if not exists idx_mar_administrations_source_administered_at_desc
  on public.mar_administrations (source, administered_at desc);
```

## 8. Performance Hardening Plan

1. Replace remaining `listMembersSupabase()` callers with one of two safer patterns:
   - paged searchable member list for list screens
   - lightweight `id, display_name` lookup for dropdowns and dashboard widgets

2. Remove ensure-on-read from MHP and MCC index pages.
   - Missing canonical rows should be backfilled in a batched job, migration, or RPC, not one row at a time during list rendering.

3. Harden MAR read paths first.
   - Move `syncTodayMarSchedules()` off the hot read path or gate it behind a staleness check.
   - Add the missing MAR indexes.
   - Replace `select("*")` with explicit column lists for dashboard views.

4. Simplify care plan list/dashboard queries.
   - Add the global due-date index.
   - Replace repeated count queries with one grouped query or shared RPC.
   - Keep member search on an indexed path.

5. Push more work into SQL for reporting and audit pages.
   - Reports should use database-side aggregation where possible.
   - Audit area filtering should not happen after the SQL limit.
   - Staff detail/history pages need pagination or date windows.

6. Normalize sales search and summary reads.
   - Replace many count calls with one summary RPC/view where possible.
   - Stop reloading the same partner directory rows on each referral-source page request.
   - Add search indexes if sales search volume is expected to grow.

## 9. Suggested Codex Prompts

### Prompt 1

Audit and refactor the remaining `listMembersSupabase()` call sites in Memory Lane so high-traffic pages stop loading the full `members` table. Replace each caller with either a paginated member list query or a lightweight lookup query that only selects the fields the UI needs. Preserve canonical Supabase service boundaries and do not add UI-side business logic. Also add the smallest safe supporting index or search optimization if the query pattern needs it.

### Prompt 2

Harden the MHP and Member Command Center index pages so they do not call ensure helpers once per missing member during list reads. Keep Supabase as the source of truth, preserve canonical service boundaries, and prefer a batched backfill-safe approach over per-row ensure-on-read behavior. Return the exact files changed, the downstream workflows affected, and any migration/index needs.

### Prompt 3

Refactor the MAR dashboard read path so `getMarWorkflowSnapshot()` no longer performs heavy reconciliation work on every page load. Add any missing MAR indexes needed for today/history/PRN views, replace `select("*")` with explicit columns where safe, and preserve the canonical RPC-backed write path for MAR schedule generation.

### Prompt 4

Optimize Memory Lane care plan list and dashboard queries. Replace repeated count fan-out with one grouped query or canonical RPC, keep pagination intact, add the smallest safe missing index support for global `next_due_date` ordering, and preserve canonical care plan service boundaries.

### Prompt 5

Harden the admin reporting and audit read paths in Memory Lane. Push report aggregation into SQL where practical, remove in-memory post-limit filtering in the admin audit trail, and add pagination or bounded date windows where pages currently read large histories. Keep changes production-safe and explain any migration/index additions.

### Prompt 6

Review the sales summary, referral-source directory, and form lookup queries in Memory Lane for read amplification. Reduce repeated count queries, stop unnecessary partner-directory reloads on each request, and add the smallest safe search-index support if the current `ilike` paths will not scale.

## 10. Founder Summary: What changed since the last run

- The main previously flagged hotspots are still there. I did not find evidence in the current worktree that member list full-table reads, MHP aggregate double reads, MCC ensure-on-read, MAR pre-sync on dashboard load, care plan repeated counts, member file `select("*")`, or the audit-log area-filter issue were fixed.

- The biggest new change since the last run is the new reporting split:
  - `lib/services/admin-reporting-foundation.ts`
  - `lib/services/admin-reporting-core.ts`
  These files add several report/export reads that pull full date-range datasets into app memory for invoices, transportation, sales leads, and documentation logs. That is now one of the clearest new scaling risks in the repo.

- I also reviewed the newly split incident services. They do add new query surface area, but the current incident reads are mostly bounded by `id`, `limit`, or already-indexed status/date patterns, so they are not the top performance concern from this run.

- No application code was changed in this audit run. This was a read-only performance review plus documentation.

- Residual validation gap:
  I still do not have production row counts, slow-query logs, or `EXPLAIN ANALYZE`, so anything labeled `likely` should be runtime-verified before a migration bundle is finalized.
