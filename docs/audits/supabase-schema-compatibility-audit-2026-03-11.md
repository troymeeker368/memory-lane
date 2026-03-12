# Supabase Schema Compatibility Audit (2026-03-11)

## Scope and Method
- Scanned runtime Supabase usage across `app/`, `lib/`, and `scripts/` for:
  - `.from("...")`
  - `.rpc("...")`
  - `storage.from("...")`
- Scanned SQL definitions in `supabase/migrations/0001` through `0015` for:
  - tables, views, functions, enums
  - index coverage and key billing/closure support columns
- Compared runtime object references against migration-defined schema.

## Inventory Summary
- Runtime references:
  - `73` unique `.from("...")` objects
  - `0` `.rpc(...)` references
  - `0` storage bucket references
- Migration-defined schema:
  - `72` tables
  - `9` views
  - `4` SQL functions
  - `3` enums
- Current repo-level object-name mismatch (`runtime -> migrations`):
  - `0` missing table/view names after this pass

Raw machine-readable inventory and diffs:
- `docs/audits/supabase-schema-audit-data.json`

## Prioritized Findings

### P0 - Page-breaking runtime failures (confirmed)
1. Missing closure/billing schema in runtime DB state
   - Symptom: runtime errors like `Could not find the table 'public.closure_rules' in the schema cache` and `public.billing_batches` missing.
   - Cause: environments running code that expects migrations `0012`/`0013`, but DB schema did not have those objects (either unapplied or partially applied migrations; schema cache can also lag until restart).
   - Impact:
     - Center closures page and closure generation fail.
     - Payor billing batches/index pages fail.

### P1 - Write-path and calculation risk when schema is partially applied
2. Billing execution entities required by runtime but not guaranteed in partially-migrated DBs
   - Required objects:
     - `billing_adjustments`
     - `billing_batches`
     - `billing_invoices`
     - `billing_invoice_lines`
     - `billing_export_jobs`
     - `billing_coverages`
   - Required column backfills on existing operational tables:
     - `transportation_logs`: `trip_type`, `quantity`, `unit_rate`, `total_amount`, `billable`, `billing_status`, `billing_exclusion_reason`, `invoice_id`, `updated_at`
     - `ancillary_charge_logs`: `quantity`, `unit_rate`, `amount`, `billing_status`, `billing_exclusion_reason`, `invoice_id`, `updated_at`
   - Impact:
     - Batch preview generation/export can fail or produce incomplete data.
     - Variable charge billing status updates and coverage tracking can fail.

### P1 - Runtime naming mismatches in relations service (fixed in this pass)
3. Canonical table mismatches in `lib/services/relations.ts`
   - Fixed mappings:
     - `daily_activities` -> `daily_activity_logs`
     - `ancillary_logs` -> `ancillary_charge_logs`
     - `photo_uploads` -> `member_photo_uploads`
     - `staff` -> `profiles`
   - Impact before fix:
     - Member detail and staff-related relation lookups could fail with missing-table errors.

### P2 - Mock-era runtime dependencies still present
4. Remaining mock runtime references are still present in multiple operational/sales/admin services.
   - File list is included in `docs/audits/supabase-schema-audit-data.json` under `mockDependencies`.
   - Notable high-impact files:
     - `app/sales-actions.ts`
     - `app/actions.ts`
     - `lib/services/admin-reports.ts`
     - `lib/services/admin-reporting-foundation.ts`
     - `lib/services/billing.ts` (legacy mock billing service)

### P3 - Schema objects defined but currently unused by runtime paths
5. Unused tables/views/functions (cleanup candidates)
   - Tables:
    - `email_logs`, `lookup_lists`, `mar_entries`, `pto_requests`, `role_permissions`, `roles`, `sites`
   - Views:
     - `v_biweekly_totals`
   - Functions:
     - `current_role`, `log_documentation_event`, `set_updated_at`, `sync_time_punch_to_canonical_punch`

## Billing/Closures Deep-Dive (Required Objects)
The billing/closures flow in `lib/services/billing-supabase.ts` and payor/closures routes requires:
- `closure_rules`
- `center_closures`
- `billing_batches`
- `billing_invoices`
- `billing_invoice_lines`
- `billing_adjustments`
- `billing_coverages`
- `billing_export_jobs`
- plus billing columns on `transportation_logs` and `ancillary_charge_logs`.

## Remediation Implemented in This Pass
1. New idempotent backfill migration:
   - `supabase/migrations/0015_schema_compatibility_backfill.sql`
   - Adds/ensures closure, care-plan, and advanced billing execution schema.
   - Backfills missing billing columns on `transportation_logs` and `ancillary_charge_logs`.
   - Adds indexes, update triggers, and RLS/policies for affected objects.

2. Runtime mismatch fixes:
   - `lib/services/relations.ts` switched to canonical Supabase table names.

3. Dev-time guard improvements:
   - `lib/services/billing-supabase.ts` now throws clearer development errors for missing noncritical closure lookup objects (with exact migration guidance), while preserving strict error behavior for critical write paths.

## Why `closure_rules` Error Happened and Why This Fix Works
- What happened:
  - Runtime code queried `public.closure_rules`.
  - The active Supabase DB/schema cache did not contain that table.
  - This is consistent with incomplete application of migration `0012_legacy_operational_health_alignment.sql` (and related follow-on schema).
- Why this fix resolves it:
  - `0015_schema_compatibility_backfill.sql` re-asserts required closure/billing/care-plan objects idempotently using `create table if not exists` and `add column if not exists` patterns.
  - Even if prior migration steps were skipped, applying `0015` now creates/backfills required objects.
  - Updated dev guards surface explicit migration guidance instead of opaque schema-cache errors.

## Remaining Blockers
- No code-level schema-name mismatches remain after this pass.
- Operational blocker can still exist until migrations are applied to the target Supabase environment and schema cache is refreshed.
