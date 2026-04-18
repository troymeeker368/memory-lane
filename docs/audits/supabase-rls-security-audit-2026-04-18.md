# Supabase RLS & Security Audit (2026-04-18)

Generated: 2026-04-18

## 1. Executive Summary
- Confirmed: the April 2 `user_permissions` RLS gap has been closed by later migrations, including [`0183_user_permissions_rls_hardening.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0183_user_permissions_rls_hardening.sql:1), [`0186_user_permissions_grants_hardening.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0186_user_permissions_grants_hardening.sql:1), [`0198_user_permissions_admin_boundary_hardening.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0198_user_permissions_admin_boundary_hardening.sql:1), and [`0201_roles_and_role_permissions_rls_hardening.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0201_roles_and_role_permissions_rls_hardening.sql:1).
- Confirmed: newer hardening also improved operational write boundaries. The new uncommitted migration [`0213_operational_write_policy_permission_hardening.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0213_operational_write_policy_permission_hardening.sql:1) tightens many write policies to require explicit `operations.can_edit`.
- Confirmed: the highest-risk remaining issues are database-side, not a fresh public unauthenticated bypass. Several clinical, care-plan, billing, and operational tables still allow broad authenticated access, and two `security definer` RPCs remain callable by any authenticated user.
- Confirmed: I did not find a browser-side leak of `SUPABASE_SERVICE_ROLE_KEY`, and I did not confirm a new unauthenticated bypass in the public enrollment packet, POF, or care-plan signature routes.
- Repo-only blocker: this audit is based on migrations and application code in the workspace. I could not query the live Supabase project's deployed `pg_policies`, grants, or bucket policies from this repo alone, so deployed parity still needs project-side verification.

## 2. Tables Missing RLS
- Low - `public.sites` is created in [`0001_initial_schema.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0001_initial_schema.sql:7), and I did not find repo-defined `ENABLE ROW LEVEL SECURITY` later in the migration chain.
  Exact risk: if authenticated grants exist in the live project, this table would rely on grants rather than RLS.
  Why it matters: even reference tables should have an intentional boundary so future reuse does not silently become a data leak.
  Recommended fix: explicitly enable RLS and add a narrow read policy if the table is meant to stay readable.
- Low - `public.lookup_lists` is created in [`0001_initial_schema.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0001_initial_schema.sql:312), and I did not find repo-defined `ENABLE ROW LEVEL SECURITY` later in the migration chain.
  Exact risk: same residual grant-based exposure risk as above.
  Why it matters: schema gaps like this are easy to forget and later become runtime data exposure when a table gains real usage.
  Recommended fix: enable RLS and define an explicit read policy or service-only access.
- Low - `public.punches_linked_time_punch_review` is created in [`0017_reseed_schema_alignment.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0017_reseed_schema_alignment.sql:9), and I did not find repo-defined `ENABLE ROW LEVEL SECURITY` later in the migration chain.
  Exact risk: if this table is ever queried outside a tightly controlled service path, it has no row-level boundary.
  Why it matters: time and HR review data should not depend on unverified grant defaults.
  Recommended fix: enable RLS and either restrict access to HR roles or service-only paths.

## 3. Overly Permissive Policies
- High - intake assessment tables still use broad authenticated policies with `using (true)` and `with check (true)` in [`0006_intake_pof_mhp_supabase.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0006_intake_pof_mhp_supabase.sql:175) and [`0022_intake_assessment_esign.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0022_intake_assessment_esign.sql:95).
  Tables involved: `public.intake_assessments`, `public.assessment_responses`, `public.intake_assessment_signatures`.
  Exact risk: any authenticated user can query or mutate intake and intake-signature rows directly through Supabase, regardless of intended role or member assignment.
  Why it matters: these tables can contain PHI, clinical notes, and signature artifacts. This is a direct cross-user and cross-member exposure risk.
  Recommended fix: replace these policies with role-aware and member-aware predicates, and keep writes on the canonical RPC/service path where possible.
- High - care-plan, billing, and related clinical timeline tables still expose broad authenticated access in [`0013_care_plans_and_billing_execution.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0013_care_plans_and_billing_execution.sql:338) and care-plan signature events remain broadly readable in [`0020_care_plan_canonical_esign.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0020_care_plan_canonical_esign.sql:83).
  Tables involved: `public.care_plan_sections`, `public.care_plan_versions`, `public.care_plan_review_history`, `public.care_plan_signature_events`, `public.billing_batches`, `public.billing_invoices`, `public.billing_adjustments`, `public.billing_invoice_lines`, `public.billing_coverages`, `public.billing_export_jobs`.
  Exact risk: any logged-in staff account can read or mutate records that should be limited to narrower clinical, billing, or management roles.
  Why it matters: this combines member clinical planning data with financial records under a database boundary that is much looser than the app’s role model.
  Recommended fix: add role-specific predicates for reads and move writes to service-role-only or tightly scoped authenticated policies.
- High - several operational and member tables still have broad authenticated read access, and some still keep broad authenticated write semantics unless separately hardened later. See [`0011_member_command_center_aux_schema.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0011_member_command_center_aux_schema.sql:406), [`0012_legacy_operational_health_alignment.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0012_legacy_operational_health_alignment.sql:231), and [`0040_locker_assignment_history.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0040_locker_assignment_history.sql:22).
  Tables involved: `public.attendance_records`, `public.member_providers`, `public.member_equipment`, `public.member_notes`, `public.transportation_manifest_adjustments`, `public.locker_assignment_history`, `public.billing_schedule_templates`, `public.center_billing_settings`.
  Exact risk: authenticated users can read cross-member operational and documentation data far outside the intended workflow boundary.
  Why it matters: this creates cross-user and cross-member exposure even when the UI appears role-gated.
  Recommended fix: align these tables to explicit operations or clinical permission predicates, matching the newer `0213` write hardening direction on both read and write paths.
- High - the current database read boundary for some sensitive domains is still broader than the app’s intended authorization surface.
  Tables involved: `public.member_health_profiles` in [`0045_rls_hardening_phase.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0045_rls_hardening_phase.sql:183) and `public.member_files` in [`0035_sensitive_domain_rls_hardening.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0035_sensitive_domain_rls_hardening.sql:214).
  Exact risk: `member_health_profiles` reads remain open to `manager`, `director`, and `coordinator`, and `member_files` metadata reads remain open to `coordinator` or the uploader, even though app-level access is narrower in some flows.
  Why it matters: a direct Supabase caller can bypass stricter app guards and retrieve member health or file metadata directly.
  Recommended fix: narrow the RLS predicates to the same role and permission model the app actually intends to enforce.

## 4. Public Endpoint Risks
- No confirmed unauthenticated bypass findings.
- Public enrollment packet submission currently has the strongest abuse controls. It validates file size and MIME in [`app/sign/enrollment-packet/[token]/actions.ts`](/D:/Memory%20Lane%20App/app/sign/enrollment-packet/%5Btoken%5D/actions.ts:137) and logs token/IP throttling in [`lib/services/enrollment-packet-public-helpers.ts`](/D:/Memory%20Lane%20App/lib/services/enrollment-packet-public-helpers.ts:245).
- Completed enrollment packet downloads also use a dedicated completed-packet download token in [`lib/services/enrollment-packets-public-runtime-artifacts.ts`](/D:/Memory%20Lane%20App/lib/services/enrollment-packets-public-runtime-artifacts.ts:38) before the storage read in [`app/sign/enrollment-packet/[token]/completed-packet/route.ts`](/D:/Memory%20Lane%20App/app/sign/enrollment-packet/%5Btoken%5D/completed-packet/route.ts:11).
- Residual validation gap: repo review cannot verify live WAF/rate limiting, live bucket policy state, or production secret hygiene outside the codebase.

## 5. Service Role Exposure Risks
- High - `public.rpc_list_member_files(uuid)` is a `security definer` function granted to `authenticated` in [`0145_reports_and_member_files_read_rpcs.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0145_reports_and_member_files_read_rpcs.sql:96) and used from the regular signed-in server client in [`lib/services/member-command-center-runtime.ts`](/D:/Memory%20Lane%20App/lib/services/member-command-center-runtime.ts:197).
  Exact risk: any authenticated caller who can reach PostgREST RPC can enumerate file metadata for any member ID, bypassing the stricter app-side category and download checks.
  Why it matters: member file names, categories, upload timestamps, and source references are sensitive operational data, and this is a direct cross-member exposure path.
  Recommended fix: revoke `authenticated` execute, grant only `service_role`, and route listing through a canonical server-only wrapper that enforces role and category boundaries.
- High - `public.rpc_reconcile_expired_pof_requests(integer)` is a `security definer` function granted to `authenticated` in [`0204_pof_expiry_reconciliation_rpc.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0204_pof_expiry_reconciliation_rpc.sql:77).
  Exact risk: any authenticated user can trigger a system workflow that expires outstanding POF signature requests and writes document events.
  Why it matters: this is a workflow-control function, not a normal user action. Broad execute access creates a staff-boundary violation and an avoidable denial-of-service surface against active provider signature requests.
  Recommended fix: revoke `authenticated` execute and allow only a trusted service worker or service role.
- No confirmed client-side service-role key leak findings.
- Residual hardening note: the deprecated `createClient({ serviceRole: true })` compatibility path still exists in [`lib/supabase/server.ts`](/D:/Memory%20Lane%20App/lib/supabase/server.ts:17). It is not itself a leak, but it is less auditable than the named use-case wrapper in [`lib/supabase/service-role.ts`](/D:/Memory%20Lane%20App/lib/supabase/service-role.ts:90).

## 6. Staff Role Boundary Violations
- High - write-capable health permission checks still use `canView` instead of `canEdit` in [`lib/permissions/core.ts`](/D:/Memory%20Lane%20App/lib/permissions/core.ts:270), [`lib/permissions/core.ts`](/D:/Memory%20Lane%20App/lib/permissions/core.ts:284), and [`lib/permissions/core.ts`](/D:/Memory%20Lane%20App/lib/permissions/core.ts:308).
  Functions involved: `canManagePhysicianOrders`, `canManagePofSignatureWorkflow`, `canDocumentMar`.
  Exact risk: users with view-only health permissions can satisfy helper checks intended for write workflows.
  Why it matters: this widens staff write authority beyond the custom-permission model the app appears to advertise.
  Recommended fix: switch these helpers to require `canEdit`, then retest all write-capable health actions and pages.
- Medium - care-plan and progress-note authorization still begins with `requireNavItemAccess(...)`, which defaults to `canView`, before narrowing by role in [`lib/services/care-plan-authorization.ts`](/D:/Memory%20Lane%20App/lib/services/care-plan-authorization.ts:24) and [`lib/services/progress-note-authorization.ts`](/D:/Memory%20Lane%20App/lib/services/progress-note-authorization.ts:24). The default view-level gate comes from [`lib/auth.ts`](/D:/Memory%20Lane%20App/lib/auth.ts:67).
  Exact risk: the first gate is broader than an edit-specific or signer-specific authorization check.
  Why it matters: layered authorization is safest when the first gate is already as narrow as the workflow requires.
  Recommended fix: require explicit `canEdit` or a dedicated write capability for these signer/edit flows.
- Medium - intake assessment signing still relies primarily on role checks in [`app/intake-actions.ts`](/D:/Memory%20Lane%20App/app/intake-actions.ts:157) rather than a shared module-permission helper.
  Exact risk: the intake write boundary is inconsistent with the newer explicit permission model used elsewhere.
  Why it matters: inconsistent authorization patterns are harder to audit and easier to drift.
  Recommended fix: align intake signing to the same canonical health-module edit capability model used for other clinical write workflows.

## 7. Token Replay / Public Endpoint Risks
- Low - POF and care-plan public signature flows look replay-safe, but I did not find enrollment-packet-style token/IP throttling or guard-failure logging in [`lib/services/pof-esign-public.ts`](/D:/Memory%20Lane%20App/lib/services/pof-esign-public.ts:341), [`lib/services/care-plan-esign-public.ts`](/D:/Memory%20Lane%20App/lib/services/care-plan-esign-public.ts:528), [`app/sign/pof/[token]/actions.ts`](/D:/Memory%20Lane%20App/app/sign/pof/%5Btoken%5D/actions.ts:14), or [`app/sign/care-plan/[token]/actions.ts`](/D:/Memory%20Lane%20App/app/sign/care-plan/%5Btoken%5D/actions.ts:13).
  Exact risk: links are not obviously replay-broken, but they are easier to hammer, brute-force, or abuse operationally than the enrollment packet path.
  Why it matters: public healthcare signing links should be abuse-resistant even when tokens are strong.
  Recommended fix: add the same shared throttling and guard-failure logging pattern used by enrollment packets.
- Medium - Member Command Center file uploads still do not enforce shared MIME and size validation in [`app/(portal)/operations/member-command-center/_actions/files.ts`](/D:/Memory%20Lane%20App/app/%28portal%29/operations/member-command-center/_actions/files.ts:67) and [`lib/services/member-files.ts`](/D:/Memory%20Lane%20App/lib/services/member-files.ts:450).
  Exact risk: an authorized internal editor can upload arbitrary content types and sizes into the protected member documents bucket.
  Why it matters: this is not a public-link bug, but it is still a token and storage abuse gap around sensitive member file persistence.
  Recommended fix: add shared server-side MIME and size validation matching the stronger enrollment packet upload controls.

## 8. Recommended Security Hardening Plan
1. Fix the two highest-risk privileged RPC boundaries first: revoke `authenticated` execute from `rpc_list_member_files` and `rpc_reconcile_expired_pof_requests`.
2. Replace the remaining broad authenticated RLS policies on intake, care-plan, billing, and operational tables with explicit role- and permission-aware predicates.
3. Align the database boundary with the app boundary for health and member-file reads so direct Supabase access cannot bypass the UI’s stricter rules.
4. Tighten staff write authorization helpers so write-capable flows consistently require `canEdit`, not just `canView`.
5. Add shared upload validation and shared public-link throttling to weaker paths so all signature and file flows reach the enrollment packet security baseline.
6. After repo fixes land, verify deployed `pg_policies`, grants, RPC execute permissions, and storage bucket policies in the live Supabase project.

## 9. Suggested Codex Prompts to Fix Issues
- `Lock down rpc_list_member_files so only service_role can execute it, then move member file listing behind a canonical server-only wrapper that preserves current Member Command Center behavior and clinical file category restrictions.`
- `Restrict rpc_reconcile_expired_pof_requests to a trusted runner/service-only path, remove authenticated execute access, and keep current queued POF expiry reconciliation behavior intact.`
- `Replace the broad authenticated RLS policies on intake_assessments, assessment_responses, intake_assessment_signatures, care_plan_sections, care_plan_versions, care_plan_review_history, care_plan_signature_events, and the billing tables with explicit role- and permission-aware predicates.`
- `Audit all health write-capability helpers and change physician order management, POF signature management, and MAR documentation checks from canView to canEdit without breaking read-only pages.`
- `Add shared MIME and size validation to Member Command Center member file uploads so internal uploads enforce the same guardrails as public enrollment packet uploads.`
- `Add shared token/IP throttling and guard-failure logging to public POF and care-plan signature flows, matching the enrollment packet public abuse controls.`

## 10. Founder Summary: What changed since the last run
- The old `user_permissions` database-boundary problem from the April 2 audit has been fixed. That is real progress.
- The new `0213` migration is also a real improvement. It tightens many high-risk operational write policies so writes now require explicit `operations.can_edit`, not just a broad role check.
- The main remaining risk is now older read-side and privileged-RPC exposure that was never brought up to the newer standard. In plain English: the repo has gotten better at blocking the wrong staff user from writing some operational data, but it still has multiple places where a logged-in user could read or trigger more than they should through the database layer.
- I did not find a fresh public unauthenticated bypass or a service-role key leak in this pass.
