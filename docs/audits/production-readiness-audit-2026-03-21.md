# Production Readiness Audit

Date: 2026-03-21  
Scope: priority domains (attendance/census/schedule changes/holds/closures, MCC, transportation, billing, sales, care plans, admin reporting)  
Method: static code audit + canonical write-path review + banned-pattern sweeps + migration-reference verification + required validation attempts

## Root Cause Summary

This run identified two production-readiness gaps in active runtime paths:
- Billing/operations pricing history page performed a direct app-layer Supabase query against `audit_logs`, bypassing canonical domain service boundaries.
- MCC member query layer still contained a schema fallback branch that retried with a reduced select, allowing partial reads when canonical schema columns were missing.

Both gaps were remediated in this run:
- Moved pricing history reads into a canonical service function (`listEnrollmentPricingAuditRows`) and updated page consumption to service-only.
- Removed MCC schema fallback retry behavior so missing canonical member columns fail explicitly with migration guidance.

## Domain-by-Domain Canonical Map and Gap Status

## 1) Attendance / Census / Schedule Changes / Holds / Closures
- Canonical tables: `attendance_records`, `member_attendance_schedules`, `member_holds`, `schedule_changes`, `center_closures`, `closure_rules`, `billing_adjustments`
- Canonical write paths:
  - `app/(portal)/operations/attendance/actions.ts` -> `lib/services/attendance-workflow-supabase.ts`
  - `app/(portal)/operations/schedule-changes/actions.ts` -> `lib/services/schedule-changes-supabase.ts`
  - `app/(portal)/operations/holds/actions.ts` -> `lib/services/holds-supabase.ts`
  - closure/billing operations -> `lib/services/billing-supabase.ts` + `lib/services/closure-rules.ts`
- Shared resolvers: `resolveExpectedAttendanceFromSupabaseContext` / `loadExpectedAttendanceSupabaseContext`
- Downstream consumers: operations attendance/schedule/holds flows, transportation planning, admin reporting attendance rollups
- Gap status: no new bypass, mock, or silent fallback patterns detected

## 2) Member Command Center (MCC)
- Canonical tables: `members`, `member_command_centers`, `member_attendance_schedules`, `member_contacts`, `member_files`, `member_allergies`, `member_billing_settings`
- Canonical write paths:
  - MCC actions -> `app/(portal)/operations/member-command-center/actions-impl.ts`
  - service boundary -> `lib/services/member-command-center.ts`
  - Supabase adapters -> `lib/services/member-command-center-supabase.ts`
- Shared resolvers/services: canonical identity resolution (`canonical-person-ref`), billing-effective resolver, member query mapper layer
- Downstream consumers: MCC index/detail tabs, members page, locker assignment workflows, attendance/billing surfaces
- Gap status: fixed schema fallback branch that masked missing-column drift; now fails explicitly on required-column mismatch

## 3) Transportation
- Canonical tables: `transportation_runs`, `transportation_run_results`, `transportation_manifest_adjustments`, `transportation_logs`, `member_attendance_schedules`, `attendance_records`
- Canonical write paths: transportation station actions -> `lib/services/transportation-station-supabase.ts`; posting -> `lib/services/transportation-run-posting.ts`
- Shared resolvers: canonical member identity resolution + expected-attendance shared resolver path
- Downstream consumers: transportation station UI/print, operations staffing, billing transport rollups
- Gap status: no non-canonical write path or fallback-fabrication pattern detected

## 4) Billing
- Canonical tables: `center_billing_settings`, `member_billing_settings`, `billing_schedule_templates`, `billing_batches`, `billing_invoices`, `billing_invoice_lines`, `billing_adjustments`, `audit_logs` (pricing audit stream)
- Canonical write/read paths:
  - payor/pricing actions -> billing and enrollment pricing services
  - pricing history read path now: `app/(portal)/operations/pricing/page.tsx` -> `lib/services/enrollment-pricing.ts::listEnrollmentPricingAuditRows`
- Shared resolvers: `resolveActiveEffectiveRowForDate`, `resolveEffectiveBillingMode`, `resolveConfiguredDailyRate`
- Downstream consumers: operations pricing/payor pages, MCC attendance-billing context, admin reporting revenue summaries
- Gap status: fixed app-layer direct Supabase read bypass in pricing history page

## 5) Sales
- Canonical tables: `leads`, `lead_activities`, `lead_stage_history`, `community_partner_organizations`, `referral_sources`, `partner_activities`, `enrollment_packet_requests`
- Canonical write paths: sales server actions -> `sales-crm-supabase`, `sales-lead-stage-supabase`, `sales-lead-conversion-supabase`, `sales-lead-activities`
- Shared resolvers: canonical lead identity/state resolvers
- Downstream consumers: sales pipeline/by-stage/detail, enrollment packet send path
- Gap status: no new mock/fallback/canonical bypass issue detected

## 6) Care Plans
- Canonical tables: `care_plans`, `care_plan_sections`, `care_plan_versions`, `care_plan_review_history`, `care_plan_signature_events`, `care_plan_nurse_signatures`, `member_files`
- Canonical write paths: care-plan actions -> shared care-plan services -> `care-plans-supabase`
- Shared resolvers: care-plan authorization and e-sign rule modules
- Downstream consumers: care plan list/dashboard/detail/version/sign routes
- Gap status: no new duplicate business-rule implementation or mock path detected

## 7) Admin Reporting
- Canonical read tables/views/RPC: attendance, billing, transportation, sales, care plan aggregates + `rpc_get_member_documentation_summary`
- Canonical read paths: `admin-reporting-foundation.ts`, `admin-reporting-core.ts`, `reports-ops.ts`
- Shared resolvers: billing-effective and expected-attendance shared resolver modules
- Downstream consumers: `/admin-reports/*`, `/reports/*`
- Gap status: no new report-side bypass or fabricated data fallback detected

## Supabase Backing / Banned Pattern Results

Checks executed:
- runtime mock import scan (`@/lib/mock|lib/mock`) across `app`, `lib/services`, `components`
- direct app-layer Supabase call scan in priority domains (`createClient`, `createAdminClient`, `supabase.from`, `supabase.rpc`)
- catch-return masking scan for synthetic defaults in runtime service paths

Results:
- `mock_import_hits=0`
- `priority_app_direct_supabase_hits=0` (after pricing-page service-layer fix)
- `priority_service_catch_mask_hits=0`

## Seed / Runtime / Migration Alignment

- Runtime migration references scanned against `supabase/migrations`.
- `runtime_migration_refs=42`
- `missing_migration_refs=0`
- MCC schema mismatch handling now fails explicitly (no reduced-schema retry path).

## Validation Results

- `npm.cmd run typecheck`: passed
- `node ./node_modules/next/dist/bin/next build`: partially executed (compile + lint/type phases passed) but final build failed with `spawn EPERM` in this environment
- `npm.cmd run build`: blocked earlier by `npx kill-port` registry access failure (`EACCES`) due restricted network
- `npm.cmd run reseed`: failed with `spawn EPERM` (`esbuild` service spawn)
- `npm.cmd run db:check`: failed with `spawnSync cmd.exe EPERM`
- `npm.cmd run quality:gates`: failed with `spawnSync ... EPERM`

Additional note:
- webpack performance warning still present: `webpack.cache.PackFileCacheStrategy` big-string serialization warning.

## Files Changed in This Run

- `app/(portal)/operations/pricing/page.tsx`
- `lib/services/enrollment-pricing.ts`
- `lib/services/member-command-center-member-queries.ts`
- `lib/services/member-command-center-member-queries.test.ts`

## Migrations Added/Updated in This Run

- None

## Duplicated Rule Implementations Removed in This Run

- Removed MCC reduced-schema retry path that allowed non-canonical partial member reads when required columns were missing.
- Consolidated pricing history read under canonical enrollment-pricing service boundary (removed app-layer direct implementation).

## Resolved vs Unresolved Gaps

Resolved:
- removed one priority-domain app-layer Supabase bypass (`operations/pricing` history tab)
- removed MCC schema fallback retry that masked canonical schema drift
- post-fix banned-pattern scans clean in audited scope
- runtime migration references fully aligned with migration files

Unresolved:
- full validation signoff remains blocked by environment process-spawn restrictions (`EPERM`) for build finalization, reseed, db sync check, quality gates, and node test runner
- webpack cache big-string warning remains a non-functional performance risk

## Production-Readiness Statement (Audited Scope)

For the audited priority domains, runtime paths are Supabase-backed and canonical by static analysis and banned-pattern verification after this run's fixes.  
Final end-to-end production-readiness signoff is still conditional on running build/reseed/db-check/quality-gates successfully in an environment that allows required subprocess spawning.