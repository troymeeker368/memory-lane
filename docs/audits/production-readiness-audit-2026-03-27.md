# Production Readiness Audit - 2026-03-27

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
- No new priority-domain canonicality regressions were detected in this run.
- Runtime scans remained clean for mock/runtime split behavior, app-layer Supabase bypasses, and catch-return fallback masking patterns.
- Production-readiness signoff remains blocked by host-level subprocess restrictions (`EPERM`) during build/reseed/gate commands.

## Domain-by-Domain Canonical Map and Gaps

### 1) Attendance / Census / Schedule Changes / Holds / Closures
- Canonical tables:
  - `attendance_records`, `member_attendance_schedules`, `schedule_changes`, `member_holds`, `center_closures`, `closure_rules`
- Canonical write paths:
  - attendance actions -> `app/(portal)/operations/attendance/actions.ts` -> `lib/services/attendance-workflow-supabase.ts` (+ `lib/services/billing-workflows.ts` sync)
  - schedule changes actions -> `app/(portal)/operations/schedule-changes/actions.ts` -> `lib/services/schedule-changes-supabase.ts`
  - holds actions -> `app/(portal)/operations/holds/actions.ts` -> `lib/services/holds-supabase.ts`
  - closure/rules actions -> `app/(portal)/operations/payor/actions-impl.ts` -> `lib/services/closure-rules.ts` / `lib/services/billing-configuration.ts`
- Shared resolvers:
  - expected attendance resolver stack: `lib/services/expected-attendance-supabase.ts`
- Downstream consumers:
  - operations attendance page/actions, MCC attendance surfaces, attendance/admin reporting
- Status:
  - Supabase-backed and canonical in audited paths.

### 2) MCC
- Canonical tables:
  - `member_command_centers`, `member_attendance_schedules`, `member_contacts`, `members`, `member_files`, `member_allergies`
- Canonical write paths:
  - MCC actions -> `app/(portal)/operations/member-command-center/actions-impl.ts` -> `lib/services/member-command-center.ts` + `lib/services/member-command-center-write.ts`
- Shared resolvers:
  - canonical identity resolver: `resolveMccMemberId` / canonical person resolver (`lib/services/canonical-person-ref.ts`)
- Downstream consumers:
  - MCC index/detail pages, attendance-billing tab, member lookups
- Status:
  - Supabase-backed and canonical in audited paths.

### 3) Transportation
- Canonical tables:
  - `transportation_logs`, `transportation_manifest_adjustments`, `transportation_runs`, `transportation_run_results`, `bus_stop_directory`
- Canonical write paths:
  - station actions -> `app/(portal)/operations/transportation-station/actions.ts` -> `lib/services/transportation-station-supabase.ts` / `lib/services/transportation-run-posting.ts`
- Shared resolvers:
  - schedule-derived attendance expectations via `expected-attendance-supabase`
- Downstream consumers:
  - transportation station page/actions, transportation print flow, operations reporting reads
- Status:
  - Supabase-backed and canonical in audited paths.

### 4) Billing
- Canonical tables:
  - `billing_batches`, `billing_invoices`, `billing_invoice_lines`, `billing_coverages`, `billing_adjustments`, `member_billing_settings`, `center_billing_settings`
- Canonical write paths:
  - payor actions -> `app/(portal)/operations/payor/actions-impl.ts` -> `lib/services/billing-supabase.ts` / `lib/services/billing-workflows.ts` -> shared RPC wrappers (`lib/services/billing-rpc.ts`) where atomic workflows are required
- Shared resolvers:
  - `lib/services/billing-effective.ts` (`resolveEffectiveBillingMode`, `resolveEffectiveDailyRate`, `resolveEffectiveTransportationBillingStatus`)
- Downstream consumers:
  - payor workflows, billing preview/export, attendance billing sync
- Status:
  - Supabase-backed and resolver-aligned in audited paths.

### 5) Sales
- Canonical tables:
  - `leads`, `lead_activities`, `lead_stage_history`, `community_partner_organizations`, `referral_sources`, `partner_activities`, `enrollment_packet_requests`, `enrollment_packet_fields`, `enrollment_packet_signatures`
- Canonical write paths:
  - sales actions (`app/sales-lead-actions.ts`, `app/sales-partner-actions.ts`, `app/sales-enrollment-actions.ts`) -> canonical services (`sales-crm-supabase`, `sales-lead-stage-supabase`, `sales-lead-conversion-supabase`, `enrollment-packets-sender`, `enrollment-packets-staff`)
- Shared resolvers:
  - lead-state canonical resolver stack (`resolveCanonicalLeadState` + stage-transition RPC boundary)
- Downstream consumers:
  - sales pipeline/lead detail/summary pages, enrollment packet operational surfaces
- Status:
  - Supabase-backed and canonical in audited write/read paths.

### 6) Care Plans
- Canonical tables:
  - `care_plans`, `care_plan_sections`, `care_plan_versions`, `care_plan_signature_events`, `care_plan_nurse_signatures`
- Canonical write paths:
  - care plan actions -> `app/care-plan-actions.ts` -> `lib/services/care-plans-write.ts` / `lib/services/care-plan-esign.ts` -> `lib/services/care-plans-supabase.ts`
- Shared resolvers:
  - e-sign lifecycle rules in `lib/services/care-plan-esign-rules.ts`
- Downstream consumers:
  - care-plan portal pages and public caregiver sign workflow
- Status:
  - Canonical service-layer boundaries preserved in audited paths.

### 7) Admin Reporting
- Canonical tables/views:
  - canonical operational tables + migration-backed reporting views (`v_*`)
- Canonical read/resolver paths:
  - `lib/services/admin-reporting-foundation.ts` + `lib/services/admin-reporting-core.ts`
- Downstream consumers:
  - `app/(portal)/admin-reports/*`
- Status:
  - Supabase-backed and shared-resolver aligned in audited paths.

## Banned Pattern Sweep (This Run)
- Runtime mock imports (`app/` + `lib/`, excluding tests and `lib/mock`): `mock_import_hits=0`
- Priority app direct Supabase import/bypass hits: `priority_app_direct_supabase_hits=0`
- Priority service catch-mask fallback patterns (`return []/{}/null/undefined` inside catch): `priority_service_catch_mask_hits=0`

## Schema Drift / Seed-Runtime-Migration Alignment
- Runtime migration filename references in code: `runtime_migration_refs=54`
- Missing migration filename references: `missing_migration_refs=0`
- Runtime `.from("...")` references extracted: `runtime_from_refs=107`
- Unresolved runtime `.from` refs against migration inventory: `unresolved_from_refs_count=0`
- No new seed/runtime/migration mismatches were identified in audited scope.

## Validation Results
- `cmd /c npm run typecheck`: passed.
- `cmd /c npm run build`: failed (`spawn EPERM` while running TypeScript stage subprocess).
- `cmd /c npm run reseed`: failed (`spawn EPERM` while starting esbuild subprocess).
- `cmd /c npm run quality:gates`: failed (`spawnSync cmd.exe EPERM`).
- `cmd /c npm run db:check`: failed (`spawnSync cmd.exe EPERM`).

## Files Changed (This Run)
- `docs/audits/production-readiness-audit-2026-03-27.md`

## Migrations Added/Updated
- None.

## Duplicated Rule Implementations Removed
- None required in this run; no new duplicated derived-rule implementation was detected in audited priority scope.

## Resolved vs Unresolved Gaps
### Resolved / Verified
- Verified no new non-Supabase runtime paths in audited priority domains.
- Verified no new priority app-layer direct Supabase bypasses.
- Verified no new catch-return masking branches in priority service scope.
- Verified runtime migration guidance references resolve to existing migration files.
- Verified runtime `.from("table/view")` references remain migration-backed in static inventory checks.

### Unresolved (Blockers)
1. Host subprocess restrictions (`EPERM`) still block full build/reseed/quality/db gate completion.

## Current Audit Statement
For the audited priority scope, inspected runtime paths remain Supabase-backed and canonical with no newly detected schema-drift or fallback-fabrication regressions in this run. Final production-readiness signoff is still blocked by host-level `EPERM` subprocess restrictions on required validation gates.
