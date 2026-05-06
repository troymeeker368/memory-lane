# Production Readiness Audit - 2026-04-24

## Root Cause Summary
The biggest production-readiness risk is not one single code bug; it is drift between canonical architecture intent and deployment state:
1. Critical safety migrations exist locally but are not yet deployed to linked Supabase (`0209`-`0223`).
2. A few high-impact runtime paths still allow fallback behavior or duplicated resolver logic that can mask canonical truth under failure/replay conditions.
3. Some shared business-rule domains (transportation and sales detail reads) still have duplicated or fallback branches that should fail explicitly or route through one canonical resolver.

## Validation Run
- `cmd /c npm run typecheck`: pass
- `cmd /c npm run build`: pass
- `cmd /c npm run reseed`: pass
- `cmd /c npm run db:types`: pass (types regenerated to latest local migration header)
- `cmd /c npm run db:check`: pass for types/header sync, but dry-run shows remote DB still missing migrations `0209`-`0223`
- Banned-pattern search (`rg` in runtime `app` + `lib`): no runtime mock/file-backed production persistence found in audited scope

## Domain-by-Domain Canonicality and Gaps

### 1. Attendance / Census / Schedule Changes / Holds / Closures
- Canonical tables:
  - `members`, `member_attendance_schedules`, `attendance_records`, `member_holds`, `center_closures`, `closure_rules`, `schedule_changes`
- Canonical write paths:
  - Attendance actions -> `attendance-workflow-supabase` RPC-backed workflow
  - Schedule change actions -> `schedule-changes-supabase` RPC sync boundary
  - Holds actions -> `holds-supabase`
  - Closures/payor actions -> `billing-configuration`
- Shared resolvers:
  - `resolveExpectedAttendanceFromSupabaseContext` (`expected-attendance-supabase`)
- Downstream consumers:
  - Operations attendance pages, MCC tabs, admin attendance reports
- Resolved:
  - Runtime writes are service/rpc mediated (no direct UI writes found)
  - Read-policy hardening migrations present locally: `0216`, `0217`
- Unresolved:
  - Remote Supabase not yet migrated; hardening not active in deployed DB

### 2. Member Command Center (MCC)
- Canonical tables:
  - `member_command_centers`, `member_attendance_schedules`, `member_contacts`, `member_files`, plus `members`
- Canonical write paths:
  - MCC actions -> `member-command-center` services and RPC boundaries
  - File actions -> `member-files` service
- Shared resolvers:
  - `resolveMccMemberId`, expected attendance shared resolver, member-file category permissions
- Downstream consumers:
  - MCC detail page/read model, file manager, member-file downloads
- Resolved:
  - Upload path now returns follow-up-needed instead of synthetic success when persistence verification fails
  - File list paging now permission-aware with clinical category gating
- Unresolved:
  - Detail load still hydrates privileged file rows before actor filtering (service-role-first pattern)
  - Clinical category classification logic still duplicated across modules

### 3. Transportation
- Canonical tables:
  - `transportation_manifest_adjustments`, `transportation_runs`, `transportation_run_results`, `transportation_logs`, `member_attendance_schedules`
- Canonical write paths:
  - Station actions -> `transportation-station-supabase`
  - Run posting -> `transportation-run-posting` RPC
  - MCC transport write -> `rpc_save_member_command_center_transportation`
- Shared resolvers:
  - Expected attendance + billing-effective helpers in run manifest build
- Downstream consumers:
  - Transportation station page/print and transportation documentation views
- Resolved:
  - New migration `0223` hardens transportation run and bus stop policy boundaries locally
- Unresolved:
  - Runtime still contains duplicated rider eligibility/build logic across two transportation services
  - `transport_type` can be silently coerced to `Door to Door` on invalid/null inputs (fallback masking)
  - Migration not yet deployed remotely

### 4. Billing
- Canonical tables:
  - `billing_batches`, `billing_invoices`, `billing_invoice_lines`, `billing_coverages`, `billing_export_jobs`, `billing_adjustments`, `member_billing_settings`, `center_billing_settings`
- Canonical write paths:
  - Payor actions -> `billing-supabase`/`billing-rpc`
- Shared resolvers:
  - Billing-effective resolver + expected attendance helpers
- Downstream consumers:
  - Payor workflows, billing dashboards, export/report flows
- Resolved:
  - Local read-policy hardening migrations present: `0216`, `0217`, `0220`, `0221`
- Unresolved:
  - Remote DB migration backlog prevents these hardenings from being active in production

### 5. Sales
- Canonical tables:
  - `leads`, `lead_activities`, `lead_stage_history`, `community_partner_organizations`, `referral_sources`, `partner_activities`
- Canonical write paths:
  - Sales actions -> `sales-*` services -> stage/conversion RPC boundaries
- Shared resolvers:
  - Canonical lead stage/status resolver (`sales-workflows` + stage services)
- Downstream consumers:
  - Sales CRM pages, summary dashboards, admin/reporting read models
- Resolved:
  - `createSalesLeadActivity` now writes `idempotency_key` and handles replay via DB uniqueness
  - Conversion/lifecycle transitions are now executed before recording conversion-completion activity
  - New migration `0222` adds DB uniqueness guard for `lead_activities.idempotency_key`
- Unresolved:
  - Partner/lead detail read models still include fallback query branches that can mask schema/identity drift
  - Sales RLS policies still role-only in older migration set (not module-permission hardened)
  - Migration `0222` not deployed remotely yet

### 6. Care Plans
- Canonical tables:
  - `care_plans`, `care_plan_sections`, `care_plan_versions`, `care_plan_review_history`
- Canonical write paths:
  - Care-plan actions -> `care-plans-write` -> `care-plans-supabase` RPC/service boundary
- Shared resolvers:
  - Canonical member identity resolver, normalized sections/track rules, due-date/status computations
- Downstream consumers:
  - Care plan detail/list/due-report and MCC care-plan overview
- Resolved:
  - Boundary assertion now accepts `signed_pending_caregiver_dispatch` so committed records do not false-fail
  - Action entry points already enforce `canEdit`
- Unresolved:
  - `buildPersistedCarePlanActionState` still has ready-state fallback on reload failure path (can overstate readiness if re-read fails)
  - Care-plan policy hardening migration (`0218`) not deployed remotely yet

### 7. Admin Reporting
- Canonical tables/views consumed:
  - Billing, transportation logs, sales lead views, ancillary detailed view and related operational tables
- Canonical read paths:
  - Admin report pages -> `admin-reporting-foundation` / `admin-reporting-core` / `reports-ops`
- Shared resolvers:
  - Billing-effective, expected-attendance, sales stage/status summaries
- Downstream consumers:
  - Admin reports (attendance summary, revenue, on-demand, dashboards)
- Resolved:
  - No direct UI write bypasses found in audited admin-reporting scope
- Unresolved:
  - Admin reporting still inherits unresolved billing/sales/transportation schema-policy deployment blockers

## Files Changed In This Run
- Runtime/service fixes:
  - `lib/services/care-plans-supabase.ts`
  - `lib/services/sales-lead-activities.ts`
- New migrations:
  - `supabase/migrations/0222_lead_activity_idempotency_hardening.sql`
  - `supabase/migrations/0223_transportation_and_bus_stop_policy_permission_hardening.sql`
- New tests:
  - `tests/lead-activities-idempotency-hardening.test.ts`
  - `tests/transportation-bus-stop-policy-permission-hardening.test.ts`
- Schema types refreshed:
  - `types/supabase-types.d.ts`

## Migrations Added/Updated
- Added `0222_lead_activity_idempotency_hardening.sql`
  - Adds `lead_activities.idempotency_key` (if missing)
  - Adds unique index `idx_lead_activities_idempotency_key`
- Added `0223_transportation_and_bus_stop_policy_permission_hardening.sql`
  - Hardens `transportation_runs_select`
  - Hardens `transportation_run_results_select`
  - Hardens `bus_stop_directory` read/write policies to operations permissions

## Duplicated Rule Implementations Removed
- Removed in this run:
  - None (no safe low-risk consolidation patch applied for these duplicate paths today)
- Still open:
  - Transportation rider eligibility logic duplicated across station and run-manifest services
  - Clinical file category classification duplicated between MCC runtime and member-file core helpers

## Remaining Blockers
1. Deploy pending Supabase migrations `0209`-`0223` to linked remote.
2. Resolve sales partner/lead detail fallback branches to fail explicitly on canonical identity/schema mismatch.
3. Consolidate duplicated transportation rider-eligibility resolver logic into one shared helper.
4. Remove/adjust care-plan readiness fallback that can still report synthetic ready status on reload failure.
5. Re-run full audit after migration deployment to verify runtime behavior matches hardened policies in production DB.

## Explicit Canonicality Statement
Runtime in this workspace is substantially more canonical and Supabase-backed for the audited domains, but it is **not yet fully production-canonical end-to-end** because key hardening migrations are still not deployed on linked Supabase and a few fallback/duplication gaps remain unresolved.
