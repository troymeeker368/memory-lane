# Production Readiness Audit - 2026-03-29

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
- One concrete canonicality hardening gap was present in attendance/schedule-change workflows: `lib/services/schedule-changes-supabase.ts` still exported an unused direct table-update implementation (`updateScheduleChangeSupabase`) that bypassed the RPC-backed attendance-sync write boundary.
- This run removed that competing write path so schedule changes now have a single canonical write surface in runtime (`saveScheduleChangeWithAttendanceSyncSupabase` + `updateScheduleChangeStatusWithAttendanceSyncSupabase`).
- No new priority-domain regressions were detected for runtime mock behavior, app-layer Supabase bypasses, catch-return masking, or schema reference drift.

## Domain-by-Domain Canonical Map and Gaps

### 1) Attendance / Census / Schedule Changes / Holds / Closures
- Canonical tables:
  - `attendance_records`, `member_attendance_schedules`, `schedule_changes`, `member_holds`, `center_closures`, `closure_rules`
- Canonical write paths:
  - attendance actions -> `app/(portal)/operations/attendance/actions.ts` -> `lib/services/attendance-workflow-supabase.ts` (+ `lib/services/billing-workflows.ts` sync)
  - schedule changes actions -> `app/(portal)/operations/schedule-changes/actions.ts` -> `lib/services/schedule-changes-supabase.ts` RPC boundary
  - holds actions -> `app/(portal)/operations/holds/actions.ts` -> `lib/services/holds-supabase.ts`
  - closure/rules actions -> `app/(portal)/operations/payor/actions-impl.ts` -> `lib/services/billing-configuration.ts` / `lib/services/closure-rules.ts`
- Shared resolvers:
  - expected attendance canonical resolver stack: `lib/services/expected-attendance-supabase.ts`
  - schedule-day resolver helpers: `lib/services/schedule-changes-shared.ts`
- Downstream consumers:
  - operations attendance and schedule-change surfaces, MCC attendance tabs, transportation station, admin attendance reporting
- Status:
  - Fixed this run: removed unused competing direct schedule-change update implementation; RPC-backed path is now the only runtime write/update path.

### 2) MCC
- Canonical tables:
  - `member_command_centers`, `member_attendance_schedules`, `member_contacts`, `members`, `member_files`, `member_allergies`
- Canonical write paths:
  - MCC actions -> `app/(portal)/operations/member-command-center/actions-impl.ts` -> `lib/services/member-command-center.ts` / `lib/services/member-command-center-write.ts`
- Shared resolvers:
  - canonical identity resolver: `resolveCanonicalMemberId` / `resolveMccMemberId`
  - canonical person-link resolver: `lib/services/canonical-person-ref.ts`
- Downstream consumers:
  - MCC index/detail, attendance billing and transportation sub-workflows, member file surfaces
- Status:
  - Supabase-backed and canonical in audited runtime paths.

### 3) Transportation
- Canonical tables:
  - `transportation_logs`, `transportation_manifest_adjustments`, `transportation_runs`, `transportation_run_results`, `bus_stop_directory`
- Canonical write paths:
  - station actions -> `app/(portal)/operations/transportation-station/actions.ts` -> `lib/services/transportation-station-supabase.ts` / `lib/services/transportation-run-posting.ts`
- Shared resolvers:
  - attendance/schedule derivation through `lib/services/expected-attendance-supabase.ts`
  - schedule transport slot resolver: `lib/services/member-schedule-selectors.ts`
- Downstream consumers:
  - transportation station page + print, operations reporting, billing ancillary linkage
- Status:
  - Supabase-backed and canonical in audited runtime paths.

### 4) Billing
- Canonical tables:
  - `billing_batches`, `billing_invoices`, `billing_invoice_lines`, `billing_coverages`, `billing_adjustments`, `member_billing_settings`, `center_billing_settings`
- Canonical write paths:
  - payor actions -> `app/(portal)/operations/payor/actions-impl.ts` -> `lib/services/billing-supabase.ts` / `lib/services/billing-configuration.ts`
  - atomic workflow boundaries via `lib/services/billing-rpc.ts`
- Shared resolvers:
  - `lib/services/billing-effective.ts` (`resolveEffectiveBillingMode`, `resolveEffectiveDailyRate`, `resolveEffectiveTransportationBillingStatus`)
- Downstream consumers:
  - payor workflows, attendance billing sync, admin reporting revenue calculations
- Status:
  - Supabase-backed and resolver-aligned in audited runtime paths.

### 5) Sales
- Canonical tables:
  - `leads`, `lead_activities`, `lead_stage_history`, `community_partner_organizations`, `referral_sources`, `partner_activities`, `enrollment_packet_requests`, `enrollment_packet_signatures`, `enrollment_packet_fields`
- Canonical write paths:
  - sales actions (`app/sales-lead-actions.ts`, `app/sales-enrollment-actions.ts`) -> `lib/services/sales-crm-supabase.ts`, `lib/services/sales-lead-stage-supabase.ts`, `lib/services/sales-lead-conversion-supabase.ts`, enrollment packet services
- Shared resolvers:
  - canonical lead-state resolver (`resolveCanonicalLeadState`) + stage transition service
- Downstream consumers:
  - sales pipeline/read-model pages, enrollment send/replace/void flows, reporting
- Status:
  - Supabase-backed and canonical in audited runtime paths.

### 6) Care Plans
- Canonical tables:
  - `care_plans`, `care_plan_sections`, `care_plan_versions`, `care_plan_signature_events`, `care_plan_nurse_signatures`
- Canonical write paths:
  - care plan actions -> `app/care-plan-actions.ts` -> `lib/services/care-plans-write.ts` / `lib/services/care-plan-esign.ts` -> `lib/services/care-plans-supabase.ts`
- Shared resolvers:
  - e-sign rules and lifecycle logic in `lib/services/care-plan-esign-rules.ts`
- Downstream consumers:
  - care plan portal pages, caregiver sign workflow, downstream clinical/read surfaces
- Status:
  - Canonical service boundaries preserved in audited runtime paths.

### 7) Admin Reporting
- Canonical tables/views:
  - canonical operational tables + migration-backed reporting views (`v_*`)
- Canonical read/resolver paths:
  - `lib/services/admin-reporting-foundation.ts` + `lib/services/admin-reporting-core.ts` + `lib/services/reporting-attendance-dataset.ts`
- Downstream consumers:
  - `app/(portal)/admin-reports/*`, reports home dashboards
- Status:
  - Supabase-backed and shared-resolver aligned in audited runtime paths.

## Banned Pattern Sweep (This Run)
- Runtime mock imports (`app/` + `lib/`, excluding tests and `lib/mock`): `mock_import_hits=0`
- Priority app direct Supabase bypass hits: `priority_app_direct_supabase_hits=0`
- Priority service catch-return masking hits: `priority_service_catch_mask_hits=0`

## Schema Drift / Seed-Runtime-Migration Alignment
- Runtime migration filename references in code: `runtime_migration_refs=57`
- Missing migration filename references: `missing_migration_refs=0`
- Runtime `.from("...")` references extracted: `runtime_from_refs=107`
- Unresolved runtime `.from` refs against migration-defined tables/views: `unresolved_from_refs_count=0`
- No new seed/runtime/migration mismatches were identified in static checks for audited scope.

## Validation Results
- `cmd /c npm run typecheck`: passed.
- `cmd /c npm run build`: failed (`spawn EPERM` during build subprocess stage).
- `cmd /c npm run reseed`: failed (`spawn EPERM` while starting esbuild subprocess).
- `cmd /c npm run quality:gates`: failed (`spawnSync cmd.exe EPERM`).
- `cmd /c npm run db:check`: failed (`spawnSync cmd.exe EPERM`).

## Files Changed (This Run)
- `lib/services/schedule-changes-supabase.ts`
- `docs/audits/production-readiness-audit-2026-03-29.md`

## Migrations Added/Updated
- None.

## Duplicated Rule Implementations Removed
- Removed `updateScheduleChangeSupabase` from `lib/services/schedule-changes-supabase.ts` (unused direct table update path that competed with canonical RPC-backed attendance-sync write path).

## Resolved vs Unresolved Gaps
### Resolved / Verified
- Removed remaining competing schedule-change write implementation so runtime updates are constrained to canonical RPC-backed attendance-sync boundaries.
- Verified no runtime mock/file-backed behavior in audited priority scope.
- Verified no priority app-layer direct Supabase bypasses in audited operations/admin-reporting paths.
- Verified no catch-return masking fallback branches in audited priority service scope.
- Verified runtime migration references and `.from(...)` object references remain migration-backed.

### Unresolved (Blockers)
1. Host subprocess restrictions (`EPERM`) still block full build/reseed/quality/db gate completion required for final end-to-end signoff.

## Current Audit Statement
For the audited priority scope, runtime paths are Supabase-backed and canonical, with the schedule-change competing write path removed in this run. Final production-readiness signoff remains blocked by host-level `EPERM` subprocess restrictions on required validation gates.
