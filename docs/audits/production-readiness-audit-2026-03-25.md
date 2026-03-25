# Production Readiness Audit - 2026-03-25

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
- No new canonicality or Supabase-backing regressions were detected in the priority domains during this run.
- Remaining blockers are environment-level validation restrictions (`spawn EPERM` / `spawnSync EPERM`) that prevent full build/reseed/gate execution in this host context.
- Prior billing custom-invoice atomicity risk is now covered in runtime by shared RPC path (`rpc_create_custom_invoice`) and migration-backed function definitions.

## Domain-by-Domain Canonical Map and Gaps

### 1) Attendance / Census / Schedule Changes / Holds / Closures
- Canonical tables:
  - `attendance_records`, `member_attendance_schedules`, `schedule_changes`, `member_holds`, `center_closures`, `closure_rules`
- Canonical write paths:
  - attendance: `app/(portal)/operations/attendance/actions.ts` -> `lib/services/attendance-workflow-supabase.ts` (+ `lib/services/billing-workflows.ts`)
  - schedule changes: `app/(portal)/operations/schedule-changes/actions.ts` -> `lib/services/schedule-changes-supabase.ts`
  - holds: `app/(portal)/operations/holds/actions.ts` -> `lib/services/holds-supabase.ts`
  - closure/rules: payor actions -> `lib/services/billing-configuration.ts`
- Shared resolvers:
  - expected attendance: `lib/services/expected-attendance-supabase.ts`
- Downstream consumers:
  - operations attendance pages, MCC attendance surfaces, attendance/admin reporting services
- Status:
  - Supabase-backed and canonical in audited paths.

### 2) MCC
- Canonical tables:
  - `member_command_centers`, `member_attendance_schedules`, `member_contacts`, `members`, `member_files`, `member_allergies`
- Canonical write paths:
  - MCC actions -> `app/(portal)/operations/member-command-center/actions-impl.ts` -> `lib/services/member-command-center.ts` RPC workflow wrappers + write services
- Shared resolvers:
  - canonical person/member identity resolver: `lib/services/canonical-person-ref.ts`
- Downstream consumers:
  - MCC list/detail tabs, attendance-billing tab, linked operations surfaces
- Status:
  - Canonical service/RPC boundaries preserved; no app-layer Supabase bypasses found.

### 3) Transportation
- Canonical tables:
  - `transportation_logs`, `transportation_manifest_adjustments`, `transportation_runs`, `transportation_run_results`
- Canonical write paths:
  - station actions -> `app/(portal)/operations/transportation-station/actions.ts` -> `lib/services/transportation-station-supabase.ts` / `lib/services/transportation-run-posting.ts`
- Shared resolvers:
  - schedule-derived expected attendance resolver via `expected-attendance-supabase`
- Downstream consumers:
  - transportation station pages, print flow, operations reporting
- Status:
  - Supabase-backed and canonical in audited paths.

### 4) Billing
- Canonical tables:
  - `billing_batches`, `billing_invoices`, `billing_invoice_lines`, `billing_coverages`, `billing_adjustments`, `member_billing_settings`, `center_billing_settings`
- Canonical write paths:
  - payor actions -> billing services (`billing-workflows` / `billing-supabase`) -> shared RPC wrappers in `billing-rpc.ts`
  - custom invoice path -> `lib/services/billing-custom-invoices.ts` -> `invokeCreateCustomInvoiceRpc`
- Shared resolvers:
  - `lib/services/billing-effective.ts` (`resolveEffectiveDailyRate`, `resolveEffectiveBillingMode`, `resolveEffectiveTransportationBillingStatus`)
- Downstream consumers:
  - payor pages/actions, billing previews/exports, attendance billing sync
- Status:
  - Supabase-backed and canonical in audited paths.
  - Custom-invoice writes are RPC-backed and migration-aligned (`0126_custom_invoice_atomic_rpc.sql`, `0134_fix_billing_rpc_uuid_source_record_casts.sql`).

### 5) Sales
- Canonical tables:
  - `leads`, `lead_activities`, `lead_stage_history`, `community_partner_organizations`, `referral_sources`, `partner_activities`
- Canonical write paths:
  - sales server actions (`app/sales-*.ts`) -> canonical sales services (`sales-crm-supabase`, `sales-lead-stage-supabase`, `sales-lead-conversion-supabase`)
- Shared resolvers:
  - lead transition canonical resolver: `resolveCanonicalLeadTransition` in `sales-lead-stage-supabase`
- Downstream consumers:
  - sales pipeline/detail/summary/read-model/reporting pages
- Status:
  - Supabase-backed and canonical for audited write/read paths.

### 6) Care Plans
- Canonical tables:
  - `care_plans`, `care_plan_sections`, `care_plan_versions`, `care_plan_signature_events`, `care_plan_nurse_signatures`
- Canonical write paths:
  - care plan actions -> care plan services (`care-plans-supabase`, `care-plan-esign`, `care-plan-esign-public`)
- Shared resolvers:
  - e-sign state/link rules: `care-plan-esign-rules`
- Downstream consumers:
  - care-plan portal pages and public sign flows
- Status:
  - Canonical service-layer boundaries preserved.

### 7) Admin Reporting
- Canonical tables/views:
  - reads from canonical operational tables and migration-backed reporting views (`v_*`)
- Canonical read/resolver path:
  - `lib/services/admin-reporting-core.ts` + `lib/services/admin-reporting-foundation.ts`
- Downstream consumers:
  - `app/(portal)/admin-reports/*`
- Status:
  - Reporting reads remain Supabase-backed and resolver-aligned in audited paths.

## Banned Pattern Sweep (This Run)
- Runtime mock imports (`app/` + `lib/`, excluding tests and `lib/mock`): `0` hits.
- Priority app direct Supabase import/bypass hits (`operations/sales/care-plans/admin-reports`): `0` hits.
- Priority service catch-mask fallback patterns (`return []/{}/null/undefined` in catch blocks): `0` hits.

## Schema Drift / Seed-Runtime-Migration Alignment
- Runtime migration filename references in code: `52`.
- Missing migration filename references: `0`.
- Runtime table/view references compared with migration object inventory: only unresolved set were `v_*` views; all verified as migration-backed.
- No new seed/runtime/migration mismatches were identified in this pass.

## Validation Results
- `cmd /c npm run typecheck`: passed.
- `cmd /c npm run build`: failed (`spawn EPERM`).
- `cmd /c npm run reseed`: failed (`spawn EPERM`, esbuild subprocess startup).
- `cmd /c npm run quality:gates`: failed (`spawnSync cmd.exe EPERM`).
- `cmd /c npm run db:check`: failed (`spawnSync cmd.exe EPERM`).

## Files Changed (This Run)
- `docs/audits/production-readiness-audit-2026-03-25.md`

## Resolved vs Unresolved Gaps
### Resolved / Verified
- No new Supabase-backing regressions in the audited priority domains.
- No new runtime mock/fallback/file-backed behavior in production paths for audited scope.
- No new missing migration references in runtime guidance strings.
- Canonical service/resolver boundaries remain in place for the audited priority workflows.

### Unresolved (Blockers)
1. Environment process restrictions prevent full build/reseed/db-check/quality-gate execution (`EPERM` on child process spawn).

## Current Audit Statement
For the audited priority scope, inspected runtime paths are Supabase-backed and canonical with no newly detected schema-drift regressions or fallback fabrication paths. Final production-readiness signoff is blocked by host-level `EPERM` subprocess restrictions preventing full validation gate execution.
