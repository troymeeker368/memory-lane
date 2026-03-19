# Production Readiness Audit

Date: 2026-03-19  
Scope: priority domains (attendance/census/schedule changes/holds/closures, MCC, transportation, billing, sales, care plans, admin reporting)  
Method: static code audit + banned-pattern searches + validation commands

## Root Cause Summary

No new high-severity canonicality or fallback-masking defects were found in the priority domains during this pass.

The primary production-readiness blocker remains environment-level command execution limits (`spawn EPERM`), which prevented full build/reseed/schema-sync gate completion in this runtime.

## Domain-by-Domain Canonical Map and Gap Status

## 1) Attendance / Census / Schedule Changes / Holds / Closures
- Canonical tables: `attendance_records`, `member_attendance_schedules`, `member_holds`, `schedule_changes`, `center_closures`, `closure_rules`, `billing_adjustments`
- Canonical write paths:
  - `app/(portal)/operations/attendance/actions.ts` -> `lib/services/attendance-workflow-supabase.ts`
  - `app/(portal)/operations/schedule-changes/actions.ts` -> `lib/services/schedule-changes-supabase.ts`
  - `app/(portal)/operations/holds/actions.ts` -> `lib/services/holds-supabase.ts`
- Shared resolvers:
  - `resolveExpectedAttendanceFromSupabaseContext` (`lib/services/expected-attendance-supabase.ts`)
  - `resolveExpectedAttendanceForDate` (`lib/services/expected-attendance.ts`)
  - closure rule generation (`lib/services/closure-rules.ts`)
- Downstream consumers: operations attendance pages, schedule/holds pages, reporting aggregates, transportation attendance projections
- Gap status: no new direct write bypasses, no runtime mock imports, no fallback-catch synthetic returns detected

## 2) Member Command Center (MCC)
- Canonical tables: `members`, `member_command_centers`, `member_attendance_schedules`, `member_contacts`, `member_files`, `member_allergies`, `bus_stop_directory`
- Canonical write paths:
  - MCC actions -> `lib/services/member-command-center.ts`
  - Supabase adapters -> `lib/services/member-command-center-supabase.ts`
- Shared resolvers:
  - canonical identity resolution (`lib/services/canonical-person-ref.ts`)
  - MCC query mapping (`lib/services/member-command-center-member-queries.ts`)
- Downstream consumers: MCC pages, transportation rider selection, billing/contact views
- Gap status: no new fallback masking or competing write paths found in audited MCC paths

## 3) Transportation
- Canonical tables: `transportation_manifest_adjustments`, `transportation_runs`, `transportation_run_results`, `transportation_logs`, `member_attendance_schedules`, `attendance_records`
- Canonical write paths:
  - station actions -> `lib/services/transportation-station-supabase.ts`
  - posting workflow -> `lib/services/transportation-run-posting.ts` (RPC-backed)
- Shared resolvers:
  - attendance/schedule eligibility resolvers
  - transport slot normalization in shared transportation services
- Downstream consumers: transportation station page/print, billing variable-charge flow, operational summaries
- Gap status: no non-canonical write paths or runtime mock usage detected

## 4) Billing
- Canonical tables: `center_billing_settings`, `member_billing_settings`, `billing_schedule_templates`, `billing_adjustments`, `billing_batches`, `billing_invoices`, `billing_invoice_lines`, coverage/export tables
- Canonical write paths:
  - payor/billing actions -> `lib/services/billing-supabase.ts`
  - atomic batch/export workflows -> `lib/services/billing-rpc.ts`
- Shared resolvers:
  - effective billing row/mode/rate resolution (`lib/services/billing-effective.ts`)
  - shared billing core helpers (`lib/services/billing-core.ts`)
- Downstream consumers: payor UI, MCC attendance-billing sync, admin reporting billing views
- Gap status: no new duplicate derived-rule implementations detected in audited billing modules this run

## 5) Sales
- Canonical tables: `leads`, `lead_activities`, `lead_stage_history`, `community_partner_organizations`, `referral_sources`, `partner_activities`
- Canonical write paths:
  - sales actions -> `sales-lead-activities.ts`, `sales-lead-stage-supabase.ts`, `sales-lead-conversion-supabase.ts`
- Shared resolvers:
  - canonical lead lifecycle transition logic
- Downstream consumers: sales pipeline pages, lead timeline, enrollment/intake prefill
- Gap status: no new direct write bypasses or synthetic success fallback branches detected

## 6) Care Plans
- Canonical tables: `care_plans`, `care_plan_sections`, `care_plan_versions`, `care_plan_review_history`, `care_plan_signature_events`, `care_plan_nurse_signatures`, `member_files`
- Canonical write paths:
  - care plan actions -> `lib/services/care-plans-supabase.ts`
  - e-sign flows -> `lib/services/care-plan-esign.ts`, `lib/services/care-plan-nurse-esign.ts`
- Shared resolvers:
  - `care-plan-esign-rules`
  - nurse/esign shared core helpers
- Downstream consumers: care plan pages, public signing routes, downstream member profile sync
- Gap status: no new canonical resolver drift or fallback persistence masking detected

## 7) Admin Reporting
- Canonical read tables/views: attendance, billing, transportation, sales, and documentation reporting sources
- Canonical read paths:
  - `lib/services/admin-reporting-foundation.ts`
  - `lib/services/reports-ops.ts`
- Shared resolvers used: expected-attendance and billing-effective canonical helpers
- Downstream consumers: admin reports pages and operations reporting screens
- Gap status: no new report-side runtime mock imports or fallback branches fabricating business records

## Supabase Backing and Banned-Pattern Checks

Checks executed:
- no `@/lib/mock` imports in `app/` and `lib/services/` runtime paths
- no direct `createClient`/`createAdminClient` usage in priority domain app paths
- no `catch { return [] | {} | null }` style masking patterns in priority service modules

Result:
- no matches in the audited priority scope

## Seed / Runtime / Migration Alignment

- Runtime migration references in services were enumerated and verified present in `supabase/migrations`.
- Referenced migration files found:  
  `0001_initial_schema.sql`, `0006_intake_pof_mhp_supabase.sql`, `0010_member_holds_persistence.sql`, `0011_member_command_center_aux_schema.sql`, `0012_legacy_operational_health_alignment.sql`, `0013_care_plans_and_billing_execution.sql`, `0015_schema_compatibility_backfill.sql`, `0018_runtime_mock_dependency_cleanup.sql`, `0027_enrollment_packet_intake_mapping.sql`
- `npm.cmd run db:check` could not complete due host `EPERM` process-spawn restriction.

## Validation Results

- `npm.cmd run typecheck`: passed
- `npm.cmd run build`: failed with environment `spawn EPERM` after compile step
- `npm.cmd run reseed`: failed with environment `spawn EPERM` (esbuild child process)
- `npm.cmd run db:check`: failed with `spawnSync cmd.exe EPERM`
- `npm.cmd run quality:gates`: failed with `spawnSync cmd.exe EPERM`

## Resolved vs Unresolved Gaps (This Run)

Resolved this run:
- completed full priority-scope static canonicality/fallback/migration-reference sweep
- confirmed no new banned-pattern hits in audited priority scope

Unresolved this run:
- end-to-end production readiness validation remains blocked by environment-level process-spawn restrictions (`EPERM`)
- cannot conclusively verify reseed/build/schema-sync execution in this host until command-spawn permissions are available

## Files Changed in This Run

- `docs/audits/production-readiness-audit-2026-03-19.md`

## Migrations Added/Updated in This Run

- None

## Duplicated Rule Implementations Removed in This Run

- None

## Production-Readiness Statement (Audited Scope)

For the audited priority domains, runtime paths appear Supabase-backed and canonical by static inspection, with no newly detected fallback fabrication branches or mock/runtime split-brain in scope.  
Full production-readiness sign-off is still blocked by environment-level `EPERM` failures on build/reseed/db-check/quality gates.

