# Supabase RLS & Security Audit (2026-04-23)

Generated: 2026-04-23

Basis: repo and migration audit only. I could not verify the live Supabase project's deployed `pg_policies`, grants, RPC execute permissions, or storage bucket rules from the repo alone.

## 1. Executive Summary
- Confirmed improvement: member-file RLS is meaningfully tighter in [0219_member_files_policy_permission_hardening.sql](/D:/Memory%20Lane%20App/supabase/migrations/0219_member_files_policy_permission_hardening.sql:1). Direct authenticated reads and writes of clinical file categories now require explicit health-unit permission instead of broad authenticated access.
- Confirmed improvement: billing execution read policies were tightened in [0220_billing_execution_read_policy_hardening.sql](/D:/Memory%20Lane%20App/supabase/migrations/0220_billing_execution_read_policy_hardening.sql:1), so the prior broad read issue on `billing_batches`, `billing_invoices`, `billing_invoice_lines`, `billing_coverages`, and `billing_export_jobs` is no longer a confirmed current finding.
- Confirmed improvement: execute on `rpc_get_operational_reliability_snapshot(...)` is now restricted to `service_role` in [0221_operational_reliability_rpc_execute_hardening.sql](/D:/Memory%20Lane%20App/supabase/migrations/0221_operational_reliability_rpc_execute_hardening.sql:1).
- Confirmed improvement: care-plan write actions now require `canEdit` through [app/care-plan-actions.ts](/D:/Memory%20Lane%20App/app/care-plan-actions.ts:116) and [lib/services/care-plan-authorization.ts](/D:/Memory%20Lane%20App/lib/services/care-plan-authorization.ts:27), so yesterday's care-plan action boundary issue is no longer confirmed.
- Confirmed improvement: the current member-file list action now suppresses clinical categories for non-clinical viewers before returning rows in [app/(portal)/operations/member-command-center/_actions/files.ts](/D:/Memory%20Lane%20App/app/(portal)/operations/member-command-center/_actions/files.ts:189).
- Highest current risks are now:
  1. broad `authenticated using (true)` read policies still expose intake, member-support, enrollment-mapping, transportation, and pricing tables across staff sessions;
  2. Intake Assessment still has a role-boundary mismatch between the history page and the clinical detail/action paths;
  3. `createAssessmentAction` still performs privileged clinical writes after role-only gating;
  4. a completed enrollment packet can still mint a fresh completed-packet download token from an expired parent token;
  5. public enrollment-packet throttling is still raceable because the count check and the claim/log write are not atomic.

## 2. Tables Missing RLS
- Low - `public.sites` is still created without repo-defined `ENABLE ROW LEVEL SECURITY`.
  Reference: [0001_initial_schema.sql](/D:/Memory%20Lane%20App/supabase/migrations/0001_initial_schema.sql:7)
- Low - `public.lookup_lists` is still created without repo-defined `ENABLE ROW LEVEL SECURITY`.
  Reference: [0001_initial_schema.sql](/D:/Memory%20Lane%20App/supabase/migrations/0001_initial_schema.sql:312)
- Low - `public.punches_linked_time_punch_review` is still created without repo-defined `ENABLE ROW LEVEL SECURITY`.
  Reference: [0017_reseed_schema_alignment.sql](/D:/Memory%20Lane%20App/supabase/migrations/0017_reseed_schema_alignment.sql:9)

## 3. Overly Permissive Policies
- High - clinical intake tables still allow any authenticated staff session to read cross-member assessment and signature data.
  Tables: `intake_assessments`, `assessment_responses`, `intake_assessment_signatures`
  References: [0006_intake_pof_mhp_supabase.sql](/D:/Memory%20Lane%20App/supabase/migrations/0006_intake_pof_mhp_supabase.sql:175), [0006_intake_pof_mhp_supabase.sql](/D:/Memory%20Lane%20App/supabase/migrations/0006_intake_pof_mhp_supabase.sql:182), [0022_intake_assessment_esign.sql](/D:/Memory%20Lane%20App/supabase/migrations/0022_intake_assessment_esign.sql:95)
- High - member-support tables still allow cross-member reads to any authenticated staff session.
  Tables: `member_providers`, `member_equipment`, `member_notes`, `locker_assignment_history`
  References: [0012_legacy_operational_health_alignment.sql](/D:/Memory%20Lane%20App/supabase/migrations/0012_legacy_operational_health_alignment.sql:273), [0012_legacy_operational_health_alignment.sql](/D:/Memory%20Lane%20App/supabase/migrations/0012_legacy_operational_health_alignment.sql:300), [0012_legacy_operational_health_alignment.sql](/D:/Memory%20Lane%20App/supabase/migrations/0012_legacy_operational_health_alignment.sql:309), [0040_locker_assignment_history.sql](/D:/Memory%20Lane%20App/supabase/migrations/0040_locker_assignment_history.sql:22)
- Medium - care-plan support tables still expose broad authenticated reads.
  Tables: `care_plan_signature_events`, `care_plan_diagnoses`
  References: [0020_care_plan_canonical_esign.sql](/D:/Memory%20Lane%20App/supabase/migrations/0020_care_plan_canonical_esign.sql:83), [0085_care_plan_diagnosis_relation.sql](/D:/Memory%20Lane%20App/supabase/migrations/0085_care_plan_diagnosis_relation.sql:60)
- Medium - enrollment-packet internal workflow tables still allow broad authenticated reads.
  Tables: `enrollment_packet_pof_staging`, `enrollment_packet_mapping_runs`, `enrollment_packet_mapping_records`, `enrollment_packet_follow_up_queue`
  References: [0027_enrollment_packet_intake_mapping.sql](/D:/Memory%20Lane%20App/supabase/migrations/0027_enrollment_packet_intake_mapping.sql:156), [0027_enrollment_packet_intake_mapping.sql](/D:/Memory%20Lane%20App/supabase/migrations/0027_enrollment_packet_intake_mapping.sql:166), [0027_enrollment_packet_intake_mapping.sql](/D:/Memory%20Lane%20App/supabase/migrations/0027_enrollment_packet_intake_mapping.sql:175), [0110_enrollment_packet_follow_up_queue.sql](/D:/Memory%20Lane%20App/supabase/migrations/0110_enrollment_packet_follow_up_queue.sql:49)
- Medium - transportation and related operational tables still allow broad authenticated reads.
  Tables: `bus_stop_directory`, `transportation_runs`, `transportation_run_results`
  References: [0011_member_command_center_aux_schema.sql](/D:/Memory%20Lane%20App/supabase/migrations/0011_member_command_center_aux_schema.sql:398), [0081_transportation_run_posting.sql](/D:/Memory%20Lane%20App/supabase/migrations/0081_transportation_run_posting.sql:148), [0081_transportation_run_posting.sql](/D:/Memory%20Lane%20App/supabase/migrations/0081_transportation_run_posting.sql:155)
- Medium - enrollment pricing tables are still readable by any authenticated staff session.
  Tables: `enrollment_pricing_community_fees`, `enrollment_pricing_daily_rates`
  References: [0026_enrollment_pricing_module.sql](/D:/Memory%20Lane%20App/supabase/migrations/0026_enrollment_pricing_module.sql:58), [0026_enrollment_pricing_module.sql](/D:/Memory%20Lane%20App/supabase/migrations/0026_enrollment_pricing_module.sql:68)

## 4. Public Endpoint Risks
- Medium - a completed enrollment packet can still mint a fresh completed-packet download token from an expired parent token.
  Why: [getPublicEnrollmentPacketContext()](/D:/Memory%20Lane%20App/lib/services/enrollment-packets-public-runtime-context.ts:205) returns `completed` before checking `token_expires_at`, and the confirmation page immediately calls [issuePublicCompletedEnrollmentPacketDownloadToken()](/D:/Memory%20Lane%20App/lib/services/enrollment-packets-public-runtime-artifacts.ts:85) through [app/sign/enrollment-packet/[token]/confirmation/page.tsx](/D:/Memory%20Lane%20App/app/sign/enrollment-packet/[token]/confirmation/page.tsx:66).
- Medium - public enrollment-packet submit throttling is still advisory rather than atomic.
  Why: [enforcePublicEnrollmentPacketSubmissionGuards()](/D:/Memory%20Lane%20App/lib/services/enrollment-packet-public-helpers.ts:196) counts recent attempts first and records the new `started` claim afterward, so concurrent requests can slip through the intended token/IP caps.
- No confirmed unauthenticated direct write bypass was found outside the intended token-based enrollment packet, care-plan, and POF signing flows. The remaining risk is weakness inside those token workflows, not a separate open public route.

## 5. Service Role Exposure Risks
- Medium - Member Command Center detail loading still hydrates the full `member_files` set with service role before app-side filtering removes clinical rows.
  Why it matters: the current page action now filters correctly, but the underlying detail helper still depends on downstream filtering instead of a permission-aware privileged query.
  References: [lib/services/member-command-center-runtime.ts](/D:/Memory%20Lane%20App/lib/services/member-command-center-runtime.ts:505), [lib/services/member-command-center-detail-read-model.ts](/D:/Memory%20Lane%20App/lib/services/member-command-center-detail-read-model.ts:333)
- Low - the deprecated compatibility path `createClient({ serviceRole: true })` still exists, which makes privileged usage less auditable than the named wrapper in `lib/supabase/service-role.ts`.
  References: [lib/supabase/server.ts](/D:/Memory%20Lane%20App/lib/supabase/server.ts:8), [lib/supabase/service-role.ts](/D:/Memory%20Lane%20App/lib/supabase/service-role.ts:92)
- Low - no confirmed browser/client exposure of `SUPABASE_SERVICE_ROLE_KEY` was found in the current workspace.

## 6. Staff Role Boundary Violations
- High - the Intake Assessment history page is still broader than the actual clinical workflow boundary.
  Why: the index page uses [requireModuleAccess("health")](/D:/Memory%20Lane%20App/app/(portal)/health/assessment/page.tsx:29), while the detail page requires [CLINICAL_DOCUMENTATION_ACCESS_ROLES](/D:/Memory%20Lane%20App/app/(portal)/health/assessment/[assessmentId]/page.tsx:50).
  Business impact: staff with general health access can still see assessment workflow history that the workflow itself treats as clinical-only.
- High - `createAssessmentAction` still uses role-only gating before privileged clinical writes.
  Why: the action checks only `isAuthorizedIntakeAssessmentSignerRole(profile.role)` in [app/intake-actions.ts](/D:/Memory%20Lane%20App/app/intake-actions.ts:157), then performs privileged signature finalization with `serviceRole: true` in [app/intake-actions.ts](/D:/Memory%20Lane%20App/app/intake-actions.ts:269) and [app/intake-actions.ts](/D:/Memory%20Lane%20App/app/intake-actions.ts:290).
  Business impact: a nurse/admin with drifted or view-only health permissions could still hit the canonical intake write path.
- No confirmed current care-plan write boundary issue: the current workspace now requires `canEdit` on care-plan actions.

## 7. Token Replay / Public Endpoint Risks
- Medium - the expired-parent-token completed-packet download issue remains open and is still the clearest replay-style risk in the public enrollment flow.
  References: [lib/services/enrollment-packets-public-runtime-context.ts](/D:/Memory%20Lane%20App/lib/services/enrollment-packets-public-runtime-context.ts:218), [lib/services/enrollment-packets-public-runtime-artifacts.ts](/D:/Memory%20Lane%20App/lib/services/enrollment-packets-public-runtime-artifacts.ts:88)
- Medium - public enrollment-packet throttling is still raceable under concurrent requests because counting and attempt claiming are not one atomic operation.
  Reference: [lib/services/enrollment-packet-public-helpers.ts](/D:/Memory%20Lane%20App/lib/services/enrollment-packet-public-helpers.ts:245)
- Low - POF and care-plan public signature links now look replay-aware through consumed-token hashes and rotated tokens, but I did not find equivalent token/IP throttling on those public submit paths.
  References: [lib/services/pof-esign-public.ts](/D:/Memory%20Lane%20App/lib/services/pof-esign-public.ts:357), [lib/services/care-plan-esign-public.ts](/D:/Memory%20Lane%20App/lib/services/care-plan-esign-public.ts:540)

## 8. Recommended Security Hardening Plan
1. Fix the enrollment-packet public workflow first: reject expired parent tokens before completed-download token minting, and move submit throttling to an atomic RPC or transaction-backed claim path.
2. Align Intake Assessment to one clinical boundary: lock the history page to the same clinical role set as the detail page, and require explicit health-unit `canEdit` before `createAssessmentAction` can do privileged writes.
3. Replace the remaining broad `authenticated using (true)` select policies, starting with intake tables, member-support tables, enrollment-packet mapping tables, transportation tables, and pricing tables.
4. Enable RLS on `sites`, `lookup_lists`, and `punches_linked_time_punch_review` so no table depends on grants alone.
5. Finish the service-role cleanup: move remaining boolean `serviceRole` compatibility calls to named use-case wrappers, and avoid service-role reads that rely on later app-side filtering.
6. After repo fixes land, verify the live Supabase project: deployed `pg_policies`, grants, RPC execute permissions, and storage bucket rules.

## 9. Suggested Codex Prompts to Fix Issues
- `Patch the enrollment packet completed-download flow so expired parent tokens cannot mint a new completed-packet download token. Keep the current completed-packet route public, but require a fresh valid parent-token context before issuing the short-lived download token.`
- `Move public enrollment packet submit throttling into an atomic Supabase RPC or transaction-backed claim path so concurrent requests cannot bypass the token/IP attempt caps. Preserve the existing workflow event logging and founder-readable error messages.`
- `Tighten Intake Assessment access so the history page uses the same CLINICAL_DOCUMENTATION_ACCESS_ROLES boundary as the detail/actions, and require explicit health-unit canEdit permission before createAssessmentAction can execute privileged intake writes.`
- `Replace the remaining broad authenticated using (true) select policies on intake_assessments, assessment_responses, intake_assessment_signatures, member_providers, member_equipment, member_notes, locker_assignment_history, bus_stop_directory, transportation_runs, transportation_run_results, enrollment_packet_pof_staging, enrollment_packet_mapping_runs, enrollment_packet_mapping_records, enrollment_packet_follow_up_queue, enrollment_pricing_community_fees, enrollment_pricing_daily_rates, care_plan_signature_events, and care_plan_diagnoses with explicit permission-aware predicates.`
- `Enable RLS on public.sites, public.lookup_lists, and public.punches_linked_time_punch_review, and add minimal safe policies that match their intended read/write boundaries instead of relying on grants alone.`
- `Remove the remaining deprecated createClient({ serviceRole: true }) compatibility path usage where feasible, and keep Member Command Center privileged file reads behind a permission-aware service boundary so non-clinical callers never hydrate clinical file rows.`

## 10. Founder Summary: What changed since the last run
- Real progress happened since yesterday.
  - Member-file RLS is now meaningfully tighter through migration `0219`.
  - Billing execution read policies are no longer broadly readable after migration `0220`.
  - The operational reliability snapshot RPC is now service-role-only after migration `0221`.
  - Care-plan write actions now require `canEdit`, which removes one of the prior app-side permission gaps.
  - The previous visible Member Command Center file-list leak is no longer confirmed on the current page/action path because non-clinical viewers now have clinical categories filtered out before rows are returned.
- The biggest remaining problems are now narrower and clearer.
  - Broad cross-member reads still exist on several intake, member-support, enrollment-mapping, transportation, pricing, and care-plan support tables.
  - Intake Assessment still has a mismatched clinical boundary between its history page and its detail/actions.
  - `createAssessmentAction` still relies on signer role rather than explicit edit permission before privileged clinical writes.
  - The enrollment packet public flow still has the expired completed-download token issue and the non-atomic throttling issue.
- Downgraded from last run, not fully gone: Member Command Center file access still uses service role under the hood, but the direct non-clinical metadata leak that was visible yesterday is not confirmed on the current UI path.
