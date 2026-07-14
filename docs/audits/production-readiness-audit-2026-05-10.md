# Production Readiness Audit - 2026-05-10

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
- The audited workflows remain Supabase-backed with canonical service boundaries intact.
- No runtime mock/file-backed persistence paths were found in production app/lib runtime code.
- No new schema drift was detected between runtime expectations and linked Supabase migrations/types.
- Current outstanding items are non-blocking environment hygiene warnings (Supabase CLI Docker config access + CLI version lag).

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
  - UI actions (`app/(portal)/operations/attendance/actions.ts`, `schedule-changes/actions.ts`, `holds/actions.ts`, `operations/payor/actions-impl.ts`)
  - -> service layer (`attendance-workflow-supabase`, `schedule-changes-supabase`, `holds-supabase`, `billing-configuration`)
  - -> Supabase tables and RPC where needed.
- Shared resolver path:
  - `expected-attendance-supabase` (`loadExpectedAttendanceSupabaseContext`, `resolveExpectedAttendanceFromSupabaseContext`)
  - `schedule-changes-shared` for schedule day/count normalization.
- Downstream consumers:
  - Operations attendance dashboard, schedule changes, holds, billing settings and MCC attendance surfaces.
- Gap status:
  - Resolved/clean in this pass.
  - No UI direct Supabase business writes detected.

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
  - UI action modules (`app/(portal)/operations/member-command-center/_actions/*`)
  - -> shared MCC services (`member-command-center`, `member-command-center-write`)
  - -> Supabase.
- Shared resolver path:
  - `canonical-person-ref`
  - `member-command-center-member-queries`
  - attendance/transport resolution via shared schedule selectors + expected-attendance resolver.
- Downstream consumers:
  - MCC index/detail, attendance-billing tab, transportation tab, profile workflows.
- Gap status:
  - Resolved/clean in this pass.

### 3) Transportation
- Canonical tables:
  - `transportation_manifest_adjustments`
  - `transportation_logs`
  - `transportation_runs`
  - `transportation_run_results`
  - `member_attendance_schedules`
  - `attendance_records`
  - `members`
  - `member_contacts`
- Canonical write path:
  - UI actions (`app/(portal)/operations/transportation-station/actions.ts`)
  - -> services (`transportation-station-supabase`, `transportation-run-posting`, `transportation-run-manifest-supabase`)
  - -> Supabase + shared posting RPC (`rpc_post_transportation_run`).
- Shared resolver path:
  - `transportation-run-manifest-supabase` + `transportation-manifest-shared`
  - expected attendance shared resolver alignment.
- Downstream consumers:
  - Transportation station dashboard, print workflows, billing transportation charge reads.
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
  - `payors`
  - `ancillary_charge_logs`
  - `ancillary_charge_categories`
  - `transportation_logs`
- Canonical write path:
  - UI actions (`operations/payor/actions-impl.ts`, MCC attendance-billing actions)
  - -> services (`billing-supabase`, `billing-rpc`, `billing-configuration`, `billing-workflows`)
  - -> Supabase + canonical billing RPCs.
- Shared resolver path:
  - `billing-effective`
  - `billing-read-supabase` (canonical billing read model).
- Downstream consumers:
  - Payor settings, billing batches, invoice queues, export flows, admin reporting revenue aggregates.
- Gap status:
  - Resolved/clean in this pass.

### 5) Sales
- Canonical tables:
  - `leads`
  - `lead_activities`
  - `lead_stage_history`
  - `community_partner_organizations`
  - `referral_sources`
  - `partner_activities`
- Canonical write path:
  - UI actions (`app/sales-lead-actions.ts`, `app/sales-partner-actions.ts`)
  - -> services (`sales-crm-supabase`, `sales-lead-activities`, `sales-lead-stage-supabase`, `sales-lead-conversion-supabase`)
  - -> Supabase + shared lifecycle RPCs.
- Shared resolver path:
  - `sales-crm-read-model`
  - `sales-workflows`
  - lead/member identity resolution safeguards in conversion pipeline.
- Downstream consumers:
  - Sales pipeline pages, lead detail, activity logs, summary dashboards.
- Gap status:
  - Resolved/clean in this pass.

### 6) Care Plans
- Canonical tables:
  - `care_plans`
  - `care_plan_sections`
  - `care_plan_versions`
  - `care_plan_review_history`
  - `care_plan_signature_events`
  - `care_plan_nurse_signatures`
- Canonical write path:
  - UI actions (`app/care-plan-actions.ts`, `app/(portal)/health/care-plans/[carePlanId]/actions.ts`)
  - -> services (`care-plans-supabase`, `care-plan-esign`, `care-plan-esign-public`, `care-plan-nurse-esign`)
  - -> Supabase + care-plan RPCs.
- Shared resolver path:
  - `care-plan-post-sign-readiness`
  - `care-plans-read-model`.
- Downstream consumers:
  - Care plan list/detail/version workflows, signature flows, generated file surfaces.
- Gap status:
  - Resolved/clean in this pass.

### 7) Admin Reporting
- Canonical tables/views/functions:
  - `audit_logs`
  - `profiles`
  - `billing_invoices`
  - `transportation_logs`
  - `leads`
  - `member_billing_settings`
  - `center_billing_settings`
  - `member_attendance_schedules`
  - `v_ancillary_charge_logs_detailed`
  - `v_timely_docs_summary`
  - `v_last_toileted`
  - `v_monthly_ancillary_summary`
  - RPC: `rpc_get_member_documentation_summary`, `rpc_get_reports_home_staff_aggregates`
- Canonical read path:
  - Reporting pages
  - -> `admin-reporting-core` / `admin-reporting-foundation` / report services
  - -> Supabase-backed queries and RPC.
- Shared resolver path:
  - `admin-reporting-core` + shared expected-attendance resolver usage.
- Downstream consumers:
  - `/admin-reports/*` and `/reports/*`.
- Gap status:
  - Resolved/clean in this pass.

## Runtime Mock / Fallback / File-backed Audit
- `rg -n "lib/mock" app lib --glob '!lib/mock/**' --glob '!**/*.md'` -> no production runtime hits.
- Targeted fabricated/synthetic fallback scan found explicit refusal guards only; no silent persistence masking in audited domains.

## Schema Drift / Seed Alignment
- `npm run db:check` passed (linked DB up to date, generated types in sync).
- `npm run reseed` passed end-to-end for audited modules.
- No migration additions required in this pass.

## Validation Evidence
- `npm run typecheck` -> pass
- `npm run build` -> pass
- `npm run reseed` -> pass
- `npm run db:check` -> pass
- `npm run quality:gates` -> pass

## Files Changed
- `docs/audits/production-readiness-audit-2026-05-10.md` (this report)

## Migrations Added/Updated
- None.

## Duplicated Rule Implementations Removed
- None in this pass (no new duplicate canonical business-rule implementations detected for scoped domains).

## Resolved vs Unresolved Gaps
- Resolved this pass:
  - Supabase backing verified across all 7 scoped domains.
  - Canonical write/service/resolver boundaries verified.
  - No runtime mock/file-backed production paths detected.
  - No schema drift detected in linked environment.
- Unresolved (non-blocking):
  - Supabase CLI local warning reading `C:\Users\meeke\.docker\config.json` (access denied).
  - Supabase CLI version lag (installed `2.84.2`, latest `2.98.2`).

## Final Readiness Statement
Within the audited scope and priority order above, runtime behavior is fully Supabase-backed and canonical, with no detected fabricated runtime persistence paths, no detected competing business-rule implementations in scoped domains, and all required validation checks passing.
