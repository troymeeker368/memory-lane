# Production Readiness Audit - 2026-05-06

## Root Cause Summary
1. Transportation manifest builders still contained duplicated transport-slot/mode derivation with silent fallback to `Door to Door` for invalid persisted values.
2. Sales partner/referral detail reads still had invalid-UUID fallback query branches that could mask canonical identity/schema drift.
3. Care plan action success paths could still report a ready operational state when persisted readiness reload failed.
4. Remote Supabase deployment state remains unverifiable from this environment; reseed/db-check connectivity failed.

## Domain-by-Domain Canonical Mapping and Gaps

### 1) Attendance / Census / Schedule Changes / Holds / Closures
- Canonical tables: `attendance_records`, `member_attendance_schedules`, `schedule_changes`, `member_holds`, `center_closures`, `closure_rules`, `members`.
- Canonical write paths: `app/(portal)/operations/attendance/actions.ts` -> `lib/services/attendance-workflow-supabase.ts`; schedule changes -> `lib/services/schedule-changes-supabase.ts`; holds -> `lib/services/holds-supabase.ts`; closures/payor -> `lib/services/billing-configuration.ts`.
- Shared resolvers: `resolveExpectedAttendanceFromSupabaseContext` in `lib/services/expected-attendance-supabase.ts`.
- Consumers: operations attendance board, MCC attendance tab, admin attendance reporting.
- Resolved in this run: none required in this domain.
- Remaining: remote migration deployment status still blocked by environment connectivity.

### 2) MCC
- Canonical tables: `member_command_centers`, `members`, `member_contacts`, `member_files`, `member_attendance_schedules`.
- Canonical write paths: MCC actions -> `lib/services/member-command-center-runtime.ts` + write services; files -> `lib/services/member-files.ts`.
- Shared resolvers: member identity resolver + member file category access helpers (`canAccessClinicalMemberFiles`, `canViewMemberFileCategory`).
- Consumers: MCC detail/read model/actions and file manager.
- Resolved in this run: no new MCC code changes beyond carrying forward shared-file-category resolver adoption already present in workspace.
- Remaining: none newly identified in edited scope.

### 3) Transportation
- Canonical tables: `transportation_manifest_adjustments`, `transportation_runs`, `transportation_run_results`, `transportation_logs`, `member_attendance_schedules`.
- Canonical write paths: station actions -> `lib/services/transportation-station-supabase.ts`; run posting -> `lib/services/transportation-run-posting.ts`.
- Shared resolvers: `resolveExpectedAttendanceFromSupabaseContext`; new shared transportation manifest resolver helpers in `lib/services/transportation-manifest-shared.ts`.
- Consumers: transportation station page/print and run manifest flows.
- Resolved in this run:
  - Removed silent transport mode fallback in both station and run-manifest builders.
  - Consolidated shared transport-slot/mode/contact-address derivation logic into a single shared service.
  - Added forward-only migration `0224_transportation_manifest_adjustment_mode_guard.sql` to enforce explicit mode for manual-add adjustments.
- Remaining: remote migration application unverified.

### 4) Billing
- Canonical tables: `billing_batches`, `billing_invoices`, `billing_invoice_lines`, `billing_adjustments`, `member_billing_settings`, `center_billing_settings`, `billing_export_jobs`.
- Canonical write paths: payor actions -> billing services/RPC (`lib/services/billing-supabase.ts`, `lib/services/billing-rpc.ts`).
- Shared resolvers: billing-effective resolver (`lib/services/billing-effective.ts`) + expected attendance integration.
- Consumers: payor pages, billing exports, admin revenue reports.
- Resolved in this run: indirect hardening via transportation mode guard affecting transport-related billability provenance.
- Remaining: remote migration state unresolved.

### 5) Sales
- Canonical tables: `leads`, `lead_activities`, `lead_stage_history`, `community_partner_organizations`, `referral_sources`, `partner_activities`.
- Canonical write paths: sales actions -> sales services/stage-transition RPC boundaries.
- Shared resolvers: canonical partner/referral lookup (`getSalesPartnerByIdOrCodeSupabase`, `getSalesReferralSourceByIdOrCodeSupabase`).
- Consumers: partner detail pages, referral source detail pages, lead detail pages, sales dashboards.
- Resolved in this run:
  - Removed invalid-UUID fallback query branches from `lib/services/partner-detail-read-model.ts`.
  - Enforced canonical ID-filter query construction (uuid-safe filter set) to fail explicitly on real query errors.
- Remaining: broader sales policy deployment state remains blocked by remote connectivity.

### 6) Care Plans
- Canonical tables: `care_plans`, `care_plan_sections`, `care_plan_versions`, `care_plan_review_history`.
- Canonical write paths: care plan actions -> `lib/services/care-plans-write.ts` -> `lib/services/care-plans-supabase.ts`.
- Shared resolvers: post-sign readiness action-state builders.
- Consumers: care plan create/review/sign flows, detail/list/due-report and downstream member views.
- Resolved in this run:
  - Hardened action-state fallback in `app/care-plan-actions.ts` so reload failures no longer report ready; now mark follow-up-required explicitly.
  - Updated `components/forms/care-plan-forms.tsx` narrowing to safely consume action-needed responses.
- Remaining: remote policy/migration verification blocked.

### 7) Admin Reporting
- Canonical tables/views: attendance/billing/transportation/sales/report views consumed via reporting services.
- Canonical read paths: `lib/services/admin-reporting-foundation.ts`, `lib/services/admin-reporting-core.ts`, `lib/services/reports-ops.ts`.
- Shared resolvers: billing-effective + expected-attendance + sales lookup/read-models.
- Consumers: `/admin-reports/*` and related summaries.
- Resolved in this run: no direct report-layer code changes; inherits upstream transportation/sales/care-plan hardening.
- Remaining: environment blocked for full remote schema/runtime verification.

## Files Changed In This Run
- `lib/services/transportation-manifest-shared.ts` (new)
- `lib/services/transportation-station-supabase.ts`
- `lib/services/transportation-run-manifest-supabase.ts`
- `lib/services/partner-detail-read-model.ts`
- `app/care-plan-actions.ts`
- `components/forms/care-plan-forms.tsx`
- `supabase/migrations/0224_transportation_manifest_adjustment_mode_guard.sql` (new)

## Migrations Added/Updated
- Added `0224_transportation_manifest_adjustment_mode_guard.sql`
  - Adds check constraint `transportation_manifest_adjustments_add_requires_transport_type` (`NOT VALID`) to enforce explicit `transport_type` on future `adjustment_type='add'` writes.

## Duplicated Rule Implementations Removed
- Transportation slot/mode/contact resolver duplication across:
  - `lib/services/transportation-station-supabase.ts`
  - `lib/services/transportation-run-manifest-supabase.ts`
- Consolidated into:
  - `lib/services/transportation-manifest-shared.ts`

## Validation
- `npm run typecheck`: pass
- `npm run build`: pass
- `npm run quality:gates`: pass
- `npm run reseed`: **failed** (DNS/host lookup to Supabase endpoint unavailable from environment)
- `npm run db:check`: **failed** (remote pooler tenant/user resolution unavailable from environment)
- Banned-pattern scan (`rg`): no runtime `lib/mock` imports found in `app`/`lib` production paths

## Remaining Blockers
1. Remote Supabase connectivity from this environment prevented reseed + db drift verification.
2. Pending migration deployment on linked remote cannot be confirmed in this run.
3. Full runtime verification against live RLS/policy state is blocked until remote DB access works.

## Explicit Canonicality Statement (Audited Scope)
Within the edited scope, runtime behavior is now stricter and more canonical: silent fallback transport-mode fabrication was removed, duplicated transportation manifest derivation was centralized, sales fallback query masking was removed, and care-plan readiness fallback no longer overstates readiness. End-to-end production readiness remains partially blocked by remote Supabase connectivity/deployment verification.
