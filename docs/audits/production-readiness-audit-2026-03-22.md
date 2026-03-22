# Production Readiness Audit

Date: 2026-03-22  
Scope: priority domains (attendance/census/schedule changes/holds/closures, MCC, transportation, billing, sales, care plans, admin reporting)  
Method: static code audit + canonical write-path review + banned-pattern sweeps + migration-reference verification + required validation attempts

## Root Cause Summary

No new production-readiness code regressions were detected in the audited priority domains during this run.

The remaining blockers are environment-level validation constraints:
- `npm run build` is blocked by `npx kill-port` network access failure (`EACCES`) in this sandbox.
- direct `next build`, `reseed`, `db:check`, and `quality:gates` all hit subprocess `spawn EPERM` restrictions.

Given these restrictions, this run can confirm static canonicality and schema-reference alignment, but cannot provide full runtime gate signoff.

## Domain-by-Domain Canonical Map and Gap Status

## 1) Attendance / Census / Schedule Changes / Holds / Closures
- Canonical tables: `attendance_records`, `member_attendance_schedules`, `member_holds`, `schedule_changes`, `center_closures`, `closure_rules`, `billing_adjustments`
- Canonical write paths:
  - `app/(portal)/operations/attendance/actions.ts` -> `lib/services/attendance-workflow-supabase.ts`
  - `app/(portal)/operations/schedule-changes/actions.ts` -> `lib/services/schedule-changes-supabase.ts`
  - `app/(portal)/operations/holds/actions.ts` -> `lib/services/holds-supabase.ts`
  - closure/billing adjustments -> `lib/services/billing-supabase.ts` + `lib/services/closure-rules.ts`
- Shared resolvers: `resolveExpectedAttendanceFromSupabaseContext` / `loadExpectedAttendanceSupabaseContext`
- Downstream consumers: operations attendance/schedule/holds flows, transportation planning, admin attendance reporting
- Gap status: no new Supabase bypass, runtime mock usage, or fallback masking patterns detected

## 2) Member Command Center (MCC)
- Canonical tables: `members`, `member_command_centers`, `member_attendance_schedules`, `member_contacts`, `member_files`, `member_allergies`, `member_billing_settings`
- Canonical write paths:
  - MCC actions -> `app/(portal)/operations/member-command-center/actions-impl.ts`
  - service boundary -> `lib/services/member-command-center.ts`
  - Supabase adapters -> `lib/services/member-command-center-supabase.ts`
- Shared resolvers/services: canonical member identity resolution (`canonical-person-ref`), billing-effective resolver (`billing-effective`), MCC member query mapper layer
- Downstream consumers: MCC index/detail tabs, members page surfaces, locker workflows, attendance/billing surfaces
- Gap status: no new schema fallback retry paths or fabricated member payload behavior detected

## 3) Transportation
- Canonical tables: `transportation_runs`, `transportation_run_results`, `transportation_manifest_adjustments`, `transportation_logs`, `member_attendance_schedules`, `attendance_records`
- Canonical write paths: transportation station actions -> `lib/services/transportation-station-supabase.ts`; posting -> `lib/services/transportation-run-posting.ts`
- Shared resolvers: canonical member identity resolver + expected-attendance shared resolver path
- Downstream consumers: transportation station UI/print, ops transportation docs, billing transport rollups
- Gap status: no non-canonical write path or fallback-fabrication pattern detected

## 4) Billing
- Canonical tables: `center_billing_settings`, `member_billing_settings`, `billing_schedule_templates`, `billing_batches`, `billing_invoices`, `billing_invoice_lines`, `billing_adjustments`, `audit_logs`
- Canonical write/read paths: payor/pricing actions -> billing + enrollment-pricing service modules
- Shared resolvers: `resolveActiveEffectiveRowForDate`, `resolveEffectiveBillingMode`, `resolveConfiguredDailyRate`
- Downstream consumers: operations payor/pricing pages, MCC attendance-billing context, admin revenue reporting
- Gap status: no new app-layer Supabase bypass in audited billing/ops pages

## 5) Sales
- Canonical tables: `leads`, `lead_activities`, `lead_stage_history`, `community_partner_organizations`, `referral_sources`, `partner_activities`, `enrollment_packet_requests`
- Canonical write paths: sales actions -> `sales-crm-supabase`, `sales-lead-stage-supabase`, `sales-lead-conversion-supabase`, `sales-lead-activities`
- Shared resolvers: canonical lead identity and stage/lifecycle resolver logic in shared services
- Downstream consumers: sales pipeline/summary/detail flows, enrollment packet send paths
- Gap status: no new mock/fallback/canonical bypass issues detected

## 6) Care Plans
- Canonical tables: `care_plans`, `care_plan_sections`, `care_plan_versions`, `care_plan_review_history`, `care_plan_signature_events`, `care_plan_nurse_signatures`, `member_files`
- Canonical write paths: care plan actions -> shared care plan services -> `care-plans-supabase`
- Shared resolvers: care-plan authorization + e-sign rule modules
- Downstream consumers: care plan list/detail/version/sign flows
- Gap status: no new duplicate business-rule implementations in app-layer consumers detected

## 7) Admin Reporting
- Canonical read tables/views/RPC: attendance, billing, transportation, sales, care plan aggregates + reporting RPCs
- Canonical read paths: `admin-reporting-foundation.ts`, `admin-reporting-core.ts`, `reports-ops.ts`
- Shared resolvers: expected-attendance and billing-effective shared resolver modules
- Downstream consumers: `/admin-reports/*`, `/reports/*`
- Gap status: no new report-side direct Supabase bypass or fabricated fallback dataset detected

## Supabase Backing / Banned Pattern Results

Checks executed:
- runtime mock import scan across `app`, `lib/services`, `components`
- direct app-layer Supabase call scan in priority domain pages/actions
- service catch-return masking scan for synthetic defaults in priority domain service modules

Results:
- `mock_import_hits=0`
- `priority_app_direct_supabase_hits=0`
- `priority_service_catch_mask_hits=0`

## Seed / Runtime / Migration Alignment

- Runtime migration references scanned against `supabase/migrations`.
- `runtime_migration_refs=53`
- `missing_migration_refs=0`
- No newly observed seed/runtime migration filename drift in audited scope.

## Validation Results

- `npm.cmd run typecheck`: passed
- `npm.cmd run build`: failed at `npx kill-port` with network/permission `EACCES`
- `node ./node_modules/next/dist/bin/next build`: compile + lint/type stage passed, final build failed with subprocess `spawn EPERM`
- `npm.cmd run reseed`: failed with `spawn EPERM` (esbuild subprocess)
- `npm.cmd run db:check`: failed with `spawnSync cmd.exe EPERM`
- `npm.cmd run quality:gates`: failed with `spawnSync cmd.exe EPERM`

## Files Changed in This Run

- `docs/audits/production-readiness-audit-2026-03-22.md`

## Migrations Added/Updated in This Run

- None

## Duplicated Rule Implementations Removed in This Run

- None (no new duplicate resolver logic detected in audited priority scope)

## Resolved vs Unresolved Gaps

Resolved:
- completed full priority-domain static audit with updated canonical mapping
- verified no new runtime mock imports, app-layer Supabase bypasses, or catch-return masking patterns in scope
- verified migration reference alignment (`missing_migration_refs=0`)

Unresolved:
- full production-readiness gate signoff remains blocked by sandbox subprocess restrictions (`EPERM`) and network restriction on `npx kill-port` (`EACCES`)

## Production-Readiness Statement (Audited Scope)

For the audited priority domains, runtime paths are currently Supabase-backed and canonical by static analysis and banned-pattern verification.  
Final production-readiness signoff remains conditional on successful build/reseed/db-check/quality-gates execution in an environment that permits required subprocess execution.
