# Production Readiness Audit - 2026-05-07

## Root Cause Summary
1. Schema/runtime contract drift remained in generated Supabase types (`types/supabase-types.d.ts`) even though migrations were up to date.
2. MCC index and member-detail care-plan preview hardening work was in progress in the workspace and needed validation against canonical service boundaries.
3. Required production validation (build, reseed, db drift checks, banned-pattern scans) had to be re-run end-to-end for the requested domains.

## Domain-by-Domain Canonical Mapping and Gaps

### 1) Attendance / Census / Schedule Changes / Holds / Closures
- Canonical tables: `attendance_records`, `member_attendance_schedules`, `schedule_changes`, `member_holds`, `center_closures`, `closure_rules`, `members`.
- Canonical write paths: `app/(portal)/operations/attendance/actions.ts` -> `lib/services/attendance-workflow-supabase.ts`; schedule changes -> `lib/services/schedule-changes-supabase.ts`; holds -> `lib/services/holds-supabase.ts`; closures/payor settings -> `lib/services/billing-configuration.ts`.
- Shared resolvers: `resolveExpectedAttendanceFromSupabaseContext` (`lib/services/expected-attendance-supabase.ts`), schedule weekday normalization (`lib/services/schedule-changes-shared.ts`).
- Downstream consumers: attendance page/actions, MCC attendance tab/actions, admin attendance summary reporting.
- Resolved in this run: no new code change required; validated canonical service-backed paths and successful reseed data population (`attendance_records`, `schedule_changes`, `member_holds`, `center_closures`).
- Remaining gaps: none identified in audited scope.

### 2) MCC
- Canonical tables: `member_command_centers`, `member_attendance_schedules`, `members`, `member_contacts`, `member_files`.
- Canonical write paths: MCC server actions -> `lib/services/member-command-center-runtime.ts` / `lib/services/member-command-center.ts` -> Supabase/RPC-backed MCC services.
- Shared resolvers: canonical member identity resolver (`lib/services/canonical-person-ref.ts`), MCC shared action helpers (`app/(portal)/operations/member-command-center/_actions/shared.ts`).
- Downstream consumers: MCC index/detail pages and tabs.
- Resolved in this run:
  - MCC index now explicitly uses privileged canonical read path (`serviceRole: true`) from page -> runtime boundary.
  - Privileged-read boundary test coverage updated.
- Remaining gaps: none identified in audited scope.

### 3) Transportation
- Canonical tables: `transportation_manifest_adjustments`, `transportation_runs`, `transportation_run_results`, `transportation_logs`, `member_attendance_schedules`.
- Canonical write paths: station actions -> `lib/services/transportation-station-supabase.ts`; run posting -> `lib/services/transportation-run-posting.ts`.
- Shared resolvers: `lib/services/transportation-manifest-shared.ts`, expected-attendance resolver.
- Downstream consumers: transportation station page/print and run posting workflows.
- Resolved in this run: validated prior hardening remains active; reseed populated transportation domain without fallback runtime persistence.
- Remaining gaps: none identified in audited scope.

### 4) Billing
- Canonical tables: `billing_batches`, `billing_invoices`, `billing_invoice_lines`, `billing_adjustments`, `billing_coverages`, `billing_export_jobs`, `member_billing_settings`, `center_billing_settings`.
- Canonical write paths: payor actions -> billing services -> Supabase + billing RPC (`lib/services/billing-rpc.ts`, `lib/services/billing-supabase.ts`).
- Shared resolvers: billing effective-date/state helpers (`lib/services/billing-effective.ts`, `lib/services/billing-utils.ts`) and attendance integration.
- Downstream consumers: payor pages, invoice/export flows, revenue/admin reporting.
- Resolved in this run: reseed and build validated billing paths end-to-end; no mock/runtime split paths detected.
- Remaining gaps: none identified in audited scope.

### 5) Sales
- Canonical tables: `leads`, `lead_activities`, `lead_stage_history`, `community_partner_organizations`, `referral_sources`, `partner_activities`, `enrollment_packet_requests`.
- Canonical write paths: sales actions -> sales service layer (`lib/services/sales-*.ts`) with RPC-backed summary/workflow boundaries.
- Shared resolvers: sales dashboard/workflow service helpers (`lib/services/sales-workflows.ts`, `lib/services/sales-crm-read-model.ts`).
- Downstream consumers: sales pipeline pages, partner/referral detail pages, activities and summary dashboards.
- Resolved in this run: validated canonical sales service boundaries and reseed counts; no fabricated runtime records detected.
- Remaining gaps: none identified in audited scope.

### 6) Care Plans
- Canonical tables: `care_plans`, `care_plan_sections`, `care_plan_versions`, `care_plan_review_history`, `care_plan_signature_events`.
- Canonical write paths: care plan actions -> `lib/services/care-plans-write.ts` -> `lib/services/care-plans-supabase.ts` / atomic RPCs where required.
- Shared resolvers: care-plan read model + readiness helpers (`lib/services/care-plans-read-model.ts`, `lib/services/care-plan-post-sign-readiness.ts`).
- Downstream consumers: care-plan list/detail/pages, member detail preview, public signing flow.
- Resolved in this run:
  - Member detail now uses one canonical care-plan preview resolver for both bounded rows and exact total count (`getMemberCarePlanPreview`) instead of split read paths.
  - Preview boundary tests updated to enforce this shared path.
- Remaining gaps: none identified in audited scope.

### 7) Admin Reporting
- Canonical tables/views: attendance, billing, transportation, and sales reporting datasets (`admin-reporting` services + canonical views/tables).
- Canonical read paths: `lib/services/admin-reporting-foundation.ts`, `lib/services/admin-reporting-core.ts`, `lib/services/reporting-attendance-dataset.ts`.
- Shared resolvers: expected attendance + billing/sales shared services consumed by reporting layer.
- Downstream consumers: `/admin-reports/attendance-summary`, `/admin-reports/revenue`, `/admin-reports/audit-trail`.
- Resolved in this run: validated report consumers continue to pull through canonical service/read-model layers.
- Remaining gaps: none identified in audited scope.

## Supabase Backing / Mock-Fallback Audit Result
- Runtime app/lib paths remain Supabase-backed for audited domains.
- Banned-pattern scan found no production runtime imports of `lib/mock` in `app`/`lib`.
- One `lib/mock` import exists in `scripts/seed-supabase.ts` (seed-only tooling), which is acceptable outside runtime production paths.

## Files Changed In This Run
- `types/supabase-types.d.ts` (regenerated to resolve schema/types drift)

## Migrations Added/Updated
- No new migration added in this run.
- Linked schema and local migrations validated as in sync via `npm run db:check`.

## Duplicated Rule Implementations Removed
- No additional duplicate rule consolidation was required in this run beyond already-present workspace changes.
- Care-plan member preview path is now consolidated to one shared resolver call chain in the current workspace edits.

## Validation
- `cmd /c npm run typecheck`: pass
- `cmd /c npm run build`: pass
- `cmd /c npm run reseed`: pass
- `cmd /c npm run db:check`: pass (after regenerating types)
- Banned-pattern scan:
  - `rg -n "lib/mock" app lib --glob '!lib/mock/**' --glob '!**/*.md'`: no production runtime hits

## Remaining Blockers
1. `supabase/.temp/cli-latest` changed from CLI metadata update (`v2.98.1` -> `v2.98.2`); operationally non-blocking but noisy in git state.
2. Supabase CLI is behind latest available (`v2.84.2` installed, `v2.98.2` available); non-blocking for this audit pass.
3. Docker config warning during linked db commands (`C:\Users\meeke\.docker\config.json` access denied) is non-fatal but should be cleaned up for environment hygiene.

## Explicit Canonicality Statement (Audited Scope)
For the audited scope and current workspace state, runtime paths are Supabase-backed and canonical, no production mock persistence paths were found, schema/types drift found in this run was resolved, and required build/reseed/db-check validations now pass.
