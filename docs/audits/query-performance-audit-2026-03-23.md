# Supabase Query Performance Audit - 2026-03-23

## 1. Executive Summary

This run is materially better than the March 22 baseline.

- The highest-risk MAR read-path issue from the last run is fixed. The MAR page no longer does schedule reconciliation or PRN sync on normal page load. That work now sits behind an explicit refresh action in `app/(portal)/health/mar/page.tsx:55-58`, and `lib/services/mar-workflow-read.ts:187-263` reads data without calling sync helpers first.
- The progress note dashboard is no longer doing app-memory pagination. `lib/services/progress-notes-read-model.ts:226-337` now uses `rpc_get_progress_note_tracker_summary` and `rpc_get_progress_note_tracker_page`, backed by `supabase/migrations/0113_performance_read_models.sql:54-267`.
- Staff and member activity snapshots no longer fire many separate page-level count queries. `lib/services/activity-snapshots.ts:113-224` now uses RPCs added in `supabase/migrations/0114_activity_snapshot_count_rpcs.sql:1-76` and `supabase/migrations/0115_activity_snapshot_timeline_rpcs.sql:1-628`.
- MAR monthly report member options are now centralized behind `lib/services/mar-member-options.ts:40-87` and `supabase/migrations/0119_mar_monthly_report_member_options_read_model.sql:3-98`, which is much safer than reading four medication/admin tables in Node on every load.
- Sales search/index support improved. `supabase/migrations/0117_query_performance_indexes_partials.sql:6-13` adds the previously missing lead inquiry-date and trigram search indexes.

The biggest remaining risks have shifted to:

- the health dashboard still loading far more MAR data than it needs
- sales dashboards and form lookups still relying on repeated exact counts and broad lookup loads
- care-plan and member-detail reads that still duplicate work or pay for many exact counts

This is a repo-based audit, not a live database-plan audit. Anything marked `likely` still needs confirmation with real row counts or `EXPLAIN`.

## 2. Missing Indexes

- Medium, likely: `lib/services/sales-crm-read-model.ts:313-321` orders recent leads by `created_at desc` for form lookups, but the repo does not show a matching standalone `leads(created_at desc)` index. As the lead table grows, this can become a scan-plus-sort just to fill a dropdown.
- Medium, likely: active-member roster reads repeatedly filter by `status` and sort by `display_name` in:
  - `lib/services/health-dashboard.ts:81-85`
  - `lib/services/member-command-center-runtime.ts:127-139`
  - `lib/services/member-command-center-runtime.ts:72-90`
  The repo shows `idx_members_display_name` and trigram search support, but not a composite `members(status, display_name)` index for the active-roster pattern.
- Low, likely: member search also checks `locker_number` with `ilike` in `lib/services/member-command-center-runtime.ts:81-85` and `lib/services/member-command-center-runtime.ts:135-138`, but the repo does not show locker-number search index support. This is lower risk because the member table is smaller than the activity/log tables, but it is still a likely scan path.

## 3. Potential Table Scans

- Medium, confirmed: `getSalesFormLookupsSupabase()` pulls recent leads with `.order("created_at", { ascending: false }).limit(leadLimit)` in `lib/services/sales-crm-read-model.ts:313-321`. Without a matching `created_at` index, this path can degrade into scanning and sorting the lead table just to return the latest 500 lookup rows.
- Medium, likely: active-member roster reads can still scan more of `members` than necessary because they combine `status` filters with `display_name` ordering, but current repo evidence only shows display-name-focused indexes. Affected reads include `lib/services/health-dashboard.ts:81-85` and `lib/services/member-command-center-runtime.ts:127-139`.
- Medium, confirmed: `getTimeReviewDetail()` in `lib/services/staff-detail-read-model.ts:133-141` loads all punches for a staff member and only then filters the current pay period in app memory. The existing `time_punches` index helps the lookup by staff, but this is still an unbounded historical read for long-tenured staff.

## 4. N+1 Query Patterns

No confirmed hot-path N+1 query patterns were found in the prioritized domains this run.

Residual note:

- There are still loop-based maintenance paths such as `backfillLegacyMemberFileStorageBatch()` in `lib/services/member-files.ts:258-303`, but those are repair workflows rather than normal dashboard/list reads.

## 5. Inefficient Data Fetching

- High, confirmed: the health dashboard still calls `getMarWorkflowSnapshot({ historyLimit: 150, prnLimit: 150, serviceRole: true })` in `lib/services/health-dashboard.ts:74-75`, but the dashboard only uses a small subset of that result in `lib/services/health-dashboard.ts:100-143`. The snapshot loader still reads:
  - four MAR views in `lib/services/mar-workflow-read.ts:199-209`
  - PRN history and PRN medication options in `lib/services/mar-workflow-read.ts:228-233`
  - member photos in `lib/services/mar-workflow-read.ts:235-250`
  - MAR member options in `lib/services/mar-workflow-read.ts:262`
  This means `/health` is paying for most of the MAR board even when it only needs due meds and recent health activity.

- Medium, confirmed: the health dashboard also loads the full active member directory on every request in `lib/services/health-dashboard.ts:81-85` and returns it in `lib/services/health-dashboard.ts:152-163`. That is much better than the old MCC/MHP fan-out, but it still scales with the entire active census.

- Medium, confirmed: `getCarePlanParticipationSummary()` in `lib/services/care-plans-read-model.ts:34-66` loads raw attendance rows and raw daily activity rows for a 180-day window just to calculate two counts. This should move closer to SQL aggregation or one small RPC.

- Medium, confirmed: `getMemberDetail()` still fires eight preview queries with `count: "exact"` in `lib/services/member-detail-read-model.ts:136-204`. The 50-row preview cap is a real improvement, but exact counts still force each table to count the full match set on every detail load.

- Medium, confirmed: `getSalesFormLookupsSupabase()` still loads up to 500 leads, 500 partners, and 500 referral sources up front in `lib/services/sales-crm-read-model.ts:305-365`. That is capped, which helps, but it is still broad, gets slower as those tables grow, and eventually becomes incomplete once real directories exceed the cap.

- Medium, confirmed: sales snapshots still rely on repeated exact-count reads:
  - `lib/services/sales-crm-read-model.ts:368-389`
  - `lib/services/sales-crm-read-model.ts:392-419`
  The sales pipeline summary RPC removed one older source of duplication, but exact counts on growing CRM tables still add steady dashboard cost.

- Low, confirmed: `listMemberFilesSupabase()` in `lib/services/member-command-center-runtime.ts:216-247` can read `member_files` twice when legacy inline files exist. That is not the biggest risk in the repo, but it is avoidable repeated work on a member detail page.

## 6. Duplicate Query Logic

- Medium, confirmed: Member Command Center detail currently asks for both `getMemberCarePlanSummary()` and `getCarePlansForMember()` in the same request in `lib/services/member-command-center-runtime.ts:404-405`. But `getMemberCarePlanSummary()` calls `getLatestCarePlanForMember()`, which itself loads `listCarePlanRows()`, and `getCarePlansForMember()` loads `listCarePlanRows()` again in:
  - `lib/services/care-plans-read-model.ts:369-393`
  This means the same member care-plan set is queried twice on one page load.

- Medium, confirmed: member-name lookup logic is still spread across multiple services instead of one shared read model:
  - `lib/services/member-command-center-runtime.ts:92-111`
  - `lib/services/progress-notes-read-model.ts:112-133`
  - `lib/services/mar-prn-workflow.ts:164-170`
  None of these is individually dangerous, but they keep repeating the same roster-style query pattern with slightly different rules and limits.

- Low, confirmed: sales summary/home snapshots still compute overlapping lead counts in separate services:
  - `lib/services/sales-crm-read-model.ts:368-389`
  - `lib/services/sales-crm-read-model.ts:392-419`
  That is cleaner than before because pipeline-stage counts moved to RPC, but there is still duplicate dashboard-count logic around the sales landing experience.

## 7. Recommended Index Additions

These are the smallest safe index additions still justified by the current code:

```sql
create index if not exists idx_leads_created_at_desc
  on public.leads (created_at desc);

create index if not exists idx_members_status_display_name
  on public.members (status, display_name);

create extension if not exists pg_trgm;

create index if not exists idx_members_locker_number_trgm
  on public.members using gin (locker_number gin_trgm_ops);
```

Notes:

- I am not recommending new MAR, progress-note, or activity-snapshot indexes first. The repo already added the major missing indexes for those paths in `0113`, `0115`, `0117`, and `0119`.
- For care-plan participation, a query rewrite is likely worth more than another index because the current issue is raw-row loading, not missing predicates.

## 8. Performance Hardening Plan

1. Split a lightweight health-dashboard MAR read model away from `getMarWorkflowSnapshot()`.
   The dashboard should ask only for due meds, recent administrations, and maybe a very small PRN summary. It should not pay for full history, PRN option lists, or MAR member options.

2. Replace broad sales form lookups with search-first or recent-items read models.
   For example: recent 25 leads, partner search-as-you-type, referral-source search-as-you-type. That keeps the forms fast and avoids the long-term 500-row cap problem.

3. Consolidate care-plan summary and list reads for member pages.
   Member Command Center and MHP member detail should not load the same care-plan set twice just to compute “latest” and “all plans.”

4. Move care-plan participation counting into SQL.
   A single aggregate query or RPC can return attendance-day count and participation-day count without shipping 180 days of raw rows back to Node.

5. Revisit member-detail exact counts.
   If those totals are needed, compute them in a lighter summary query. If they are not needed immediately, lazy-load them per tab instead of paying for all of them on the first page render.

6. Filter time-review punches in SQL.
   `getTimeReviewDetail()` should query only the current pay period instead of loading all punches and filtering afterward.

7. After the above changes, capture live `EXPLAIN` plans for:
   - `/health`
   - sales landing and lead form lookups
   - Member Command Center detail
   - member detail timeline views

## 9. Suggested Codex Prompts

- "Refactor Memory Lane health dashboard reads so `/health` no longer calls the full `getMarWorkflowSnapshot()` for summary cards. Keep Supabase as source of truth, preserve current MAR board behavior, and add a lightweight dashboard-safe read model or RPC."

- "Harden Memory Lane sales lookup performance by replacing broad 500-row lead/partner/referral form lookups with search-first or recent-item read models. Keep canonical service boundaries and avoid UI direct Supabase logic."

- "Consolidate care-plan member reads so Member Command Center and member health profile pages do not query the same member care-plan set twice for summary + list data. Preserve existing behavior and routes."

- "Move care-plan participation summary counts into SQL or RPC so the app stops loading 180 days of raw attendance and activity rows just to compute two numbers."

- "Review Memory Lane member detail reads and replace hot `count: exact` fan-out queries with lighter summary reads or deferred tab loading where operationally safe."

- "Add the remaining low-risk performance indexes from the March 23 query audit: `leads(created_at desc)`, `members(status, display_name)`, and optional locker-number trigram support if member search still needs locker lookup."

## 10. Founder Summary: What changed since the last run

The good news is that the repo fixed most of yesterday’s biggest query risks.

- MAR is safer now. The March 22 report called out read-time schedule reconciliation and PRN sync as a core risk. Today, the MAR page exposes that work behind an explicit refresh button in `app/(portal)/health/mar/page.tsx:55-58`, and `lib/services/mar-workflow-read.ts:187-263` no longer syncs on every normal read.

- MAR monthly report member options are much better. Instead of building dropdowns by reading four medication/admin tables in Node, the repo now uses `lib/services/mar-member-options.ts:40-87` with `rpc_list_mar_monthly_report_member_options()` and supporting indexes in `supabase/migrations/0119_mar_monthly_report_member_options_read_model.sql:3-79`.

- Progress note dashboard performance is much better. The old in-memory paging issue is gone. `lib/services/progress-notes-read-model.ts:226-337` now pushes summary and paging into SQL RPCs from `supabase/migrations/0113_performance_read_models.sql:54-267`.

- Activity snapshots are much better. The old page-level fan-out into many exact-count queries has been replaced by RPC-backed count and timeline reads in `lib/services/activity-snapshots.ts:113-224`, supported by `supabase/migrations/0114_activity_snapshot_count_rpcs.sql:1-76` and `supabase/migrations/0115_activity_snapshot_timeline_rpcs.sql:1-628`.

- Sales search/index support is better. `supabase/migrations/0117_query_performance_indexes_partials.sql:6-13` adds the previously missing inquiry-date and lead-name trigram indexes, which lowers the risk around lead search and inquiry sorting.

What still needs attention:

- The health dashboard is now the clearest remaining hot read path because it still pays for almost the full MAR workflow snapshot when it only needs a summary view.
- Sales dashboards and sales form lookups still do more counting and broad preloading than they should.
- Care-plan/member detail pages still duplicate some work and still pay for some expensive exact counts.

Net result: compared with March 22, this repo is in a meaningfully better performance position. The major risk has shifted away from MAR sync-on-read and progress-note paging, and toward dashboard over-fetching and a smaller set of remaining broad lookup/count patterns.
