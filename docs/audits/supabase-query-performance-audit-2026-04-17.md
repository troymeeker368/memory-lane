# Supabase Query Performance Audit

Date: 2026-04-17
Automation: Supabase Query Performance Audit

## 1. Executive Summary

This codebase is still materially better than it was earlier in April, but a small set of high-traffic Supabase read paths remain heavier than they should be.

The biggest confirmed risks in the current workspace are:

- `confirmed` High: the sales dashboard summary RPC still rebuilds lead state from the full `leads` table and then adds whole-table counts for activities, partners, referral sources, and partner activities. Evidence: `supabase/migrations/0209_sales_dashboard_summary_lead_count_slimming.sql:41-148`, `supabase/migrations/0209_sales_dashboard_summary_lead_count_slimming.sql:185-279`, `lib/services/sales-workflows.ts:160-181`
- `confirmed` High: the admin audit trail still pages `audit_logs` newest-first without a standalone `audit_logs(created_at desc)` index. Evidence: `lib/services/admin-audit-trail.ts:79-90`; current migrations only cover `entity_type`, `actor_user_id`, and `action` composites
- `confirmed` Medium: sales partner and referral directory reads, plus the new partner picker search, still sort by `organization_name` without plain btree sort indexes on those tables. Evidence: `lib/services/sales-crm-read-model.ts:535-565`, `lib/services/sales-crm-read-model.ts:613-625`, `lib/services/sales-crm-read-model.ts:885-927`
- `confirmed` Medium: the completed enrollment-packet list is still a large bounded read with search fan-out and post-query name resolution. Evidence: `lib/services/enrollment-packets-listing.ts:145-184`, `lib/services/enrollment-packet-list-support.ts:64-120`, `lib/services/enrollment-packet-list-support.ts:123-157`
- `confirmed` Medium: MHP, Member Command Center, and the health dashboard still stack several cross-domain reads on first load. Evidence: `lib/services/member-health-profiles-read.ts:36-48`, `lib/services/member-health-profiles-read.ts:73-80`, `lib/services/member-command-center-runtime.ts:426-456`, `lib/services/health-dashboard.ts:137-158`

Important positive drift in this run:

- `confirmed` The MAR dashboard read path is now slimmer than yesterday. It no longer loads all of today’s MAR rows and then slices them in application code. It now asks Supabase separately for action rows and recent rows with server-side filters and limits. Evidence: `lib/services/mar-dashboard-read-model.ts:27-57`, `lib/services/mar-dashboard-read-model.ts:71-84`, `lib/services/health-dashboard.ts:137-148`
- `confirmed` The transportation add-rider picker now reuses the shared member picker instead of keeping another custom member search path. That reduces duplicate member lookup query logic. Evidence: `lib/services/member-command-center-runtime.ts:488-506`, `lib/services/shared-lookups-supabase.ts:151-201`
- `confirmed` The repo still contains `0210_query_audit_missing_indexes.sql`, which closes earlier gaps for `lead_activities(activity_at desc)`, `member_files(member_id, file_name)`, and billing invoice list indexes. Evidence: `supabase/migrations/0210_query_audit_missing_indexes.sql:1-11`

Important caveat:

- `likely` I verified migration files in the repo, not live Supabase deployment state. I did not confirm that `0209` and `0210` are already applied in the linked project.

## 2. Missing Indexes

1. `confirmed` `audit_logs(created_at desc)`

Why it matters:

- The admin audit trail’s base query sorts all audit rows newest-first with no mandatory filter.
- Current repo indexes cover `entity_type + created_at desc`, `actor_user_id + created_at desc`, and `action + created_at desc`, but not the plain “latest audit rows” query shape.

Evidence:

- Query: `lib/services/admin-audit-trail.ts:79-90`
- Existing indexes: `supabase/migrations/0048_query_performance_support_indexes.sql:10-14`, `supabase/migrations/0125_query_performance_followup_indexes.sql:1-2`

2. `confirmed` `community_partner_organizations(organization_name)`

Why it matters:

- The partner directory sorts by `organization_name`.
- The sales form prefetch path sorts by `organization_name`.
- The new partner picker search also sorts by `organization_name`.
- Trigram indexes help text search, but not plain alphabetical list ordering.

Evidence:

- Queries: `lib/services/sales-crm-read-model.ts:553-565`, `lib/services/sales-crm-read-model.ts:613-617`, `lib/services/sales-crm-read-model.ts:890-900`
- Existing indexes: `supabase/migrations/0105_sales_pipeline_summary_rpc_and_search_indexes.sql:123-136`, `supabase/migrations/0124_data_access_optimization_indexes.sql:14-15`

3. `confirmed` `referral_sources(organization_name)`

Why it matters:

- The referral directory sorts by `organization_name`.
- The referral-source prefetch path also sorts by `organization_name`.
- There is a partner-scoped `(partner_id, organization_name)` index, but not a plain global sort index for the unscoped directory path.

Evidence:

- Queries: `lib/services/sales-crm-read-model.ts:622-625`, `lib/services/sales-crm-read-model.ts:917-927`, `lib/services/sales-crm-read-model.ts:959-962`
- Existing indexes: `supabase/migrations/0105_sales_pipeline_summary_rpc_and_search_indexes.sql:138-154`, `supabase/migrations/0124_data_access_optimization_indexes.sql:17-18`

4. `likely` `profiles(full_name)` search support for enrollment-packet sender lookup

Why it matters:

- Enrollment-packet search expands the user’s search text into `members`, `leads`, and `profiles` before it runs the main packet query.
- I found trigram coverage for `members.display_name` and `leads` search fields, but not for `profiles.full_name`.

Evidence:

- Query: `lib/services/enrollment-packet-list-support.ts:108-113`
- Residual gap: repo migration search found no `profiles(full_name)` btree or trigram index

## 3. Potential Table Scans

1. `confirmed` High: sales dashboard summary RPC still performs whole-table aggregation work

Why it could become slow:

- The RPC still materializes `canonical_leads` from all rows in `public.leads`.
- It then computes summary counts from that resolved set.
- It also runs separate whole-table counts on `lead_activities`, `community_partner_organizations`, `referral_sources`, and `partner_activities`.

Evidence:

- Runtime caller: `lib/services/sales-workflows.ts:160-181`
- RPC definition: `supabase/migrations/0209_sales_dashboard_summary_lead_count_slimming.sql:41-148`, `supabase/migrations/0209_sales_dashboard_summary_lead_count_slimming.sql:185-279`

Estimated scaling risk:

- Near-term

2. `confirmed` Medium: admin audit trail can degrade into a broader newest-first scan

Why it could become slow:

- The default path sorts `audit_logs` by `created_at desc` without a standalone matching index.
- Area filtering uses `entity_type.ilike` terms, which can add more work on top of the global descending sort.

Evidence:

- `lib/services/admin-audit-trail.ts:79-90`
- Supporting indexes found are only filter-specific composites plus a trigram on `entity_type`

Estimated scaling risk:

- Near-term

3. `confirmed` Medium: partner and referral directories still rely on exact counts plus ordered list reads

Why it could become slow:

- Both directory pages request `count: "exact"`, sort by `organization_name`, and use offset pagination.
- As those tables grow, this combination gets more expensive even before the pages become visibly “large.”

Evidence:

- `lib/services/sales-crm-read-model.ts:890-900`
- `lib/services/sales-crm-read-model.ts:917-927`

Estimated scaling risk:

- Near-term

## 4. N+1 Query Patterns

No confirmed classic per-row UI N+1 pattern was found in the main member, MAR, MHP, care-plan, member-file, or audit-log reads during this run.

The remaining repeated-query risk is:

1. `confirmed` Medium: MAR schedule reconciliation still runs one member at a time

Why it could become slow:

- `syncTodayMarSchedules()` identifies impacted members and then calls `reconcileMarSchedulesForMember(...)` once per member.
- That is not a page-load N+1, but it is still repeated query work inside a loop and can spike when many medication changes happen together.

Evidence:

- `lib/services/mar-workflow-read.ts:115-136`

Residual validation gap:

- This was a code-and-migrations audit only. I did not inspect live query plans or production telemetry.

## 5. Inefficient Data Fetching

1. `confirmed` High: MHP overview still stacks multiple cross-domain reads on every overview load

Why it could become slow:

- The MHP overview supplement loads care plans, progress notes, billing payor, and physician orders together.
- The overview summary then adds assessment history on top of that.

Evidence:

- `lib/services/member-health-profiles-read.ts:36-48`
- `lib/services/member-health-profiles-read.ts:73-80`

Estimated scaling risk:

- Near-term

2. `confirmed` Medium: Member Command Center detail still pulls several domains even when staff may only need one tab

Why it could become slow:

- Every detail load fetches profile, attendance schedule, contacts, files, allergies, care-plan overview, enrollment packet alert, and then an exact assessment count.

Evidence:

- `lib/services/member-command-center-runtime.ts:426-456`

Estimated scaling risk:

- Near-term

3. `confirmed` Medium: health dashboard still has a wide first-load fan-out

Why it could become slow:

- One dashboard request loads MAR snapshot, blood sugar rows, active member count, care plans, incidents, progress notes, two runner-health checks, and care alerts.
- The MAR part improved in this run, but the overall page still has a lot of fixed read cost.

Evidence:

- `lib/services/health-dashboard.ts:137-158`

Estimated scaling risk:

- Near-term

4. `confirmed` Medium: MAR workflow still asks for exact totals before loading today/overdue slices

Why it could become slow:

- The main workflow fetches exact counts for `v_mar_today` and `v_mar_overdue_today` on every snapshot load before it loads the limited row slices.

Evidence:

- `lib/services/mar-workflow-read.ts:165-223`

Estimated scaling risk:

- Near-term

5. `confirmed` Medium: sales lead pipeline pages still pay for exact counts on every paginated request

Why it could become slow:

- The canonical lead list uses `count: "exact"` whenever pagination is enabled.
- That keeps totals accurate, but it makes every list view do more work as the `leads` table grows.

Evidence:

- `lib/services/sales-crm-read-model.ts:778-813`
- Representative callers: `app/(portal)/sales/pipeline/eip/page.tsx:20`, `app/(portal)/sales/pipeline/inquiry/page.tsx:19`

Estimated scaling risk:

- Near-term

6. `confirmed` Medium: completed enrollment-packet reporting still over-reads relative to screen needs

Why it could become slow:

- The list reads up to 200 rows by default and up to 500 rows at the top end in one request.
- Search expands into three separate ID lookup queries first.
- After the main read, the list still runs three more name-resolution reads.

Evidence:

- `lib/services/enrollment-packets-listing.ts:132-184`
- `lib/services/enrollment-packet-list-support.ts:64-120`
- `lib/services/enrollment-packet-list-support.ts:123-157`

Estimated scaling risk:

- Near-term

7. `confirmed` Low: the health dashboard MAR slice is better than yesterday

Why this matters:

- Yesterday the dashboard read path effectively loaded all of today’s MAR rows and then split them in JavaScript.
- Today it filters action rows and recent rows in Supabase first, which reduces payload width and wasted row transfer.

Evidence:

- `lib/services/mar-dashboard-read-model.ts:27-57`
- `lib/services/mar-dashboard-read-model.ts:71-84`

8. `likely` Low: repeated-failure alerting still uses an exact `system_events` count with only partial index coverage

Why it could become slow:

- Repeated-failure alerting counts `system_events` by `event_type`, `entity_type`, `status`, and recent `created_at`.
- The repo has good `system_events` indexes, but not one exact composite for this full count shape.

Evidence:

- `lib/services/workflow-observability.ts:84-120`
- Existing indexes: `supabase/migrations/0046_operational_reliability_observability.sql:12-21`, `supabase/migrations/0050_workflow_reliability_indexes.sql:14-17`, `supabase/migrations/0207_system_events_open_alert_and_mhp_trgm_indexes.sql:3-4`

## 6. Duplicate Query Logic

1. `confirmed` Medium: sales partner and referral lookup logic is still duplicated across picker, directory, and form-loader paths

Where:

- `lib/services/sales-crm-read-model.ts:535-565`
- `lib/services/sales-crm-read-model.ts:586-632`
- `lib/services/sales-crm-read-model.ts:885-947`
- `lib/services/sales-crm-read-model.ts:950-967`

Why it matters:

- Search behavior, alphabetical ordering, limits, and future index assumptions now have to stay aligned across several read paths.
- The new partner picker added one more copy of the same partner table query family instead of shrinking duplication.

2. `confirmed` Medium: care-plan reads still use both direct table helpers and the paged canonical RPC list

Where:

- Direct helper: `lib/services/care-plans-read-model.ts:224-255`
- Canonical paged list: `lib/services/care-plans-read-model.ts:308-365`

Why it matters:

- The paged RPC path is safer for scale, but direct table reads still exist for overlapping care-plan concerns.

3. `confirmed` Low: member lookup duplication improved slightly, but is not fully gone

Where:

- Shared picker: `lib/services/shared-lookups-supabase.ts:151-201`
- Member list/MCC: `lib/services/member-command-center-runtime.ts:102-143`, `lib/services/member-command-center-runtime.ts:330-413`

Why it matters:

- The transportation add-rider flow now reuses the shared picker, which is good.
- But member lookup behavior is still split between shared lookup code and MCC-specific list/detail flows.

## 7. Recommended Index Additions

Add these first:

1. `create index if not exists idx_audit_logs_created_at_desc on public.audit_logs (created_at desc);`

2. `create index if not exists idx_community_partner_organizations_organization_name on public.community_partner_organizations (organization_name);`

3. `create index if not exists idx_referral_sources_organization_name on public.referral_sources (organization_name);`

Validate before adding:

4. `create index if not exists idx_profiles_full_name_trgm on public.profiles using gin (full_name gin_trgm_ops);`

Reason:

- This looks useful for enrollment-packet sender-name search, but it is lower priority than the audit-log and sales-directory sort gaps.

Do not expect indexes alone to fix these:

- Sales dashboard summary RPC
  Reason: its main cost is whole-table aggregation logic, not one missing index.
- MHP overview, Member Command Center, and health dashboard first-load fan-out
  Reason: the bigger issue is query stacking, not one slow column.

## 8. Performance Hardening Plan

Phase 1: make sure existing fixes are actually live

- Confirm that migrations `0209_sales_dashboard_summary_lead_count_slimming.sql` and `0210_query_audit_missing_indexes.sql` are applied in Supabase.
- Without deployment, some of the April hardening work only exists in the repo.

Phase 2: reduce the largest whole-table dashboard work

- Keep one canonical sales dashboard RPC boundary, but slim `rpc_get_sales_dashboard_summary` further so it stops rebuilding lead state across the full `leads` table on each request.
- If the founder dashboard must keep broad totals, use a summarized or snapshot-style boundary instead of repeating whole-table work live.

Phase 3: close the remaining missing-index gaps

- Add `audit_logs(created_at desc)`.
- Add plain alphabetical sort indexes for partner and referral directories.
- Only add `profiles(full_name)` search support if enrollment-packet sender search is actually used often enough to justify it.

Phase 4: bound the fixed fan-out screens

- Convert completed enrollment-packet reporting to true pagination instead of a large bounded read.
- Keep MHP and Member Command Center on canonical services, but defer non-critical side panels until they are needed.
- Review whether all current health dashboard sections must load on first paint.

Phase 5: remove exact counts where the UI can tolerate it

- Revisit exact totals in sales directories, MAR first load, and any other dashboard list where a deferred total would preserve business behavior.

## 9. Suggested Codex Prompts

1. `Slim the sales dashboard summary RPC in Memory Lane. Keep one canonical Supabase RPC boundary, but stop rebuilding canonical lead state across the full leads table on every dashboard request. Preserve current founder-facing summary numbers and recent inquiry payload.`

2. `Add a forward-only Supabase migration for the remaining read-side missing indexes from the April 17 query audit: audit_logs(created_at desc), community_partner_organizations(organization_name), and referral_sources(organization_name). Validate the exact current query shapes before adding anything else.`

3. `Refactor the completed enrollment-packet reporting list so it stops doing a large bounded read plus pre-search ID fan-out and post-read name fan-out on every request. Keep Supabase as source of truth and preserve current filters, but move to a paged canonical read path.`

4. `Reduce fixed query fan-out on the Member Health Profile overview and Member Command Center detail views. Keep canonical services and resolver paths, but defer non-critical panels instead of loading every cross-domain section up front.`

5. `Audit the health dashboard first paint. Identify which current reads are essential for initial load and which can be deferred without breaking workflow accuracy. Keep Supabase as source of truth and avoid mock or client-only shortcuts.`

6. `Review exact-count pagination in sales directories and MAR workflow reads. Identify where count: "exact" is truly required and where deferred totals would be safer for scale without changing business behavior.`

## 10. Founder Summary: What changed since the last run

What improved since the 2026-04-16 run:

- The MAR dashboard path is now better. It no longer loads the full day’s MAR rows and then slices them in app code. It now asks Supabase for just the action rows and just the recent rows it needs.
- The transportation add-rider member picker now reuses the shared member picker logic. That trims one duplicate member search path.
- The member-file duplicate check path is slightly safer because the existence probe is now explicitly bounded with `.limit(1)`, and the repo still carries the new `member_files(member_id, file_name)` index in `0210`.

What became more urgent or clearer in this run:

- The missing `audit_logs(created_at desc)` index is still the clearest audit-log performance gap.
- Sales partner and referral alphabetical list reads are now more urgent because a new partner picker query was added on the same `organization_name` sort path without a matching plain index.
- Sales pipeline list pages still do exact counts on every paginated request, so that list remains accurate but not especially cheap as lead volume grows.
- The completed enrollment-packet reporting list still is not truly paginated. It now also depends on `completion_follow_up_status` for readiness filtering, so the query got a little more complex without becoming cheaper.

What did not materially change:

- The sales dashboard summary RPC is still the largest single whole-table read risk.
- MHP, Member Command Center, and the health dashboard are still mostly batched and canonical, but they still do too much work on first load.
- The repo still contains the helpful `0209` and `0210` migrations, but this run did not verify whether they are already deployed to the live Supabase project.

What to focus on next:

1. Confirm `0209` and `0210` are applied in Supabase.
2. Slim the sales dashboard summary RPC further.
3. Add the audit-log and sales-directory sort indexes.
4. Convert the completed enrollment-packet list to true pagination.
5. Defer non-critical cross-domain reads on MHP, Member Command Center, and the health dashboard.
