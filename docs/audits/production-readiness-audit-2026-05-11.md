# Production Readiness Audit - 2026-05-11

## Scope
Priority order audited end-to-end in this pass:
1. attendance / census / schedule changes / holds / closures
2. member command center (MCC)
3. transportation
4. billing
5. sales
6. care plans
7. admin reporting

## Root Cause Summary
- The high-risk domains remain Supabase-backed and continue to use canonical service/resolver boundaries for business writes and derived reads.
- Current in-flight hardening changes in this working tree improved canonical behavior in MCC index reads, billing dashboard aggregation, sales follow-up truth states, care-plan preview reads, and admin audit filtering.
- No new schema drift was detected against linked Supabase migrations/types.
- No runtime mock/file-backed persistence paths were detected in production app/lib runtime code for this scope.

## Domain-by-Domain Canonicality Map + Gap Status

### 1) Attendance / Census / Schedule Changes / Holds / Closures
- Canonical tables:
  - `attendance_records`
  - `member_attendance_schedules`
  - `member_holds`
  - `schedule_changes`
  - `center_closures`
  - `closure_rules`
  - `center_billing_settings`
- Canonical write path:
  - UI/server actions (`operations/attendance`, `operations/schedule-changes`, `operations/holds`, `operations/payor`)
  - -> services (`attendance-workflow-supabase`, `schedule-changes-supabase`, `holds-supabase`, `billing-configuration`)
  - -> Supabase tables/RPC.
- Shared resolver path:
  - `expected-attendance-supabase`
  - `schedule-changes-shared`
  - `member-schedule-selectors`.
- Downstream consumers:
  - Attendance dashboard, MCC attendance tab, schedule changes manager, holds management, billing readiness reads.
- Gap status:
  - Resolved/clean in this pass.

### 2) Member Command Center (MCC)
- Canonical tables:
  - `members`
  - `member_command_centers`
  - `member_attendance_schedules`
  - `member_contacts`
  - `member_files`
  - `member_allergies`
  - `bus_stop_directory`
  - `intake_assessments`
- Canonical write path:
  - `app/(portal)/operations/member-command-center/_actions/*`
  - -> shared MCC services (`member-command-center`, `member-command-center-write`, `member-command-center-runtime`)
  - -> Supabase.
- Shared resolver path:
  - `canonical-person-ref`
  - `member-command-center-member-queries`
  - shared attendance/schedule resolvers.
- Downstream consumers:
  - MCC index/detail, attendance-billing surface, transportation readiness reads, member file workflows.
- Gap status:
  - Resolved in this pass; index read now explicitly uses the canonical privileged client path (`serviceRole`) where required.

### 3) Transportation
- Canonical tables:
  - `transportation_manifest_adjustments`
  - `transportation_logs`
  - `transportation_runs`
  - `transportation_run_results`
  - `member_attendance_schedules`
  - `attendance_records`
  - `member_contacts`
  - `members`
- Canonical write path:
  - transportation station actions
  - -> `transportation-station-supabase` / `transportation-run-*` services
  - -> Supabase + transportation RPC boundaries.
- Shared resolver path:
  - `transportation-manifest-shared`
  - expected-attendance shared resolver.
- Downstream consumers:
  - Transportation station UI + print, billing transport charge readers.
- Gap status:
  - Resolved/clean in this pass.

### 4) Billing
- Canonical tables:
  - `billing_invoices`
  - `billing_invoice_lines`
  - `billing_batches`
  - `billing_adjustments`
  - `billing_export_jobs`
  - `member_billing_settings`
  - `billing_schedule_templates`
  - `center_billing_settings`
  - `ancillary_charge_logs`
  - `transportation_logs`
  - `member_contacts` (payors)
- Canonical write path:
  - payor + MCC attendance-billing actions
  - -> `billing-supabase` / `billing-rpc` / `billing-workflows`
  - -> Supabase.
- Shared resolver path:
  - `billing-effective`
  - `billing-read-supabase`.
- Downstream consumers:
  - billing dashboards, invoice queues, batch flows, export jobs, admin revenue reporting.
- Gap status:
  - Resolved in this pass; dashboard/latest-batch now comes from one canonical read model path.

### 5) Sales
- Canonical tables:
  - `leads`
  - `lead_activities`
  - `lead_stage_history`
  - `community_partner_organizations`
  - `referral_sources`
  - `partner_activities`
- Canonical write path:
  - sales server actions
  - -> `sales-lead-activities`, `sales-crm-supabase`, `sales-lead-stage-supabase`, `sales-lead-conversion-supabase`
  - -> Supabase.
- Shared resolver path:
  - `sales-crm-read-model`
  - `sales-workflows`.
- Downstream consumers:
  - pipeline, lead detail, activities, partner/referral directories, summary dashboards.
- Gap status:
  - Resolved in this pass; committed-conversion activity write failures now return explicit follow-up state instead of ambiguous generic failure.

### 6) Care Plans
- Canonical tables:
  - `care_plans`
  - `care_plan_sections`
  - `care_plan_versions`
  - `care_plan_review_history`
  - `care_plan_signature_events`
  - `care_plan_nurse_signatures`
- Canonical write path:
  - care-plan server actions
  - -> `care-plans-supabase`, `care-plan-esign*`
  - -> Supabase + RPC-backed lifecycle transitions.
- Shared resolver path:
  - `care-plans-read-model`
  - `care-plan-post-sign-readiness`.
- Downstream consumers:
  - member detail preview, care-plan list/detail/version pages, signature/public token flows.
- Gap status:
  - Resolved in this pass; member detail now uses one canonical preview resolver instead of split read paths.

### 7) Admin Reporting
- Canonical tables/views/functions:
  - `audit_logs`
  - `profiles`
  - `billing_invoices`
  - `transportation_logs`
  - `leads`
  - reporting views/RPC used by `admin-reporting-*` services.
- Canonical read path:
  - report pages
  - -> `admin-reporting-core` / `admin-reporting-foundation` / report services
  - -> Supabase.
- Shared resolver path:
  - `admin-reporting-core`.
- Downstream consumers:
  - `/admin-reports/*`, report exports, audit trail page.
- Gap status:
  - Resolved in this pass; audit trail area filtering is normalized into a shared parser/filter builder.

## Runtime Mock / Fallback / File-backed Audit
- `rg -n "lib/mock" app lib --glob '!lib/mock/**' --glob '!**/*.md'` -> no production runtime hits.
- Targeted fallback-pattern scan found explicit refusal/error guardrails only (no silent fallback persistence or fabricated success records in scoped domains).

## Schema Drift / Seed/Runtime Alignment
- `npm run db:check` passed (`supabase db push --dry-run --linked` + `check-db-sync`).
- `npm run reseed` passed with expected module counts for `sales`, `intake`, and `attendance`.
- No new migration required in this pass.

## Validation Evidence
- `npm run typecheck` -> pass
- `npm run build` -> pass
- `npm run reseed` -> pass
- `npm run db:check` -> pass
- `npm run quality:gates` -> pass

## Files Changed (This Audit Pass)
- `docs/audits/production-readiness-audit-2026-05-11.md` (this report)

## Migrations Added/Updated
- None.

## Duplicated Rule Implementations Removed
- No new duplicate derived-rule implementations detected in scoped domains.
- Existing in-flight changes consolidate duplicated reads in billing/care-plan/sales/admin-reporting surfaces.

## Resolved vs Unresolved Gaps
- Resolved in this pass:
  - Supabase backing and canonical service boundaries verified for all required domains.
  - No runtime mock/file-backed production paths found in scope.
  - No schema/runtime drift detected in linked environment.
  - Validation suite passed (`typecheck`, `build`, `reseed`, `db:check`, `quality:gates`).
- Unresolved (non-blocking environment hygiene):
  - Supabase CLI warning: `C:\Users\meeke\.docker\config.json` access denied.
  - Supabase CLI version lag: installed `2.84.2`, latest `2.98.2`.

## Final Readiness Statement
Within this audit scope and priority order, runtime behavior is fully Supabase-backed and canonical, with no detected fabricated runtime persistence paths, no detected competing business-rule implementations in scoped domains, and required production-readiness validation checks passing.
