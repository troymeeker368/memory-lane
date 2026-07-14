# Supabase Query Performance Audit

Date: 2026-05-08
Automation: Supabase Query Performance Audit

## 1. Executive Summary

- `confirmed` High: the sales dashboard summary RPC still rebuilds summary state from the full `leads` table and still runs separate global counts against `lead_activities`, `community_partner_organizations`, `referral_sources`, and `partner_activities`. Evidence: `supabase/migrations/0209_sales_dashboard_summary_lead_count_slimming.sql:41-279`, `lib/services/sales-workflows.ts:155-181`
- `confirmed` High: the billing dashboard summary still pays for three broad reads on one request: a full billing preview, a full variable-charge queue, and the full batch list. One duplicate batch fetch was removed from `getBillingModuleIndex()`, but the summary itself is still expensive. Evidence: `lib/services/billing-preview-helpers.ts:176-256`, `lib/services/billing-read-supabase.ts:485-547`, `lib/services/billing-read-supabase.ts:683-725`
- `confirmed` Medium: the admin audit trail still sorts newest-first from `audit_logs` without a standalone `created_at desc` index. Evidence: `lib/services/admin-audit-trail.ts:78-95`, repo index scan in `supabase/migrations/0047_query_performance_indexes.sql:10-11` and `supabase/migrations/0048_query_performance_support_indexes.sql:10-14`
- `confirmed` Medium: MAR dashboard and workflow reads still do extra work beyond what the UI needs. The workflow snapshot runs exact-count queries before loading limited slices, and the health dashboard action query has no limit. Evidence: `lib/services/mar-workflow-read.ts:165-189`, `lib/services/mar-dashboard-read-model.ts:27-44`
- `confirmed` Medium: Member Command Center, member detail, and MHP screens still fan out across many member-scoped tables on first load. The code is cleaner than the last saved audit, but the fixed query cost is still high. Evidence: `lib/services/member-command-center-runtime.ts:501-565`, `lib/services/member-detail-read-model.ts:161-225`, `lib/services/member-health-profiles-read.ts:35-67`, `lib/services/member-health-profiles-supabase.ts:543-669`
- `likely` Medium: shared member index pages for Member Command Center and MHP still request `count: "exact"` on every paginated page load. The repo has useful member search indexes, but exact counts can still become expensive as member volume grows. Evidence: `lib/services/member-list-read.ts:47-89`

Important caveat:

- This was a code-and-migrations audit only. I did not inspect live `EXPLAIN` plans, Supabase query logs, or `pg_stat_statements`.

## 2. Missing Indexes

1. `confirmed` `audit_logs(created_at desc)`

Why it matters:

- The default admin audit trail is a plain newest-first read.
- Existing repo indexes cover `entity_type + created_at` and `actor_user_id + created_at`, but not the global recent-events path.

Evidence:

- Query: `lib/services/admin-audit-trail.ts:78-95`
- Existing indexes: `supabase/migrations/0047_query_performance_indexes.sql:10-11`, `supabase/migrations/0048_query_performance_support_indexes.sql:10-14`

2. `confirmed` `community_partner_organizations(organization_name)`

Why it matters:

- The partner directory sorts alphabetically and asks Supabase for exact counts.
- The repo has trigram search support, but not a plain btree sort index for the default list path.

Evidence:

- Query: `lib/services/sales-crm-read-model.ts:400-430`
- Existing search indexes: `supabase/migrations/0105_sales_pipeline_summary_rpc_and_search_indexes.sql:123-136`

3. `confirmed` `referral_sources(organization_name)`

Why it matters:

- The referral directory has the same alphabetical sort plus exact-count pattern as the partner directory.
- The repo has trigram search support, but not a plain btree sort index for the default list path.

Evidence:

- Query: `lib/services/sales-crm-read-model.ts:457-498`
- Existing search indexes: `supabase/migrations/0105_sales_pipeline_summary_rpc_and_search_indexes.sql:138-154`

Residual gap:

- I did not find a new confirmed index gap in MAR, MHP, member-files, or care-plan member filters. Those areas already have supporting migrations for the current main predicates and sorts.

## 3. Potential Table Scans

1. `confirmed` High: sales dashboard summary RPC still does broad full-table aggregation work

Why it could become slow:

- It normalizes every row from `public.leads` into `canonical_leads` and `resolved_leads`.
- It then runs more global counts against other sales tables on the same request.

Evidence:

- `supabase/migrations/0209_sales_dashboard_summary_lead_count_slimming.sql:41-170`
- `supabase/migrations/0209_sales_dashboard_summary_lead_count_slimming.sql:258-279`

Estimated scaling risk:

- Near-term

2. `confirmed` Medium: admin audit trail can degrade into a broad newest-first scan

Why it could become slow:

- The query orders by `created_at desc` without a matching standalone descending index.
- Optional area filters add multiple `ilike` branches on top of the same base path.

Evidence:

- `lib/services/admin-audit-trail.ts:78-95`

Estimated scaling risk:

- Near-term

3. `confirmed` Medium: partner and referral directories still combine exact counts with alphabetical sort

Why it could become slow:

- Each page load asks for exact counts.
- Default alphabetical ordering is not backed by a plain btree index.

Evidence:

- `lib/services/sales-crm-read-model.ts:400-430`
- `lib/services/sales-crm-read-model.ts:457-498`

Estimated scaling risk:

- Near-term

4. `likely` Medium: shared member index pages still pay exact-count scan cost

Why it could become slow:

- Both MHP and Member Command Center page through the shared member index helper.
- That helper always requests `count: "exact"` even when the page only needs the next slice.

Evidence:

- `lib/services/member-list-read.ts:61-89`
- Used by `lib/services/member-command-center-runtime.ts:152-161`
- Used by `lib/services/member-health-profiles-supabase.ts:393-399`

Estimated scaling risk:

- Near-term

## 4. N+1 Query Patterns

1. `confirmed` Medium: MAR schedule refresh still fans out to one reconciliation call per member

Why it could become slow:

- `syncTodayMarSchedules()` first finds candidate members, then runs `reconcileMarSchedulesForMember(...)` once per member.
- This is not a page-level N+1, but it is a workflow-level N+1 pattern in a daily medication path.

Evidence:

- Candidate selection: `lib/services/mar-workflow-read.ts:65-123`
- Per-member fan-out: `lib/services/mar-workflow-read.ts:126-136`

Estimated scaling risk:

- Near-term

2. `likely` Low: no new confirmed page-level Supabase query-inside-loop regressions were found in the current diff

Residual gap:

- I did not inspect every imported helper behind billing, notes, and enrollment packet reporting for hidden RPC fan-out, only the main read boundaries.

## 5. Inefficient Data Fetching

1. `confirmed` High: billing dashboard summary still reads far more raw data than the UI summary needs

Why it could become slow:

- One summary request triggers the full billing preview helper, the full variable-charge queue for the prior month, and the full batch list.
- Those paths read overlapping transportation, ancillary, billing-adjustment, member, and billing-setting data.

Evidence:

- `lib/services/billing-read-supabase.ts:683-725`
- `lib/services/billing-preview-helpers.ts:176-256`
- `lib/services/billing-preview-helpers.ts:326-480`

Estimated scaling risk:

- Near-term

2. `confirmed` High: variable-charge summary math is still built from raw monthly rows in application code

Why it could become slow:

- `getVariableChargesQueue()` reads monthly transportation, ancillary, and adjustment rows, then does filtering and totaling in TypeScript.
- The dashboard only needs waiting totals, not the full raw queue payload, for its headline numbers.

Evidence:

- `lib/services/billing-read-supabase.ts:485-580`

Estimated scaling risk:

- Near-term

3. `confirmed` Medium: dashboard ancillary summary still loads every monthly row just to compute totals

Why it could become slow:

- `listDashboardAncillaryChargesForMonth()` reads all monthly ancillary rows.
- `getDashboardAdminSnapshot()` then sums revenue and unreconciled counts in JavaScript.

Evidence:

- `lib/services/dashboard.ts:179-207`
- `lib/services/dashboard.ts:210-230`

Estimated scaling risk:

- Near-term

4. `confirmed` Medium: Member Command Center detail still has a broad first-load fan-out

Why it could become slow:

- One request still loads MCC profile, attendance schedule, contacts, the first file page, allergies, care-plan overview, enrollment-packet staging summary, and an intake-assessment existence check.
- The file list is now paged, which helps, but the total cross-domain fan-out is still high.

Evidence:

- `lib/services/member-command-center-runtime.ts:501-565`

Estimated scaling risk:

- Near-term

5. `confirmed` Medium: member detail still reads eight preview tables plus care-plan preview data

Why it could become slow:

- The screen loads daily activity, toilet, shower, transportation, blood sugar, ancillary, assessments, photos, and care-plan preview data.
- This is acceptable for a true detail screen, but it remains a large fixed read bundle.

Evidence:

- `lib/services/member-detail-read-model.ts:161-225`
- `lib/services/member-detail-read-model.ts:288-321`

Estimated scaling risk:

- Near-term

6. `confirmed` Medium: MHP overview and detail still pull wide cross-domain bundles

Why it could become slow:

- Overview loads care-plan snapshot, progress-note summary, billing payor, physician orders, and assessments.
- Detail can load profile, diagnoses, medications, allergies, providers, equipment, notes, assessments, and MCC photo state.

Evidence:

- `lib/services/member-health-profiles-read.ts:35-67`
- `lib/services/member-health-profiles-read.ts:75-97`
- `lib/services/member-health-profiles-supabase.ts:543-669`

Estimated scaling risk:

- Near-term

7. `confirmed` Medium: MAR workflow snapshot still pays for exact counts before limited lists

Why it could become slow:

- The workflow snapshot counts all rows in `v_mar_today` and `v_mar_overdue_today`, then separately loads only the limited slices.
- That creates extra work even when the screen only renders the first page.

Evidence:

- `lib/services/mar-workflow-read.ts:165-189`

Estimated scaling risk:

- Near-term

8. `confirmed` Medium: health dashboard MAR action queue is not bounded

Why it could become slow:

- `loadHealthDashboardMarActionRows()` filters by due window and status, but it does not limit the result set.
- As the medication schedule grows, this can turn into a large founder-facing dashboard payload.

Evidence:

- `lib/services/mar-dashboard-read-model.ts:27-44`

Estimated scaling risk:

- Near-term

## 6. Duplicate Query Logic

1. `confirmed` Medium improvement: billing module index no longer fetches the batch list twice

What changed:

- `getBillingModuleIndex()` now reuses `dashboard.batches[0]` instead of calling `getBillingBatches()` a second time.

Evidence:

- `lib/services/billing-read-supabase.ts:728-755`
- Current diff against the worktree on 2026-05-08

2. `confirmed` Medium improvement: member detail now uses one care-plan preview read path instead of separate overview and snapshot calls

What changed:

- The member detail screen now calls `getMemberCarePlanPreview()` once, instead of combining `getMemberCarePlanOverview()` and `getMemberCarePlanSnapshot()`.

Evidence:

- `lib/services/member-detail-read-model.ts:288-321`
- `lib/services/care-plans-read-model.ts:596-649`
- Current diff against the worktree on 2026-05-08

3. `confirmed` Low improvement: partner detail avoids one extra partner lookup during referral-source resolution

What changed:

- Partner detail now passes already-loaded partner rows into a referral-source helper instead of re-fetching the partner identity again.

Evidence:

- `lib/services/partner-detail-read-model.ts:107`
- `lib/services/sales-crm-read-model.ts:1085-1099`
- Current diff against the worktree on 2026-05-08

4. `confirmed` Medium: care-plan reads still keep both direct table helpers and the paged RPC list boundary

Why it matters:

- The canonical list path is `rpc_get_care_plan_list`, but direct table helpers are still used for snapshots and by-id support work.
- That keeps two read families alive for the same domain.

Evidence:

- Direct helper: `lib/services/care-plans-read-model.ts:241-260`
- Canonical paged list: `lib/services/care-plans-read-model.ts:344-370`

## 7. Recommended Index Additions

Add these first:

1. `create index if not exists idx_audit_logs_created_at_desc on public.audit_logs (created_at desc);`
2. `create index if not exists idx_community_partner_organizations_organization_name on public.community_partner_organizations (organization_name);`
3. `create index if not exists idx_referral_sources_organization_name on public.referral_sources (organization_name);`

Do not expect indexes alone to fix:

- sales dashboard summary RPC full-table aggregation
- billing dashboard summary fan-out
- MAR exact-count queries
- wide MHP, member-detail, and MCC first-load bundles

## 8. Performance Hardening Plan

1. Confirm deployed reality first.
   Validate that the linked Supabase project has actually applied the repo migrations that already harden member search, MAR views, member files, and sales follow-up reads.

2. Slim the sales dashboard summary RPC.
   Keep one canonical RPC boundary, but stop rebuilding summary state from the full `leads` table and stop doing unrelated whole-table counts on every dashboard request.

3. Split billing summary reads by purpose.
   Headline dashboard numbers should not need the same raw payload as invoice generation preview. Move summary math closer to SQL or an aggregated RPC and keep the preview path for invoice work only.

4. Remove raw-row monthly summaries where only totals are needed.
   The ancillary dashboard summary and the variable-charge waiting totals should be computed server-side instead of reading every monthly row into TypeScript.

5. Revisit exact counts on list screens.
   Shared member lists, MAR workflow totals, and directory pages should only pay for exact counts when the screen truly needs them on first render.

6. Keep first loads bounded.
   Preserve paged file reads, keep the cleaner care-plan preview path, and consider lazy-loading non-primary panels in MHP and Member Command Center detail screens.

7. Keep one canonical read boundary per domain.
   Prefer the care-plan RPC list boundary for list-scale tuning and avoid introducing new parallel read paths for the same founder-facing numbers.

## 9. Suggested Codex Prompts

1. `Slim the Memory Lane sales dashboard summary RPC. Keep one canonical Supabase RPC boundary, but stop rebuilding summary state across the full leads table and remove unrelated whole-table counts from each request. Preserve current founder-facing dashboard numbers.`

2. `Refactor the Memory Lane billing dashboard summary so the homepage summary does not run the full billing preview helper, the full variable-charge queue, and the full batch list on every request. Keep Supabase as source of truth and preserve existing displayed numbers.`

3. `Add a forward-only Supabase migration for the remaining confirmed missing read indexes from the 2026-05-08 query audit: audit_logs(created_at desc), community_partner_organizations(organization_name), and referral_sources(organization_name).`

4. `Refactor dashboard ancillary summary reads in Memory Lane so monthly revenue and unreconciled counts are computed in SQL or RPC instead of loading every ancillary row into TypeScript.`

5. `Review exact-count usage in Memory Lane member list, sales directory, and MAR workflow reads. Identify where count: "exact" is truly needed and where deferred totals or approximate behavior would preserve the workflow with lower Supabase cost.`

6. `Reduce first-load query fan-out for Member Command Center, member detail, and MHP screens. Keep canonical shared services, preserve paged file reads, and lazy-load non-primary supporting panels where safe.`

7. `Review MAR dashboard and workflow reads in Memory Lane. Remove unnecessary exact-count queries, bound founder-facing action queues where possible, and keep the current MAR clinical behavior intact.`

8. `Consolidate care-plan read boundaries in Memory Lane so list-scale behavior stays inside the canonical RPC path and direct table helpers are only used where they add clear value.`

## 10. Founder Summary: What changed since the last run

Comparison basis:

- The automation memory file for the 2026-05-07 run was empty, so I could not compare against a saved yesterday summary.
- I compared the current codebase and current dirty worktree against the last saved query audit report at `docs/audits/supabase-query-performance-audit-2026-04-24.md`.

What materially improved:

- Billing index load got cheaper today. `getBillingModuleIndex()` no longer fetches the billing batch list twice.
- Member detail care-plan loading got cleaner today. It now uses one preview read path instead of separate care-plan overview and snapshot calls.
- Partner detail got a small cleanup today. Referral-source resolution now reuses already-loaded partner rows instead of doing an extra partner identity fetch.

What did not materially improve:

- The biggest structural cost is still the sales dashboard summary RPC.
- Billing dashboard summary still does wide raw-data reads for headline numbers.
- The admin audit trail still lacks the plain `audit_logs(created_at desc)` index.
- MAR workflow still pays for exact counts before limited reads, and the health dashboard MAR due queue is still unbounded.
- MHP, Member Command Center, and member detail screens still have broad first-load fan-out across multiple domain tables.

What to focus on next:

1. Fix the sales dashboard summary RPC first.
2. Separate billing headline summaries from billing preview workloads.
3. Add the three missing confirmed indexes.
4. Remove raw-row monthly summary reads where only totals are needed.
5. Revisit exact-count usage on list and dashboard screens.
