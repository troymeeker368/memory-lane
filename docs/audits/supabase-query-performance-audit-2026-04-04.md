# Supabase Query Performance Audit

Date: 2026-04-04
Automation: Supabase Query Performance Audit

## 1. Executive Summary

This codebase is in better shape than a typical audit target. The migration history shows a lot of earlier indexing work has already been done, especially for foreign keys, member lookup flows, enrollment packet lists, and broad sales search. The remaining risks are more specific:

- MAR reads still rely on views that apply date functions directly to indexed timestamp columns. That is the biggest query-planning risk in this audit.
- Care plan reads still repeat "latest plan for member" lookups without a supporting sort index.
- MHP and progress note read models still fetch more rows than the screens actually need.
- Sales follow-up dashboards still make several separate count queries against the same `leads` table instead of using one read model.

Highest-priority findings:

1. `confirmed` High: MAR today / overdue / history reads can become slow because the view filters and sorts do not line up with the current indexes.
2. `confirmed` High: care plan "latest for member" queries are repeated in multiple services without a matching `(member_id, review_date, updated_at)` index.
3. `confirmed` Medium: MHP index and reporting flows over-fetch assessment and progress note history.
4. `confirmed` Medium: the sales follow-up dashboard performs one paged list query plus four separate count queries over the same lead population.
5. `likely` Medium: lead picker search uses `caregiver_email.ilike(...)` without evidence of a supporting search index.

## 2. Missing Indexes

1. `confirmed` `care_plans(member_id, review_date desc, updated_at desc)`
Why it matters:
- Multiple care plan readers ask for "latest plan for this member" by sorting on `review_date` then `updated_at`.
- Current indexes cover `member_id + next_due_date` and `member_id + track`, but not the actual latest-row sort path.
Evidence:
- `lib/services/care-plans-read-model.ts:518`
- `lib/services/care-plans-read-model.ts:562`
- `lib/services/care-plans-read-model.ts:588`
- Existing index only covers due-date ordering in `supabase/migrations/0013_care_plans_and_billing_execution.sql:28`

2. `confirmed` `mar_administrations(status, administration_date desc, administered_at desc)`
Why it matters:
- MAR "not given today" queries filter by status and date across the whole table, not by member.
- Current index starts with `member_id`, which does not help much when the query is for all members.
Evidence:
- `lib/services/mar-workflow-read.ts:207`
- `supabase/migrations/0028_pof_seeded_mar_workflow.sql:284`
- Current index is only `member_id, administration_date desc, administered_at desc` in `supabase/migrations/0028_pof_seeded_mar_workflow.sql:107`

3. `confirmed` `mar_administrations(administered_at desc)`
Why it matters:
- Recent MAR history screens ask for the latest administrations across all members and then `limit(...)`.
- Without a direct administered-time index, Postgres may sort a large working set.
Evidence:
- `lib/services/mar-workflow-read.ts:208`
- `supabase/migrations/0028_pof_seeded_mar_workflow.sql:309`

4. `likely` Search index for `leads.caregiver_email`
Why it matters:
- Enrollment packet eligible-lead picker searches `member_name`, `caregiver_name`, and `caregiver_email`.
- The repo already has trigram indexes for `member_name` and `caregiver_name`, but I did not find one for `caregiver_email`.
Evidence:
- `lib/services/sales-crm-read-model.ts:452`
- Existing search indexes live in `supabase/migrations/0117_query_performance_indexes_partials.sql:12`

## 3. Potential Table Scans

1. `confirmed` High: MAR today and overdue views can bypass the `scheduled_time` index
Why it could become slow:
- The views wrap `ms.scheduled_time` in `timezone(... )::date`.
- That kind of function-on-column filter often prevents clean use of a normal b-tree timestamp index.
- These views are hit repeatedly by dashboard and workflow reads.
Evidence:
- `supabase/migrations/0028_pof_seeded_mar_workflow.sql:281`
- `supabase/migrations/0030_mar_overdue_view.sql:28`
- Consumer queries: `lib/services/mar-workflow-read.ts:205`, `lib/services/mar-workflow-read.ts:206`, `lib/services/mar-dashboard-read-model.ts:18`, `lib/services/mar-dashboard-read-model.ts:35`, `lib/services/mar-dashboard-read-model.ts:55`
Smallest clean fix:
- Rewrite the views or move to RPCs that filter by UTC range boundaries for the Eastern day instead of casting the column.

2. `confirmed` Medium: MAR history view likely needs to sort a growing table
Why it could become slow:
- `v_mar_administration_history` orders all rows by `administered_at desc`.
- The service then reads recent history with a limit, but there is no dedicated index for that sort path.
Evidence:
- `supabase/migrations/0028_pof_seeded_mar_workflow.sql:336`
- `lib/services/mar-workflow-read.ts:208`

3. `likely` Medium: `syncTodayMarSchedules` can scan too much of `pof_medications`
Why it could become slow:
- The sync loads all active center-administered non-PRN MHP medications, then computes affected members in application code.
- There is no obvious index aligned to `active + given_at_center + prn + source_medication_id like 'mhp-%'`.
Evidence:
- `lib/services/mar-workflow-read.ts:110`
- Existing `pof_medications` indexes are member/order oriented, not this global scan path.

## 4. N+1 Query Patterns

1. `confirmed` Medium: MAR reconciliation is called once per member in a burst
Why it could become slow:
- After the freshness comparison, the code calls the reconcile RPC once per impacted member.
- That is not a UI N+1, but it is still repeated query work inside a loop and can create spikes when many members changed.
Evidence:
- `lib/services/mar-workflow-read.ts:169`
- `lib/services/mar-workflow-read.ts:171`
Impact:
- A heavy medication refresh day can fan out into many back-to-back RPC calls.

2. `confirmed` Medium: sales follow-up dashboard runs four extra count queries on the same table
Why it could become slow:
- The dashboard already loads the paged lead list, then separately counts overdue, due today, upcoming, and missing follow-up buckets.
- That is five lead queries for one screen.
Evidence:
- `lib/services/sales-crm-read-model.ts:763`
- `lib/services/sales-crm-read-model.ts:771`
- `lib/services/sales-crm-read-model.ts:772`
- `lib/services/sales-crm-read-model.ts:773`
- `lib/services/sales-crm-read-model.ts:774`
Impact:
- This multiplies load on `leads` as traffic grows.

No other clear classic per-row Supabase N+1 patterns were confirmed in the highest-priority member, MHP, care plan, member file, and audit-report screens. Most expensive paths are over-fetching or repeated dashboard queries rather than row-by-row fetch loops.

## 5. Inefficient Data Fetching

1. `confirmed` High: MHP index pulls all assessments for each page of members, then keeps only the latest one
Why it could become slow:
- The screen paginates members, but for those members it loads every matching assessment row and only keeps the first row per member in memory.
- As assessment history grows, that read gets wider and wider without improving the screen.
Evidence:
- `lib/services/member-health-profiles-supabase.ts:544`
- `lib/services/member-health-profiles-supabase.ts:550`
- `lib/services/member-health-profiles-supabase.ts:569`

2. `confirmed` Medium: MHP detail loads full provider and hospital directories on detail reads
Why it could become slow:
- A single member detail read can load every provider and every hospital preference row when the tab plan includes those directories.
- That is full-table fetching for reference data on a member page.
Evidence:
- `lib/services/member-health-profiles-supabase.ts:701`
- `lib/services/member-health-profiles-supabase.ts:704`
Impact:
- Fine today if those tables stay small; risky if they become broad reference directories.

3. `confirmed` High: reporting snapshot loads all progress notes for up to 200 members
Why it could become slow:
- The reports home fetches up to 200 tracker rows, then loads all progress notes for those member IDs.
- The repo already has a consolidated progress-note tracker RPC, but this path bypasses it.
Evidence:
- `lib/services/reports.ts:13`
- `lib/services/reports.ts:32`
- `lib/services/progress-notes-read-model.ts:410`
- `lib/services/progress-notes-read-model.ts:415`
Impact:
- This can get expensive as historical progress notes accumulate.

4. `confirmed` Medium: care plan list helper still loads all rows and filters in JavaScript
Why it could become slow:
- `listCarePlanRows` fetches care plan rows, then applies status and text filters in application memory.
- That means more rows are pulled from Supabase than the caller actually needs.
Evidence:
- `lib/services/care-plans-read-model.ts:205`
- `lib/services/care-plans-read-model.ts:217`
- `lib/services/care-plans-read-model.ts:218`
Note:
- The paged care plan list already has a good RPC-backed path. The problem is the older helper still exists and is used for detail/snapshot helpers.

5. `confirmed` Low: member file single-row helpers still use `select("*")`
Why it could become slow:
- These are not the biggest problems because they are single-row reads.
- Still, they pull the whole row when the caller mostly needs identity or persistence verification.
Evidence:
- `lib/services/member-files.ts:187`
- `lib/services/member-files.ts:203`

## 6. Duplicate Query Logic

1. `confirmed` High: care plan latest-row lookups are duplicated across several helpers
Where:
- `lib/services/care-plans-read-model.ts:518`
- `lib/services/care-plans-read-model.ts:562`
- `lib/services/care-plans-read-model.ts:588`
- `lib/services/care-plans-read-model.ts:542`
Why it matters:
- The codebase has both a strong paged read model RPC and several separate ad hoc latest/snapshot reads.
- That increases maintenance cost and makes it easier for performance fixes to land in one place but not another.

2. `confirmed` Medium: MAR today data is queried in multiple near-identical ways
Where:
- `lib/services/mar-workflow-read.ts:205`
- `lib/services/mar-dashboard-read-model.ts:18`
- `lib/services/mar-dashboard-read-model.ts:35`
- `lib/services/mar-dashboard-read-model.ts:55`
Why it matters:
- The same heavy view is scanned repeatedly with slight filter changes.
- A single RPC or materialized read model would be easier to tune.

3. `confirmed` Medium: member lookup/search logic is spread across MCC and shared lookup services
Where:
- `lib/services/member-command-center-runtime.ts:102`
- `lib/services/member-command-center-runtime.ts:167`
- `lib/services/shared-lookups-supabase.ts:45`
- `lib/services/shared-lookups-supabase.ts:80`
- `lib/services/shared-lookups-supabase.ts:151`
Why it matters:
- This is not the worst performance bug today.
- It does increase the chance that lookup limits, search behavior, or future optimizations drift across modules.

## 7. Recommended Index Additions

Add these first:

1. `create index if not exists idx_care_plans_member_review_updated_desc on public.care_plans (member_id, review_date desc, updated_at desc);`
Use for:
- latest care plan by member
- care plan summary / overview / latest-id helpers

2. `create index if not exists idx_mar_administrations_status_date_administered_desc on public.mar_administrations (status, administration_date desc, administered_at desc);`
Use for:
- `v_mar_not_given_today`
- same-day MAR exception views

3. `create index if not exists idx_mar_administrations_administered_at_desc on public.mar_administrations (administered_at desc);`
Use for:
- recent administration history
- dashboard recent MAR history

4. `create index if not exists idx_leads_caregiver_email_trgm on public.leads using gin (caregiver_email gin_trgm_ops);`
Use for:
- enrollment packet eligible lead picker search

Optional but worth validating after the first pass:

5. A partial index or RPC rewrite for MAR medication freshness reads, for example a partial index scoped to active center-administered non-PRN MHP medications.
Reason:
- The current sync path still does a broad scan before deciding which members need reconciliation.

## 8. Performance Hardening Plan

Phase 1: Highest-impact fixes
- Rewrite `v_mar_today` and `v_mar_overdue_today` to use Eastern day start/end timestamps instead of `timezone(...column...)::date`.
- Add the two MAR administration indexes above.
- Add the care plan latest-row index.

Phase 2: Reduce over-fetching
- Change MHP index reads to fetch only the latest assessment per member, ideally in SQL or an RPC.
- Replace report-home progress note aggregation with the existing progress-note tracker read model or a dedicated summary RPC.
- Stop loading full provider and hospital directories on member detail unless that tab is actually open.

Phase 3: Consolidate duplicated reads
- Replace the four sales follow-up bucket counts with one RPC-backed summary call.
- Consolidate latest-care-plan helpers onto one read path.
- Consider one consolidated MAR dashboard RPC instead of multiple `v_mar_today` reads.

Phase 4: Verify with data
- Run `EXPLAIN ANALYZE` on the MAR views after the view rewrite.
- Capture slow-query logs for `care_plans`, `mar_administrations`, `pof_medications`, and `leads`.
- Re-audit once production row counts are available, especially for MAR and progress notes.

## 9. Suggested Codex Prompts

1. `Audit and fix MAR read performance. Rewrite v_mar_today and v_mar_overdue_today so they filter by explicit Eastern day start/end timestamps instead of timezone(column)::date, add the missing mar_administrations indexes, and verify every current MAR consumer still works. Keep Supabase as source of truth and prefer the smallest safe schema/runtime change.`

2. `Add a production-safe care plan performance hardening pass. Create a forward-only migration adding an index on care_plans(member_id, review_date desc, updated_at desc), then simplify duplicated latest-care-plan queries so member overview, summary, and latest-id helpers share one canonical read path.`

3. `Reduce over-fetching in the Member Health Profile index. The current code loads all intake assessments for the paged members and then keeps only the latest one in memory. Replace that with a SQL/RPC path that returns only the latest assessment per member while preserving current UI behavior and canonical member resolution.`

4. `Harden progress note reporting performance. The reports home currently loads all progress notes for up to 200 members just to compute reminder state. Replace that with the existing progress-note tracker read model or a dedicated summary RPC so the page stops pulling full note history.`

5. `Consolidate the sales lead follow-up dashboard into a single read model. Right now the page does one paged leads query plus four separate count queries for overdue, due today, upcoming, and missing follow-up buckets. Replace that with one RPC or another canonical read path that returns the page rows and summary together.`

6. `Evaluate whether leads.caregiver_email search needs a trigram index. Confirm the enrollment packet eligible lead picker and any other sales searches use caregiver_email.ilike, add the smallest safe index migration if warranted, and document expected impact.`

## 10. Founder Summary: What changed since the last run

There was no stored automation memory or prior report to diff against, so this run is the new baseline.

What is different from an earlier broad-strokes performance concern list:

- The repo already has many of the obvious indexing fixes in place. Recent migrations covered a lot of member lookup, enrollment packet, FK, and general search support.
- Because of that, the open issues are now narrower and more practical: MAR date filtering, care plan latest-row sorting, MHP/report over-fetching, and duplicated sales follow-up reads.
- The biggest remaining risk is not "Supabase is generally under-indexed." The bigger risk is that a few important read models still force Postgres to do more work than the screen needs.

If you want the smallest high-value next step, fix MAR read planning first, then care plan latest-row lookups, then progress note/MHP over-fetching.
