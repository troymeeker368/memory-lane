# Supabase Query Performance Audit

Date: 2026-04-21
Automation: Supabase Query Performance Audit

## 1. Executive Summary

The top performance risks are still concentrated in a small number of high-traffic founder-facing reads:

- `confirmed` High: the sales dashboard summary RPC still rebuilds lead state from the full `leads` table and still runs whole-table counts on related sales tables. Evidence: `supabase/migrations/0209_sales_dashboard_summary_lead_count_slimming.sql:94`, `supabase/migrations/0209_sales_dashboard_summary_lead_count_slimming.sql:267-270`, `lib/services/sales-workflows.ts:145-173`
- `confirmed` High: the billing dashboard still does overlapping raw reads in a single request by combining billing preview, variable-charge queue, and batch list work. Evidence: `lib/services/billing-preview-helpers.ts:199-255`, `lib/services/billing-read-supabase.ts:485-509`, `lib/services/billing-read-supabase.ts:682-690`
- `confirmed` High: the admin audit trail still sorts newest-first from `audit_logs` without a standalone `created_at desc` index. Evidence: `lib/services/admin-audit-trail.ts:80-90`
- `confirmed` Medium: partner and referral directories still mix alphabetical sort, exact counts, and broad search without plain sort indexes for the default list path. Evidence: `lib/services/sales-crm-read-model.ts:392-418`, `lib/services/sales-crm-read-model.ts:449-485`
- `confirmed` Medium: health dashboard, MHP overview, and Member Command Center detail still load a wide first bundle before the user asks for narrower panels. Evidence: `lib/services/health-dashboard.ts:137-157`, `lib/services/member-health-profiles-read.ts:42-55`, `lib/services/member-command-center-runtime.ts:505-536`
- `confirmed` Medium: completed enrollment-packet reporting still uses a large bounded read plus name/search helper queries instead of true pagination. Evidence: `lib/services/enrollment-packet-list-support.ts:64-115`, `lib/services/enrollment-packet-list-support.ts:123-157`, `lib/services/enrollment-packets-listing.ts:129-151`

What improved and stayed intact:

- `confirmed` Member Command Center still uses paged member-file reads instead of loading full file history on initial detail load. Evidence: `lib/services/member-command-center-runtime.ts:260-333`, `lib/services/member-command-center-runtime.ts:505-510`
- `confirmed` Member Command Center still uses `limit(1)` for assessment existence instead of an exact count. Evidence: `lib/services/member-command-center-runtime.ts:531-536`

Important caveat:

- `likely` This was a code-and-migrations audit only. I did not inspect live query plans, `pg_stat_statements`, or confirm which migrations are already applied in the linked Supabase project.

## 2. Missing Indexes

1. `confirmed` `audit_logs(created_at desc)`

Why it matters:

- The default audit trail sorts newest-first without a narrowing predicate first.
- Repo indexes cover `entity_type + created_at` and `actor_user_id + created_at`, but not the plain latest-row path.

Evidence:

- Query: `lib/services/admin-audit-trail.ts:80-90`
- Existing index coverage: `supabase/migrations/0048_query_performance_support_indexes.sql:10-14`
- Migration search on 2026-04-21 did not find `idx_audit_logs_created_at_desc`

2. `confirmed` `community_partner_organizations(organization_name)`

Why it matters:

- Partner directories default to alphabetical sort.
- The repo has trigram support for search, but not a plain btree sort index for the default list path.

Evidence:

- Query: `lib/services/sales-crm-read-model.ts:392-418`
- Existing index coverage: `supabase/migrations/0105_sales_pipeline_summary_rpc_and_search_indexes.sql:123-136`
- Migration search on 2026-04-21 did not find `idx_community_partner_organizations_organization_name`

3. `confirmed` `referral_sources(organization_name)`

Why it matters:

- Referral directories also default to alphabetical sort.
- The repo has trigram search support, but not the plain sort index for the default list path.

Evidence:

- Query: `lib/services/sales-crm-read-model.ts:449-485`
- Existing index coverage: `supabase/migrations/0105_sales_pipeline_summary_rpc_and_search_indexes.sql:139-154`
- Migration search on 2026-04-21 did not find `idx_referral_sources_organization_name`

4. `likely` `profiles(full_name)` search support for enrollment-packet sender lookup

Why it matters:

- Completed enrollment-packet search probes `profiles.full_name` before the main request query runs.
- I found member and sales search indexes, but not `profiles.full_name` support.

Evidence:

- Query: `lib/services/enrollment-packet-list-support.ts:95-113`
- Migration search on 2026-04-21 did not find `idx_profiles_full_name`

5. `likely` `billing_export_jobs(generated_at desc, created_at desc)`

Why it matters:

- Export history sorts globally by newest generated and created timestamps.
- The repo only has a batch-scoped `(billing_batch_id, generated_at desc)` index.

Evidence:

- Query: `lib/services/billing-read-supabase.ts:646-649`
- Existing index: `supabase/migrations/0013_care_plans_and_billing_execution.sql:240-241`
- Migration search on 2026-04-21 did not find a global sort index for this path

## 3. Potential Table Scans

1. `confirmed` High: sales dashboard summary RPC still does full-table aggregation work

Why it could become slow:

- The RPC still rebuilds `canonical_leads` from all rows in `public.leads`.
- It still does separate whole-table counts for `lead_activities`, `community_partner_organizations`, `referral_sources`, and `partner_activities`.

Evidence:

- Runtime caller: `lib/services/sales-workflows.ts:145-173`
- RPC definition: `supabase/migrations/0209_sales_dashboard_summary_lead_count_slimming.sql:94`, `supabase/migrations/0209_sales_dashboard_summary_lead_count_slimming.sql:267-270`

Estimated scaling risk:

- Near-term

2. `confirmed` High: admin audit trail can degrade into a broader newest-first scan

Why it could become slow:

- The default query orders by `created_at desc` without a matching standalone descending index.
- Area filters add `ilike` work on top of that path.

Evidence:

- `lib/services/admin-audit-trail.ts:80-90`

Estimated scaling risk:

- Near-term

3. `confirmed` Medium: partner and referral directory reads can degrade into larger count-and-sort work

Why it could become slow:

- Both list families request `count: "exact"` and sort by `organization_name`.
- Current migrations support trigram search, but not the default sort path.

Evidence:

- `lib/services/sales-crm-read-model.ts:392-418`
- `lib/services/sales-crm-read-model.ts:449-485`

Estimated scaling risk:

- Near-term

4. `likely` Medium: enrollment-packet sender-name search can fall back to broader scans

Why it could become slow:

- Search probes `profiles.full_name` with `ilike` before the main packet query runs.
- I did not find supporting search indexes for that column in repo migrations.

Evidence:

- `lib/services/enrollment-packet-list-support.ts:95-113`

Estimated scaling risk:

- Near-term

5. `likely` Low: billing export history can degrade into a wider global sort scan

Why it could become slow:

- The export list sorts by `generated_at desc` and `created_at desc`.
- The repo index only supports the batch-scoped path.

Evidence:

- `lib/services/billing-read-supabase.ts:646-649`

Estimated scaling risk:

- Long-term

## 4. N+1 Query Patterns

1. `confirmed` Medium: MAR schedule reconciliation still fans out to one reconciliation call per member

Why it could become slow:

- `syncTodayMarSchedules()` first builds the candidate member set, then calls `reconcileMarSchedulesForMember(...)` once per member.
- This is not a page-load N+1, but it is still repeated query work that can spike when many medication changes land together.

Evidence:

- `lib/services/mar-workflow-read.ts:56-65`
- `lib/services/mar-workflow-read.ts:119-136`

Estimated scaling risk:

- Near-term

Residual validation gap:

- I did not inspect live queue depth or runtime execution plans for this background path.

## 5. Inefficient Data Fetching

1. `confirmed` High: billing dashboard summary still has a large fixed read cost per request

Why it could become slow:

- One dashboard request runs billing preview, variable-charge queue, and batch list together.
- Preview and queue both re-read overlapping transportation, ancillary, and billing-adjustment data.

Evidence:

- `lib/services/billing-preview-helpers.ts:199-255`
- `lib/services/billing-read-supabase.ts:485-509`
- `lib/services/billing-read-supabase.ts:682-690`

Estimated scaling risk:

- Near-term

2. `confirmed` Medium: Member Command Center detail still loads a wide cross-domain bundle up front

Why it could become slow:

- The file-history problem improved, but the detail load still fetches profile, schedule, contacts, first file page, allergies, care-plan overview, enrollment-packet intake alert, and assessment existence before the user interacts.

Evidence:

- `lib/services/member-command-center-runtime.ts:505-536`

Estimated scaling risk:

- Near-term

3. `confirmed` Medium: MHP overview still stacks several cross-domain reads on each overview load

Why it could become slow:

- The overview supplement always loads care-plan snapshot, progress-note summary, billing payor, and often physician orders together.
- The summary then adds assessments on top of that bundle.

Evidence:

- `lib/services/member-health-profiles-read.ts:42-55`
- `lib/services/member-health-profiles-read.ts:81-89`

Estimated scaling risk:

- Near-term

4. `confirmed` Medium: health dashboard still pays a wide first-load fan-out

Why it could become slow:

- One request loads MAR snapshot, blood sugar rows, active member count, care plans, incidents, progress notes, two runner-health checks, and care alerts.

Evidence:

- `lib/services/health-dashboard.ts:137-157`

Estimated scaling risk:

- Near-term

5. `confirmed` Medium: MAR workflow still pays for exact counts before loading limited slices

Why it could become slow:

- The main MAR snapshot does exact-count queries against `v_mar_today` and `v_mar_overdue_today` before loading the limited result sets.

Evidence:

- `lib/services/mar-workflow-read.ts:153-178`
- `lib/services/mar-workflow-read.ts:181-186`

Estimated scaling risk:

- Near-term

6. `confirmed` Medium: completed enrollment-packet reporting still over-reads relative to page needs

Why it could become slow:

- The list still defaults to up to 200 rows and can read up to 500.
- Search expands into member, lead, and sender ID lookups first.
- Name resolution still adds follow-up reads after the main query.

Evidence:

- `lib/services/enrollment-packet-list-support.ts:64-115`
- `lib/services/enrollment-packet-list-support.ts:123-157`
- `lib/services/enrollment-packets-listing.ts:132-151`

Estimated scaling risk:

- Near-term

7. `confirmed` Low: billing batch and export list reads still fetch wider rows than the list views likely need

Why it could become slow:

- `getBillingBatches()` and `getBillingExports()` still use `select("*")`.
- This is probably acceptable now, but it widens payloads as those tables grow.

Evidence:

- `lib/services/billing-read-supabase.ts:313-347`
- `lib/services/billing-read-supabase.ts:646-649`

Estimated scaling risk:

- Long-term

## 6. Duplicate Query Logic

1. `confirmed` High: the billing dashboard still reads overlapping billing tables twice on one request

Where:

- `lib/services/billing-preview-helpers.ts:199-255`
- `lib/services/billing-read-supabase.ts:485-509`
- `lib/services/billing-read-supabase.ts:682-690`

Why it matters:

- The dashboard summary still combines the broad preview path and the broad queue path in one load.
- That means the same raw date-window billing facts are re-read for similar founder-facing answers.

2. `confirmed` Medium: sales partner and referral lookup logic is still duplicated across directory and detail flows

Where:

- `lib/services/sales-crm-read-model.ts:392-485`
- `lib/services/partner-detail-read-model.ts:111-168`
- `lib/services/partner-detail-read-model.ts:202-242`

Why it matters:

- Search behavior, sort behavior, limits, and future index assumptions now have to stay aligned across several copies of the same query family.

3. `confirmed` Medium: care-plan reads still use both direct table helpers and the paged canonical RPC list

Where:

- Direct helper: `lib/services/care-plans-read-model.ts:240-255`
- Canonical paged list: `lib/services/care-plans-read-model.ts:339-365`

Why it matters:

- The RPC path is safer for scale on list pages.
- Direct helper reads still exist, so tuning care-plan performance requires more than one query boundary to stay aligned.

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
- Billing dashboard fan-out
- MHP overview, health dashboard, and Member Command Center detail first-load fan-out
- Completed enrollment-packet reporting over-read

## 8. Performance Hardening Plan

Phase 1: verify deployed state

- Confirm the current Supabase project has already applied `0209_sales_dashboard_summary_lead_count_slimming.sql` and `0210_query_audit_missing_indexes.sql`.
- Confirm whether any private migration outside this repo already added the still-missing sort indexes before duplicating work.

Phase 2: fix the biggest founder-facing reads

- Keep one canonical sales dashboard RPC boundary, but stop rebuilding summary state from the full `leads` table on every dashboard load.
- Rework the billing dashboard so it does not run both the broad preview path and the broad variable-charge queue path on one request.

Phase 3: close easy index gaps

- Add `audit_logs(created_at desc)`.
- Add alphabetical sort indexes for partner and referral directories.
- Only add `profiles(full_name)` trigram support if sender-name search is important enough to justify the index.
- Only add the global billing export sort index if export history is expected to keep growing.

Phase 4: bound first-load bundles

- Keep the new paged member-file boundary in Member Command Center.
- Defer non-critical panels on MHP overview, health dashboard, and Member Command Center detail instead of loading every supporting section up front.
- Review whether the billing dashboard can source headline numbers from narrower summary reads instead of raw-table fan-out.

Phase 5: reduce count and payload width where the UI can tolerate it

- Revisit exact counts in MAR snapshots and sales directories.
- Convert completed enrollment-packet reporting from a large bounded read into true pagination.
- Trim `select("*")` usage on billing batch and export list reads if those tables continue growing.

Phase 6: keep one canonical query family per domain

- Keep one canonical billing dashboard summary path.
- Keep one canonical sales partner/referral lookup path.
- Keep tuning pressure on care-plan list reads so performance-sensitive paths stay behind the paged RPC boundary.

## 9. Suggested Codex Prompts

1. `Slim the sales dashboard summary RPC in Memory Lane. Keep one canonical Supabase RPC boundary, but stop rebuilding lead state across the full leads table and stop doing unrelated whole-table counts on every dashboard request. Preserve founder-facing summary numbers and recent inquiry payloads.`

2. `Add a forward-only Supabase migration for the remaining read-side missing indexes from the April 21 query audit: audit_logs(created_at desc), community_partner_organizations(organization_name), referral_sources(organization_name), and if justified profiles(full_name) trigram support. Validate current query shapes before adding low-value indexes.`

3. `Refactor the billing dashboard summary in Memory Lane so one request does not re-read overlapping transportation, ancillary, and billing-adjustment tables through both billing preview and variable-charge queue paths. Keep Supabase as source of truth and preserve founder-facing summary numbers.`

4. `Reduce fixed query fan-out on Member Command Center detail, the Member Health Profile overview, and the health dashboard. Preserve canonical services, keep the new paged member-file behavior, and defer non-critical panels instead of loading every supporting section up front.`

5. `Refactor completed enrollment-packet reporting so it stops doing a large bounded read plus member/lead/profile search fan-out and follow-up name lookups on every request. Keep canonical service boundaries and move to a truly paginated Supabase-backed read path.`

6. `Review exact-count usage in MAR and sales read paths. Identify where count: \"exact\" is truly required and where deferred totals would preserve workflow behavior while lowering Supabase cost.`

7. `Review care-plan read paths in Memory Lane and consolidate performance-sensitive list queries behind the canonical paged RPC boundary where feasible, without breaking member snapshot/detail needs.`

## 10. Founder Summary: What changed since the last run

What materially changed:

- No new top-tier performance regression showed up in the code reviewed today.
- The Member Command Center member-file pagination improvement from the prior run is still present and still wired into both the initial detail load and the follow-up file paging action.

What did not materially change:

- The biggest open risks are still the sales dashboard summary RPC, the billing dashboard fan-out, and the missing `audit_logs(created_at desc)` index.
- Partner and referral alphabetical directories still do not have plain sort indexes.
- Completed enrollment-packet reporting is still bounded-read plus search/name-resolution fan-out instead of real pagination.
- Health dashboard and MHP overview still do broad first-load fan-out.
- I still did not find repo migrations that close the remaining audit-log, partner-sort, or referral-sort index gaps.

What this means in plain English:

- The one concrete improvement from yesterday remains real, so Member Command Center should stay healthier for members with large file histories.
- The highest-cost dashboard reads still need direct hardening work before larger production volume arrives.

What to focus on next:

1. Confirm repo migrations are actually applied in Supabase.
2. Slim the sales dashboard summary RPC further.
3. Rework the billing dashboard summary to stop duplicated raw reads.
4. Add the audit-log and sales-directory sort indexes.
5. Convert completed enrollment-packet reporting to true pagination.
