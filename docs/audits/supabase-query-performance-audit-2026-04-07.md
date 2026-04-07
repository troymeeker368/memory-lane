# Supabase Query Performance Audit

Date: 2026-04-07
Automation: Supabase Query Performance Audit

## 1. Executive Summary

This run is better than the 2026-04-06 audit.

Three important items from the last run are now materially improved:

- Billing invoice date reads now have a direct index in `supabase/migrations/0202_billing_invoice_date_index.sql`.
- Operational reliability snapshot reads now use one shared RPC in `supabase/migrations/0203_operational_reliability_snapshot_rpc.sql` instead of many separate dashboard queries.
- POF expiry reconciliation now has a shared RPC in `supabase/migrations/0204_pof_expiry_reconciliation_rpc.sql`, and the main read model in `lib/services/pof-read.ts` no longer does read-time expiry writes.

The remaining performance risk is narrower than last run, but still real:

1. `confirmed` High: the main MAR workflow page still loads full organization-wide today/overdue/not-given datasets with no paging or hard cap.
2. `confirmed` Medium: the health dashboard hits `v_mar_today` twice for two slightly different slices of the same data.
3. `confirmed` Medium: workflow alert de-dupe checks still query `system_events` without one index that matches the actual lookup shape.
4. `confirmed` Medium: MHP provider and hospital directory search still uses `ilike` without dedicated search indexes.
5. `confirmed` Low: member directory logic is still duplicated across Member Directory, Member Command Center, and MHP index reads.

## 2. Missing Indexes

1. `confirmed` `system_events` open-alert de-dupe index
Why it matters:
- `recordImmediateSystemAlert` and `maybeRecordRepeatedFailureAlert` both check for an already-open alert using `event_type`, `entity_type`, `correlation_id`, `status`, and sometimes `entity_id`.
- Current migrations have separate indexes on `correlation_id`, `event_type`, `status`, and `entity_type`, but not one index that matches this exact lookup.
Evidence:
- Query path: `lib/services/workflow-observability.ts`
- Existing indexes: `supabase/migrations/0042_system_events_audit_trail.sql`, `supabase/migrations/0046_operational_reliability_observability.sql`, `supabase/migrations/0050_workflow_reliability_indexes.sql`, `supabase/migrations/0105_sales_pipeline_summary_rpc_and_search_indexes.sql`

2. `confirmed` `provider_directory.provider_name` trigram search index
Why it matters:
- MHP directory search uses `ilike` against `provider_name` and can be triggered repeatedly from search UI.
- The repo has a normalized uniqueness index, but not a substring search index for this query shape.
Evidence:
- Query path: `lib/services/member-health-profiles-supabase.ts`
- Existing indexes: `supabase/migrations/0012_legacy_operational_health_alignment.sql`

3. `confirmed` `hospital_preference_directory.hospital_name` trigram search index
Why it matters:
- Hospital preference search also uses `ilike` and can degrade into broader scans as that directory grows.
- There is a normalized uniqueness index, but not a substring search index.
Evidence:
- Query path: `lib/services/member-health-profiles-supabase.ts`
- Existing indexes: `supabase/migrations/0012_legacy_operational_health_alignment.sql`

## 3. Potential Table Scans

1. `confirmed` Medium: workflow alert lookups can scan more of `system_events` than needed
Why it could become slow:
- Open-alert checks filter on multiple columns, but only have separate supporting indexes today.
- As system alerts and workflow events accumulate, this lookup can become more expensive on every alert write.
Evidence:
- `lib/services/workflow-observability.ts`
Estimated scaling risk:
- Near-term

2. `confirmed` Medium: MHP provider and hospital search can fall back to broader directory scans
Why it could become slow:
- Both searches use `ilike '%query%'`.
- The current directory indexes support uniqueness, not substring search.
Evidence:
- `lib/services/member-health-profiles-supabase.ts`
Estimated scaling risk:
- Long-term

No confirmed broad table-scan risk remains for billing invoice date reads, because that specific index gap was closed in `0202_billing_invoice_date_index.sql`.

## 4. N+1 Query Patterns

No confirmed read-side N+1 query pattern was found in the priority workflows during this run.

Residual validation gap:
- I audited code paths and migrations only. I did not inspect live Postgres query plans or production row counts, so very small hidden N+1 patterns could still exist outside the main audited flows.

## 5. Inefficient Data Fetching

1. `confirmed` High: the main MAR workflow page still loads full cross-member datasets
Why it could become slow:
- `getMarWorkflowSnapshot` pulls full `v_mar_today`, `v_mar_overdue_today`, and `v_mar_not_given_today` datasets for the whole organization.
- There is no page size, no queue cap, and no narrower fetch boundary before data reaches the page.
Evidence:
- `lib/services/mar-workflow-read.ts`
- `app/(portal)/health/mar/page.tsx`
Estimated scaling risk:
- Near-term

2. `confirmed` Medium: health dashboard reads the same MAR view twice
Why it could become slow:
- The dashboard asks for action rows and recent rows separately.
- That means `v_mar_today` is queried once for scheduled/not-given items and again for recent given items.
Evidence:
- `lib/services/health-dashboard.ts`
- `lib/services/mar-dashboard-read-model.ts`
Estimated scaling risk:
- Near-term

3. `confirmed` Low: POF summary reads still use `select("*")` where a smaller shape would work
Why it could become slow:
- Member Command Center and POF summary reads only surface a subset of request fields, but still fetch the full row.
- This is not the biggest problem in the repo now, but it is avoidable width on a common clinical workflow.
Evidence:
- `lib/services/pof-read.ts`
- `lib/services/pof-request-runtime.ts`
Estimated scaling risk:
- Long-term

## 6. Duplicate Query Logic

1. `confirmed` Medium: MAR dashboard logic is split across multiple overlapping read paths
Where:
- `lib/services/mar-dashboard-read-model.ts`
- `lib/services/health-dashboard.ts`
Why it matters:
- The same `v_mar_today` data is sliced multiple ways in separate functions.
- That makes performance tuning harder and causes repeated reads for one dashboard load.

2. `confirmed` Low: member list and member shell paging logic is still duplicated
Where:
- `lib/services/member-command-center-runtime.ts`
- `lib/services/member-health-profiles-supabase.ts`
Why it matters:
- Member filtering, paging, and sorting are being solved more than once.
- That increases drift risk and makes future index or RPC hardening more scattered than it needs to be.

## 7. Recommended Index Additions

Add these first:

1. `create index if not exists idx_system_events_open_alert_lookup on public.system_events (entity_type, correlation_id, entity_id) where event_type = 'system_alert' and status = 'open';`

2. `create extension if not exists pg_trgm;`
   `create index if not exists idx_provider_directory_provider_name_trgm on public.provider_directory using gin (provider_name gin_trgm_ops);`

3. `create extension if not exists pg_trgm;`
   `create index if not exists idx_hospital_preference_directory_hospital_name_trgm on public.hospital_preference_directory using gin (hospital_name gin_trgm_ops);`

Optional:

4. `create index if not exists idx_pof_requests_member_physician_order_created_at_desc on public.pof_requests (member_id, physician_order_id, created_at desc);`
Use this only if MCC POF history reads become slow in practice.

## 8. Performance Hardening Plan

Phase 1: MAR read containment
- Add one shared MAR snapshot boundary for dashboards so the health dashboard does not hit `v_mar_today` twice.
- Decide whether the full MAR workflow page truly needs every row at first load or whether it can load a primary queue first and fetch secondary history on demand.

Phase 2: close the remaining index gaps
- Add the partial `system_events` open-alert lookup index.
- Add trigram indexes for provider and hospital directory search.

Phase 3: trim avoidable payloads
- Replace `select("*")` in POF summary/list reads with a narrower select for summary use cases.
- Review whether partner/referral preload lists in sales new-entry pages can be reduced further now that lead lookup boundaries are tighter.

Phase 4: reduce read-model drift
- Decide whether Member Directory, Member Command Center index, and MHP index should share one canonical member list read boundary or one shared RPC.

## 9. Suggested Codex Prompts

1. `Harden MAR dashboard performance. Build one canonical read boundary so the health dashboard stops querying v_mar_today twice. Keep the current UI behavior, but reduce repeated Supabase reads and avoid adding client-side business logic.`

2. `Audit the main MAR workflow page for payload size. If safe, split the current organization-wide snapshot into a primary queue read and secondary on-demand reads without changing medication safety behavior or source-of-truth rules.`

3. `Add the smallest safe Supabase migration for system_events open-alert de-dupe lookups. The new index should match workflow-observability.ts, especially event_type='system_alert', status='open', entity_type, correlation_id, and optional entity_id lookups.`

4. `Add safe trigram search indexes for provider_directory.provider_name and hospital_preference_directory.hospital_name, then verify the MHP directory search actions still behave the same.`

5. `Refactor POF summary reads to stop using select('*') where only summary fields are needed. Preserve canonical POF behavior and do not change any write paths.`

6. `Design one shared member list read boundary for Member Directory, Member Command Center index, and MHP index so paging, search, and sorting stop drifting across services. Prefer the smallest production-safe refactor.`

## 10. Founder Summary: What changed since the last run

This audit is materially better than the 2026-04-06 run.

What improved:

- The billing invoice date index gap is closed by `supabase/migrations/0202_billing_invoice_date_index.sql`.
- The operational reliability dashboard is better aligned now. It uses one shared RPC snapshot in `lib/services/operational-reliability.ts` backed by `supabase/migrations/0203_operational_reliability_snapshot_rpc.sql`.
- The main POF read model no longer does read-time expiry writes. That concern is largely closed in `lib/services/pof-read.ts`, and expiry repair now has a shared RPC path in `lib/services/pof-request-runtime.ts` plus `supabase/migrations/0204_pof_expiry_reconciliation_rpc.sql`.
- The older MHP full-directory over-fetch concern is also better than last run. The current code now uses targeted search functions instead of loading entire provider and hospital directories into the detail payload.

What is still open:

- MAR still has the clearest remaining scaling risk because the main workflow page and the health dashboard both read large shared medication views.
- Workflow alert de-dupe checks still deserve one better index.
- MHP directory search still needs proper search indexes.
- Member list read logic is still more duplicated than it should be.

If you want the highest-value next fix now, start with MAR dashboard/query consolidation and the `system_events` alert-lookup index. Those are the cleanest remaining wins after the improvements that landed since yesterday.
