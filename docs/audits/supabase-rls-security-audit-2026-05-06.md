# Supabase RLS & Security Audit (2026-05-06)

Generated: 2026-05-06

Basis: repo and migration audit only. I could not verify the live Supabase project's deployed `pg_policies`, grants, RPC execute permissions, storage bucket rules, or whether the newest local migrations have been applied in the hosted project.

## 1. Executive Summary
- Highest confirmed open risk remains Intake Assessment security. The core assessment tables still allow any authenticated staff session to read and write cross-member assessment data, while the app boundary is still looser on the history page than on the detail page.
- The public enrollment-packet flow is still the clearest anonymous abuse surface. The completed-packet download token can still be minted from an expired parent token, and submit throttling is still advisory rather than atomic under concurrent requests.
- Member Command Center still has one meaningful privileged-read smell: the detail read model hydrates full `member_files` rows with service role first, then filters clinical categories in app code afterward.
- I did not find a new browser/client exposure of `SUPABASE_SERVICE_ROLE_KEY`.
- Since the last run, the repo gained one meaningful repo-level improvement: [0223_transportation_and_bus_stop_policy_permission_hardening.sql](/D:/Memory%20Lane%20App/supabase/migrations/0223_transportation_and_bus_stop_policy_permission_hardening.sql) closes a prior broad-access finding for `transportation_runs`, `transportation_run_results`, and `bus_stop_directory` if that migration is applied to the live project.

## 2. Tables Missing RLS
- `public.sites` still has no repo-defined `ENABLE ROW LEVEL SECURITY`. Source: [0001_initial_schema.sql](/D:/Memory%20Lane%20App/supabase/migrations/0001_initial_schema.sql:7)
- `public.lookup_lists` still has no repo-defined `ENABLE ROW LEVEL SECURITY`. Source: [0001_initial_schema.sql](/D:/Memory%20Lane%20App/supabase/migrations/0001_initial_schema.sql:312)
- `public.punches_linked_time_punch_review` still has no repo-defined `ENABLE ROW LEVEL SECURITY`. Source: [0017_reseed_schema_alignment.sql](/D:/Memory%20Lane%20App/supabase/migrations/0017_reseed_schema_alignment.sql:9)

## 3. Overly Permissive Policies
- High: `intake_assessments` and `assessment_responses` still use broad authenticated `using (true)` / `with check (true)` policies. Any signed-in staff session can bypass the intended clinical boundary at the database layer. Source: [0006_intake_pof_mhp_supabase.sql](/D:/Memory%20Lane%20App/supabase/migrations/0006_intake_pof_mhp_supabase.sql:175)
- High: `intake_assessment_signatures` still allows broad authenticated reads and writes. That exposes signature artifacts and signer metadata too broadly. Source: [0022_intake_assessment_esign.sql](/D:/Memory%20Lane%20App/supabase/migrations/0022_intake_assessment_esign.sql:95)
- High: `member_photo_uploads` is still readable by any authenticated session. The later tweak changed it to “any signed-in user,” not to a permission-aware boundary. Source: [0005_documentation_workflow_persistence.sql](/D:/Memory%20Lane%20App/supabase/migrations/0005_documentation_workflow_persistence.sql:58), [0079_auth_rls_initplan_and_duplicate_index_cleanup.sql](/D:/Memory%20Lane%20App/supabase/migrations/0079_auth_rls_initplan_and_duplicate_index_cleanup.sql:143)
- High: `member_providers`, `member_equipment`, and `member_notes` still allow broad cross-member authenticated access. Source: [0012_legacy_operational_health_alignment.sql](/D:/Memory%20Lane%20App/supabase/migrations/0012_legacy_operational_health_alignment.sql:273)
- High: `enrollment_packet_pof_staging`, `enrollment_packet_mapping_runs`, and `enrollment_packet_mapping_records` still expose internal workflow rows too broadly. Source: [0027_enrollment_packet_intake_mapping.sql](/D:/Memory%20Lane%20App/supabase/migrations/0027_enrollment_packet_intake_mapping.sql:156)
- Medium: `enrollment_packet_follow_up_queue` is still broadly readable to authenticated staff. Source: [0110_enrollment_packet_follow_up_queue.sql](/D:/Memory%20Lane%20App/supabase/migrations/0110_enrollment_packet_follow_up_queue.sql:53)
- Medium: `care_plan_signature_events` and `care_plan_diagnoses` still have over-broad internal read/write rules compared with the hardened core care-plan tables. Source: [0020_care_plan_canonical_esign.sql](/D:/Memory%20Lane%20App/supabase/migrations/0020_care_plan_canonical_esign.sql:83), [0085_care_plan_diagnosis_relation.sql](/D:/Memory%20Lane%20App/supabase/migrations/0085_care_plan_diagnosis_relation.sql:60)
- Medium: `locker_assignment_history` is still broad to authenticated users. Source: [0040_locker_assignment_history.sql](/D:/Memory%20Lane%20App/supabase/migrations/0040_locker_assignment_history.sql:22)
- Medium: `enrollment_pricing_community_fees` and `enrollment_pricing_daily_rates` are still broadly readable and writable to authenticated users in the repo schema. Source: [0026_enrollment_pricing_module.sql](/D:/Memory%20Lane%20App/supabase/migrations/0026_enrollment_pricing_module.sql:58)

## 4. Public Endpoint Risks
- Medium: a completed enrollment packet can still mint a fresh completed-packet download token from an expired parent token. The context function returns `completed` before checking expiry, and the confirmation page immediately mints a download token from that completed state. Sources: [enrollment-packets-public-runtime-context.ts](/D:/Memory%20Lane%20App/lib/services/enrollment-packets-public-runtime-context.ts:218), [enrollment-packets-public-runtime-artifacts.ts](/D:/Memory%20Lane%20App/lib/services/enrollment-packets-public-runtime-artifacts.ts:85), [confirmation/page.tsx](/D:/Memory%20Lane%20App/app/sign/enrollment-packet/[token]/confirmation/page.tsx:66)
- Medium: public enrollment-packet submit throttling is still raceable. The code counts recent `started` attempts first and only logs the new `started` attempt after that check. Concurrent requests can slip through. Source: [enrollment-packet-public-helpers.ts](/D:/Memory%20Lane%20App/lib/services/enrollment-packet-public-helpers.ts:245)
- Low: POF and care-plan public signature flows are replay-aware after commit, but I did not find equivalent token/IP throttling there. Sources: [pof-esign-public.ts](/D:/Memory%20Lane%20App/lib/services/pof-esign-public.ts:360), [care-plan-esign-public.ts](/D:/Memory%20Lane%20App/lib/services/care-plan-esign-public.ts:543)
- Low: the internal retry endpoints are still protected by static bearer secrets only. I did not find IP allowlisting, signed request windows, or failed-attempt logging on those routes. Sources: [enrollment-packet-mapping-sync/route.ts](/D:/Memory%20Lane%20App/app/api/internal/enrollment-packet-mapping-sync/route.ts:1), [pof-post-sign-sync/route.ts](/D:/Memory%20Lane%20App/app/api/internal/pof-post-sign-sync/route.ts:1)

## 5. Service Role Exposure Risks
- Medium: Member Command Center detail loading still fetches `member_files` through service role before later filtering removes clinical categories for non-clinical viewers. Sources: [member-command-center-runtime.ts](/D:/Memory%20Lane%20App/lib/services/member-command-center-runtime.ts:278), [member-command-center-detail-read-model.ts](/D:/Memory%20Lane%20App/lib/services/member-command-center-detail-read-model.ts:286)
- Low: the deprecated compatibility path `createClient({ serviceRole: true })` still exists and is still used in several services. It is server-only, but it is less auditable than the named `createServiceRoleClient(useCase)` wrapper. Sources: [lib/supabase/server.ts](/D:/Memory%20Lane%20App/lib/supabase/server.ts), [lib/supabase/service-role.ts](/D:/Memory%20Lane%20App/lib/supabase/service-role.ts)
- Low: I found no confirmed client-side exposure of the service-role key in the workspace.

## 6. Staff Role Boundary Violations
- High: the Intake Assessment history page still uses broad `requireModuleAccess("health")`, while the detail page requires clinical documentation roles. Staff who can reach the history page may still see workflow history that the detail page treats as clinical-only. Sources: [app/(portal)/health/assessment/page.tsx](/D:/Memory%20Lane%20App/app/(portal)/health/assessment/page.tsx:29), [app/(portal)/health/assessment/[assessmentId]/page.tsx](/D:/Memory%20Lane%20App/app/(portal)/health/assessment/[assessmentId]/page.tsx:45)
- High: `createAssessmentAction` still gates on signer role only, then performs privileged service-role-backed writes. It does not require an explicit health-unit `canEdit` permission before escalation. Source: [app/intake-actions.ts](/D:/Memory%20Lane%20App/app/intake-actions.ts:151)
- No new confirmed care-plan write-boundary regression was found in the current workspace. The care-plan action layer still routes through `requireCarePlanAuthorizedUser("canEdit")`.

## 7. Token Replay / Public Endpoint Risks
- Medium: the expired-parent-token completed-packet download issue remains the clearest replay-style bug in the public workflow.
- Medium: public enrollment-packet submit throttling is still non-atomic and therefore bypassable under concurrency.
- Low: POF and care-plan public links still look replay-safe after a committed signature because they store consumed token hashes and rotate tokens, but they still lack explicit request throttling.

## 8. Recommended Security Hardening Plan
1. Fix the public enrollment-packet flow first: reject expired parent tokens before any completed-download token minting, and move submit throttling into an atomic RPC or transaction-backed claim path.
2. Tighten Intake Assessment end to end: replace the broad RLS on `intake_assessments`, `assessment_responses`, and `intake_assessment_signatures`, then align the history page and `createAssessmentAction` to the same clinical `canView` / `canEdit` boundary.
3. Remove service-role overfetch in Member Command Center detail reads so non-clinical views never hydrate clinical `member_files` rows in the first place.
4. Harden the remaining broad support tables next: `member_photo_uploads`, `member_providers`, `member_equipment`, `member_notes`, enrollment-packet staging/mapping tables, `enrollment_packet_follow_up_queue`, `care_plan_signature_events`, `care_plan_diagnoses`, `locker_assignment_history`, and the enrollment-pricing tables.
5. Enable RLS on `sites`, `lookup_lists`, and `punches_linked_time_punch_review`.
6. After repo fixes land, verify the live Supabase project for deployed policies, grants, RPC execute permissions, and storage bucket rules.

## 9. Suggested Codex Prompts to Fix Issues
- `Tighten Intake Assessment security end to end: replace the broad RLS policies on intake_assessments, assessment_responses, and intake_assessment_signatures with permission-aware predicates or service-only write paths, then align the history page and createAssessmentAction to the same clinical canView/canEdit boundary.`
- `Patch the enrollment packet completed-download flow so an expired parent token cannot mint a new completed-packet download token, and move public submit throttling into an atomic Supabase RPC or transaction-backed claim path so concurrent requests cannot bypass the token/IP caps.`
- `Refactor Member Command Center detail loading so non-clinical viewers never hydrate clinical member_files rows through service role before filtering. Preserve the safer paginated file-list behavior that already pushes category filtering into the query.`
- `Harden member_photo_uploads so authenticated users cannot broadly read member photo/document rows. Keep the documentation workflow working, but scope reads to the right internal roles or canonical service paths.`
- `Replace the remaining broad authenticated policies on member_providers, member_equipment, member_notes, enrollment_packet_pof_staging, enrollment_packet_mapping_runs, enrollment_packet_mapping_records, enrollment_packet_follow_up_queue, care_plan_signature_events, care_plan_diagnoses, locker_assignment_history, enrollment_pricing_community_fees, and enrollment_pricing_daily_rates with explicit permission-aware predicates or service-only write boundaries.`
- `Enable RLS on public.sites, public.lookup_lists, and public.punches_linked_time_punch_review, then add minimal safe policies that match their actual read/write boundary instead of relying on grants alone.`

## 10. Founder Summary: What Changed Since the Last Run
- No new top-tier regression was confirmed in the current workspace.
- The main open issues from the April 24 run are still open:
  - Intake Assessment tables are still too broad.
  - Intake Assessment history is still broader than the clinical detail page.
  - `createAssessmentAction` still escalates to privileged writes after role-only gating.
  - Expired enrollment-packet parent tokens can still mint completed-download tokens.
  - Public enrollment-packet throttling is still raceable.
  - Member Command Center detail still hydrates privileged file rows before filtering.
- One prior repo-level finding improved since the last run:
  - local migration [0223_transportation_and_bus_stop_policy_permission_hardening.sql](/D:/Memory%20Lane%20App/supabase/migrations/0223_transportation_and_bus_stop_policy_permission_hardening.sql) now hardens `transportation_runs`, `transportation_run_results`, and `bus_stop_directory` if it is applied in the hosted project.
- One non-RLS hardening step was added locally:
  - [0222_lead_activity_idempotency_hardening.sql](/D:/Memory%20Lane%20App/supabase/migrations/0222_lead_activity_idempotency_hardening.sql) adds a unique `idempotency_key` on `lead_activities`, which helps replay safety even though it does not close an RLS bug by itself.
- I also confirmed that some older concerns should no longer be reported as open repo issues because later migrations already replaced them:
  - `physician_orders`, `member_health_profiles`, `pof_requests`, `pof_signatures`, `document_events`, `member_contacts`, `member_command_centers`, and `schedule_changes` all have later hardening migrations in the repo.
