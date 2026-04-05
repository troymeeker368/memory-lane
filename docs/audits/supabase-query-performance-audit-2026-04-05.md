# Supabase Query Performance Audit

Date: 2026-04-05
Automation: Supabase Query Performance Audit

## 1. Executive Summary

This repo is in better shape than yesterday's baseline.

The biggest items from the last run are no longer open:

- MAR day-boundary reads were hardened in `supabase/migrations/0187_mar_view_boundary_index_hardening.sql`.
- The care plan latest-row sort index now exists in `supabase/migrations/0188_care_plan_latest_member_review_index.sql`.
- The MHP index page no longer pulls assessment history per member; it now reads `latest_assessment_*` directly from `members` in `lib/services/member-health-profiles-supabase.ts:518`.

That means the current performance risk has shifted.

The main issues now are:

1. `confirmed` High: the documentation dashboard still loads the full `documentation_tracker` table and then loads progress-note history for all returned members in app memory (`lib/services/documentation.ts:156`).
2. `confirmed` High: documentation tracker due-date reads still do not have due-date indexes, so overdue alert checks and ordered list reads can degrade into wider scans (`lib/services/dashboard.ts:82`, `lib/services/documentation.ts:158`, `lib/services/reports.ts:42`).
3. `confirmed` Medium: the sales follow-up dashboard still does one paged `leads` query plus four extra count queries over the same population (`lib/services/sales-crm-read-model.ts:758`).
4. `confirmed` Medium: enrollment packet eligible-lead search still uses `caregiver_email.ilike(...)` without a matching trigram index (`lib/services/sales-crm-read-model.ts:447`).
5. `likely` Medium: MAR schedule freshness sync still scans the whole active center-administered MHP medication set before deciding which members actually need reconciliation (`lib/services/mar-workflow-read.ts:110`).

## 2. Missing Indexes

1. `confirmed` `documentation_tracker(next_care_plan_due)` with an open-care-plan predicate
Why it matters:
- The dashboard alert checks for any overdue care plan with `next_care_plan_due < today` and `care_plan_done = false`.
- The documentation tracker page also orders by `next_care_plan_due`.
- I found only `member_id` and `assigned_staff_user_id` indexes for this table, not any due-date index.
Evidence:
- Query paths: `lib/services/dashboard.ts:82`, `lib/services/documentation.ts:158`
- Existing indexes: `supabase/migrations/0175_fk_covering_indexes_hardening.sql:237`

2. `confirmed` Trigram index for `leads.caregiver_email`
Why it matters:
- The enrollment packet eligible-lead picker searches `member_name`, `caregiver_name`, and `caregiver_email`.
- The repo already has trigram indexes for `member_name` and `caregiver_name`, but not for `caregiver_email`.
Evidence:
- Search query: `lib/services/sales-crm-read-model.ts:447`
- Existing search indexes: `supabase/migrations/0117_query_performance_indexes_partials.sql:12`

3. `likely` Partial index for the MAR MHP sync scan
Why it matters:
- `syncTodayMarSchedules` filters `pof_medications` by `active = true`, `given_at_center = true`, `prn = false`, and `source_medication_id like 'mhp-%'`, then evaluates member freshness in memory.
- Current indexes are member-oriented, not aligned to this global sync pass.
Evidence:
- Query path: `lib/services/mar-workflow-read.ts:110`
- Existing indexes: `supabase/migrations/0028_pof_seeded_mar_workflow.sql:29`

No confirmed missing index remains for yesterday's care plan latest-row lookup or MAR history/day-boundary read paths. Those are now covered by `0187` and `0188`.

## 3. Potential Table Scans

1. `confirmed` High: documentation tracker overdue checks can scan the tracker table
Why it could become slow:
- The alert query filters on `next_care_plan_due` and `care_plan_done`, but there is no matching due-date index.
- Even though the code only needs one row, Postgres may still inspect a large part of the table to find it.
Evidence:
- `lib/services/dashboard.ts:82`
- `supabase/migrations/0175_fk_covering_indexes_hardening.sql:237`
Estimated scaling risk:
- Near-term

2. `confirmed` High: documentation tracker page pulls the full tracker list and sorts by due date
Why it could become slow:
- `getDocumentationTracker` has no pagination and no limit.
- It orders the entire table by `next_care_plan_due` and then does additional progress-note work for every returned member.
Evidence:
- `lib/services/documentation.ts:156`
Estimated scaling risk:
- Near-term

3. `confirmed` Medium: enrollment packet lead picker search can fall back to a slower email scan
Why it could become slow:
- `caregiver_email.ilike(...)` is part of the OR search, but the repo does not show a trigram index for that column.
- That means the email branch of the search can become the expensive part as `leads` grows.
Evidence:
- `lib/services/sales-crm-read-model.ts:452`
- `supabase/migrations/0117_query_performance_indexes_partials.sql:12`
Estimated scaling risk:
- Near-term

4. `likely` Medium: MAR freshness sync can read too much of `pof_medications`
Why it could become slow:
- The sync pass starts by loading every active, center-administered, non-PRN, MHP-sourced medication row before narrowing to changed members.
- That is acceptable at small scale, but expensive as medication history grows.
Evidence:
- `lib/services/mar-workflow-read.ts:110`
Estimated scaling risk:
- Near-term

## 4. N+1 Query Patterns

1. `confirmed` Medium: sales follow-up dashboard still fans out into five `leads` reads
Why it could become slow:
- The page loads one paged lead list, then separately counts overdue, due today, upcoming, and missing follow-up buckets.
- That is repeated query work against the same table for one screen.
Evidence:
- `lib/services/sales-crm-read-model.ts:763`
- `lib/services/sales-crm-read-model.ts:771`
Estimated scaling risk:
- Near-term

No classic per-row Supabase N+1 pattern was confirmed in member lists, MAR dashboard reads, audit logs, or member files during this run. The bigger problem now is repeated dashboard queries and broad list reads rather than one-query-per-row loops.

## 5. Inefficient Data Fetching

1. `confirmed` High: documentation tracker reads all rows, then loads all progress-note reminder source rows for those members
Why it could become slow:
- The tracker query returns the entire `documentation_tracker` table.
- Then `getProgressNoteReminderRows` loads all progress note reminder source rows for the same member set and computes compliance in application memory.
- The repo already has a consolidated progress-note tracker RPC, but this path bypasses it.
Evidence:
- `lib/services/documentation.ts:156`
- `lib/services/progress-notes-read-model.ts:100`
- Consolidated RPC exists in `supabase/migrations/0130_progress_note_tracker_read_model_consolidation.sql:1`
Estimated scaling risk:
- Near-term

2. `confirmed` Medium: reports home still duplicates documentation tracker work with a second progress-notes read
Why it could become slow:
- The reports page loads up to 200 tracker rows, then separately queries `progress_notes` to find draft members.
- This is lighter than the documentation dashboard path, but it still duplicates reminder-state work instead of using one canonical read model.
Evidence:
- `lib/services/reports.ts:33`
- `lib/services/reports.ts:61`
Estimated scaling risk:
- Near-term

3. `confirmed` Low: member detail pages still re-load small reference tables on demand
Why it could become slow:
- Member Command Center detail always loads the whole `bus_stop_directory`.
- Some MCC billing helpers and profile helpers still use `select("*")`, which increases payload width even when callers do not need every field.
Evidence:
- `lib/services/member-command-center-runtime.ts:629`
- `lib/services/member-command-center-supabase.ts:67`
- `lib/services/member-command-center-supabase.ts:101`
- `lib/services/member-command-center-supabase.ts:176`
Estimated scaling risk:
- Long-term

## 6. Duplicate Query Logic

1. `confirmed` High: documentation tracker and reports both rebuild progress-note reminder state outside the canonical progress-note tracker RPC
Where:
- `lib/services/documentation.ts:156`
- `lib/services/reports.ts:33`
- Canonical tracker RPC consumer: `lib/services/progress-notes-read-model.ts:260`
Why it matters:
- Performance fixes now need to be applied in multiple places.
- This also increases the chance that one screen shows a different progress-note state from another.

2. `confirmed` Medium: sales follow-up dashboard still bypasses the existing sales summary RPC pattern
Where:
- Follow-up dashboard: `lib/services/sales-crm-read-model.ts:758`
- Existing summary RPC path: `lib/services/sales-workflows.ts:151`
Why it matters:
- The repo already has a canonical summary RPC for sales dashboard metrics, but follow-up buckets still use separate table reads.
- This keeps one of the highest-traffic sales screens on a less efficient path.

## 7. Recommended Index Additions

Add these first:

1. `create index if not exists idx_documentation_tracker_care_plan_due_open on public.documentation_tracker (next_care_plan_due asc, member_id) where care_plan_done = false;`
Use for:
- overdue care plan alerts
- due-date ordered documentation views that focus on incomplete care plan work

2. `create index if not exists idx_leads_caregiver_email_trgm on public.leads using gin (caregiver_email gin_trgm_ops);`
Use for:
- enrollment packet eligible lead picker search

3. `create index if not exists idx_pof_medications_mhp_mar_sync on public.pof_medications (member_id, updated_at desc) where active = true and given_at_center = true and prn = false and source_medication_id like 'mhp-%';`
Use for:
- daily MAR schedule freshness sync

Optional:

4. `create index if not exists idx_documentation_tracker_member_name on public.documentation_tracker (member_name);`
Use only if the alphabetical report slice stays on the current direct-table path.

## 8. Performance Hardening Plan

Phase 1: documentation and report paths
- Add the documentation tracker due-date index.
- Paginate `getDocumentationTracker` instead of loading the full tracker table.
- Stop rebuilding progress-note reminder state by hand on both documentation and reports pages.
- Reuse the canonical progress-note tracker RPC, or add one documentation-specific RPC if the tracker screen truly needs combined care-plan and progress-note state.

Phase 2: sales follow-up dashboard
- Replace the four extra lead bucket count queries with one RPC-backed summary call.
- If needed, extend the existing sales dashboard summary RPC pattern instead of creating a second competing summary path.

Phase 3: MAR freshness sync
- Add a narrower partial index for the MHP medication sync path.
- Consider a shared RPC that returns only members whose medication state changed since the last schedule generation instead of scanning the full active set in application code.

Phase 4: low-risk cleanup
- Narrow `select("*")` usage in MCC billing/profile helpers where callers only need a subset of fields.
- Avoid reloading small shared lookup tables on every detail page if they can be fetched once at a more stable boundary.

## 9. Suggested Codex Prompts

1. `Harden the documentation dashboard query path. Add the smallest safe documentation_tracker due-date index, paginate getDocumentationTracker, and replace the current load-all tracker plus load-all progress note reminder pattern with a canonical read model. Keep Supabase as source of truth and avoid introducing duplicate reminder logic.`

2. `Refactor the reports home progress-note draft indicator to stop doing a second ad hoc progress_notes lookup. Reuse the canonical progress note tracker RPC or create one small shared helper so reporting and documentation screens stop computing reminder state differently.`

3. `Optimize the sales follow-up dashboard. Replace the current one paged leads query plus four extra count queries with one canonical RPC-backed summary path, preserving the current UI output and sorting behavior.`

4. `Evaluate and, if justified, add a trigram index for leads.caregiver_email. The enrollment packet eligible lead picker currently searches caregiver_email with ilike but the repo only shows trigram indexes for member_name and caregiver_name. Add the smallest safe migration and document expected impact.`

5. `Harden MAR freshness sync performance. Review syncTodayMarSchedules, add a production-safe partial index for active center-administered MHP medications if warranted, and reduce the amount of pof_medications data scanned before deciding which members need schedule regeneration.`

## 10. Founder Summary: What changed since the last run

This run is meaningfully better than yesterday's baseline.

What improved:

- Yesterday's biggest MAR issue is no longer open. `supabase/migrations/0187_mar_view_boundary_index_hardening.sql` rewrote `v_mar_today` and `v_mar_overdue_today` to use explicit Eastern day start/end timestamps and added the missing `mar_administrations` indexes.
- Yesterday's care plan latest-row index gap is also no longer open. `supabase/migrations/0188_care_plan_latest_member_review_index.sql` now covers the `member_id + review_date + updated_at` sort path.
- The MHP index page no longer loads assessment history for every member on the page. It now reads `latest_assessment_*` directly from `members` and gets summary counts from `rpc_get_member_health_profile_summary_counts`.

What is still open:

- Documentation and report screens are now the main query risk. They still do broader tracker and progress-note reads than they need.
- The sales follow-up dashboard still does repeated `leads` queries instead of one canonical summary path.
- Lead picker search still has a likely email-search indexing gap.
- MAR schedule freshness sync still scans a wider medication set than necessary.

If you want the highest-value next fix now, start with the documentation tracker/report path. That is the clearest remaining place where the app is still doing more Supabase read work than the screen actually needs.
