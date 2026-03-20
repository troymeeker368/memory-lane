# Production Readiness Audit

Date: 2026-03-20  
Scope: priority domains (attendance/census/schedule changes/holds/closures, MCC, transportation, billing, sales, care plans, admin reporting)  
Method: static code audit + banned-pattern sweeps + schema-reference verification + full validation gates

## Root Cause Summary

This run found two concrete schema-drift guidance defects in runtime error messaging:
- runtime referenced non-existent migration `0052_enrollment_packets.sql`
- runtime referenced non-existent migration `0095_user_management_profile_metadata.sql`

Both were corrected to real forward migrations. No new priority-domain mock/runtime split-brain paths, direct app-layer Supabase write bypasses, or catch-return masking patterns were found.

## Domain-by-Domain Canonical Map and Gap Status

## 1) Attendance / Census / Schedule Changes / Holds / Closures
- Canonical tables: `attendance_records`, `member_attendance_schedules`, `member_holds`, `schedule_changes`, `center_closures`, `closure_rules`, `billing_adjustments`
- Canonical write paths:
  - `app/(portal)/operations/attendance/actions.ts` -> `lib/services/attendance-workflow-supabase.ts`
  - `app/(portal)/operations/schedule-changes/actions.ts` -> `lib/services/schedule-changes-supabase.ts`
  - `app/(portal)/operations/holds/actions.ts` -> `lib/services/holds-supabase.ts`
  - `app/(portal)/operations/payor/actions.ts` (closures) -> `lib/services/billing-supabase.ts` + `lib/services/closure-rules.ts`
- Shared resolvers:
  - `resolveExpectedAttendanceFromSupabaseContext` / `loadExpectedAttendanceSupabaseContext`
  - closure rule generation in shared closure services
- Downstream consumers: operations attendance/schedule/holds/closures UIs, transportation staffing projections, admin reporting attendance snapshots
- Gap status: no new bypass or fallback masking found

## 2) Member Command Center (MCC)
- Canonical tables: `members`, `member_command_centers`, `member_attendance_schedules`, `member_contacts`, `member_files`, `member_allergies`, `member_billing_settings`
- Canonical write paths:
  - MCC actions -> `app/(portal)/operations/member-command-center/actions-impl.ts`
  - service boundary -> `lib/services/member-command-center.ts`
  - Supabase adapters -> `lib/services/member-command-center-supabase.ts`
- Shared resolvers:
  - canonical identity resolution (`lib/services/canonical-person-ref.ts`)
  - effective billing resolver (`lib/services/billing-effective.ts`)
- Downstream consumers: MCC detail tabs, attendance billing screen, transportation station workflows
- Gap status: no new fallback fabrication paths found

## 3) Transportation
- Canonical tables: `transportation_runs`, `transportation_run_results`, `transportation_manifest_adjustments`, `transportation_logs`, `member_attendance_schedules`, `attendance_records`
- Canonical write paths:
  - transportation station actions -> `lib/services/transportation-station-supabase.ts`
  - posting workflow -> `lib/services/transportation-run-posting.ts` (RPC-backed)
- Shared resolvers:
  - canonical member identity resolver
  - schedule/attendance context via expected-attendance shared services
- Downstream consumers: transportation station page + print, operations, billing ancillary/transportation rollups
- Gap status: no non-canonical write paths or runtime mock usage found

## 4) Billing
- Canonical tables: `center_billing_settings`, `member_billing_settings`, `billing_schedule_templates`, `billing_batches`, `billing_invoices`, `billing_invoice_lines`, `billing_adjustments`
- Canonical write paths:
  - payor actions -> `lib/services/billing-supabase.ts`
  - multi-step/batch flows -> `lib/services/billing-rpc.ts`
- Shared resolvers:
  - `resolveActiveEffectiveRowForDate` / `resolveActiveEffectiveMemberRowForDate`
  - `resolveEffectiveBillingMode` / `resolveConfiguredDailyRate` (billing-effective)
- Downstream consumers: payor center pages, MCC attendance-billing screen, admin reporting revenue summaries
- Gap status: resolver consistency intact in audited scope

## 5) Sales
- Canonical tables: `leads`, `lead_activities`, `lead_stage_history`, `community_partner_organizations`, `referral_sources`, `partner_activities`, `enrollment_packet_requests`
- Canonical write paths:
  - server actions: `app/sales-lead-actions.ts`, `app/sales-partner-actions.ts`, `app/sales-enrollment-actions.ts`
  - services: `sales-crm-supabase`, `sales-lead-stage-supabase`, `sales-lead-conversion-supabase`, `sales-lead-activities`
- Shared resolvers:
  - canonical lead state (`resolveCanonicalLeadState`)
  - canonical lead identity resolution (`resolveSalesLeadId`)
- Downstream consumers: sales pipeline/by-stage/detail pages, enrollment packet send flow, partner and referral detail pages
- Gap status: no direct write bypass or fabricated-success branch found

## 6) Care Plans
- Canonical tables: `care_plans`, `care_plan_sections`, `care_plan_versions`, `care_plan_review_history`, `care_plan_signature_events`, `care_plan_nurse_signatures`, `member_files`
- Canonical write paths:
  - care plan actions (`app/(portal)/health/care-plans/[carePlanId]/actions.ts`) -> shared care-plan services
  - Supabase persistence -> `lib/services/care-plans-supabase.ts`
- Shared resolvers:
  - care plan signing rule helpers (`care-plan-esign-rules`)
  - canonical authorization/service boundaries
- Downstream consumers: care plan dashboards/list/detail/version/public sign routes
- Gap status: no duplicate write-path implementation or mock-backed branch found

## 7) Admin Reporting
- Canonical read tables/views: attendance/billing/transportation/sales/care plan aggregates + `rpc_get_member_documentation_summary`
- Canonical read paths:
  - `lib/services/admin-reporting-foundation.ts`
  - `lib/services/admin-reporting-core.ts`
  - `lib/services/reports-ops.ts`
- Shared resolvers:
  - billing-effective shared resolver imported and used by admin-reporting-core
  - expected-attendance shared context/resolver path imported and used by admin-reporting-foundation
- Downstream consumers: `/admin-reports/*`, `/reports/*`
- Gap status: no report-side runtime mock imports or fabricated data fallback found

## Supabase Backing / Banned Pattern Results

Checks executed:
- runtime mock import scan (`@/lib/mock|lib/mock`) across `app`, `lib/services`, `components`
- direct app-layer Supabase call scan in priority UI/action paths (`createClient`, `createAdminClient`, `supabase.from`, `supabase.rpc`)
- catch-return masking scan for synthetic defaults in priority services

Results:
- `mock_import_hits=0`
- `priority_app_direct_supabase_hits=0`
- `priority_service_catch_mask_hits=0`

## Seed / Runtime / Migration Alignment

- Runtime migration references re-scanned against `supabase/migrations`.
- Resolved missing migration references:
  - `0052_enrollment_packets.sql` -> `0024_enrollment_packet_workflow.sql`
  - `0095_user_management_profile_metadata.sql` -> `0096_user_management_profile_metadata.sql`
- Post-fix migration reference scan reports no missing migration filenames.

## Validation Results

- `npm run build`: passed
- `npm run reseed`: passed
- `npm run db:check`: passed (`linked database and generated types are in sync`)
- `npm run quality:gates`: passed
- `npm run typecheck`: passed (after rerun; first attempt overlapped with build and hit transient `.next/types` race)

## Files Changed in This Run

- `lib/services/enrollment-packet-core.ts`
- `lib/services/user-management.ts`
- `types/supabase.ts` (regenerated schema types)

## Migrations Added/Updated in This Run

- None

## Duplicated Rule Implementations Removed in This Run

- None

## Resolved vs Unresolved Gaps

Resolved:
- fixed two schema-drift migration reference defects in runtime error guidance
- validated priority domains remain Supabase-backed with no new runtime mock/fabrication patterns in audited scope
- full validation gate suite executed successfully in this environment

Unresolved:
- `components/ui/back-arrow-button.tsx` changed outside explicit audit edits during run and was left untouched for owner confirmation
- webpack cache warning persists: `PackFileCacheStrategy` big-string serialization warning (performance risk, not a functional blocker)

## Production-Readiness Statement (Audited Scope)

For the audited priority domains, runtime paths are Supabase-backed and canonical by current static/runtime validation, with no newly detected fallback fabrication or competing business-rule implementation in scope.  
This run is production-ready for audited scope with the unresolved non-functional performance warning noted above.
