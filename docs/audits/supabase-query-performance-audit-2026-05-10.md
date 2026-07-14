# Supabase Query Performance Audit

Date: 2026-05-10
Automation: Supabase Query Performance Audit

## 1. Executive Summary

- `confirmed` High: the sales dashboard summary is still the biggest scaling risk. The shared RPC still rebuilds summary state from the full `leads` table and also runs separate global counts on each request. Evidence: [sales-workflows.ts](/D:/Memory%20Lane%20App/lib/services/sales-workflows.ts:155), [0209_sales_dashboard_summary_lead_count_slimming.sql](/D:/Memory%20Lane%20App/supabase/migrations/0209_sales_dashboard_summary_lead_count_slimming.sql:25)
- `confirmed` High: billing dashboard reads still pull far more raw data than the dashboard cards need. The summary path still combines full preview generation, a month-wide variable-charge queue, and batch history. Evidence: [billing-read-supabase.ts](/D:/Memory%20Lane%20App/lib/services/billing-read-supabase.ts:485), [billing-read-supabase.ts](/D:/Memory%20Lane%20App/lib/services/billing-read-supabase.ts:683), [billing-preview-helpers.ts](/D:/Memory%20Lane%20App/lib/services/billing-preview-helpers.ts:186)
- `confirmed` High: member, MHP, and Member Command Center reads still do too much work up front. Shared member lists still pay exact counts on first render, MHP detail still loads heavy sections by default, and member detail screens still fan out across many tables. Evidence: [member-list-read.ts](/D:/Memory%20Lane%20App/lib/services/member-list-read.ts:70), [member-health-profiles-supabase.ts](/D:/Memory%20Lane%20App/lib/services/member-health-profiles-supabase.ts:560), [member-detail-read-model.ts](/D:/Memory%20Lane%20App/lib/services/member-detail-read-model.ts:161), [member-command-center-runtime.ts](/D:/Memory%20Lane%20App/lib/services/member-command-center-runtime.ts:506)
- `confirmed` High: MAR still has two scaling risks. The daily sync scans the whole active medication and schedule population before reconciling per member, and the founder-facing dashboard still loads an unbounded action queue. Evidence: [mar-workflow-read.ts](/D:/Memory%20Lane%20App/lib/services/mar-workflow-read.ts:65), [mar-workflow-read.ts](/D:/Memory%20Lane%20App/lib/services/mar-workflow-read.ts:165), [mar-dashboard-read-model.ts](/D:/Memory%20Lane%20App/lib/services/mar-dashboard-read-model.ts:27)
- `confirmed` Medium: the audit trail got more flexible for users, but slower for the database. The new area filter expands into wildcard `OR entity_type ILIKE` clauses on top of the still-missing plain newest-first index. Evidence: [admin-audit-trail.ts](/D:/Memory%20Lane%20App/lib/services/admin-audit-trail.ts:81)
- `confirmed` Medium: reporting and document/export reads still load more data than needed in a few important paths. The main examples are attendance/revenue reports, billing exports, and POF timeline reads that still use `select("*")`. Evidence: [admin-reporting-foundation.ts](/D:/Memory%20Lane%20App/lib/services/admin-reporting-foundation.ts:188), [billing-exports.ts](/D:/Memory%20Lane%20App/lib/services/billing-exports.ts:61), [pof-read.ts](/D:/Memory%20Lane%20App/lib/services/pof-read.ts:58)

Important positive changes since the last run:

- A new migration added useful indexes for `lead_activities`, `member_files`, and `billing_invoices`. Evidence: [0210_query_audit_missing_indexes.sql](/D:/Memory%20Lane%20App/supabase/migrations/0210_query_audit_missing_indexes.sql:1)
- Billing module index no longer loads billing batches twice. Evidence: [billing-read-supabase.ts](/D:/Memory%20Lane%20App/lib/services/billing-read-supabase.ts:728)
- Shared member, sales, and physician-order list page sizes are now capped more aggressively, which reduces worst-case payloads. Evidence: [member-list-read.ts](/D:/Memory%20Lane%20App/lib/services/member-list-read.ts:65), [sales-crm-read-model.ts](/D:/Memory%20Lane%20App/lib/services/sales-crm-read-model.ts:936), [physician-orders-read.ts](/D:/Memory%20Lane%20App/lib/services/physician-orders-read.ts:194)

Important caveat:

- This was a code-and-migrations audit only. I did not run live `EXPLAIN` plans, inspect Supabase query logs, or review `pg_stat_statements`.

## 2. Missing Indexes

1. `confirmed` `audit_logs(created_at desc)`

Why it matters:

- Multiple audit views read newest-first across the whole table.
- Existing indexes help only when a narrower filter is present.

Evidence:

- Query path: [admin-audit-trail.ts](/D:/Memory%20Lane%20App/lib/services/admin-audit-trail.ts:105)
- Existing filtered indexes only: [0047_query_performance_indexes.sql](/D:/Memory%20Lane%20App/supabase/migrations/0047_query_performance_indexes.sql:10), [0048_query_performance_support_indexes.sql](/D:/Memory%20Lane%20App/supabase/migrations/0048_query_performance_support_indexes.sql:10), [0125_query_performance_followup_indexes.sql](/D:/Memory%20Lane%20App/supabase/migrations/0125_query_performance_followup_indexes.sql:1)

2. `confirmed` `community_partner_organizations(organization_name)`

Why it matters:

- The partner directory sorts alphabetically and asks for exact counts on the same path.
- Search indexes exist, but not the simple sort index that the default directory view wants.

Evidence:

- Query path: [sales-crm-read-model.ts](/D:/Memory%20Lane%20App/lib/services/sales-crm-read-model.ts:404)
- Existing indexes: [0105_sales_pipeline_summary_rpc_and_search_indexes.sql](/D:/Memory%20Lane%20App/supabase/migrations/0105_sales_pipeline_summary_rpc_and_search_indexes.sql:123), [0124_data_access_optimization_indexes.sql](/D:/Memory%20Lane%20App/supabase/migrations/0124_data_access_optimization_indexes.sql:14)

3. `confirmed` `referral_sources(organization_name)`

Why it matters:

- The referral-source directory uses the same exact-count plus alphabetical sort pattern.
- The existing `(partner_id, organization_name)` index helps partner-scoped reads, not the global directory.

Evidence:

- Query path: [sales-crm-read-model.ts](/D:/Memory%20Lane%20App/lib/services/sales-crm-read-model.ts:461)
- Existing indexes: [0105_sales_pipeline_summary_rpc_and_search_indexes.sql](/D:/Memory%20Lane%20App/supabase/migrations/0105_sales_pipeline_summary_rpc_and_search_indexes.sql:141), [0124_data_access_optimization_indexes.sql](/D:/Memory%20Lane%20App/supabase/migrations/0124_data_access_optimization_indexes.sql:17)

4. `likely` `physician_orders(updated_at desc)` or `(status, updated_at desc)`

Why it matters:

- The main physician-order list defaults to `order by updated_at desc` and also pays `count: "exact"`.
- I found supporting physician-order indexes, but not a general newest-first index for the default list path.

Evidence:

- Query path: [physician-orders-read.ts](/D:/Memory%20Lane%20App/lib/services/physician-orders-read.ts:196)
- Existing migration coverage looks member/status-led, not plain updated-at-led.

Residual gap:

- I would verify the live plan before adding the physician-order index so we do not add a redundant index.

## 3. Potential Table Scans

1. `confirmed` High: sales dashboard summary RPC still rebuilds from the full lead population

Why it could become slow:

- It normalizes and aggregates the full `leads` set, then also counts other sales tables.
- Every dashboard load becomes more expensive as total sales history grows.

Evidence:

- [0209_sales_dashboard_summary_lead_count_slimming.sql](/D:/Memory%20Lane%20App/supabase/migrations/0209_sales_dashboard_summary_lead_count_slimming.sql:25)

Estimated scaling risk:

- Immediate to near-term

2. `confirmed` High: attendance and revenue reporting still build large datasets before narrowing

Why it could become slow:

- The report path loads a broad attendance dataset and only later applies some of the business filters.
- That means cost grows with the whole census and date range, not the final report subset.

Evidence:

- [admin-reporting-foundation.ts](/D:/Memory%20Lane%20App/lib/services/admin-reporting-foundation.ts:188)

Estimated scaling risk:

- Near-term

3. `confirmed` Medium: audit trail can still degrade into a broad recent-events scan

Why it could become slow:

- The query sorts the full table newest-first.
- The new area filter broadens matches with wildcard `ILIKE` terms.

Evidence:

- [admin-audit-trail.ts](/D:/Memory%20Lane%20App/lib/services/admin-audit-trail.ts:81)

Estimated scaling risk:

- Near-term

4. `confirmed` Medium: partner and referral directories still combine exact counts with alphabetical sort on unsupported sort columns

Why it could become slow:

- Each page can pay both exact count cost and sort cost.
- Trigram indexes help search, not the default global A-to-Z list.

Evidence:

- [sales-crm-read-model.ts](/D:/Memory%20Lane%20App/lib/services/sales-crm-read-model.ts:402), [sales-crm-read-model.ts](/D:/Memory%20Lane%20App/lib/services/sales-crm-read-model.ts:459)

Estimated scaling risk:

- Near-term

5. `confirmed` Medium: shared member list helper still forces full filtered counts

Why it could become slow:

- The shared helper always asks for `count: "exact"` before returning the current page.
- That helper is reused by Member Command Center and MHP list pages.

Evidence:

- [member-list-read.ts](/D:/Memory%20Lane%20App/lib/services/member-list-read.ts:70)

Estimated scaling risk:

- Near-term

## 4. N+1 Query Patterns

1. `confirmed` Medium: MAR schedule refresh still fans out one reconciliation job per changed member

Why it could become slow:

- The code first scans all candidate medication and schedule rows, then runs one reconciliation operation per member.
- That is a workflow-level N+1 pattern in a clinical path that runs regularly.

Evidence:

- Candidate scan: [mar-workflow-read.ts](/D:/Memory%20Lane%20App/lib/services/mar-workflow-read.ts:65)
- Per-member fan-out: [mar-workflow-read.ts](/D:/Memory%20Lane%20App/lib/services/mar-workflow-read.ts:126)

Estimated scaling risk:

- Near-term

2. `confirmed` Low: member files can still trigger a second query for legacy inline rows

Why it could become slow:

- The page is bounded, but when the current slice includes rows without storage paths it issues a second `member_files` lookup.

Evidence:

- [member-command-center-runtime.ts](/D:/Memory%20Lane%20App/lib/services/member-command-center-runtime.ts:311)

Estimated scaling risk:

- Long-term

3. `likely` Low: no new page-level query-inside-loop regressions were confirmed in the requested hot paths

Residual gap:

- I did not inspect every export helper and every background workflow helper for hidden per-row RPC fan-out.

## 5. Inefficient Data Fetching

1. `confirmed` High: billing preview still loads the full active census plus many supporting tables

Why it could become slow:

- One preview call loads all active members, then settings, schedules, attendance, transportation, ancillary, and adjustments across a multi-month window.
- That is much heavier than a dashboard summary card needs.

Evidence:

- [billing-preview-helpers.ts](/D:/Memory%20Lane%20App/lib/services/billing-preview-helpers.ts:186)

Estimated scaling risk:

- Near-term

2. `confirmed` High: variable-charge queue still fetches full month-wide raw rows and filters them in TypeScript

Why it could become slow:

- Already billed and excluded records are still transferred before the code filters them out.

Evidence:

- [billing-read-supabase.ts](/D:/Memory%20Lane%20App/lib/services/billing-read-supabase.ts:493)

Estimated scaling risk:

- Near-term

3. `confirmed` Medium: billing dashboard still reads unbounded batch history

Why it could become slow:

- The dashboard only needs recent summary numbers, but it still reduces the whole batch list in memory.

Evidence:

- [billing-read-supabase.ts](/D:/Memory%20Lane%20App/lib/services/billing-read-supabase.ts:683)

Estimated scaling risk:

- Near-term

4. `confirmed` Medium: MAR workflow snapshot still pays exact counts before loading capped slices

Why it could become slow:

- The screen counts full view sizes and then separately loads limited rows.

Evidence:

- [mar-workflow-read.ts](/D:/Memory%20Lane%20App/lib/services/mar-workflow-read.ts:165)

Estimated scaling risk:

- Near-term

5. `confirmed` Medium: health dashboard MAR action queue is still unbounded

Why it could become slow:

- The founder-facing dashboard reads every non-given row in the 12-hour window with no cap.

Evidence:

- [mar-dashboard-read-model.ts](/D:/Memory%20Lane%20App/lib/services/mar-dashboard-read-model.ts:27)

Estimated scaling risk:

- Near-term

6. `confirmed` High: MHP detail still defaults to loading all heavy sections

Why it could become slow:

- The default detail read plan still pulls profile, diagnoses, medications, allergies, providers, equipment, notes, assessments, and MCC image state up front.
- As a member’s history grows, first render grows with it.

Evidence:

- [member-health-profiles-supabase.ts](/D:/Memory%20Lane%20App/lib/services/member-health-profiles-supabase.ts:560)

Estimated scaling risk:

- Near-term

7. `confirmed` Medium: member detail still opens with a broad multi-table fan-out

Why it could become slow:

- One member detail read still fires eight preview queries, a counts RPC, and a care-plan preview.

Evidence:

- [member-detail-read-model.ts](/D:/Memory%20Lane%20App/lib/services/member-detail-read-model.ts:161)

Estimated scaling risk:

- Near-term

8. `confirmed` Medium: Member Command Center detail still front-loads more sections than most first renders need

Why it could become slow:

- Contacts, allergies, files, care-plan overview, staging summary, and assessment existence are all loaded immediately.

Evidence:

- [member-command-center-runtime.ts](/D:/Memory%20Lane%20App/lib/services/member-command-center-runtime.ts:506)

Estimated scaling risk:

- Near-term

9. `confirmed` Medium: POF timeline and request reads still use `select("*")`

Why it could become slow:

- Those reads pull the full request and event rows even when the UI uses only a subset of fields.

Evidence:

- [pof-read.ts](/D:/Memory%20Lane%20App/lib/services/pof-read.ts:58), [pof-read.ts](/D:/Memory%20Lane%20App/lib/services/pof-read.ts:108)

Estimated scaling risk:

- Long-term

10. `confirmed` Medium: billing export reads still use full-row fetches for invoices and invoice lines

Why it could become slow:

- Export code pulls `select("*")` from invoices and invoice lines even when each export type uses only part of the payload.

Evidence:

- [billing-exports.ts](/D:/Memory%20Lane%20App/lib/services/billing-exports.ts:61), [billing-exports.ts](/D:/Memory%20Lane%20App/lib/services/billing-exports.ts:100), [billing-exports.ts](/D:/Memory%20Lane%20App/lib/services/billing-exports.ts:317)

Estimated scaling risk:

- Long-term

## 6. Duplicate Query Logic

1. `confirmed` Medium: care-plan reads still keep duplicate member-scoped count logic alive

Why it matters:

- `getMemberCarePlanOverview()` and `getMemberCarePlanPreview()` both issue an exact count against `care_plans`.
- Preview can also fall back to another fetch when the latest plan is outside the first slice.

Evidence:

- [care-plans-read-model.ts](/D:/Memory%20Lane%20App/lib/services/care-plans-read-model.ts:584), [care-plans-read-model.ts](/D:/Memory%20Lane%20App/lib/services/care-plans-read-model.ts:606)

2. `confirmed` Medium: billing summary logic still rebuilds overlapping monthly facts in separate services

Why it matters:

- Billing dashboard summary, variable-charge queue, billing preview, and ancillary dashboard summary all compute related monthly facts from different reads.
- That makes performance tuning harder because the same business truth is reconstructed multiple times.

Evidence:

- [billing-read-supabase.ts](/D:/Memory%20Lane%20App/lib/services/billing-read-supabase.ts:485), [billing-read-supabase.ts](/D:/Memory%20Lane%20App/lib/services/billing-read-supabase.ts:683), [dashboard.ts](/D:/Memory%20Lane%20App/lib/services/dashboard.ts:179)

3. `confirmed` Low: sales partner and referral directory helpers still duplicate count and non-count query paths

Why it matters:

- The count and non-count branches are separate even though the filter logic is almost the same.
- That is more maintainability risk than raw performance risk, but it makes future tuning easier to drift.

Evidence:

- [sales-crm-read-model.ts](/D:/Memory%20Lane%20App/lib/services/sales-crm-read-model.ts:402), [sales-crm-read-model.ts](/D:/Memory%20Lane%20App/lib/services/sales-crm-read-model.ts:459)

4. `confirmed` Improvement: billing module index no longer re-reads batches

What changed:

- The duplicate batch fetch called out yesterday is gone.

Evidence:

- [billing-read-supabase.ts](/D:/Memory%20Lane%20App/lib/services/billing-read-supabase.ts:728)

5. `confirmed` Improvement: member detail now uses one care-plan preview path instead of two separate care-plan reads

What changed:

- Member detail now loads care-plan preview once instead of separately asking for overview and snapshot.

Evidence:

- [member-detail-read-model.ts](/D:/Memory%20Lane%20App/lib/services/member-detail-read-model.ts:288)

## 7. Recommended Index Additions

Add these first:

1. `create index if not exists idx_audit_logs_created_at_desc on public.audit_logs (created_at desc);`
2. `create index if not exists idx_community_partner_organizations_organization_name on public.community_partner_organizations (organization_name);`
3. `create index if not exists idx_referral_sources_organization_name on public.referral_sources (organization_name);`

Verify before adding:

4. Consider `create index if not exists idx_physician_orders_updated_at_desc on public.physician_orders (updated_at desc);`
5. Consider a composite `system_events` read index only after checking live plans for the alert/retry paths.

Do not expect indexes alone to fix:

- sales dashboard summary RPC full-table aggregation
- billing preview and queue over-fetching
- MAR view counts and unbounded dashboard action rows
- broad MHP, MCC, and member-detail first loads

## 8. Performance Hardening Plan

1. Slim the sales dashboard RPC first.
   Keep the shared RPC boundary, but stop rebuilding so much founder-facing summary state from the whole `leads` table on every request.

2. Split billing dashboard summaries from billing preview workloads.
   Summary cards should not have to pay for full invoice preview generation or month-wide raw queue loads.

3. Add the three confirmed missing indexes.
   These are low-risk migration changes with direct benefit.

4. Stop paying exact counts on first render unless the page truly needs them.
   Prioritize shared member lists, MAR workflow totals, physician-order index pages, and sales directories.

5. Push filtering closer to SQL for billing and reporting.
   Fetch only queue-eligible variable charges, and scope attendance/revenue reporting earlier.

6. Bound dashboard queues and history windows.
   Add hard caps to the MAR action queue and billing batch history reads.

7. Reduce first-load member screen fan-out.
   Keep canonical services, but lazy-load non-primary panels for MHP, MCC, and member detail where workflow safety allows it.

8. Trim payload width on document and export reads.
   Replace `select("*")` with narrower selects in POF and billing export helpers.

9. Validate the top paths with live query evidence before the next hardening pass.
   The next step after this code audit should be Supabase query logs or `EXPLAIN` for the top 5 hot paths.

## 9. Suggested Codex Prompts

1. `Slim the Memory Lane sales dashboard summary RPC. Keep one canonical Supabase RPC boundary, but stop rebuilding founder dashboard state across the full leads table and reduce unrelated whole-table counts from each request. Preserve current displayed numbers.`

2. `Refactor the Memory Lane billing dashboard summary so homepage summary cards do not run the full billing preview helper, the full prior-month variable-charge queue, and unbounded batch history on every request. Keep Supabase as source of truth and preserve existing dashboard totals.`

3. `Add a forward-only Supabase migration for the confirmed remaining read indexes from the 2026-05-10 query audit: audit_logs(created_at desc), community_partner_organizations(organization_name), and referral_sources(organization_name).`

4. `Review Memory Lane exact-count usage in shared member lists, MAR workflow reads, sales directories, and physician-order list pages. Keep the UX intact, but defer or remove exact counts where first render does not strictly need them.`

5. `Refactor Memory Lane variable-charge queue reads so billed and excluded rows are filtered in SQL instead of loaded into TypeScript first. Preserve current business rules and dashboard totals.`

6. `Reduce first-load Supabase query fan-out for Member Health Profile, Member Command Center, and member detail screens. Preserve canonical shared services and lazy-load non-primary supporting panels where safe.`

7. `Review Memory Lane MAR workflow reads. Remove unnecessary exact-count work, move candidate detection closer to SQL or RPC, and add a hard limit to the founder-facing MAR action queue.`

8. `Tighten Memory Lane POF and billing export read models by replacing select(*) with narrower field lists. Preserve current UI behavior, exports, and auditability.`

9. `Refactor Memory Lane admin attendance and revenue reporting so member scoping and billing eligibility filters are applied before loading large attendance datasets. Preserve current report outputs.`

## 10. Founder Summary: What changed since the last run

What materially improved:

- A new migration added useful indexes for `lead_activities`, `member_files`, and `billing_invoices`.
- Billing module index stopped loading billing batches twice.
- Shared member, sales, and physician-order list reads now clamp page sizes more tightly.
- Member detail care-plan loading got cleaner by using one preview path instead of separate overview and snapshot calls.

What materially regressed:

- Audit trail area filtering is now more flexible, but it widened the query shape by expanding one filter into multiple wildcard `OR` matches on `entity_type`.

What did not materially improve:

- The sales dashboard summary RPC is still the biggest performance risk.
- Billing dashboard summary still does heavy raw-data work for lightweight headline numbers.
- Shared member lists still pay exact counts on first render.
- MHP, Member Command Center, and member detail screens still front-load too many cross-domain reads.
- MAR still does whole-population sync detection, exact counts on large views, and an unbounded dashboard action queue.
- The three missing read indexes from the last run are still not in migrations.

What to focus on next:

1. Slim the sales dashboard summary RPC first.
2. Split billing summary cards from billing preview and raw queue workloads.
3. Add the three confirmed missing indexes.
4. Remove first-render exact counts where the page does not truly need them.
5. Bound dashboard queues and lazy-load non-primary member detail panels.
