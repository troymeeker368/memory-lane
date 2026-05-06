# Supabase RLS & Security Audit (2026-04-21)

Generated: 2026-04-21

## 1. Executive Summary
- Confirmed improvement: the repo now includes [`0214_privileged_rpc_execute_hardening.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0214_privileged_rpc_execute_hardening.sql:1), which revokes `authenticated` execute on `rpc_list_member_files(uuid)` and `rpc_reconcile_expired_pof_requests(integer)`.
- Confirmed improvement: the current workspace also adds read hardening in [`0216_operational_read_policy_permission_hardening.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0216_operational_read_policy_permission_hardening.sql:1), [`0217_member_holds_and_billing_adjustments_read_policy_hardening.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0217_member_holds_and_billing_adjustments_read_policy_hardening.sql:1), and [`0218_care_plan_policy_permission_hardening.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0218_care_plan_policy_permission_hardening.sql:1).
- Confirmed improvement: the old health write-helper bug is fixed in [`lib/permissions/core.ts`](/D:/Memory%20Lane%20App/lib/permissions/core.ts:270), and member-file uploads now enforce size/type validation in [`lib/services/member-files.ts`](/D:/Memory%20Lane%20App/lib/services/member-files.ts:136).
- Highest current risks are now:
  1. older `authenticated using (true)` read policies still exposing clinical, billing, and operational tables;
  2. app-side permission gaps that still let broader staff roles see or trigger more than intended;
  3. one current public enrollment-packet token issue where a completed packet can still mint a fresh download token from an expired parent token.
- Repo-only blocker: this audit is based on code and migrations in the workspace. I could not verify the live Supabase project's deployed `pg_policies`, grants, RPC execute permissions, or storage bucket policies from the repo alone.

## 2. Tables Missing RLS
- Low - `public.sites`, `public.lookup_lists`, and `public.punches_linked_time_punch_review` are still created without any repo-defined `ENABLE ROW LEVEL SECURITY` later in the migration chain.
  References: [`0001_initial_schema.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0001_initial_schema.sql:7), [`0001_initial_schema.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0001_initial_schema.sql:312), [`0017_reseed_schema_alignment.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0017_reseed_schema_alignment.sql:9).
  Why it matters: these tables currently depend on grants instead of an explicit row boundary, which is easy to forget and unsafe if usage expands later.

## 3. Overly Permissive Policies
- High - intake and related clinical tables still allow broad authenticated reads with `using (true)`.
  Tables: `intake_assessments`, `assessment_responses`, `physician_orders`, `member_health_profiles`, `intake_assessment_signatures`.
  References: [`0006_intake_pof_mhp_supabase.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0006_intake_pof_mhp_supabase.sql:175), [`0006_intake_pof_mhp_supabase.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0006_intake_pof_mhp_supabase.sql:182), [`0006_intake_pof_mhp_supabase.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0006_intake_pof_mhp_supabase.sql:189), [`0006_intake_pof_mhp_supabase.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0006_intake_pof_mhp_supabase.sql:196), [`0022_intake_assessment_esign.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0022_intake_assessment_esign.sql:95).
- High - member-detail and operational support tables still expose cross-member reads to any authenticated staff session.
  Tables: `member_providers`, `member_equipment`, `member_notes`, `bus_stop_directory`, `locker_assignment_history`.
  References: [`0012_legacy_operational_health_alignment.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0012_legacy_operational_health_alignment.sql:273), [`0012_legacy_operational_health_alignment.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0012_legacy_operational_health_alignment.sql:300), [`0012_legacy_operational_health_alignment.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0012_legacy_operational_health_alignment.sql:309), [`0011_member_command_center_aux_schema.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0011_member_command_center_aux_schema.sql:398), [`0040_locker_assignment_history.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0040_locker_assignment_history.sql:22).
- High - several billing tables still keep unconditional authenticated reads even after the newer 0216/0217 hardening.
  Tables: `billing_batches`, `billing_invoices`, `billing_invoice_lines`, `billing_coverages`, `billing_export_jobs`.
  References: [`0013_care_plans_and_billing_execution.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0013_care_plans_and_billing_execution.sql:356), [`0013_care_plans_and_billing_execution.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0013_care_plans_and_billing_execution.sql:363), [`0013_care_plans_and_billing_execution.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0013_care_plans_and_billing_execution.sql:378), [`0013_care_plans_and_billing_execution.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0013_care_plans_and_billing_execution.sql:386), [`0013_care_plans_and_billing_execution.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0013_care_plans_and_billing_execution.sql:393).
- Medium - several support/workflow tables still keep broad authenticated reads and should be revisited.
  Tables: `care_plan_signature_events`, `care_plan_diagnoses`, `enrollment_packet_pof_staging`, `enrollment_packet_mapping_runs`, `enrollment_packet_mapping_records`, `enrollment_packet_follow_up_queue`, `enrollment_pricing_community_fees`, `enrollment_pricing_daily_rates`, `transportation_runs`, `transportation_run_results`.
  References: [`0020_care_plan_canonical_esign.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0020_care_plan_canonical_esign.sql:83), [`0085_care_plan_diagnosis_relation.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0085_care_plan_diagnosis_relation.sql:60), [`0027_enrollment_packet_intake_mapping.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0027_enrollment_packet_intake_mapping.sql:156), [`0027_enrollment_packet_intake_mapping.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0027_enrollment_packet_intake_mapping.sql:166), [`0027_enrollment_packet_intake_mapping.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0027_enrollment_packet_intake_mapping.sql:175), [`0110_enrollment_packet_follow_up_queue.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0110_enrollment_packet_follow_up_queue.sql:49), [`0026_enrollment_pricing_module.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0026_enrollment_pricing_module.sql:58), [`0026_enrollment_pricing_module.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0026_enrollment_pricing_module.sql:68), [`0081_transportation_run_posting.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0081_transportation_run_posting.sql:148), [`0081_transportation_run_posting.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0081_transportation_run_posting.sql:155).

## 4. Public Endpoint Risks
- Medium - a completed enrollment packet can still mint a fresh completed-packet download token from an expired parent token.
  Why: [`getPublicEnrollmentPacketContext()`](/D:/Memory%20Lane%20App/lib/services/enrollment-packets-public-runtime-context.ts:205) returns `completed` before checking `token_expires_at`, and the confirmation page immediately calls [`issuePublicCompletedEnrollmentPacketDownloadToken()`](/D:/Memory%20Lane%20App/app/sign/enrollment-packet/%5Btoken%5D/confirmation/page.tsx:66), which trusts that completed context and issues a new short-lived download token in [`enrollment-packets-public-runtime-artifacts.ts`](/D:/Memory%20Lane%20App/lib/services/enrollment-packets-public-runtime-artifacts.ts:85).
- Medium - enrollment-packet submit throttling is advisory rather than atomic.
  Why: [`enforcePublicEnrollmentPacketSubmissionGuards()`](/D:/Memory%20Lane%20App/lib/services/enrollment-packet-public-helpers.ts:196) counts recent attempts first and writes the new `started` event afterward, so concurrent requests can slip through the intended per-token and per-IP limits.
- No confirmed unauthenticated direct write bypass in the current public POF, care-plan, or enrollment-packet submission paths.

## 5. Service Role Exposure Risks
- High - the current member-file listing path uses a service-role read and returns all file metadata to any command-center viewer before clinical-category filtering.
  References: [`listMemberFilesPageSupabase()`](/D:/Memory%20Lane%20App/lib/services/member-command-center-runtime.ts:254), [`listMemberFilesPageAction()`](/D:/Memory%20Lane%20App/app/%28portal%29/operations/member-command-center/_actions/files.ts:188), [`MemberCommandCenterFileManager`](/D:/Memory%20Lane%20App/components/forms/member-command-center-file-manager.tsx:301).
  Why it matters: even though download is still category-gated, operations viewers can still see the names, categories, sources, and uploader details of clinical files.
- Low - no confirmed browser/client leak of `SUPABASE_SERVICE_ROLE_KEY`.
- Low - the deprecated compatibility path in [`lib/supabase/server.ts`](/D:/Memory%20Lane%20App/lib/supabase/server.ts:8) still exists, which makes service-role use less auditable than the named wrapper in [`lib/supabase/service-role.ts`](/D:/Memory%20Lane%20App/lib/supabase/service-role.ts:92).

## 6. Staff Role Boundary Violations
- High - the Intake Assessment index page is broader than the actual clinical workflow boundary.
  Why: the index page uses [`requireModuleAccess("health")`](/D:/Memory%20Lane%20App/app/%28portal%29/health/assessment/page.tsx:29), while the detail and action paths use [`requireRoles(CLINICAL_DOCUMENTATION_ACCESS_ROLES)`](/D:/Memory%20Lane%20App/app/%28portal%29/health/assessment/%5BassessmentId%5D/page.tsx:50).
  Business impact: staff with general health access can still see assessment workflow history that the workflow itself treats as clinical-only.
- High - care-plan creation still gates on nav/view access plus role, not explicit edit permission.
  Why: [`requireCarePlanAuthorizedUser()`](/D:/Memory%20Lane%20App/lib/services/care-plan-authorization.ts:27) calls [`requireNavItemAccess("/health/care-plans")`](/D:/Memory%20Lane%20App/lib/auth.ts:85), which defaults to `canView`, then narrows only by role.
- High - intake create/sign still uses role-only authorization and then performs service-role-backed writes.
  References: [`app/intake-actions.ts`](/D:/Memory%20Lane%20App/app/intake-actions.ts:157), [`app/intake-actions.ts`](/D:/Memory%20Lane%20App/app/intake-actions.ts:269), [`app/intake-actions.ts`](/D:/Memory%20Lane%20App/app/intake-actions.ts:290).
  Business impact: a nurse/admin with view-only or drifted permissions can still hit privileged clinical writes through the canonical intake path.

## 7. Token Replay / Public Endpoint Risks
- Confirmed safer than prior runs: POF and care-plan signing now appear replay-aware through consumed-token hashes and rotated tokens.
  References: [`lib/services/pof-esign-public.ts`](/D:/Memory%20Lane%20App/lib/services/pof-esign-public.ts:357), [`lib/services/pof-esign-public.ts`](/D:/Memory%20Lane%20App/lib/services/pof-esign-public.ts:414), [`lib/services/care-plan-esign-public.ts`](/D:/Memory%20Lane%20App/lib/services/care-plan-esign-public.ts:540), [`lib/services/care-plan-esign-public.ts`](/D:/Memory%20Lane%20App/lib/services/care-plan-esign-public.ts:594).
- Confirmed remaining risk: enrollment-packet completed downloads still allow expired parent-token reuse as described above.
- Hardening gap, not a confirmed bypass: POF and care-plan public signature flows still do not appear to have the same token/IP throttling and guard-failure logging depth now present in the enrollment-packet path.

## 8. Recommended Security Hardening Plan
1. Fix the current app-side leaks first: lock Intake Assessment index history to the clinical role boundary, require explicit `canEdit` for care-plan and intake write paths, and stop returning clinical file metadata to generic command-center viewers.
2. Replace the remaining `authenticated using (true)` read policies, starting with intake, physician orders, member health profiles, member notes/providers/equipment, and the billing tables.
3. Enable RLS on `sites`, `lookup_lists`, and `punches_linked_time_punch_review` so no table depends on implicit grant behavior.
4. Make enrollment-packet completed-download token issuance reject expired parent tokens, and move attempt throttling to an atomic database or RPC boundary.
5. After repo fixes land, verify the live Supabase project: deployed `pg_policies`, grants, RPC execute permissions, and storage bucket rules.

## 9. Suggested Codex Prompts to Fix Issues
- `Replace the remaining authenticated using (true) read policies on intake_assessments, assessment_responses, intake_assessment_signatures, physician_orders, member_health_profiles, member_providers, member_equipment, member_notes, and the billing execution tables with explicit role- and permission-aware predicates.`
- `Tighten the Intake Assessment index route so it uses the same CLINICAL_DOCUMENTATION_ACCESS_ROLES boundary as the assessment detail and action paths.`
- `Require explicit health canEdit permission for care-plan creation/signing and intake assessment create/sign flows instead of relying on nav canView or role-only checks.`
- `Refactor Member Command Center file listing so operations viewers cannot enumerate clinical file metadata; preserve download behavior for authorized clinical users and keep member_files reads on a server-only canonical path.`
- `Patch the enrollment-packet completed-download flow so expired parent tokens cannot mint new download tokens, and move public submit throttling to an atomic RPC or transaction-backed guard.`

## 10. Founder Summary: What changed since the last run
- Real progress happened in this workspace.
  - The repo now hardens the two privileged RPC execute grants in [`0214_privileged_rpc_execute_hardening.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0214_privileged_rpc_execute_hardening.sql:1).
  - New workspace migrations `0216` to `0218` tighten several operational, member-hold, billing-adjustment, and care-plan read boundaries.
  - The earlier health write-helper bug is fixed, and member-file uploads now validate size/type server-side.
- The biggest remaining problems are narrower than last run, but they are still meaningful:
  - older database read policies still let any authenticated staff user read too much;
  - current app code still has a few places where a broader staff role can see or trigger more than intended;
  - a completed enrollment packet can still generate a fresh download token from an expired parent token.
- New current-workspace risk: the paged Member Command Center file list now exposes clinical file metadata to broader operations viewers even though download itself is still gated.
