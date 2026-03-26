# Production Readiness Audit - 2026-03-26

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
- One concrete canonicality gap was confirmed in MCC runtime reads: index/detail APIs could fabricate default profile/schedule records in memory when canonical rows were missing.
- This run removes that runtime fabrication path by forcing canonical Supabase backfill first, then failing explicitly if canonical rows are still missing.
- No new priority-domain app-layer Supabase bypasses, runtime mock imports, or catch-return fallback masking regressions were detected.

## Domain-by-Domain Canonical Map and Gaps

### 1) Attendance / Census / Schedule Changes / Holds / Closures
- Canonical tables:
  - `attendance_records`, `member_attendance_schedules`, `schedule_changes`, `member_holds`, `center_closures`, `closure_rules`
- Canonical write paths:
  - attendance actions -> `lib/services/attendance-workflow-supabase.ts` (+ `lib/services/billing-workflows.ts` sync)
  - schedule-change actions -> `lib/services/schedule-changes-supabase.ts`
  - holds actions -> `lib/services/holds-supabase.ts`
  - closure/rules actions -> `lib/services/billing-configuration.ts`
- Shared resolvers:
  - expected attendance resolver stack: `expected-attendance.ts` + `expected-attendance-supabase.ts`
- Downstream consumers:
  - operations attendance, MCC attendance surfaces, attendance/admin reporting
- Status:
  - Supabase-backed and canonical in audited paths.

### 2) MCC
- Canonical tables:
  - `member_command_centers`, `member_attendance_schedules`, `member_contacts`, `members`, `member_files`, `member_allergies`
- Canonical write paths:
  - MCC actions -> `app/(portal)/operations/member-command-center/actions-impl.ts` -> `lib/services/member-command-center*.ts`
  - canonical aux-row backfill path -> `backfillMissingMemberCommandCenterRowsSupabase`
- Shared resolvers:
  - canonical identity resolver: `resolveCanonicalMemberId` / `resolveMccMemberId`
- Downstream consumers:
  - MCC index/detail pages, member lookups, attendance-billing surfaces
- Status:
  - Fixed this run: removed fabricated index/detail fallback read records and enforced canonical backfill + explicit failure behavior.

### 3) Transportation
- Canonical tables:
  - `transportation_logs`, `transportation_manifest_adjustments`, `transportation_runs`, `transportation_run_results`
- Canonical write paths:
  - transportation actions -> `transportation-station-supabase.ts` / `transportation-run-posting.ts`
- Shared resolvers:
  - expected attendance resolver reused via `expected-attendance-supabase`
- Downstream consumers:
  - transportation station, manifest print, operations reporting
- Status:
  - Supabase-backed and canonical in audited paths.

### 4) Billing
- Canonical tables:
  - `billing_batches`, `billing_invoices`, `billing_invoice_lines`, `billing_coverages`, `billing_adjustments`, `member_billing_settings`, `center_billing_settings`
- Canonical write paths:
  - billing actions -> billing services (`billing-workflows`, `billing-supabase`) -> RPC wrappers (`billing-rpc.ts`)
  - custom invoice path -> `billing-custom-invoices.ts` -> `invokeCreateCustomInvoiceRpc`
- Shared resolvers:
  - `billing-effective.ts` (`resolveEffectiveBillingMode`, `resolveEffectiveDailyRate`, `resolveEffectiveTransportationBillingStatus`)
- Downstream consumers:
  - payor workflows, billing preview/export, attendance billing sync
- Status:
  - Supabase-backed and resolver-aligned in audited paths.

### 5) Sales
- Canonical tables:
  - `leads`, `lead_activities`, `community_partner_organizations`, `referral_sources`, `partner_activities`
- Canonical write paths:
  - sales server actions -> `sales-crm-supabase.ts`, `sales-lead-stage-supabase.ts`, `sales-lead-conversion-supabase.ts`
- Shared resolvers:
  - lead transition resolver in `sales-lead-stage-supabase.ts`
- Downstream consumers:
  - sales pipeline/detail/read-model/reporting pages
- Status:
  - Supabase-backed and canonical in audited paths.

### 6) Care Plans
- Canonical tables:
  - `care_plans`, `care_plan_sections`, `care_plan_versions`, `care_plan_signature_events`, `care_plan_nurse_signatures`
- Canonical write paths:
  - care plan actions -> `care-plans-supabase.ts`, `care-plan-esign.ts`, `care-plan-esign-public.ts`
- Shared resolvers:
  - e-sign rules in `care-plan-esign-rules.ts`
- Downstream consumers:
  - care plan portal pages and public sign flows
- Status:
  - Canonical service boundaries preserved in audited paths.

### 7) Admin Reporting
- Canonical tables/views:
  - operational tables plus migration-backed views (`v_*` reporting views)
- Canonical read/resolver paths:
  - `admin-reporting-foundation.ts` + `admin-reporting-core.ts`
- Downstream consumers:
  - `app/(portal)/admin-reports/*`
- Status:
  - Supabase-backed and shared-resolver aligned in audited paths.

## Banned Pattern Sweep (This Run)
- Runtime mock imports (`app/` + `lib/`, excluding tests and `lib/mock`): `0` hits.
- Priority app direct Supabase bypass hits: `0`.
- Priority service catch-return masking hits (`return []/{}/null/undefined/...` inside catch): `0`.

## Schema Drift / Seed-Runtime-Migration Alignment
- Runtime migration filename references in code: `64`.
- Missing migration filename references: `0`.
- Runtime `.from("...")` references scanned: `107`.
- Unresolved runtime refs against migration-declared tables/views: `0`.
- No new seed/runtime/migration mismatch identified in the audited scope.

## Validation Results
- `cmd /c npm run typecheck`: passed.
- `cmd /c npm run build`: failed (`spawn EPERM` during build TypeScript stage subprocess).
- `cmd /c npm run reseed`: failed (`spawn EPERM` starting esbuild subprocess).
- `cmd /c npm run quality:gates`: failed (`spawnSync cmd.exe EPERM`).
- `cmd /c npm run db:check`: failed (`spawnSync cmd.exe EPERM`).

## Files Changed (This Run)
- `lib/services/member-command-center-runtime.ts`
- `docs/audits/production-readiness-audit-2026-03-26.md`

## Migrations Added/Updated
- None.

## Duplicated Rule Implementations Removed
- No new duplicated derived-rule blocks were introduced in the audited scope.
- MCC read-path fallback fabrication was removed in favor of canonical backfill + explicit failure behavior.

## Resolved vs Unresolved Gaps
### Resolved
- Removed runtime fabricated MCC fallback records in index/detail read paths.
- Enforced canonical Supabase backfill for missing MCC profile/schedule rows before returning success payloads.
- Maintained clean banned-pattern results across priority domains (mock imports, app bypasses, catch-return masking).
- Verified migration reference and runtime table/view backing alignment for audited scope.

### Unresolved (Blockers)
1. Host environment subprocess restrictions (`EPERM`) still block full build/reseed/quality/db gate completion.

## Current Audit Statement
For the audited priority scope, runtime paths are Supabase-backed and canonical with the MCC fabricated-read fallback gap now removed. Final production-readiness signoff remains blocked by host-level `EPERM` subprocess restrictions on build/reseed/quality/db validation gates.
