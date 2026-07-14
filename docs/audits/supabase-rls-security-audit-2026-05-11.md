# Supabase RLS & Security Audit (2026-05-11)

Generated: 2026-05-11

Basis: repo and migration audit only. I did not verify the live Supabase project's deployed policies, grants, PostgREST RPC exposure, or storage rules.

## 1. Executive Summary
- The most serious risk is still below the UI, at the database boundary. Multiple `SECURITY DEFINER` RPCs are still executable by `authenticated` and trust caller-supplied record IDs and actor fields instead of validating the real caller inside the function body. A signed-in user who can call Supabase RPCs directly could bypass app-layer role checks.
- Broad legacy RLS policies still allow cross-member reads in intake, member photos, member support tables, care-plan events/diagnoses, enrollment-packet internal workflow tables, pricing tables, locker history, and the enrollment follow-up queue.
- The public enrollment packet token-expiry bug remains fixed in code, and there is now a regression test covering it. That part is safer than before.
- Newly confirmed in this pass: the public enrollment packet upload artifact path does not enforce the internal member-file MIME allowlist. That means an external packet submitter can persist arbitrary file types into protected storage/member files if they have a valid packet link.

## 2. Tables Missing RLS
- Confirmed missing repo-defined `ENABLE ROW LEVEL SECURITY`:
  - `public.sites` from `supabase/migrations/0001_initial_schema.sql:7`
  - `public.lookup_lists` from `supabase/migrations/0001_initial_schema.sql:312`
  - `public.punches_linked_time_punch_review` from `supabase/migrations/0017_reseed_schema_alignment.sql:9`
- I did not find repo-defined RLS enablement for those tables in the audited migrations.
- Residual validation gap: the live Supabase project might differ from the repo if manual changes were made outside migrations.

## 3. Overly Permissive Policies
- High: `intake_assessments` and `assessment_responses` still use `to authenticated using (true)` / `with check (true)` policies, which means any signed-in user can broadly read and write intake rows at the database layer. Source: `supabase/migrations/0006_intake_pof_mhp_supabase.sql:175-184`.
- High: `intake_assessment_signatures` is still broadly readable to any signed-in user. Source: `supabase/migrations/0022_intake_assessment_esign.sql:95-97`.
- High: `member_photo_uploads` still allows read access to any signed-in user through `auth.uid() is not null`, which is still cross-member PHI exposure. Source: `supabase/migrations/0005_documentation_workflow_persistence.sql:57-59`.
- High: `member_providers`, `member_equipment`, and `member_notes` still use open authenticated read/write policies. Source: `supabase/migrations/0012_legacy_operational_health_alignment.sql:273-312`.
- High: `enrollment_packet_pof_staging`, `enrollment_packet_mapping_runs`, `enrollment_packet_mapping_records`, and `enrollment_packet_field_conflicts` still expose internal workflow rows broadly to authenticated users. Source: `supabase/migrations/0027_enrollment_packet_intake_mapping.sql:147-188`.
- Medium: `care_plan_signature_events` and `care_plan_diagnoses` still expose broad internal reads. Sources: `supabase/migrations/0020_care_plan_canonical_esign.sql:81-86`, `supabase/migrations/0085_care_plan_diagnosis_relation.sql:59-63`.
- Medium: `locker_assignment_history` is still broadly readable and writable across members. Source: `supabase/migrations/0040_locker_assignment_history.sql:19-24`.
- Medium: `enrollment_pricing_community_fees` and `enrollment_pricing_daily_rates` still allow broad authenticated reads. Source: `supabase/migrations/0026_enrollment_pricing_module.sql:55-73`.
- Medium: `enrollment_packet_follow_up_queue` is still readable by any authenticated user. Source: `supabase/migrations/0110_enrollment_packet_follow_up_queue.sql:49-53`.

## 4. Public Endpoint Risks
- High: public enrollment packet uploads do not appear to enforce the internal member-file allowlist. The public artifact path forwards `input.contentType` directly into storage and member-file persistence, while the normal member-file flow has an explicit allowlist check. Sources: `lib/services/enrollment-packet-artifacts.ts:104`, `lib/services/enrollment-packet-artifacts.ts:333-350`, `lib/services/member-files.ts:53`, `lib/services/member-files.ts:158-176`, `lib/services/member-files.ts:631`.
- High: public enrollment packet throttling is still count-then-record, so concurrent submissions can beat the limit window. Source: `lib/services/enrollment-packet-public-helpers.ts:245-314`.
- Medium: I still did not find comparable token/IP throttling in the public POF or care-plan signature flows. The code records IP/user-agent metadata, but I did not find equivalent rate-limit enforcement. Sources: `lib/services/pof-esign-public.ts`, `lib/services/care-plan-esign-public.ts`.
- Low: the internal retry routes are still protected by bearer secrets only. I did not find request signing, IP allowlisting, or explicit failed-attempt logging on these routes. Sources: `app/api/internal/pof-post-sign-sync/route.ts:66-81`, `app/api/internal/enrollment-packet-mapping-sync/route.ts:39-54`.
- No confirmed finding: I did not find a separate anonymous member-file upload route outside the intended public enrollment packet workflow.

## 5. Service Role Exposure Risks
- Critical: `rpc_delete_member_file_record` is still `SECURITY DEFINER`, still granted to `authenticated`, and deletes by caller-supplied file ID without repo-visible caller validation. A signed-in user could likely delete another member's file row by direct RPC call. Source: `supabase/migrations/0073_delivery_and_member_file_rpc_hardening.sql:1157-1196`, `supabase/migrations/0073_delivery_and_member_file_rpc_hardening.sql:1243-1245`.
- Critical: `rpc_upsert_member_file_by_source` is still `SECURITY DEFINER`, still granted to `authenticated`, and inserts/updates `member_files` for caller-supplied `p_member_id` and metadata without repo-visible caller validation. A signed-in user could likely create or overwrite file records across members by direct RPC call. Source: `supabase/migrations/0073_delivery_and_member_file_rpc_hardening.sql:1028-1148`, `supabase/migrations/0073_delivery_and_member_file_rpc_hardening.sql:1224-1241`.
- Critical: `rpc_prepare_care_plan_caregiver_request` is still `SECURITY DEFINER`, still granted to `authenticated`, and resets caregiver request state and tokens based on caller-supplied IDs rather than the authenticated database caller. Source: `supabase/migrations/0212_care_plan_caregiver_prepare_terminal_guard.sql:1-97`, `supabase/migrations/0212_care_plan_caregiver_prepare_terminal_guard.sql:99-110`.
- Critical: enrollment packet lifecycle RPCs are still granted to `authenticated`, including progress save, finalization, delivery-state transition, and voiding. The function bodies I spot-checked update packet rows using caller-supplied packet/actor fields and I did not find repo-visible in-function caller validation. Sources: `supabase/migrations/0152_enrollment_packet_lifecycle_and_voiding.sql:291-379`, `supabase/migrations/0152_enrollment_packet_lifecycle_and_voiding.sql:381-476`, `supabase/migrations/0180_enrollment_completion_follow_up_state.sql:35-191`, `supabase/migrations/0152_enrollment_packet_lifecycle_and_voiding.sql:633-733`.
- High: POF delivery RPCs are still `SECURITY DEFINER` and still granted to `authenticated`, including request preparation and delivery-state transitions that can also update `physician_orders`. I spot-checked the bodies and did not find repo-visible caller validation inside the functions. Sources: `supabase/migrations/0073_delivery_and_member_file_rpc_hardening.sql:609-883`, `supabase/migrations/0082_fix_pof_delivery_state_rpc_ambiguity.sql:1-100`, `supabase/migrations/0098_false_failure_read_path_hardening.sql:17-159`.
- High: Member Command Center detail still hydrates full member-file rows with service-role access before app-layer filtering. Non-clinical viewers are protected in the UI response, but the privileged read happens first. Sources: `lib/services/member-command-center-detail-read-model.ts:334`, `lib/services/member-command-center-runtime.ts:278`, `lib/services/member-command-center-runtime.ts:469-481`.
- Low: the deprecated `createClient({ serviceRole: true })` compatibility path still exists, which makes service-role usage harder to audit than the named wrapper. Source: `lib/supabase/server.ts:8-27`.
- No confirmed finding: I found no browser/client exposure of `SUPABASE_SERVICE_ROLE_KEY`.

## 6. Staff Role Boundary Violations
- Confirmed improvement: the Intake Assessment page now requires both health edit access and clinical documentation roles, and the action now requires health edit access before the service-role-backed write path runs. Sources: `app/(portal)/health/assessment/page.tsx:31-32`, `app/intake-actions.ts:159`.
- High: despite that app-layer improvement, the database still allows broader access than the UI intends because `intake_assessments`, `assessment_responses`, and `intake_assessment_signatures` remain broadly readable/writable to authenticated users. Sources: `supabase/migrations/0006_intake_pof_mhp_supabase.sql:175-184`, `supabase/migrations/0022_intake_assessment_esign.sql:95-97`.
- High: Member Command Center still performs privileged member-file reads before category filtering, so the role boundary is enforced late rather than at the database read boundary. Sources: `lib/services/member-command-center-detail-read-model.ts:334`, `lib/services/member-command-center-runtime.ts:278`.
- High: the authenticated-executable `SECURITY DEFINER` RPCs above mean a staff user can still bypass app-layer role checks entirely if they talk to Supabase directly instead of going through your server actions.
- No new confirmed app-layer health-module regression was found beyond those database-boundary gaps.

## 7. Token Replay / Public Endpoint Risks
- Confirmed fixed: active enrollment packet tokens now check expiry before the completed-state path runs, and there is a regression test covering it. Sources: `lib/services/enrollment-packets-public-runtime-context.ts`, `lib/services/enrollment-packets-public-runtime.ts`, `tests/enrollment-packet-expired-completed-token-guard.test.ts`.
- Medium: enrollment packet submit throttling is still raceable under concurrency because attempts are counted before the new attempt is recorded. Source: `lib/services/enrollment-packet-public-helpers.ts:245-314`.
- Medium: public enrollment packet uploads now look replay-aware at the packet status layer, but the upload path itself still accepts arbitrary file types if a valid packet link is used. Sources: `lib/services/enrollment-packet-public-runtime.ts`, `lib/services/enrollment-packet-artifacts.ts:333-350`.
- Low: POF and care-plan public links still appear replay-aware after commit because tokens rotate and consumed hashes are stored, but I still did not find comparable abuse throttling before expensive finalization work begins. Sources: `lib/services/pof-esign-public.ts`, `lib/services/care-plan-esign-public.ts`.

## 8. Recommended Security Hardening Plan
1. Revoke `authenticated` execute on the high-risk `SECURITY DEFINER` RPCs first. Start with member-file upsert/delete, care-plan caregiver request prep, enrollment-packet lifecycle/finalization RPCs, and POF delivery RPCs. Either move them to `service_role` only or add strict in-function `auth.uid()` / permission checks.
2. Tighten the broad read policies next on intake, member photos, member support tables, care-plan events/diagnoses, enrollment-packet internal tables, pricing tables, locker history, and the enrollment follow-up queue.
3. Add a strict public upload allowlist for enrollment packet uploads so public submitters cannot store arbitrary file types. Reuse the canonical member-file size/type validation rules instead of inventing a second rule set.
4. Move public enrollment packet throttling into an atomic claim/RPC path, then add equivalent token/IP throttling to public POF and care-plan signature flows.
5. Remove the Member Command Center privileged overfetch path so non-clinical viewers never hydrate clinical file rows before filtering.
6. Add RLS to `sites`, `lookup_lists`, and `punches_linked_time_punch_review`, then verify the live project matches repo migrations.

## 9. Suggested Codex Prompts to Fix Issues
- `Harden privileged Supabase RPC grants: revoke authenticated execute on rpc_upsert_member_file_by_source, rpc_delete_member_file_record, rpc_prepare_care_plan_caregiver_request, rpc_prepare_enrollment_packet_request, rpc_save_enrollment_packet_progress, rpc_transition_enrollment_packet_delivery_state, rpc_finalize_enrollment_packet_submission, rpc_void_enrollment_packet_request, rpc_prepare_pof_request_delivery, and rpc_transition_pof_request_delivery_state. Then align runtime callers to service-role-only boundaries or add strict in-function auth.uid()/permission checks.`
- `Replace the remaining broad RLS policies on intake_assessments, assessment_responses, intake_assessment_signatures, member_photo_uploads, member_providers, member_equipment, member_notes, enrollment_packet_pof_staging, enrollment_packet_mapping_runs, enrollment_packet_mapping_records, enrollment_packet_field_conflicts, care_plan_signature_events, care_plan_diagnoses, locker_assignment_history, enrollment pricing tables, and enrollment_packet_follow_up_queue with permission-aware predicates.`
- `Reuse the canonical member-file upload validation rules in the public enrollment packet artifact path so public uploads enforce the same size and MIME allowlist as authenticated member-file uploads.`
- `Move public enrollment packet submit throttling into an atomic Supabase RPC or claim-based write path, then add equivalent token/IP throttling to public POF and care-plan signature flows.`
- `Refactor Member Command Center detail loading so non-clinical viewers never fetch clinical member_files rows through service role before category filtering.`
- `Enable RLS on public.sites, public.lookup_lists, and public.punches_linked_time_punch_review and add explicit safe policies that match actual runtime access.`

## 10. Founder Summary: What Changed Since the Last Run
- No new migration-level RLS or RPC hardening landed in the workspace since the 2026-05-10 audit. I did not see new Supabase migration changes addressing the main database-boundary risks.
- The previously safer items remain safer:
  - the Intake Assessment page now requires clinical roles plus health edit access,
  - the Intake Assessment action now requires health edit access before the privileged write path,
  - the expired active enrollment-packet token bug is still closed,
  - there is now a regression test covering that token-expiry guard.
- The biggest open risks are still unchanged:
  - broad legacy authenticated read/write policies,
  - authenticated execute grants on high-risk `SECURITY DEFINER` RPCs,
  - raceable public enrollment packet throttling,
  - no comparable throttling on public POF/care-plan signature flows,
  - Member Command Center service-role overfetch on detail reads.
- Newly confirmed in this pass:
  - the public enrollment packet artifact upload path does not reuse the internal MIME allowlist,
  - `rpc_upsert_member_file_by_source` is also still authenticated-executable and appears capable of cross-member member-file writes if called directly.
- I still found no confirmed browser/client exposure of `SUPABASE_SERVICE_ROLE_KEY`.
