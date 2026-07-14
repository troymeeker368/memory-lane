# Production Readiness Audit - 2026-05-12

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
- The scoped domains are still anchored on Supabase-backed canonical services/resolvers.
- In-flight hardening changes continued to close split-read and post-commit truth gaps (MCC privileged index reads, billing dashboard/latest batch alignment, sales committed-conversion follow-up state, care plan preview count/read unification).
- No new runtime mock/file-backed persistence paths were detected in audited production paths.
- No schema/runtime drift was detected against linked Supabase migrations/types in this pass.

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
  - attendance dashboard, MCC attendance billing surface, schedule changes manager, holds manager, billing readiness readers.
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
  - -> `member-command-center-write` / `member-command-center` / `member-command-center-runtime`
  - -> Supabase.
- Shared resolver path:
  - `canonical-person-ref`
  - `member-command-center-member-queries`
  - attendance/schedule shared resolvers.
- Downstream consumers:
  - MCC index/detail, attendance-billing, transportation readiness, member file workflows.
- Gap status:
  - Resolved in this pass; index read path now explicitly supports privileged service-role fetch via canonical runtime call (`serviceRole: true` consumer + `getMccClient` service selector).

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
  - -> `transportation-station-supabase` / `transportation-run-posting` / `transportation-run-manifest-supabase`
  - -> Supabase + transportation RPC boundaries.
- Shared resolver path:
  - `transportation-manifest-shared`
  - expected-attendance shared resolver.
- Downstream consumers:
  - transportation station UI/print and billing transport charge consumers.
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
  - payor + attendance-billing actions
  - -> `billing-supabase` / `billing-rpc` / `billing-workflows`
  - -> Supabase.
- Shared resolver path:
  - `billing-effective`
  - `billing-read-supabase`.
- Downstream consumers:
  - revenue dashboard, invoice queues, batch workflows, exports, admin revenue reporting.
- Gap status:
  - Resolved in this pass; latest-batch read now sourced from one canonical dashboard aggregation path (removed parallel `getBillingBatches()` call inside module index).

### 5) Sales
- Canonical tables:
  - `leads`
  - `lead_activities`
  - `lead_stage_history`
  - `community_partner_organizations`
  - `referral_sources`
  - `partner_activities`
- Canonical write path:
  - sales actions
  - -> `sales-lead-activities`, `sales-crm-supabase`, `sales-lead-stage-supabase`, `sales-lead-conversion-supabase`
  - -> Supabase.
- Shared resolver path:
  - `sales-crm-read-model`
  - `sales-workflows`.
- Downstream consumers:
  - pipeline surfaces, lead detail, activities, partner/referral directories, summary pages.
- Gap status:
  - Resolved in this pass:
    - post-conversion activity failure now throws typed committed-follow-up error (no ambiguous generic failure state),
    - action layer returns committed follow-up readiness state instead of falsely signaling full failure,
    - referral partner identity normalization consolidated in shared read-model export.

### 6) Care Plans
- Canonical tables:
  - `care_plans`
  - `care_plan_sections`
  - `care_plan_versions`
  - `care_plan_review_history`
  - `care_plan_signature_events`
  - `care_plan_nurse_signatures`
- Canonical write path:
  - care plan actions
  - -> `care-plans-supabase`, `care-plan-esign*`, `care-plan-nurse-esign*`
  - -> Supabase + lifecycle-safe RPC/service boundaries.
- Shared resolver path:
  - `care-plans-read-model`
  - `care-plan-post-sign-readiness`.
- Downstream consumers:
  - care plan pages/list/detail/versions and member detail preview.
- Gap status:
  - Resolved in this pass; member detail now reads care-plan preview/count from one canonical resolver (`getMemberCarePlanPreview`) instead of split overview/snapshot paths.

### 7) Admin Reporting
- Canonical tables/views/functions:
  - `audit_logs`
  - `profiles`
  - `billing_invoices`
  - `transportation_logs`
  - `leads`
  - report views/RPC consumed by admin reporting services.
- Canonical read path:
  - `/admin-reports/*`
  - -> `admin-reporting-core` / `admin-reporting-foundation`
  - -> Supabase.
- Shared resolver path:
  - `admin-reporting-core`.
- Downstream consumers:
  - admin report dashboards and exports.
- Gap status:
  - Resolved/clean in this pass.

## Runtime Mock / Fallback / File-backed Audit
- `rg -n "lib/mock" app lib --glob "!lib/mock/**" --glob "!**/*.md"` -> no production runtime hits.
- Priority-domain action/route scan for direct `.from()` / `.rpc()` writes bypassing canonical services -> no bypass hits in audited paths.
- Fallback-pattern scan found normalization and UI-navigation fallbacks only; no fabricated record persistence path introduced in audited domains.

## Schema Drift / Seed Runtime Alignment
- `npm run db:check` passed (`supabase db push --dry-run --linked` + `check-db-sync`).
- `npm run reseed` passed (sales/intake/attendance modules + downstream table counts present).
- No new migration required in this pass.

## Validation Evidence
- `npm run typecheck` -> pass
- `npm run build` -> pass
- `npm run reseed` -> pass
- `npm run db:check` -> pass
- banned-pattern search (`lib/mock`) -> no hits

## Files Changed (This Audit Pass)
- `docs/audits/production-readiness-audit-2026-05-12.md` (this report).

## Migrations Added/Updated
- None.

## Duplicated Rule Implementations Removed
- No new duplicate derived-rule implementations detected in audited domains.
- Existing in-flight hardening consolidates duplicate read behavior for:
  - MCC privileged index read routing,
  - billing latest-batch source,
  - sales referral normalization,
  - member-detail care-plan preview/count read.

## Resolved vs Unresolved Gaps
- Resolved in this pass:
  - Canonical Supabase backing remains intact for all required domains.
  - No runtime mock/file-backed production paths in audited scope.
  - No schema/runtime drift detected in linked environment.
  - Required validations (`typecheck`, `build`, `reseed`, banned-pattern search) passed.
- Unresolved / blockers:
  - Local environment warning: Supabase CLI cannot read `C:\Users\meeke\.docker\config.json` (access denied).
  - Local environment hygiene: Supabase CLI version lag (`2.84.2` installed vs `2.98.2` latest).
  - Optional targeted `node --test` execution failed with local `spawn EPERM` restriction (execution environment issue, not assertion-level failures).

## Final Readiness Statement
Within the audited scope and requested priority order, runtime behavior is Supabase-backed and canonical, with no detected fabricated runtime persistence paths, no detected competing business-rule implementations in the scoped domains, and required production-readiness validations passing.
