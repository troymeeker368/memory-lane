# Supabase Query Performance Audit - 2026-03-24

## 1. Executive Summary

This run is better than the March 23 baseline, but a smaller set of broad read paths still needs attention.

- The health dashboard no longer pays for the full MAR workflow snapshot. It now calls `getHealthDashboardMarTodayRows()` in `lib/services/health-dashboard.ts:74-94`, which is a real improvement over yesterday's heavier MAR read path.
- Member detail no longer appears to use the old `count: "exact"` fan-out called out in the March 23 report. `lib/services/member-detail-read-model.ts:155-217` still issues many preview queries, but they are now capped preview reads instead of full exact counts.
- The current working tree also narrows several high-width `select("*")` calls:
  - `lib/services/member-health-profiles-supabase.ts:645-663`
  - `lib/services/member-command-center-runtime.ts:528-533`
- The current working tree adds `supabase/migrations/0124_data_access_optimization_indexes.sql:1-36`, which improves attendance, transportation, partner/referral, lead-activity, and billing invoice access paths.

The biggest remaining risks are now:

- the admin audit trail still doing a large descending scan with no real pagination
- the blood sugar workflow still loading the full MAR snapshot even though the page only shows blood sugar history
- Member Command Center still doing whole-table roster reads for locker availability and add-rider options
- Member Health Profile detail still reloading full provider and hospital directories on every member page load

This is a codebase audit, not a live `EXPLAIN` audit. Items marked `likely` still need production-plan verification.

## 2. Missing Indexes

- Medium, confirmed: `lib/services/admin-audit-trail.ts:58-70` filters `audit_logs` by `action` and orders by `created_at desc`, but the repo only shows `audit_logs(entity_type, created_at desc)`, `audit_logs(actor_user_id, created_at desc)`, and trigram support on `entity_type`. There is no matching `audit_logs(action, created_at desc)` index.
- Medium, likely: `lib/services/health-dashboard.ts:76-80` and `lib/services/health-workflows.ts:9-13` both read the newest blood sugar rows by `checked_at desc`, but the repo only shows member-scoped and nurse-scoped blood sugar indexes in `supabase/migrations/0115_activity_snapshot_timeline_rpcs.sql:607-611`. There is no plain `blood_sugar_logs(checked_at desc)` index for the global "latest 100" read.
- No other confirmed missing indexes in the prioritized domains this run. Most of yesterday's sales partner/referral and activity index gaps are now covered by `supabase/migrations/0124_data_access_optimization_indexes.sql:14-36`.

## 3. Potential Table Scans

- High, confirmed: the admin audit trail page still loads up to 1,000 rows with no page/range cursor in:
  - `app/(portal)/admin-reports/audit-trail/page.tsx:116-120`
  - `lib/services/admin-audit-trail.ts:58-70`
  With no `action, created_at` index, the action-filtered path can degrade into a scan-plus-sort as audit volume grows.

- Medium, confirmed: `getAvailableLockerNumbersForMemberSupabase()` reads every member row just to calculate open lockers for one member in `lib/services/member-command-center-runtime.ts:270-293`. That is a whole-table roster read on every locker edit flow.

- Medium, confirmed: `getTransportationAddRiderMemberOptionsSupabase()` still reads the full active member roster, then fans out into `member_command_centers` and `member_contacts` for all of those members in `lib/services/member-command-center-runtime.ts:519-560`. The narrowed select list helps, but the query shape still scales with the entire active census.

- Medium, likely: the latest blood sugar reads in `lib/services/health-dashboard.ts:76-80` and `lib/services/health-workflows.ts:9-13` can become a scan-plus-sort because the repo does not show a standalone `checked_at desc` index for the underlying `blood_sugar_logs` table.

## 4. N+1 Query Patterns

No confirmed classic N+1 query patterns were found in the prioritized list and dashboard pages this run.

Residual note:

- The current risks are mostly broad whole-table reads and duplicated page-level fetches, not row-by-row lookup loops.

## 5. Inefficient Data Fetching

- High, confirmed: the blood sugar workflow page still calls `getHealthSnapshot()` in `app/(portal)/documentation/blood-sugar/page.tsx:16`, and that helper still loads the full MAR workflow snapshot in `lib/services/health-workflows.ts:5-19`. This page only needs blood sugar history and member lookup, so it is still paying for MAR today/history/PRN work it does not render.

- High, confirmed: Member Health Profile detail still reloads the full provider and hospital directories on every member detail request in `lib/services/member-health-profiles-supabase.ts:647-654`. The move away from `select("*")` is good, but it is still a full-directory read every time someone opens one member record.

- Medium, confirmed: the same provider and hospital directories are also fully read during write-time upsert checks in `lib/services/member-health-profiles-write-supabase.ts:371-445`. That means the app pays for whole-directory scans both when rendering MHP detail and when saving provider/hospital updates.

- Medium, confirmed: the health dashboard still loads the full active member list on every request in `lib/services/health-dashboard.ts:81-85`. That roster is used for form/dropdown behavior, but it still scales with the whole active census rather than a smaller search-first or deferred lookup model.

- Low, confirmed: `listMemberFilesSupabase()` can still read `member_files` twice when legacy inline files exist in `lib/services/member-command-center-runtime.ts:217-248`. This is not the largest risk in the repo, but it is avoidable repeated work on a detail page.

## 6. Duplicate Query Logic

- Medium, confirmed: care-plan member summary logic is now split between two different patterns:
  - `getMemberCarePlanOverview()` uses a lighter latest-row-plus-count query in `lib/services/care-plans-read-model.ts:480-502`
  - `getMemberCarePlanSnapshot()` still loads all member care plans and sorts in app memory in `lib/services/care-plans-read-model.ts:505-528`
  Callers such as `app/(portal)/health/member-health-profiles/[memberId]/page.tsx:223-229` and `app/(portal)/health/care-plans/member/[memberId]/latest/page.tsx:13` still use the broader snapshot path even when they only need summary/latest behavior.

- Medium, confirmed: provider-directory and hospital-directory reads are duplicated across MHP read and write services:
  - `lib/services/member-health-profiles-supabase.ts:647-654`
  - `lib/services/member-health-profiles-write-supabase.ts:371-445`
  This keeps the same broad lookup logic in two places and doubles the chances of future drift.

- Low, confirmed: active member roster reads remain spread across several services with similar filter-and-order shapes:
  - `lib/services/health-dashboard.ts:81-85`
  - `lib/services/member-command-center-runtime.ts:128-140`
  - `lib/services/member-command-center-runtime.ts:521-525`
  - `lib/services/documentation.ts:108-110`
  This is not a single breaking hotspot, but it keeps repeating the same "load the active census" pattern in multiple surfaces.

## 7. Recommended Index Additions

These are the smallest safe index additions still justified by the current code:

```sql
create index if not exists idx_audit_logs_action_created_at_desc
  on public.audit_logs (action, created_at desc);

create index if not exists idx_blood_sugar_logs_checked_at_desc
  on public.blood_sugar_logs (checked_at desc);
```

Notes:

- I am not recommending new Member Health Profile directory indexes first. The bigger issue there is whole-directory fetching on every request. Query-shape fixes will matter more than another index.
- I am also not recommending new Member Command Center roster indexes first. Those reads need narrower query models more than additional indexing.

## 8. Performance Hardening Plan

1. Paginate the admin audit trail properly.
   Add page/range support in `listAdminAuditTrailRows()`, keep the default page small, and add the missing `audit_logs(action, created_at desc)` index.

2. Split the blood sugar page off from the full MAR snapshot.
   Create a dedicated blood-sugar read model that only returns recent glucose history plus the roster needed for the entry form.

3. Replace whole-table locker and add-rider reads with narrower member option reads.
   Locker availability should query only the fields and rows actually needed for occupied lockers. Add-rider options should move toward search-first or server-filtered lookups instead of loading the entire active census.

4. Stop reloading provider and hospital directories on every MHP detail page.
   Move these to a shared lookup helper with lighter search/load rules, or lazy-load them only when the related edit tab is opened.

5. Reuse the lighter care-plan member summary path.
   Pages that only need "latest plan" or "summary status" should call `getMemberCarePlanOverview()` instead of `getMemberCarePlanSnapshot()`.

6. Collapse the legacy member-files double read.
   Return the inline-file sentinel in one query, or include the needed inline flag in the initial select.

7. After these changes, verify with live query plans.
   The best next `EXPLAIN` targets are:
   - admin audit trail
   - blood sugar page
   - Member Command Center detail
   - transportation add-rider workflow
   - Member Health Profile detail

## 9. Suggested Codex Prompts

- "Refactor Memory Lane admin audit trail reads so the page uses real pagination, keeps Supabase as source of truth, and adds the smallest safe supporting index for `audit_logs(action, created_at desc)`."

- "Create a lightweight blood sugar read model for Memory Lane so the blood sugar workflow page stops calling the full MAR snapshot. Preserve current UI behavior and keep canonical service boundaries."

- "Harden Member Command Center read performance by replacing whole-table locker availability and add-rider roster reads with narrower Supabase queries or shared RPCs. Keep Supabase as source of truth and avoid UI-side business logic."

- "Reduce Member Health Profile detail over-fetching by stopping full provider-directory and hospital-directory reads on every member page load. Preserve current edit flows and use the smallest production-safe refactor."

- "Standardize Memory Lane care-plan member summary reads so pages that only need latest/summary data stop loading the full member care-plan set."

- "Review `listMemberFilesSupabase()` and remove the second `member_files` read used only to detect legacy inline files, while preserving current sentinel behavior."

## 10. Founder Summary: What changed since the last run

The biggest change since yesterday is that the repo is no longer paying the full MAR cost on the main health dashboard.

- The March 23 report called out `/health` for using the full MAR workflow snapshot. In the current code, `lib/services/health-dashboard.ts:74-94` now uses `getHealthDashboardMarTodayRows()` instead. That is a real improvement.

- Member detail also looks healthier than yesterday. The old report called out eight preview queries with `count: "exact"`. In the current `lib/services/member-detail-read-model.ts:155-217`, those preview queries are still there, but they are now capped preview reads rather than exact-count reads.

- The current working tree narrows several wide selects:
  - `lib/services/member-health-profiles-supabase.ts:645-663` now requests explicit column lists instead of broad `select("*")` on several MHP tables.
  - `lib/services/member-command-center-runtime.ts:528-533` now requests a smaller address shape instead of `member_command_centers.select("*")` for add-rider options.

- The current working tree also adds new supporting indexes in `supabase/migrations/0124_data_access_optimization_indexes.sql:1-36`. Those improve attendance, transportation, partner/referral, lead-activity, and billing invoice access paths.

What is still open:

- The admin audit trail is now one of the clearest remaining hotspots because it still scans a large recent window with weak index support.
- The blood sugar workflow page still quietly pays for a full MAR snapshot.
- Member Command Center still does whole-table roster reads for locker and transportation option lookups.
- MHP detail is slimmer than yesterday, but it still reloads full provider and hospital directories on every member page load.

Net result: compared with March 23, the query-risk profile improved in the health dashboard and member detail paths. The remaining work is now more focused: audit trail pagination, blood sugar over-fetching, Member Command Center census reads, and MHP directory loads.
