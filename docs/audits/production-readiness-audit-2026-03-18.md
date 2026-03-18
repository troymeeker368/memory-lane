# Production Readiness Audit

Date: 2026-03-18
Scope: priority domains (attendance/census/schedule/holds/closures, MCC, transportation, billing, sales, care plans, admin reporting)
Method: static audit + targeted remediation + validation commands

## Root Cause Summary

Primary production-readiness risks found in this pass:
- Schema-drift masking in MCC member/member-contact read paths (fallback selectors hid missing columns).
- Competing write path in sales lead conversion (legacy RPC fallback allowed non-canonical execution).
- Duplicated billing derived-rule resolvers in two modules (risk of drift between billing and reporting behavior).

## Domain-by-Domain Canonical Map and Gaps

## 1. Attendance / Census / Schedule Changes / Holds / Closures
- Canonical tables: `attendance_records`, `member_attendance_schedules`, `member_holds`, `schedule_changes`, `center_closures`, `closure_rules`, `billing_adjustments`.
- Canonical write paths: `app/(portal)/operations/attendance/actions.ts` -> `lib/services/attendance-workflow-supabase.ts`; `app/(portal)/operations/schedule-changes/actions.ts` -> `lib/services/schedule-changes-supabase.ts`; `app/(portal)/operations/holds/actions.ts` -> `lib/services/holds-supabase.ts`; payor closures via `lib/services/billing-supabase.ts`.
- Shared resolvers: `resolveExpectedAttendanceFromSupabaseContext` (`lib/services/expected-attendance-supabase.ts`), `resolveExpectedAttendanceForDate` (`lib/services/expected-attendance.ts`), closure date generation (`lib/services/closure-rules.ts`).
- Downstream consumers: operations attendance pages, dashboard, transportation station manifest logic, admin reporting attendance summary.
- Gap status: no new canonicality/fallback violations found in this domain during this pass.

## 2. Member Command Center (MCC)
- Canonical tables: `members`, `member_command_centers`, `member_attendance_schedules`, `member_contacts`, `member_files`, `member_allergies`, `bus_stop_directory`.
- Canonical write paths: MCC actions -> `lib/services/member-command-center.ts` RPC workflows + `lib/services/member-command-center-supabase.ts` canonical table services.
- Shared resolvers: canonical member resolution (`lib/services/canonical-person-ref.ts`), MCC member query mapper (`lib/services/member-command-center-member-queries.ts`).
- Downstream consumers: MCC index/detail pages, transportation add-rider options, billing payor forms.
- Resolved gaps:
  - Removed multi-variant member select fallback chain that masked missing `members` columns.
  - Removed member-contacts legacy select fallback and silent `[]` return on missing `is_payor`.
  - Behavior now fails explicitly with migration guidance instead of masking schema drift.

## 3. Transportation
- Canonical tables: `transportation_manifest_adjustments`, `transportation_runs`, `transportation_run_results`, `transportation_logs`, `member_attendance_schedules`, `attendance_records`.
- Canonical write paths: transportation station actions -> `lib/services/transportation-station-supabase.ts` (adjustments) and `lib/services/transportation-run-posting.ts` (RPC-backed posting).
- Shared resolvers: expected-attendance shared resolver + `getTransportSlotForScheduleDay`.
- Downstream consumers: transportation station pages/print views, billing variable-charge queue.
- Gap status: no new canonicality/fallback violations found in this domain during this pass.

## 4. Billing
- Canonical tables: `center_billing_settings`, `member_billing_settings`, `billing_schedule_templates`, `billing_adjustments`, `billing_batches`, `billing_invoices`, `center_closures`, `closure_rules`, `payors`, plus coverage/export tables.
- Canonical write paths: payor actions -> `lib/services/billing-supabase.ts`; atomic batch/export boundaries through `lib/services/billing-rpc.ts` RPCs.
- Shared resolvers: `lib/services/billing-effective.ts` for effective-row, mode, and rate resolution.
- Downstream consumers: payor module, MCC attendance-billing views, admin reporting revenue/attendance summary.
- Resolved gaps:
  - Removed duplicated effective billing resolver logic from `billing-supabase`.
  - `billing-supabase` now imports/re-exports shared canonical resolvers from `billing-effective`.

## 5. Sales
- Canonical tables: `leads`, `lead_activities`, `lead_stage_history`, `community_partner_organizations`, `referral_sources`, `partner_activities`.
- Canonical write paths: sales actions -> `sales-lead-activities.ts`, `sales-lead-stage-supabase.ts`, `sales-lead-conversion-supabase.ts`.
- Shared resolvers: `resolveCanonicalLeadTransition`.
- Downstream consumers: sales pipeline pages, dashboard summary, enrollment/intake prefill flows.
- Resolved gaps:
  - Removed legacy RPC fallback path in lead conversion service.
  - Conversion now requires canonical RPC functions and fails explicitly with migration guidance if missing.

## 6. Care Plans
- Canonical tables: `care_plans`, `care_plan_sections`, `care_plan_versions`, `care_plan_review_history`, `care_plan_signature_events`, `care_plan_nurse_signatures`, `member_files`.
- Canonical write paths: care-plan actions -> `lib/services/care-plans-supabase.ts`, `lib/services/care-plan-esign.ts`, `lib/services/care-plan-nurse-esign.ts`.
- Shared resolvers: `care-plan-esign-rules`, nurse/esign core helpers.
- Downstream consumers: care-plan pages, public signing routes, member profile sync references.
- Gap status: no new canonicality/fallback violations found in this domain during this pass.

## 7. Admin Reporting
- Canonical tables (read-side): attendance/billing/sales/documentation/reporting views (`attendance_records`, `billing_invoices`, `transportation_logs`, `leads`, `daily_activity_logs`, etc.).
- Canonical read paths: `lib/services/admin-reporting-foundation.ts`, `lib/services/admin-reports.ts`, `lib/services/reports-ops.ts`.
- Shared resolvers: `billing-effective` resolvers, expected-attendance shared resolver, sales stage summarizer.
- Downstream consumers: admin reports pages and operations reports page.
- Gap status: no new bypasses found in this domain during this pass.

## Files Changed in This Pass
- `lib/services/member-command-center-member-queries.ts`
- `lib/services/member-command-center-supabase.ts`
- `lib/services/sales-lead-conversion-supabase.ts`
- `lib/services/billing-supabase.ts`
- `tests/billing-payor-canonicalization.test.ts`

## Migrations Added/Updated in This Pass
- None created or modified in this pass.
- Existing uncommitted migrations already present in workspace before this pass: `0082`, `0083`, `0084`.

## Duplicated Rule Implementations Removed
- Removed duplicated billing effective-row/mode/rate resolver implementation from `billing-supabase`; canonicalized to `billing-effective`.

## Validation Results
- `npm.cmd run typecheck`: passed.
- `npm.cmd run build`: failed due environment process-spawn restriction (`spawn EPERM`).
- `npm.cmd run reseed`: failed due environment process-spawn restriction (`spawn EPERM` from esbuild process launch).
- `npm.cmd run quality:gates`: failed due environment process-spawn restriction (`spawnSync ... cmd.exe EPERM`).
- Targeted test invocation (`node --test ...`): failed for same environment `spawn EPERM` restriction.
- Banned-pattern checks run:
  - No runtime `lib/mock` imports in `app/` or `lib/` production paths.
  - No direct `.from("...")` queries in audited priority `app/(portal)` domain paths.
  - No legacy lead-conversion RPC fallback references in sales conversion service.

## Remaining Blockers / Unresolved Gaps
- Environment-level blocker: this host cannot spawn build/test/reseed subprocesses (`EPERM`), so full runtime verification is incomplete.
- Existing unrelated workspace modifications were present before this pass and were not altered.
- Existing untracked migrations `0082-0084` still need normal migration-apply verification in the target Supabase environment.

## Supabase-Backed Canonicality Statement (Audited Scope)
- For this pass's targeted changes, runtime paths are fully Supabase-backed and more canonical than before (fallback drift masking and competing conversion RPC path removed).
- End-to-end production readiness for the full requested scope remains **partially blocked** until build/reseed/test can run in an environment without `spawn EPERM` restrictions.
