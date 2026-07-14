# Supabase Query Performance Audit

Date: 2026-05-11
Automation: Supabase Query Performance Audit

This was a repo-only audit. I reviewed code and migrations, but I did not run live `EXPLAIN` plans, Supabase query logs, or `pg_stat_statements`.

## 1. Executive Summary

- `confirmed` High: the biggest unresolved cost is still the sales dashboard summary RPC. It still rebuilds founder metrics from the full `leads` population and also runs separate global counts on each request. Evidence: [sales-workflows.ts](/D:/Memory%20Lane%20App/lib/services/sales-workflows.ts:155), [0209_sales_dashboard_summary_lead_count_slimming.sql](/D:/Memory%20Lane%20App/supabase/migrations/0209_sales_dashboard_summary_lead_count_slimming.sql:41), [0209_sales_dashboard_summary_lead_count_slimming.sql](/D:/Memory%20Lane%20App/supabase/migrations/0209_sales_dashboard_summary_lead_count_slimming.sql:267)
- `confirmed` High: billing homepage and revenue reads are still heavier than the UI needs. Summary cards still depend on full billing preview generation, month-wide variable-charge reads, and full batch history. Evidence: [billing-read-supabase.ts](/D:/Memory%20Lane%20App/lib/services/billing-read-supabase.ts:683), [billing-preview-helpers.ts](/D:/Memory%20Lane%20App/lib/services/billing-preview-helpers.ts:186)
- `confirmed` High: shared member and member-detail reads still do too much work up front. Shared member lists still pay exact counts on first render, member detail still fans out across many tables, and MCC detail still front-loads cross-domain reads. Evidence: [member-list-read.ts](/D:/Memory%20Lane%20App/lib/services/member-list-read.ts:70), [member-detail-read-model.ts](/D:/Memory%20Lane%20App/lib/services/member-detail-read-model.ts:161), [member-command-center-runtime.ts](/D:/Memory%20Lane%20App/lib/services/member-command-center-runtime.ts:506)
- `confirmed` Medium: MAR still has three scaling risks. The refresh job still scans whole candidate populations, the workflow snapshot still pays exact counts before capped slices, and the health dashboard action queue is still unbounded. Evidence: [mar-workflow-read.ts](/D:/Memory%20Lane%20App/lib/services/mar-workflow-read.ts:65), [mar-workflow-read.ts](/D:/Memory%20Lane%20App/lib/services/mar-workflow-read.ts:165), [mar-dashboard-read-model.ts](/D:/Memory%20Lane%20App/lib/services/mar-dashboard-read-model.ts:32)
- `confirmed` Medium: the audit trail got more flexible for users but more expensive for the database. The current local change broadens one area filter into more wildcard `entity_type.ilike` OR terms, while the plain newest-first index is still missing. Evidence: [admin-audit-trail.ts](/D:/Memory%20Lane%20App/lib/services/admin-audit-trail.ts:81), [admin-audit-trail.ts](/D:/Memory%20Lane%20App/lib/services/admin-audit-trail.ts:105)
- `confirmed` Medium: document and export reads still load wider rows than needed. The clearest examples are POF request timelines and billing exports, which still rely on `select("*")`. Evidence: [pof-read.ts](/D:/Memory%20Lane%20App/lib/services/pof-read.ts:61), [pof-read.ts](/D:/Memory%20Lane%20App/lib/services/pof-read.ts:109), [billing-exports.ts](/D:/Memory%20Lane%20App/lib/services/billing-exports.ts:61)

Most important change since the last run:

- `confirmed` Improvement: the MHP detail route is no longer always loading every heavy section up front. It now passes a tab-scoped read plan and defers overview supplement panels, which is a real improvement, but not a full fix because the service default plan is still broad and overview still fans out. Evidence: [app/(portal)/health/member-health-profiles/[memberId]/page.tsx](/D:/Memory%20Lane%20App/app/(portal)/health/member-health-profiles/[memberId]/page.tsx:409), [app/(portal)/health/member-health-profiles/[memberId]/page.tsx](/D:/Memory%20Lane%20App/app/(portal)/health/member-health-profiles/[memberId]/page.tsx:436), [member-health-profiles-helpers.ts](/D:/Memory%20Lane%20App/lib/services/member-health-profiles-helpers.ts:127)

## 2. Missing Indexes

1. `confirmed` `audit_logs(created_at desc)`

Why it matters:

- The base audit trail query is still a newest-first read across the full table.
- Existing indexes help only when a narrower filter is present.

Evidence:

- Query path: [admin-audit-trail.ts](/D:/Memory%20Lane%20App/lib/services/admin-audit-trail.ts:105)
- Existing filtered indexes only: [0048_query_performance_support_indexes.sql](/D:/Memory%20Lane%20App/supabase/migrations/0048_query_performance_support_indexes.sql:10)

2. `confirmed` `community_partner_organizations(organization_name)`

Why it matters:

- The partner directory still sorts alphabetically and asks for exact counts.
- Search indexes exist, but not the simple sort index the default directory view wants.

Evidence:

- Query path: [sales-crm-read-model.ts](/D:/Memory%20Lane%20App/lib/services/sales-crm-read-model.ts:402)
- Existing search or partner-scoped indexes only: [0105_sales_pipeline_summary_rpc_and_search_indexes.sql](/D:/Memory%20Lane%20App/supabase/migrations/0105_sales_pipeline_summary_rpc_and_search_indexes.sql:123), [0124_data_access_optimization_indexes.sql](/D:/Memory%20Lane%20App/supabase/migrations/0124_data_access_optimization_indexes.sql:14)

3. `confirmed` `referral_sources(organization_name)`

Why it matters:

- The referral-source directory uses the same exact-count plus alphabetical sort pattern.
- The existing `(partner_id, organization_name)` index helps partner-scoped reads, not the global directory.

Evidence:

- Query path: [sales-crm-read-model.ts](/D:/Memory%20Lane%20App/lib/services/sales-crm-read-model.ts:459)
- Existing indexes: [0124_data_access_optimization_indexes.sql](/D:/Memory%20Lane%20App/supabase/migrations/0124_data_access_optimization_indexes.sql:17), [0105_sales_pipeline_summary_rpc_and_search_indexes.sql](/D:/Memory%20Lane%20App/supabase/migrations/0105_sales_pipeline_summary_rpc_and_search_indexes.sql:141)

4. `confirmed` `member_allergies(member_id, updated_at desc)`

Why it matters:

- MCC reads allergies newest-first for a single member.
- The repo has a uniqueness index for name grouping, but not an order-supporting member recency index.

Evidence:

- Query path: [member-command-center-runtime.ts](/D:/Memory%20Lane%20App/lib/services/member-command-center-runtime.ts:347)
- Existing uniqueness index: [0011_member_command_center_aux_schema.sql](/D:/Memory%20Lane%20App/supabase/migrations/0011_member_command_center_aux_schema.sql:220)

5. `confirmed` `billing_export_jobs(generated_at desc, created_at desc)`

Why it matters:

- The exports page asks for latest jobs globally, newest first.
- The repo only has a batch-scoped export-job index today.

Evidence:

- Query path: [billing-read-supabase.ts](/D:/Memory%20Lane%20App/lib/services/billing-read-supabase.ts:643)
- Existing index: [0013_care_plans_and_billing_execution.sql](/D:/Memory%20Lane%20App/supabase/migrations/0013_care_plans_and_billing_execution.sql:240)

6. `likely` `physician_orders(updated_at desc)` or `(status, updated_at desc)`

Why it matters:

- The main physician-order list still defaults to `order by updated_at desc` and pays `count: "exact"`.
- Existing coverage is member-led, not a general newest-first list path.

Evidence:

- Query path: [physician-orders-read.ts](/D:/Memory%20Lane%20App/lib/services/physician-orders-read.ts:196)
- Existing index coverage: [0006_intake_pof_mhp_supabase.sql](/D:/Memory%20Lane%20App/supabase/migrations/0006_intake_pof_mhp_supabase.sql:128)

7. `likely` `mar_schedules(scheduled_time, member_id)` for day-window reads

Why it matters:

- MAR day-window reads filter by `scheduled_time` only, not by member first.
- The current index is `member_id`-first, which is weaker for these full-center day-window reads.

Evidence:

- Query path: [mar-workflow-read.ts](/D:/Memory%20Lane%20App/lib/services/mar-workflow-read.ts:77)
- Existing index: [0028_pof_seeded_mar_workflow.sql](/D:/Memory%20Lane%20App/supabase/migrations/0028_pof_seeded_mar_workflow.sql:54)

## 3. Potential Table Scans

1. `confirmed` High: sales dashboard summary RPC still rebuilds from the full lead population

Why it could become slow:

- It canonicalizes the full `leads` table, aggregates it multiple ways, and also runs separate whole-table counts on supporting sales tables.

Evidence:

- [0209_sales_dashboard_summary_lead_count_slimming.sql](/D:/Memory%20Lane%20App/supabase/migrations/0209_sales_dashboard_summary_lead_count_slimming.sql:41)
- [0209_sales_dashboard_summary_lead_count_slimming.sql](/D:/Memory%20Lane%20App/supabase/migrations/0209_sales_dashboard_summary_lead_count_slimming.sql:267)

Estimated scaling risk:

- Immediate to near-term

2. `confirmed` High: MAR refresh still scans whole candidate populations before narrowing to changed members

Why it could become slow:

- It loads active MHP-sourced medications and same-day schedules for the full center, then compares counts in TypeScript before reconciling per member.

Evidence:

- [mar-workflow-read.ts](/D:/Memory%20Lane%20App/lib/services/mar-workflow-read.ts:65)
- [0199_mar_sync_candidate_index.sql](/D:/Memory%20Lane%20App/supabase/migrations/0199_mar_sync_candidate_index.sql:1)

Estimated scaling risk:

- Near-term

3. `likely` High: MAR same-day schedule reads may still degrade into broad time-window scans

Why it could become slow:

- The query filters by a day window on `scheduled_time`, but the existing index is `member_id`-first.

Evidence:

- [mar-workflow-read.ts](/D:/Memory%20Lane%20App/lib/services/mar-workflow-read.ts:77)
- [0028_pof_seeded_mar_workflow.sql](/D:/Memory%20Lane%20App/supabase/migrations/0028_pof_seeded_mar_workflow.sql:54)

Estimated scaling risk:

- Near-term

4. `confirmed` Medium: audit trail can still degrade into a broad recent-events scan

Why it could become slow:

- The query sorts the whole table newest-first.
- The local area-filter change expands into more wildcard OR terms on `entity_type`.

Evidence:

- [admin-audit-trail.ts](/D:/Memory%20Lane%20App/lib/services/admin-audit-trail.ts:81)
- [admin-audit-trail.ts](/D:/Memory%20Lane%20App/lib/services/admin-audit-trail.ts:105)

Estimated scaling risk:

- Near-term

5. `likely` Medium: revenue summary still loads broad attendance and ancillary datasets before the final summary is computed

Why it could become slow:

- The summary path pulls a full attendance dataset for the range and also pulls all ancillary rows in range, then filters some statuses in TypeScript.

Evidence:

- [admin-reporting-foundation.ts](/D:/Memory%20Lane%20App/lib/services/admin-reporting-foundation.ts:188)
- [admin-reporting-foundation.ts](/D:/Memory%20Lane%20App/lib/services/admin-reporting-foundation.ts:224)

Estimated scaling risk:

- Near-term

6. `confirmed` Medium: sales partner and referral directories still combine exact counts with unsupported global sort columns

Why it could become slow:

- Each page pays both exact count cost and sort cost, but only search and partner-scoped indexes exist today.

Evidence:

- [sales-crm-read-model.ts](/D:/Memory%20Lane%20App/lib/services/sales-crm-read-model.ts:402)
- [sales-crm-read-model.ts](/D:/Memory%20Lane%20App/lib/services/sales-crm-read-model.ts:459)

Estimated scaling risk:

- Near-term

## 4. N+1 Query Patterns

1. `confirmed` Medium: MAR refresh still fans out one reconciliation call per changed member

Why it could become slow:

- After the candidate scan, the workflow runs one member-level reconcile operation for each changed member.
- This is the clearest workflow-level N+1 still present in a high-volume clinical path.

Evidence:

- [mar-workflow-read.ts](/D:/Memory%20Lane%20App/lib/services/mar-workflow-read.ts:126)

Estimated scaling risk:

- Near-term

2. `confirmed` Low: member files still can trigger a second member-files query for legacy inline rows

Why it could become slow:

- The page query is bounded, but rows missing storage paths still trigger a second lookup to detect legacy inline payloads.

Evidence:

- [member-command-center-runtime.ts](/D:/Memory%20Lane%20App/lib/services/member-command-center-runtime.ts:311)

Estimated scaling risk:

- Long-term

3. `confirmed` Low: no new true page-level query-inside-loop regressions were confirmed in the requested hot paths

Residual gap:

- Several screens still have fixed fan-out work, but I did not confirm new per-row Supabase reads inside UI loops in the prioritized domains.

## 5. Inefficient Data Fetching

1. `confirmed` High: shared member index pages still pay exact counts on first render

Why it could become slow:

- The common helper always asks for `count: "exact"` before returning the current page.
- That shared path feeds `/members`, Member Command Center, and MHP list pages.

Evidence:

- [member-list-read.ts](/D:/Memory%20Lane%20App/lib/services/member-list-read.ts:70)

2. `confirmed` High: member detail still opens with a broad multi-table fan-out

Why it could become slow:

- One member detail load still fires eight preview queries, a counts RPC, and a care-plan preview.

Evidence:

- [member-detail-read-model.ts](/D:/Memory%20Lane%20App/lib/services/member-detail-read-model.ts:161)
- [member-detail-read-model.ts](/D:/Memory%20Lane%20App/lib/services/member-detail-read-model.ts:262)
- [member-detail-read-model.ts](/D:/Memory%20Lane%20App/lib/services/member-detail-read-model.ts:288)

3. `confirmed` Medium: Member Command Center detail still front-loads more sections than most first renders need

Why it could become slow:

- Contacts, files, allergies, care-plan overview, enrollment packet staging, and assessment existence all load immediately.

Evidence:

- [member-command-center-runtime.ts](/D:/Memory%20Lane%20App/lib/services/member-command-center-runtime.ts:506)
- [member-command-center-runtime.ts](/D:/Memory%20Lane%20App/lib/services/member-command-center-runtime.ts:533)

4. `confirmed` Medium: MCC detail page data currently reads all files under `serviceRole` and then filters in memory for non-clinical viewers

Why it could become slow:

- That work transfers more rows than some viewers are allowed to see.
- It is also a performance smell because filtering happens after the expensive read.

Evidence:

- [member-command-center-detail-read-model.ts](/D:/Memory%20Lane%20App/lib/services/member-command-center-detail-read-model.ts:334)

5. `confirmed` Medium: care-plan overview and preview still duplicate member-scoped count and latest-row work

Why it could become slow:

- Both helpers pay exact counts, and preview can also trigger an extra fetch if the latest plan is outside the preview slice.

Evidence:

- [care-plans-read-model.ts](/D:/Memory%20Lane%20App/lib/services/care-plans-read-model.ts:584)
- [care-plans-read-model.ts](/D:/Memory%20Lane%20App/lib/services/care-plans-read-model.ts:606)
- [care-plans-read-model.ts](/D:/Memory%20Lane%20App/lib/services/care-plans-read-model.ts:618)

6. `confirmed` Medium: MHP detail is improved, but not fully lean yet

Why it could become slow:

- The route now scopes reads by tab, which is better than yesterday.
- But the service default plan is still broad when no tab is passed, and the overview route still defers more panels rather than truly eliminating their reads.

Evidence:

- [app/(portal)/health/member-health-profiles/[memberId]/page.tsx](/D:/Memory%20Lane%20App/app/(portal)/health/member-health-profiles/[memberId]/page.tsx:436)
- [member-health-profiles-helpers.ts](/D:/Memory%20Lane%20App/lib/services/member-health-profiles-helpers.ts:127)
- [app/(portal)/health/member-health-profiles/[memberId]/page.tsx](/D:/Memory%20Lane%20App/app/(portal)/health/member-health-profiles/[memberId]/page.tsx:409)

7. `confirmed` High: billing preview still loads the full active census plus many supporting tables

Why it could become slow:

- One preview call loads active members, billing settings, schedules, attendance, transportation, ancillary, and adjustments across a multi-month window.

Evidence:

- [billing-preview-helpers.ts](/D:/Memory%20Lane%20App/lib/services/billing-preview-helpers.ts:186)

8. `confirmed` High: variable-charge queue still loads full month-wide raw rows and filters them in TypeScript

Why it could become slow:

- Billed and excluded rows are still transferred before the code removes them.

Evidence:

- [billing-read-supabase.ts](/D:/Memory%20Lane%20App/lib/services/billing-read-supabase.ts:485)

9. `confirmed` Medium: billing dashboard summary is still coupled to heavy reads

Why it could become slow:

- The summary still depends on full preview generation, full prior-month queue reads, and complete batch history.
- One duplicate batch fetch was removed earlier, but the overall summary shape is still heavy.

Evidence:

- [billing-read-supabase.ts](/D:/Memory%20Lane%20App/lib/services/billing-read-supabase.ts:683)
- [billing-read-supabase.ts](/D:/Memory%20Lane%20App/lib/services/billing-read-supabase.ts:728)

10. `confirmed` Medium: MAR workflow snapshot still pays exact counts before loading capped slices

Why it could become slow:

- The screen counts full view sizes first and then separately loads limited rows.

Evidence:

- [mar-workflow-read.ts](/D:/Memory%20Lane%20App/lib/services/mar-workflow-read.ts:165)

11. `confirmed` Medium: health dashboard MAR action queue is still unbounded

Why it could become slow:

- The founder-facing dashboard still reads every non-given row in the 12-hour action window with no cap.

Evidence:

- [mar-dashboard-read-model.ts](/D:/Memory%20Lane%20App/lib/services/mar-dashboard-read-model.ts:32)

12. `confirmed` Medium: POF timeline and request helpers still use `select("*")`

Why it could become slow:

- Those reads pull full request and event rows even when the UI uses only a subset.

Evidence:

- [pof-read.ts](/D:/Memory%20Lane%20App/lib/services/pof-read.ts:61)
- [pof-read.ts](/D:/Memory%20Lane%20App/lib/services/pof-read.ts:109)

13. `confirmed` Medium: billing export reads still use full-row fetches for invoices and invoice lines

Why it could become slow:

- Export code pulls `select("*")` from invoices and invoice lines even though each export format uses only part of the payload.

Evidence:

- [billing-exports.ts](/D:/Memory%20Lane%20App/lib/services/billing-exports.ts:61)
- [billing-exports.ts](/D:/Memory%20Lane%20App/lib/services/billing-exports.ts:101)
- [billing-exports.ts](/D:/Memory%20Lane%20App/lib/services/billing-exports.ts:317)

## 6. Duplicate Query Logic

1. `confirmed` Medium: care-plan reads still duplicate count and latest-row work across overview and preview helpers

Evidence:

- [care-plans-read-model.ts](/D:/Memory%20Lane%20App/lib/services/care-plans-read-model.ts:584)
- [care-plans-read-model.ts](/D:/Memory%20Lane%20App/lib/services/care-plans-read-model.ts:606)

2. `confirmed` Medium: billing export query stacks are duplicated in two builders

Why it matters:

- `createBillingExport()` and `buildQuickBooksCsvForInvoiceIds()` both reconstruct the same invoice, line, payor, and attendance lookup pattern.
- That makes performance tuning harder to keep consistent.

Evidence:

- [billing-exports.ts](/D:/Memory%20Lane%20App/lib/services/billing-exports.ts:61)
- [billing-exports.ts](/D:/Memory%20Lane%20App/lib/services/billing-exports.ts:317)

3. `confirmed` Low: sales partner and referral directory helpers still keep count and non-count branches separate

Why it matters:

- The filter logic is nearly the same in both paths, which raises drift risk when future tuning happens.

Evidence:

- [sales-crm-read-model.ts](/D:/Memory%20Lane%20App/lib/services/sales-crm-read-model.ts:402)
- [sales-crm-read-model.ts](/D:/Memory%20Lane%20App/lib/services/sales-crm-read-model.ts:459)

4. `confirmed` Medium: billing summary facts are still rebuilt in overlapping places

Why it matters:

- Billing dashboard summary, billing preview, and variable-charge queue still reconstruct related monthly truths from separate raw reads.

Evidence:

- [billing-read-supabase.ts](/D:/Memory%20Lane%20App/lib/services/billing-read-supabase.ts:485)
- [billing-read-supabase.ts](/D:/Memory%20Lane%20App/lib/services/billing-read-supabase.ts:683)
- [billing-preview-helpers.ts](/D:/Memory%20Lane%20App/lib/services/billing-preview-helpers.ts:186)

5. `confirmed` Improvement: the duplicate billing-batch re-read called out earlier remains fixed

Evidence:

- [billing-read-supabase.ts](/D:/Memory%20Lane%20App/lib/services/billing-read-supabase.ts:728)

## 7. Recommended Index Additions

Add these first:

1. `create index if not exists idx_audit_logs_created_at_desc on public.audit_logs (created_at desc);`
2. `create index if not exists idx_community_partner_organizations_organization_name on public.community_partner_organizations (organization_name);`
3. `create index if not exists idx_referral_sources_organization_name on public.referral_sources (organization_name);`
4. `create index if not exists idx_member_allergies_member_updated_at_desc on public.member_allergies (member_id, updated_at desc);`
5. `create index if not exists idx_billing_export_jobs_generated_created_desc on public.billing_export_jobs (generated_at desc, created_at desc);`

Verify with live plans before adding:

6. Consider `create index if not exists idx_physician_orders_updated_at_desc on public.physician_orders (updated_at desc);`
7. Consider `create index if not exists idx_mar_schedules_scheduled_time_member_id on public.mar_schedules (scheduled_time, member_id);`
8. Consider a date-led ancillary charge index if live plans show the revenue-summary view is scanning too broadly.

Do not expect indexes alone to fix:

- sales dashboard summary RPC full-table aggregation
- billing preview and queue over-fetching
- shared member first-render exact counts
- member detail and MCC first-load fan-out
- MAR action queue bounding

## 8. Performance Hardening Plan

1. Slim the sales dashboard summary RPC first.
   Keep one canonical RPC boundary, but stop rebuilding so much founder-facing summary state from the full `leads` table on every request.

2. Split billing summary cards from billing preview and queue workloads.
   Homepage or dashboard headline numbers should not require full invoice preview generation or month-wide queue reconstruction.

3. Add the five confirmed missing read indexes.
   These are the lowest-risk changes with direct read benefits.

4. Stop paying exact counts on first render unless the screen truly needs them.
   Prioritize shared member lists, MAR workflow totals, physician-order index pages, and sales partner/referral directories.

5. Push more billing queue filtering into SQL.
   Fetch only queue-eligible transportation, ancillary, and adjustment rows instead of pulling whole-month raw rows first.

6. Bound dashboard queues and history windows.
   Add a hard cap to the MAR action queue and a reasonable recent-history cap for export-job and batch-history views.

7. Reduce first-load member screen fan-out.
   Keep canonical service boundaries, but lazy-load non-primary panels for member detail and MCC detail where workflow safety allows it.

8. Consolidate duplicate care-plan and billing-export reads.
   One canonical preview/count helper per use case is easier to tune and cheaper to maintain.

9. Narrow payload width in document and export helpers.
   Replace `select("*")` in POF and billing exports with explicit field lists.

10. Validate the top paths with live evidence before the next hardening pass.
    The next step after this code audit should be Supabase query logs or `EXPLAIN` for the top five hot paths.

## 9. Suggested Codex Prompts

1. `Slim the Memory Lane sales dashboard summary RPC. Keep one canonical Supabase RPC boundary, but stop rebuilding founder dashboard state from the full leads table and reduce unrelated whole-table counts from each request. Preserve current numbers.`

2. `Refactor the Memory Lane billing dashboard summary so homepage summary cards do not run the full billing preview helper, the full prior-month variable-charge queue, and full batch history on every request. Keep Supabase as source of truth and preserve existing totals.`

3. `Add a forward-only Supabase migration for the confirmed remaining read indexes from the 2026-05-11 query audit: audit_logs(created_at desc), community_partner_organizations(organization_name), referral_sources(organization_name), member_allergies(member_id, updated_at desc), and billing_export_jobs(generated_at desc, created_at desc).`

4. `Review Memory Lane exact-count usage in shared member lists, MAR workflow reads, physician-order list pages, and sales partner/referral directories. Keep UX intact, but defer or remove exact counts where first render does not strictly need them.`

5. `Refactor Memory Lane variable-charge queue reads so billed and excluded rows are filtered in SQL instead of loaded into TypeScript first. Preserve current business rules and dashboard totals.`

6. `Reduce first-load Supabase query fan-out for member detail and Member Command Center detail screens. Preserve canonical shared services, keep role restrictions, and lazy-load non-primary supporting panels where safe.`

7. `Review Memory Lane MAR workflow reads. Remove unnecessary exact-count work, evaluate a scheduled_time-led index for day-window reads, move candidate detection closer to SQL or RPC, and add a hard limit to the founder-facing MAR action queue.`

8. `Tighten Memory Lane POF and billing export read models by replacing select(*) with narrower field lists. Preserve current UI behavior, exports, and auditability.`

9. `Refactor Memory Lane care-plan read helpers so overview and preview do not both pay separate exact counts and latest-row work for the same member request. Preserve canonical service boundaries and current UI data.`

## 10. Founder Summary: What changed since the last run

What materially improved:

- MHP detail is better than yesterday. The route now passes a tab-scoped read plan and defers overview supplement panels, so the old “always load everything” first-render problem is partially reduced.

What materially worsened:

- The audit trail area filter is now broader. It expands user input into more wildcard `entity_type.ilike` OR terms, but the plain newest-first `audit_logs(created_at desc)` index is still missing.

What newly surfaced:

- `member_allergies(member_id, updated_at desc)` is a concrete missing supporting index for MCC reads.
- `billing_export_jobs(generated_at desc, created_at desc)` is a concrete missing supporting index for the exports page.
- MCC detail page data currently loads all member files under `serviceRole` and then filters them in memory for non-clinical viewers.

What did not materially improve:

- The sales dashboard summary RPC is still the biggest read-scaling risk.
- Billing summary cards still do heavyweight preview and queue work.
- Shared member list pages still pay exact counts on first render.
- Member detail and MCC detail still front-load too many cross-domain reads.
- MAR still does whole-population candidate scans, exact counts on large views, and an unbounded dashboard action queue.
- POF and billing exports still over-fetch with `select("*")`.

What older improvements still hold:

- The new indexes from [0210_query_audit_missing_indexes.sql](/D:/Memory%20Lane%20App/supabase/migrations/0210_query_audit_missing_indexes.sql:1) are still in place for `lead_activities`, `member_files`, and `billing_invoices`.
- Billing module index still avoids the duplicate batch re-read that was fixed earlier.
- Page-size clamps remain tighter in shared member, sales, and physician-order list paths.

What to focus on next:

1. Slim the sales dashboard summary RPC first.
2. Split billing summary cards from billing preview and queue workloads.
3. Add the five confirmed missing indexes.
4. Remove first-render exact counts where the page does not truly need them.
5. Bound MAR action reads and reduce member-screen first-load fan-out.
