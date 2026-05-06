# Supabase Query Performance Audit

Date: 2026-04-22
Automation: Supabase Query Performance Audit

## 1. Executive Summary

The highest-cost read risks are still concentrated in the same founder-facing dashboard and reporting paths:

- `confirmed` High: the sales dashboard summary RPC still rebuilds lead state from the full `leads` table and still performs separate whole-table counts on related sales tables. Evidence: `supabase/migrations/0209_sales_dashboard_summary_lead_count_slimming.sql:94`, `supabase/migrations/0209_sales_dashboard_summary_lead_count_slimming.sql:267-270`, `lib/services/sales-workflows.ts:155-163`
- `confirmed` High: the billing dashboard still combines a wide billing preview read with a second wide variable-charge queue read inside the same request. Evidence: `lib/services/billing-preview-helpers.ts:186-256`, `lib/services/billing-read-supabase.ts:485-547`, `lib/services/billing-read-supabase.ts:687-690`
- `confirmed` High: the admin audit trail still sorts newest-first from `audit_logs` without a standalone `created_at desc` index. Evidence: `lib/services/admin-audit-trail.ts:80-90`, `supabase/migrations/0048_query_performance_support_indexes.sql:10-14`
- `confirmed` Medium: partner and referral directory reads still mix alphabetical sort, exact counts, and broad search without plain sort indexes for the default list path. Evidence: `lib/services/sales-crm-read-model.ts:394-422`, `lib/services/sales-crm-read-model.ts:451-489`, `supabase/migrations/0105_sales_pipeline_summary_rpc_and_search_indexes.sql:123-154`
- `confirmed` Medium: Member Command Center detail, MHP overview, and the health dashboard still load broad cross-domain bundles before the user asks for narrower panels. Evidence: `lib/services/member-command-center-runtime.ts:505-536`, `lib/services/member-health-profiles-read.ts:42-55`, `lib/services/member-health-profiles-read.ts:81-89`, `lib/services/health-dashboard.ts:137-157`
- `confirmed` Medium: completed enrollment-packet reporting still uses search fan-out plus follow-up name lookups instead of true pagination. Evidence: `lib/services/enrollment-packet-list-support.ts:95-118`, `lib/services/enrollment-packet-list-support.ts:123-157`, `lib/services/enrollment-packets-listing.ts:146-174`

What changed in current code:

- `confirmed` Medium improvement: single-record sales partner and referral lookups are now more canonical. Lead detail and partner/referral detail reuse shared helpers from `sales-crm-read-model` instead of each module reissuing their own partner/referral base queries. Evidence: `lib/services/sales-crm-read-model.ts:546-575`, `lib/services/lead-detail-read-model.ts:235-249`, `lib/services/partner-detail-read-model.ts:106-113`, `lib/services/partner-detail-read-model.ts:185-195`
- `confirmed` Medium regression: `getBillingModuleIndex()` now triggers a second `billing_batches` read even though `getBillingDashboardSummary()` already loads batches. Evidence: `lib/services/billing-read-supabase.ts:687-690`, `lib/services/billing-read-supabase.ts:726-733`
- `confirmed` Member Command Center still keeps the earlier member-file pagination hardening and still uses `limit(1)` instead of exact assessment counts. Evidence: `lib/services/member-command-center-runtime.ts:279-315`, `lib/services/member-command-center-runtime.ts:505-536`

Important caveat:

- `likely` This was a code-and-migrations audit only. I did not inspect live query plans, `pg_stat_statements`, or confirm which migrations are already applied in the linked Supabase project.

## 2. Missing Indexes

1. `confirmed` `audit_logs(created_at desc)`

Why it matters:

- The default audit-trail read orders by `created_at desc` before any narrowing predicate.
- Existing repo indexes support `entity_type + created_at` and `actor_user_id + created_at`, but not the plain latest-row path.

Evidence:

- Query: `lib/services/admin-audit-trail.ts:80-90`
- Existing index coverage: `supabase/migrations/0048_query_performance_support_indexes.sql:10-14`
- Repo search on 2026-04-22 did not find `idx_audit_logs_created_at_desc`

2. `confirmed` `community_partner_organizations(organization_name)`

Why it matters:

- Partner directories default to alphabetical sort.
- The repo has trigram search support, but not a plain btree sort index for the default directory path.

Evidence:

- Query: `lib/services/sales-crm-read-model.ts:394-422`
- Existing index coverage: `supabase/migrations/0105_sales_pipeline_summary_rpc_and_search_indexes.sql:123-136`
- Repo search on 2026-04-22 did not find `idx_community_partner_organizations_organization_name`

3. `confirmed` `referral_sources(organization_name)`

Why it matters:

- Referral directories also default to alphabetical sort.
- The repo has trigram search support, but not the plain sort index for the default directory path.

Evidence:

- Query: `lib/services/sales-crm-read-model.ts:451-489`
- Existing index coverage: `supabase/migrations/0105_sales_pipeline_summary_rpc_and_search_indexes.sql:138-154`
- Repo search on 2026-04-22 did not find `idx_referral_sources_organization_name`

4. `likely` `profiles(full_name)` search support for enrollment-packet sender lookup

Why it matters:

- Completed enrollment-packet search probes `profiles.full_name` with `ilike` before the main request query runs.
- I did not find repo search-index support for that column.

Evidence:

- Query: `lib/services/enrollment-packet-list-support.ts:70-74`, `lib/services/enrollment-packet-list-support.ts:108-113`
- Repo search on 2026-04-22 did not find `idx_profiles_full_name`

5. `likely` `billing_export_jobs(generated_at desc, created_at desc)`

Why it matters:

- Export history sorts globally by newest generated and created timestamps.
- The repo only has a batch-scoped `(billing_batch_id, generated_at desc)` index.

Evidence:

- Query: `lib/services/billing-read-supabase.ts:643-659`
- Existing index: `supabase/migrations/0013_care_plans_and_billing_execution.sql:240`, `supabase/migrations/0015_schema_compatibility_backfill.sql:428`
- Repo search on 2026-04-22 did not find a global sort index for this path

## 3. Potential Table Scans

1. `confirmed` High: sales dashboard summary RPC still does full-table aggregation work

Why it could become slow:

- The RPC still rebuilds `canonical_leads` from all rows in `public.leads`.
- It still does separate whole-table counts for `lead_activities`, `community_partner_organizations`, `referral_sources`, and `partner_activities`.

Evidence:

- Runtime caller: `lib/services/sales-workflows.ts:155-163`
- RPC definition: `supabase/migrations/0209_sales_dashboard_summary_lead_count_slimming.sql:94`, `supabase/migrations/0209_sales_dashboard_summary_lead_count_slimming.sql:267-270`

Estimated scaling risk:

- Near-term

2. `confirmed` High: admin audit trail can degrade into a broad newest-first scan

Why it could become slow:

- The default query orders by `created_at desc` without a matching standalone descending index.
- Area filters add `ilike` work on top of that same path.

Evidence:

- `lib/services/admin-audit-trail.ts:80-90`

Estimated scaling risk:

- Near-term

3. `confirmed` Medium: partner and referral directory reads can degrade into larger count-and-sort work

Why it could become slow:

- Both list families request `count: "exact"` and sort by `organization_name`.
- Current migrations support trigram search, but not the default sort path.

Evidence:

- `lib/services/sales-crm-read-model.ts:394-422`
- `lib/services/sales-crm-read-model.ts:451-489`

Estimated scaling risk:

- Near-term

4. `likely` Medium: enrollment-packet sender-name search can fall back to broader scans

Why it could become slow:

- Search probes `profiles.full_name` with `ilike` before the main packet query runs.
- I did not find supporting repo indexes for that column.

Evidence:

- `lib/services/enrollment-packet-list-support.ts:70-74`

Estimated scaling risk:

- Near-term

5. `likely` Low: billing export history can degrade into a wider global sort scan

Why it could become slow:

- The export list sorts by `generated_at desc` and `created_at desc`.
- The repo index only supports the batch-scoped path.

Evidence:

- `lib/services/billing-read-supabase.ts:643-659`

Estimated scaling risk:

- Long-term

## 4. N+1 Query Patterns

1. `confirmed` Medium: MAR schedule reconciliation still fans out to one reconciliation call per member

Why it could become slow:

- `syncTodayMarSchedules()` first scans candidate medications and schedules, then calls `reconcileMarSchedulesForMember(...)` once per member needing refresh.
- This is not a page-load N+1, but it is repeated per-member query work that can spike when many medication changes land together.

Evidence:

- `lib/services/mar-workflow-read.ts:65-83`
- `lib/services/mar-workflow-read.ts:115-136`

Estimated scaling risk:

- Near-term

Residual validation gap:

- I did not inspect live queue depth or runtime execution plans for this background path.

## 5. Inefficient Data Fetching

1. `confirmed` High: billing dashboard summary still has a large fixed read cost per request

Why it could become slow:

- One dashboard request runs billing preview, variable-charge queue, and batch list together.
- Preview and queue both re-read overlapping transportation, ancillary, billing-adjustment, and member data.

Evidence:

- `lib/services/billing-preview-helpers.ts:186-256`
- `lib/services/billing-read-supabase.ts:485-547`
- `lib/services/billing-read-supabase.ts:687-690`

Estimated scaling risk:

- Near-term

2. `confirmed` Medium: billing module index now pays an extra `billing_batches` read

Why it could become slow:

- `getBillingModuleIndex()` loads `getBillingDashboardSummary()` and `getBillingBatches()` in parallel.
- But `getBillingDashboardSummary()` already loads `getBillingBatches()`, so the module index now fetches the same batch list twice.

Evidence:

- `lib/services/billing-read-supabase.ts:687-690`
- `lib/services/billing-read-supabase.ts:726-733`

Estimated scaling risk:

- Near-term

3. `confirmed` Medium: Member Command Center detail still loads a wide cross-domain bundle up front

Why it could become slow:

- The file-history problem remains better bounded, but the detail load still fetches profile, schedule, contacts, first file page, allergies, care-plan overview, enrollment-packet intake alert, and assessment existence before the user interacts.

Evidence:

- `lib/services/member-command-center-runtime.ts:505-536`

Estimated scaling risk:

- Near-term

4. `confirmed` Medium: MHP overview still stacks several cross-domain reads on every overview load

Why it could become slow:

- The overview supplement always loads care-plan snapshot, progress-note summary, billing payor, and often physician orders together.
- The summary then adds assessments on top of that first bundle.

Evidence:

- `lib/services/member-health-profiles-read.ts:42-55`
- `lib/services/member-health-profiles-read.ts:81-89`

Estimated scaling risk:

- Near-term

5. `confirmed` Medium: health dashboard still pays a wide first-load fan-out

Why it could become slow:

- One request loads MAR snapshot, blood-sugar rows, active-member count, care plans, incidents, progress notes, two runner-health checks, and care alerts.

Evidence:

- `lib/services/health-dashboard.ts:137-157`

Estimated scaling risk:

- Near-term

6. `confirmed` Medium: MAR workflow still pays for exact counts before loading limited slices

Why it could become slow:

- The main MAR snapshot still does exact-count queries against `v_mar_today` and `v_mar_overdue_today` before loading the limited result sets.

Evidence:

- `lib/services/mar-workflow-read.ts:165-189`

Estimated scaling risk:

- Near-term

7. `confirmed` Medium: completed enrollment-packet reporting still over-reads relative to page needs

Why it could become slow:

- The completed list still uses a bounded `limit` instead of real page/range pagination.
- Search expands into member, lead, and sender ID lookups first.
- Name resolution still adds follow-up member, lead, and profile lookups after the main query.

Evidence:

- `lib/services/enrollment-packet-list-support.ts:95-118`
- `lib/services/enrollment-packet-list-support.ts:123-157`
- `lib/services/enrollment-packets-listing.ts:146-174`

Estimated scaling risk:

- Near-term

8. `confirmed` Low: billing batch, invoice, and export list reads still fetch wider rows than the list views likely need

Why it could become slow:

- `getBillingBatches()`, `getBillingBatchInvoices()`, and `getBillingExports()` still use `select("*")`.
- That is acceptable at small scale, but it widens payloads as those tables grow.

Evidence:

- `lib/services/billing-read-supabase.ts:314-347`
- `lib/services/billing-read-supabase.ts:417-436`
- `lib/services/billing-read-supabase.ts:643-659`

Estimated scaling risk:

- Long-term

## 6. Duplicate Query Logic

1. `confirmed` High: the billing dashboard still reads overlapping billing tables twice on one request

Where:

- `lib/services/billing-preview-helpers.ts:186-256`
- `lib/services/billing-read-supabase.ts:485-547`
- `lib/services/billing-read-supabase.ts:687-690`

Why it matters:

- The dashboard summary still combines the broad preview path and the broad variable-charge queue path in one load.
- That means the same raw month-window billing facts are re-read for related founder-facing answers.

2. `confirmed` Medium: the billing module index now duplicates the batch-list read

Where:

- `lib/services/billing-read-supabase.ts:687-690`
- `lib/services/billing-read-supabase.ts:726-733`

Why it matters:

- This is a smaller issue than the preview-plus-queue duplication, but it is new in current code.
- Every billing module index load now asks Supabase for the same batch list twice.

3. `confirmed` Medium improvement: single-record sales partner/referral lookup duplication is lower than yesterday, but the full query family is still not fully unified

Where:

- Shared helpers: `lib/services/sales-crm-read-model.ts:546-575`
- Lead detail reuse: `lib/services/lead-detail-read-model.ts:235-249`
- Partner/referral detail reuse: `lib/services/partner-detail-read-model.ts:106-113`, `lib/services/partner-detail-read-model.ts:185-195`
- Remaining detail-specific lead/activity windows: `lib/services/partner-detail-read-model.ts:119-167`, `lib/services/partner-detail-read-model.ts:197-260`

Why it matters:

- This run did show a real improvement: the base partner/referral lookup is more canonical now.
- But list pages and detail pages still keep separate lead/activity window queries, so future tuning still has more than one sales read boundary to keep aligned.

4. `confirmed` Medium: care-plan reads still use both direct table helpers and the paged canonical RPC list

Where:

- Direct helper: `lib/services/care-plans-read-model.ts:240-255`
- Canonical paged list: `lib/services/care-plans-read-model.ts:339-347`

Why it matters:

- The RPC path is safer for scale on list pages.
- Direct helper reads still exist, so care-plan tuning still has more than one query boundary to preserve.

## 7. Recommended Index Additions

Add these first:

1. `create index if not exists idx_audit_logs_created_at_desc on public.audit_logs (created_at desc);`
2. `create index if not exists idx_community_partner_organizations_organization_name on public.community_partner_organizations (organization_name);`
3. `create index if not exists idx_referral_sources_organization_name on public.referral_sources (organization_name);`

Validate before adding:

4. `create index if not exists idx_profiles_full_name_trgm on public.profiles using gin (full_name gin_trgm_ops);`
5. `create index if not exists idx_billing_export_jobs_generated_created_desc on public.billing_export_jobs (generated_at desc, created_at desc);`

Do not expect indexes alone to fix these:

- Sales dashboard summary RPC full-table aggregation
- Billing dashboard preview plus queue fan-out
- Billing module index duplicate batch read
- Member Command Center detail, MHP overview, and health dashboard first-load breadth
- Completed enrollment-packet reporting over-read

## 8. Performance Hardening Plan

Phase 1: verify deployed state

- Confirm the linked Supabase project has actually applied the repo migrations that already claim to harden read performance.
- Confirm no private migration outside this repo already added the still-missing audit-log or sales-directory sort indexes.

Phase 2: fix the biggest founder-facing reads

- Keep one canonical sales dashboard RPC boundary, but stop rebuilding summary state from the full `leads` table and stop doing unrelated whole-table counts on every dashboard request.
- Rework the billing dashboard so it does not run both the broad preview path and the broad variable-charge queue path inside one summary request.
- Remove the extra `getBillingBatches()` call from `getBillingModuleIndex()` by reusing the batch data already loaded for the dashboard summary or by moving batch loading into one canonical summary object.

Phase 3: close easy index gaps

- Add `audit_logs(created_at desc)`.
- Add alphabetical sort indexes for partner and referral directories.
- Only add `profiles(full_name)` trigram support if sender-name search matters enough to justify the index cost.
- Only add the global billing export sort index if export history is expected to keep growing.

Phase 4: bound first-load bundles

- Keep the paged member-file boundary in Member Command Center.
- Defer non-critical panels on MHP overview, health dashboard, and Member Command Center detail instead of loading every supporting section up front.
- Revisit whether billing headline numbers can come from narrower summary reads instead of raw-table fan-out.

Phase 5: reduce count and payload width where the UI can tolerate it

- Revisit exact counts in MAR snapshots and sales directories.
- Convert completed enrollment-packet reporting from a bounded read into true pagination.
- Trim `select("*")` usage on billing batches, invoices, and export lists if those tables continue growing.

Phase 6: keep one canonical query family per domain

- Finish consolidating sales partner/referral read logic so tuning does not have to be duplicated between list and detail flows.
- Keep one canonical billing dashboard summary path.
- Keep performance-sensitive care-plan list reads behind the paged RPC boundary where feasible.

## 9. Suggested Codex Prompts

1. `Slim the sales dashboard summary RPC in Memory Lane. Keep one canonical Supabase RPC boundary, but stop rebuilding lead state across the full leads table and stop doing unrelated whole-table counts on every dashboard request. Preserve founder-facing summary numbers and recent inquiry payloads.`

2. `Add a forward-only Supabase migration for the remaining read-side missing indexes from the April 22 query audit: audit_logs(created_at desc), community_partner_organizations(organization_name), referral_sources(organization_name), and if justified profiles(full_name) trigram support. Validate current query shapes before adding low-value indexes.`

3. `Refactor the billing dashboard summary in Memory Lane so one request does not re-read overlapping transportation, ancillary, and billing-adjustment tables through both billing preview and variable-charge queue paths. Keep Supabase as source of truth and preserve founder-facing summary numbers.`

4. `Remove duplicate billing batch reads from the Memory Lane billing module index. Today getBillingModuleIndex() loads getBillingDashboardSummary() and getBillingBatches() even though the dashboard summary already fetches batches. Keep one canonical read path and preserve existing billing index behavior.`

5. `Reduce fixed query fan-out on Member Command Center detail, the Member Health Profile overview, and the health dashboard. Preserve canonical services, keep paged member-file behavior, and defer non-critical panels instead of loading every supporting section up front.`

6. `Refactor completed enrollment-packet reporting so it stops doing search fan-out plus follow-up name lookups on every request and moves to a truly paginated Supabase-backed read path. Keep canonical service boundaries and preserve current founder-facing filters.`

7. `Review exact-count usage in MAR and sales read paths. Identify where count: "exact" is truly required and where deferred totals would preserve workflow behavior while lowering Supabase cost.`

8. `Finish consolidating Memory Lane sales partner and referral read logic so list and detail views share one canonical query family for base entity lookups and supporting activity windows, without changing current founder-facing behavior.`

9. `Review billing batch, invoice, and export list reads in Memory Lane and replace unnecessary select("*") usage with narrow list-select projections where the UI does not need the full row payload.`

## 10. Founder Summary: What changed since the last run

What materially changed:

- No new top-tier query regression showed up in the code reviewed today.
- Sales partner/referral detail lookups are somewhat cleaner than yesterday. The code now routes single-record partner and referral lookups through shared helpers in `sales-crm-read-model` instead of duplicating those base queries in each detail module.
- I found one new concrete inefficiency in current code: the billing module index now reads `billing_batches` twice because `getBillingDashboardSummary()` already loads batches and `getBillingModuleIndex()` loads them again.
- Member Command Center still keeps the healthier file-page boundary and still avoids exact assessment counts on initial load.

What did not materially change:

- The biggest open risks are still the sales dashboard summary RPC, the billing dashboard fan-out, and the missing `audit_logs(created_at desc)` index.
- Partner and referral alphabetical directories still do not have plain sort indexes.
- Completed enrollment-packet reporting is still bounded-read plus search/name-resolution fan-out instead of real pagination.
- Health dashboard and MHP overview still do broad first-load fan-out.

What this means in plain English:

- Yesterday's main improvement did not regress, and today's sales refactor did remove some duplicate base lookup logic.
- But the expensive dashboard and reporting reads still need direct hardening before higher production volume arrives.
- The new extra batch read in billing is not the biggest problem in the repo, but it is worth fixing because it is a clean, low-risk win.

What to focus on next:

1. Confirm the repo's performance migrations are actually applied in Supabase.
2. Slim the sales dashboard summary RPC further.
3. Rework the billing dashboard summary so it stops duplicated raw reads.
4. Remove the duplicate billing batch read in the billing module index.
5. Add the audit-log and sales-directory sort indexes.
6. Convert completed enrollment-packet reporting to true pagination.
