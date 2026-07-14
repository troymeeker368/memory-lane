# Supabase Query Performance Audit

Date: 2026-05-12
Automation: Supabase Query Performance Audit

This was a repo-only audit. I reviewed the current code and migrations, but I did not run live `EXPLAIN` plans, Supabase query logs, or `pg_stat_statements`.

## 1. Executive Summary

- `confirmed` High: the sales dashboard summary RPC is still the biggest read-scaling risk. It still canonicalizes the full `leads` population and also does separate whole-table counts for supporting sales tables on every request. Evidence: `supabase/migrations/0209_sales_dashboard_summary_lead_count_slimming.sql:41-90`, `supabase/migrations/0209_sales_dashboard_summary_lead_count_slimming.sql:267-270`, `lib/services/sales-workflows.ts:155-181`.
- `confirmed` High: billing summary and preview paths still do much more work than the UI needs. The preview helper still loads the full active census plus nine related datasets, and the billing dashboard summary still depends on that preview plus month-wide variable-charge reads. Evidence: `lib/services/billing-preview-helpers.ts:186-256`, `lib/services/billing-read-supabase.ts:485-640`, `lib/services/billing-read-supabase.ts:683-725`.
- `confirmed` High: shared member and member-detail screens still front-load expensive reads. Shared member pages still pay `count: "exact"` on first render, member detail still fans out across eight preview tables plus a counts RPC, and MCC detail still loads files, allergies, contacts, care-plan overview, enrollment staging, and assessment existence together. Evidence: `lib/services/member-list-read.ts:70-97`, `lib/services/member-detail-read-model.ts:161-297`, `lib/services/member-command-center-runtime.ts:506-547`.
- `confirmed` Medium: MAR still has the same three scaling risks as yesterday. The sync job still scans full same-day candidate populations, the workflow snapshot still pays exact counts before limited slices, and the health dashboard action queue is still unbounded. Evidence: `lib/services/mar-workflow-read.ts:65-136`, `lib/services/mar-workflow-read.ts:165-217`, `lib/services/mar-dashboard-read-model.ts:27-44`.
- `confirmed` Medium: audit and reporting reads still have broad-scan risk. The audit trail now expands area filters into more wildcard `entity_type.ilike` terms without a plain `created_at desc` index, and the revenue summary still loads all ancillary rows in range before filtering some states in TypeScript. Evidence: `lib/services/admin-audit-trail.ts:81-115`, `supabase/migrations/0048_query_performance_support_indexes.sql:10-14`, `lib/services/admin-reporting-foundation.ts:223-245`.
- `confirmed` Medium: one previous POF over-fetch problem is now fixed. POF request and timeline helpers no longer use `select("*")`; they now use explicit field lists. Evidence: `lib/services/pof-read.ts:15-56`, `lib/services/pof-read.ts:118-205`.

## 2. Missing Indexes

- `confirmed` `audit_logs(created_at desc)`. The main audit trail still reads newest-first across `audit_logs`, but migrations only add `entity_type` and `actor_user_id` leading indexes, not a plain newest-first index. Evidence: `lib/services/admin-audit-trail.ts:103-115`, `supabase/migrations/0048_query_performance_support_indexes.sql:10-14`.
- `confirmed` `community_partner_organizations(organization_name)`. The partner directory still sorts alphabetically and can request exact counts, but the repo still lacks a plain sort index on `organization_name`. Evidence: `lib/services/sales-crm-read-model.ts:402-433`, `supabase/migrations/0209_sales_dashboard_summary_lead_count_slimming.sql:268`.
- `confirmed` `referral_sources(organization_name)`. The referral-source directory uses the same alphabetical sort plus exact-count pattern and still has no plain global `organization_name` index. Evidence: `lib/services/sales-crm-read-model.ts:459-500`, `supabase/migrations/0209_sales_dashboard_summary_lead_count_slimming.sql:269`.
- `confirmed` `member_allergies(member_id, updated_at desc)`. MCC allergy reads still filter by member and sort newest-first, while the current index only enforces uniqueness by `(member_id, allergy_group, lower(allergy_name))`. Evidence: `lib/services/member-command-center-runtime.ts:347-356`, `supabase/migrations/0011_member_command_center_aux_schema.sql:220-221`.
- `confirmed` `billing_export_jobs(generated_at desc, created_at desc)`. Billing export history still sorts globally by generated and created timestamps, but the repo only has a batch-scoped index. Evidence: `lib/services/billing-read-supabase.ts:643-671`, `supabase/migrations/0015_schema_compatibility_backfill.sql:428`.
- `likely` `physician_orders(updated_at desc)` or `(status, updated_at desc)`. The main physician-order list still defaults to newest-first plus `count: "exact"`, while current coverage is member-first. Evidence: `lib/services/physician-orders-read.ts:196-228`, `supabase/migrations/0006_intake_pof_mhp_supabase.sql:127-130`.
- `likely` `mar_schedules(scheduled_time, member_id)` for center-wide day-window reads. Current MAR schedule coverage is `member_id` first, but the sync job reads by day window across the center. Evidence: `lib/services/mar-workflow-read.ts:77-83`, `supabase/migrations/0028_pof_seeded_mar_workflow.sql:54-58`.

## 3. Potential Table Scans

- `confirmed` High: the sales dashboard summary RPC still rebuilds founder metrics from the full `leads` population and separate whole-table counts. This will get more expensive as leads and sales activity grow. Evidence: `supabase/migrations/0209_sales_dashboard_summary_lead_count_slimming.sql:41-90`, `supabase/migrations/0209_sales_dashboard_summary_lead_count_slimming.sql:267-270`.
- `confirmed` High: MAR sync still scans all active MHP-sourced scheduled medications and all same-day schedules before narrowing to changed members in TypeScript. Evidence: `lib/services/mar-workflow-read.ts:65-123`.
- `likely` High: same-day `mar_schedules` reads can still degrade into broad time-window scans because the current index is member-led instead of time-led. Evidence: `lib/services/mar-workflow-read.ts:77-83`, `supabase/migrations/0028_pof_seeded_mar_workflow.sql:54-58`.
- `confirmed` Medium: the audit trail can still devolve into a broad recent-events scan. The query is still `order by created_at desc`, and the area filter now expands into more wildcard `entity_type.ilike` OR terms. Evidence: `lib/services/admin-audit-trail.ts:81-115`.
- `likely` Medium: the revenue summary still reads all ancillary rows in range from `v_ancillary_charge_logs_detailed` and filters voided rows after the read. Evidence: `lib/services/admin-reporting-foundation.ts:223-245`.
- `confirmed` Medium: the sales partner and referral directories still combine exact counts with unsupported global alphabetical sorts. Evidence: `lib/services/sales-crm-read-model.ts:402-433`, `lib/services/sales-crm-read-model.ts:459-500`.

## 4. N+1 Query Patterns

- `confirmed` Medium: MAR refresh still does one member-level reconciliation call per changed member after the initial population scan. That is still the clearest workflow-level N+1 in a high-volume clinical path. Evidence: `lib/services/mar-workflow-read.ts:115-136`.
- `confirmed` Low: member files still can trigger a second `member_files` read for every page that contains rows missing `storage_object_path`, because legacy inline detection happens with a follow-up `.in("id", missingStorageIds)` query. Evidence: `lib/services/member-command-center-runtime.ts:306-324`.
- `confirmed` Low: no new true page-level Supabase query-inside-loop regressions were confirmed in the requested hot paths. Residual risk remains in fixed fan-out pages, but I did not find new per-row UI loop queries.

## 5. Inefficient Data Fetching

- `confirmed` High: shared member list pages still pay `count: "exact"` before returning the current page. That shared helper still feeds multiple member-facing list screens. Evidence: `lib/services/member-list-read.ts:70-97`.
- `confirmed` High: member detail still opens with eight preview queries, a counts RPC, and a care-plan preview load. The care-plan side is slimmer than before, but the overall first-load fan-out is still heavy. Evidence: `lib/services/member-detail-read-model.ts:161-297`.
- `confirmed` Medium: MCC detail still front-loads more data than a typical first render needs, including files, allergies, contacts, care-plan overview, enrollment staging, and assessment existence. Evidence: `lib/services/member-command-center-runtime.ts:506-547`.
- `confirmed` Medium: care-plan reads still duplicate member-scoped work. `getMemberCarePlanOverview()` and `getMemberCarePlanPreview()` both call `getLatestCarePlanSummaryRow()` and both pay `count: "exact"` on `care_plans`, and preview can still do an extra fallback fetch if the latest row is outside the preview slice. Evidence: `lib/services/care-plans-read-model.ts:578-638`.
- `confirmed` Medium: MHP first render is still better than the older “load everything” behavior, but the deferred overview supplement now inherits care-plan exact-count work through `getMemberCarePlanSnapshot()`. That means a deferred panel is still paying a count-heavy helper even when it mainly needs summary data. Evidence: `lib/services/member-health-profiles-read.ts:42-59`, `lib/services/care-plans-read-model.ts:606-644`.
- `confirmed` High: billing preview still loads the full active member list and nine supporting datasets across a multi-month window before assembling preview rows. Evidence: `lib/services/billing-preview-helpers.ts:186-256`.
- `confirmed` High: the variable-charge queue still loads full month-wide transportation, ancillary, and adjustment datasets, then removes billed or excluded rows in TypeScript. Evidence: `lib/services/billing-read-supabase.ts:485-640`.
- `confirmed` Medium: billing dashboard summary is still coupled to heavy reads because it depends on full preview generation, the variable-charge queue, and full batch history. Evidence: `lib/services/billing-read-supabase.ts:683-725`.
- `confirmed` Medium: MAR workflow snapshot still pays exact counts before loading capped slices from `v_mar_today` and `v_mar_overdue_today`. Evidence: `lib/services/mar-workflow-read.ts:165-217`.
- `confirmed` Medium: the health dashboard MAR action queue is still unbounded inside its 12-hour window. Evidence: `lib/services/mar-dashboard-read-model.ts:27-44`.
- `confirmed` Medium: billing export reads still use `select("*")` for billing batches, invoices, and invoice lines in two export builders, which is wider than the export formats need. Evidence: `lib/services/billing-exports.ts:61-105`, `lib/services/billing-exports.ts:317-339`.

## 6. Duplicate Query Logic

- `confirmed` Medium: care-plan overview and preview still duplicate count and latest-row work for the same member request. Evidence: `lib/services/care-plans-read-model.ts:578-638`.
- `confirmed` Medium: billing export query stacks are still duplicated between `createBillingExport()` and `buildQuickBooksCsvForInvoiceIds()`. Both rebuild invoice, invoice-line, payor, and attendance context separately. Evidence: `lib/services/billing-exports.ts:61-105`, `lib/services/billing-exports.ts:317-360`.
- `confirmed` Low: sales partner and referral directory helpers still keep separate count and non-count branches with mostly the same filters and sort logic. That increases drift risk when performance tuning changes later. Evidence: `lib/services/sales-crm-read-model.ts:402-433`, `lib/services/sales-crm-read-model.ts:459-500`.
- `confirmed` Medium: billing summary facts are still rebuilt in overlapping places across the dashboard summary, preview helper, and variable-charge queue. Evidence: `lib/services/billing-read-supabase.ts:485-725`, `lib/services/billing-preview-helpers.ts:186-256`.

## 7. Recommended Index Additions

Add these first:

1. `create index if not exists idx_audit_logs_created_at_desc on public.audit_logs (created_at desc);`
2. `create index if not exists idx_community_partner_organizations_organization_name on public.community_partner_organizations (organization_name);`
3. `create index if not exists idx_referral_sources_organization_name on public.referral_sources (organization_name);`
4. `create index if not exists idx_member_allergies_member_updated_at_desc on public.member_allergies (member_id, updated_at desc);`
5. `create index if not exists idx_billing_export_jobs_generated_created_desc on public.billing_export_jobs (generated_at desc, created_at desc);`

Verify with live query plans before adding:

6. `create index if not exists idx_physician_orders_updated_at_desc on public.physician_orders (updated_at desc);`
7. `create index if not exists idx_mar_schedules_scheduled_time_member_id on public.mar_schedules (scheduled_time, member_id);`

Indexes alone will not fix:

- the sales dashboard summary RPC full-table aggregation
- billing preview and queue over-fetching
- shared member first-render exact counts
- member detail and MCC first-load fan-out
- MAR action queue bounding

## 8. Performance Hardening Plan

1. Slim the sales dashboard summary RPC first. Keep one canonical RPC boundary, but stop rebuilding founder metrics from the full `leads` table and unrelated whole-table counts on every request.
2. Split billing summary cards from billing preview and variable-charge queue workloads. Dashboard headline numbers should not require the full billing generation preview.
3. Add the five confirmed missing read indexes. These are the safest immediate wins.
4. Stop paying `count: "exact"` on first render unless the screen truly needs an exact total. Start with shared member lists, physician-order index pages, MAR workflow totals, and sales partner/referral directories.
5. Push more filtering into SQL for billing queue reads. Fetch only queue-eligible transportation, ancillary, and adjustment rows instead of whole-month raw rows.
6. Reduce first-load member fan-out. Keep canonical service boundaries, but lazy-load non-primary panels on member detail and MCC detail where that will not hide operational truth.
7. Tighten care-plan read helpers. One canonical helper should provide summary, latest row, and optional counts without forcing every caller to pay the same cost.
8. Bound dashboard queues and history windows. Add a hard cap to the health-dashboard MAR action query and keep export-job history explicitly limited.
9. Narrow payload width in billing exports. Replace remaining `select("*")` reads with explicit field lists.
10. Validate the top paths with live evidence next. The next pass should use Supabase query logs or `EXPLAIN` for the sales RPC, billing preview, MAR sync, audit trail, and shared member index.

## 9. Suggested Codex Prompts

1. `Slim the Memory Lane sales dashboard summary RPC. Keep one canonical Supabase RPC boundary, but stop rebuilding founder dashboard state from the full leads table and reduce unrelated whole-table counts from each request. Preserve current numbers.`
2. `Refactor the Memory Lane billing dashboard summary so headline summary cards do not run the full billing preview helper, the full prior-month variable-charge queue, and full batch history on every request. Keep Supabase as source of truth and preserve current totals.`
3. `Add a forward-only Supabase migration for the remaining confirmed read indexes from the 2026-05-12 query audit: audit_logs(created_at desc), community_partner_organizations(organization_name), referral_sources(organization_name), member_allergies(member_id, updated_at desc), and billing_export_jobs(generated_at desc, created_at desc).`
4. `Review Memory Lane exact-count usage in shared member lists, physician-order list pages, MAR workflow reads, care-plan preview helpers, and sales partner/referral directories. Keep UX intact, but defer or remove exact counts where first render does not strictly need them.`
5. `Refactor Memory Lane variable-charge queue reads so billed and excluded rows are filtered in SQL instead of loaded into TypeScript first. Preserve current business rules and dashboard totals.`
6. `Reduce first-load Supabase query fan-out for member detail and Member Command Center detail screens. Preserve canonical shared services, keep role restrictions, and lazy-load non-primary supporting panels where safe.`
7. `Review Memory Lane MAR workflow reads. Remove unnecessary exact-count work, evaluate a scheduled_time-led index for day-window reads, move candidate detection closer to SQL or RPC, and add a hard limit to the founder-facing MAR action queue.`
8. `Refactor Memory Lane care-plan read helpers so overview, preview, and snapshot callers do not all pay duplicated exact-count and latest-row work. Preserve canonical service boundaries and current UI data.`
9. `Tighten Memory Lane billing export read models by replacing remaining select(*) calls with narrower field lists and consolidating duplicate invoice/invoice-line query stacks. Preserve current exports and idempotency behavior.`

## 10. Founder Summary: What changed since the last run

What improved:

- POF request and timeline reads are leaner now. The current code no longer uses `select("*")` in `pof_read.ts`; it now fetches explicit request and event columns only.

What worsened:

- The audit trail area filter is still broader than yesterday’s baseline. It now tokenizes the input and expands it into more wildcard `entity_type.ilike` terms, but the plain `audit_logs(created_at desc)` index is still missing.

What newly surfaced:

- The newer care-plan preview consolidation fixed one duplicate member-detail read path, but it also means `getMemberCarePlanSnapshot()` now inherits the preview helper’s `count: "exact"` work. That cost now shows up in the deferred MHP overview supplement too.

What did not materially improve:

- The sales dashboard summary RPC is still the biggest read-scaling risk.
- Billing summary cards still depend on heavy preview and queue reads.
- Shared member lists still pay exact counts on first render.
- Member detail and MCC detail still front-load too many cross-domain reads.
- MAR still does whole-population candidate scans, exact counts on large views, and an unbounded dashboard action queue.
- Billing exports still over-fetch with `select("*")`.

What to focus on next:

1. Slim the sales dashboard summary RPC first.
2. Split billing summary cards from billing preview and queue workloads.
3. Add the five confirmed missing indexes.
4. Remove first-render exact counts where the page does not truly need them.
5. Tighten care-plan helper cost so deferred overview panels do not pay unnecessary count work.
