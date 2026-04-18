# Supabase Query Performance Audit

Date: 2026-04-18
Automation: Supabase Query Performance Audit

## 1. Executive Summary

This repo still has a small set of read paths that will get slower and more expensive as data volume grows.

The biggest confirmed risks in the current workspace are:

- `confirmed` High: the sales dashboard summary RPC still rebuilds lead state from the full `leads` table and then runs whole-table counts for related sales tables. Evidence: `supabase/migrations/0209_sales_dashboard_summary_lead_count_slimming.sql:41-148`, `supabase/migrations/0209_sales_dashboard_summary_lead_count_slimming.sql:267-270`, `lib/services/sales-workflows.ts:155-181`
- `confirmed` High: the billing revenue dashboard now deserves top-tier attention because one request fans into a billing preview, variable-charge queue, and batch list. The preview itself loads all active members plus billing settings, schedules, attendance, transportation, ancillary, categories, and adjustments across a multi-month window. Evidence: `lib/services/billing-preview-helpers.ts:186-256`, `lib/services/billing-read-supabase.ts:682-691`
- `confirmed` High: the admin audit trail still pages `audit_logs` newest-first without a standalone `audit_logs(created_at desc)` index. Evidence: `lib/services/admin-audit-trail.ts:79-90`
- `confirmed` Medium: sales partner and referral directory queries still sort by `organization_name` and often request `count: "exact"`, but the repo still has trigram search indexes instead of plain alphabetical sort indexes for those query shapes. Evidence: `lib/services/sales-crm-read-model.ts:386-423`, `lib/services/sales-crm-read-model.ts:443-490`
- `confirmed` Medium: the completed enrollment-packet reporting list is still a large bounded read with pre-search ID fan-out and post-read name resolution queries. Evidence: `lib/services/enrollment-packets-listing.ts:145-166`, `lib/services/enrollment-packet-list-support.ts:64-157`
- `confirmed` Medium: MHP overview, Member Command Center detail, and the health dashboard still pay a high fixed first-load query cost because each page pulls several cross-domain datasets up front. Evidence: `lib/services/member-health-profiles-read.ts:30-85`, `lib/services/member-command-center-runtime.ts:427-467`, `lib/services/health-dashboard.ts:137-158`

Important positive drift in this run:

- `confirmed` The repo still carries `0210_query_audit_missing_indexes.sql`, which adds earlier recommended indexes for `lead_activities(activity_at desc)`, `member_files(member_id, file_name)`, and billing invoice list filters/sorts. Evidence: `supabase/migrations/0210_query_audit_missing_indexes.sql:1-11`
- `confirmed` Billing invoice list pages now clearly funnel through one shared loader, so draft/finalized/custom invoice reads are using one canonical query family instead of drifting apart. Evidence: `lib/services/billing-read-supabase.ts:222-260`, `lib/services/billing-read-supabase.ts:361-384`
- `confirmed` I did not find a new classic page-load per-row N+1 pattern in member list, MAR, MHP, care-plan, member-file, or audit-log reads during this run.

Important caveat:

- `likely` This was a code-and-migrations audit only. I did not verify live PostgreSQL query plans or confirm that migrations `0209` and `0210` are already applied in the linked Supabase project.

## 2. Missing Indexes

1. `confirmed` `audit_logs(created_at desc)`

Why it matters:

- The admin audit trail default query sorts newest-first with no required filter.
- Current repo indexes cover `entity_type + created_at`, `actor_user_id + created_at`, and `action + created_at`, but not the plain “latest audit rows” path.

Evidence:

- Query: `lib/services/admin-audit-trail.ts:79-90`
- Existing indexes: `supabase/migrations/0048_query_performance_support_indexes.sql:10-14`, `supabase/migrations/0125_query_performance_followup_indexes.sql:1-1`

2. `confirmed` `community_partner_organizations(organization_name)`

Why it matters:

- The partner directory, partner lookup loaders, and partner picker all sort alphabetically by `organization_name`.
- Trigram indexes help fuzzy search, but they do not replace a plain btree sort index for ordered list pages.

Evidence:

- Queries: `lib/services/sales-crm-read-model.ts:386-423`, `lib/services/sales-crm-read-model.ts:548-561`
- Existing indexes: `supabase/migrations/0105_sales_pipeline_summary_rpc_and_search_indexes.sql:123-135`, `supabase/migrations/0124_data_access_optimization_indexes.sql:14-14`

3. `confirmed` `referral_sources(organization_name)`

Why it matters:

- Referral directories and lookup loaders also sort alphabetically by `organization_name`.
- The repo has partner-scoped and trigram indexes, but not a plain global sort index for the unscoped directory path.

Evidence:

- Queries: `lib/services/sales-crm-read-model.ts:443-490`, `lib/services/sales-crm-read-model.ts:564-577`
- Existing indexes: `supabase/migrations/0105_sales_pipeline_summary_rpc_and_search_indexes.sql:138-153`, `supabase/migrations/0124_data_access_optimization_indexes.sql:17-17`

4. `likely` `profiles(full_name)` search support for enrollment-packet sender lookup

Why it matters:

- Enrollment-packet search expands the founder’s search text into `members`, `leads`, and `profiles` before it runs the main packet query.
- I found search support for `members.display_name` and lead name/email fields, but not for `profiles.full_name`.

Evidence:

- Query: `lib/services/enrollment-packet-list-support.ts:95-114`
- Migration search in this repo did not find a `profiles(full_name)` btree or trigram index.

5. `likely` `billing_export_jobs(generated_at desc, created_at desc)`

Why it matters:

- The export jobs list sorts newest-first without filtering by batch.
- Current repo indexes cover `billing_batch_id + generated_at desc`, which helps batch-scoped queries, but not the global export-history page.

Evidence:

- Query: `lib/services/billing-read-supabase.ts:643-671`
- Existing index: `supabase/migrations/0013_care_plans_and_billing_execution.sql:240-241`

## 3. Potential Table Scans

1. `confirmed` High: sales dashboard summary RPC still performs whole-table aggregation work

Why it could become slow:

- The RPC still materializes `canonical_leads` from all rows in `public.leads`.
- It then computes summary counts from that derived set.
- It also runs additional whole-table counts against `lead_activities`, `community_partner_organizations`, `referral_sources`, and `partner_activities`.

Evidence:

- Runtime caller: `lib/services/sales-workflows.ts:155-181`
- RPC definition: `supabase/migrations/0209_sales_dashboard_summary_lead_count_slimming.sql:41-148`, `supabase/migrations/0209_sales_dashboard_summary_lead_count_slimming.sql:267-270`

Estimated scaling risk:

- Near-term

2. `confirmed` High: admin audit trail can degrade into a broader newest-first scan

Why it could become slow:

- The default path sorts `audit_logs` by `created_at desc` without a matching standalone index.
- Area filtering uses `entity_type.ilike`, which can add extra work on top of the descending sort.

Evidence:

- `lib/services/admin-audit-trail.ts:79-90`

Estimated scaling risk:

- Near-term

3. `confirmed` Medium: sales partner and referral directory reads can devolve into larger count-and-sort work

Why it could become slow:

- Both directories request `count: "exact"` and sort by `organization_name`.
- As those tables grow, exact counts plus alphabetical ordering get more expensive even before they look “large” in the UI.

Evidence:

- `lib/services/sales-crm-read-model.ts:386-423`
- `lib/services/sales-crm-read-model.ts:443-490`

Estimated scaling risk:

- Near-term

4. `likely` Medium: enrollment-packet sender-name search can fall back to a broader scan

Why it could become slow:

- Search first probes `profiles.full_name` with `ilike`.
- I did not find supporting search indexes for that column in repo migrations.

Evidence:

- `lib/services/enrollment-packet-list-support.ts:108-113`

Estimated scaling risk:

- Near-term

## 4. N+1 Query Patterns

No confirmed classic per-row page-load N+1 pattern was found in the main member, MAR, MHP, care-plan, member-file, or audit-log reads during this run.

The remaining repeated-query risk is:

1. `confirmed` Medium: MAR schedule reconciliation still fans out to one per-member reconciliation call

Why it could become slow:

- `syncTodayMarSchedules()` builds a candidate member list and then calls `reconcileMarSchedulesForMember(...)` once per member.
- That is not a UI list N+1, but it is still repeated query work that can spike when many medication updates land together.

Evidence:

- `lib/services/mar-workflow-read.ts:115-136`

Residual validation gap:

- I did not inspect live runtime telemetry, queue load, or PostgreSQL execution plans for this path.

## 5. Inefficient Data Fetching

1. `confirmed` High: billing revenue dashboard summary has a large fixed read cost per request

Why it could become slow:

- One dashboard request runs `getBillingGenerationPreview`, `getVariableChargesQueue`, and `getBillingBatches`.
- The preview alone loads all active members plus center settings, member settings, attendance schedules, attendance facts, billing templates, transportation logs, ancillary logs, categories, and adjustments for a multi-month window.

Evidence:

- `lib/services/billing-preview-helpers.ts:186-256`
- `lib/services/billing-read-supabase.ts:682-691`

Estimated scaling risk:

- Near-term

2. `confirmed` High: MHP overview still stacks several cross-domain reads on every overview load

Why it could become slow:

- The overview supplement loads care-plan snapshot, progress-note summary, billing payor, and physician orders together.
- The overview summary then adds assessment history on top of that.

Evidence:

- `lib/services/member-health-profiles-read.ts:30-85`

Estimated scaling risk:

- Near-term

3. `confirmed` Medium: Member Command Center detail still pulls several domains even when staff may only need one section

Why it could become slow:

- Every detail load fetches profile, attendance schedule, contacts, files, allergies, care-plan overview, enrollment-packet alert, and then an exact assessment count.

Evidence:

- `lib/services/member-command-center-runtime.ts:427-467`

Estimated scaling risk:

- Near-term

4. `confirmed` Medium: health dashboard first paint still has a wide fixed fan-out

Why it could become slow:

- One request loads MAR snapshot, blood sugar rows, active member count, care plans, incidents, progress notes, two runner health checks, and care alerts.
- The MAR path is narrower than it used to be, but the overall page still does a lot of work before the founder sees the page.

Evidence:

- `lib/services/health-dashboard.ts:137-158`

Estimated scaling risk:

- Near-term

5. `confirmed` Medium: MAR workflow still pays for exact counts before loading the limited row slices

Why it could become slow:

- The main workflow issues exact-count queries for `v_mar_today` and `v_mar_overdue_today` on every snapshot load before it loads the capped data slices.

Evidence:

- `lib/services/mar-workflow-read.ts:165-223`

Estimated scaling risk:

- Near-term

6. `confirmed` Medium: sales lead pipeline pages still pay for exact counts on every paginated request

Why it could become slow:

- The canonical lead list requests `count: "exact"` whenever pagination is enabled.
- That keeps totals accurate, but it makes every list request more expensive as `leads` grows.

Evidence:

- `lib/services/sales-crm-read-model.ts:918-957`

Estimated scaling risk:

- Near-term

7. `confirmed` Medium: completed enrollment-packet reporting still over-reads relative to screen needs

Why it could become slow:

- The list reads up to 200 rows by default and up to 500 rows at the top end.
- Search expands into three separate ID lookup queries first.
- After the main packet read, the service still runs three more name-resolution reads.

Evidence:

- `lib/services/enrollment-packets-listing.ts:132-166`
- `lib/services/enrollment-packet-list-support.ts:64-157`

Estimated scaling risk:

- Near-term

8. `likely` Low: billing batch and export list reads still fetch wider rows than their list pages likely need

Why it could become slow:

- `getBillingBatches()` and `getBillingExports()` both use `select("*")`.
- That is acceptable while row counts stay modest, but it widens payloads for list pages that mostly need summary fields.

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
- `lib/services/billing-read-supabase.ts:682-691`

Why it matters:

- `getBillingDashboardSummary()` calls both the billing preview and the variable-charge queue.
- Those paths re-read overlapping transportation, ancillary, and adjustment data for similar date windows in the same request.
- This is duplicated database work in one founder-facing dashboard load.

2. `confirmed` Medium: sales partner and referral lookup logic is still duplicated across directory, lookup-loader, and picker paths

Where:

- `lib/services/sales-crm-read-model.ts:386-423`
- `lib/services/sales-crm-read-model.ts:443-490`
- `lib/services/sales-crm-read-model.ts:548-577`

Why it matters:

- Search behavior, ordering, count behavior, and future index assumptions now have to stay aligned across several copies of the same table-query family.

3. `confirmed` Medium: care-plan reads still use both direct table helpers and the paged canonical RPC list

Where:

- Direct table helpers: `lib/services/care-plans-read-model.ts:224-255`, `lib/services/care-plans-read-model.ts:390-414`
- Canonical paged list: `lib/services/care-plans-read-model.ts:339-365`

Why it matters:

- The paged RPC path is safer for scale, but overlapping care-plan concerns still exist in direct table reads.
- That makes future tuning harder because not every care-plan screen uses the same read boundary.

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
- MHP overview, Member Command Center, and health dashboard first-load fan-out
- Completed enrollment-packet reporting over-read

## 8. Performance Hardening Plan

Phase 1: confirm repo fixes are actually live

- Verify that migrations `0209_sales_dashboard_summary_lead_count_slimming.sql` and `0210_query_audit_missing_indexes.sql` are applied in Supabase.
- If those migrations are not deployed, some of the April hardening work only exists on disk.

Phase 2: slim the biggest whole-table and dashboard reads

- Keep one canonical sales dashboard RPC boundary, but stop rebuilding lead state across the full `leads` table on every dashboard request.
- Rework the billing revenue dashboard summary so it does not re-run both the raw preview path and the raw queue path on every page load.

Phase 3: close the remaining index gaps

- Add `audit_logs(created_at desc)`.
- Add alphabetical btree sort indexes for partner and referral directories.
- Add `profiles(full_name)` search support only if enrollment-packet sender search is important enough to justify it.
- Add a standalone export-history sort index only if export-job history is expected to keep growing.

Phase 4: bound the fixed fan-out screens

- Convert completed enrollment-packet reporting to true pagination instead of a large bounded read.
- Defer non-critical sections on MHP overview, Member Command Center, and the health dashboard.
- Review whether billing revenue dashboard summary numbers can come from a narrower summary boundary instead of live raw-table fan-out.

Phase 5: remove exact counts where the UI can tolerate it

- Revisit exact totals in sales directories, lead pipeline pages, and MAR snapshot reads.
- Keep exact counts only where users truly need precise totals on first load.

Phase 6: reduce duplicate read families

- Keep one canonical sales partner/referral lookup boundary.
- Prefer one canonical care-plan list/read boundary where possible.
- Stop reading overlapping billing tables twice inside one dashboard summary request.

## 9. Suggested Codex Prompts

1. `Slim the sales dashboard summary RPC in Memory Lane. Keep one canonical Supabase RPC boundary, but stop rebuilding canonical lead state across the full leads table on every dashboard request. Preserve current founder-facing summary numbers and recent inquiry payload.`

2. `Add a forward-only Supabase migration for the remaining read-side missing indexes from the April 18 query audit: audit_logs(created_at desc), community_partner_organizations(organization_name), referral_sources(organization_name), and if justified profiles(full_name) search support. Validate current query shapes before adding anything low-value.`

3. `Refactor the billing revenue dashboard summary in Memory Lane so one request does not re-read overlapping transportation, ancillary, and billing adjustment tables through both billing preview and variable-charge queue paths. Keep Supabase as source of truth and preserve current founder-facing summary numbers.`

4. `Refactor the completed enrollment-packet reporting list so it stops doing a large bounded read plus pre-search ID fan-out and post-read name lookups on every request. Keep canonical service boundaries and move to a truly paginated Supabase-backed read path.`

5. `Reduce fixed query fan-out on the Member Health Profile overview, Member Command Center detail, and health dashboard. Keep canonical services and resolver paths, but defer non-critical sections instead of loading every cross-domain panel up front.`

6. `Review exact-count pagination in sales and MAR read paths. Identify where count: "exact" is truly required and where deferred totals would preserve workflow behavior while reducing Supabase cost.`

## 10. Founder Summary: What changed since the last run

What improved or became clearer:

- The repo still carries `0210_query_audit_missing_indexes.sql`, and the billing invoice list code now clearly routes draft/finalized/custom invoice pages through one shared loader. If `0210` is deployed, invoice list filtering by source/status should be in a better place than it was earlier this week.
- I did not find a new high-priority regression in MAR, member files, or the member list itself beyond the known issues already on the board.

What is more urgent than it looked yesterday:

- Billing revenue dashboard summary should move up the priority list. It is now clear that one founder-facing load can re-read broad billing datasets twice through separate preview and queue paths.
- The missing `audit_logs(created_at desc)` index is still the clearest audit-log performance gap.
- Sales partner and referral alphabetical list reads are still under-indexed for the exact query shapes now used by directory and picker paths.

What did not materially change:

- The sales dashboard summary RPC is still the single biggest whole-table read risk.
- The completed enrollment-packet report is still not truly paginated.
- MHP overview, Member Command Center, and the health dashboard are still mostly canonical, but they still do too much work on first load.

What to focus on next:

1. Confirm `0209` and `0210` are applied in Supabase.
2. Slim the sales dashboard summary RPC further.
3. Rework the billing revenue dashboard summary to stop duplicating raw billing reads.
4. Add the audit-log and sales-directory sort indexes.
5. Convert the completed enrollment-packet list to true pagination.
