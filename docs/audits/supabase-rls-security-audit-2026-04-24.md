# Supabase RLS & Security Audit (2026-04-24)

Generated: 2026-04-24

Basis: repo and migration audit only. I could not verify the live Supabase project's deployed `pg_policies`, grants, RPC execute permissions, or storage bucket rules from the repo alone.

## 1. Executive Summary
- No new confirmed regression was introduced by the current `0216` to `0221` migration set. Those files are still net improvements.
- Confirmed improvement carried forward: operational read hardening landed for attendance, closures, billing settings, payors, and related operations tables in [0216_operational_read_policy_permission_hardening.sql](/D:/Memory%20Lane%20App/supabase/migrations/0216_operational_read_policy_permission_hardening.sql:1) and [0217_member_holds_and_billing_adjustments_read_policy_hardening.sql](/D:/Memory%20Lane%20App/supabase/migrations/0217_member_holds_and_billing_adjustments_read_policy_hardening.sql:1).
- Confirmed improvement carried forward: core care-plan tables were tightened in [0218_care_plan_policy_permission_hardening.sql](/D:/Memory%20Lane%20App/supabase/migrations/0218_care_plan_policy_permission_hardening.sql:1).
- Confirmed improvement carried forward: direct `member_files` access is materially tighter in [0219_member_files_policy_permission_hardening.sql](/D:/Memory%20Lane%20App/supabase/migrations/0219_member_files_policy_permission_hardening.sql:1).
- Confirmed improvement carried forward: billing execution reads were tightened in [0220_billing_execution_read_policy_hardening.sql](/D:/Memory%20Lane%20App/supabase/migrations/0220_billing_execution_read_policy_hardening.sql:1).
- Confirmed improvement carried forward: `rpc_get_operational_reliability_snapshot(...)` execute is now restricted to `service_role` in [0221_operational_reliability_rpc_execute_hardening.sql](/D:/Memory%20Lane%20App/supabase/migrations/0221_operational_reliability_rpc_execute_hardening.sql:1).
- Highest current risks are now:
  1. Intake Assessment tables still allow any authenticated staff session to read and write cross-member assessment and signature data.
  2. Several older support tables still use broad authenticated policies, including member photo uploads, member support tables, enrollment packet staging/mapping tables, care-plan support tables, transportation run tables, pricing tables, and locker history.
  3. The Intake Assessment app boundary is still inconsistent: the history page is broader than the detail/action boundary, and `createAssessmentAction` still does privileged writes after role-only gating.
  4. The public enrollment-packet flow still has two meaningful abuse risks: an expired parent token can still mint a new completed-packet download token, and submit throttling is still raceable under concurrent requests.
  5. Member Command Center detail loading still hydrates full member-file rows with service role before later filtering removes clinical categories.

## 2. Tables Missing RLS
- Medium - `public.sites` is still created without repo-defined `ENABLE ROW LEVEL SECURITY`.
  Reference: [0001_initial_schema.sql](/D:/Memory%20Lane%20App/supabase/migrations/0001_initial_schema.sql:7)
- Medium - `public.lookup_lists` is still created without repo-defined `ENABLE ROW LEVEL SECURITY`.
  Reference: [0001_initial_schema.sql](/D:/Memory%20Lane%20App/supabase/migrations/0001_initial_schema.sql:312)
- Medium - `public.punches_linked_time_punch_review` is still created without repo-defined `ENABLE ROW LEVEL SECURITY`.
  Reference: [0017_reseed_schema_alignment.sql](/D:/Memory%20Lane%20App/supabase/migrations/0017_reseed_schema_alignment.sql:9)

## 3. Overly Permissive Policies
- High - Intake Assessment core tables still allow broad authenticated reads and writes across members.
  Tables: `intake_assessments`, `assessment_responses`
  Why it matters: any authenticated staff session can bypass the intended clinical boundary and directly read or mutate assessment data through Supabase if it has a valid session.
  References: [0006_intake_pof_mhp_supabase.sql](/D:/Memory%20Lane%20App/supabase/migrations/0006_intake_pof_mhp_supabase.sql:175), [0006_intake_pof_mhp_supabase.sql](/D:/Memory%20Lane%20App/supabase/migrations/0006_intake_pof_mhp_supabase.sql:176), [0006_intake_pof_mhp_supabase.sql](/D:/Memory%20Lane%20App/supabase/migrations/0006_intake_pof_mhp_supabase.sql:177), [0006_intake_pof_mhp_supabase.sql](/D:/Memory%20Lane%20App/supabase/migrations/0006_intake_pof_mhp_supabase.sql:182), [0006_intake_pof_mhp_supabase.sql](/D:/Memory%20Lane%20App/supabase/migrations/0006_intake_pof_mhp_supabase.sql:183), [0006_intake_pof_mhp_supabase.sql](/D:/Memory%20Lane%20App/supabase/migrations/0006_intake_pof_mhp_supabase.sql:184)
- High - `intake_assessment_signatures` still allows broad authenticated reads and writes.
  Why it matters: signature artifacts and signer metadata are sensitive clinical records and should not be globally reachable to any signed-in staff session.
  References: [0022_intake_assessment_esign.sql](/D:/Memory%20Lane%20App/supabase/migrations/0022_intake_assessment_esign.sql:95), [0022_intake_assessment_esign.sql](/D:/Memory%20Lane%20App/supabase/migrations/0022_intake_assessment_esign.sql:96), [0022_intake_assessment_esign.sql](/D:/Memory%20Lane%20App/supabase/migrations/0022_intake_assessment_esign.sql:97)
- High - `member_photo_uploads` is still readable by any authenticated user.
  Why it matters: this is member document/photo data, and the current policy does not enforce member scoping or staff permission scoping at the database layer.
  References: [0005_documentation_workflow_persistence.sql](/D:/Memory%20Lane%20App/supabase/migrations/0005_documentation_workflow_persistence.sql:58), [0005_documentation_workflow_persistence.sql](/D:/Memory%20Lane%20App/supabase/migrations/0005_documentation_workflow_persistence.sql:59)
- High - member support tables still allow broad cross-member reads and writes.
  Tables: `member_providers`, `member_equipment`, `member_notes`
  Why it matters: these rows contain member-specific operational and health-support context but still use `using (true)` / `with check (true)`.
  References: [0012_legacy_operational_health_alignment.sql](/D:/Memory%20Lane%20App/supabase/migrations/0012_legacy_operational_health_alignment.sql:273), [0012_legacy_operational_health_alignment.sql](/D:/Memory%20Lane%20App/supabase/migrations/0012_legacy_operational_health_alignment.sql:300), [0012_legacy_operational_health_alignment.sql](/D:/Memory%20Lane%20App/supabase/migrations/0012_legacy_operational_health_alignment.sql:309)
- High - enrollment packet staging and mapping tables still expose internal workflow rows broadly to authenticated staff sessions.
  Tables: `enrollment_packet_pof_staging`, `enrollment_packet_mapping_runs`, `enrollment_packet_mapping_records`
  Why it matters: these tables contain internal packet-processing and downstream handoff state that should be restricted to specific staff roles or service-only paths.
  References: [0027_enrollment_packet_intake_mapping.sql](/D:/Memory%20Lane%20App/supabase/migrations/0027_enrollment_packet_intake_mapping.sql:156), [0027_enrollment_packet_intake_mapping.sql](/D:/Memory%20Lane%20App/supabase/migrations/0027_enrollment_packet_intake_mapping.sql:166), [0027_enrollment_packet_intake_mapping.sql](/D:/Memory%20Lane%20App/supabase/migrations/0027_enrollment_packet_intake_mapping.sql:175)
- Medium - `enrollment_packet_follow_up_queue` is still readable by any authenticated staff session.
  Why it matters: this queue contains internal retry/follow-up workflow state and should not be broadly visible.
  References: [0110_enrollment_packet_follow_up_queue.sql](/D:/Memory%20Lane%20App/supabase/migrations/0110_enrollment_packet_follow_up_queue.sql:49), [0110_enrollment_packet_follow_up_queue.sql](/D:/Memory%20Lane%20App/supabase/migrations/0110_enrollment_packet_follow_up_queue.sql:53)
- Medium - care-plan support tables still expose overly broad reads.
  Tables: `care_plan_signature_events`, `care_plan_diagnoses`
  Why it matters: these are still sensitive workflow-support records tied to clinical plans and should not be readable by any signed-in staff session.
  References: [0020_care_plan_canonical_esign.sql](/D:/Memory%20Lane%20App/supabase/migrations/0020_care_plan_canonical_esign.sql:83), [0085_care_plan_diagnosis_relation.sql](/D:/Memory%20Lane%20App/supabase/migrations/0085_care_plan_diagnosis_relation.sql:60)
- Medium - several operational support tables still use broad authenticated access.
  Tables: `bus_stop_directory`, `transportation_runs`, `transportation_run_results`, `locker_assignment_history`
  Why it matters: these are lower sensitivity than signature tables, but they still allow cross-staff access that is broader than the current permission model.
  References: [0011_member_command_center_aux_schema.sql](/D:/Memory%20Lane%20App/supabase/migrations/0011_member_command_center_aux_schema.sql:398), [0081_transportation_run_posting.sql](/D:/Memory%20Lane%20App/supabase/migrations/0081_transportation_run_posting.sql:148), [0081_transportation_run_posting.sql](/D:/Memory%20Lane%20App/supabase/migrations/0081_transportation_run_posting.sql:155), [0040_locker_assignment_history.sql](/D:/Memory%20Lane%20App/supabase/migrations/0040_locker_assignment_history.sql:22)
- Medium - enrollment pricing tables are still readable and writable by any authenticated user.
  Tables: `enrollment_pricing_community_fees`, `enrollment_pricing_daily_rates`
  Why it matters: pricing is an admin/operations surface, not a general authenticated-user surface.
  References: [0026_enrollment_pricing_module.sql](/D:/Memory%20Lane%20App/supabase/migrations/0026_enrollment_pricing_module.sql:58), [0026_enrollment_pricing_module.sql](/D:/Memory%20Lane%20App/supabase/migrations/0026_enrollment_pricing_module.sql:68)

## 4. Public Endpoint Risks
- Medium - a completed enrollment packet can still mint a fresh completed-packet download token from an expired parent token.
  Why: [getPublicEnrollmentPacketContext()](/D:/Memory%20Lane%20App/lib/services/enrollment-packets-public-runtime-context.ts:218) returns `completed` before checking expiry at [lib/services/enrollment-packets-public-runtime-context.ts](/D:/Memory%20Lane%20App/lib/services/enrollment-packets-public-runtime-context.ts:240), and [issuePublicCompletedEnrollmentPacketDownloadToken()](/D:/Memory%20Lane%20App/lib/services/enrollment-packets-public-runtime-artifacts.ts:80) trusts that completed context.
- Medium - public enrollment-packet submit throttling is still advisory rather than atomic.
  Why: the code counts recent `started` attempts first at [lib/services/enrollment-packet-public-helpers.ts](/D:/Memory%20Lane%20App/lib/services/enrollment-packet-public-helpers.ts:245) and only records the new `started` event later at [lib/services/enrollment-packet-public-helpers.ts](/D:/Memory%20Lane%20App/lib/services/enrollment-packet-public-helpers.ts:296). Concurrent requests can still slip through that gap.
- No confirmed unauthenticated direct write bypass was found outside the intended token-based enrollment packet, care-plan, and POF flows. The current public risk is weakness inside the intended token workflows, not a separate open public route.

## 5. Service Role Exposure Risks
- Medium - Member Command Center detail loading still hydrates full `member_files` rows through service role before later filtering removes clinical categories.
  Why it matters: the current paged file list action is safer because it now pushes the category filter into the query, but the deeper detail helper still depends on app-side filtering after privileged hydration.
  References: [lib/services/member-command-center-runtime.ts](/D:/Memory%20Lane%20App/lib/services/member-command-center-runtime.ts:278), [lib/services/member-command-center-runtime.ts](/D:/Memory%20Lane%20App/lib/services/member-command-center-runtime.ts:287), [lib/services/member-command-center-detail-read-model.ts](/D:/Memory%20Lane%20App/lib/services/member-command-center-detail-read-model.ts:331), [lib/services/member-command-center-detail-read-model.ts](/D:/Memory%20Lane%20App/lib/services/member-command-center-detail-read-model.ts:341), [app/(portal)/operations/member-command-center/_actions/files.ts](/D:/Memory%20Lane%20App/app/(portal)/operations/member-command-center/_actions/files.ts:209)
- Low - the deprecated compatibility path `createClient({ serviceRole: true })` still exists.
  Why it matters: it is server-only, but it is less auditable than the named wrapper in `lib/supabase/service-role.ts`.
  References: [lib/supabase/server.ts](/D:/Memory%20Lane%20App/lib/supabase/server.ts:14), [lib/supabase/server.ts](/D:/Memory%20Lane%20App/lib/supabase/server.ts:20), [lib/supabase/service-role.ts](/D:/Memory%20Lane%20App/lib/supabase/service-role.ts:92)
- Low - no confirmed browser/client exposure of `SUPABASE_SERVICE_ROLE_KEY` was found in the current workspace.

## 6. Staff Role Boundary Violations
- High - the Intake Assessment history page is still broader than the actual clinical workflow boundary.
  Why: the index page uses [requireModuleAccess("health")](/D:/Memory%20Lane%20App/app/(portal)/health/assessment/page.tsx:29), while the detail page uses [CLINICAL_DOCUMENTATION_ACCESS_ROLES](/D:/Memory%20Lane%20App/app/(portal)/health/assessment/[assessmentId]/page.tsx:50).
  Business impact: staff with general health access can still see workflow history that the detail and action paths treat as clinical-only.
- High - `createAssessmentAction` still uses role-only gating before privileged clinical writes.
  Why: the action checks only signer role at [app/intake-actions.ts](/D:/Memory%20Lane%20App/app/intake-actions.ts:158), then performs service-role-backed writes at [app/intake-actions.ts](/D:/Memory%20Lane%20App/app/intake-actions.ts:269) and [app/intake-actions.ts](/D:/Memory%20Lane%20App/app/intake-actions.ts:290).
  Business impact: a nurse/admin with drifted or view-only health permissions could still hit the privileged intake write path.
- No confirmed current care-plan write boundary issue: the current workspace still requires `canEdit` for care-plan actions, so the April 21 care-plan action finding remains closed.

## 7. Token Replay / Public Endpoint Risks
- Medium - the expired-parent-token completed-packet download issue remains open and is still the clearest replay-style risk in the public enrollment flow.
  References: [lib/services/enrollment-packets-public-runtime-context.ts](/D:/Memory%20Lane%20App/lib/services/enrollment-packets-public-runtime-context.ts:218), [lib/services/enrollment-packets-public-runtime-artifacts.ts](/D:/Memory%20Lane%20App/lib/services/enrollment-packets-public-runtime-artifacts.ts:80)
- Medium - public enrollment-packet throttling is still raceable under concurrent requests because counting and attempt logging are not one atomic operation.
  Reference: [lib/services/enrollment-packet-public-helpers.ts](/D:/Memory%20Lane%20App/lib/services/enrollment-packet-public-helpers.ts:245)
- Low - POF and care-plan public signature flows still look replay-aware through consumed-token hashes and rotated tokens, but I did not find equivalent token/IP throttling there.
  References: [lib/services/pof-esign-public.ts](/D:/Memory%20Lane%20App/lib/services/pof-esign-public.ts:360), [lib/services/pof-esign-public.ts](/D:/Memory%20Lane%20App/lib/services/pof-esign-public.ts:414), [lib/services/care-plan-esign-public.ts](/D:/Memory%20Lane%20App/lib/services/care-plan-esign-public.ts:543), [lib/services/care-plan-esign-public.ts](/D:/Memory%20Lane%20App/lib/services/care-plan-esign-public.ts:594)

## 8. Recommended Security Hardening Plan
1. Fix the public enrollment-packet flow first: reject expired parent tokens before completed-download token minting, and move submit throttling to an atomic RPC or transaction-backed claim path.
2. Tighten Intake Assessment at both layers:
   - replace the broad `using (true)` / `with check (true)` RLS on assessment tables and signature tables;
   - align the history page to the same clinical boundary as the detail page;
   - require explicit health-unit `canEdit` before `createAssessmentAction` can perform privileged writes.
3. Harden the remaining legacy support tables that still expose broad authenticated access, starting with `member_photo_uploads`, `member_providers`, `member_equipment`, `member_notes`, `care_plan_signature_events`, `care_plan_diagnoses`, and the enrollment packet staging/mapping tables.
4. Tighten the lower-sensitivity but still over-broad operational tables: `bus_stop_directory`, `transportation_runs`, `transportation_run_results`, `locker_assignment_history`, and the enrollment pricing tables.
5. Enable RLS on `sites`, `lookup_lists`, and `punches_linked_time_punch_review` so no table depends on grants alone.
6. After repo fixes land, verify the live Supabase project: deployed `pg_policies`, grants, RPC execute permissions, and storage bucket rules.

## 9. Suggested Codex Prompts to Fix Issues
- `Tighten Intake Assessment security end to end: replace the broad RLS policies on intake_assessments, assessment_responses, and intake_assessment_signatures with permission-aware predicates or service-only write paths, then align the history page and createAssessmentAction to the same clinical canView/canEdit boundary.`
- `Patch the enrollment packet completed-download flow so an expired parent token cannot mint a new completed-packet download token, and move public submit throttling into an atomic Supabase RPC or transaction-backed claim path so concurrent requests cannot bypass the token/IP caps.`
- `Harden member_photo_uploads so authenticated users cannot broadly read member photo/document rows. Keep the intended documentation workflow working, but scope reads and writes to the right internal roles or canonical service paths.`
- `Replace the remaining broad authenticated policies on member_providers, member_equipment, member_notes, care_plan_signature_events, care_plan_diagnoses, enrollment_packet_pof_staging, enrollment_packet_mapping_runs, enrollment_packet_mapping_records, enrollment_packet_follow_up_queue, transportation_runs, transportation_run_results, locker_assignment_history, enrollment_pricing_community_fees, and enrollment_pricing_daily_rates with explicit permission-aware predicates.`
- `Enable RLS on public.sites, public.lookup_lists, and public.punches_linked_time_punch_review, then add minimal safe policies that match their actual read/write boundary instead of relying on grants alone.`
- `Refactor Member Command Center privileged file reads so non-clinical detail loads never hydrate clinical member-file rows before filtering. Preserve the safer paged list behavior that already pushes category filtering into the query.`

## 10. Founder Summary: What changed since the last run
- No new confirmed regression showed up versus the April 23 audit. The previously identified improvements still hold: member-file RLS is tighter, billing execution reads are tighter, the operational reliability snapshot RPC is now service-role-only, and the care-plan core tables remain more constrained.
- The main open app-layer issues from April 23 are still open:
  - Intake Assessment history is still broader than the clinical detail/action boundary.
  - `createAssessmentAction` still does privileged writes after role-only gating.
  - The completed enrollment-packet download token can still be minted from an expired parent token.
  - Public enrollment-packet throttling is still raceable.
  - Member Command Center detail loading still relies on privileged file hydration followed by app-side filtering.
- The biggest change in this run is deeper schema confirmation:
  - I confirmed `member_photo_uploads` is still readable by any authenticated user.
  - I confirmed the Intake Assessment RLS problem is broader than yesterday’s wording implied: those tables still allow broad authenticated writes, not just reads.
  - I confirmed older broad policies are still present on several support tables that were not the main focus of the April 23 writeup, especially enrollment packet staging/mapping tables, care-plan support tables, transportation runs, pricing tables, and locker history.
