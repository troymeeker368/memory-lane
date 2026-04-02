# Production Readiness Audit - 2026-04-02

## Scope
Priority domains audited in order:
1. attendance / census / schedule changes / holds / closures
2. MCC
3. transportation
4. billing
5. sales
6. care plans
7. admin reporting

Audit dimensions covered together: Supabase backing, canonical source-of-truth gaps, schema drift, shared resolver compliance, fallback masking, downstream consumer alignment, seed/runtime/migration alignment, and production-readiness blockers.

## Root Cause Summary
- No new priority-scope canonicality or Supabase-backing regressions were found in this run.
- The main blocker remains host-level process spawn restrictions (`EPERM`) preventing full build/reseed completion.
- Existing architecture risk remains in billing custom-invoice orchestration: source reads and invoice numbering are still assembled in service code before RPC persistence, so strict end-to-end atomicity is not yet guaranteed for that workflow.

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
  - Attendance and MCC tabs/pages, payor closure views/actions, transportation manifest derivation, admin attendance reporting
- Status:
  - Supabase-backed and canonical in audited runtime paths.

### 2) MCC
- Canonical tables:
  - `member_command_centers`, `members`, `member_contacts`, `member_files`, `member_allergies`, `member_attendance_schedules`
- Canonical write paths:
  - MCC actions -> `lib/services/member-command-center.ts` and `lib/services/member-command-center-write.ts`
- Shared resolvers:
  - `member-command-center-member-queries` canonical member selection and schema enforcement
  - `canonical-person-ref` identity translation
- Downstream consumers:
  - MCC index/detail pages, payor/member lookup paths, attendance/schedule tabs, transportation add-rider option resolution
- Status:
  - Supabase-backed and canonical in audited runtime paths.

### 3) Transportation
- Canonical tables:
  - `transportation_logs`, `transportation_manifest_adjustments`, `transportation_runs`, `transportation_run_results`, `member_contacts`
- Canonical write paths:
  - Transportation station actions -> `lib/services/transportation-station-supabase.ts`
  - Run posting -> `lib/services/transportation-run-posting.ts` (RPC-backed persistence boundary)
- Shared resolvers:
  - `resolveExpectedAttendanceForDate` / expected-attendance context
  - `resolveEffectiveTransportationBillingStatus` from `billing-effective`
- Downstream consumers:
  - Transportation station/print pages, billing variable charge derivation, admin transportation report category
- Status:
  - Supabase-backed and canonical in audited runtime paths.

### 4) Billing
- Canonical tables:
  - `billing_batches`, `billing_invoices`, `billing_invoice_lines`, `billing_coverages`, `billing_adjustments`, `center_billing_settings`, `member_billing_settings`, `billing_schedule_templates`, `transportation_logs`, `ancillary_charge_logs`
- Canonical write paths:
  - Billing actions -> billing services (`billing-workflows`, `billing-supabase`, `billing-custom-invoices`, `billing-rpc`)
  - Shared RPC boundary used for invoice persistence (`rpc_generate_billing_batch`, `rpc_create_custom_invoice`, `rpc_create_billing_export`)
- Shared resolvers:
  - `lib/services/billing-effective.ts`
  - `lib/services/billing-core.ts`
  - `lib/services/billing-invoice-format.ts`
- Downstream consumers:
  - Payor module pages/actions, billing exports/PDF generation, attendance billing sync, admin reporting revenue paths
- Status:
  - No new fallback fabrication detected.
  - Unresolved architecture risk: custom-invoice orchestration remains partially pre-RPC and not fully atomic end-to-end.

### 5) Sales
- Canonical tables:
  - `leads`, `lead_activities`, `lead_stage_history`, `community_partner_organizations`, `referral_sources`, enrollment packet linkage tables
- Canonical write paths:
  - Sales actions -> `sales-crm-supabase`, `sales-lead-stage-supabase`, `sales-lead-conversion-supabase` (RPC-backed conversion)
- Shared resolvers:
  - `resolveCanonicalLeadTransition` and related sales shared workflow services
- Downstream consumers:
  - Sales pipeline/detail pages, summary reports, lead activity and partner/referral views
- Status:
  - Supabase-backed and canonical in audited runtime paths.

### 6) Care Plans
- Canonical tables:
  - `care_plans`, `care_plan_sections`, `care_plan_versions`, `care_plan_signature_events`, `care_plan_nurse_signatures`
- Canonical write paths:
  - `app/care-plan-actions.ts` -> `care-plans-write` / `care-plan-esign` service layer
- Shared resolvers:
  - `care-plan-esign-rules`, `care-plan-authorization`, shared care-plan read/write modules
- Downstream consumers:
  - Care plan list/detail/new/due report pages, versions pages, member health profile care-plan summaries
- Status:
  - Supabase-backed and canonical in audited runtime paths.

### 7) Admin Reporting
- Canonical tables/views:
  - Migration-backed reporting views plus operational source tables consumed by reporting foundation services
- Canonical read/resolver paths:
  - `admin-reporting-foundation`, `admin-reporting-core`, `reporting-attendance-dataset`
- Downstream consumers:
  - `app/(portal)/admin-reports/*` pages and related exports
- Status:
  - Supabase-backed and canonical in audited runtime paths.

## Banned Pattern Sweep (This Run)
- Runtime mock imports (`app/` + `lib/`, excluding `lib/mock` and tests): `mock_import_hits=0`
- Priority-scope app direct Supabase calls: `priority_app_supabase_call_hits=0`
- Service catch-return masking hits: `service_catch_mask_hits=0`
- Service synthetic success in catch blocks: `service_synthetic_success_hits=0`

## Schema Drift / Seed-Runtime-Migration Alignment
- Runtime migration filename references in code: `runtime_migration_refs=57`
- Missing migration filename references: `missing_migration_refs=0`
- Runtime `.from("...")` references extracted via static parser: `runtime_from_refs=107`
- Unresolved runtime `.from` refs against migration-defined tables/views: `unresolved_from_refs_count=0`
- Runtime `.from` schema backing remains aligned for audited scope.

## Validation Results
- `npm.cmd run typecheck`: passed.
- `npm.cmd run build`: failed due host subprocess restriction (`spawnSync ... EPERM`).
- `npm.cmd run reseed`: failed due host subprocess restriction (`spawn EPERM` via esbuild child process startup).
- Required banned-pattern and runtime reference checks: passed.

## Files Changed (This Run)
- `docs/audits/production-readiness-audit-2026-04-02.md`

## Migrations Added/Updated (This Run)
- None.

## Duplicated Rule Implementations Removed
- None in this run (no new duplicate derived-rule branch found in audited scope).

## Resolved vs Unresolved Gaps

### Resolved
- No new code-level gap required remediation in this run; prior canonical fixes remain in effect.

### Unresolved (Blockers/Risks)
1. Host subprocess restrictions (`EPERM`) continue to block full build/reseed validation gates.
2. Billing custom-invoice flow still has non-fully-atomic orchestration before RPC persistence and should be hardened to a single canonical atomic boundary.

## Current Audit Statement
For the audited priority scope, runtime paths are Supabase-backed and canonical in static analysis, with no new schema-drift or fallback-fabrication regressions detected in this run. Final production-readiness signoff remains blocked by host-level `EPERM` subprocess restrictions and the remaining billing custom-invoice atomicity hardening task.
