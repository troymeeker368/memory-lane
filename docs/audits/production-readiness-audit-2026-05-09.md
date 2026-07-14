# Production Readiness Audit - 2026-05-09

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
- The current codebase is largely aligned to canonical Supabase-backed service boundaries for the audited domains.
- Prior hardening already removed major runtime mock/fabrication paths. This pass verified those protections via source scans plus runtime validations (typecheck/build/reseed/db-check/quality gates).
- No new schema drift or non-Supabase runtime persistence was found in the audited scope.

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
  - UI (`app/(portal)/operations/attendance/actions.ts`, `schedule-changes/actions.ts`, `holds/actions.ts`, `operations/payor/actions-impl.ts`)
  - -> service layer (`attendance-workflow-supabase`, `schedule-changes-supabase`, `holds-supabase`, `billing-configuration`)
  - -> Supabase (`.from(...)`) and shared RPC where atomicity is required.
- Shared resolver/canonical rule path:
  - `expected-attendance-supabase` (`loadExpectedAttendanceSupabaseContext`, `resolveExpectedAttendanceFromSupabaseContext`)
  - `schedule-changes-shared` for schedule-change normalization/count semantics.
- Downstream consumers:
  - operations attendance pages, schedule changes pages, holds pages, billing/payor configuration and related MCC attendance/billing views.
- Gap status:
  - Resolved/clean in audited scope.
  - No direct UI-to-Supabase write bypass detected in these operation action modules.

### 2) MCC
- Canonical tables:
  - `members`, `member_command_centers`, `member_attendance_schedules`, `member_contacts`, `member_files`, `member_allergies`, `bus_stop_directory`, `intake_assessments`
- Canonical write path:
  - UI MCC action modules (`_actions/*` + `actions-impl.ts`)
  - -> `member-command-center` / `member-command-center-write`
  - -> Supabase.
- Shared resolver/canonical rule path:
  - `canonical-person-ref` for identity normalization.
  - `member-command-center-member-queries` for schema-safe member query mapping.
- Downstream consumers:
  - MCC index/detail views, attendance-billing tab, transportation tab, overview/profile workflows.
- Gap status:
  - Resolved/clean for runtime Supabase backing and canonical service entry.
  - Non-blocking technical debt remains: legacy inline member-file compatibility sentinel handling still exists for historical data surfaces (not a fabrication path, but still legacy compatibility code).

### 3) Transportation
- Canonical tables:
  - `transportation_manifest_adjustments`, `transportation_logs`, `transportation_runs`, `transportation_run_results`, `member_attendance_schedules`, `attendance_records`, `members`, `member_contacts`
- Canonical write path:
  - UI (`operations/transportation-station/actions.ts`)
  - -> services (`transportation-station-supabase`, `transportation-run-posting`, `transportation-run-manifest-supabase`)
  - -> Supabase with RPC-backed posting (`rpc_post_transportation_run`) for atomic run posting.
- Shared resolver/canonical rule path:
  - shared manifest/rider resolution in `transportation-run-manifest-supabase` and shared helpers.
  - expected attendance canonical context is reused from `expected-attendance-supabase` for day-level consistency.
- Downstream consumers:
  - transportation station page, print flows, billing transport charge reads.
- Gap status:
  - Resolved/clean in audited scope.
  - No synthetic success/fabricated rider run records detected.

### 4) Billing
- Canonical tables:
  - `billing_invoices`, `billing_invoice_lines`, `billing_batches`, `billing_adjustments`, `billing_export_jobs`, `member_billing_settings`, `billing_schedule_templates`, `center_billing_settings`, `payors`, `ancillary_charge_logs`, `ancillary_charge_categories`, `transportation_logs`
- Canonical write path:
  - UI (`operations/payor/actions-impl.ts`, MCC attendance-billing actions)
  - -> service layer (`billing-supabase`, `billing-rpc`, `billing-configuration`, `billing-workflows`)
  - -> Supabase/RPC (`rpc_generate_billing_batch`, `rpc_create_billing_export`, `rpc_finalize_billing_batch`, etc).
- Shared resolver/canonical rule path:
  - `billing-effective` effective-date and transport billing-state resolution.
  - `billing-read-supabase` for canonical read models.
- Downstream consumers:
  - payor pages, billing batch/finalization/export flows, admin reporting revenue and attendance summaries.
- Gap status:
  - Resolved/clean in audited scope.
  - No fallback persistence or local non-Supabase billing writes found.

### 5) Sales
- Canonical tables:
  - `leads`, `lead_activities`, `lead_stage_history`, `community_partner_organizations`, `referral_sources`, `partner_activities`
- Canonical write path:
  - UI actions (`app/sales-lead-actions.ts`, `app/sales-partner-actions.ts`)
  - -> service layer (`sales-crm-supabase`, `sales-lead-activities`, `sales-lead-stage-supabase`, `sales-lead-conversion-supabase`)
  - -> Supabase and RPC (`rpc_transition_lead_stage_v2`, `rpc_convert_lead_to_member`, `rpc_create_lead_with_member_conversion`).
- Shared resolver/canonical rule path:
  - `sales-crm-read-model` and `sales-workflows` (dashboard summary RPC), plus canonical lead/member resolution safeguards.
- Downstream consumers:
  - sales pipeline/summary pages, lead detail/edit, activities dashboards.
- Gap status:
  - Resolved/clean in audited scope.
  - No competing write paths detected from UI layers.

### 6) Care Plans
- Canonical tables:
  - `care_plans`, `care_plan_sections`, `care_plan_versions`, `care_plan_review_history`, `care_plan_signature_events`, `care_plan_nurse_signatures`
- Canonical write path:
  - UI (`app/care-plan-actions.ts`, `app/(portal)/health/care-plans/[carePlanId]/actions.ts`)
  - -> service layer (`care-plans-supabase`, `care-plan-esign`, `care-plan-esign-public`, `care-plan-nurse-esign`)
  - -> Supabase and RPC (`rpc_upsert_care_plan_core`, `rpc_record_care_plan_snapshot`, caregiver/nurse signature RPCs).
- Shared resolver/canonical rule path:
  - `care-plan-post-sign-readiness` + `care-plans-read-model` shared read/derived logic.
- Downstream consumers:
  - care plan list/detail/version pages, signature workflows, member file generation paths.
- Gap status:
  - Resolved/clean in audited scope.
  - No fabricated completion/synthetic signature success branch found.

### 7) Admin Reporting
- Canonical tables/views/functions:
  - `audit_logs`, `profiles`, `billing_invoices`, `transportation_logs`, `leads`, `member_billing_settings`, `center_billing_settings`, `member_attendance_schedules`, `v_ancillary_charge_logs_detailed`, `v_timely_docs_summary`, `v_last_toileted`, `v_monthly_ancillary_summary`
  - RPC: `rpc_get_member_documentation_summary`, `rpc_get_reports_home_staff_aggregates`
- Canonical write path:
  - Read-dominant domain; all reporting reads stay on Supabase-backed services (`admin-reporting-core`, `admin-reporting-foundation`, `reports`, `reports-ops`, `admin-audit-trail`).
- Shared resolver/canonical rule path:
  - `admin-reporting-core` reuses shared expected-attendance resolver context (`resolveExpectedAttendanceFromSupabaseContext`).
- Downstream consumers:
  - `/admin-reports/*`, `/reports/*` pages.
- Gap status:
  - Resolved/clean in audited scope.

## Runtime Mock / Fallback / File-backed Audit Result
- `rg -n "lib/mock" app lib --glob '!lib/mock/**' --glob '!**/*.md'` -> no runtime hits.
- Targeted scan for fabricated/synthetic masking in audited domain services found only explicit refusal/error guards (no silent fallback persistence).

## Seed / Runtime / Migration Alignment
- `npm run reseed` completed successfully with expected records across audited domains.
- `npm run db:check` passed:
  - linked DB up to date
  - generated types in sync
- No forward migration additions were required in this pass.

## Validation Evidence
- `npm run typecheck` -> pass
- `npm run build` -> pass
- `npm run reseed` -> pass
- `npm run db:check` -> pass
- `npm run quality:gates` -> pass

## Files Changed
- `docs/audits/production-readiness-audit-2026-05-09.md` (this report)

## Migrations Added/Updated
- None.

## Duplicated Rule Implementations Removed
- None in this pass (no new duplication detected in audited scope).

## Remaining Blockers
- No production blockers found in audited scope.
- Non-blocking environment hygiene warnings remain:
  - Supabase CLI local warning reading `C:\Users\meeke\.docker\config.json` (access denied)
  - Supabase CLI version lag (installed `2.84.2`, latest `2.98.2`)

## Final Readiness Statement
Within the audited scope and priority order above, runtime behavior is fully Supabase-backed, canonical service boundaries are preserved, no runtime mock/file-backed persistence paths were found, and validation checks passed.
