# Supabase RLS & Security Audit (2026-06-15)

Generated: 2026-06-15

Basis: repo and migration audit only. I did not verify the live Supabase project's deployed policies, grants, PostgREST RPC exposure, or storage rules.

## 1. Executive Summary
- The database boundary is still the highest-risk layer. Several `SECURITY DEFINER` RPCs are still callable by `authenticated` and still trust caller-supplied IDs or actor fields instead of validating the real database caller inside the function body.
- The repo still shows three tables without `ENABLE ROW LEVEL SECURITY`: `public.sites`, `public.lookup_lists`, and `public.punches_linked_time_punch_review`.
- Multiple broad legacy policies are still open on intake, member-photo, member support, care-plan diagnosis/signature-event, enrollment-packet staging/mapping/follow-up, locker history, and enrollment pricing tables.
- Public enrollment packet abuse protections improved compared with the May 12 baseline because the flow now logs token/IP attempts, but the throttling remains raceable because it counts attempts before writing the new attempt record.
- Public POF and care-plan signing flows still look replay-aware, but I still did not find comparable pre-finalization token/IP throttling on those flows.
- I found no confirmed browser/client exposure of `SUPABASE_SERVICE_ROLE_KEY`.
- Important improvement since the last run: new migrations `0213`, `0214`, `0216`, `0217`, `0218`, `0219`, `0220`, and `0221` harden several operational, billing, care-plan, member-file, and privileged-RPC boundaries. Those fixes remove some older findings from the open list.

## 2. Tables Missing RLS
- Confirmed missing repo-defined `ENABLE ROW LEVEL SECURITY`:
  - `public.sites` in `supabase/migrations/0001_initial_schema.sql:7`
  - `public.lookup_lists` in `supabase/migrations/0001_initial_schema.sql:312`
  - `public.punches_linked_time_punch_review` in `supabase/migrations/0017_reseed_schema_alignment.sql:9`
- `sites` and `lookup_lists` look lower-sensitivity than member/clinical tables, but they are still missing an explicit policy boundary.
- `punches_linked_time_punch_review` is the more concerning one because it stores archived punch review data and a `punch_snapshot` payload.

## 3. Overly Permissive Policies
- Critical: `intake_assessments` still allows any authenticated user to read, insert, and update rows with `using (true)` / `with check (true)`. Source: `supabase/migrations/0006_intake_pof_mhp_supabase.sql:172-177`.
- High: `assessment_responses` still allows any authenticated user to read all rows. Writes were later tightened to `service_role`, but reads remain open. Sources: `supabase/migrations/0006_intake_pof_mhp_supabase.sql:179-184`, `supabase/migrations/0077_security_advisor_write_policy_hardening.sql:33-46`.
- Critical: `intake_assessment_signatures` still allows any authenticated user to read, insert, and update signature rows. Source: `supabase/migrations/0022_intake_assessment_esign.sql:92-97`.
- High: `member_photo_uploads` still allows any authenticated user to read upload rows through `auth.uid() is not null`, which is still cross-member exposure. Source: `supabase/migrations/0005_documentation_workflow_persistence.sql:57-67`.
- High: `member_providers`, `member_equipment`, and `member_notes` still allow any authenticated user to read all rows. Their writes were narrowed to a broad staff-role set, but there is still no member-level or permission-level read boundary. Sources: `supabase/migrations/0012_legacy_operational_health_alignment.sql:269-312`, `supabase/migrations/0077_security_advisor_write_policy_hardening.sql:540-602`.
- High: `care_plan_diagnoses` still allows any authenticated user to read all rows. Writes are `service_role` only, but the read boundary is still broad. Source: `supabase/migrations/0085_care_plan_diagnosis_relation.sql:59-86`.
- Medium: `care_plan_signature_events` still allows any authenticated user to read internal signature workflow history. Insert was later tightened to `service_role`. Sources: `supabase/migrations/0020_care_plan_canonical_esign.sql:81-90`, `supabase/migrations/0077_security_advisor_write_policy_hardening.sql:48-53`.
- High: `enrollment_packet_pof_staging`, `enrollment_packet_mapping_runs`, and `enrollment_packet_mapping_records` still allow any authenticated user to read internal workflow state. Later migrations tightened writes to `service_role`, but not reads. Sources: `supabase/migrations/0027_enrollment_packet_intake_mapping.sql:153-178`, `supabase/migrations/0077_security_advisor_write_policy_hardening.sql:129-164`.
- Medium: `enrollment_packet_follow_up_queue` is still readable by any authenticated user. Source: `supabase/migrations/0110_enrollment_packet_follow_up_queue.sql:49-65`.
- Medium: `locker_assignment_history` still allows any authenticated user to read all rows, and operational writes are still role-broad. Sources: `supabase/migrations/0040_locker_assignment_history.sql:19-24`, `supabase/migrations/0077_security_advisor_write_policy_hardening.sql:495-508`.
- Medium: `enrollment_pricing_community_fees` and `enrollment_pricing_daily_rates` still allow any authenticated user to read and write rows. Source: `supabase/migrations/0026_enrollment_pricing_module.sql:58-73`.

## 4. Public Endpoint Risks
- Medium: the public enrollment packet upload path still uses a different allowlist than the canonical member-file validator. The public flow allows `HEIC`, `HEIF`, `GIF`, and `TIFF`, while the canonical internal member-file validator does not. Sources: `app/sign/enrollment-packet/[token]/actions.ts:25-51`, `lib/services/member-files.ts:53-60`.
- Medium: public enrollment packet submit throttling is still raceable because the flow counts recent attempts before it records the new attempt event. Source: `lib/services/enrollment-packet-public-helpers.ts:245-315`.
- Low: internal retry routes are still protected by bearer secrets only. I did not find request signing, IP allowlisting, or visible failed-attempt logging. Sources: `app/api/internal/pof-post-sign-sync/route.ts`, `app/api/internal/enrollment-packet-mapping-sync/route.ts`.
- No confirmed finding: the completed enrollment packet download route now looks properly guarded by an HMAC-signed, expiring token that is revalidated against `packetId`, `memberId`, and `completedAt` before the privileged storage download runs. Sources: `lib/services/enrollment-packet-core.ts:265-329`, `lib/services/enrollment-packets-public-runtime-artifacts.ts:39-70`, `app/sign/enrollment-packet/[token]/completed-packet/route.ts`.

## 5. Service Role Exposure Risks
- Critical: `rpc_upsert_member_file_by_source` is still `SECURITY DEFINER`, still granted to `authenticated`, and still trusts caller-supplied `p_member_id` and metadata. I did not find repo-visible `auth.uid()` or permission validation inside the function body. Sources: `supabase/migrations/0073_delivery_and_member_file_rpc_hardening.sql:1028-1068`, `supabase/migrations/0073_delivery_and_member_file_rpc_hardening.sql:1224-1241`.
- Critical: `rpc_delete_member_file_record` is still `SECURITY DEFINER`, still granted to `authenticated`, and deletes by caller-supplied file ID without repo-visible caller validation. Sources: `supabase/migrations/0073_delivery_and_member_file_rpc_hardening.sql:1157-1184`, `supabase/migrations/0073_delivery_and_member_file_rpc_hardening.sql:1243-1245`.
- Critical: `rpc_prepare_care_plan_caregiver_request` is still `SECURITY DEFINER`, still granted to `authenticated`, and resets caregiver request state from caller-supplied IDs and actor fields without repo-visible caller validation. Sources: `supabase/migrations/0212_care_plan_caregiver_prepare_terminal_guard.sql:1-71`, `supabase/migrations/0212_care_plan_caregiver_prepare_terminal_guard.sql:99-102`.
- Critical: enrollment-packet lifecycle RPCs are still `SECURITY DEFINER`, still granted to `authenticated`, and update packet lifecycle state using caller-supplied IDs and actor metadata without repo-visible caller validation: `rpc_prepare_enrollment_packet_request`, `rpc_transition_enrollment_packet_delivery_state`, `rpc_save_enrollment_packet_progress`, `rpc_finalize_enrollment_packet_submission`, and `rpc_void_enrollment_packet_request`. Sources: `supabase/migrations/0152_enrollment_packet_lifecycle_and_voiding.sql:62-130`, `291-345`, `381-430`, `478-535`, `633-691`, `267-270`, `370-373`, `459-462`, `616-619`, `727-730`.
- High: POF delivery RPCs are still `SECURITY DEFINER`, still granted to `authenticated`, and update `pof_requests` using caller-supplied IDs and actor fields without repo-visible caller validation: `rpc_prepare_pof_request_delivery` and `rpc_transition_pof_request_delivery_state`. Sources: `supabase/migrations/0073_delivery_and_member_file_rpc_hardening.sql:609-690`, `865-888`.
- High: Member Command Center detail still reads privileged member-file data before non-clinical filtering happens in app code. Sources: `lib/services/member-command-center-detail-read-model.ts:334-350`, `lib/services/member-command-center-runtime.ts:278-289`.
- Low: the deprecated boolean `createClient({ serviceRole: true })` path still exists, which makes privileged access harder to audit than the named use-case wrapper. Source: `lib/supabase/server.ts`.
- No confirmed finding: I did not find the service-role key exposed in browser/client code.

## 6. Staff Role Boundary Violations
- Confirmed improvement: reviewed health entry points still show explicit app-layer authorization:
  - `app/(portal)/health/assessment/page.tsx:31-32`
  - `app/intake-actions.ts:157-163`
  - `app/(portal)/health/physician-orders/actions.ts`
  - `app/care-plan-actions.ts`
- High: despite those app-layer guards, the database still allows broader access than the UI intends on intake tables, member support tables, care-plan diagnosis/signature-event tables, and enrollment follow-up/mapping tables.
- High: the authenticated-executable `SECURITY DEFINER` RPCs above still let a signed-in staff user bypass app-layer role checks entirely if they call Supabase directly instead of using your server actions.
- High: Member Command Center file-category filtering still happens after the privileged read, not at the database boundary.

## 7. Token Replay / Public Endpoint Risks
- Confirmed carry-forward fix: the enrollment packet runtime still tracks consumed submission hashes and preserves a replay-safe committed path instead of blindly re-running completion. Sources: `lib/services/enrollment-packets-public-runtime-context.ts:90`, `lib/services/enrollment-packets-public-runtime.ts:151-218`.
- Medium: public enrollment packet submit throttling is still raceable under concurrency because the new attempt is recorded after the count check. Source: `lib/services/enrollment-packet-public-helpers.ts:245-315`.
- Medium: POF public signing looks replay-aware because consumed token hashes and terminal states are checked, but I still did not find comparable pre-finalization token/IP throttling before storage upload and RPC finalization work begins. Sources: `app/sign/pof/[token]/actions.ts:20-32`, `lib/services/pof-esign-public.ts:341-470`.
- Medium: care-plan caregiver public signing has the same pattern: replay-aware terminal checks, but no comparable token/IP throttling before storage upload and finalization work begins. Sources: `app/sign/care-plan/[token]/actions.ts:19-31`, `lib/services/care-plan-esign-public.ts:540-613`.
- No new confirmed replay flaw: completed enrollment packet download tokens are signed and expire, and the route revalidates state before downloading the artifact.

## 8. Recommended Security Hardening Plan
1. Revoke `authenticated` execute on the remaining high-risk `SECURITY DEFINER` RPCs first, or add strict in-function `auth.uid()` / profile-permission validation before any read or write occurs.
2. Replace the remaining broad `using (true)` and `with check (true)` policies on intake, member-photo, member support, care-plan diagnosis/signature-event, enrollment-packet staging/mapping/follow-up, locker, and enrollment-pricing tables with permission-aware predicates.
3. Enable RLS on `public.sites`, `public.lookup_lists`, and `public.punches_linked_time_punch_review`, then add explicit policies that match real runtime access.
4. Move public enrollment packet throttling into an atomic claim/RPC path so concurrent requests cannot beat the limit window.
5. Add comparable token/IP throttling to public POF and care-plan signing flows before upload or finalization work starts.
6. Reuse one canonical member-file upload validator in the public enrollment packet path instead of maintaining a different allowlist.
7. Refactor Member Command Center detail/file loading so non-clinical viewers never hydrate clinical rows under service role before filtering.
8. Validate the live Supabase project against the repo because this audit could not confirm deployed grants, policies, RPC exposure, or storage rules.

## 9. Suggested Codex Prompts to Fix Issues
- `Harden remaining privileged Supabase RPC grants: review rpc_upsert_member_file_by_source, rpc_delete_member_file_record, rpc_prepare_care_plan_caregiver_request, rpc_prepare_enrollment_packet_request, rpc_transition_enrollment_packet_delivery_state, rpc_save_enrollment_packet_progress, rpc_finalize_enrollment_packet_submission, rpc_void_enrollment_packet_request, rpc_prepare_pof_request_delivery, and rpc_transition_pof_request_delivery_state. Revoke authenticated execute where possible, otherwise add strict in-function auth.uid()/permission checks and align callers to service-role-only paths.`
- `Replace the remaining broad RLS policies on intake_assessments, assessment_responses, intake_assessment_signatures, member_photo_uploads, member_providers, member_equipment, member_notes, care_plan_diagnoses, care_plan_signature_events, enrollment_packet_pof_staging, enrollment_packet_mapping_runs, enrollment_packet_mapping_records, enrollment_packet_follow_up_queue, locker_assignment_history, enrollment_pricing_community_fees, and enrollment_pricing_daily_rates with permission-aware predicates.`
- `Enable RLS on public.sites, public.lookup_lists, and public.punches_linked_time_punch_review and add explicit policies that match the real application access model.`
- `Move public enrollment packet submission throttling into an atomic Supabase claim/RPC path and add equivalent token/IP throttling to public POF and care-plan signature submission flows before upload/finalization work begins.`
- `Unify the public enrollment packet upload allowlist with the canonical member-files validator so external uploads cannot persist file types the normal internal path would reject.`
- `Refactor Member Command Center file/detail reads so non-clinical users never fetch privileged member_files rows before category filtering.`

## 10. Founder Summary: What Changed Since the Last Run
- Security hardening did land after the May 12 report. New migrations tightened several previously open areas:
  - `0213` hardened operational write policies.
  - `0216`, `0217`, and `0220` hardened operational and billing read policies.
  - `0218` hardened core care-plan read/write policies.
  - `0219` hardened `member_files` read/write policies by category and module permission.
  - `0214` and `0221` revoked authenticated execute on `rpc_list_member_files`, `rpc_reconcile_expired_pof_requests`, and `rpc_get_operational_reliability_snapshot`.
- Because of those migrations, some older findings from the May 12 report should come off the active-open list:
  - the broad `member_files` table policy finding,
  - the broad core `care_plans` policy finding,
  - the previously open operational/billing read/write policy findings covered by the new hardening migrations,
  - the authenticated execute finding for `rpc_list_member_files`, `rpc_reconcile_expired_pof_requests`, and `rpc_get_operational_reliability_snapshot`.
- The biggest risks that are still open are now clearer and narrower:
  - the remaining authenticated-executable `SECURITY DEFINER` RPCs for member files, enrollment packet lifecycle, care-plan caregiver request prep, and POF delivery,
  - the still-open broad RLS policies on intake/member-support/care-plan diagnosis/signature-event/enrollment-packet staging/follow-up/locker/pricing tables,
  - the three tables still missing RLS,
  - the raceable enrollment packet throttling and the still-missing comparable throttling on public POF/care-plan signing,
  - the Member Command Center privileged file overfetch before filtering.
- This run also preserved two important positive findings:
  - no confirmed client/browser exposure of `SUPABASE_SERVICE_ROLE_KEY`,
  - no new confirmed replay issue on completed enrollment packet download tokens.
