# Supabase Query Performance Audit - 2026-03-21

## 1. Executive Summary

This run found meaningful improvement in several previously hot paths:

- `getMemberHealthProfileIndexSupabase()` now pages members in SQL and uses a summary-count RPC instead of re-reading the full filtered member set.
- `getCarePlans()` now uses a summary-count RPC, and the repo now includes a global `care_plans(next_due_date)` index.
- `getMemberCommandCenterIndexSupabase()` now reads paged members plus slim MCC/schedule selects instead of broad `select("*")` list reads.
- `getMarWorkflowSnapshot()` no longer reconciles schedules on every read by default. Reconcile now only runs when `reconcileToday` is explicitly requested.
- `listMemberFilesSupabase()` no longer pulls `file_data_url` into list views.
- `getSalesReferralSourceDirectoryPageSupabase()` now batches only the current page's partner rows instead of preloading a large partner set.

The biggest remaining risks are now concentrated in four areas:

- sales dashboards still read the full `leads` table to build summary metrics in app memory;
- wildcard search paths still lack search-oriented indexes, especially for members, sales partner directories, and audit-log area filtering;
- cross-domain detail/snapshot pages still fan out into many broad reads, with some paths still using `select("*")` and no history limits;
- workflow alert de-dup reads still query `system_events.correlation_id` without repo evidence of a supporting index.

Because this audit is code-and-schema based, not telemetry based, anything labeled `likely` still needs runtime confirmation with real row counts or query plans.

## 2. Missing Indexes

- High, confirmed: `members.display_name` still has no repo evidence of a trigram/GIN search index, even though member lookup, MCC member search, MHP summary counts, and care-plan search all depend on `ilike '%...%'`. Current callers include `lib/services/member-command-center-supabase.ts`, `lib/services/shared-lookups-supabase.ts`, and `supabase/migrations/0102_mhp_summary_counts_rpc.sql`. Scaling risk: near-term. Recommended fix: add `pg_trgm` and a GIN index on `members.display_name`.

- High, confirmed: `system_events` still has no repo evidence of a `correlation_id` index, but alert de-dup reads filter by `event_type`, `entity_type`, `correlation_id`, `status`, and sometimes `entity_id` in `lib/services/workflow-observability.ts`. Scaling risk: near-term. Recommended fix: add a composite index centered on `correlation_id` plus open-alert fields.

- High, confirmed: there is still no repo evidence of staff/date or member/date indexes for `blood_sugar_logs`, `member_photo_uploads`, or `ancillary_charge_logs`, but those tables are queried by time range in `lib/services/activity-snapshots.ts`, `lib/services/member-detail-read-model.ts`, and `lib/services/staff-detail-read-model.ts`. Scaling risk: near-term. Recommended fix: add `(member_id, checked_at desc)` and `(nurse_user_id, checked_at desc)` for blood sugar, `(member_id, uploaded_at desc)` and `(uploaded_by, uploaded_at desc)` for photo uploads, and `(member_id, service_date desc)` plus `(staff_user_id, created_at desc)` for ancillary logs.

- Medium, confirmed: sales partner and referral directory search still has no repo evidence of search-oriented indexes for `community_partner_organizations.organization_name` or `referral_sources.contact_name / organization_name`, but the directory pages use wildcard `ilike` search across those fields in `lib/services/sales-crm-supabase.ts`. Scaling risk: near-term. Recommended fix: add trigram/GIN indexes for the main searched text columns.

- Medium, likely: `partner_activities` still has no repo evidence of an index on `activity_at` or `(partner_id, activity_at desc)`, but recent-activity and partner-detail reads order by that column. Scaling risk: medium-term. Recommended fix: add an index that matches the dominant sort/filter path.

## 3. Potential Table Scans

- High, confirmed: member search still uses leading-wildcard `ilike` predicates. `listMembersSupabase()` and the paged member list use `display_name.ilike.%query%` and now also `locker_number.ilike.%query%` in `lib/services/member-command-center-supabase.ts`. Without trigram search support, those are likely to scan large portions of `members` as the census grows. Recommended fix: add trigram search support or move to a dedicated search RPC.

- High, confirmed: audit-log area filtering still builds `entity_type.ilike.%term%` predicates in `lib/services/admin-audit-trail.ts`. The existing btree index on `(entity_type, created_at desc)` is unlikely to help much with leading wildcards. Scaling risk: near-term. Recommended fix: either add a trigram index on `audit_logs.entity_type` or persist a normalized audit-area column and filter on exact values.

- High, confirmed: `getSalesSummarySnapshotSupabase()` still reads the entire `leads` table for stage aggregation with `.select("stage, status, lead_source")` in `lib/services/sales-crm-supabase.ts`. `getSalesOpenLeadSummary()` also reads all lead rows with `.select("stage, status")` in `lib/services/sales-workflows.ts`. These will become slower and more expensive as leads accumulate because the work is done in app memory instead of SQL. Recommended fix: replace both with one shared SQL/RPC aggregate.

- Medium, confirmed: sales partner and referral directory pages still use wide wildcard search predicates over multiple text columns in `lib/services/sales-crm-supabase.ts`. Without search-oriented indexes, those queries are likely to degrade into scans as the CRM directory grows. Recommended fix: add trigram indexes or narrow search to the few fields users actually use.

## 4. N+1 Query Patterns

- Medium, likely: `listMemberAttendanceSchedulesForMembers()` still falls back to `ensureMemberAttendanceScheduleSupabase()` once per missing member in `lib/services/member-command-center-supabase.ts`. That is better than the old MCC index behavior because it is no longer in the main list page, but it is still a per-member read/write fan-out when canonical schedules are missing. Scaling risk: medium-term. Recommended fix: add a bulk ensure RPC or bulk insert path for missing schedules.

- Medium, likely: `syncTodayMarSchedules()` still calls `generateMarSchedulesForMember()` once per candidate member when reconciliation is enabled in `lib/services/mar-workflow.ts`. This is no longer on the default MAR read path, which is an improvement, but any caller that enables `reconcileToday` can still trigger per-member fan-out. Scaling risk: medium-term. Recommended fix: keep reconciliation off normal reads and move batch reconcile to an explicit background/admin action.

- No other high-priority list pages showed a confirmed row-by-row N+1 pattern this run. The worst older MHP and MCC list-path fan-outs have been materially reduced.

## 5. Inefficient Data Fetching

- High, confirmed: `getMemberDetail()` in `lib/services/member-detail-read-model.ts` still loads full histories from eight tables with `select("*")` and no result limits. A single detail view can pull every activity, toilet, shower, transportation, blood sugar, ancillary, assessment, and photo row for one member. Scaling risk: near-term on members with long histories. Recommended fix: page these histories and stop using `select("*")`.

- High, confirmed: `getStaffDetail()` in `lib/services/staff-detail-read-model.ts` still reads eight history tables with `select("*")`. It at least limits row count, but it still pulls full row payloads for each table and relies on indexes that are incomplete for some staff/date patterns. Scaling risk: near-term. Recommended fix: trim selects to UI-needed columns and add the missing staff/date indexes.

- Medium, confirmed: `getStaffActivitySnapshot()` and `getMemberActivitySnapshot()` in `lib/services/activity-snapshots.ts` each fire 8 to 10 separate count+data queries per request. The queries are parallelized, so this is not classic N+1, but the page cost is still high and the blood sugar/photo/ancillary parts are not fully indexed. Scaling risk: near-term. Recommended fix: move these into a narrower RPC or at least page/scope each feed more aggressively.

- Medium, confirmed: `getHealthDashboardData()` in `lib/services/health-dashboard.ts` still loads all active members, then all matching MCC rows and all matching MHP rows to derive the care-alert list. This is better than the older duplicated dashboard path, but it still scales linearly with active census size. Recommended fix: move the alert-summary logic into SQL/RPC or cap the alert feed to the members that actually have flags.

- Medium, confirmed: the on-demand billing and transportation reports in `lib/services/admin-reporting-foundation.ts` still load full row sets into app memory after a count pre-check. The new 2,000-row cap is a good safety guard, but the implementation still does not scale cleanly for broader date ranges. Recommended fix: keep the cap, but move common aggregations and exports toward SQL/RPC when these reports become routine.

## 6. Duplicate Query Logic

- High, confirmed: lead-pipeline aggregation is still duplicated across `lib/services/sales-crm-supabase.ts`, `lib/services/sales-workflows.ts`, and `lib/services/reports-ops.ts`. Some paths use many count queries, while others load all lead rows and summarize in memory. This creates both performance drift and reporting drift. Recommended fix: centralize pipeline summary counts behind one canonical SQL/RPC read model.

- Medium, confirmed: cross-domain activity timelines are now spread across `lib/services/activity-snapshots.ts`, `lib/services/member-detail-read-model.ts`, and `lib/services/staff-detail-read-model.ts`. They hit many of the same tables with slightly different select lists and limits. Recommended fix: centralize these timeline reads into a shared snapshot/detail service or SQL view so index strategy and payload width stay consistent.

- Medium, confirmed: member-search behavior is still split between shared lookups, MCC member lists, care-plan search resolution, and the MHP summary-count RPC. That means one missing search index now hurts several domains at once. Recommended fix: standardize member search behind one shared search helper or RPC.

## 7. Recommended Index Additions

- `create extension if not exists pg_trgm;`
- `create index if not exists idx_members_display_name_trgm on public.members using gin (display_name gin_trgm_ops);`
- `create index if not exists idx_audit_logs_entity_type_trgm on public.audit_logs using gin (entity_type gin_trgm_ops);`
- `create index if not exists idx_system_events_alert_dedupe on public.system_events (correlation_id, event_type, entity_type, status, created_at desc);`
- `create index if not exists idx_blood_sugar_logs_member_checked_at_desc on public.blood_sugar_logs (member_id, checked_at desc);`
- `create index if not exists idx_blood_sugar_logs_nurse_checked_at_desc on public.blood_sugar_logs (nurse_user_id, checked_at desc);`
- `create index if not exists idx_member_photo_uploads_member_uploaded_at_desc on public.member_photo_uploads (member_id, uploaded_at desc);`
- `create index if not exists idx_member_photo_uploads_uploaded_by_uploaded_at_desc on public.member_photo_uploads (uploaded_by, uploaded_at desc);`
- `create index if not exists idx_ancillary_charge_logs_member_service_date_desc on public.ancillary_charge_logs (member_id, service_date desc);`
- `create index if not exists idx_ancillary_charge_logs_staff_created_at_desc on public.ancillary_charge_logs (staff_user_id, created_at desc);`
- `create index if not exists idx_partner_activities_activity_at_desc on public.partner_activities (activity_at desc);`
- `create index if not exists idx_partner_org_name_trgm on public.community_partner_organizations using gin (organization_name gin_trgm_ops);`
- `create index if not exists idx_referral_sources_org_name_trgm on public.referral_sources using gin (organization_name gin_trgm_ops);`
- `create index if not exists idx_referral_sources_contact_name_trgm on public.referral_sources using gin (contact_name gin_trgm_ops);`

## 8. Performance Hardening Plan

1. Replace the sales dashboard lead summaries with one canonical SQL/RPC aggregate and stop reading the full `leads` table into app memory.
2. Add the missing search and alert-dedupe indexes first. These are small, safe schema changes with high upside.
3. Page or cap member-detail and staff-detail history feeds and trim them away from `select("*")`.
4. Consolidate activity snapshot/detail query logic so documentation, blood sugar, photo, ancillary, and sales activity reads stop drifting across modules.
5. If timeline/report pages remain important, add a second pass of staff/date indexes for the remaining documentation and sales activity tables.
6. After the index pass, capture real Supabase/Postgres query plans for member search, audit-log filtering, sales summaries, and activity snapshots before claiming the system is fully hardened.

## 9. Suggested Codex Prompts

- "Add production-safe search indexes for member, audit-log, partner, and referral directory wildcard searches. Use forward-only Supabase migrations and update the affected services only if needed."
- "Refactor sales dashboard summary queries so lead counts and stage summaries come from one canonical SQL or RPC read model instead of loading the full leads table into Node."
- "Harden member and staff detail read models by replacing `select('*')` with minimal column lists and adding pagination/limits for historical activity tables."
- "Design a shared activity snapshot read model for member and staff timelines so documentation, blood sugar, photo, ancillary, and sales activity queries stop duplicating logic and index requirements."
- "Add workflow-alert de-dup indexes for `system_events.correlation_id` and verify the existing alert lookup queries use the new index path."

## 10. Founder Summary: What changed since the last run

Since the March 20 run, the biggest old hotspots are materially better:

- MHP index reads are no longer doing the old full filtered reread for counts. Summary counts now come from `rpc_get_member_health_profile_summary_counts`.
- Care plan summary counts are no longer built from repeated app-side count fan-out. They now come from `rpc_get_care_plan_summary_counts`, and the repo now includes a global `care_plans(next_due_date)` index.
- MCC index reads no longer use the older broad `select("*")` list pattern that the prior audit called out.
- MAR snapshot reads no longer force schedule reconciliation unless a caller explicitly opts in with `reconcileToday`.
- Member file list reads no longer pull inline file payloads.
- Referral-source directory reads no longer preload a large partner list on every request.

What is still not done:

- Sales dashboards still do too much work in app memory.
- Search-heavy paths still need proper search indexes.
- Member/staff detail and snapshot pages still load too much historical data.
- `system_events` still needs a better index for alert de-dup checks.

Net result: the app is in a better place than the March 20 baseline, but the remaining performance risk has shifted away from MHP/care-plan/MCC list pages and toward search, dashboards, reports, and cross-domain history views.
