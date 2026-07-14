# Supabase Query Performance Audit

Date: 2026-05-09
Automation: Supabase Query Performance Audit

## 1. Executive Summary

- `confirmed` High: the sales dashboard summary RPC is still the top scaling risk. It still rebuilds dashboard state from the full `leads` table, then adds more global counts from other sales tables on the same request. This still feeds founder-facing dashboard paths, including the follow-up dashboard. Evidence: `supabase/migrations/0209_sales_dashboard_summary_lead_count_slimming.sql:41-170`, `supabase/migrations/0209_sales_dashboard_summary_lead_count_slimming.sql:258-279`, `lib/services/sales-workflows.ts:155-181`, `lib/services/sales-crm-read-model.ts:974-999`
- `confirmed` High: the billing dashboard summary still does three broad reads for one summary request: full billing preview generation, full prior-month variable-charge queue loading, and full batch loading. One duplicate batch fetch was removed from the module index, but the heavy summary path itself is unchanged. Evidence: `lib/services/billing-read-supabase.ts:683-725`, `lib/services/billing-read-supabase.ts:485-547`, `lib/services/billing-preview-helpers.ts:199-255`
- `confirmed` Medium: the admin audit trail still sorts `audit_logs` newest-first without a standalone `created_at desc` index. The new tokenized area filter also expands the `OR entity_type ILIKE` branches, so the same base query now does more work when staff filter by area. Evidence: `lib/services/admin-audit-trail.ts:103-115`, `supabase/migrations/0047_query_performance_indexes.sql:10-11`, `supabase/migrations/0048_query_performance_support_indexes.sql:10-14`
- `confirmed` Medium: MAR workflow reads still pay for exact counts before loading limited slices, and the health dashboard MAR action queue is still unbounded. The daily MAR schedule refresh also still fans out one reconciliation call per member. Evidence: `lib/services/mar-workflow-read.ts:126-136`, `lib/services/mar-workflow-read.ts:165-215`, `lib/services/mar-dashboard-read-model.ts:27-44`
- `confirmed` Medium: member detail, Member Command Center, and MHP detail still load broad cross-domain bundles on first render. There was some cleanup in care-plan and partner reads, but the fixed first-load query cost is still high. Evidence: `lib/services/member-detail-read-model.ts:161-225`, `lib/services/member-command-center-runtime.ts:506-537`, `lib/services/member-health-profiles-read.ts:42-67`, `lib/services/member-health-profiles-supabase.ts:560-668`
- `likely` Medium: several list and report paths still request exact counts on first render or before export even when the user mainly needs the first page. The most exposed examples are shared member lists, sales directories, physician orders, MAR workflow totals, and on-demand admin reports. Evidence: `lib/services/member-list-read.ts:72-86`, `lib/services/sales-crm-read-model.ts:400-474`, `lib/services/physician-orders-read.ts:195-215`, `lib/services/admin-reporting-foundation.ts:326-433`

Important caveat:

- This was a code-and-migrations audit only. I did not run live `EXPLAIN` plans, inspect Supabase query logs, or review `pg_stat_statements`.

## 2. Missing Indexes

1. `confirmed` `audit_logs(created_at desc)`

Why it matters:

- The audit trail defaults to newest-first reads.
- Current indexes help when the query is filtered by `entity_type`, `actor_user_id`, or `action`, but not for the plain global recent-events path.

Evidence:

- Query: `lib/services/admin-audit-trail.ts:103-115`
- Existing indexes: `supabase/migrations/0047_query_performance_indexes.sql:10-11`, `supabase/migrations/0048_query_performance_support_indexes.sql:10-14`, `supabase/migrations/0125_query_performance_followup_indexes.sql:1`

2. `confirmed` `community_partner_organizations(organization_name)`

Why it matters:

- The partner directory sorts alphabetically and asks for exact counts on the same query path.
- Trigram search indexes exist, but the default alphabetical listing still lacks a simple btree sort index.

Evidence:

- Query: `lib/services/sales-crm-read-model.ts:400-430`
- Existing indexes: `supabase/migrations/0105_sales_pipeline_summary_rpc_and_search_indexes.sql:123-136`, `supabase/migrations/0124_data_access_optimization_indexes.sql:14`

3. `confirmed` `referral_sources(organization_name)`

Why it matters:

- The referral-source directory uses the same alphabetical sort plus exact-count pattern as the partner directory.
- There is a composite `(partner_id, organization_name)` index, but that does not fully cover the default global alphabetical list path.

Evidence:

- Query: `lib/services/sales-crm-read-model.ts:457-498`
- Existing indexes: `supabase/migrations/0105_sales_pipeline_summary_rpc_and_search_indexes.sql:138-154`, `supabase/migrations/0124_data_access_optimization_indexes.sql:17`

Residual gap:

- I did not confirm a new must-add index in MAR, member files, care plans, or MHP paths beyond the existing repo migrations.
- `physician_orders` list sorting by `updated_at desc` looks like a possible future index candidate, but I would verify live plans before adding that index because the repo already has several physician-order indexes with member and status leading columns.

## 3. Potential Table Scans

1. `confirmed` High: sales dashboard summary RPC still does broad full-table lead aggregation

Why it could become slow:

- It normalizes every lead row into `canonical_leads`, derives `resolved_leads`, then computes multiple summary counts and payloads from that intermediate data.
- The same request also counts unrelated sales tables.

Evidence:

- `supabase/migrations/0209_sales_dashboard_summary_lead_count_slimming.sql:41-170`
- `supabase/migrations/0209_sales_dashboard_summary_lead_count_slimming.sql:258-279`

Estimated scaling risk:

- Near-term

2. `confirmed` Medium: admin audit trail can still degrade into a broad recent-events scan

Why it could become slow:

- The base query is `order by created_at desc` with no standalone matching index.
- The new area tokenization widens the `OR entity_type ILIKE` filter branches on that same path.

Evidence:

- `lib/services/admin-audit-trail.ts:103-115`

Estimated scaling risk:

- Near-term

3. `confirmed` Medium: partner and referral directories still combine exact counts with alphabetical sort on unindexed sort columns

Why it could become slow:

- Each page load can pay both the sort cost and the exact-count cost.
- Search indexes help search, but not the default global sort path.

Evidence:

- `lib/services/sales-crm-read-model.ts:400-474`

Estimated scaling risk:

- Near-term

4. `likely` Medium: shared member and physician-order list screens still pay exact-count scan cost on first render

Why it could become slow:

- The shared member list helper always requests `count: "exact"`.
- The physician order index page does the same while sorting by `updated_at desc`.

Evidence:

- `lib/services/member-list-read.ts:72-86`
- `lib/services/physician-orders-read.ts:195-215`

Estimated scaling risk:

- Near-term

## 4. N+1 Query Patterns

1. `confirmed` Medium: MAR schedule refresh still fans out one reconciliation job per member

Why it could become slow:

- `syncTodayMarSchedules()` first builds the candidate member set, then runs `reconcileMarSchedulesForMember(...)` once per member.
- That is a workflow-level N+1 pattern in a clinical path that runs regularly.

Evidence:

- Candidate read: `lib/services/mar-workflow-read.ts:65-123`
- Per-member fan-out: `lib/services/mar-workflow-read.ts:126-136`

Estimated scaling risk:

- Near-term

2. `confirmed` Low: member file page reads can fall back to a second `member_files` query for legacy inline rows

Why it could become slow:

- The page is still correctly bounded, but when the first page contains rows with missing storage paths it issues another query to look up legacy inline payload markers.
- This is not a classic page-level N+1, but it is extra conditional query work on a hot member detail path.

Evidence:

- `lib/services/member-command-center-runtime.ts:279-320`

Estimated scaling risk:

- Long-term

3. `likely` Low: no new page-level Supabase query-inside-loop regressions were confirmed in the current worktree

Residual gap:

- I did not inspect every helper behind billing exports, attendance reports, and every imported document/report module for hidden per-row RPC fan-out.

## 5. Inefficient Data Fetching

1. `confirmed` High: billing dashboard summary still loads far more raw data than the summary cards need

Why it could become slow:

- One summary request still runs full preview generation, full prior-month variable-charge loading, and full batch loading.
- The code then totals those raw arrays in TypeScript.

Evidence:

- `lib/services/billing-read-supabase.ts:683-725`

Estimated scaling risk:

- Near-term

2. `confirmed` High: variable-charge summary math is still built from raw monthly rows in application code

Why it could become slow:

- `getVariableChargesQueue()` loads all matching monthly transportation, ancillary, and billing-adjustment rows.
- The dashboard only needs waiting totals for headline numbers, not the full raw queue payload, to render those cards.

Evidence:

- `lib/services/billing-read-supabase.ts:485-547`

Estimated scaling risk:

- Near-term

3. `confirmed` High: billing preview generation still does a wide active-member fan-out before the dashboard even uses the result

Why it could become slow:

- The preview path loads center settings, member settings, schedules, attendance, schedule templates, transportation, ancillary, categories, and adjustments for all active members in range.
- That is reasonable for invoice generation preview, but expensive when reused for lightweight dashboard summary cards.

Evidence:

- `lib/services/billing-preview-helpers.ts:199-255`

Estimated scaling risk:

- Near-term

4. `confirmed` Medium: dashboard ancillary summary still loads every monthly ancillary row just to compute totals

Why it could become slow:

- `listDashboardAncillaryChargesForMonth()` pulls all monthly rows, then `getDashboardAdminSnapshot()` reduces them in JavaScript.
- The screen only needs monthly revenue and unreconciled count.

Evidence:

- `lib/services/dashboard.ts:179-229`

Estimated scaling risk:

- Near-term

5. `confirmed` Medium: MAR workflow snapshot still pays exact counts before loading limited slices

Why it could become slow:

- The page counts all rows in `v_mar_today` and `v_mar_overdue_today`, then separately loads limited row slices.
- That adds work even when the user only sees the first page.

Evidence:

- `lib/services/mar-workflow-read.ts:165-215`

Estimated scaling risk:

- Near-term

6. `confirmed` Medium: health dashboard MAR action queue is still unbounded

Why it could become slow:

- `loadHealthDashboardMarActionRows()` filters by due window and status, but does not limit the result set.
- As daily medication volume grows, the founder dashboard payload can grow with it.

Evidence:

- `lib/services/mar-dashboard-read-model.ts:27-44`

Estimated scaling risk:

- Near-term

7. `confirmed` Medium: Member Command Center detail still has a broad first-load fan-out

Why it could become slow:

- One request still loads MCC profile, attendance schedule, contacts, the first file page, MHP allergies, care-plan overview, enrollment-packet staging summary, and intake-assessment existence.
- Paging member files helped, but the first-load query count is still high.

Evidence:

- `lib/services/member-command-center-runtime.ts:506-537`

Estimated scaling risk:

- Near-term

8. `confirmed` Medium: member detail still loads many preview tables on first render

Why it could become slow:

- The detail page still loads daily activity, toilet, shower, transportation, blood sugar, ancillary, assessments, photos, and care-plan preview data.
- The care-plan path is cleaner than yesterday, but the fixed multi-table read remains broad.

Evidence:

- `lib/services/member-detail-read-model.ts:161-225`
- `lib/services/member-detail-read-model.ts:289-318`

Estimated scaling risk:

- Near-term

9. `confirmed` Medium: MHP overview and detail still pull wide cross-domain bundles

Why it could become slow:

- Overview still bundles care-plan snapshot, progress-note summary, billing payor, related physician orders, and assessments.
- Detail still loads profile, diagnoses, medications, allergies, providers, equipment, notes, assessments, and MCC photo state.

Evidence:

- `lib/services/member-health-profiles-read.ts:42-67`
- `lib/services/member-health-profiles-read.ts:84-92`
- `lib/services/member-health-profiles-supabase.ts:560-668`

Estimated scaling risk:

- Near-term

10. `confirmed` Medium: POF read helpers still use `select("*")` on request and event timelines

Why it could become slow:

- Several POF read helpers load full request rows and full document-event rows even when the screen only uses a subset.
- That inflates payload size as signature and delivery metadata grows.

Evidence:

- `lib/services/pof-read.ts:58-79`
- `lib/services/pof-read.ts:99-155`

Estimated scaling risk:

- Long-term

11. `likely` Medium: on-demand admin report reads still do exact counts plus full fetches for wide date ranges

Why it could become slow:

- The guardrail is good because it blocks oversized exports, but the current implementation still does a count query and then a full fetch query for the same date range.
- This is probably acceptable today because it is explicit and user-triggered, but it is still repeated work on large report paths.

Evidence:

- `lib/services/admin-reporting-foundation.ts:326-433`

Estimated scaling risk:

- Long-term

## 6. Duplicate Query Logic

1. `confirmed` Medium improvement: billing module index no longer fetches the batch list twice

What changed:

- `getBillingModuleIndex()` now reuses `dashboard.batches[0]` instead of calling `getBillingBatches()` again.

Evidence:

- `lib/services/billing-read-supabase.ts:730-755`

2. `confirmed` Medium improvement: member detail now uses one care-plan preview path instead of separate overview and snapshot calls

What changed:

- The member detail screen now calls `getMemberCarePlanPreview()` once instead of separately calling both overview and snapshot loaders.

Evidence:

- `lib/services/member-detail-read-model.ts:289-318`
- `lib/services/care-plans-read-model.ts:596-645`

3. `confirmed` Low improvement: partner detail now reuses the already-loaded partner row when resolving referral sources

What changed:

- Partner detail no longer asks the referral-source helper to re-load the partner identity first.

Evidence:

- `lib/services/partner-detail-read-model.ts:102-107`
- `lib/services/sales-crm-read-model.ts:1082-1095`

4. `confirmed` Medium: care-plan reads still keep two member-scoped count paths alive

Why it matters:

- `getMemberCarePlanOverview()` and `getMemberCarePlanPreview()` both issue `count: "exact"` against `care_plans` for the same member-scoped domain.
- This is not the highest-cost problem because it is per member, but it keeps duplicate count logic active in a shared domain.

Evidence:

- `lib/services/care-plans-read-model.ts:578-615`

5. `likely` Medium: billing summary and dashboard totals still re-read overlapping monthly billing data in separate services

Why it matters:

- The billing dashboard summary, variable-charge queue, preview generation, and admin dashboard ancillary totals each compute similar monthly billing facts from separate reads.
- That duplication makes performance tuning harder because the same truth is rebuilt in more than one place.

Evidence:

- `lib/services/billing-read-supabase.ts:485-725`
- `lib/services/dashboard.ts:179-229`

## 7. Recommended Index Additions

Add these first:

1. `create index if not exists idx_audit_logs_created_at_desc on public.audit_logs (created_at desc);`
2. `create index if not exists idx_community_partner_organizations_organization_name on public.community_partner_organizations (organization_name);`
3. `create index if not exists idx_referral_sources_organization_name on public.referral_sources (organization_name);`

Verify before adding:

4. Consider `physician_orders(updated_at desc)` or `(status, updated_at desc)` only after checking live plans for the POF index page, because the repo already has several physician-order indexes and I do not want to add a redundant one without evidence.

Do not expect indexes alone to fix:

- sales dashboard summary RPC full-table aggregation
- billing dashboard summary fan-out
- MAR exact-count reads
- broad MHP, MCC, and member-detail first-load bundles

## 8. Performance Hardening Plan

1. Keep one canonical sales summary boundary, but slim the RPC.
   Preserve the existing RPC entry point, but stop rebuilding so much founder-facing summary state from the whole `leads` table on each request.

2. Separate billing dashboard summaries from billing preview workloads.
   The dashboard cards should not need the same raw data load as invoice generation preview.

3. Add the three confirmed missing indexes.
   These are small, low-risk changes with direct read benefit.

4. Stop paying exact counts on first render unless the screen truly needs them.
   Prioritize shared member lists, MAR workflow counts, sales directories, and physician-order index paths.

5. Keep founder dashboards bounded.
   Add a limit to the MAR action queue and move monthly summary math closer to SQL or RPC.

6. Reduce first-load bundle size for member-centric detail screens.
   Preserve canonical services, but lazy-load non-primary panels in MHP, MCC, and member detail where the workflow allows it.

7. Trim payload width on document and report read paths.
   Replace `select("*")` with narrower selects in POF timeline helpers and review whether report/export reads can fetch less data up front.

8. Validate with live query evidence before the next hardening pass.
   The next step after code review should be Supabase query logs or `EXPLAIN` checks for the top 5 paths, not guesswork.

## 9. Suggested Codex Prompts

1. `Slim the Memory Lane sales dashboard summary RPC. Keep one canonical Supabase RPC boundary, but stop rebuilding founder dashboard state across the full leads table and remove unrelated whole-table counts from each request. Preserve current displayed numbers.`

2. `Refactor the Memory Lane billing dashboard summary so homepage summary cards do not run the full billing preview helper, the full prior-month variable-charge queue, and the full batch list on every request. Keep Supabase as source of truth and preserve existing dashboard totals.`

3. `Add a forward-only Supabase migration for the remaining confirmed read indexes from the 2026-05-09 query audit: audit_logs(created_at desc), community_partner_organizations(organization_name), and referral_sources(organization_name).`

4. `Review Memory Lane exact-count usage in member lists, MAR workflow reads, sales directories, and physician-order list pages. Keep the UX intact, but defer or remove exact counts where the first page does not strictly need them.`

5. `Refactor Memory Lane dashboard ancillary and variable-charge summary reads so monthly totals are computed in SQL or RPC instead of loading raw monthly rows into TypeScript.`

6. `Reduce first-load Supabase query fan-out for Member Command Center, member detail, and Member Health Profile screens. Preserve canonical shared services, keep paged member files, and lazy-load non-primary supporting panels where safe.`

7. `Review Memory Lane MAR dashboard and workflow reads. Remove unnecessary exact-count work, add a hard limit to the founder-facing MAR action queue, and keep current clinical behavior intact.`

8. `Tighten Memory Lane POF read models by replacing select(*) with narrower selects in pof_requests and document_events timeline queries. Preserve current UI behavior and auditability.`

## 10. Founder Summary: What changed since the last run

What materially improved:

- Billing module index got a little cheaper. It no longer fetches the billing batch list twice.
- Member detail care-plan loading got cleaner. It now uses one preview read path instead of separately loading both care-plan overview and care-plan snapshot.
- Partner detail got a small cleanup. It now reuses the already-loaded partner row when mapping referral sources.

What changed but did not materially solve scaling:

- Member detail cleanup introduced a new member-scoped care-plan count inside the preview helper. That is not the main problem because it is scoped to one member, but it means the care-plan domain still has duplicate count logic.
- Admin audit area filtering is now more flexible for users, but it broadens the `OR entity_type ILIKE` work on top of the same missing `audit_logs(created_at desc)` index.

What did not materially improve:

- The biggest cost is still the sales dashboard summary RPC.
- Billing dashboard summary still does wide raw-data reads for headline numbers.
- The audit trail still lacks the plain `audit_logs(created_at desc)` index.
- MAR workflow still pays for exact counts before limited reads, and the founder-facing MAR due queue is still unbounded.
- MHP, Member Command Center, and member detail screens still have broad first-load fan-out across multiple tables.
- Sales directories still rely on exact counts plus alphabetical sort without the remaining plain-name indexes.

What to focus on next:

1. Slim the sales dashboard summary RPC first.
2. Separate billing summary cards from billing preview workloads.
3. Add the three confirmed missing indexes.
4. Remove first-render exact counts where the page does not strictly need them.
5. Bound dashboard queues and lazy-load non-primary detail panels.
