# Production Readiness Audit - 2026-03-31

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
- One concrete billing canonicality/read-safety gap was present: `lib/services/billing-configuration.ts` tolerated `members` query failures in three shared lookup flows and silently degraded output (`Unknown Member` labels or empty member/payor lists) instead of failing explicitly.
- This masked Supabase read errors in production paths and could mislead operators with partial data.
- Fixed by enforcing explicit error throws on `members` read failures in all affected flows.

## Domain-by-Domain Canonical Map and Gaps

### 1) Attendance / Census / Schedule Changes / Holds / Closures
- Canonical tables:
  - `attendance_records`, `member_attendance_schedules`, `schedule_changes`, `member_holds`, `center_closures`, `closure_rules`
- Canonical write paths:
  - attendance actions -> `app/(portal)/operations/attendance/actions.ts` -> `lib/services/attendance-workflow-supabase.ts`
  - schedule changes actions -> `app/(portal)/operations/schedule-changes/actions.ts` -> `lib/services/schedule-changes-supabase.ts` (RPC-backed attendance-sync boundary)
  - holds actions -> `app/(portal)/operations/holds/actions.ts` -> `lib/services/holds-supabase.ts`
- Shared resolvers:
  - `lib/services/expected-attendance-supabase.ts`
  - `lib/services/expected-attendance.ts` (`isCenterClosedOnDate` closure gating)
- Downstream consumers:
  - operations attendance + schedule-change pages/actions, MCC attendance views, transportation and reporting consumers
- Status:
  - Verified Supabase-backed and canonical in audited runtime surface.

### 2) MCC
- Canonical tables:
  - `member_command_centers`, `members`, `member_contacts`, `member_attendance_schedules`, `member_files`, `member_allergies`
- Canonical write paths:
  - MCC actions -> `app/(portal)/operations/member-command-center/actions-impl.ts` -> `lib/services/member-command-center.ts` / `lib/services/member-command-center-write.ts`
- Shared resolvers:
  - canonical identity resolution via MCC shared services (`resolveCanonicalMemberId`/MCC read helpers)
- Downstream consumers:
  - MCC index/detail and linked attendance/billing/transportation workflows
- Status:
  - Verified Supabase-backed and canonical in audited runtime surface.

### 3) Transportation
- Canonical tables:
  - `transportation_logs`, `transportation_manifest_adjustments`, `transportation_runs`, `transportation_run_results`, `bus_stop_directory`
- Canonical write paths:
  - station actions -> `app/(portal)/operations/transportation-station/actions.ts` -> `lib/services/transportation-station-supabase.ts` / `lib/services/transportation-run-posting.ts`
- Shared resolvers:
  - attendance/schedule derivation through shared expected-attendance resolvers and schedule selectors
- Downstream consumers:
  - transportation station UI + printing + reporting/billing integrations
- Status:
  - Verified Supabase-backed and canonical in audited runtime surface.

### 4) Billing
- Canonical tables:
  - `billing_batches`, `billing_invoices`, `billing_invoice_lines`, `billing_coverages`, `billing_adjustments`, `member_billing_settings`, `center_billing_settings`, `center_closures`, `closure_rules`, `payors`
- Canonical write paths:
  - payor actions -> `app/(portal)/operations/payor/actions-impl.ts` -> billing services (`billing-supabase`, `billing-configuration`, `billing-rpc`, `member-command-center-write` for center setting writes)
- Shared resolvers:
  - `lib/services/billing-effective.ts` (`resolveEffectiveBillingMode`, `resolveEffectiveDailyRate`, `resolveEffectiveTransportationBillingStatus`)
- Downstream consumers:
  - payor workflows (agreements, closures, schedule templates, adjustments, batches, exports), attendance billing, admin reporting
- Status:
  - Fixed this run: removed silent degraded reads by throwing on `members` query errors in billing configuration shared lookups.

### 5) Sales
- Canonical tables:
  - `leads`, `lead_activities`, `lead_stage_history`, `community_partner_organizations`, `referral_sources`, `partner_activities`, enrollment packet tables
- Canonical write paths:
  - sales actions (`app/sales-lead-actions.ts`, `app/sales-enrollment-actions.ts`) -> `sales-crm-supabase`, `sales-lead-stage-supabase`, `sales-lead-conversion-supabase`
- Shared resolvers:
  - `sales-workflows`, canonical lead-state/stage services, sales read-model services
- Downstream consumers:
  - sales pipeline/read-model pages, enrollment workflows, reporting
- Status:
  - Verified Supabase-backed and canonical in audited runtime surface.

### 6) Care Plans
- Canonical tables:
  - `care_plans`, `care_plan_sections`, `care_plan_versions`, `care_plan_signature_events`, `care_plan_nurse_signatures`
- Canonical write paths:
  - care plan actions -> `app/care-plan-actions.ts` -> `care-plans-write`/`care-plan-esign` -> `care-plans-supabase`
- Shared resolvers:
  - `care-plan-esign-rules` and shared care-plan read/write services
- Downstream consumers:
  - care plan portal pages/actions and public e-sign surfaces
- Status:
  - Verified Supabase-backed and canonical in audited runtime surface.

### 7) Admin Reporting
- Canonical tables/views:
  - operational canonical tables + migration-backed reporting views (`v_*`) and reporting RPCs
- Canonical read/resolver paths:
  - `admin-reporting-foundation`, `admin-reporting-core`, `reporting-attendance-dataset`
- Downstream consumers:
  - admin-report pages and dashboard/report exports
- Status:
  - Verified Supabase-backed and canonical in audited runtime surface.

## Banned Pattern Sweep (This Run)
- Runtime mock imports (`app/` + `lib/`, excluding tests and `lib/mock`): `mock_import_hits=0`
- Priority app direct Supabase bypass hits: `priority_app_direct_supabase_hits=0`
- Priority service catch-return masking hits: `priority_service_catch_mask_hits=0`

## Schema Drift / Seed-Runtime-Migration Alignment
- Runtime migration filename references in code: `runtime_migration_refs=66`
- Missing migration filename references: `missing_migration_refs=0`
- Runtime `.from("...")` references extracted: `runtime_from_refs=108`
- Unresolved runtime `.from` refs against migration-defined tables/views: `unresolved_from_refs_count=0`
- No new seed/runtime/migration mismatch detected in static checks for the audited priority scope.

## Validation Results
- `npm.cmd run typecheck`: passed.
- `npm.cmd run build`: failed (`spawn EPERM` during build subprocess stage).
- `npm.cmd run reseed`: failed (`spawn EPERM` while starting esbuild subprocess).
- Required banned-pattern and runtime-reference checks: passed (counts above).

## Files Changed (This Run)
- `lib/services/billing-configuration.ts`
- `docs/audits/production-readiness-audit-2026-03-31.md`

## Migrations Added/Updated
- None.

## Duplicated Rule Implementations Removed
- None in this run.

## Resolved vs Unresolved Gaps
### Resolved
- Billing shared lookup flows now fail explicitly when canonical `members` reads fail, removing silent degraded/fallback behavior:
  - `listMemberBillingSettings`
  - `listBillingScheduleTemplates`
  - `getMembersAndPayorsForLookup`

### Unresolved (Blockers/Risks)
1. Host subprocess restrictions (`EPERM`) still block full build+reseed gate completion, preventing full end-to-end signoff.
2. Billing custom-invoice generation remains a multi-step workflow without a single shared atomic RPC boundary (architecture hardening debt for strict ACID guarantees).

## Current Audit Statement
For the audited priority scope, runtime paths are Supabase-backed and canonical in static analysis, with the billing masked-read gap removed in this run. Final production-readiness signoff remains blocked by host-level `EPERM` subprocess restrictions on required runtime validation gates.
