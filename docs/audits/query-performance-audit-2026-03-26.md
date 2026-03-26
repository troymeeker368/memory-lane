# Supabase Query Performance Audit

Date: 2026-03-26

## 1. Executive Summary

This run is materially better than the 2026-03-25 run.

- Confirmed improvement: the members list is no longer an unbounded roster read. [`app/(portal)/members/page.tsx:42`](../../app/(portal)/members/page.tsx) now uses [`lib/services/member-command-center-runtime.ts:156`](../../lib/services/member-command-center-runtime.ts) for page-based loading.
- Confirmed improvement: the sales summary report is no longer doing app-memory aggregation over the full `leads` table. [`lib/services/sales-summary-report.ts:220`](../../lib/services/sales-summary-report.ts) now calls the RPC added in [`supabase/migrations/0144_sales_summary_report_rpc.sql:1`](../../supabase/migrations/0144_sales_summary_report_rpc.sql).
- Confirmed improvement: reports home no longer pulls raw `documentation_events` and `time_punches` into app memory. [`lib/services/reports-ops.ts:52`](../../lib/services/reports-ops.ts) now uses [`supabase/migrations/0145_reports_and_member_files_read_rpcs.sql:1`](../../supabase/migrations/0145_reports_and_member_files_read_rpcs.sql).
- Confirmed improvement: member files no longer do the extra follow-up read for legacy inline content. [`lib/services/member-command-center-runtime.ts:292`](../../lib/services/member-command-center-runtime.ts) now uses [`supabase/migrations/0145_reports_and_member_files_read_rpcs.sql:96`](../../supabase/migrations/0145_reports_and_member_files_read_rpcs.sql).
- Main remaining risk: the codebase still repeatedly preloads active member lookups for many forms and filters, and Member Health Profile detail still loads a lot of related data in one request.
- New highest-priority open fix: the physician orders index still fetches the full result set and only applies search text in app memory, which will get slower as physician order history grows.

## 2. Missing Indexes

No new critical missing-index gap was confirmed in the highest-risk paths this run.

- Confirmed fixed: member lookup search now has a trigram index in [`supabase/migrations/0143_member_lookup_search_indexes.sql:1`](../../supabase/migrations/0143_member_lookup_search_indexes.sql).
- Confirmed fixed: the discharged converted-member helper path now has `members (source_lead_id, discharge_date)` support in [`supabase/migrations/0143_member_lookup_search_indexes.sql:7`](../../supabase/migrations/0143_member_lookup_search_indexes.sql).
- Likely remaining: if the physician orders index keeps ordering the full table by `updated_at` with no pagination, add a supporting index on `physician_orders (updated_at desc)` or `physician_orders (status, updated_at desc)`. Current indexes are member-focused in [`supabase/migrations/0006_intake_pof_mhp_supabase.sql:127`](../../supabase/migrations/0006_intake_pof_mhp_supabase.sql), which does not fully cover the current list-page shape.
- Needs verification: no new directory-search index is recommended yet for provider or hospital directories because the bigger problem is query shape. The current write helpers are not using the normalized unique indexes efficiently.

## 3. Potential Table Scans

- High, confirmed: the physician orders index still reads all matching `physician_orders` rows, then filters `q` in app memory. [`lib/services/physician-orders-read.ts:87`](../../lib/services/physician-orders-read.ts) loads the ordered result set first, and [`lib/services/physician-orders-read.ts:148`](../../lib/services/physician-orders-read.ts) applies the text filter after the fetch. [`app/(portal)/health/physician-orders/page.tsx:38`](../../app/(portal)/health/physician-orders/page.tsx) uses that path directly. This is the clearest current "works now, hurts later" list-page pattern.
- Medium, confirmed: active-member roster preloads still happen across many pages through [`lib/services/documentation.ts:108`](../../lib/services/documentation.ts), which returns [`lib/services/shared-lookups-supabase.ts:142`](../../lib/services/shared-lookups-supabase.ts). Examples include blood sugar [`app/(portal)/documentation/blood-sugar/page.tsx:16`](../../app/(portal)/documentation/blood-sugar/page.tsx), care plan list [`app/(portal)/health/care-plans/list/page.tsx:43`](../../app/(portal)/health/care-plans/list/page.tsx), care plan due report [`app/(portal)/health/care-plans/due-report/page.tsx:29`](../../app/(portal)/health/care-plans/due-report/page.tsx), physician orders [`app/(portal)/health/physician-orders/page.tsx:38`](../../app/(portal)/health/physician-orders/page.tsx), and member summary [`app/(portal)/reports/member-summary/page.tsx:95`](../../app/(portal)/reports/member-summary/page.tsx). The new default cap helps, but the pattern is still repeated and still eager.
- High, confirmed: Member Health Profile detail still assembles a large multi-query snapshot on every detail load. [`lib/services/member-health-profiles-supabase.ts:651`](../../lib/services/member-health-profiles-supabase.ts) loads profile, diagnoses, medications, allergies, providers, optional directories, equipment, notes, assessments, and MCC in one batch. Then [`app/(portal)/health/member-health-profiles/[memberId]/page.tsx:243`](../../app/(portal)/health/member-health-profiles/[memberId]/page.tsx) adds care plans, billing payor, physician orders, and progress note summary on top. This is the heaviest current member-detail read path I found.

## 4. N+1 Query Patterns

No confirmed N+1 query pattern was found in the main priority paths this run.

- Most remaining debt is now broad batched fetching, not one-query-per-row loops.
- Residual caution: the MHP detail page and physician orders list are still heavy, but their problem is payload width and lack of SQL-side filtering, not classic N+1 fan-out.

## 5. Inefficient Data Fetching

- High, confirmed: `getPhysicianOrders()` still applies text search after the full fetch instead of pushing that work into SQL. [`lib/services/physician-orders-read.ts:101`](../../lib/services/physician-orders-read.ts) fetches the dataset, and [`lib/services/physician-orders-read.ts:148`](../../lib/services/physician-orders-read.ts) filters it in memory. That means search gets more expensive every time history grows.
- High, confirmed: Member Health Profile detail still loads many member collections even when the user only needs one tab. The provider and hospital directories are now tab-limited, which is an improvement, but diagnoses, medications, allergies, providers, equipment, notes, and assessments still load together in [`lib/services/member-health-profiles-supabase.ts:651`](../../lib/services/member-health-profiles-supabase.ts).
- Medium, confirmed: provider and hospital directory upserts still use `ilike(...) + order(updated_at desc) + limit(1)` in [`lib/services/member-health-profiles-write-supabase.ts:374`](../../lib/services/member-health-profiles-write-supabase.ts) and [`lib/services/member-health-profiles-write-supabase.ts:423`](../../lib/services/member-health-profiles-write-supabase.ts). The schema already has normalized uniqueness indexes in [`supabase/migrations/0012_legacy_operational_health_alignment.sql:132`](../../supabase/migrations/0012_legacy_operational_health_alignment.sql) and [`supabase/migrations/0012_legacy_operational_health_alignment.sql:144`](../../supabase/migrations/0012_legacy_operational_health_alignment.sql), so this should move to normalized equality or a true upsert path rather than a broad lookup.
- Medium, confirmed: the shared `getMembers()` pattern still preloads active member options for many pages that really want search-driven lookups or narrower context lists. [`lib/services/documentation.ts:108`](../../lib/services/documentation.ts) is still the common entry point.

## 6. Duplicate Query Logic

- Medium, confirmed: the eager active-member lookup pattern is still reused across documentation forms, care plan pages, physician orders, ancillary, and reports. The helper is shared, but the behavior is duplicated across modules because many screens still assume "load active members now" instead of "search members when needed."
- Medium, likely: there are now two practical member-lookup modes in the repo, but callers are inconsistent about which one they use. [`lib/services/shared-lookups-supabase.ts:67`](../../lib/services/shared-lookups-supabase.ts) already provides a search-first helper, while many pages still depend on the preload path through [`lib/services/shared-lookups-supabase.ts:142`](../../lib/services/shared-lookups-supabase.ts). That drift makes it easier for new screens to reintroduce unnecessary roster reads.

## 7. Recommended Index Additions

Only one new index looks worth considering right now, and even that is secondary to fixing query shape first.

```sql
create index if not exists idx_physician_orders_updated_at_desc
  on public.physician_orders (updated_at desc);
```

Why: supports the current physician orders list in [`lib/services/physician-orders-read.ts:87`](../../lib/services/physician-orders-read.ts), which orders the table by `updated_at` even when no `member_id` filter is present.

If status-filtered list usage remains common after the read-path cleanup, this variant may be better instead:

```sql
create index if not exists idx_physician_orders_status_updated_at_desc
  on public.physician_orders (status, updated_at desc);
```

Why: helps the same list screen when users filter by Draft, Sent, Signed, Expired, or Superseded.

## 8. Performance Hardening Plan

1. Replace the shared `getMembers()` preload pattern with one canonical search-first member lookup for forms and filter dropdowns. Keep preloaded rosters only where the screen truly needs the full option set.
2. Fix the physician orders index so text search runs in SQL, not in memory. Add real pagination at the same time.
3. Split Member Health Profile detail into lighter tab-aware loaders for the heavy collections, not just provider and hospital directories.
4. Change provider and hospital directory write helpers to use normalized equality or database upsert semantics so they align with the existing unique indexes.
5. Keep pushing report-style pages toward RPC/read-model boundaries like the new sales summary, reports home, and member-files reads.
6. After the physician orders and shared member lookup fixes land, re-run this audit because those two changes will remove most of the remaining near-term read pressure.

## 9. Suggested Codex Prompts

Prompt 1:

```text
Fix the physician orders index read path for performance in Memory Lane.

Current problem:
- lib/services/physician-orders-read.ts fetches the physician_orders list ordered by updated_at, then applies the q filter in app memory.
- app/(portal)/health/physician-orders/page.tsx also preloads active member options for the filter dropdown.

What to do:
1. Keep Supabase as source of truth.
2. Push member/provider/status text filtering into SQL instead of filtering after fetch.
3. Add real pagination to the physician orders index page.
4. Keep canonical member identity handling intact.
5. Only add a supporting index if the final query shape truly needs it.
6. Run typecheck and summarize downstream behavior changes.
```

Prompt 2:

```text
Replace repeated active-member roster preloads with a canonical search-first member lookup flow.

Current problem:
- Many pages still call getMembers() or listAllActiveMemberLookupSupabase(), which eagerly loads active member options on page load.
- This pattern is reused across documentation pages, care plan pages, physician orders, ancillary, and reports.

What to do:
1. Keep Supabase as source of truth.
2. Preserve one canonical member lookup service layer.
3. Introduce a search-first lookup pattern for forms and filter dropdowns.
4. Keep paginated/table pages on their own explicit list read model.
5. Update current callers carefully so behavior stays practical and simple.
6. Run typecheck and summarize which screens changed.
```

Prompt 3:

```text
Slim the Member Health Profile detail read path in Memory Lane.

Current problem:
- The MHP detail page still loads many related collections in one request and then adds more cross-domain reads for care plans, payor, physician orders, and progress notes.
- Provider and hospital directories are already tab-limited, but the rest of the detail payload is still heavy.

What to do:
1. Keep Supabase canonical.
2. Split heavy MHP detail reads by tab or section where that reduces payload.
3. Preserve shared resolver/service boundaries.
4. Do not add mock fallbacks.
5. Keep the UI practical and avoid a large refactor.
6. Run typecheck and describe what became lighter.
```

Prompt 4:

```text
Fix provider_directory and hospital_preference_directory upsert query shape in Memory Lane.

Current problem:
- MHP write helpers still use ilike + order(updated_at) + limit(1) to find existing directory rows.
- The schema already has normalized unique indexes, so the read path is broader than it needs to be.

What to do:
1. Keep Supabase as source of truth.
2. Rework the lookup to align with the normalized uniqueness rules already in migrations.
3. Prefer a deterministic equality/upsert path over fuzzy lookup for saves.
4. Do not introduce duplicate directory rows.
5. Run typecheck and call out any schema dependency if a migration is needed.
```

## 10. Founder Summary: What Changed Since the Last Run

- Improved: the members page is now paginated, so one of yesterday's clearest whole-roster reads is no longer the main problem.
- Improved: the sales summary report moved to a Supabase RPC in `0144_sales_summary_report_rpc.sql`, so it no longer loads the full lead history into app memory.
- Improved: reports home moved to `rpc_get_reports_home_staff_aggregates`, and member files moved to `rpc_list_member_files`, both in `0145_reports_and_member_files_read_rpcs.sql`.
- Improved: `0143_member_lookup_search_indexes.sql` added the member-name trigram index and the discharged converted-member index that were still useful gaps before.
- Still open: active member lookups are still eagerly preloaded across several pages, just with a safer cap now. That is better than before, but it is still extra work on page load.
- Still open: Member Health Profile detail is still a heavy cross-domain read and remains one of the biggest per-page payloads.
- New main risk focus: the physician orders index now stands out more clearly because it still fetches first and filters later. As physician order history grows, that page is likely to become the next noticeable slowdown.
