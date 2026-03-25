# Supabase Query Performance Audit

Date: 2026-03-25

## 1. Executive Summary

This run is better than the 2026-03-24 run, but the main performance risk has shifted rather than disappeared.

- Confirmed improvement: the blood sugar workflow no longer pulls the full MAR workflow snapshot. It now uses a narrow read against `v_blood_sugar_logs_detailed`, which removes one of yesterday's most expensive read patterns.
- Confirmed improvement: the admin audit trail now has real page-based loading instead of the older oversized fetch pattern, and the new `0125_query_performance_followup_indexes.sql` migration adds the missing `audit_logs (action, created_at desc)` index that was still open yesterday.
- Confirmed improvement: transportation add-rider member search in Member Command Center is now search-limited and batched instead of preloading the full roster.
- Main remaining risk: the codebase still has several whole-table or whole-domain reads in founder-facing and staff-facing reports, dashboards, and roster helpers. These will get slower and more expensive as the member census, sales pipeline, audit history, documentation events, and time punches grow.
- Highest-priority current fixes: convert shared member lookup reads to search/paged reads, move the sales summary report off full-table app-memory aggregation, slim MHP detail reads, and remove the second `member_files` read.

## 2. Missing Indexes

No new confirmed missing-index gap was found in the highest-risk paths this run. The two confirmed gaps from the last run were addressed in `0125_query_performance_followup_indexes.sql`.

- Confirmed fixed: `audit_logs (action, created_at desc)` now exists in [`supabase/migrations/0125_query_performance_followup_indexes.sql`](../../supabase/migrations/0125_query_performance_followup_indexes.sql).
- Confirmed fixed: `blood_sugar_logs (checked_at desc)` now exists in [`supabase/migrations/0125_query_performance_followup_indexes.sql`](../../supabase/migrations/0125_query_performance_followup_indexes.sql).
- Likely remaining index addition: locker availability still scans all active members with a locker assignment in [`lib/services/member-command-center-runtime.ts:269`](../../lib/services/member-command-center-runtime.ts). A partial btree index on active locker rows would make that cheaper if the current query shape stays in place.
- Needs verification: the sales summary report still reads discharged converted members by `source_lead_id` plus `discharge_date` in [`lib/services/sales-summary-report.ts:267`](../../lib/services/sales-summary-report.ts). If this report stays as an app-side scan instead of moving to an RPC/read model, a partial index on discharged converted members would help.

## 3. Potential Table Scans

- High, confirmed: `/members` still loads the full matching member list with no pagination. [`app/(portal)/members/page.tsx:20`](../../app/(portal)/members/page.tsx) calls [`lib/services/member-command-center-runtime.ts:72`](../../lib/services/member-command-center-runtime.ts), which orders and returns every matching member row. This is fine for a small census but will become slow and expensive once the roster grows.
- High, confirmed: the dashboard admin snapshot still pulls a full member-name lookup plus all current holds and all ancillary charge rows for the month. See [`app/(portal)/dashboard/page.tsx:100`](../../app/(portal)/dashboard/page.tsx). This dashboard is high-frequency, so broad reads here matter more than on occasional admin pages.
- High, confirmed: the sales summary report still loads the full `leads` table, all discharged converted members, and then all matching MCC locations before calculating totals in app memory. See [`lib/services/sales-summary-report.ts:259`](../../lib/services/sales-summary-report.ts). This will degrade as lead history grows.
- High, confirmed: the reports home snapshot still loads all `documentation_events` and all `time_punches` before aggregating in memory. See [`lib/services/reports-ops.ts:4`](../../lib/services/reports-ops.ts). That is a classic "works now, hurts later" reporting pattern.
- Medium, confirmed: the MHP detail page still reads the full provider directory and full hospital preference directory when those tabs are opened. See [`lib/services/member-health-profiles-supabase.ts:664`](../../lib/services/member-health-profiles-supabase.ts) and [`lib/services/member-health-profiles-supabase.ts:668`](../../lib/services/member-health-profiles-supabase.ts). This is better than loading them on every tab, but it is still a full-directory read.

## 4. N+1 Query Patterns

No confirmed N+1 query pattern was found in the main priority paths this run.

- Most of the current debt is batched but overly broad, not one-query-per-row.
- Residual caution: several reports still do large batch loads and then perform app-memory joins. That is not N+1, but it produces many of the same scaling symptoms once tables get large.

## 5. Inefficient Data Fetching

- High, confirmed: MHP detail still eagerly loads many full member-specific collections in one request: diagnoses, medications, allergies, providers, equipment, notes, and assessments. See [`lib/services/member-health-profiles-supabase.ts:658`](../../lib/services/member-health-profiles-supabase.ts) through [`lib/services/member-health-profiles-supabase.ts:680`](../../lib/services/member-health-profiles-supabase.ts). This is a lot of data for one page load, especially for long-tenured members.
- Medium, confirmed: `listMemberFilesSupabase()` still performs a second `member_files` query whenever any file row is missing `storage_object_path`, just to detect legacy inline content. See [`lib/services/member-command-center-runtime.ts:216`](../../lib/services/member-command-center-runtime.ts) through [`lib/services/member-command-center-runtime.ts:241`](../../lib/services/member-command-center-runtime.ts).
- Medium, confirmed: shared member lookup helpers still default to returning the full member roster without a hard cap or search threshold. See [`lib/services/member-command-center-runtime.ts:92`](../../lib/services/member-command-center-runtime.ts) and [`lib/services/shared-lookups-supabase.ts:43`](../../lib/services/shared-lookups-supabase.ts). This means many forms and dashboards still pay for a whole-roster read.
- Medium, confirmed: the blood sugar page itself is improved, but it still loads the full active member lookup for the member picker through `getMembers()`. See [`app/(portal)/documentation/blood-sugar/page.tsx:16`](../../app/(portal)/documentation/blood-sugar/page.tsx) and [`lib/services/documentation.ts:108`](../../lib/services/documentation.ts). This is acceptable today, but it should eventually move to search-as-you-type rather than full active-roster preload.
- Medium, confirmed: the MHP directory upsert helpers search with `ilike(...)` plus `order(updated_at)` and `limit(1)` for every provider or hospital save. See [`lib/services/member-health-profiles-write-supabase.ts:374`](../../lib/services/member-health-profiles-write-supabase.ts) and [`lib/services/member-health-profiles-write-supabase.ts:423`](../../lib/services/member-health-profiles-write-supabase.ts). The schema already has normalized uniqueness indexes, so the better fix is query shape, not another broad scan.

## 6. Duplicate Query Logic

- Medium, confirmed: the sales dashboard summary RPC wrapper is duplicated in two places. [`lib/services/sales-workflows.ts:141`](../../lib/services/sales-workflows.ts) and [`lib/services/sales-crm-read-model.ts:244`](../../lib/services/sales-crm-read-model.ts) both wrap `rpc_get_sales_dashboard_summary`. This is a drift risk and makes future performance changes easier to miss.
- Medium, likely: full-roster lookup behavior is effectively duplicated through shared helpers and reused across multiple pages. The root problem is not just one page; it is the shared default that a lookup returns "all members" unless a caller manually narrows it.

## 7. Recommended Index Additions

These are the only index additions I would consider right now. Most remaining issues need query-shape changes more than new indexes.

```sql
create index if not exists idx_members_active_locker_number
  on public.members (locker_number)
  where status = 'active' and locker_number is not null;
```

Why: supports the locker-availability read in [`lib/services/member-command-center-runtime.ts:279`](../../lib/services/member-command-center-runtime.ts), which currently scans all active members with assigned lockers.

```sql
create index if not exists idx_members_source_lead_discharge_date
  on public.members (source_lead_id, discharge_date desc)
  where source_lead_id is not null and discharge_date is not null;
```

Why: only useful if the current sales summary report query remains in place. If you move that report to an RPC/read model, this index becomes less important than the report rewrite itself.

## 8. Performance Hardening Plan

1. Replace shared full-roster lookup helpers with two explicit paths: `searchMemberLookup(q, limit)` for forms and `listMembersPage(...)` for tables. Do not let dropdown helpers default to "all members".
2. Rewrite the sales summary report into one Supabase RPC or read model that accepts date range and optional location, then returns already-aggregated totals. Do not load the full lead history into app memory.
3. Rewrite `getOperationsReports()` so it reads pre-aggregated counts or date-bounded summaries instead of pulling all `documentation_events` and `time_punches`.
4. Slim the MHP detail load by tab. Keep overview light, move heavy collections behind per-tab loaders, and convert provider/hospital directory inputs to search-based lookups instead of full-directory loads.
5. Remove the second `member_files` read by exposing a legacy-inline boolean in the first query, a view, or a small RPC.
6. Standardize one shared sales summary RPC wrapper and one shared member lookup path so query behavior stays consistent and future index work only needs to happen once.

## 9. Suggested Codex Prompts

Prompt 1:

```text
Audit and fix the shared member lookup pattern in Memory Lane.

Current problem:
- Shared helpers like listMemberNameLookupSupabase and listActiveMemberLookupSupabase still return the full roster by default.
- This causes whole-roster reads in /members, dashboard admin snapshot, and form dropdowns like blood sugar and other workflow member pickers.

What to do:
1. Keep Supabase as source of truth.
2. Introduce one canonical search-based member lookup helper with q + limit + status and a sensible minimum search threshold for large dropdowns.
3. Keep one canonical paginated member-list helper for table pages.
4. Update current callers so dashboard cards and workflow forms stop preloading the full roster unless the screen truly needs it.
5. Preserve existing role boundaries and UI behavior where possible.
6. Run typecheck and summarize downstream impacts.
```

Prompt 2:

```text
Replace the current sales summary report full-table read with a Supabase RPC/read model.

Current problem:
- lib/services/sales-summary-report.ts loads the full leads table, all discharged converted members, and MCC locations into app memory before aggregating.
- This will get slower and more expensive as lead history grows.

What to do:
1. Design one canonical Supabase-backed read path that accepts startDate, endDate, and optional location.
2. Return the same report shape the page/export currently needs.
3. Keep canonical lead/member identity handling correct.
4. Do not add mock fallbacks.
5. Add any small supporting indexes only if the final query plan truly needs them.
6. Update the report service to use the new RPC and run typecheck.
```

Prompt 3:

```text
Slim the Member Health Profile detail read path for performance.

Current problem:
- getMemberHealthProfileDetailSupabase still loads many full member-specific collections in one request.
- Provider and hospital directories are still full-table reads when those tabs open.

What to do:
1. Keep Supabase canonical.
2. Split the MHP detail read into lighter tab-aware reads so overview does not pay for every collection.
3. Convert provider and hospital directory inputs to search-based lookups instead of loading the full directory.
4. Reuse shared helpers where possible and avoid duplicating resolver logic.
5. Keep the UI behavior practical and simple.
6. Run typecheck and report any schema/index needs explicitly.
```

Prompt 4:

```text
Remove the extra member_files query in listMemberFilesSupabase without changing behavior.

Current problem:
- The service reads member_files once for the list and then a second time when any row is missing storage_object_path, only to detect legacy inline file_data_url rows.

What to do:
1. Keep Supabase as source of truth.
2. Return the same final shape to callers.
3. Eliminate the second read if possible by extending the first select, using a small view, or using a narrow RPC.
4. Do not break legacy inline file handling.
5. Run typecheck and summarize any downstream behavior changes.
```

Prompt 5:

```text
Refactor reports-ops to stop loading entire documentation_events and time_punches tables for the reports home screen.

Current problem:
- getOperationsReports aggregates staff productivity and time summaries in app memory after broad full-table reads.

What to do:
1. Replace the current read path with bounded or aggregated Supabase queries.
2. Keep the same report output shape if possible.
3. Prefer one canonical shared service/RPC over repeated ad hoc queries.
4. Do not add mock fallbacks.
5. Add supporting indexes only where the final query pattern proves they are needed.
6. Run typecheck and describe risk reduction.
```

## 10. Founder Summary: What Changed Since the Last Run

- Improved: the blood sugar workflow is no longer paying for the full MAR snapshot. That was one of yesterday's clearest waste patterns, and it is now narrowed to a small blood-sugar-specific read.
- Improved: the admin audit trail now behaves like a real paged report instead of a giant fetch, and the missing action/date index was added in migration `0125_query_performance_followup_indexes.sql`.
- Improved: the transportation add-rider lookup is no longer a whole-roster preload. It now requires a search term and limits results.
- Still open: shared member lookups still default to "load everyone", so the members page, dashboard admin snapshot, and several form pickers still do more work than they should.
- Still open: the biggest expensive report is now the sales summary report, because it still loads the full lead history and aggregates in memory.
- Still open: reports home and MHP detail still read more rows than they need.
- Risk shift from yesterday: the most obvious MAR/blood-sugar over-fetch is down, so the next performance bottlenecks are now roster helpers, reporting queries, and MHP detail loads.
