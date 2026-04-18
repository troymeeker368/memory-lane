# Supabase Query Performance Audit

Date: 2026-04-16
Automation: Supabase Query Performance Audit

## 1. Executive Summary

This codebase is still in much better shape than it was earlier in April, but a few important read paths are still heavier than they should be.

The biggest confirmed risks in the current workspace are:

- `confirmed` High: the sales dashboard summary RPC still rebuilds canonical state across the full `leads` table and then adds separate whole-table counts for activities, partners, and referral sources. Evidence: `supabase/migrations/0209_sales_dashboard_summary_lead_count_slimming.sql:41-147`, `supabase/migrations/0209_sales_dashboard_summary_lead_count_slimming.sql:258-279`, `lib/services/sales-workflows.ts:155-181`
- `confirmed` High: the admin audit trail still pages `audit_logs` by `created_at desc` without a standalone `audit_logs(created_at desc)` index in current migrations. Evidence: `lib/services/admin-audit-trail.ts:79-90`; migration search found only `entity_type`, `actor_user_id`, and `action` composites
- `confirmed` Medium: partner and referral directories still rely on `organization_name` sorts plus exact counts without plain btree sort indexes for those tables. Evidence: `lib/services/sales-crm-read-model.ts:553-565`, `lib/services/sales-crm-read-model.ts:890-927`
- `confirmed` Medium: the completed enrollment-packet list is still a bounded but unpaginated read that also fans out into extra search-ID lookups and three name-resolution queries. Evidence: `lib/services/enrollment-packets-listing.ts:145-184`, `lib/services/enrollment-packet-list-support.ts:95-120`, `lib/services/enrollment-packet-list-support.ts:123-157`
- `confirmed` Medium: MHP, Member Command Center, and health dashboard reads remain batched, but they still stack several cross-domain reads on a single page load. Evidence: `lib/services/member-health-profiles-read.ts:36-48`, `lib/services/member-health-profiles-read.ts:72-80`, `lib/services/member-command-center-runtime.ts:425-455`, `lib/services/health-dashboard.ts:126-158`

Important positive drift:

- `confirmed` The repo now contains `0210_query_audit_missing_indexes.sql`, which adds the previously missing `lead_activities(activity_at desc)` and `member_files(member_id, file_name)` indexes plus billing invoice list indexes. Evidence: `supabase/migrations/0210_query_audit_missing_indexes.sql:1-11`
- `confirmed` The repo also contains `0209_sales_dashboard_summary_lead_count_slimming.sql`, which is a real improvement over the older sales dashboard RPC even though it still does full-table work. Evidence: `supabase/migrations/0209_sales_dashboard_summary_lead_count_slimming.sql:1-279`
- `likely` Those gains only help production once the migrations are actually applied in Supabase. I did not verify deployment state during this run.

## 2. Missing Indexes

1. `confirmed` `audit_logs(created_at desc)`
Why it matters:
- The admin audit trail’s main read path pages newest-first activity with no required filter.
- Current repo indexes support `entity_type + created_at`, `actor_user_id + created_at`, and `action + created_at`, but not the plain “latest audit rows” path.
Evidence:
- Query: `lib/services/admin-audit-trail.ts:79-90`
- Existing indexes: `supabase/migrations/0048_query_performance_support_indexes.sql:10-14`, `supabase/migrations/0125_query_performance_followup_indexes.sql:1-2`

2. `confirmed` `community_partner_organizations(organization_name)`
Why it matters:
- The partner directory and partner picker both sort by `organization_name`.
- The repo has trigram search indexes, but not a plain btree sort index for this list shape.
Evidence:
- Queries: `lib/services/sales-crm-read-model.ts:553-565`, `lib/services/sales-crm-read-model.ts:890-900`
- Existing indexes: `supabase/migrations/0105_sales_pipeline_summary_rpc_and_search_indexes.sql:123-136`, `supabase/migrations/0124_data_access_optimization_indexes.sql:14`

3. `confirmed` `referral_sources(organization_name)`
Why it matters:
- The referral-source directory and referral prefetch path both sort by `organization_name`.
- The repo has a partner-scoped `(partner_id, organization_name)` index and trigram search indexes, but not a plain global sort index.
Evidence:
- Queries: `lib/services/sales-crm-read-model.ts:622-625`, `lib/services/sales-crm-read-model.ts:917-927`, `lib/services/sales-crm-read-model.ts:959-962`
- Existing indexes: `supabase/migrations/0105_sales_pipeline_summary_rpc_and_search_indexes.sql:138-154`, `supabase/migrations/0124_data_access_optimization_indexes.sql:17-18`

4. `likely` `profiles` sender-name search index for `full_name ilike(...)`
Why it matters:
- Enrollment-packet search expands a search term into `members`, `leads`, and `profiles` before the main packet query runs.
- I did not find a supporting `profiles(full_name)` trigram index in migrations.
Evidence:
- Query: `lib/services/enrollment-packet-list-support.ts:108-113`
- Residual gap: no matching migration index found during repo search

## 3. Potential Table Scans

1. `confirmed` High: sales dashboard summary RPC still does whole-table work
Why it could become slow:
- The RPC still materializes `canonical_leads` from all rows in `public.leads`.
- It then computes summary counts from that full set and also runs separate full-table counts for `lead_activities`, `community_partner_organizations`, `referral_sources`, and `partner_activities`.
Evidence:
- Runtime caller: `lib/services/sales-workflows.ts:155-181`
- RPC definition: `supabase/migrations/0209_sales_dashboard_summary_lead_count_slimming.sql:41-147`, `supabase/migrations/0209_sales_dashboard_summary_lead_count_slimming.sql:258-279`
Estimated scaling risk:
- Near-term

2. `confirmed` Medium: admin audit trail can degrade into a broader newest-first scan
Why it could become slow:
- The default path sorts `audit_logs` by `created_at desc`.
- Area filtering also uses `entity_type.ilike...` clauses, which can combine a text filter with a global descending sort.
Evidence:
- `lib/services/admin-audit-trail.ts:79-90`
- Supporting indexes found are only filter-specific composites, not a plain newest-first index
Estimated scaling risk:
- Near-term

3. `confirmed` Medium: partner and referral directories still depend on sortable full-list behavior
Why it could become slow:
- Both directory pages request `count: "exact"`, sort by `organization_name`, and then page with offsets.
- Without plain sort indexes, Postgres can end up doing more work than necessary as those tables grow.
Evidence:
- `lib/services/sales-crm-read-model.ts:890-900`
- `lib/services/sales-crm-read-model.ts:917-927`
Estimated scaling risk:
- Near-term

## 4. N+1 Query Patterns

No confirmed classic per-row read-side N+1 pattern was found in the top member, MAR, MHP, care-plan, member-file, or audit-report screens during this run.

What is still open:

1. `confirmed` Medium: MAR schedule reconciliation still fans out one member at a time
Why it could become slow:
- `syncTodayMarSchedules()` computes the impacted member list, then calls `reconcileMarSchedulesForMember(...)` once per member.
- That is not a UI N+1, but it is still repeated query work inside a loop and can spike on heavy medication-update days.
Evidence:
- `lib/services/mar-workflow-read.ts:115-136`

Residual validation gap:

- This was a code-and-migrations audit only. I did not inspect live query plans or production telemetry.

## 5. Inefficient Data Fetching

1. `confirmed` High: MHP overview panels still stack multiple cross-domain reads on every detail render
Why it could become slow:
- The overview summary read model loads care plans, progress notes, billing payor, physician orders, and assessments together for one member view.
- That is in addition to the base member-health-profile detail read.
Evidence:
- `lib/services/member-health-profiles-read.ts:36-48`
- `lib/services/member-health-profiles-read.ts:72-80`
- Page usage: `app/(portal)/health/member-health-profiles/[memberId]/page.tsx:198-215`
Estimated scaling risk:
- Near-term

2. `confirmed` Medium: health dashboard still has a wide fixed fan-out on each load
Why it could become slow:
- One dashboard request pulls MAR snapshot, blood sugar, active member count, care plans, incidents, progress notes, two runner-health checks, and a care-alert RPC.
- Each piece is bounded, but the combined page cost is still high for a dashboard.
Evidence:
- `lib/services/health-dashboard.ts:126-158`
Estimated scaling risk:
- Near-term

3. `confirmed` Medium: MAR workflow still asks for exact full-view counts before loading the row slices
Why it could become slow:
- The main workflow now limits row payloads, which is good.
- It still runs exact counts over both `v_mar_today` and `v_mar_overdue_today` on every snapshot load.
Evidence:
- `lib/services/mar-workflow-read.ts:165-179`
Estimated scaling risk:
- Near-term

4. `confirmed` Medium: Member Command Center detail still loads several domains even when staff may only need one tab
Why it could become slow:
- Detail load always pulls profile, attendance schedule, contacts, files, allergies, care-plan overview, enrollment-packet alert, and an intake assessment count.
- This is batched, but it is still a large fixed read cost per member open.
Evidence:
- `lib/services/member-command-center-runtime.ts:425-455`
Estimated scaling risk:
- Near-term

5. `confirmed` Medium: completed enrollment-packet reporting still over-reads relative to the screen need
Why it could become slow:
- The screen fetches up to 200 to 500 completed packets in one request.
- Search expands into three extra ID lookups first, then the result rows trigger three more name-resolution queries.
Evidence:
- `lib/services/enrollment-packets-listing.ts:132-184`
- `lib/services/enrollment-packet-list-support.ts:95-120`
- `lib/services/enrollment-packet-list-support.ts:123-157`
Estimated scaling risk:
- Near-term

## 6. Duplicate Query Logic

1. `confirmed` Medium: sales partner/referral lookup logic is still duplicated across several read paths
Where:
- `lib/services/sales-crm-read-model.ts:358-387`
- `lib/services/sales-crm-read-model.ts:422-467`
- `lib/services/sales-crm-read-model.ts:535-583`
- `lib/services/sales-crm-read-model.ts:586-632`
- `lib/services/sales-crm-read-model.ts:885-947`
Why it matters:
- Search behavior, preload limits, and future indexing assumptions now have to stay aligned across picker, directory, and form-loader code.

2. `confirmed` Medium: care-plan reads still use both direct table helpers and the canonical paged RPC list
Where:
- Direct table helper: `lib/services/care-plans-read-model.ts:224-255`
- Canonical paged RPC list: `lib/services/care-plans-read-model.ts:308-365`
Why it matters:
- The current paged list path is safer, but older direct-read helpers still exist, which makes future performance tuning easier to drift.

3. `confirmed` Low: member lookup/search behavior is still split across shared and MCC-specific services
Where:
- `lib/services/member-list-read.ts:13-89`
- `lib/services/member-command-center-runtime.ts:81-143`
- `lib/services/shared-lookups-supabase.ts:45-107`
Why it matters:
- Not the biggest performance problem now, but it raises the chance that limits, count behavior, and search tuning drift across domains.

## 7. Recommended Index Additions

Add these first:

1. `create index if not exists idx_audit_logs_created_at_desc on public.audit_logs (created_at desc);`

2. `create index if not exists idx_community_partner_organizations_organization_name on public.community_partner_organizations (organization_name);`

3. `create index if not exists idx_referral_sources_organization_name on public.referral_sources (organization_name);`

Validate before adding:

4. `create index if not exists idx_profiles_full_name_trgm on public.profiles using gin (full_name gin_trgm_ops);`
Reason:
- This looks useful for enrollment-packet sender-name search, but `profiles` may still be small enough that it is low priority.

Do not expect indexes alone to fix these:

- Sales dashboard summary RPC
  Reason: the main cost is repeated whole-table aggregation logic.

- MHP overview and dashboard fan-out
  Reason: the bigger problem is how many separate reads the pages do, not one missing index.

## 8. Performance Hardening Plan

Phase 1: Deploy what is already in the repo

- Make sure `0209_sales_dashboard_summary_lead_count_slimming.sql` and `0210_query_audit_missing_indexes.sql` are actually applied in Supabase.
- Without deployment, the previously identified lead-activity, member-file, and billing index fixes are only workspace improvements.

Phase 2: Reduce the largest whole-table dashboard work

- Keep one canonical sales dashboard summary boundary, but slim `rpc_get_sales_dashboard_summary` further so it stops rebuilding all lead state on every dashboard request.
- If founder-facing metrics need to stay broad, consider a snapshot/RPC strategy instead of repeating full-table work per page load.

Phase 3: Close the current missing-index gaps

- Add `audit_logs(created_at desc)`.
- Add plain `organization_name` sort indexes for partner and referral directories.
- Only add a `profiles(full_name)` search index if the sender-name search becomes materially active.

Phase 4: Bound the heavy fixed fan-out screens

- Convert completed enrollment-packet reporting to true pagination instead of a large bounded read.
- Keep MHP and Member Command Center on canonical services, but defer non-critical side panels instead of loading everything up front.
- Review whether the health dashboard needs all current sections on first paint.

Phase 5: Remove unnecessary exact counts where possible

- Revisit exact totals on sales directories and MAR first load.
- If the UI can tolerate deferred totals, that is usually safer than exact counts at scale.

## 9. Suggested Codex Prompts

1. `Slim the sales dashboard summary RPC in Memory Lane. Keep one canonical Supabase RPC boundary, but stop rebuilding canonical lead state across the full leads table on every dashboard view. Preserve the current founder-facing summary numbers and recent inquiry payload.`

2. `Add a forward-only Supabase migration for the remaining read-side missing indexes from the April 16 query audit: audit_logs(created_at desc), community_partner_organizations(organization_name), and referral_sources(organization_name). Validate with the current query shapes before adding anything else.`

3. `Refactor the completed enrollment-packet reporting list so it stops doing a large bounded read plus extra search/name fan-out on every request. Keep Supabase as source of truth and preserve current filters, but move to a paged canonical read path.`

4. `Reduce fixed query fan-out on the Member Health Profile detail experience. Keep the existing canonical services, but stop loading care plans, progress notes, billing payor, physician orders, and assessment history together unless the screen actually needs them immediately.`

5. `Audit the health dashboard first paint. Identify which of the current reads are essential for initial load and which can be deferred without breaking the workflow. Keep the current canonical service boundaries and avoid mock data or client-only shortcuts.`

6. `Review exact-count pagination in sales and MAR read paths. Identify where count: "exact" is truly required and where deferred totals would be safer for scale without changing business behavior.`

## 10. Founder Summary: What changed since the last run

What materially improved since the 2026-04-15 run:

- The repo still contains the two important hardening migrations from the last run: `0209_sales_dashboard_summary_lead_count_slimming.sql` and `0210_query_audit_missing_indexes.sql`.
- Because of `0210`, the older missing-index findings for global `lead_activities(activity_at desc)`, generated member-file duplicate checks, and billing invoice list sorts are no longer codebase gaps. They are now deployment-verification items.

What is newly clearer in this run:

- The clearest remaining missing-index gap is now the admin audit trail’s newest-first read, not lead activities or member files.
- Sales partner and referral directories are now the cleaner next directory-index targets because they still sort by `organization_name` and ask for exact counts without plain sort indexes.
- The biggest non-index problem is still the sales dashboard summary RPC. It is slimmer than before, but it still does full-table work.
- MHP, Member Command Center, and the health dashboard remain mostly batched and canonical, but they still do a lot of cross-domain reads on first load.

What to focus on next:

1. Deploy `0209` and `0210` if they are not already live.
2. Slim the sales dashboard summary RPC further.
3. Add the audit-log and sales-directory sort indexes.
4. Page or defer the heaviest fixed fan-out screens instead of widening them further.
