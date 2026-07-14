# Production Readiness Audit - 2026-06-15

## Scope
Priority order audited in this pass:
1. attendance / census / schedule changes / holds / closures
2. member command center (MCC)
3. transportation
4. billing
5. sales
6. care plans
7. admin reporting

## Root Cause Summary
- The highest-signal remaining code issue in this pass was not a Supabase-backing failure. It was a shared-resolver boundary drift in reports home, where reporting consumers were still split across parallel service readers (`lib/services/reports.ts` and `lib/services/reports-ops.ts`) instead of one canonical reporting foundation path.
- Attendance, MCC, transportation, billing, sales, and care-plan scoped services still read and write through Supabase-backed canonical services in the audited runtime paths inspected this pass.
- No new runtime mock/file-backed production persistence paths were found in the audited scope.

## Domain-by-Domain Gap Summary

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
  - UI/server actions
  - -> `attendance-workflow-supabase`, `schedule-changes-supabase`, `holds-supabase`, `billing-configuration`
  - -> Supabase
- Shared resolver path:
  - `expected-attendance`
  - `expected-attendance-supabase`
  - `schedule-changes-shared`
- Gap status:
  - No new code gap fixed in this pass.
  - Runtime remains Supabase-backed in the audited read/write paths reviewed.

### 2) Member Command Center (MCC)
- Canonical tables:
  - `members`
  - `member_command_centers`
  - `member_attendance_schedules`
  - `member_contacts`
  - `member_files`
  - `member_allergies`
- Canonical write path:
  - MCC action modules
  - -> `member-command-center-write` / `member-files`
  - -> Supabase
- Shared resolver path:
  - `member-command-center-runtime`
  - `member-command-center-detail-read-model`
  - `canonical-person-ref`
- Gap status:
  - No new canonicality regression found in the inspected MCC read path.
  - Existing runtime naming split (`member-command-center-runtime` vs `member-command-center-supabase`) remains a maintainability smell but did not present a second competing data source in this pass.

### 3) Transportation
- Canonical tables:
  - `transportation_manifest_adjustments`
  - `transportation_logs`
  - `transportation_runs`
  - `transportation_run_results`
- Canonical write path:
  - transportation actions
  - -> `transportation-station-supabase`, `transportation-run-posting`, `transportation-run-manifest-supabase`
  - -> Supabase
- Shared resolver path:
  - `transportation-manifest-shared`
  - expected attendance shared resolver
- Gap status:
  - No new code gap fixed in this pass.

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
- Canonical write path:
  - billing/payor actions
  - -> `billing-supabase`, `billing-rpc`, `billing-workflows`
  - -> Supabase
- Shared resolver path:
  - `billing-effective`
  - `billing-read-supabase`
- Gap status:
  - No new code gap fixed in this pass.

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
  - -> `sales-crm-supabase`, `sales-lead-activities`, `sales-lead-stage-supabase`, `sales-lead-conversion-supabase`
  - -> Supabase
- Shared resolver path:
  - `sales-crm-read-model`
  - `sales-workflows`
- Gap status:
  - No new code gap fixed in this pass.

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
  - -> Supabase
- Shared resolver path:
  - `care-plans-read-model`
  - `care-plan-post-sign-readiness`
- Gap status:
  - No new code gap fixed in this pass.

### 7) Admin Reporting
- Canonical tables/views/functions:
  - `v_timely_docs_summary`
  - `v_last_toileted`
  - `v_monthly_ancillary_summary`
  - `billing_invoices`
  - `transportation_logs`
  - `leads`
  - `rpc_get_reports_home_staff_aggregates`
  - `rpc_get_member_documentation_summary`
- Canonical read path before fix:
  - `/reports`
  - -> `reports.ts` + `reports-ops.ts`
  - -> direct Supabase view/RPC reads
- Canonical read path after fix:
  - `/reports`
  - -> `reports.ts` / `reports-ops.ts` thin delegators
  - -> `admin-reporting-foundation`
  - -> Supabase views/RPC
- Shared resolver path:
  - `admin-reporting-foundation`
  - `admin-reporting-core`
- Gap status:
  - Resolved in this pass.
  - Reports home documentation and operations snapshot reads now delegate through one shared foundation path instead of parallel report-specific readers.

## Files Changed
- `lib/services/admin-reporting-foundation.ts`
- `lib/services/reports.ts`
- `lib/services/reports-ops.ts`
- `tests/reports-home-canonical-boundary.test.ts`

## Migrations Added/Updated
- None.

## Duplicated Rule Implementations Removed
- Reports-home read aggregation is now centralized in `admin-reporting-foundation`.
- `reports.ts` and `reports-ops.ts` remain only as thin compatibility delegators.

## Runtime Mock / Fallback / File-backed Audit
- Banned-pattern scan:
  - `rg -n "lib/mock" app lib --glob "!lib/mock/**" --glob "!**/*.md"`
  - no runtime hits
- No fabricated record creation or silent fallback persistence path was introduced in this pass.

## Validation
- `npm run typecheck`: pass
- `node --test tests/reports-home-canonical-boundary.test.ts`: pass
- `npm run build`: blocked by local filesystem lock
  - `EPERM: operation not permitted, unlink 'D:\Memory Lane App\.next\diagnostics\build-diagnostics.json'`
- `npm run reseed`: blocked by network/DNS resolution failure
  - `getaddrinfo ENOTFOUND dcnyjtfyftamcdsaxrsz.supabase.co`
- `npm run db:check`: blocked by Supabase connectivity / linked remote lookup failure
  - Docker config warning: `C:\Users\meeke\.docker\config.json` access denied
  - linked remote error: `tenant/user postgres.dcnyjtfyftamcdsaxrsz not found`

## Resolved vs Unresolved Gaps
- Resolved:
  - Admin reporting reports-home readers now use one canonical shared foundation path.
  - No new mock/file-backed production runtime paths were detected in the audited scope.
  - No schema migration was required for the reporting-path consolidation.
- Unresolved:
  - Build validation is blocked by a local `.next` diagnostics file lock, so this pass cannot claim build-clean readiness yet.
  - Reseed and `db:check` are blocked by current Supabase host/linked-project connectivity failures, so live schema/runtime alignment could not be revalidated end-to-end today.
  - MCC service naming remains split across `member-command-center-runtime` and `member-command-center-supabase`; behavior is still canonical in the audited paths, but the naming split is a maintainability risk for future drift.

## Final Readiness Statement
For the code paths directly changed in this pass, runtime remains Supabase-backed and more canonical than before because reports-home consumers now route through a shared reporting foundation instead of parallel read implementations. Full production-readiness validation for the broader audited scope remains partially blocked by local build file locking and current Supabase connectivity failures.
