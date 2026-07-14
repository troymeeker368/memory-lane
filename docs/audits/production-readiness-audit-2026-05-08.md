# Production Readiness Audit - 2026-05-08

## Root Cause Summary
1. Several high-risk workflows had committed-truth gaps where post-commit follow-up persistence failures could be masked (enrollment packet completion follow-up and lead activity after conversion).
2. MCC and care-plan downstream consumers needed stricter canonical resolver/read boundary alignment to avoid split implementations.
3. Sales referral source normalization had duplicate transformation logic risk across consumer paths.
4. Authorization hardening was needed on intake/assessment entry points to keep clinical write workflows behind explicit module-action + role boundaries.

## Domain-by-Domain Canonical Mapping and Gaps

### 1) Attendance / Census / Schedule Changes / Holds / Closures
- Canonical tables: `attendance_records`, `member_attendance_schedules`, `schedule_changes`, `member_holds`, `center_closures`, `closure_rules`, `members`.
- Canonical write paths:
  - UI/actions -> `app/(portal)/operations/attendance/actions.ts` -> `lib/services/attendance-workflow-supabase.ts`
  - schedule change writes -> `lib/services/schedule-changes-supabase.ts`
  - hold writes -> `lib/services/holds-supabase.ts`
  - closure config -> `lib/services/billing-configuration.ts`
- Shared resolvers: `resolveExpectedAttendanceFromSupabaseContext` (`lib/services/expected-attendance-supabase.ts`), schedule normalization helpers (`lib/services/schedule-changes-shared.ts`).
- Downstream consumers: attendance operations pages, MCC attendance surfaces, attendance reporting datasets.
- Resolved in this run: validated reseed + build against canonical paths; no runtime mock/fallback persistence found in audited scope.
- Unresolved gaps: none identified.

### 2) MCC
- Canonical tables: `member_command_centers`, `member_attendance_schedules`, `members`, `member_contacts`, `member_files`.
- Canonical write/read paths: MCC pages/actions -> `lib/services/member-command-center-runtime.ts` / `lib/services/member-command-center-detail-read-model.ts` -> Supabase canonical services.
- Shared resolvers: canonical member identity (`lib/services/canonical-person-ref.ts`), MCC shared action wiring (`app/(portal)/operations/member-command-center/_actions/shared.ts`).
- Downstream consumers: MCC index/detail pages and tabs.
- Resolved in this run:
  - MCC index now forces privileged canonical read boundary (`serviceRole: true`) from page to runtime (`app/(portal)/operations/member-command-center/page.tsx`, `lib/services/member-command-center-runtime.ts`).
- Unresolved gaps: none identified.

### 3) Transportation
- Canonical tables: `transportation_manifest_adjustments`, `transportation_runs`, `transportation_run_results`, `transportation_logs`, `member_attendance_schedules`.
- Canonical write paths: transportation station actions -> `lib/services/transportation-station-supabase.ts`; run posting -> `lib/services/transportation-run-posting.ts`.
- Shared resolvers: `lib/services/transportation-manifest-shared.ts`, expected-attendance resolver.
- Downstream consumers: transportation station UI, print manifests, posting/reconciliation flows.
- Resolved in this run: validated end-to-end through build/reseed; no non-Supabase runtime persistence found.
- Unresolved gaps: none identified.

### 4) Billing
- Canonical tables: `billing_batches`, `billing_invoices`, `billing_invoice_lines`, `billing_adjustments`, `billing_coverages`, `billing_export_jobs`, `member_billing_settings`, `center_billing_settings`.
- Canonical write paths: operations payor actions -> billing services (`lib/services/billing-supabase.ts`, `lib/services/billing-rpc.ts`) -> Supabase.
- Shared resolvers: billing state/date helpers (`lib/services/billing-effective.ts`, `lib/services/billing-utils.ts`), attendance-linked billing derivations.
- Downstream consumers: billing module index/dashboard, invoice list/detail, exports, revenue reporting.
- Resolved in this run:
  - Removed split latest-batch fetch path by sourcing `latestBatch` from canonical dashboard summary payload (`lib/services/billing-read-supabase.ts`).
- Unresolved gaps: none identified.

### 5) Sales
- Canonical tables: `leads`, `lead_activities`, `lead_stage_history`, `community_partner_organizations`, `referral_sources`, `partner_activities`, `enrollment_packet_requests`.
- Canonical write paths: sales actions -> `lib/services/sales-*.ts` and conversion RPC-backed boundaries.
- Shared resolvers: CRM read-model and workflow helpers in `lib/services/sales-crm-read-model.ts`, `lib/services/sales-workflows.ts`.
- Downstream consumers: lead detail, activities log, partner/referral detail pages, pipeline/reporting surfaces.
- Resolved in this run:
  - Added committed-truth error boundary for conversion + lead activity write failures (`CommittedLeadActivityFollowUpError`) so UI reports follow-up required instead of masking post-commit failure (`lib/services/sales-lead-activities.ts`, `app/sales-lead-actions.ts`).
  - Hardened enrollment-packet lead activity idempotency insert path to tolerate duplicate-key replay safely via `idempotency_key` lookup (`lib/services/enrollment-packet-mapping-runtime.ts`).
  - Consolidated referral source normalization through shared exported resolver `normalizeSalesReferralSourcesWithPartnerRows` and aligned partner detail consumer to it (`lib/services/sales-crm-read-model.ts`, `lib/services/partner-detail-read-model.ts`).
- Unresolved gaps: none identified.

### 6) Care Plans
- Canonical tables: `care_plans`, `care_plan_sections`, `care_plan_versions`, `care_plan_review_history`, `care_plan_signature_events`.
- Canonical write paths: care-plan actions -> `lib/services/care-plans-write.ts` -> Supabase services/RPC boundaries.
- Shared resolvers: `lib/services/care-plans-read-model.ts`, readiness helpers (`lib/services/care-plan-post-sign-readiness.ts`).
- Downstream consumers: care-plan list/detail pages, member detail preview surfaces, public e-sign flows.
- Resolved in this run:
  - Added canonical preview resolver `getMemberCarePlanPreview` (bounded rows + canonical exact count) and updated member detail consumer to use one resolver path (`lib/services/care-plans-read-model.ts`, `lib/services/care-plans-read.ts`, `lib/services/member-detail-read-model.ts`).
- Unresolved gaps: none identified.

### 7) Admin Reporting
- Canonical datasets: attendance, billing, sales, transportation reporting data sourced via service-layer reporting modules.
- Canonical read paths: `lib/services/admin-reporting-foundation.ts`, `lib/services/admin-reporting-core.ts`, and domain dataset services.
- Shared resolvers: expected attendance, billing/sales shared read models.
- Downstream consumers: `/admin-reports/attendance-summary`, `/admin-reports/revenue`, `/admin-reports/audit-trail`.
- Resolved in this run: validated reporting read paths still compile/build against canonical services after resolver consolidations.
- Unresolved gaps: none identified.

## Cross-Domain Hardening Added This Run
- Enrollment packet public context now treats expired active tokens as expired before completed replay paths, preventing stale-link acceptance (`lib/services/enrollment-packets-public-runtime-context.ts`, `lib/services/enrollment-packets-public-runtime.ts`).
- Enrollment packet completion cascade now fails explicitly when follow-up state persistence fails (no synthetic success) (`lib/services/enrollment-packets-public-runtime-cascade.ts`, `lib/services/enrollment-packets-public-runtime-follow-up.ts`).
- Intake assessment health page + create action now require explicit health edit permission/role gate (`app/(portal)/health/assessment/page.tsx`, `app/intake-actions.ts`).

## Supabase Backing / Mock-Fallback Audit Result
- Runtime `app`/`lib` production paths: no `lib/mock` imports detected.
- No file-backed runtime persistence path was found in the audited domain scope.
- Build/reseed/db-check confirm migration-defined schema is present and linked types are in sync.

## Schema Drift Result
- `npm run db:check`: pass (linked DB up to date; generated types in sync).
- No new migration required in this run for audited scope.

## Files Changed (This Workspace Audit Pass)
- `app/(portal)/health/assessment/page.tsx`
- `app/(portal)/operations/member-command-center/page.tsx`
- `app/intake-actions.ts`
- `app/sales-lead-actions.ts`
- `lib/services/billing-read-supabase.ts`
- `lib/services/care-plans-read-model.ts`
- `lib/services/care-plans-read.ts`
- `lib/services/enrollment-packet-mapping-runtime.ts`
- `lib/services/enrollment-packets-public-runtime-cascade.ts`
- `lib/services/enrollment-packets-public-runtime-context.ts`
- `lib/services/enrollment-packets-public-runtime-follow-up.ts`
- `lib/services/enrollment-packets-public-runtime.ts`
- `lib/services/member-command-center-runtime.ts`
- `lib/services/member-detail-read-model.ts`
- `lib/services/partner-detail-read-model.ts`
- `lib/services/sales-crm-read-model.ts`
- `lib/services/sales-lead-activities.ts`
- test updates/additions under `tests/` for boundary/idempotency/committed-truth coverage.

## Validation
- `cmd /c npm run typecheck`: pass
- `cmd /c npm run build`: pass
- `cmd /c npm run reseed`: pass
- `cmd /c npm run db:check`: pass
- `cmd /c npm run quality:gates`: pass
- Banned-pattern scan: `rg -n "lib/mock" app lib --glob '!lib/mock/**' --glob '!**/*.md'`: no runtime hits

## Remaining Blockers / Risks
1. Environment hygiene warning persists: `C:\Users\meeke\.docker\config.json` access denied during Supabase CLI linked checks (non-fatal but noisy).
2. Supabase CLI version lag (`v2.84.2` installed, `v2.98.2` available); non-blocking but should be updated to reduce drift risk.

## Explicit Canonicality Statement (Audited Scope)
For attendance/census/schedule/holds/closures, MCC, transportation, billing, sales, care plans, and admin reporting in this workspace state, runtime paths are Supabase-backed and canonical, no runtime mock persistence path was found, no synthetic success fallback remains in the audited hardened flows, and required production-readiness validations passed.
