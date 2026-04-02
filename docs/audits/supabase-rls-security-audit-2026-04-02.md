# Supabase RLS & Security Audit (2026-04-02)

Generated: 2026-04-02

## 1. Executive Summary
- I did not find a dedicated one-command runner for this report in the repo. This artifact follows the repo's existing manual audit pattern: scan migrations plus current `app/`, `lib/`, and `scripts/` usage, then save a dated founder-readable markdown report in `docs/audits`.
- Confirmed finding: `public.user_permissions` is created in the schema, is used by the live user-management flow, and does not have repo-defined RLS enablement or policies. That leaves the custom-permission map relying on app-layer guards instead of a canonical database boundary.
- I did not confirm a fresh public-token auth bypass in the enrollment packet, POF, or care-plan signing flows. Current repo code hashes tokens, tracks consumed-token hashes, enforces expiry/status checks, and routes final writes through RPC-backed service paths.
- I did not confirm service-role key leakage into client-side code. Service-role client creation remains in server-only Supabase wrappers.
- Repo-only blocker: I could not query the live Supabase project's current `pg_policies`, grants, or deployed migration state from this workspace, so deployed-policy parity still needs project-side verification.

## 2. Tables Missing RLS
- High - `public.user_permissions` has no repo-defined RLS enablement or policies.
  Exact risk: the table is created in [supabase/migrations/0002_rbac_roles_permissions.sql:24](/D:/Memory%20Lane%20App/supabase/migrations/0002_rbac_roles_permissions.sql#L24), but this run did not find any migration that enables RLS or creates a `user_permissions` policy. The live user-management read path uses the regular authenticated server client in [lib/services/user-management.ts:208](/D:/Memory%20Lane%20App/lib/services/user-management.ts#L208) and reads from [lib/services/user-management.ts:218](/D:/Memory%20Lane%20App/lib/services/user-management.ts#L218), while writes go through the admin client in [lib/services/user-management.ts:303](/D:/Memory%20Lane%20App/lib/services/user-management.ts#L303), [lib/services/user-management.ts:305](/D:/Memory%20Lane%20App/lib/services/user-management.ts#L305), and [lib/services/user-management.ts:327](/D:/Memory%20Lane%20App/lib/services/user-management.ts#L327).
  Why it matters: this table is the canonical custom-permission override map for staff accounts. If authenticated-table grants are still present in the live project, a non-admin authenticated caller could bypass the admin-only page guard and query or mutate permission rows directly through the API surface.
  Recommended fix: add a forward-only migration that enables RLS on `public.user_permissions` and defines explicit admin/service-role policies only.

## 3. Overly Permissive Policies
- No confirmed findings.
- Residual validation gap: older migrations include broad authenticated/internal policies on some tables, but I did not label any as currently active without querying live `pg_policies`, because later hardening migrations appear to revisit several of the same domains.

## 4. Public Endpoint Risks
- No confirmed findings.
- Enrollment packet public completion/download flow currently requires hashed-token resolution plus completed-state validation before the artifact is served. Evidence: token lookup uses the public runtime service in [lib/services/enrollment-packets-public-runtime.ts:432](/D:/Memory%20Lane%20App/lib/services/enrollment-packets-public-runtime.ts#L432), context resolution gates completed state in [lib/services/enrollment-packets-public-runtime.ts:567](/D:/Memory%20Lane%20App/lib/services/enrollment-packets-public-runtime.ts#L567), [lib/services/enrollment-packets-public-runtime.ts:739](/D:/Memory%20Lane%20App/lib/services/enrollment-packets-public-runtime.ts#L739), and the actual route downloads only after that check in [app/sign/enrollment-packet/[token]/completed-packet/route.ts:15](/D:/Memory%20Lane%20App/app/sign/enrollment-packet/%5Btoken%5D/completed-packet/route.ts#L15).

## 5. Service Role Exposure Risks
- No confirmed findings.
- Service-role client construction stays in server-only files: [lib/supabase/server.ts:12](/D:/Memory%20Lane%20App/lib/supabase/server.ts#L12) and [lib/supabase/admin.ts:5](/D:/Memory%20Lane%20App/lib/supabase/admin.ts#L5). I did not find any `NEXT_PUBLIC` service-role key usage or client-side service-role import path in this run.

## 6. Staff Role Boundary Violations
- High - the `user_permissions` finding above is also a role-boundary issue.
  Exact risk: the user-management UI is admin-gated at [app/(portal)/time-hr/user-management/page.tsx:32](/D:/Memory%20Lane%20App/app/(portal)/time-hr/user-management/page.tsx#L32) and [lib/auth.ts:322](/D:/Memory%20Lane%20App/lib/auth.ts#L322), but the backing permission table still lacks a confirmed repo-defined database policy boundary.
  Why it matters: app-layer guards are good, but for a healthcare operations platform the canonical permission map should also be protected at the database layer so an API caller cannot step around the page.
  Recommended fix: move this boundary fully into RLS with explicit admin-only reads/writes plus service-role maintenance access.

## 7. Token Replay / Public Endpoint Risks
- No confirmed findings.
- Replay-safe public workflows are present in current code:
  - POF uses hashed active and consumed token lookups in [lib/services/pof-request-runtime.ts:52](/D:/Memory%20Lane%20App/lib/services/pof-request-runtime.ts#L52) and [lib/services/pof-request-runtime.ts:71](/D:/Memory%20Lane%20App/lib/services/pof-request-runtime.ts#L71), then rejects invalid/expired/signed states in [lib/services/pof-esign-public.ts:339](/D:/Memory%20Lane%20App/lib/services/pof-esign-public.ts#L339).
  - Care plan uses hashed active and consumed token lookups in [lib/services/care-plan-esign-public.ts:132](/D:/Memory%20Lane%20App/lib/services/care-plan-esign-public.ts#L132) and [lib/services/care-plan-esign-public.ts:156](/D:/Memory%20Lane%20App/lib/services/care-plan-esign-public.ts#L156), then enforces active/expired/signed checks in [lib/services/care-plan-esign-public.ts:524](/D:/Memory%20Lane%20App/lib/services/care-plan-esign-public.ts#L524).
  - Enrollment packet uses hashed active and consumed token lookups in [lib/services/enrollment-packets-public-runtime.ts:432](/D:/Memory%20Lane%20App/lib/services/enrollment-packets-public-runtime.ts#L432) and [lib/services/enrollment-packets-public-runtime.ts:451](/D:/Memory%20Lane%20App/lib/services/enrollment-packets-public-runtime.ts#L451), then enforces invalid/completed/expired branching in [lib/services/enrollment-packets-public-runtime.ts:807](/D:/Memory%20Lane%20App/lib/services/enrollment-packets-public-runtime.ts#L807).

## 8. Recommended Security Hardening Plan
1. Add a small forward-only migration enabling RLS on `public.user_permissions` with explicit admin and service-role policies.
2. After that migration is applied, verify live `pg_policies` and effective grants in the Supabase project so the repo and deployed project match.
3. If `roles` and `role_permissions` are going to become active runtime tables later, harden them in the same migration wave instead of repeating this gap.

## 9. Suggested Codex Prompts to Fix Issues
- `Add a forward-only Supabase migration that enables RLS on public.user_permissions, grants admin-only read/write access through explicit policies, preserves service_role maintenance access, and does not change the current canonical user-management service write path. Then verify the user-management pages still work.`
- `Audit whether public.roles and public.role_permissions should also be RLS-protected before they are used in runtime paths, and if so add that hardening in the same migration set with founder-readable rollout notes.`

## 10. Founder Summary
- The main confirmed security gap from this repo run is not the public signing flows. Those currently look intentionally replay-safe and much more hardened than the old March baseline.
- The real blocker is the staff permission override table. The app hides user management behind admin checks, but the database contract for `user_permissions` is still weaker than it should be because this repo does not define RLS for it.
- I did not find proof of a live exploit from repo code alone, because deployed grants and live policies are outside the workspace. But for Memory Lane's production rules, this is still a hardening gap worth treating as a production blocker until fixed and verified.
