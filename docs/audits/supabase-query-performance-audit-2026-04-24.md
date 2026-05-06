# Supabase Query Performance Audit

Date: 2026-04-24
Automation: Supabase Query Performance Audit

## 1. Executive Summary

The biggest Supabase read risks are still concentrated in the same founder-facing dashboard, directory, and cross-domain detail paths:

- `confirmed` High: the sales dashboard summary RPC still rebuilds lead state from the full `leads` table and still runs separate global counts against `lead_activities`, `community_partner_organizations`, `referral_sources`, and `partner_activities`. Evidence: `supabase/migrations/0209_sales_dashboard_summary_lead_count_slimming.sql:28-279`, `lib/services/sales-workflows.ts:155-163`
- `confirmed` High: the billing dashboard summary still combines a broad generation preview read, a broad variable-charge queue read, and a batch list read inside one request. Evidence: `lib/services/billing-read-supabase.ts:487-547`, `lib/services/billing-read-supabase.ts:687-733`
- `confirmed` High: the admin audit trail still sorts newest-first from `audit_logs` without a standalone `created_at desc` index. Evidence: `lib/services/admin-audit-trail.ts:79-90`
- `confirmed` Medium: partner and referral directories still mix alphabetical sort with `count: "exact"` on every page load without plain sort indexes for `organization_name`. Evidence: `lib/services/sales-crm-read-model.ts:392-489`
- `confirmed` Medium: Member Command Center, MHP overview/detail, MAR snapshot, health dashboard, and completed enrollment-packet reporting still do broad multi-query reads before the user narrows scope. Evidence: `lib/services/member-command-center-runtime.ts:505-554`, `lib/services/member-health-profiles-read.ts:42-58`, `lib/services/member-health-profiles-supabase.ts:570-595`, `lib/services/mar-workflow-read.ts:165-189`, `lib/services/health-dashboard.ts:126-158`, `lib/services/enrollment-packets-listing.ts:145-184`, `lib/services/enrollment-packet-list-support.ts:85-157`

What improved in current code:

- `confirmed` Medium improvement: sales partner/referral detail lookups now reuse shared helper reads from `sales-crm-read-model` instead of duplicating base fetches inside both lead and partner detail modules. Evidence: `lib/services/sales-crm-read-model.ts:546-575`, `lib/services/lead-detail-read-model.ts`, `lib/services/partner-detail-read-model.ts`
- `confirmed` Medium improvement: Member Command Center now reads member files as a bounded page and only checks legacy inline payloads for the visible rows, instead of loading the full file list. It also replaced an exact intake-assessment count with a `limit(1)` existence check. Evidence: `lib/services/member-command-center-runtime.ts:257-346`, `lib/services/member-command-center-runtime.ts:505-546`
- `confirmed` Low improvement: MHP overview now caps care-plan snapshot rows at 25 instead of pulling the full member care-plan set for the overview supplement. Evidence: `lib/services/member-health-profiles-read.ts:42-58`, `lib/services/care-plans-read-model.ts:241-260`, `lib/services/care-plans-read-model.ts:344-352`

Important caveat:

- `likely` This was a code-and-migrations audit only. I did not inspect live query plans, `pg_stat_statements`, or confirm which repo migrations are already applied in the linked Supabase project.

## 2. Missing Indexes

1. `confirmed` `audit_logs(created_at desc)`

Why it matters:

- The default admin audit-trail query is a plain newest-first read on `audit_logs`.
- The repo has composite indexes for `entity_type + created_at` and `actor_user_id + created_at`, but not the plain global recent-events path.

Evidence:

- Query: `lib/services/admin-audit-trail.ts:79-90`
- Existing repo indexes: `supabase/migrations/0048_query_performance_support_indexes.sql:10-14`
- Repo search on 2026-04-24 did not find `idx_audit_logs_created_at_desc`

2. `confirmed` `community_partner_organizations(organization_name)`

Why it matters:

- The partner directory sorts alphabetically and also asks Supabase for exact counts.
- The repo has trigram search support, but not a plain btree index for the default alphabetical list path.

Evidence:

- Query: `lib/services/sales-crm-read-model.ts:392-422`
- Existing repo indexes: `supabase/migrations/0105_sales_pipeline_summary_rpc_and_search_indexes.sql:123-136`
- Repo search on 2026-04-24 did not find `idx_community_partner_organizations_organization_name`

3. `confirmed` `referral_sources(organization_name)`

Why it matters:

- The referral directory has the same alphabetical-sort plus exact-count pattern as partner directories.
- The repo has trigram search support, but not the plain sort index.

Evidence:

- Query: `lib/services/sales-crm-read-model.ts:449-489`
- Existing repo indexes: `supabase/migrations/0105_sales_pipeline_summary_rpc_and_search_indexes.sql:138-154`
- Repo search on 2026-04-24 did not find `idx_referral_sources_organization_name`

4. `likely` `profiles(full_name)` search support for completed enrollment-packet search

Why it matters:

- Completed enrollment-packet search probes `profiles.full_name` with `ilike` before the main request query runs.
- I did not find repo search-index support for `profiles.full_name`.

Evidence:

- Query: `lib/services/enrollment-packet-list-support.ts:95-113`
- Repo search on 2026-04-24 did not find `idx_profiles_full_name`

5. `likely` `billing_export_jobs(generated_at desc, created_at desc)`

Why it matters:

- Export history sorts globally by newest `generated_at` and `created_at`.
- I did not find a global descending sort index for that list path.

Evidence:

- Query: `lib/services/billing-read-supabase.ts:643-659`
- Repo search on 2026-04-24 did not find `idx_billing_export_jobs_generated_created_desc`

## 3. Potential Table Scans

1. `confirmed` High: sales dashboard summary RPC still does full-table aggregation work

Why it could become slow:

- The RPC still normalizes every row from `public.leads` through `canonical_leads` and `resolved_leads`.
- It still does separate whole-table counts on `lead_activities`, `community_partner_organizations`, `referral_sources`, and `partner_activities`.

Evidence:

- RPC definition: `supabase/migrations/0209_sales_dashboard_summary_lead_count_slimming.sql:41-147`, `supabase/migrations/0209_sales_dashboard_summary_lead_count_slimming.sql:258-279`
- Runtime caller: `lib/services/sales-workflows.ts:155-163`

Estimated scaling risk:

- Near-term

2. `confirmed` High: admin audit trail can degrade into a broad newest-first scan

Why it could become slow:

- The default query orders by `created_at desc` without a matching standalone descending index.
- Optional area filtering adds `ilike` conditions on top of that same base path.

Evidence:

- `lib/services/admin-audit-trail.ts:79-90`

Estimated scaling risk:

- Near-term

3. `confirmed` Medium: partner and referral directories can degrade into larger count-and-sort work

Why it could become slow:

- Both directory families request exact counts and alphabetical ordering.
- The repo’s search indexes help `ilike`, but they do not cover the default sort path.

Evidence:

- `lib/services/sales-crm-read-model.ts:392-422`
- `lib/services/sales-crm-read-model.ts:449-489`

Estimated scaling risk:

- Near-term

4. `likely` Medium: completed enrollment-packet sender-name search can fall back to broader scans

Why it could become slow:

- Search probes `profiles.full_name` with `ilike`, then fans those IDs back into the packet request query.
- I did not find supporting repo indexes for that sender-name search path.

Evidence:

- `lib/services/enrollment-packet-list-support.ts:95-113`

Estimated scaling risk:

- Near-term

5. `likely` Low: billing export history can degrade into a wider global sort scan

Why it could become slow:

- The export list sorts globally by `generated_at desc` and `created_at desc`.
- The repo may only be relying on table order or narrower existing indexes.

Evidence:

- `lib/services/billing-read-supabase.ts:643-659`

Estimated scaling risk:

- Long-term

## 4. N+1 Query Patterns

1. `confirmed` Medium: MAR schedule refresh still fans out to one reconciliation call per member

Why it could become slow:

- `syncTodayMarSchedules()` identifies candidate members, then calls `reconcileMarSchedulesForMember(...)` once per member.
- This is not a UI-page N+1, but it is repeated query work inside a high-frequency workflow that can spike when many MHP-sourced medication changes land together.

Evidence:

- Candidate detection: `lib/services/mar-workflow-read.ts:65-123`
- Per-member fan-out: `lib/services/mar-workflow-read.ts:126-136`

Estimated scaling risk:

- Near-term

Residual validation gap:

- I did not inspect live queue depth or runtime execution plans for this background refresh path.

## 5. Inefficient Data Fetching

1. `confirmed` High: billing dashboard summary still has a large fixed read cost per request

Why it could become slow:

- One summary request still loads billing preview, variable-charge queue, and billing batches together.
- Preview and queue both re-read overlapping transportation, ancillary, billing-adjustment, and member data for adjacent founder-facing numbers.

Evidence:

- `lib/services/billing-read-supabase.ts:487-547`
- `lib/services/billing-read-supabase.ts:687-723`

Estimated scaling risk:

- Near-term

2. `confirmed` High: billing module index still re-reads the batch list on the same request

Why it could become slow:

- `getBillingModuleIndex()` calls `getBillingDashboardSummary()` and `getBillingBatches()` in parallel.
- `getBillingDashboardSummary()` already loads `getBillingBatches()`, so the same batch list is fetched twice.

Evidence:

- `lib/services/billing-read-supabase.ts:687-690`
- `lib/services/billing-read-supabase.ts:726-733`

Estimated scaling risk:

- Near-term

3. `confirmed` Medium: Member Command Center detail still loads a broad cross-domain bundle up front

Why it could become slow:

- The file-history path is healthier now, but one detail load still fetches MCC profile, attendance schedule, contacts, first page of files, allergies, care-plan overview, enrollment-packet staging summary, and an intake-assessment existence probe.

Evidence:

- `lib/services/member-command-center-runtime.ts:505-546`

Estimated scaling risk:

- Near-term

4. `confirmed` Medium: MHP overview still stacks several cross-domain reads on every overview load

Why it could become slow:

- The overview supplement still loads care-plan snapshot, progress-note summary, billing payor, and often physician orders together.
- The summary model then loads assessments alongside that bundle.
- The new care-plan row limit helps, but it does not change the number of cross-domain reads.

Evidence:

- `lib/services/member-health-profiles-read.ts:42-58`
- `lib/services/member-health-profiles-read.ts:83-92`

Estimated scaling risk:

- Near-term

5. `confirmed` Medium: MHP detail can still pull many member-scoped tables in one read

Why it could become slow:

- The detail loader can hit `member_health_profiles`, diagnoses, medications, allergies, providers, equipment, notes, assessments, and member-command-center image state in one request.
- That is acceptable for a focused detail view today, but it becomes expensive as each member accumulates more longitudinal rows.

Evidence:

- `lib/services/member-health-profiles-supabase.ts:570-595`

Estimated scaling risk:

- Near-term

6. `confirmed` Medium: MAR snapshot still pays for exact counts before loading the limited slices

Why it could become slow:

- The main MAR snapshot still runs exact-count queries against `v_mar_today` and `v_mar_overdue_today` before loading the limited result sets.
- That means extra whole-view work even when the UI only needs the first page.

Evidence:

- `lib/services/mar-workflow-read.ts:165-189`

Estimated scaling risk:

- Near-term

7. `confirmed` Medium: health dashboard still pays a wide first-load fan-out

Why it could become slow:

- One dashboard request still loads MAR action rows, recent blood sugar logs, active-member count, care plans, incidents, progress notes, two runner-health checks, and care alerts.

Evidence:

- `lib/services/health-dashboard.ts:126-158`

Estimated scaling risk:

- Near-term

8. `confirmed` Medium: completed enrollment-packet reporting still over-reads relative to page needs

Why it could become slow:

- The completed list still uses a capped `limit` instead of true pagination.
- Search fans out into member, lead, and sender name lookups first.
- The result set then does three more lookups to resolve member, lead, and sender names for display.

Evidence:

- `lib/services/enrollment-packets-listing.ts:145-184`
- `lib/services/enrollment-packet-list-support.ts:64-120`
- `lib/services/enrollment-packet-list-support.ts:123-157`

Estimated scaling risk:

- Near-term

9. `confirmed` Low: care-plan direct reads still exist next to the paged canonical RPC list

Why it could become slow:

- `listCarePlanRows()` still does a direct table read ordered by `next_due_date`.
- The list page itself is healthier because it uses `rpc_get_care_plan_list`, but snapshots and direct helpers still keep a second query family alive.

Evidence:

- Direct read helper: `lib/services/care-plans-read-model.ts:241-260`
- Canonical paged list: `lib/services/care-plans-read-model.ts:344-352`

Estimated scaling risk:

- Long-term

10. `confirmed` Low: billing export list still fetches full rows

Why it could become slow:

- `getBillingExports()` still uses `select("*")`.
- That widens payloads as export-job metadata grows.

Evidence:

- `lib/services/billing-read-supabase.ts:643-659`

Estimated scaling risk:

- Long-term

## 6. Duplicate Query Logic

1. `confirmed` High: billing dashboard still reads overlapping billing tables twice on one request

Where:

- `lib/services/billing-read-supabase.ts:487-547`
- `lib/services/billing-read-supabase.ts:687-723`

Why it matters:

- The dashboard combines preview and variable-charge queue reads even though they both answer adjacent billing summary questions from the same month-window facts.

2. `confirmed` High: billing module index still duplicates the batch-list read

Where:

- `lib/services/billing-read-supabase.ts:687-690`
- `lib/services/billing-read-supabase.ts:726-733`

Why it matters:

- This is a clean duplicate: the module index asks for `getBillingBatches()` even though the dashboard summary already asked for it.

3. `confirmed` Medium improvement: sales base partner/referral lookup duplication is lower than the last stored audit

Where:

- Shared helpers: `lib/services/sales-crm-read-model.ts:546-575`
- Lead detail reuse: `lib/services/lead-detail-read-model.ts`
- Partner/referral detail reuse: `lib/services/partner-detail-read-model.ts`

Why it matters:

- Base single-record lookups are more canonical now.
- But list pages, partner/referral detail windows, and dashboard summary logic still remain separate tuning surfaces.

4. `confirmed` Medium: care-plan reads still use both direct table helpers and the paged RPC list

Where:

- Direct helper: `lib/services/care-plans-read-model.ts:241-260`
- Canonical paged list: `lib/services/care-plans-read-model.ts:344-352`

Why it matters:

- The RPC path is the safer place to tune for scale, but direct reads still exist for snapshots and by-id flows.

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
- MAR exact-count reads and per-member schedule reconciliation
- Health dashboard and MHP/MCC first-load breadth
- Completed enrollment-packet pseudo-pagination and name-lookup fan-out

## 8. Performance Hardening Plan

Phase 1: verify deployed state

- Confirm the linked Supabase project has actually applied the repo migrations that already claim to harden list and dashboard reads.
- Confirm no private migration outside this repo already added the still-missing audit-log or sales-directory sort indexes.

Phase 2: fix the highest-cost founder-facing reads

- Keep one canonical sales dashboard RPC boundary, but stop rebuilding summary state from the full `leads` table and stop doing unrelated whole-table counts on every dashboard request.
- Rework the billing dashboard so one summary request does not run both the broad preview path and the broad variable-charge queue path.
- Remove the extra `getBillingBatches()` call from `getBillingModuleIndex()` by reusing the batch data already fetched inside the dashboard summary.

Phase 3: close easy index gaps

- Add `audit_logs(created_at desc)`.
- Add alphabetical sort indexes for partner and referral directories.
- Add `profiles(full_name)` trigram support only if completed enrollment-packet sender-name search is important enough to justify the write cost.
- Add the global billing export sort index only if export history is expected to keep growing.

Phase 4: keep first loads bounded

- Preserve the new paged Member Command Center file read.
- Defer non-critical MHP, MCC, and health-dashboard panels instead of loading every support section up front.
- Revisit whether MHP detail needs all row families on first paint or whether some tabs can stay lazy until opened.

Phase 5: reduce exact counts and over-wide payloads

- Revisit exact counts in MAR and sales directory paths.
- Convert completed enrollment-packet reporting from a bounded read into true page/range pagination.
- Trim `select("*")` on billing exports and other list-only paths where the UI does not need the full row.

Phase 6: keep one canonical query family per domain

- Finish consolidating sales read logic so list/detail tuning is not scattered.
- Keep care-plan list-scale tuning inside the RPC boundary where possible.
- Avoid adding new parallel read families for the same founder-facing dashboard metric.

## 9. Suggested Codex Prompts

1. `Slim the Memory Lane sales dashboard summary RPC. Keep one canonical Supabase RPC boundary, but stop rebuilding lead state across the full leads table and stop doing unrelated whole-table counts on every dashboard request. Preserve founder-facing summary numbers and recent inquiry payloads.`

2. `Add a forward-only Supabase migration for the remaining read-side missing indexes from the April 24 query audit: audit_logs(created_at desc), community_partner_organizations(organization_name), referral_sources(organization_name), and if justified profiles(full_name) trigram support. Validate current query shapes before adding low-value indexes.`

3. `Refactor the Memory Lane billing dashboard summary so one request does not re-read overlapping transportation, ancillary, billing-adjustment, and batch data through both generation preview and variable-charge queue paths. Keep Supabase as source of truth and preserve current dashboard numbers.`

4. `Remove duplicate batch reads from getBillingModuleIndex() in Memory Lane. Today the module index loads getBillingDashboardSummary() and getBillingBatches() even though the summary already fetches batches. Keep one canonical read path and preserve existing billing behavior.`

5. `Reduce fixed query fan-out on Member Command Center detail, MHP overview/detail, and the health dashboard. Keep the new paged member-file behavior, preserve canonical services, and defer non-critical panels instead of loading every supporting section on first render.`

6. `Refactor completed enrollment-packet reporting in Memory Lane so it stops doing search fan-out plus follow-up name lookups on every request and moves to a truly paginated Supabase-backed read path. Keep canonical service boundaries and preserve founder-facing filters.`

7. `Review exact-count usage in MAR and sales directory read paths. Identify where count: "exact" is truly required and where deferred totals or approximate counts would preserve workflow behavior while lowering Supabase cost.`

8. `Consolidate remaining sales read boundaries in Memory Lane so lead detail, partner/referral detail, and directory screens share one canonical query family for base lookups and supporting activity windows without changing current behavior.`

9. `Review billing export list reads in Memory Lane and replace unnecessary select(\"*\") usage with narrow list projections where the UI does not need the full row payload.`

## 10. Founder Summary: What changed since the last run

Comparison basis:

- This summary is based on the current repo state plus the last stored query audit report in `docs/audits/supabase-query-performance-audit-2026-04-22.md`.
- I did not have live database telemetry from the 2026-04-23 automation run.

What materially improved:

- Sales partner and referral detail reads are cleaner now. The code now reuses shared helper lookups from `sales-crm-read-model` instead of duplicating those base fetches inside both lead-detail and partner-detail modules.
- Member Command Center file loading is more bounded now. The detail read only loads one page of files and only does the legacy inline-data follow-up query for the visible rows.
- Member Command Center also replaced an exact intake-assessment count with a simple existence check, which is cheaper and good enough for the current screen.
- MHP overview now caps the care-plan snapshot rows it pulls, which lowers the fixed cost of the overview supplement.

What did not materially improve:

- The highest-cost structural risk is still the sales dashboard summary RPC. It still scans and re-aggregates the full leads set and still does unrelated whole-table counts.
- The billing dashboard still pays for two wide raw-data reads plus a batch read in one request, and the billing module index still duplicates the batch fetch.
- The admin audit trail still lacks the plain `audit_logs(created_at desc)` index.
- Partner and referral directories still rely on alphabetical sort plus exact counts without plain sort indexes.
- MAR snapshot still does exact counts before limited reads.
- Completed enrollment-packet reporting is still capped by `limit`, not true pagination, and still fans search out through member, lead, and sender-name lookups.

What I did not find:

- I did not find a new top-tier Supabase read regression in the files changed for this run.
- I did not find evidence that the major existing hotspots were fully fixed yet.

What to focus on next:

1. Confirm the repo’s performance migrations are actually applied in Supabase.
2. Slim the sales dashboard summary RPC.
3. Remove the duplicate billing batch read and then rework the broader billing dashboard fan-out.
4. Add the missing audit-log and sales-directory sort indexes.
5. Convert completed enrollment-packet reporting to true pagination.
