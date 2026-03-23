# Production Readiness Audit

Date: 2026-03-23  
Scope: priority domains (attendance/census/schedule changes/holds/closures, MCC, transportation, billing, sales, care plans, admin reporting)  
Method: static code audit + canonical write-path review + banned-pattern sweeps + migration-reference verification + required validation attempts

## Root Cause Summary

No new production-readiness regressions were detected in the audited priority domains during this run.

Remaining blockers are environment-level validation constraints:
- `npm run build` fails in this sandbox because `build:turbo` invokes `npx kill-port`, which cannot reach npm registry (`EACCES`).
- direct `next build`, `reseed`, `db:check`, and `quality:gates` fail with subprocess `spawn EPERM` / `spawnSync EPERM` restrictions.

Static canonicality and schema-reference alignment are verifiable in this environment; full runtime gate signoff is still blocked by sandbox process/network limits.

## Domain-by-Domain Canonical Map and Gap Status

## 1) Attendance / Census / Schedule Changes / Holds / Closures
- Canonical tables: `attendance_records`, `member_attendance_schedules`, `member_holds`, `schedule_changes`, `center_closures`, `closure_rules`, `billing_adjustments`
- Canonical write paths:
  - `app/(portal)/operations/attendance/actions.ts` -> `lib/services/attendance-workflow-supabase.ts`
  - `app/(portal)/operations/schedule-changes/actions.ts` -> `lib/services/schedule-changes-supabase.ts`
  - `app/(portal)/operations/holds/actions.ts` -> `lib/services/holds-supabase.ts`
  - closure and billing adjustment writes -> `lib/services/billing-supabase.ts` + `lib/services/closure-rules.ts`
- Shared resolvers: `resolveExpectedAttendanceFromSupabaseContext`, `loadExpectedAttendanceSupabaseContext`
- Downstream consumers: attendance operations, schedule-changes workflows, holds workflows, transportation manifest builders, admin attendance reporting
- Gap status: no new Supabase bypass, mock/file runtime persistence, or catch-return masking patterns found

## 2) Member Command Center (MCC)
- Canonical tables: `members`, `member_command_centers`, `member_attendance_schedules`, `member_contacts`, `member_files`, `member_allergies`, `member_billing_settings`
- Canonical write paths:
  - MCC actions -> `app/(portal)/operations/member-command-center/actions-impl.ts`
  - orchestration boundary -> `lib/services/member-command-center.ts` and `lib/services/member-command-center-write.ts`
  - Supabase adapters -> `lib/services/member-command-center-supabase.ts`
- Shared resolvers/services: canonical person identity resolver (`canonical-person-ref`), expected-attendance resolver, billing-effective resolver
- Downstream consumers: MCC list/detail tabs, attendance-billing tab, locker workflows, attendance/billing/transportation dependents
- Gap status: no new schema fallback retry or fabricated-member payload behavior found

## 3) Transportation
- Canonical tables: `transportation_runs`, `transportation_run_results`, `transportation_manifest_adjustments`, `transportation_logs`, `member_attendance_schedules`, `attendance_records`
- Canonical write paths: transportation actions -> `lib/services/transportation-station-supabase.ts`; run posting -> `lib/services/transportation-run-posting.ts`
- Shared resolvers: canonical member identity resolver + expected-attendance resolver
- Downstream consumers: transportation station UI/print, transport docs/reporting, billing transport rollups
- Gap status: no non-canonical write path or fallback-fabrication pattern found

## 4) Billing
- Canonical tables: `center_billing_settings`, `member_billing_settings`, `billing_schedule_templates`, `billing_batches`, `billing_invoices`, `billing_invoice_lines`, `billing_adjustments`, `audit_logs`
- Canonical write/read paths: payor/pricing/MCC attendance-billing actions -> billing services (`billing-supabase`, `billing-read-supabase`, `billing-configuration`, `enrollment-pricing`)
- Shared resolvers: `resolveActiveEffectiveRowForDate`, `resolveEffectiveBillingMode`, `resolveConfiguredDailyRate`
- Downstream consumers: operations payor/pricing pages, MCC attendance billing, admin reporting aggregates
- Gap status: shared resolver usage remains consistent; no new duplicate derived-rule implementation detected in audited scope

## 5) Sales
- Canonical tables: `leads`, `lead_activities`, `lead_stage_history`, `community_partner_organizations`, `referral_sources`, `partner_activities`, `enrollment_packet_requests`
- Canonical write paths: sales actions -> `sales-crm-supabase`, `sales-lead-stage-supabase`, `sales-lead-conversion-supabase`, `sales-lead-activities`
- Shared resolvers: canonical lead/member identity translation and lead stage transition rules in shared services
- Downstream consumers: sales pipeline/detail/summary pages, community-partner workflows, enrollment packet send flows
- Gap status: no new mock/fallback/canonical bypass issues found

## 6) Care Plans
- Canonical tables: `care_plans`, `care_plan_sections`, `care_plan_versions`, `care_plan_review_history`, `care_plan_signature_events`, `care_plan_nurse_signatures`, `member_files`
- Canonical write paths: care plan actions -> care-plan services -> `care-plans-supabase` and RPC-backed signature/finalization services
- Shared resolvers: `canSendCaregiverSignatureByNurseSignatureState`, `resolvePublicCaregiverLinkState`
- Downstream consumers: care-plan list/detail/due-report pages, nurse e-sign and caregiver public-sign workflows, MAR-related care-plan readiness checks
- Gap status: no new duplicate business-rule implementation, fabricated records, or silent fallback persistence found

## 7) Admin Reporting
- Canonical read tables/views/RPC: attendance, billing, transportation, sales, care plan reporting aggregates and reporting RPCs
- Canonical read paths: `admin-reporting-foundation.ts`, `admin-reporting-core.ts`, `reports-ops.ts`, `mar-monthly-report.ts`
- Shared resolvers: expected-attendance + billing-effective shared resolvers
- Downstream consumers: `/admin-reports/*` and `/reports/*`
- Gap status: no report-side direct Supabase client bypass or fabricated fallback datasets found in audited priority scope

## Supabase Backing / Banned Pattern Results

Checks executed:
- runtime mock/file-backed import scan across priority app/service paths
- app-layer Supabase client usage scan in priority domains
- catch-return masking scan in priority service modules
- direct app-layer `.from/.rpc` scan (excluding `Array.from`)

Results:
- `mock_import_hits=0`
- `priority_app_supabase_import_hits=0`
- `priority_app_client_ctor_hits=0`
- `priority_app_direct_supabase_hits=0`
- `priority_service_catch_mask_hits=0`

## Seed / Runtime / Migration Alignment

- Runtime migration references scanned against `supabase/migrations`.
- `runtime_migration_refs=43`
- `missing_migration_refs=0`
- No newly observed migration filename drift in audited scope.

## Validation Results

- `npm.cmd run typecheck`: passed
- `npm.cmd run build`: failed due `npx kill-port` npm registry access restriction (`EACCES`)
- `node ./node_modules/next/dist/bin/next build`: compilation and type/lint stage passed; final build failed with subprocess `spawn EPERM`
- `npm.cmd run reseed`: failed with `spawn EPERM` (esbuild subprocess)
- `npm.cmd run db:check`: failed with `spawnSync cmd.exe EPERM`
- `npm.cmd run quality:gates`: failed with `spawnSync cmd.exe EPERM`

## Files Changed in This Run

- `docs/audits/production-readiness-audit-2026-03-23.md`

## Migrations Added/Updated in This Run

- None

## Duplicated Rule Implementations Removed in This Run

- None (no new duplicate derived-rule implementations detected in audited priority scope)

## Resolved vs Unresolved Gaps

Resolved:
- completed full priority-domain production-readiness sweep
- confirmed no new runtime mock/file-backed imports in audited runtime paths
- confirmed no app-layer Supabase client bypass and no catch-return persistence masking in audited priority scope
- confirmed runtime migration reference alignment (`missing_migration_refs=0`)

Unresolved:
- full production-readiness gate signoff is blocked by sandbox network/subprocess restrictions (`EACCES` + `EPERM`) preventing successful build/reseed/db-sync/quality-gate completion in this environment

## Production-Readiness Statement (Audited Scope)

For the audited priority domains, runtime paths are currently Supabase-backed and canonical by static analysis, banned-pattern checks, and migration-reference verification.  
Final end-to-end production-readiness signoff remains conditional on running build/reseed/db-check/quality-gates in an environment that permits required network and subprocess execution.