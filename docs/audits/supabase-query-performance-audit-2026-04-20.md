# Supabase Query Performance Audit

Date: 2026-04-20
Automation: Supabase Query Performance Audit

## 1. Executive Summary

The biggest query-scale risks are still concentrated in a small set of founder-facing reads:

- `confirmed` High: the sales dashboard summary RPC still rebuilds lead state from the full `leads` table and still performs whole-table counts on related sales tables. Evidence: `supabase/migrations/0209_sales_dashboard_summary_lead_count_slimming.sql:41-105`, `supabase/migrations/0209_sales_dashboard_summary_lead_count_slimming.sql:267-270`, `lib/services/sales-workflows.ts:72`
- `confirmed` High: the billing revenue dashboard still runs overlapping broad reads in one request by calling billing preview, variable-charge queue, and batch list together. Evidence: `lib/services/billing-preview-helpers.ts:209-255`, `lib/services/billing-read-supabase.ts:485-509`, `lib/services/billing-read-supabase.ts:687-690`
- `confirmed` High: the admin audit trail still pages newest-first from `audit_logs` without a standalone `created_at desc` index. Evidence: `lib/services/admin-audit-trail.ts:79-82`
- `confirmed` Medium: partner and referral directories still combine alphabetical sorting with `count: "exact"` and broad `ilike` search, but the repo still only carries trigram or partner-scoped support for those shapes. Evidence: `lib/services/sales-crm-read-model.ts:388-390`, `lib/services/sales-crm-read-model.ts:445-447`, `lib/services/partner-detail-read-model.ts:121-124`
- `confirmed` Medium: the health dashboard, MHP overview, and Member Command Center detail still pay a wide first-load query cost before the user interacts with the screen. Evidence: `lib/services/health-dashboard.ts:137-157`, `lib/services/member-health-profiles-read.ts:42-55`, `lib/services/member-command-center-runtime.ts:492-499`
- `confirmed` Medium: completed enrollment-packet reporting still uses a large bounded read plus multiple search/name-resolution reads instead of true pagination. Evidence: `lib/services/enrollment-packet-list-support.ts:95-113`, `lib/services/enrollment-packets-listing.ts:132-151`

Important positive change since the last run:

- `confirmed` Member Command Center no longer loads the full member file history on initial detail load. It now reads a bounded page from `member_files` and exposes `hasNextPage`, which removes the prior unbounded per-member file payload risk. Evidence: `lib/services/member-command-center-runtime.ts:254-323`, `lib/services/member-command-center-runtime.ts:492-499`, `app/(portal)/operations/member-command-center/_actions/files.ts:188-210`
- `confirmed` Member Command Center also replaced one exact `intake_assessments` count with a simple existence check using `limit(1)`. Evidence: `lib/services/member-command-center-runtime.ts:519-523`

Important caveat:

- `likely` This was a code-and-migrations audit only. I did not inspect live PostgreSQL query plans, `pg_stat_statements`, or confirm which migrations are already applied in the linked Supabase project.

## 2. Missing Indexes

1. `confirmed` `audit_logs(created_at desc)`

Why it matters:

- The default admin audit trail path sorts newest-first without a narrowing predicate first.
- Current repo indexes cover `entity_type + created_at`, `actor_user_id + created_at`, and `action + created_at`, but not the plain "latest audit rows" path.

Evidence:

- Query: `lib/services/admin-audit-trail.ts:79-82`
- Existing indexes: `supabase/migrations/0048_query_performance_support_indexes.sql:10-14`, `supabase/migrations/0125_query_performance_followup_indexes.sql:1`

2. `confirmed` `community_partner_organizations(organization_name)`

Why it matters:

- Partner directories sort alphabetically by `organization_name`.
- The repo has trigram search support, but not a plain btree sort index for the default alphabetical list.

Evidence:

- Queries: `lib/services/sales-crm-read-model.ts:388-390`, `lib/services/partner-detail-read-model.ts:111-124`
- Existing indexes: `supabase/migrations/0105_sales_pipeline_summary_rpc_and_search_indexes.sql:123-135`, `supabase/migrations/0124_data_access_optimization_indexes.sql:14-15`

3. `confirmed` `referral_sources(organization_name)`

Why it matters:

- Referral directories also sort alphabetically by `organization_name`.
- The repo has partner-scoped support and trigram search support, but not a plain global alphabetical sort index for the default list.

Evidence:

- Queries: `lib/services/sales-crm-read-model.ts:445-447`, `lib/services/partner-detail-read-model.ts:121-124`
- Existing indexes: `supabase/migrations/0105_sales_pipeline_summary_rpc_and_search_indexes.sql:141-142`, `supabase/migrations/0124_data_access_optimization_indexes.sql:17-18`

4. `likely` `profiles(full_name)` search support for enrollment-packet sender lookup

Why it matters:

- Enrollment-packet search probes `members`, `leads`, and `profiles` before it runs the main packet query.
- I found search support for member names, but not for `profiles.full_name`.

Evidence:

- Query: `lib/services/enrollment-packet-list-support.ts:95-113`
- Migration search in this repo did not find a `profiles(full_name)` btree or trigram index.

5. `likely` `billing_export_jobs(generated_at desc, created_at desc)`

Why it matters:

- Export history sorts newest-first across the full table.
- The repo has a batch-scoped `billing_batch_id + generated_at desc` index, but not the global export-history sort path.

Evidence:

- Query: `lib/services/billing-read-supabase.ts:643-649`
- Existing index: `supabase/migrations/0013_care_plans_and_billing_execution.sql:240`

## 3. Potential Table Scans

1. `confirmed` High: sales dashboard summary RPC still performs whole-table aggregation work

Why it could become slow:

- The RPC still materializes `canonical_leads` from all rows in `public.leads`.
- It still performs separate whole-table counts for `lead_activities`, `community_partner_organizations`, `referral_sources`, and `partner_activities`.

Evidence:

- Runtime caller: `lib/services/sales-workflows.ts:72-181`
- RPC definition: `supabase/migrations/0209_sales_dashboard_summary_lead_count_slimming.sql:41-105`, `supabase/migrations/0209_sales_dashboard_summary_lead_count_slimming.sql:267-270`

Estimated scaling risk:

- Near-term

2. `confirmed` High: admin audit trail can degrade into a broader newest-first scan

Why it could become slow:

- The default path sorts `audit_logs` by `created_at desc` without a matching standalone descending index.
- Area filtering adds `ilike` work on top of that sort.

Evidence:

- `lib/services/admin-audit-trail.ts:79-90`

Estimated scaling risk:

- Near-term

3. `confirmed` Medium: partner and referral directory reads can devolve into larger count-and-sort work

Why it could become slow:

- Both directory loaders request `count: "exact"` and sort by `organization_name`.
- The current index set only partially supports those default query shapes.

Evidence:

- `lib/services/sales-crm-read-model.ts:386-412`
- `lib/services/sales-crm-read-model.ts:443-474`

Estimated scaling risk:

- Near-term

4. `likely` Medium: enrollment-packet sender-name search can fall back to broader scans

Why it could become slow:

- Search probes `profiles.full_name` with `ilike`.
- I did not find supporting search indexes for that column in repo migrations.

Evidence:

- `lib/services/enrollment-packet-list-support.ts:108-113`

Estimated scaling risk:

- Near-term

5. `likely` Low: global billing export history can degrade into a wider sort scan

Why it could become slow:

- The export list sorts by `generated_at desc` and `created_at desc`.
- I did not find a matching global index for that order.

Evidence:

- `lib/services/billing-read-supabase.ts:643-649`

Estimated scaling risk:

- Long-term

## 4. N+1 Query Patterns

1. `confirmed` Medium: MAR schedule reconciliation still fans out to one per-member reconciliation call

Why it could become slow:

- `syncTodayMarSchedules()` builds a member list and then calls `reconcileMarSchedulesForMember(...)` once per member.
- This is not a page-load N+1, but it is still repeated query work that can spike when many medication updates land together.

Evidence:

- `lib/services/mar-workflow-read.ts:58-65`
- `lib/services/mar-workflow-read.ts:124-136`

Estimated scaling risk:

- Near-term

Residual validation gap:

- I did not inspect runtime queue depth or live PostgreSQL execution plans for this path.

## 5. Inefficient Data Fetching

1. `confirmed` High: billing revenue dashboard summary has a large fixed read cost per request

Why it could become slow:

- One dashboard request runs `getBillingGenerationPreview`, `getVariableChargesQueue`, and `getBillingBatches`.
- The preview and queue paths both re-read overlapping transportation, ancillary, and billing-adjustment data.

Evidence:

- `lib/services/billing-preview-helpers.ts:209-255`
- `lib/services/billing-read-supabase.ts:485-509`
- `lib/services/billing-read-supabase.ts:687-690`

Estimated scaling risk:

- Near-term

2. `confirmed` Medium: Member Command Center detail still loads a wide cross-domain bundle up front

Why it could become slow:

- The file-history problem improved, but the screen still loads profile, schedule, contacts, first file page, allergies, care-plan overview, enrollment alert, and assessment existence before the user can interact.

Evidence:

- `lib/services/member-command-center-runtime.ts:492-499`
- `lib/services/member-command-center-runtime.ts:519-523`

Estimated scaling risk:

- Near-term

3. `confirmed` Medium: MHP overview still stacks several cross-domain reads on every overview load

Why it could become slow:

- The overview supplement loads care-plan snapshot, progress-note summary, billing payor, and physician orders together.
- The overview summary then adds assessments on top of that bundle.

Evidence:

- `lib/services/member-health-profiles-read.ts:42-55`
- `lib/services/member-health-profiles-read.ts:81-89`

Estimated scaling risk:

- Near-term

4. `confirmed` Medium: health dashboard first paint still has a wide fixed fan-out

Why it could become slow:

- One request loads MAR snapshot, blood sugar rows, active member count, care plans, incidents, progress notes, two runner-health checks, and care alerts.

Evidence:

- `lib/services/health-dashboard.ts:137-157`

Estimated scaling risk:

- Near-term

5. `confirmed` Medium: MAR workflow still pays for exact counts before loading limited slices

Why it could become slow:

- The main MAR workflow issues exact-count queries for `v_mar_today` and `v_mar_overdue_today` on every snapshot load before loading the capped rows.

Evidence:

- `lib/services/mar-workflow-read.ts:165-178`
- `lib/services/mar-workflow-read.ts:219-222`

Estimated scaling risk:

- Near-term

6. `confirmed` Medium: completed enrollment-packet reporting still over-reads relative to screen needs

Why it could become slow:

- The list still defaults to up to 200 rows and can read up to 500.
- Search expands into three ID lookup queries first.
- After the main query, the service still runs follow-up name-resolution reads.

Evidence:

- `lib/services/enrollment-packet-list-support.ts:95-113`
- `lib/services/enrollment-packet-list-support.ts:149-157`
- `lib/services/enrollment-packets-listing.ts:132-151`

Estimated scaling risk:

- Near-term

7. `likely` Low: billing batch and export list reads still fetch wider rows than their list pages likely need

Why it could become slow:

- `getBillingBatches()` and `getBillingExports()` still use `select("*")`.
- This is probably acceptable now, but it widens payloads as those tables grow.

Evidence:

- `lib/services/billing-read-supabase.ts:314-317`
- `lib/services/billing-read-supabase.ts:646-649`

Estimated scaling risk:

- Long-term

## 6. Duplicate Query Logic

1. `confirmed` High: the billing revenue dashboard still reads overlapping raw billing tables twice on one request

Where:

- `lib/services/billing-preview-helpers.ts:238-255`
- `lib/services/billing-read-supabase.ts:495-509`
- `lib/services/billing-read-supabase.ts:687-690`

Why it matters:

- `getBillingDashboardSummary()` calls both the broad preview path and the broad variable-charge queue path.
- Those paths re-read overlapping transportation, ancillary, and adjustment data for similar date windows in the same request.

2. `confirmed` Medium: sales partner and referral lookup logic is still duplicated across directory and detail flows

Where:

- `lib/services/sales-crm-read-model.ts:386-474`
- `lib/services/partner-detail-read-model.ts:111-124`
- `lib/services/partner-detail-read-model.ts:205-274`

Why it matters:

- Search behavior, sort behavior, and future index assumptions now have to stay aligned across several copies of the same query family.

3. `confirmed` Medium: care-plan reads still use both direct table helpers and the paged canonical RPC list

Where:

- Direct helper: `lib/services/care-plans-read-model.ts:241-255`
- Canonical paged list: `lib/services/care-plans-read-model.ts:339-365`

Why it matters:

- The paged RPC path is safer for scale on list pages.
- Direct helper reads still exist for member snapshots and detail composition, which makes future tuning harder because not every care-plan read goes through one boundary.

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
- Billing revenue dashboard fan-out
- MHP overview, Member Command Center detail, and health dashboard first-load fan-out
- Completed enrollment-packet reporting over-read

## 8. Performance Hardening Plan

Phase 1: confirm repo fixes are actually live

- Verify that migrations `0209_sales_dashboard_summary_lead_count_slimming.sql` and `0210_query_audit_missing_indexes.sql` are applied in Supabase.
- If they are not deployed, earlier hardening work only exists on disk.

Phase 2: fix the highest-cost founder-facing reads

- Keep one canonical sales dashboard RPC boundary, but stop rebuilding summary state from the full `leads` table on every dashboard request.
- Rework the billing revenue dashboard so it does not run both the broad preview path and the broad queue path on the same load.

Phase 3: close the remaining easy index gaps

- Add `audit_logs(created_at desc)`.
- Add alphabetical btree indexes for partner and referral directories.
- Add `profiles(full_name)` search support only if sender-name search matters enough to justify the index.
- Add a global export-history sort index only if export history is expected to keep growing.

Phase 4: bound fixed fan-out screens

- Keep the new Member Command Center file pagination boundary and do not reintroduce full-history file loads.
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

2. `Add a forward-only Supabase migration for the remaining read-side missing indexes from the April 20 query audit: audit_logs(created_at desc), community_partner_organizations(organization_name), referral_sources(organization_name), and if justified profiles(full_name) trigram search support. Validate current query shapes before adding low-value indexes.`

3. `Refactor the billing revenue dashboard summary in Memory Lane so one request does not re-read overlapping transportation, ancillary, and billing adjustment tables through both billing preview and variable-charge queue paths. Keep Supabase as source of truth and preserve founder-facing summary numbers.`

4. `Reduce fixed query fan-out on the Member Health Profile overview, Member Command Center detail, and health dashboard. Keep canonical services and resolver paths, preserve the new paged member-file behavior, and defer non-critical panels instead of loading every cross-domain section up front.`

5. `Refactor the completed enrollment-packet reporting list so it stops doing a large bounded read plus pre-search ID fan-out and post-read name lookups on every request. Keep canonical service boundaries and move to a truly paginated Supabase-backed read path.`

6. `Review exact-count usage in sales and MAR read paths. Identify where count: "exact" is truly required and where deferred totals would preserve workflow behavior while reducing Supabase cost.`

7. `Review care-plan read paths in Memory Lane and consolidate performance-sensitive list queries behind the canonical paged RPC boundary where feasible, without breaking member snapshot/detail needs.`

## 10. Founder Summary: What changed since the last run

What improved:

- Member Command Center file history is no longer an unbounded initial load. The current in-progress code now reads a bounded page from `member_files`, returns `hasNextPage`, and uses that on the detail screen.
- Member Command Center also stopped doing one exact `intake_assessments` count and now only checks whether at least one assessment exists.

What did not materially change:

- The top three risks are still the sales dashboard summary RPC, the billing revenue dashboard fan-out, and the missing `audit_logs(created_at desc)` index.
- Partner/referral alphabetical directory reads still lack plain sort indexes.
- Completed enrollment-packet reporting is still bounded-read plus search fan-out instead of real pagination.
- Health dashboard and MHP overview still do broad first-load fan-out.

What this means in plain English:

- One medium-risk payload problem got better: Member Command Center should scale better for members with large file histories.
- The highest-cost dashboard reads are still the same ones that were most likely to get slow as real production volume grows.

What to focus on next:

1. Confirm `0209` and `0210` are applied in Supabase.
2. Slim the sales dashboard summary RPC further.
3. Rework the billing dashboard summary to stop duplicated raw reads.
4. Add the audit-log and sales-directory sort indexes.
5. Convert completed enrollment-packet reporting to true pagination.
6. Reduce fixed first-load fan-out on health, MHP, and Member Command Center detail.
