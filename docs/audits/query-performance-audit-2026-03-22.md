# Supabase Query Performance Audit - 2026-03-22

## 1. Executive Summary

This run found that several March 21 fixes were real and materially improved the repo:

- Sales pipeline summary counts are now centralized behind `rpc_get_sales_pipeline_summary_counts` in `lib/services/sales-workflows.ts:56-157`, so the old app-memory lead-summary drift is reduced.
- The repo now includes search/index support added in `supabase/migrations/0105_sales_pipeline_summary_rpc_and_search_indexes.sql:1-154` for member search, audit-log area filtering, system-event correlation lookups, and partner/referral directory search.
- Member detail previews are now capped at 50 rows in `lib/services/member-detail-read-model.ts:87-209`, which is safer than the older unbounded history reads.

The biggest remaining risks have shifted into newer MAR/PRN and dashboard paths:

- The MAR page still triggers schedule reconciliation on page load in `app/(portal)/health/mar/page.tsx:25`, and `lib/services/mar-workflow-read.ts:187-190` also runs PRN-order sync before every snapshot read.
- The MAR monthly report member selector in `lib/services/mar-monthly-report.ts:360-404` scans multiple medication and administration tables just to build dropdown options.
- The health dashboard in `lib/services/health-dashboard.ts:66-178` still reads the full active member set plus MCC and MHP rows to build a small alert card.
- Progress note dashboard pagination is still happening in app memory in `lib/services/progress-notes-read-model.ts:212-258`.
- Staff and member activity snapshot screens still fire many exact-count queries per request, and the repo still does not show matching staff/date indexes for several of those tables.

Because this audit is repo-based, not telemetry-based, anything labeled `likely` still needs confirmation with real row counts or `EXPLAIN`.

## 2. Missing Indexes

- High, confirmed: staff/date indexes are still missing for several snapshot and detail paths. Current reads filter by staff and sort by event time in:
  - `lib/services/activity-snapshots.ts:163-245`
  - `lib/services/staff-detail-read-model.ts:50-60`
  - `lib/services/member-detail-read-model.ts:126-198`
  There is repo evidence for member/date indexes from `supabase/migrations/0094_admin_reporting_and_mar_read_hardening.sql:1-11`, but not for these staff-centered shapes:
  - `daily_activity_logs(staff_user_id, created_at desc)`
  - `toilet_logs(staff_user_id, event_at desc)`
  - `shower_logs(staff_user_id, event_at desc)`
  - `transportation_logs(staff_user_id, service_date desc)`
  - `intake_assessments(completed_by_user_id, created_at desc)`
  - `intake_assessments(created_by_user_id, created_at desc)`
  - `lead_activities(completed_by_user_id, activity_at desc)`

- High, confirmed: the new global PRN read paths do not have matching global indexes. `lib/services/mar-prn-workflow.ts:224-242` reads `medication_orders` by `order_type = 'prn'` and `status = 'active'` without a member filter, while `lib/services/mar-prn-workflow.ts:255-265` reads `med_administration_logs` by `admin_type = 'prn'` ordered by `admin_datetime desc`. The current migration `supabase/migrations/0107_prn_medication_orders_and_logs.sql:34-41,81-85` only shows indexes that start with `member_id` or `medication_order_id`, which is weaker for these global screens.

- High, confirmed: sales lead search still has no repo evidence of search indexes for `leads.member_name` and `leads.caregiver_name`, even though `lib/services/sales-crm-read-model.ts:452-456` now uses wildcard `ilike` search on both fields.

- Medium, confirmed: there is still no repo evidence of a standalone `leads(inquiry_date desc)` index even though both `lib/services/sales-crm-read-model.ts:399` and `lib/services/sales-crm-read-model.ts:458-462` order by `inquiry_date`.

- Medium, confirmed: there is still no repo evidence of a standalone `ancillary_charge_logs(service_date desc)` index even though the main dashboard pulls a whole month by `service_date` in `app/(portal)/dashboard/page.tsx:102-107`.

- Medium, likely: `partner_activities` still has no repo evidence of an `activity_at` index even though recent-activity and staff snapshot reads sort by that column in:
  - `lib/services/sales-crm-read-model.ts:490-494`
  - `lib/services/activity-snapshots.ts:231-237`

## 3. Potential Table Scans

- Critical, confirmed: the MAR page still opts into `reconcileToday: true` in `app/(portal)/health/mar/page.tsx:25`. That flows into `lib/services/mar-workflow-read.ts:187-189`, which calls `syncTodayMarSchedules()`. Inside `lib/services/mar-workflow-read.ts:157-177`, the code calculates candidate members and then runs one reconcile RPC per member. This is still a read path doing write-like reconciliation work before the page can render.

- High, confirmed: `getMarWorkflowSnapshot()` now always runs `syncActivePrnMedicationOrders()` before returning data in `lib/services/mar-workflow-read.ts:187-190`. That means the health dashboard and MAR page both pay for a PRN sync RPC on every snapshot read, even when the caller only wants to view data.

- High, confirmed: `getMarMonthlyReportMemberOptions()` in `lib/services/mar-monthly-report.ts:360-404` reads all matching rows from four tables just to build member choices:
  - `pof_medications`
  - `mar_administrations`
  - `medication_orders`
  - `med_administration_logs`
  There is no date window, no `distinct`, no pagination, and no caching. This will get more expensive every month the system runs.

- High, confirmed: `getHealthDashboardData()` in `lib/services/health-dashboard.ts:66-178` reads the full active member census, then reads all matching MCC and MHP rows to produce only the top 12 care alerts. This is simple, but it scales with the whole active census on every dashboard load.

- High, confirmed: `getProgressNoteTracker()` in `lib/services/progress-notes-read-model.ts:212-258` still loads all matching members and all matching progress notes, then sorts and slices the current page in memory. The first page is not actually cheap.

- High, likely: the lead list and recent-inquiry reads in `lib/services/sales-crm-read-model.ts:399,439-462` can still degrade into scans and expensive sorts because the current repo does not show search indexes for lead names or a dedicated `inquiry_date` index.

- Medium, confirmed: the main dashboard admin snapshot in `app/(portal)/dashboard/page.tsx:97-117` still loads the entire member name directory and all ancillary charge rows for the current month up front. That is acceptable at small scale, but it is unnecessary work for a summary card.

## 4. N+1 Query Patterns

- Critical, confirmed: `syncTodayMarSchedules()` in `lib/services/mar-workflow-read.ts:168-177` is still a repeated-query-inside-a-loop pattern. Once it decides which members need reconciliation, it calls `generateMarSchedulesForMemberRead()` once per member. On busy days, one page load can fan out into many RPC calls.

- No other high-priority list pages showed a confirmed classic row-by-row N+1 pattern in this run. Earlier MCC and MHP list-path ensure-on-read issues are no longer the main performance story.

## 5. Inefficient Data Fetching

- High, confirmed: `getStaffActivitySnapshot()` in `lib/services/activity-snapshots.ts:150-256` issues 10 separate exact-count queries every time the page loads. The queries are parallelized, but the page still pays for 10 count operations plus 10 result sets.

- High, confirmed: `getMemberActivitySnapshot()` in `lib/services/activity-snapshots.ts:325-411` does the same pattern across 8 separate sources. This is not broken, but it is still expensive for a dashboard-style read.

- High, confirmed: `getStaffDetail()` in `lib/services/staff-detail-read-model.ts:44-89` still uses `select("*")` on `profiles` and on eight history tables. The 250-row cap helps, but the payload is still much wider than the screen needs.

- High, confirmed: `getProgressNoteDashboard()` in `lib/services/progress-notes-read-model.ts:253-266` inherits the full-read behavior from `getProgressNoteTracker()`, so the health dashboard is paying for all matching notes before showing a 25-row page.

- Medium, confirmed: the MAR page does duplicated member-option work on the same request. `app/(portal)/health/mar/page.tsx:18-25` loads report member options through `getMarMonthlyReportMemberOptions()`, then loads workflow member options again through `getMarWorkflowSnapshot()`.

- Medium, confirmed: the main dashboard admin snapshot in `app/(portal)/dashboard/page.tsx:97-117` still pulls more data than the cards need, especially the whole member directory and full monthly ancillary rows.

## 6. Duplicate Query Logic

- High, confirmed: MAR member-option loading is now split across two different read paths:
  - `lib/services/mar-monthly-report.ts:360-413`
  - `lib/services/mar-workflow-read.ts:249-269`
  Both exist on the same page load in `app/(portal)/health/mar/page.tsx:18-25`. That means duplicated work and two different definitions of who should appear in a MAR dropdown.

- Medium, confirmed: activity timeline logic is still spread across three places that query many of the same tables with different shapes:
  - `lib/services/activity-snapshots.ts`
  - `lib/services/member-detail-read-model.ts`
  - `lib/services/staff-detail-read-model.ts`
  This makes index planning and payload trimming harder because the same operational history is still being read three different ways.

- Medium, confirmed: full member-directory lookups are still used across multiple pages and workflows through `listMemberNameLookupSupabase()` / `listActiveMemberLookupSupabase()`, including:
  - `app/(portal)/dashboard/page.tsx:100`
  - `app/(portal)/health/physician-orders/page.tsx:49`
  - `app/(portal)/operations/payor/billing-agreements/page.tsx:18`
  - `app/(portal)/operations/payor/custom-invoices/page.tsx:216`
  This is centralized service code, which is good, but the underlying pattern is still “load the whole directory” for many dropdowns and dashboards.

## 7. Recommended Index Additions

These are the safest index additions still justified by the current code:

```sql
create extension if not exists pg_trgm;

create index if not exists idx_daily_activity_logs_staff_user_id_created_at_desc
  on public.daily_activity_logs (staff_user_id, created_at desc);

create index if not exists idx_toilet_logs_staff_user_id_event_at_desc
  on public.toilet_logs (staff_user_id, event_at desc);

create index if not exists idx_shower_logs_staff_user_id_event_at_desc
  on public.shower_logs (staff_user_id, event_at desc);

create index if not exists idx_transportation_logs_staff_user_id_service_date_desc
  on public.transportation_logs (staff_user_id, service_date desc);

create index if not exists idx_intake_assessments_completed_by_user_id_created_at_desc
  on public.intake_assessments (completed_by_user_id, created_at desc);

create index if not exists idx_intake_assessments_created_by_user_id_created_at_desc
  on public.intake_assessments (created_by_user_id, created_at desc);

create index if not exists idx_lead_activities_completed_by_user_id_activity_at_desc
  on public.lead_activities (completed_by_user_id, activity_at desc);

create index if not exists idx_leads_inquiry_date_desc
  on public.leads (inquiry_date desc);

create index if not exists idx_leads_member_name_trgm
  on public.leads using gin (member_name gin_trgm_ops);

create index if not exists idx_leads_caregiver_name_trgm
  on public.leads using gin (caregiver_name gin_trgm_ops);

create index if not exists idx_partner_activities_activity_at_desc
  on public.partner_activities (activity_at desc);

create index if not exists idx_ancillary_charge_logs_service_date_desc
  on public.ancillary_charge_logs (service_date desc);

create index if not exists idx_medication_orders_order_type_status_medication_name
  on public.medication_orders (order_type, status, medication_name);

create index if not exists idx_med_administration_logs_admin_type_admin_datetime_desc
  on public.med_administration_logs (admin_type, admin_datetime desc);
```

I am not recommending “index your way out” of `getMarMonthlyReportMemberOptions()` alone. That path should be rewritten first, because it currently walks whole tables on purpose.

## 8. Performance Hardening Plan

1. Stop doing reconciliation and PRN sync on normal MAR page reads.
   Move both behaviors behind an explicit refresh action, a freshness guard, or a background job.

2. Replace the MAR monthly report member-option builder with one canonical RPC or view.
   It should return distinct eligible member IDs directly from SQL instead of reading four whole tables into Node.

3. Rebuild progress note dashboard reads so paging happens in SQL.
   Keep summary counts in SQL or RPC too, so page 1 does not load the full note universe.

4. Move health dashboard care-alert resolution closer to SQL.
   The page only needs a short alert list, not the full active member + MCC + MHP join in app memory.

5. Add the missing staff/date and sales lead search indexes.
   These are small, safe schema changes with clear upside and low architectural risk.

6. Consolidate activity timeline reads.
   Member summary, staff summary, and detail pages should share narrower read models so the same tables are not queried three different ways.

7. After the above, capture real query plans for:
   - `/health/mar`
   - `/health`
   - sales lead list search
   - progress note dashboard
   - staff activity snapshot

## 9. Suggested Codex Prompts

- "Refactor Memory Lane MAR reads so `getMarWorkflowSnapshot()` does not run schedule reconciliation or PRN sync on every page load. Keep Supabase as the source of truth, preserve the current RPC-backed write path, and add a safe explicit refresh path instead."

- "Replace `getMarMonthlyReportMemberOptions()` with a production-safe Supabase RPC or SQL view that returns distinct eligible member options without scanning full medication and administration tables in Node."

- "Harden Memory Lane progress note dashboard performance by moving pagination and summary counts into SQL/RPC. Preserve canonical service boundaries and keep the result founder-readable and auditable."

- "Add the missing staff/date and sales lead search indexes identified in the March 22 query performance audit. Use forward-only Supabase migrations and avoid changing runtime behavior unless a query shape needs to be aligned."

- "Consolidate Memory Lane activity timeline reads across staff snapshot, member snapshot, and member/staff detail screens so the app stops querying the same operational tables three different ways."

## 10. Founder Summary: What changed since the last run

Compared with the March 21 audit, a few important things are now clearly better:

- The repo now includes the search and correlation indexes that were still missing in the last report. `supabase/migrations/0105_sales_pipeline_summary_rpc_and_search_indexes.sql:111-154` adds support for:
  - member name search
  - audit-log entity-type search
  - system-event correlation lookups
  - partner/referral directory search

- Sales pipeline summary counts are now routed through `rpc_get_sales_pipeline_summary_counts` in:
  - `supabase/migrations/0105_sales_pipeline_summary_rpc_and_search_indexes.sql:3-109`
  - `lib/services/sales-workflows.ts:56-157`
  - `lib/services/sales-crm-read-model.ts:395-400`
  That removes one of the bigger previous sources of duplicate lead-summary work.

- Member detail previews are safer than the last run. `lib/services/member-detail-read-model.ts:87-209` now caps the preview tables at 50 rows instead of letting those histories keep growing forever inside one request.

What got worse, or at least more performance-sensitive, since the last run:

- The new PRN workflow introduced fresh read-path cost. `lib/services/mar-workflow-read.ts:187-190` now runs PRN sync on every MAR snapshot read, and the MAR page still adds schedule reconciliation on top of that in `app/(portal)/health/mar/page.tsx:25`.

- The new MAR monthly report option loader in `lib/services/mar-monthly-report.ts:360-404` is now one of the clearest whole-table-read risks in the repo.

- The health dashboard and progress note dashboard now matter more than the old MCC/MHP/care-plan list issues. Those older list paths improved, but dashboard reads are still doing too much total work per page load.

Net result: this repo is in a better place than the March 21 baseline for search and sales summary reads, but the current performance risk has shifted toward MAR/PRN reads, dashboard fan-out, and in-memory pagination.
