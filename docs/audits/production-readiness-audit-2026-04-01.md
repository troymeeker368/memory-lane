# Production Readiness Audit - 2026-04-01

## Scope
Priority domains audited in order:
1. attendance / census / schedule changes / holds / closures
2. MCC
3. transportation
4. billing
5. sales
6. care plans
7. admin reporting

Audit dimensions covered together: Supabase backing, canonical source-of-truth, schema drift, shared resolver compliance, fallback masking behavior, downstream consumer alignment, seed/runtime/migration alignment, and production-readiness blockers.

## Root Cause Summary
- One concrete production-risk gap was found in billing runtime paths:
  - `billing-preview-helpers` and `billing-custom-invoices` normalized invalid source dates with default fallback behavior, which could silently substitute a fallback date and fabricate billable service dates.
- Fixed by enforcing strict source-date validation and explicit failure for invalid source rows (no fallback date substitution).

## Domain-by-Domain Canonical Map and Gaps

### 1) Attendance / Census / Schedule Changes / Holds / Closures
- Canonical tables:
  - `attendance_records`, `member_attendance_schedules`, `schedule_changes`, `member_holds`, `center_closures`, `closure_rules`
- Canonical write paths:
  - `app/(portal)/operations/attendance/actions.ts` -> `lib/services/attendance-workflow-supabase.ts`
  - `app/(portal)/operations/schedule-changes/actions.ts` -> `lib/services/schedule-changes-supabase.ts`
  - `app/(portal)/operations/holds/actions.ts` -> `lib/services/holds-supabase.ts`
- Shared resolvers:
  - `lib/services/expected-attendance-supabase.ts`
  - `lib/services/expected-attendance.ts`
- Downstream consumers:
  - Operations attendance/census UIs, transportation riders/manifests, billing base-day derivation, admin attendance reporting
- Status:
  - Supabase-backed and canonical in audited runtime paths.

### 2) MCC
- Canonical tables:
  - `member_command_centers`, `members`, `member_contacts`, `member_files`, `member_allergies`, `member_attendance_schedules`
- Canonical write paths:
  - MCC actions -> `lib/services/member-command-center.ts` and `lib/services/member-command-center-write.ts`
- Shared resolvers:
  - MCC shared identity/read resolvers (`member-command-center-member-queries`, canonical person/member resolution)
- Downstream consumers:
  - MCC detail/index, health workspace census widgets, billing payor/contact consumers
- Status:
  - Supabase-backed and canonical in audited runtime paths.

### 3) Transportation
- Canonical tables:
  - `transportation_logs`, `transportation_manifest_adjustments`, `transportation_runs`, `transportation_run_results`, `member_contacts`
- Canonical write paths:
  - Transportation station actions -> `lib/services/transportation-station-supabase.ts`
  - Run/manifest posting -> `lib/services/transportation-run-manifest-supabase.ts`
- Shared resolvers:
  - attendance/schedule/closure derivation via expected-attendance shared services
- Downstream consumers:
  - Transportation station UI, billing transportation line derivation, operational reports
- Status:
  - Supabase-backed and canonical in audited runtime paths.

### 4) Billing
- Canonical tables:
  - `billing_batches`, `billing_invoices`, `billing_invoice_lines`, `billing_coverages`, `billing_adjustments`, `center_billing_settings`, `member_billing_settings`, `billing_schedule_templates`, `transportation_logs`, `ancillary_charge_logs`
- Canonical write paths:
  - Billing actions -> billing services (`billing-preview-helpers`, `billing-rpc`, `billing-custom-invoices`, `billing-configuration`)
  - Atomic persistence boundary via RPC (`rpc_generate_billing_batch`, `rpc_create_custom_invoice`)
- Shared resolvers:
  - `lib/services/billing-effective.ts` for mode/rate/transport status
  - `lib/services/billing-invoice-format.ts` for product/service + bill-to snapshot formatting
- Downstream consumers:
  - payor/invoice generation, invoice PDF/export, operational and admin reporting
- Status:
  - Fixed this run: removed fallback-date fabrication path in billing preview/custom invoice source-line generation.
  - Schema/runtime alignment validated for new billing snapshot/itemization migration (`0173_billing_invoice_snapshot_itemization.sql`).

### 5) Sales
- Canonical tables:
  - `leads`, `lead_activities`, `lead_stage_history`, `community_partner_organizations`, `referral_sources`, enrollment packet tables
- Canonical write paths:
  - Sales actions -> `sales-crm-supabase`, `sales-lead-stage-supabase`, `sales-lead-conversion-supabase`
- Shared resolvers:
  - `sales-workflows`, sales read-model services
- Downstream consumers:
  - Sales CRM pages, enrollment packet eligibility/search, summary reporting
- Status:
  - Supabase-backed and canonical in audited runtime paths.

### 6) Care Plans
- Canonical tables:
  - `care_plans`, `care_plan_sections`, `care_plan_versions`, `care_plan_signature_events`, `care_plan_nurse_signatures`
- Canonical write paths:
  - `app/care-plan-actions.ts` -> care-plan service layer (`care-plans-write`, `care-plan-esign`, `care-plans-supabase`)
- Shared resolvers:
  - `care-plan-esign-rules` and shared care-plan service modules
- Downstream consumers:
  - Care plan portal + public e-sign flows
- Status:
  - Supabase-backed and canonical in audited runtime paths.

### 7) Admin Reporting
- Canonical tables/views:
  - Canonical operational tables + migration-backed reporting views (`v_*`) and reporting RPC surface
- Canonical read/resolver paths:
  - `admin-reporting-foundation`, `admin-reporting-core`, `reporting-attendance-dataset`
- Downstream consumers:
  - admin reporting pages and exports
- Status:
  - Supabase-backed and canonical in audited runtime paths.

## Banned Pattern Sweep (This Run)
- Runtime mock imports (`app/` + `lib/`, excluding `lib/mock`): `mock_import_hits=0`
- Priority-scope app direct Supabase client usage (operations/sales/reports/care-plan actions + lookup actions): `priority_app_direct_supabase_hits=0`
- Priority-scope catch-return masking hits: `priority_service_catch_mask_hits=0`

## Schema Drift / Seed-Runtime-Migration Alignment
- Runtime migration filename references in code: `runtime_migration_refs=66`
- Missing migration filename references: `missing_migration_refs=0`
- Runtime `.from("...")` references extracted: `runtime_from_refs=108`
- Unresolved runtime `.from` refs against migration-defined tables/views: `unresolved_from_refs_count=0`
- New/active migration alignment validated for:
  - `0172_mhp_directory_normalized_lookup_rpcs.sql`
  - `0173_billing_invoice_snapshot_itemization.sql`

## Validation Results
- `npm.cmd run typecheck`: passed.
- `npm.cmd run build`: failed at host process boundary (`spawn EPERM`) after successful compile.
- `npm.cmd run reseed`: failed at host process boundary (`spawn EPERM` in esbuild startup).
- Required banned-pattern and runtime-reference checks: passed.

## Files Changed (This Run)
- `lib/services/billing-custom-invoices.ts`
- `lib/services/billing-preview-helpers.ts`
- `docs/audits/production-readiness-audit-2026-04-01.md`

## Migrations Added/Updated (This Run)
- None added in this run (validated pre-existing in-progress migrations `0172` and `0173`).

## Duplicated Rule Implementations Removed
- No additional duplicated resolver branches removed in this run.

## Resolved vs Unresolved Gaps
### Resolved
- Billing source-line generation now refuses invalid source dates instead of silently defaulting dates:
  - `lib/services/billing-preview-helpers.ts`
  - `lib/services/billing-custom-invoices.ts`

### Unresolved (Blockers/Risks)
1. Host subprocess restrictions (`EPERM`) continue to block full build/reseed validation gates.
2. This repository currently has broad in-progress local changes outside the two patched files; full release signoff still depends on final integration review of the complete change set.

## Current Audit Statement
For the audited priority scope, runtime paths are Supabase-backed and canonical in static analysis, with the billing date-fabrication gap removed in this run. Final production-readiness signoff remains blocked by host-level `EPERM` subprocess restrictions on required runtime gates and pending integration review of all in-progress branch edits.
