# Production Readiness Audit - 2026-03-24

## Scope
Priority domains audited in order:
1. attendance / census / schedule changes / holds / closures
2. MCC
3. transportation
4. billing
5. sales
6. care plans
7. admin reporting

Audit dimensions covered together: Supabase backing, canonical source-of-truth, schema drift, shared resolver compliance, fallback masking behavior, downstream consumer alignment, seed/runtime/migration alignment, and production blockers.

## Root Cause Summary
- Main remaining architecture risk in audited scope is billing custom-invoice ACID safety: the custom invoice write flow is still multi-step and non-atomic.
- A concrete canonicality gap was present in billing runtime logic: synthetic fallback BillingSetting objects were created in code to compute rates/status when no member row existed.
- Environment-level process spawn restrictions (EPERM) block end-to-end execution of build/reseed/quality-gates validations on this host.

## Fixes Applied This Run
1. Added shared transportation billing-status resolver:
   - `resolveEffectiveTransportationBillingStatus` in `lib/services/billing-effective.ts`
2. Consolidated consumers onto shared resolver logic:
   - `lib/services/billing-preview-helpers.ts`
   - `lib/services/billing-custom-invoices.ts`
3. Removed fabricated billing-setting fallback objects from runtime paths:
   - `lib/services/billing-custom-invoices.ts`
   - `lib/services/billing-supabase.ts`

## Domain-by-Domain Canonical Map and Gaps

### 1) Attendance / Census / Schedule Changes / Holds / Closures
- Canonical tables:
  - `attendance_records`, `member_attendance_schedules`, `schedule_changes`, `member_holds`, `center_closures`, `closure_rules`
- Canonical write paths:
  - attendance: `app/(portal)/operations/attendance/actions.ts` -> `lib/services/attendance-workflow-supabase.ts` (+ billing sync through `lib/services/billing-supabase.ts`)
  - schedule changes: `app/(portal)/operations/schedule-changes/actions.ts` -> `lib/services/schedule-changes-supabase.ts`
  - holds: `app/(portal)/operations/holds/actions.ts` -> `lib/services/holds-supabase.ts`
  - closures/rules: payor actions -> `lib/services/billing-configuration.ts` / `lib/services/billing-supabase.ts`
- Shared resolvers:
  - expected attendance resolver path: `lib/services/expected-attendance-supabase.ts` + `lib/services/expected-attendance.ts`
- Downstream consumers:
  - attendance/census UI and reports (`lib/services/attendance.ts`, admin reporting foundation)
- Status:
  - Supabase-backed and canonical for audited flows.
  - No runtime mock/file-backed fallback detected.

### 2) MCC
- Canonical tables:
  - `member_command_centers`, `member_attendance_schedules`, `member_contacts`, `members`
- Canonical write paths:
  - MCC actions -> `app/(portal)/operations/member-command-center/actions-impl.ts` -> `lib/services/member-command-center-write.ts` / `lib/services/member-command-center-supabase.ts`
- Shared resolvers:
  - canonical person/member resolver: `lib/services/canonical-person-ref.ts`
- Downstream consumers:
  - MCC detail/index pages and attendance-billing tab
- Status:
  - Canonical service boundary preserved; no direct app-layer Supabase write bypass found in audited MCC paths.

### 3) Transportation
- Canonical tables:
  - `transportation_logs`, `transportation_manifest_adjustments` (via station services), related member contact/schedule tables
- Canonical write paths:
  - station actions -> `app/(portal)/operations/transportation-station/actions.ts` -> `lib/services/transportation-station-supabase.ts` / `lib/services/transportation-run-posting.ts`
- Shared resolvers:
  - canonical member resolver + schedule-derived transport slot logic (`member-schedule-selectors`)
- Downstream consumers:
  - transportation station pages, print view, transportation documentation views
- Status:
  - Supabase-backed and canonical in audited paths.

### 4) Billing
- Canonical tables:
  - `billing_batches`, `billing_invoices`, `billing_invoice_lines`, `billing_coverages`, `billing_adjustments`, `member_billing_settings`, `center_billing_settings`
- Canonical write paths:
  - batch generation/export via shared RPC wrappers (`lib/services/billing-rpc.ts`)
  - custom invoice path in `lib/services/billing-custom-invoices.ts`
- Shared resolvers:
  - `lib/services/billing-effective.ts` now includes shared transportation status resolver and effective rate/mode resolvers
- Downstream consumers:
  - payor module pages/actions, previews/reports, attendance billing sync
- Resolved this run:
  - removed fabricated BillingSetting fallback object paths
  - consolidated transport billing-status derivation into shared resolver
- Unresolved:
  - custom invoice flow remains multi-write and non-atomic (ACID blocker)

### 5) Sales
- Canonical tables:
  - `leads`, `lead_activities`, `partners`, `referral_sources`, related audit/event tables
- Canonical write paths:
  - sales actions -> `app/sales-*.ts` -> `lib/services/sales-crm-supabase.ts`, `lib/services/sales-lead-stage-supabase.ts`, `lib/services/sales-lead-conversion-supabase.ts`
- Shared resolvers:
  - canonical lead transition resolver in `sales-lead-stage-supabase`
- Downstream consumers:
  - sales pipeline/detail/summary/reporting pages and read models
- Status:
  - Supabase-backed and canonical for audited write paths; no new bypasses detected.

### 6) Care Plans
- Canonical tables:
  - `care_plans`, `care_plan_sections`, signature/workflow tables, related member file artifacts
- Canonical write paths:
  - care plan actions -> service layer (`care-plans-supabase`, `care-plan-esign*`)
- Shared resolvers:
  - care plan model/esign rule services
- Downstream consumers:
  - care plan portal pages + public sign flows
- Status:
  - Service-layer write boundaries preserved in audited scope.

### 7) Admin Reporting
- Canonical tables/views:
  - reporting reads from canonical operational tables and migration-backed views
- Canonical read/resolver path:
  - `lib/services/admin-reporting-foundation.ts` + `admin-reporting-core.ts` using shared attendance/billing resolvers
- Downstream consumers:
  - `app/(portal)/admin-reports/*`
- Status:
  - Uses shared resolver paths for attendance/billing derivation; no new resolver drift found in audited paths.

## Schema Drift and Migration Alignment
- Runtime reference check (this run): 108 `.from("table")` references found in code.
- 10 unresolved names in table-only check were views (`v_*`); all are migration-backed.
- No new missing migration filename references detected in this pass.

## Banned Pattern Sweep (This Run)
- Runtime `lib/mock` imports in `lib/` + `app/` (excluding tests/mock folder): none found.
- No fabricated fallback persistence matches found in audited pattern search.

## Validation Results
- `cmd /c npm run typecheck`: passed.
- `cmd /c npm run build`: failed, environment `spawn EPERM`.
- `cmd /c npm run reseed`: failed, environment `spawn EPERM`.
- `cmd /c npm run quality:gates`: failed, environment `spawnSync ... EPERM`.

## Files Changed (This Run)
- `lib/services/billing-effective.ts`
- `lib/services/billing-preview-helpers.ts`
- `lib/services/billing-custom-invoices.ts`
- `lib/services/billing-supabase.ts`

## Resolved vs Unresolved Gaps
### Resolved
- Removed synthetic runtime fallback billing-setting objects in audited billing paths.
- Consolidated duplicated transportation billing-status derivation into shared resolver.
- Confirmed audited priority-domain runtime remains Supabase-backed in inspected write/read paths.

### Unresolved (Blockers / Follow-up)
1. Billing custom invoice workflow is still non-atomic across invoice + lines + source-row + coverage writes.
2. Build/reseed/quality-gates cannot complete on this host due process spawn EPERM restrictions.

## Current Audit Statement
For the audited scope and inspected paths, runtime is Supabase-backed and canonical, with one remaining architecture blocker (custom-invoice atomicity) plus environment-level validation blockers (EPERM spawn restrictions).
