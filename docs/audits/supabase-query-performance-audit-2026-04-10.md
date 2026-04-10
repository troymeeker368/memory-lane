# Supabase Query Performance Audit

Date: 2026-04-10
Automation: Supabase Query Performance Audit

## 1. Executive Summary

This run is better targeted than the 2026-04-08 audit.

Three things are materially better than the last run:

- The shared member list boundary is now used for more of Member Command Center, so member search and paging drift is lower than before.
- The MAR workflow first load now caps the not-given slice, which reduces one part of the nursing payload.
- The earlier `system_events` open-alert index and MHP trigram search indexes are still present, so those older gaps did not regress.

The biggest remaining performance risks are now:

1. `confirmed` High: the MAR workflow still loads full organization-wide `today` and `overdue` medication datasets on every page load.
2. `confirmed` High: the reports home RPC still scans full historical `documentation_events` and `time_punches` every time the page loads.
3. `confirmed` High: several billing invoice readers still do unpaged `select("*")` reads and sort large invoice sets in application-facing services.
4. `confirmed` Medium: the sales dashboard summary RPC still canonicalizes the full `leads` table and layers several whole-table counts on top of that work.
5. `confirmed` Medium: the global lead recent-activity feed still orders `lead_activities` by `activity_at` without a matching global sort index.

## 2. Missing Indexes

1. `confirmed` `lead_activities(activity_at desc)` for the global recent-activity feed
Why it matters:
- The sales recent activity snapshot loads the latest 100 `lead_activities` rows ordered by `activity_at desc`.
- The repo has indexes for `lead_id`, `partner_id`, `referral_source_id`, and `completed_by_user_id` variants, but not one plain global `activity_at desc` index for the unfiltered feed.
Evidence:
- Query path: `lib/services/sales-crm-read-model.ts:788-805`
- Existing lead activity indexes: `supabase/migrations/0048_query_performance_support_indexes.sql`, `supabase/migrations/0113_performance_read_models.sql`, `supabase/migrations/0124_data_access_optimization_indexes.sql`

2. `confirmed` `member_files(member_id, file_name)` for generated-file duplicate checks
Why it matters:
- Generated member files check for an existing row by `member_id` and `file_name` before choosing a duplicate-safe file name.
- Existing indexes cover `member_id + uploaded_at`, `member_id + document_source`, `care_plan_id`, and `pof_request_id`, but not this duplicate-name lookup.
Evidence:
- Query path: `lib/services/member-files.ts:821-832`
- Existing member file indexes: `supabase/migrations/0048_query_performance_support_indexes.sql`, `supabase/migrations/0091_member_files_document_source_unique.sql`, `supabase/migrations/0020_care_plan_canonical_esign.sql`, `supabase/migrations/0019_pof_esign_workflow.sql`

3. `confirmed` `billing_invoices(invoice_status, invoice_month desc, created_at desc)` for status-based invoice lists
Why it matters:
- Draft and finalized invoice readers filter by `invoice_status` and sort by `invoice_month desc, created_at desc`.
- Existing invoice indexes cover invoice number, member/month, invoice source/month, and invoice date, but not this list shape.
Evidence:
- Query paths: `lib/services/billing-read-supabase.ts:123-189`
- Existing invoice indexes: `supabase/migrations/0013_care_plans_and_billing_execution.sql`, `supabase/migrations/0124_data_access_optimization_indexes.sql`, `supabase/migrations/0202_billing_invoice_date_index.sql`

4. `confirmed` `billing_invoices(invoice_source, invoice_status, invoice_month desc, created_at desc)` for custom invoice lists
Why it matters:
- Custom invoice reads filter by `invoice_source = 'Custom'`, sometimes by `invoice_status`, and sort by `invoice_month desc, created_at desc`.
- The current `invoice_source + invoice_month` index is helpful but does not fully match the extra status filter plus secondary sort.
Evidence:
- Query path: `lib/services/billing-read-supabase.ts:167-189`
- Existing invoice indexes: `supabase/migrations/0124_data_access_optimization_indexes.sql`

## 3. Potential Table Scans

1. `confirmed` High: reports home staff aggregates still scan full historical event tables
Why it could become slow:
- The reports home RPC groups all `documentation_events` by `staff_user_id` and all `time_punches` by `staff_user_id` with no date window.
- Moving this logic into SQL improved read organization, but it did not reduce the amount of underlying data scanned.
Evidence:
- Runtime caller: `lib/services/reports-ops.ts:52-70`
- RPC definition: `supabase/migrations/0145_reports_and_member_files_read_rpcs.sql:10-29`
Estimated scaling risk:
- Near-term

2. `confirmed` High: the sales dashboard summary RPC still walks the full `leads` table and several whole-table counters
Why it could become slow:
- The RPC builds a `canonical_leads` CTE from the whole `leads` table, then also performs separate total counts over `leads`, `lead_activities`, `community_partner_organizations`, `referral_sources`, and `partner_activities`.
- This is much cleaner than doing the work in TypeScript, but it is still a dashboard-time full-table aggregation path.
Evidence:
- Runtime caller: `lib/services/sales-workflows.ts:155-201`
- RPC definition: `supabase/migrations/0200_sales_dashboard_follow_up_summary_rpc.sql:44-279`
Estimated scaling risk:
- Near-term

3. `confirmed` Medium: the global lead recent-activity feed can degrade into a broader scan
Why it could become slow:
- The query orders `lead_activities` by `activity_at desc` and takes the newest 100 rows.
- There is no matching global `activity_at desc` index in migrations, so Postgres may need to sort more rows than necessary as activity history grows.
Evidence:
- `lib/services/sales-crm-read-model.ts:788-805`
Estimated scaling risk:
- Near-term

4. `likely` Medium: billing invoice list pages will do more work than needed as invoice volume grows
Why it could become slow:
- Multiple invoice list readers filter and sort across invoice status and month without a matching composite index.
- Some of those reads also pull every column and do not paginate, which increases both scan cost and payload cost.
Evidence:
- `lib/services/billing-read-supabase.ts:123-189`
- `lib/services/billing-exports.ts:61-70`
Estimated scaling risk:
- Near-term

## 4. N+1 Query Patterns

No confirmed hot-path N+1 read pattern was found in the priority workflows during this run.

What improved here:
- Member list reads are more centralized now, and the current sales referral-source page still batches its partner lookup instead of doing one query per row.

Residual validation gap:
- I audited code and migrations only. I did not inspect live query plans or production telemetry, so there could still be localized N+1 behavior outside the main audited list and dashboard paths.

## 5. Inefficient Data Fetching

1. `confirmed` High: the MAR workflow still loads full `today` and `overdue` day snapshots for the whole center
Why it could become slow:
- The first load still pulls all rows from `v_mar_today` and `v_mar_overdue_today`.
- The last run's broad-history concern is narrower now because `notGiven` is capped, but the two largest live queues are still unbounded.
Evidence:
- Query path: `lib/services/mar-workflow-read.ts:161-174`
- Caller: `app/(portal)/health/mar/page.tsx:23-34`
Estimated scaling risk:
- Near-term

2. `confirmed` High: billing invoice readers still load whole rows and whole result sets
Why it could become slow:
- `getDraftInvoices`, `getFinalizedInvoices`, `getCustomInvoices`, and some export/document readers still use `select("*")`.
- Several of those reads have no page limit at all, so invoice growth hits both database work and payload size.
Evidence:
- `lib/services/billing-read-supabase.ts:123-189`
- `lib/services/billing-exports.ts:61-70`
- `lib/services/billing-invoice-document.ts:549-552`
Estimated scaling risk:
- Near-term

3. `confirmed` Medium: sales form loaders still preload large lookup sets before the user searches
Why it could become slow:
- The sales form helper loads up to 120 leads, 250 partners, and 250 referral sources on initial load.
- That is safer than whole-table loading, but it is still a lot of data to fetch before the user has asked for anything specific.
Evidence:
- Limits: `lib/services/sales-crm-read-model.ts:220-222`
- Loader: `lib/services/sales-crm-read-model.ts:533-576`
Estimated scaling risk:
- Near-term

4. `confirmed` Medium: exact counts still happen on every member and sales list page
Why it could become slow:
- Shared member paging still asks Supabase for `count: "exact"` on each request.
- Sales lead, partner, and referral-source directory pages do the same.
- Exact counts are convenient for pagination, but they become one of the first things to feel expensive as tables move into the thousands.
Evidence:
- `lib/services/member-list-read.ts:61-88`
- `lib/services/sales-crm-read-model.ts:713-748`
- `lib/services/sales-crm-read-model.ts:824-864`
Estimated scaling risk:
- Near-term

## 6. Duplicate Query Logic

1. `confirmed` Medium: billing invoice reads are still spread across multiple services with overlapping shapes
Where:
- `lib/services/billing-read-supabase.ts`
- `lib/services/billing-exports.ts`
- `lib/services/billing-invoice-document.ts`
- `lib/services/billing-supabase.ts`
Why it matters:
- The same invoice table is being read in several places with similar sort/filter patterns.
- That makes it easier for indexes, select lists, and pagination rules to drift apart over time.

2. `confirmed` Medium: care plan reads still use two different read boundaries
Where:
- Direct table read: `lib/services/care-plans-read-model.ts:224-255`
- Paged RPC read: `lib/services/care-plans-read-model.ts:339-365`
- RPC definition: `supabase/migrations/0189_care_plan_list_post_sign_canonical_fields.sql`
Why it matters:
- The list page uses the canonical RPC, but per-member and detail helpers still query `care_plans` directly.
- That split makes future performance tuning and field-shape changes harder to keep consistent.

No confirmed duplicate query regression remains for the shared member index path. That was improved again since the last run.

## 7. Recommended Index Additions

Add these first:

1. `create index if not exists idx_lead_activities_activity_at_desc on public.lead_activities (activity_at desc);`

2. `create index if not exists idx_member_files_member_id_file_name on public.member_files (member_id, file_name);`

3. `create index if not exists idx_billing_invoices_status_month_created_desc on public.billing_invoices (invoice_status, invoice_month desc, created_at desc);`

4. `create index if not exists idx_billing_invoices_source_status_month_created_desc on public.billing_invoices (invoice_source, invoice_status, invoice_month desc, created_at desc);`

Do not rely on indexes alone for these two areas:

- Reports home staff aggregates
  Reason: the current RPC still scans full historical event tables, so the bigger win is a bounded window or cached snapshot.

- Sales dashboard summary RPC
  Reason: the main issue is repeated whole-table aggregation work, not just one missing index.

## 8. Performance Hardening Plan

Phase 1: contain the highest-cost page loads
- Put the main MAR workflow behind a segmented read model so the first page load does not fetch every `today` and `overdue` row center-wide.
- Paginate billing invoice lists and replace `select("*")` with narrower read models for list and export preparation flows.

Phase 2: reduce repeated full-table aggregation
- Move reports home staff productivity and time summaries to either a bounded recent window or a cached snapshot table/RPC.
- Narrow the sales dashboard summary RPC so it does not rebuild full-lead canonical state and whole-table counters on every dashboard load.

Phase 3: close the remaining index gaps
- Add the global `lead_activities(activity_at desc)` index.
- Add the `member_files(member_id, file_name)` duplicate-check index.
- Add invoice list indexes that match the real status/source + sort patterns.

Phase 4: revisit exact-count and preload behavior
- Decide where exact totals are truly necessary for member and sales list pages.
- Convert sales form lookups to search-backed loaders where the user does not need a large default dropdown payload.

Phase 5: reduce read-boundary drift
- Consolidate billing invoice list readers around one canonical list/query helper.
- Decide whether care plan member/detail reads should move closer to the existing paged RPC boundary.

## 9. Suggested Codex Prompts

1. `Harden the MAR workflow first-load path. Keep Supabase as the source of truth, but stop loading full center-wide today and overdue MAR datasets on every page render. Build the smallest safe segmented read boundary and preserve current nursing workflow behavior.`

2. `Audit billing invoice list readers for performance. Replace unpaged select("*") invoice reads with a canonical paged list boundary, add only the minimal fields needed for list views, and keep export/detail flows correct.`

3. `Add the smallest safe Supabase migration for billing invoice list performance. The indexes should match the current draft/finalized/custom invoice list filters and sort order: invoice_status, invoice_source, invoice_month desc, created_at desc.`

4. `Harden the sales recent-activity feed. Add a safe migration for a global lead_activities(activity_at desc) index, then verify the recent activity page still returns the same rows in the same order.`

5. `Refactor the reports home staff aggregate path so it stops scanning full historical documentation_events and time_punches on every page load. Prefer a bounded time window or a cached snapshot, and keep the output founder-readable.`

6. `Review shared list pagination across member and sales pages. Identify where count: "exact" is truly required and where approximate totals or deferred totals would be safer for scale without breaking the UI.`

7. `Add a safe Supabase migration for member_files(member_id, file_name), then verify generated member-file duplicate naming still behaves the same and does not create duplicate records.`

## 10. Founder Summary: What changed since the last run

What improved since the 2026-04-08 run:

- The shared member list boundary is stronger now. Member Command Center now uses the shared non-paged member list helper too, so the old member-list duplication concern is smaller than before.
- MAR first load is slightly safer now because the not-given slice is capped. That does not fix the full MAR page problem, but it does trim one of the four major MAR reads.
- The earlier `system_events` open-alert index and MHP search indexes are still in place, so those previously flagged issues remain closed.

What is still open:

- MAR is still the clearest clinical workflow scaling risk because the page still loads full center-wide `today` and `overdue` queues on first render.
- Reports home still does broad historical aggregation work, just inside an RPC now instead of in app code.
- Sales dashboard summary still does whole-table aggregation, and the global lead recent-activity feed still wants one missing index.
- Billing invoice reads are now the largest non-clinical list/read risk because multiple services still pull whole invoice rows without pagination.
- The member-file duplicate-name check still needs a composite index.

If you want the highest-value next fix now, start with MAR first-load containment and billing invoice list hardening. Those are the cleanest remaining wins with the most practical user impact.
