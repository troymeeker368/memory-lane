# Supabase RLS & Security Audit (2026-05-12)

Generated: 2026-05-12

Basis: repo and migration audit only. I did not verify the live Supabase project's deployed policies, grants, PostgREST RPC exposure, or storage rules.

## 1. Executive Summary
- The highest-risk problems are still at the database boundary, not the page boundary. Multiple `SECURITY DEFINER` RPCs are still callable by `authenticated` and still trust caller-supplied IDs and actor fields instead of validating the real database caller inside the function body.
- Three repo-defined tables still do not show `ENABLE ROW LEVEL SECURITY`: `public.sites`, `public.lookup_lists`, and `public.punches_linked_time_punch_review`.
- Broad legacy read or write policies are still open on intake, member-photo, member support, care-plan diagnosis/signature event, enrollment-packet staging/mapping, follow-up queue, locker history, and enrollment pricing tables.
- I found no confirmed browser/client exposure of `SUPABASE_SERVICE_ROLE_KEY`.
- Important correction from earlier runs: some older broad-policy findings were later hardened in newer migrations and should not stay on the open list. That includes `member_diagnoses`, `member_medications`, `provider_directory`, `hospital_preference_directory`, `attendance_records`, `closure_rules`, `center_closures`, and `enrollment_packet_field_conflicts`.
- Important refinement from earlier runs: the public enrollment packet upload flow is not accepting arbitrary file types with no validation. The current risk is that it uses a different, wider allowlist than the canonical internal member-file validator, so public uploads can still persist file types the normal internal path would reject.

## 2. Tables Missing RLS
- Confirmed missing repo-defined `ENABLE ROW LEVEL SECURITY`:
  - `public.sites` in `supabase/migrations/0001_initial_schema.sql:7`
  - `public.lookup_lists` in `supabase/migrations/0001_initial_schema.sql:312`
  - `public.punches_linked_time_punch_review` in `supabase/migrations/0017_reseed_schema_alignment.sql:9`
- I did not find later migrations enabling RLS on those three tables.
- Residual gap: the live Supabase project could differ if manual changes were applied outside migrations.

## 3. Overly Permissive Policies
- Critical: `intake_assessments` still allows broad authenticated reads and broad authenticated writes across staff roles. Reads are still `using (true)`, and writes are still open to `admin/manager/director/nurse/coordinator`. Sources: `supabase/migrations/0006_intake_pof_mhp_supabase.sql:175-177`, `supabase/migrations/0077_security_advisor_write_policy_hardening.sql:480-493`.
- High: `assessment_responses` still allows any authenticated user to read all rows at the database layer. Writes were tightened to `service_role`, but reads are still `using (true)`. Sources: `supabase/migrations/0006_intake_pof_mhp_supabase.sql:182`, `supabase/migrations/0077_security_advisor_write_policy_hardening.sql:33-46`.
- Critical: `intake_assessment_signatures` still allows broad authenticated read, insert, and update of signature rows. Source: `supabase/migrations/0022_intake_assessment_esign.sql:95-97`.
- High: `member_photo_uploads` still allows any authenticated user to read photo-upload rows through `auth.uid() is not null`, which is still cross-member exposure. Source: `supabase/migrations/0005_documentation_workflow_persistence.sql:58-63`, `supabase/migrations/0079_auth_rls_initplan_and_duplicate_index_cleanup.sql:143-149`.
- High: `member_providers`, `member_equipment`, and `member_notes` still allow broad authenticated reads across members, and their writes are still open to a wide staff-role set with no member-level ownership check. Sources: `supabase/migrations/0012_legacy_operational_health_alignment.sql:273-312`, `supabase/migrations/0077_security_advisor_write_policy_hardening.sql:540-601`.
- High: `care_plan_diagnoses` still allows broad authenticated read, insert, update, and delete. Source: `supabase/migrations/0085_care_plan_diagnosis_relation.sql:59-86`.
- Medium: `care_plan_signature_events` still allows broad authenticated read of internal signature workflow history. Insert was later tightened, but read scope is still wide. Sources: `supabase/migrations/0020_care_plan_canonical_esign.sql:83-90`, `supabase/migrations/0077_security_advisor_write_policy_hardening.sql:48-53`.
- High: `enrollment_packet_pof_staging`, `enrollment_packet_mapping_runs`, and `enrollment_packet_mapping_records` still allow broad authenticated reads of internal workflow state. Later migrations tightened writes to `service_role`, but not reads. Sources: `supabase/migrations/0027_enrollment_packet_intake_mapping.sql:153-178`, `supabase/migrations/0077_security_advisor_write_policy_hardening.sql:129-164`.
- Medium: `enrollment_packet_follow_up_queue` is still readable by any authenticated user. Source: `supabase/migrations/0110_enrollment_packet_follow_up_queue.sql:49-65`.
- Medium: `locker_assignment_history` still allows broad authenticated read and broad operational writes. Sources: `supabase/migrations/0040_locker_assignment_history.sql:19-24`, `supabase/migrations/0077_security_advisor_write_policy_hardening.sql:495-508`.
- Medium: `enrollment_pricing_community_fees` and `enrollment_pricing_daily_rates` still allow broad authenticated reads and writes. Source: `supabase/migrations/0026_enrollment_pricing_module.sql:58-73`.

## 4. Public Endpoint Risks
- Medium: public enrollment packet uploads are validated, but not by the canonical member-file validator. The public action allows `HEIC`, `HEIF`, `GIF`, and `TIFF`, while the internal member-file path does not. That means the public packet flow can persist file types your normal internal member-file upload path would reject. Sources: `app/sign/enrollment-packet/[token]/actions.ts:25-38`, `lib/services/member-files.ts:53-67`, `lib/services/enrollment-packets-public-runtime-artifacts.ts:165-179`.
- High: public enrollment packet submit throttling is still count-then-record, so concurrent attempts can still beat the limit window. Source: `lib/services/enrollment-packet-public-helpers.ts:245-330`.
- Medium: public POF and care-plan signature flows still do not show equivalent token/IP throttling before finalization work begins. I found replay-aware state checks, but not comparable rate-limit enforcement. Sources: `app/sign/pof/[token]/actions.ts:14-54`, `app/sign/care-plan/[token]/actions.ts:13-46`, `lib/services/pof-esign-public.ts:341-569`, `lib/services/care-plan-esign-public.ts:528-760`.
- Low: the internal retry routes are still protected by bearer secrets only. I did not find request signing, IP allowlisting, or explicit failed-attempt logging on these routes. Sources: `app/api/internal/pof-post-sign-sync/route.ts:65-82`, `app/api/internal/enrollment-packet-mapping-sync/route.ts:38-55`.

## 5. Service Role Exposure Risks
- Critical: `rpc_upsert_member_file_by_source` is still `SECURITY DEFINER`, still granted to `authenticated`, and can insert or update `member_files` for caller-supplied `p_member_id` without repo-visible caller validation. Source: `supabase/migrations/0073_delivery_and_member_file_rpc_hardening.sql:1028-1155`, `supabase/migrations/0073_delivery_and_member_file_rpc_hardening.sql:1224-1241`.
- Critical: `rpc_delete_member_file_record` is still `SECURITY DEFINER`, still granted to `authenticated`, and deletes by caller-supplied file ID without repo-visible caller validation. Source: `supabase/migrations/0073_delivery_and_member_file_rpc_hardening.sql:1157-1198`, `supabase/migrations/0073_delivery_and_member_file_rpc_hardening.sql:1243-1245`.
- Critical: `rpc_prepare_care_plan_caregiver_request` is still `SECURITY DEFINER`, still granted to `authenticated`, and resets caregiver request state and token fields from caller-supplied IDs and actor fields. Source: `supabase/migrations/0212_care_plan_caregiver_prepare_terminal_guard.sql:1-110`.
- Critical: enrollment-packet lifecycle RPCs are still `SECURITY DEFINER`, still granted to `authenticated`, and update packet state using caller-supplied packet IDs and actor metadata without repo-visible `auth.uid()` checks inside the function body. Sources: `supabase/migrations/0152_enrollment_packet_lifecycle_and_voiding.sql:291-733`, `supabase/migrations/0180_enrollment_completion_follow_up_state.sql:35-191`.
- High: POF delivery RPCs are still `SECURITY DEFINER`, still granted to `authenticated`, and update `pof_requests` and sometimes `physician_orders` using caller-supplied IDs and actor fields without repo-visible caller validation. Sources: `supabase/migrations/0073_delivery_and_member_file_rpc_hardening.sql:609-898`, `supabase/migrations/0082_fix_pof_delivery_state_rpc_ambiguity.sql:1-100`, `supabase/migrations/0098_false_failure_read_path_hardening.sql:17-159`.
- High: Member Command Center detail still loads the full member detail with `serviceRole: true` and only filters `detail.files` afterward in app code. Non-clinical users get a filtered response, but the privileged read already happened. Sources: `lib/services/member-command-center-detail-read-model.ts:334-345`, `lib/services/member-command-center-runtime.ts:278-289`.
- Low: the deprecated boolean `createClient({ serviceRole: true })` path still exists, which makes privileged access harder to audit than the named use-case wrapper. Source: `lib/supabase/server.ts:8-30`.
- No confirmed finding: I did not find the service-role key exposed in client/browser code.

## 6. Staff Role Boundary Violations
- Confirmed improvement: the Intake Assessment page now requires both health edit access and clinical documentation roles, and the intake action now requires `requireModuleAction("health", "canEdit")` before the privileged write path runs. Sources: `app/(portal)/health/assessment/page.tsx:31-32`, `app/intake-actions.ts:157-163`.
- High: despite that app-layer hardening, the database still allows broader access than the UI intends because `intake_assessments`, `assessment_responses`, and `intake_assessment_signatures` remain too open at the RLS layer.
- High: Member Command Center file detail still enforces the file-category boundary after the service-role read instead of at the database read boundary. Sources: `lib/services/member-command-center-detail-read-model.ts:334-345`, `lib/services/member-command-center-runtime.ts:278-289`.
- High: the authenticated-executable `SECURITY DEFINER` RPCs above still let a staff user bypass app-layer role checks entirely if they call Supabase directly instead of using your server actions.
- No new confirmed app-layer role-check regression was found in the reviewed physician-order or care-plan server actions. Those entry points still show explicit authorization helpers.

## 7. Token Replay / Public Endpoint Risks
- Confirmed fixed: active enrollment packet parent tokens now check expiry before the completed-state replay path runs, and the workspace includes a regression test for that case. Sources: `lib/services/enrollment-packets-public-runtime-context.ts`, `lib/services/enrollment-packets-public-runtime.ts`, `tests/enrollment-packet-expired-completed-token-guard.test.ts`.
- Medium: public enrollment packet submit throttling is still raceable under concurrency because the attempt count is read before the new attempt is recorded. Source: `lib/services/enrollment-packet-public-helpers.ts:245-330`.
- Medium: POF and care-plan public links look replay-aware after commit because consumed-token hashes are stored and terminal states are checked, but I still did not find comparable abuse throttling before expensive finalization work begins. Sources: `lib/services/pof-esign-public.ts:357-469`, `lib/services/care-plan-esign-public.ts:540-760`.
- Low: completed enrollment packet download tokens do have signed expiry enforcement. I did not confirm a new replay flaw in that download-token path. Sources: `lib/services/enrollment-packet-core.ts:265-329`, `lib/services/enrollment-packets-public-runtime-artifacts.ts:38-118`.

## 8. Recommended Security Hardening Plan
1. Revoke `authenticated` execute on the highest-risk `SECURITY DEFINER` RPCs first: member-file upsert/delete, care-plan caregiver request prep, enrollment-packet lifecycle/finalization, and POF delivery.
2. Tighten the remaining broad RLS policies on intake tables, signature tables, member-photo uploads, member support tables, care-plan diagnosis/signature-event tables, enrollment-packet staging/mapping tables, follow-up queue, locker history, and pricing tables.
3. Add RLS to `sites`, `lookup_lists`, and `punches_linked_time_punch_review`.
4. Reuse one canonical member-file upload allowlist in the public enrollment packet upload path instead of maintaining a second wider list.
5. Move enrollment packet submit throttling into an atomic claim/RPC path, then add similar token/IP throttling to public POF and care-plan signature flows.
6. Refactor Member Command Center detail loading so non-clinical users never hydrate clinical `member_files` rows before filtering.
7. Validate the live Supabase project against the repo because this audit could not confirm deployed grants, policies, or storage rules.

## 9. Suggested Codex Prompts to Fix Issues
- `Harden privileged Supabase RPC grants: revoke authenticated execute on rpc_upsert_member_file_by_source, rpc_delete_member_file_record, rpc_prepare_care_plan_caregiver_request, rpc_prepare_enrollment_packet_request, rpc_transition_enrollment_packet_delivery_state, rpc_save_enrollment_packet_progress, rpc_finalize_enrollment_packet_submission, rpc_void_enrollment_packet_request, rpc_prepare_pof_request_delivery, and rpc_transition_pof_request_delivery_state. Then align runtime callers to service-role-only access or add strict in-function auth.uid()/permission checks.`
- `Replace the remaining broad RLS policies on intake_assessments, assessment_responses, intake_assessment_signatures, member_photo_uploads, member_providers, member_equipment, member_notes, care_plan_signature_events, care_plan_diagnoses, enrollment_packet_pof_staging, enrollment_packet_mapping_runs, enrollment_packet_mapping_records, enrollment_packet_follow_up_queue, locker_assignment_history, and enrollment pricing tables with permission-aware predicates.`
- `Enable RLS on public.sites, public.lookup_lists, and public.punches_linked_time_punch_review and add explicit policies that match real runtime access.`
- `Unify public enrollment packet upload validation with the canonical member-files allowlist so external uploads cannot persist file types that the normal internal member-file path rejects.`
- `Move public enrollment packet submission throttling into an atomic Supabase claim/RPC path and add comparable token/IP throttling to public POF and care-plan signing flows.`
- `Refactor Member Command Center detail loading so non-clinical viewers never fetch privileged member_files rows before category filtering.`

## 10. Founder Summary: What Changed Since the Last Run
- No new migration-level RLS or RPC hardening landed in the workspace since the last run. The biggest database-boundary risks are still open.
- The previously improved app-layer intake hardening is still present in the current workspace:
  - `app/(portal)/health/assessment/page.tsx` requires health edit access plus clinical documentation roles.
  - `app/intake-actions.ts` requires health edit access before the privileged write path.
- The previously fixed enrollment-packet active-token expiry bug is still fixed, and the regression test is still present.
- This run corrected a few stale open findings from earlier audit memory:
  - `member_diagnoses`, `member_medications`, `provider_directory`, `hospital_preference_directory`, `attendance_records`, `closure_rules`, `center_closures`, and `enrollment_packet_field_conflicts` were later hardened and should not remain on the active-open list.
- This run also refined one earlier upload finding:
  - the public enrollment packet upload flow is not unvalidated,
  - the real problem is that it uses a different and wider allowlist than the canonical member-file upload path.
- Still open and most important:
  - authenticated-executable `SECURITY DEFINER` RPCs for member files, care-plan caregiver prep, enrollment-packet lifecycle, and POF delivery,
  - missing RLS on `sites`, `lookup_lists`, and `punches_linked_time_punch_review`,
  - broad intake/member-support/care-plan/enrollment-pricing/enrollment-follow-up policies,
  - raceable enrollment-packet throttling and missing comparable throttling on public POF/care-plan signing,
  - Member Command Center service-role file overfetch before filtering.
