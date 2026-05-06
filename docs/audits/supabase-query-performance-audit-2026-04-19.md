# Supabase Query Performance Audit

Date: 2026-04-19
Automation: Supabase Query Performance Audit

## 1. Executive Summary

This repo still has the same small group of read paths that are most likely to get slow and expensive as Memory Lane grows.

Top confirmed risks in the current workspace:

- `confirmed` High: the sales dashboard summary RPC still rebuilds lead state from the full `leads` table and still performs whole-table counts on related sales tables. Evidence: `supabase/migrations/0209_sales_dashboard_summary_lead_count_slimming.sql:41-148`, `supabase/migrations/0209_sales_dashboard_summary_lead_count_slimming.sql:267-270`, `lib/services/sales-workflows.ts:155-181`
- `confirmed` High: the billing revenue dashboard still does overlapping broad reads in one request by calling the billing preview, variable-charge queue, and batch list together. Evidence: `lib/services/billing-preview-helpers.ts:186-256`, `lib/services/billing-preview-helpers.ts:326-345`, `lib/services/billing-read-supabase.ts:682-723`
- `confirmed` High: the admin audit trail still pages newest-first from `audit_logs` without a standalone `created_at desc` index. Evidence: `lib/services/admin-audit-trail.ts:79-90`
- `confirmed` Medium: partner and referral directories still sort by `organization_name` and often request `count: "exact"`, but the repo still only has trigram and partner-scoped indexes for those shapes, not plain alphabetical sort indexes. Evidence: `lib/services/sales-crm-read-model.ts:386-490`, `supabase/migrations/0105_sales_pipeline_summary_rpc_and_search_indexes.sql:123-142`, `supabase/migrations/0124_data_access_optimization_indexes.sql:14-18`
- `confirmed` Medium: the Member Command Center still loads the full member file history in one RPC call with no pagination. The existing index helps ordering, but payload size will still grow linearly with each member's document count. Evidence: `lib/services/member-command-center-runtime.ts:243-261`, `lib/services/member-command-center-runtime.ts:427-435`, `supabase/migrations/0145_reports_and_member_files_read_rpcs.sql:96-137`, `supabase/migrations/0048_query_performance_support_indexes.sql:1-5`
- `confirmed` Medium: the health dashboard, MHP overview, and Member Command Center detail still pay a wide first-load query cost before the user sees the screen. Evidence: `lib/services/health-dashboard.ts:126-158`, `lib/services/member-health-profiles-read.ts:35-94`, `lib/services/member-command-center-runtime.ts:427-467`

Important positive notes:

- `confirmed` The repo still carries `0210_query_audit_missing_indexes.sql`, so the earlier `member_files(file_name)` and billing invoice list index fixes are still present on disk. Evidence: `supabase/migrations/0210_query_audit_missing_indexes.sql:1-10`
- `confirmed` Care-plan list pages are still routed through the paged `rpc_get_care_plan_list` boundary instead of a raw whole-table page query. Evidence: `lib/services/care-plans-read-model.ts:339-365`
- `confirmed` I still did not find a new classic page-load per-row N+1 pattern in member list, MAR, MHP index, care-plan dashboard, member-file list, or audit-log reads.

Important caveat:

- `likely` This was a code-and-migrations audit only. I did not inspect live PostgreSQL query plans or confirm which migrations are already applied in the linked Supabase project.

## 2. Missing Indexes

1. `confirmed` `audit_logs(created_at desc)`

Why it matters:

- The admin audit trail default path sorts newest-first without requiring another filter first.
- Current repo indexes cover `entity_type + created_at`, `actor_user_id + created_at`, and `action + created_at`, but not the plain "latest audit rows" path.

Evidence:

- Query: `lib/services/admin-audit-trail.ts:79-90`
- Existing indexes: `supabase/migrations/0048_query_performance_support_indexes.sql:10-14`, `supabase/migrations/0125_query_performance_followup_indexes.sql:1`

2. `confirmed` `community_partner_organizations(organization_name)`

Why it matters:

- Partner directories and lookup loaders sort alphabetically by `organization_name`.
- The repo has trigram search support and a `partner_id` index, but not a plain btree sort index for the unscoped alphabetical list.

Evidence:

- Queries: `lib/services/sales-crm-read-model.ts:386-423`, `lib/services/partner-detail-read-model.ts:110-124`
- Existing indexes: `supabase/migrations/0105_sales_pipeline_summary_rpc_and_search_indexes.sql:123-135`, `supabase/migrations/0124_data_access_optimization_indexes.sql:14-15`

3. `confirmed` `referral_sources(organization_name)`

Why it matters:

- Referral directories and pickers also sort alphabetically by `organization_name`.
- The repo has `partner_id + organization_name` for partner-scoped reads, but not a plain global alphabetical sort index for the unscoped directory path.

Evidence:

- Queries: `lib/services/sales-crm-read-model.ts:443-490`, `lib/services/partner-detail-read-model.ts:120-124`
- Existing indexes: `supabase/migrations/0105_sales_pipeline_summary_rpc_and_search_indexes.sql:141-142`, `supabase/migrations/0124_data_access_optimization_indexes.sql:17-18`

4. `likely` `profiles(full_name)` search support for enrollment-packet sender lookup

Why it matters:

- Enrollment-packet search expands a user-entered search string into `members`, `leads`, and `profiles` before the main packet query runs.
- I found search support for member and lead names, but not for `profiles.full_name`.

Evidence:

- Query: `lib/services/enrollment-packet-list-support.ts:95-114`
- Migration search in this repo did not find a `profiles(full_name)` btree or trigram index.

5. `likely` `billing_export_jobs(generated_at desc, created_at desc)`

Why it matters:

- The export history list sorts newest-first without narrowing by batch.
- The repo has `billing_batch_id + generated_at desc`, which helps batch-scoped lookups, but not the global export-history page.

Evidence:

- Query: `lib/services/billing-read-supabase.ts:643-671`
- Existing index: `supabase/migrations/0013_care_plans_and_billing_execution.sql:240`

## 3. Potential Table Scans

1. `confirmed` High: sales dashboard summary RPC still performs whole-table aggregation work

Why it could become slow:

- The RPC still materializes `canonical_leads` from all rows in `public.leads`.
- It then computes summary counts from that derived set.
- It still adds separate whole-table counts for `lead_activities`, `community_partner_organizations`, `referral_sources`, and `partner_activities`.

Evidence:

- Runtime caller: `lib/services/sales-workflows.ts:155-181`
- RPC definition: `supabase/migrations/0209_sales_dashboard_summary_lead_count_slimming.sql:41-148`, `supabase/migrations/0209_sales_dashboard_summary_lead_count_slimming.sql:267-270`

Estimated scaling risk:

- Near-term

2. `confirmed` High: admin audit trail can degrade into a broader newest-first scan

Why it could become slow:

- The default path sorts `audit_logs` by `created_at desc` without a matching standalone descending index.
- Area filtering uses `entity_type.ilike`, which adds more work on top of the descending sort.

Evidence:

- `lib/services/admin-audit-trail.ts:79-90`

Estimated scaling risk:

- Near-term

3. `confirmed` Medium: partner and referral directory reads can devolve into larger count-and-sort work

Why it could become slow:

- Both directory loaders request `count: "exact"` and sort by `organization_name`.
- Those query shapes are only partially supported by the current index set.

Evidence:

- `lib/services/sales-crm-read-model.ts:386-490`

Estimated scaling risk:

- Near-term

4. `likely` Medium: enrollment-packet sender-name search can fall back to broader scans

Why it could become slow:

- Search first probes `profiles.full_name` using `ilike`.
- I did not find supporting search indexes for that column in repo migrations.

Evidence:

- `lib/services/enrollment-packet-list-support.ts:108-113`

Estimated scaling risk:

- Near-term

## 4. N+1 Query Patterns

No confirmed classic per-row page-load N+1 pattern was found in the main member list, MAR queue, MHP index, care-plan dashboard, member-file list, or audit-log reads during this run.

The remaining repeated-query risk is:

1. `confirmed` Medium: MAR schedule reconciliation still fans out to one per-member reconciliation call

Why it could become slow:

- `syncTodayMarSchedules()` builds a member list and then calls `reconcileMarSchedulesForMember(...)` once per member.
- This is not a UI list N+1, but it is still repeated query work that can spike when many medication updates land together.

Evidence:

- `lib/services/mar-workflow-read.ts:115-136`

Residual validation gap:

- I did not inspect runtime queue depth or PostgreSQL execution plans for this path.

## 5. Inefficient Data Fetching

1. `confirmed` High: billing revenue dashboard summary has a large fixed read cost per request

Why it could become slow:

- One dashboard request runs `getBillingGenerationPreview`, `getVariableChargesQueue`, and `getBillingBatches`.
- The preview alone loads all active members plus billing settings, attendance schedules, attendance facts, templates, transportation logs, ancillary logs, categories, and adjustments across a multi-month window.

Evidence:

- `lib/services/billing-preview-helpers.ts:186-256`
- `lib/services/billing-preview-helpers.ts:326-345`
- `lib/services/billing-read-supabase.ts:682-723`

Estimated scaling risk:

- Near-term

2. `confirmed` Medium: Member Command Center detail still loads a wide cross-domain bundle up front

Why it could become slow:

- Every detail load fetches profile, attendance schedule, contacts, files, allergies, care-plan overview, enrollment-packet alert, and then runs an exact assessment count.
- This is operationally convenient, but it front-loads several domains before the user interacts with tabs.

Evidence:

- `lib/services/member-command-center-runtime.ts:427-467`

Estimated scaling risk:

- Near-term

3. `confirmed` Medium: member file history is still unpaginated for Member Command Center

Why it could become slow:

- `rpc_list_member_files` returns all member files ordered by `uploaded_at desc`.
- The index makes the query shape reasonable, but the payload still grows forever with each uploaded artifact because there is no `limit`, cursor, or date window.

Evidence:

- `lib/services/member-command-center-runtime.ts:243-261`
- `supabase/migrations/0145_reports_and_member_files_read_rpcs.sql:96-137`

Estimated scaling risk:

- Near-term

4. `confirmed` Medium: MHP overview still stacks several cross-domain reads on every overview load

Why it could become slow:

- The overview supplement loads care-plan snapshot, progress-note summary, billing payor, and physician orders together.
- The overview summary then adds assessment history on top of that.

Evidence:

- `lib/services/member-health-profiles-read.ts:35-94`

Estimated scaling risk:

- Near-term

5. `confirmed` Medium: health dashboard first paint still has a wide fixed fan-out

Why it could become slow:

- One request loads MAR snapshot, blood sugar rows, active member count, care plans, incidents, progress notes, two runner-health checks, and care alerts.
- The page is useful, but it still does a lot of work before the user sees the screen.

Evidence:

- `lib/services/health-dashboard.ts:126-158`

Estimated scaling risk:

- Near-term

6. `confirmed` Medium: MAR workflow still pays for exact counts before loading limited slices

Why it could become slow:

- The main workflow issues exact-count queries for `v_mar_today` and `v_mar_overdue_today` on every snapshot load before it loads the capped rows.

Evidence:

- `lib/services/mar-workflow-read.ts:165-223`

Estimated scaling risk:

- Near-term

7. `confirmed` Medium: completed enrollment-packet reporting still over-reads relative to screen needs

Why it could become slow:

- The list reads up to 200 rows by default and 500 at the top end.
- Search expands into three separate ID lookup queries first.
- After the main query, the service still runs three more name-resolution reads.

Evidence:

- `lib/services/enrollment-packets-listing.ts:129-185`
- `lib/services/enrollment-packet-list-support.ts:64-157`

Estimated scaling risk:

- Near-term

8. `likely` Low: billing batch and export list reads still fetch wider rows than their list pages likely need

Why it could become slow:

- `getBillingBatches()` and `getBillingExports()` both use `select("*")`.
- This is probably acceptable today, but it widens payloads for list pages that mostly need summary fields.

Evidence:

- `lib/services/billing-read-supabase.ts:312-359`
- `lib/services/billing-read-supabase.ts:643-671`

Estimated scaling risk:

- Long-term

## 6. Duplicate Query Logic

1. `confirmed` High: the billing revenue dashboard reads overlapping raw billing tables twice on one request

Where:

- `lib/services/billing-preview-helpers.ts:238-255`
- `lib/services/billing-read-supabase.ts:485-509`
- `lib/services/billing-read-supabase.ts:682-723`

Why it matters:

- `getBillingDashboardSummary()` calls both the billing preview and the variable-charge queue.
- Those paths re-read overlapping transportation, ancillary, and adjustment data for similar date windows in the same request.

2. `confirmed` Medium: sales partner and referral lookup logic is still duplicated across directory, lookup-loader, and detail flows

Where:

- `lib/services/sales-crm-read-model.ts:386-490`
- `lib/services/partner-detail-read-model.ts:104-181`
- `lib/services/partner-detail-read-model.ts:198-260`

Why it matters:

- Search behavior, ordering, count behavior, and future index assumptions now have to stay aligned across several copies of the same query family.

3. `confirmed` Medium: care-plan reads still use both direct table helpers and the paged canonical RPC list

Where:

- Direct table helper: `lib/services/care-plans-read-model.ts:224-255`
- Canonical paged list: `lib/services/care-plans-read-model.ts:339-365`

Why it matters:

- The paged RPC path is safer for scale.
- Direct helper reads are still present for member snapshots and detail composition, which makes future tuning harder because not every care-plan read goes through one performance boundary.

## 7. Recommended Index Additions

Add these first:

1. `create index if not exists idx_audit_logs_created_at_desc on public.audit_logs (created_at desc);`

2. `create index if not exists idx_community_partner_organizations_organization_name on public.community_partner_organizations (organization_name);`

3. `create index if not exists idx_referral_sources_organization_name on public.referral_sources (organization_name);`

Validate before adding:

4. `create index if not exists idx_profiles_full_name_trgm on public.profiles using gin (full_name gin_trgm_ops);`

5. `create index if not exists idx_billing_export_jobs_generated_created_desc on public.billing_export_jobs (generated_at desc, created_at desc);`

Do not expect indexes alone to fix these:

- Sales dashboard summary RPC
- Billing revenue dashboard summary fan-out
- Member file history over-fetch in Member Command Center
- MHP overview, Member Command Center, and health dashboard first-load fan-out
- Completed enrollment-packet reporting over-read

## 8. Performance Hardening Plan

Phase 1: confirm repo fixes are actually live

- Verify that migrations `0209_sales_dashboard_summary_lead_count_slimming.sql` and `0210_query_audit_missing_indexes.sql` are applied in Supabase.
- If those migrations are not deployed, some earlier hardening work only exists on disk.

Phase 2: fix the highest-cost founder-facing reads

- Keep one canonical sales dashboard RPC boundary, but stop rebuilding summary state from the full `leads` table on every dashboard request.
- Rework the billing revenue dashboard so it does not run both the broad preview path and the broad queue path on the same load.

Phase 3: close the remaining easy index gaps

- Add `audit_logs(created_at desc)`.
- Add alphabetical btree indexes for partner and referral directories.
- Add `profiles(full_name)` search support only if enrollment-packet sender search is important enough to justify it.
- Add a global export-history sort index only if export-job history is expected to keep growing.

Phase 4: bound the fixed fan-out screens

- Add pagination or an explicit limit/window to `rpc_list_member_files` and only load the first slice on Member Command Center detail.
- Defer non-critical sections on MHP overview, Member Command Center detail, and the health dashboard instead of loading every supporting panel up front.
- Review whether the billing dashboard can source headline numbers from a narrower summary boundary instead of live raw-table fan-out.

Phase 5: reduce exact-count and over-read cost where the UI can tolerate it

- Revisit exact totals in MAR snapshots and sales directories.
- Convert completed enrollment-packet reporting from a large bounded read into true pagination.
- Trim `select("*")` usage on billing batch and export list pages if those tables keep growing.

Phase 6: keep one canonical query family per domain

- Keep one canonical sales partner/referral lookup boundary.
- Keep tuning pressure on care-plan reads so performance-sensitive list pages stay on the paged RPC path.
- Stop overlapping billing-table reads inside one dashboard request.

## 9. Suggested Codex Prompts

1. `Slim the sales dashboard summary RPC in Memory Lane. Keep one canonical Supabase RPC boundary, but stop rebuilding canonical lead state across the full leads table and stop doing unrelated whole-table counts on every dashboard request. Preserve current founder-facing summary numbers and recent inquiry payload.`

2. `Add a forward-only Supabase migration for the remaining read-side missing indexes from the April 19 query audit: audit_logs(created_at desc), community_partner_organizations(organization_name), referral_sources(organization_name), and if justified profiles(full_name) trigram search support. Validate current query shapes before adding low-value indexes.`

3. `Refactor the billing revenue dashboard summary in Memory Lane so one request does not re-read overlapping transportation, ancillary, and billing adjustment tables through both billing preview and variable-charge queue paths. Keep Supabase as source of truth and preserve founder-facing summary numbers.`

4. `Paginate member file history in Memory Lane. Update the canonical member file list RPC and Member Command Center detail flow so the first screen load only fetches an initial slice of files instead of the full per-member history. Preserve canonical service boundaries and service-role-only access rules.`

5. `Reduce fixed query fan-out on the Member Health Profile overview, Member Command Center detail, and health dashboard. Keep canonical services and resolver paths, but defer non-critical sections instead of loading every cross-domain panel up front.`

6. `Refactor the completed enrollment-packet reporting list so it stops doing a large bounded read plus pre-search ID fan-out and post-read name lookups on every request. Keep canonical service boundaries and move to a truly paginated Supabase-backed read path.`

7. `Review exact-count usage in sales and MAR read paths. Identify where count: "exact" is truly required and where deferred totals would preserve workflow behavior while reducing Supabase cost.`

## 10. Founder Summary: What changed since the last run

What changed:

- I did not find a material improvement in the main hotspots from the April 18 audit. The same high-risk issues are still the sales dashboard summary RPC, the billing revenue dashboard fan-out, and the missing audit-log sort index.
- I did confirm one additional medium-risk issue more clearly than yesterday: the Member Command Center file list is still loading a member's full file history in one RPC call with no pagination. This is not a missing-index problem. It is a payload-growth problem.

What improved:

- Nothing in today's workspace suggests a new regression in MAR, member list paging, or care-plan dashboard paging.
- The earlier query-hardening migrations are still present on disk, especially `0210_query_audit_missing_indexes.sql`.

What did not change:

- No new repo migration closes the `audit_logs(created_at desc)` gap.
- No new repo migration adds plain alphabetical sort indexes for partner and referral directories.
- The completed enrollment-packet list is still bounded-read plus search fan-out rather than true pagination.

What seems unrelated to this audit:

- The current dirty worktree files are `types/supabase-types.d.ts`, `docs/audits/workflow-simulation-audit-2026-04-19.md`, `supabase/migrations/0216_operational_read_policy_permission_hardening.sql`, and `tests/operational-read-policy-permission-hardening.test.ts`. Those do not appear to change the query-heavy read paths reviewed here.

What to focus on next:

1. Confirm `0209` and `0210` are applied in Supabase.
2. Slim the sales dashboard summary RPC further.
3. Rework the billing dashboard summary to stop duplicated raw reads.
4. Add the audit-log and sales-directory sort indexes.
5. Paginate member file history in the Member Command Center.
6. Convert the completed enrollment-packet list to true pagination.
