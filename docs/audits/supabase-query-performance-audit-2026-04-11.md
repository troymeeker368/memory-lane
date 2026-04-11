# Supabase Query Performance Audit

Date: 2026-04-11
Automation: Supabase Query Performance Audit

## 1. Executive Summary

This run is materially better than the 2026-04-10 audit, but not finished.

Three areas improved in the current codebase:

- `confirmed` The main MAR workflow first load is now contained by default. The page only loads the first 150 `today` rows and first 150 `overdue` rows unless staff explicitly switch to full-queue mode. Evidence: `app/(portal)/health/mar/page.tsx:15-19`, `app/(portal)/health/mar/page.tsx:33-41`, `lib/services/mar-workflow-read.ts:157-179`
- `confirmed` The main billing invoice list readers are now paged through one shared helper instead of reading whole invoice lists. Evidence: `lib/services/billing-read-supabase.ts:165-223`, `lib/services/billing-read-supabase.ts:291-319`
- `likely` The repo now includes a new reports-home RPC windowing migration that limits staff aggregate scans to the last 180 days. That closes the old full-history reports-home problem if `0208_reports_home_recent_window.sql` is applied in Supabase. Evidence: `lib/services/reports-ops.ts:24-27`, `lib/services/reports-ops.ts:54-72`, `supabase/migrations/0208_reports_home_recent_window.sql:10-35`

The biggest remaining risks are now:

1. `confirmed` High: the sales dashboard summary RPC still canonicalizes the full `leads` table and layers whole-table counts on top of that work. Evidence: `supabase/migrations/0200_sales_dashboard_follow_up_summary_rpc.sql:44-141`, `supabase/migrations/0200_sales_dashboard_follow_up_summary_rpc.sql:252-279`
2. `confirmed` High: the health dashboard still loads the full `v_mar_today` dataset and trims it in application code, so the page remains heavier than it needs to be. Evidence: `lib/services/mar-dashboard-read-model.ts:20-31`, `lib/services/health-dashboard.ts:137-168`
3. `confirmed` Medium: the global recent lead-activity feed still orders `lead_activities` by `activity_at desc` without a matching global sort index. Evidence: `lib/services/sales-crm-read-model.ts:787-805`
4. `confirmed` Medium: generated member-file duplicate-name checks still query `member_files` by `member_id + file_name` without a matching composite index. Evidence: `lib/services/member-files.ts:821-832`
5. `confirmed` Medium: billing batch/export helpers still do unpaged, broad reads, so billing list hardening is only partial. Evidence: `lib/services/billing-read-supabase.ts:265-289`, `lib/services/billing-read-supabase.ts:573-591`, `lib/services/billing-read-supabase.ts:322-341`

## 2. Missing Indexes

1. `confirmed` `lead_activities(activity_at desc)` for the global recent-activity feed
Why it matters:
- The sales recent-activity snapshot pulls the latest 100 `lead_activities` rows ordered by `activity_at desc`.
- The repo has lead-specific, referral-source, and completed-by variants, but not one plain global time-sort index for the unfiltered feed.
Evidence:
- Query path: `lib/services/sales-crm-read-model.ts:787-805`
- Existing indexes: `supabase/migrations/0048_query_performance_support_indexes.sql:38-39`, `supabase/migrations/0124_data_access_optimization_indexes.sql:26-27`, `supabase/migrations/0113_performance_read_models.sql:435-436`

2. `confirmed` `member_files(member_id, file_name)` for generated-file duplicate checks
Why it matters:
- Generated member-file persistence checks whether a file name already exists for the member before deciding whether to append a duplicate-safe suffix.
- No migration in the repo adds a composite index for that lookup shape.
Evidence:
- Query path: `lib/services/member-files.ts:821-832`
- Migration search found no matching composite index in `supabase/migrations`

3. `confirmed` `billing_invoices(invoice_status, invoice_month desc, created_at desc)` for draft/finalized invoice list reads
Why it matters:
- The shared invoice list helper filters by `invoice_status`, sorts by `invoice_month desc, created_at desc`, paginates, and is also reused by the draft and finalized invoice pages.
- That list is safer now because it is paged, but it still lacks a matching composite index.
Evidence:
- Query path: `lib/services/billing-read-supabase.ts:179-223`
- Supporting draft-id query: `lib/services/billing-read-supabase.ts:322-341`

4. `confirmed` `billing_invoices(invoice_source, invoice_status, invoice_month desc, created_at desc)` for custom invoice lists
Why it matters:
- The custom invoice reader filters by `invoice_source = 'Custom'`, sometimes filters by status, and uses the same descending month + created sort.
- Existing invoice-source indexes do not fully match the current filter plus sort shape.
Evidence:
- Query path: `lib/services/billing-read-supabase.ts:179-223`, `lib/services/billing-read-supabase.ts:307-319`

## 3. Potential Table Scans

1. `confirmed` High: the sales dashboard summary RPC still does dashboard-time whole-table work
Why it could become slow:
- The RPC first materializes a `canonical_leads` CTE from all rows in `public.leads`.
- It then performs additional whole-table counts against `leads`, `lead_activities`, `community_partner_organizations`, `referral_sources`, and `partner_activities`.
Evidence:
- Runtime caller: `lib/services/sales-workflows.ts:155-181`
- RPC definition: `supabase/migrations/0200_sales_dashboard_follow_up_summary_rpc.sql:44-141`, `supabase/migrations/0200_sales_dashboard_follow_up_summary_rpc.sql:252-279`
Estimated scaling risk:
- Near-term

2. `confirmed` Medium: the global lead recent-activity feed can degrade into a broader sort/scan
Why it could become slow:
- The query orders `lead_activities` by `activity_at desc` and takes the newest 100 rows.
- Without a matching global sort index, Postgres may need to inspect and sort more history than necessary.
Evidence:
- `lib/services/sales-crm-read-model.ts:787-805`
Estimated scaling risk:
- Near-term

3. `likely` Medium: billing batches and export jobs still read their full tables on every billing exports visit
Why it could become slow:
- `getBillingBatches()` and `getBillingExports()` order the full tables and return all rows with no range limit.
- The exports page loads both together every time it renders.
Evidence:
- `lib/services/billing-read-supabase.ts:265-289`
- `lib/services/billing-read-supabase.ts:573-591`
- `app/(portal)/operations/payor/exports/page.tsx:13-18`
Estimated scaling risk:
- Near-term

## 4. N+1 Query Patterns

No confirmed hot-path N+1 read pattern was found in the audited priority workflows during this run.

What improved here:

- The MAR workflow is still one snapshot load plus one batched member-photo query, not one query per row. Evidence: `lib/services/mar-workflow-read.ts:169-190`, `lib/services/mar-workflow-read.ts:243-257`
- MHP and shared member index reads remain batched around one shared member-page loader plus two `IN (...)` follow-up queries, not row-by-row fetches. Evidence: `lib/services/member-health-profiles-supabase.ts:393-449`

Residual validation gap:

- This was a code-and-migrations audit only. I did not inspect live query plans or production traces.

## 5. Inefficient Data Fetching

1. `confirmed` High: the health dashboard still loads the entire `v_mar_today` read model
Why it could become slow:
- The dashboard loader fetches all rows from `v_mar_today` ordered by time, then the page filters down to action rows within 12 hours and only shows eight recent administered rows.
- This is better than the older double-read pattern, but it is still an unbounded daily MAR payload on a homepage-style dashboard.
Evidence:
- `lib/services/mar-dashboard-read-model.ts:20-31`
- `lib/services/health-dashboard.ts:137-168`
Estimated scaling risk:
- Near-term

2. `confirmed` Medium: the MAR workflow still performs exact counts over the full `today` and `overdue` views on every load
Why it could become slow:
- The row payload is now contained, which is a real improvement.
- But the page still asks Supabase for exact counts of full `v_mar_today` and `v_mar_overdue_today` before rendering the contained slices.
Evidence:
- `lib/services/mar-workflow-read.ts:165-168`
- `lib/services/mar-workflow-read.ts:169-179`
Estimated scaling risk:
- Near-term

3. `confirmed` Medium: member, MHP, and sales directory pages still ask for exact counts on each request
Why it could become slow:
- Shared member paging uses `count: "exact"` on every request, and MHP rides that same shared boundary.
- Sales lead, partner, and referral-source directory pages do the same.
- Exact totals are convenient, but they are one of the first things to get expensive as tables grow.
Evidence:
- Shared member/MHP paging: `lib/services/member-list-read.ts:61-88`, `lib/services/member-health-profiles-supabase.ts:393-399`
- Sales lead paging: `lib/services/sales-crm-read-model.ts:708-748`
- Sales partner/referral paging: `lib/services/sales-crm-read-model.ts:823-864`
Estimated scaling risk:
- Near-term

4. `confirmed` Medium: billing export and draft-finalization helpers still over-read relative to what the page needs
Why it could become slow:
- The exports page loads all billing batches and all export jobs.
- The draft invoice page also loads every draft invoice id so it can render hidden inputs for “Finalize All,” even though the visible table itself is paged.
Evidence:
- `lib/services/billing-read-supabase.ts:265-289`
- `lib/services/billing-read-supabase.ts:322-341`
- `lib/services/billing-read-supabase.ts:573-591`
- `app/(portal)/operations/payor/invoices/draft/page.tsx:20-24`, `app/(portal)/operations/payor/invoices/draft/page.tsx:66-75`
Estimated scaling risk:
- Near-term

5. `confirmed` Medium: sales form loaders still preload large lookup payloads before the user searches
Why it could become slow:
- The default loader still preloads up to 120 leads, 250 partners, and 250 referral sources.
- That is safer than a whole-table read, but it is still a lot of dropdown data to fetch before the user has typed anything.
Evidence:
- Limits: `lib/services/sales-crm-read-model.ts:220-222`
- Loader: `lib/services/sales-crm-read-model.ts:533-621`
Estimated scaling risk:
- Near-term

## 6. Duplicate Query Logic

1. `confirmed` Medium: billing invoice reads are still spread across multiple services even after the main list-page cleanup
Where:
- `lib/services/billing-read-supabase.ts`
- `lib/services/billing-exports.ts`
- `lib/services/billing-invoice-document.ts`
Why it matters:
- The main draft/finalized/custom list path is now centralized and paged, which is good.
- But export generation and invoice-document builders still read `billing_invoices` and `billing_invoice_lines` directly with their own shapes, so select lists, pagination rules, and future index assumptions can still drift.

2. `confirmed` Medium: care-plan reads still use two different read boundaries
Where:
- Direct table read boundary: `lib/services/care-plans-read-model.ts:224-255`
- Paged canonical RPC list boundary: `lib/services/care-plans-read-model.ts:339-365`
Why it matters:
- The list/dashboard path uses the shared RPC, but per-member and detail helpers still read `care_plans` directly.
- That split makes later performance tuning harder to keep consistent across care-plan screens.

## 7. Recommended Index Additions

Add these first:

1. `create index if not exists idx_lead_activities_activity_at_desc on public.lead_activities (activity_at desc);`

2. `create index if not exists idx_member_files_member_id_file_name on public.member_files (member_id, file_name);`

3. `create index if not exists idx_billing_invoices_status_month_created_desc on public.billing_invoices (invoice_status, invoice_month desc, created_at desc);`

4. `create index if not exists idx_billing_invoices_source_status_month_created_desc on public.billing_invoices (invoice_source, invoice_status, invoice_month desc, created_at desc);`

Do not rely on indexes alone for these two areas:

- Sales dashboard summary RPC
  Reason: the main problem is repeated whole-table aggregation work, not one missing index.

- Health dashboard MAR
  Reason: the dashboard is loading more rows than it actually needs, so the bigger win is a narrower read boundary.

## 8. Performance Hardening Plan

Phase 1: finish MAR containment

- Keep the new contained MAR first load.
- Add a dedicated health-dashboard MAR read boundary or RPC that returns only the action window and recent administered rows.
- Revisit whether the MAR board really needs exact `today` and `overdue` totals on first paint.

Phase 2: narrow repeated dashboard-time aggregation

- Refactor the sales dashboard summary RPC so it stops rebuilding full canonical lead state and whole-table counters on every dashboard view.
- Keep the shared RPC boundary, but make it do less work per request or move parts of it to a cached snapshot.

Phase 3: close the remaining index gaps

- Add the global `lead_activities(activity_at desc)` index.
- Add the `member_files(member_id, file_name)` duplicate-check index.
- Add invoice status/source list indexes that match the current paged billing readers.

Phase 4: finish billing read containment

- Keep the current paged invoice list helper.
- Page or otherwise bound `billing_batches`, `billing_export_jobs`, and the “Finalize All Drafts” id loader.
- If exports really need full-batch reads, keep those full reads inside export-only flows, not inside general list pages.

Phase 5: reduce unnecessary counting and preload work

- Decide where exact totals are truly required for member, MHP, and sales directory pages.
- Replace large sales form default lookup payloads with search-first loaders where possible.

## 9. Suggested Codex Prompts

1. `Harden the health dashboard MAR read path. Keep Supabase as the source of truth, but stop loading the full v_mar_today dataset just to show the next action window and recent administrations. Build the smallest safe read boundary and preserve current dashboard behavior.`

2. `Review the MAR workflow first-load path after the new containment work. Keep the 150-row default slices, but determine whether exact today and overdue counts are still required on first render. If not, remove that extra load safely.`

3. `Refactor the sales dashboard summary RPC so it stops reprocessing the full leads table and layering several whole-table counts on every request. Keep one canonical RPC boundary and preserve founder-facing dashboard metrics.`

4. `Add a safe Supabase migration for missing query-performance indexes: lead_activities(activity_at desc), member_files(member_id, file_name), billing_invoices(invoice_status, invoice_month desc, created_at desc), and billing_invoices(invoice_source, invoice_status, invoice_month desc, created_at desc).`

5. `Finish billing read containment. Keep the current paged invoice list helper, but page or bound billing_batches, billing_export_jobs, and the finalize-all draft-id loader so general billing pages stop reading whole tables.`

6. `Audit shared list pagination across member, MHP, and sales directory pages. Identify where count: \"exact\" is truly needed and where deferred or approximate totals would be safer for scale without breaking the UI.`

7. `Convert the sales form lookups to search-first loaders. Preserve current lead/partner/referral selection behavior, but stop preloading 120 leads and 250 partner/referral rows before the user searches.`

## 10. Founder Summary: What changed since the last run

What materially improved since the 2026-04-10 run:

- The main MAR board is no longer doing the old full first-load behavior by default. It now contains the first page to 150 `today` rows and 150 `overdue` rows, with an explicit “Load Full Center-wide Queues” path when staff need it. Evidence: `app/(portal)/health/mar/page.tsx:15-19`, `app/(portal)/health/mar/page.tsx:105-127`
- The main draft/finalized/custom billing invoice lists now page through one shared helper instead of pulling entire invoice tables. Evidence: `lib/services/billing-read-supabase.ts:179-223`, `lib/services/billing-read-supabase.ts:291-319`
- The repo now contains a reports-home change that limits the staff aggregate RPC to the last 180 days. That is the right direction and closes the old full-history scan once migration `0208_reports_home_recent_window.sql` is actually applied in Supabase. Evidence: `supabase/migrations/0208_reports_home_recent_window.sql:10-35`

What is still open:

- MAR is better, but not finished. The main workflow is contained now, while the health dashboard still loads the full `v_mar_today` dataset and the workflow page still asks for exact full-view counts.
- Sales remains the clearest whole-table dashboard risk. The dashboard summary RPC still rebuilds canonical lead state across the full `leads` table and adds several whole-table counts.
- The unfiltered recent lead-activity feed still wants one missing `activity_at desc` index.
- Generated member-file duplicate naming still wants the missing `member_files(member_id, file_name)` index.
- Billing list risk moved down, but it did not disappear. The main invoice pages are safer now, while billing batches, billing export jobs, and the draft “Finalize All” helper still read more than they need.

If you want the highest-value next fix now, do this in order:

1. Health dashboard MAR read containment
2. Sales dashboard summary RPC slimming
3. Add the missing `lead_activities` and `member_files` indexes
