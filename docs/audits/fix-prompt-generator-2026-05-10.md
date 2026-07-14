# Fix Prompt Generator - 2026-05-10

Source reports used:
- `docs/audits/supabase-rls-security-audit-2026-05-10.md`
- `docs/audits/production-readiness-audit-2026-05-10.md`
- `docs/audits/daily-canonicality-sweep-raw-2026-03-27.json`
- `docs/audits/schema-migration-safety-audit-2026-04-02.md`
- `docs/audits/shared-resolver-drift-check-2026-03-29.md`
- `docs/audits/rpc-architecture-audit-2026-03-24.md`
- `docs/audits/acid-transaction-audit-2026-05-10.md`
- `docs/audits/idempotency-duplicate-submission-audit-2026-05-10.md`
- `docs/audits/workflow-simulation-audit-2026-05-10.md`
- `docs/audits/supabase-query-performance-audit-2026-05-10.md`

Notes:
- The 2026-05-10 production-readiness audit was clean in scoped domains and did not add a new implementation defect to promote.
- The latest available daily canonicality sweep, schema migration safety audit, and shared resolver drift check did not surface a fresh open runtime bug for today. They remain important guardrails and were used to avoid inventing duplicate work.
- The latest standalone shared RPC architecture artifact is still `2026-03-24`. Its findings are used only where newer May audits still point at the same boundary problem.

## 1. Issues Detected

### 1. High-risk `SECURITY DEFINER` RPCs and broad RLS policies still let database callers bypass app intent
Architectural rule violated:
- preserve role restrictions
- Supabase-first authorization
- canonical service write paths
- migration-driven schema

Safest fix approach:
- Revoke `authenticated` execute on the highest-risk `SECURITY DEFINER` RPCs first.
- Tighten the broad intake, care-plan, enrollment-packet, member-support, pricing, and photo read policies with permission-aware predicates.
- Keep the canonical service paths and only allow privileged execution through explicit service-role or in-function `auth.uid()` checks.

Audit basis:
- `supabase-rls-security-audit-2026-05-10.md`

### 2. Public enrollment submit throttling is still raceable, and MCC detail still has a privileged hydrate-then-filter path
Architectural rule violated:
- public-link workflows must be idempotent and abuse-resistant
- least-privilege reads
- do not hydrate data the caller is not allowed to see

Safest fix approach:
- Move throttling into one atomic RPC or claim-based database write.
- Refactor MCC detail file reads so non-clinical viewers never hydrate restricted `member_files` rows before filtering.
- Preserve current public-link and MCC service boundaries.

Audit basis:
- `supabase-rls-security-audit-2026-05-10.md`

### 3. Public POF and public care-plan replay losers can still delete committed signed artifacts
Architectural rule violated:
- ACID transaction requirements
- idempotency and replay safety
- workflow state integrity

Safest fix approach:
- Keep the current finalize RPCs authoritative.
- Make replay-safe `was_already_signed` branches read-only.
- Never delete deterministic canonical signed artifact paths from a replay-safe loser branch.

Audit basis:
- `acid-transaction-audit-2026-05-10.md`
- `idempotency-duplicate-submission-audit-2026-05-10.md`

### 4. Enrollment resend and POF resend/void still trust stale pre-read state too much
Architectural rule violated:
- idempotency and replay safety
- workflow state integrity
- one canonical transition path per workflow

Safest fix approach:
- Add compare-and-set state validation at the locked RPC boundary.
- Refuse stale resend or void attempts after terminal or incompatible state transitions.
- Prevent stale losers from emitting duplicate or contradictory events.

Audit basis:
- `idempotency-duplicate-submission-audit-2026-05-10.md`

### 5. Enrollment packet completion is still a split commit
Architectural rule violated:
- ACID durability
- shared RPC standard for lifecycle-critical multi-step workflows
- one canonical write path per workflow

Safest fix approach:
- Move more required artifact/linkage work under the completion owner, or persist one explicit durable repair-owner record before success is returned.
- Make follow-up truth fail closed if the fallback truth cannot be durably recorded.

Audit basis:
- `acid-transaction-audit-2026-05-10.md`
- `workflow-simulation-audit-2026-05-10.md`
- `rpc-architecture-audit-2026-03-24.md`

### 6. Lead conversion still trusts `p_existing_member_id` too much inside the DB boundary
Architectural rule violated:
- canonical entity identity
- consistency requirements
- fail closed on identity mismatch

Safest fix approach:
- Fix the DB boundary, not just the TypeScript caller.
- Add an assertion so an existing member id is accepted only when it already belongs to the same lead or satisfies one explicitly safe shell-member rule.

Audit basis:
- `acid-transaction-audit-2026-05-10.md`

### 7. Care plan final signed file identity still collides across multiple signed plans for one member
Architectural rule violated:
- schema/runtime alignment
- canonical document identity
- migration-driven schema

Safest fix approach:
- Replace the shared final-signed care-plan `document_source` with a deterministic care-plan-specific source.
- Keep the canonical member-files write boundary and add migration-safe compatibility handling for existing rows.

Audit basis:
- `acid-transaction-audit-2026-05-10.md`

### 8. The intake -> POF and signed POF -> MHP handoffs still need canonical proof, not scanner ambiguity
Architectural rule violated:
- Supabase-backed workflow truth
- canonical service write paths
- shared resolver/service boundaries

Safest fix approach:
- Verify the handoff end-to-end first.
- If the workflow scanner is wrong, add regression coverage that proves the canonical `physician_orders` write path exists.
- If the write truly is missing or bypassed, route the handoff through the existing canonical physician-order service/RPC path instead of patching the UI.

Audit basis:
- `workflow-simulation-audit-2026-05-10.md`
- `production-readiness-audit-2026-05-10.md`

### 9. Workflow truth is still overstated in notifications and some `ok: true` catch-return paths
Architectural rule violated:
- workflow state integrity
- auditability
- do not return synthetic success when downstream truth is degraded or unknown

Safest fix approach:
- Drive readiness messaging from the same persisted readiness resolver used by the workflow.
- Remove or narrow false-success catch paths in high-risk operational actions.
- Keep committed-but-follow-up-needed truth distinct from full readiness.

Audit basis:
- `acid-transaction-audit-2026-05-10.md`
- `workflow-simulation-audit-2026-05-10.md`

### 10. Founder-facing read paths still have unresolved scaling hot spots and three confirmed missing indexes
Architectural rule violated:
- keep one canonical read boundary per domain where possible
- avoid unnecessarily broad Supabase reads
- preserve maintainable shared read models

Safest fix approach:
- Add the three confirmed missing indexes first.
- Then slim the sales dashboard summary RPC and split billing headline summaries away from heavyweight preview workloads.
- Preserve the current canonical RPC/service read boundaries.

Audit basis:
- `supabase-query-performance-audit-2026-05-10.md`
- `rpc-architecture-audit-2026-03-24.md`

## 2. Codex Fix Prompts

### Issue 1. Harden the Supabase database boundary first: RPC execute grants plus broad RLS policies
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Several high-risk SECURITY DEFINER RPCs are still executable by authenticated users, and several live tables still have broad read/write RLS that does not match the app's real clinical or operational permission model. App-layer checks are not enough if a signed-in user can call Supabase directly.

Scope:
- Domain/workflow: authorization boundary hardening
- Canonical entities/tables: intake_assessments, assessment_responses, intake_assessment_signatures, member_photo_uploads, member_providers, member_equipment, member_notes, enrollment_packet_pof_staging, enrollment_packet_mapping_runs, enrollment_packet_mapping_records, enrollment_packet_follow_up_queue, care_plan_signature_events, care_plan_diagnoses, enrollment pricing tables, user_permissions-adjacent auth flows
- High-risk RPCs to inspect first: rpc_delete_member_file_record, rpc_prepare_care_plan_caregiver_request, rpc_transition_enrollment_packet_delivery_state, rpc_void_enrollment_packet_request, rpc_finalize_enrollment_packet_submission, public signature finalization RPCs
- Expected canonical write path: UI/public action -> service layer -> service-role-only RPC or in-function auth guard -> Supabase

Required approach:
1) Inspect the current grants and policies first in the migrations, not only the TypeScript callers.
2) Revoke authenticated execute from the high-risk SECURITY DEFINER RPCs unless there is a clear public-token use case that must stay callable.
3) Where a function must stay callable, add explicit in-function auth.uid()/permission validation that matches the canonical service boundary.
4) Tighten broad RLS policies so clinical and internal workflow rows are not broadly readable by any authenticated user.
5) Preserve existing canonical service paths and server-only service-role usage. Do not move business logic into UI components.
6) Add focused regression coverage for one blocked direct-RPC call path and one allowed canonical service path.

Validation:
- Run npm run typecheck.
- Report each migration changed, each RPC grant changed, and any intentional remaining authenticated-executable RPC.
- Call out any live-project follow-up needed if repo migrations and deployed grants may differ.

Do not overengineer. Keep the fix maintainable, explicit, and auditable.
```

### Issue 2. Make public submit throttling atomic and remove MCC hydrate-then-filter overfetch
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Public enrollment packet submit throttling is still count-then-record and can be beaten by concurrent requests, and Member Command Center detail still has a privileged member_files hydrate-then-filter path that loads restricted file rows before app-layer filtering.

Scope:
- Domain/workflow: public enrollment packet abuse resistance and MCC least-privilege reads
- Canonical entities/tables: enrollment_packet_requests, enrollment_packet_events, member_files
- Expected canonical paths:
  - public submit -> service layer -> atomic throttle RPC/transaction -> Supabase
  - MCC detail read -> permission-aware read model -> Supabase

Inspect first:
- lib/services/enrollment-packet-public-helpers.ts
- lib/services/enrollment-packets-public-runtime.ts
- lib/services/member-command-center-detail-read-model.ts
- lib/services/member-command-center-runtime.ts
- any existing tests for enrollment packet submit throttling and MCC privileged reads

Required approach:
1) Replace count-then-record throttling with one atomic Supabase write path that claims or rejects the attempt under concurrency.
2) Keep the public enrollment packet service path canonical; do not add ad hoc in-memory throttling.
3) Refactor MCC detail reads so non-clinical viewers never fetch restricted member_files rows through service role and then filter afterward.
4) Reuse the safer category-filtered paginated file-list pattern if it already exists.
5) Add concurrency-focused regression coverage for public submit throttling and authorization-focused coverage for MCC detail reads.

Validation:
- Run npm run typecheck.
- Run targeted tests for concurrent public submit and MCC permission boundaries.
- Report any migration/RPC additions and any remaining intentional privileged read surfaces.

Do not overengineer. Keep the fix maintainable and least-privilege.
```

### Issue 3. Stop replay-safe public signing from deleting committed clinical artifacts
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Public POF signing and public care plan caregiver signing can still delete already-committed signed files on replay. The losing request hits an already-signed finalize result and still cleans up deterministic canonical artifact paths.

Scope:
- Domain/workflow: public POF signing and public care plan caregiver signing
- Canonical entities/tables: pof_requests, pof_signatures, care_plans, care_plan_signature_events, member_files, member-documents storage artifacts
- Expected canonical write path: public action -> service layer -> finalize RPC -> Supabase

Inspect first:
- lib/services/pof-esign-public.ts
- lib/services/care-plan-esign-public.ts
- lib/services/clinical-esign-artifacts.ts
- supabase/migrations/0053_artifact_drift_replay_hardening.sql
- existing public signing replay tests

Required approach:
1) Confirm where replay-safe finalize results still trigger cleanup on deterministic canonical paths.
2) Preserve the current finalize RPC boundaries and replay guards.
3) Make `was_already_signed` / `wasAlreadySigned` branches strictly read-only for canonical committed artifact paths.
4) If cleanup must remain, only delete files that can be proven to be temp attempt-scoped artifacts created by the losing request.
5) Prefer attempt-scoped temporary uploads only if that is the smallest clean shared fix across both workflows.
6) Add regression tests that fail if replay-safe branches delete the winner's canonical signed artifacts.

Validation:
- Run npm run typecheck.
- Run targeted replay tests for both public POF signing and care plan caregiver signing.
- Report changed files and any remaining artifact cleanup edge cases.

Do not overengineer. Keep the fix maintainable and auditable.
```

### Issue 4. Add compare-and-set guards for enrollment resend and POF resend/void
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Enrollment packet resend can still reset a completed packet back to draft, and POF resend/void can still overwrite a request that was signed after the staff pre-read. The app pre-read is not enough because the locked write boundary still trusts stale state too much.

Scope:
- Domain/workflow: enrollment packet resend, POF resend, POF void
- Canonical entities/tables: enrollment_packet_requests, enrollment_packet_events, enrollment_packet_signatures, pof_requests, pof_signatures, document_events
- Expected canonical write path: UI -> Server Action -> service layer -> compare-and-set RPC/transaction boundary -> Supabase

Inspect first:
- lib/services/enrollment-packet-management.ts
- lib/services/enrollment-packets-send-runtime.ts
- supabase/migrations/0152_enrollment_packet_lifecycle_and_voiding.sql
- lib/services/pof-esign.ts
- lib/services/pof-request-runtime.ts
- supabase/migrations/0080_pof_request_delivery_rpc_insert_alignment.sql
- supabase/migrations/0098_false_failure_read_path_hardening.sql

Required approach:
1) Preserve the existing canonical resend/void service paths.
2) Add expected-current-state validation inside the locked RPC boundary for enrollment packet resend and POF resend/void.
3) Refuse resend/void when the canonical row is already completed, expired, voided, signed, or otherwise incompatible with the attempted transition.
4) Ensure stale losing transitions do not emit misleading downstream packet events, POF events, or notifications.
5) Keep legitimate resend history where appropriate, but prevent race-driven regressions.
6) Add regression coverage for stale pre-read -> external completion/signature -> resend/void execution.

Validation:
- Run npm run typecheck.
- Run targeted enrollment packet and POF transition tests.
- Report migration changes, RPC contract changes, and any caller updates needed.

Do not overengineer. Keep the fix maintainable and auditable.
```

### Issue 5. Make enrollment packet completion durably truthful
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Enrollment packet completion still marks the packet completed before finalized artifacts, member-file linkage, notifications, and downstream mapping are durably aligned. The canonical packet row can get ahead of the operational truth.

Scope:
- Domain/workflow: enrollment packet public completion and post-commit recovery
- Canonical entities/tables: enrollment_packet_requests, enrollment_packet_events, enrollment_packet_uploads, enrollment_packet_signatures, enrollment_packet_mapping_runs, enrollment_packet_follow_up_queue, member_files
- Expected canonical write path: public action -> service layer -> RPC/transaction boundary -> Supabase

Inspect first:
- lib/services/enrollment-packets-public-runtime.ts
- lib/services/enrollment-packets-public-runtime-post-commit.ts
- lib/services/enrollment-packets-public-runtime-artifacts.ts
- lib/services/enrollment-packets-public-runtime-cascade.ts
- lib/services/enrollment-packets-public-runtime-follow-up.ts
- supabase/migrations/0180_enrollment_completion_follow_up_state.sql
- rpc-architecture findings for enrollment workflow boundaries

Required approach:
1) Identify the minimum safe truth boundary that makes returned completion truth match durable Supabase truth.
2) Either move required artifact/linkage work inside the durable completion owner, or persist one explicit durable repair-owner record before success is returned and make that record the canonical follow-up truth boundary.
3) Make fallback follow-up handling fail closed if the system cannot durably record fallback truth.
4) Preserve current replay protections and canonical packet persistence rules.
5) Add regression coverage for committed packet + failed artifact persistence, committed packet + failed follow-up persistence, and replay after committed completion.

Validation:
- Run npm run typecheck.
- Run targeted enrollment packet completion tests.
- Report changed files, migration/RPC impact, and the chosen durable truth boundary.

Do not overengineer. Keep the fix maintainable and auditable.
```

### Issue 6. Fail closed on unsafe existing-member relink during lead conversion
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
The lead conversion database boundary still trusts `p_existing_member_id` too much. A privileged bad call can supply an unrelated member id and the function can relink that row to the wrong lead.

Scope:
- Domain/workflow: lead conversion
- Canonical entities/tables: leads, members, lead_stage_history, lead_activities
- Expected canonical write path: UI -> Server Action -> service layer -> conversion RPC/function -> Supabase

Inspect first:
- supabase/migrations/0158_lead_conversion_shell_success_guard.sql
- the current definition of apply_lead_stage_transition_with_member_upsert
- lib/services/sales-lead-conversion-supabase.ts
- any tests covering existing-member conversion paths

Required approach:
1) Preserve the current canonical conversion RPC/function boundary.
2) Add a DB assertion so `p_existing_member_id` must either already belong to the same lead, be null, or satisfy one explicitly allowed safe-unlinked-shell condition.
3) Fail closed when a caller supplies an unrelated member id.
4) Keep app-layer canonical identity resolution intact, but do not rely on it as the only protection.
5) Add regression coverage for one valid existing-member path and one invalid cross-lead relink attempt.

Validation:
- Run npm run typecheck.
- Run targeted sales conversion tests.
- Report migration changes, rollout order, and any data preflight needed.

Do not overengineer. Keep the fix maintainable and auditable.
```

### Issue 7. Make care plan final signed file identity care-plan-specific
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Care plan final signed files still use one shared `document_source = 'Care Plan Final Signed'` per member, but the schema enforces unique `(member_id, document_source)`. A member with more than one signed care plan can hit a durable collision.

Scope:
- Domain/workflow: care plan final signed artifact persistence
- Canonical entities/tables: care_plans, care_plan_signature_events, member_files
- Expected canonical write path: care plan finalize flow -> canonical member-files boundary -> Supabase

Inspect first:
- supabase/migrations/0053_artifact_drift_replay_hardening.sql
- supabase/migrations/0091_member_files_document_source_unique.sql
- lib/services/care-plan-esign-public.ts
- lib/services/clinical-esign-artifacts.ts
- any care plan finalization tests that touch member_files

Required approach:
1) Keep the current finalize RPC/member-files contract authoritative.
2) Replace the shared final-signed care-plan document_source with a care-plan-specific deterministic source that is stable and auditable.
3) Add any required forward-only migration or compatibility update so existing signed care plans still resolve correctly.
4) Avoid creating a second member-file write path.
5) Add regression coverage proving one member can complete more than one signed care plan without document-source collision.

Validation:
- Run npm run typecheck.
- Run targeted care plan signature tests.
- Report migration impact, backfill/compatibility plan, and downstream consumers affected by the new document-source contract.

Do not overengineer. Keep the fix maintainable and auditable.
```

### Issue 8. Verify and repair the intake -> POF and signed POF -> MHP handoffs at the canonical service boundary
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
The workflow simulation audit still cannot prove the canonical `physician_orders` write in the intake -> draft POF and signed POF -> MHP handoffs. This may be a real missing write or a scanner blind spot, but right now the workflow lacks hard proof.

Scope:
- Domain/workflow: intake assessment -> draft physician order, and signed physician order -> MHP sync
- Canonical entities/tables: intake_assessments, physician_orders, pof_requests, member_health_profiles
- Expected canonical write path: UI/public action -> service layer -> canonical physician-order service/RPC -> Supabase

Inspect first:
- lib/services/intake-pof-mhp-cascade.ts
- lib/services/physician-orders-supabase.ts
- app/(portal)/health/physician-orders/actions.ts
- app/sign/pof/[token]/actions.ts
- workflow simulation report evidence for these handoffs
- any existing tests that prove physician_orders persistence

Required approach:
1) Verify the current handoff end-to-end before changing behavior.
2) If the canonical physician_orders write already happens, add regression tests or stronger workflow evidence so the audit can prove it and stop flagging a false blocker.
3) If the write is missing, bypassed, or not durably proven, route the handoff through the existing canonical physician-order service/RPC path.
4) Preserve current signed POF downstream sync behavior and Supabase-first persistence.
5) Do not paper over the issue in the UI. The proof or fix must live at the service/workflow boundary.

Validation:
- Run npm run typecheck.
- Run targeted intake/POF/MHP workflow tests.
- Report whether this was a true bug or an audit-proof gap, and list the files/tests changed.

Do not overengineer. Keep the fix maintainable and explicit.
```

### Issue 9. Align notifications and action return truth with real readiness state
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Some Memory Lane workflows now correctly preserve committed-but-follow-up-needed truth, but notifications and some server-action catch paths still overstate readiness or return `ok: true` in ways that can look fully successful when the canonical workflow is degraded or failed.

Scope:
- Domain/workflow: signed POF/care plan readiness messaging and high-risk operational action return contracts
- Canonical entities/tables: physician_orders, pof_requests, care_plans, care_plan_signature_events, user_notifications, workflow result payloads that surface readiness
- Expected canonical read path: persisted readiness state/resolver -> notification/action/UI consumer

Inspect first:
- lib/services/notification-content.ts
- lib/services/pof-post-sign-runtime.ts
- lib/services/care-plan-esign-public.ts
- app/care-plan-actions.ts
- app/intake-actions.ts
- app/sales-lead-actions.ts
- workflow audit lines that flag catch branches returning ok:true

Required approach:
1) Reuse the same persisted readiness state or readiness resolver that the workflows already use.
2) Make signed notifications impossible to read as fully ready when post-sign follow-up is queued, degraded, or action-required.
3) Audit the highest-risk `ok: true` catch-return paths and remove false-success behavior where the canonical workflow did not actually complete.
4) Preserve committed-but-follow-up-needed truth; do not convert committed writes into hard failures unless the primary write itself failed.
5) Add focused tests around notification content and at least one previously false-success action path.

Validation:
- Run npm run typecheck.
- Run targeted notification and workflow-result tests.
- Report changed files and any remaining intentionally staged workflows that still return committed-but-not-ready truth.

Do not overengineer. Keep the fix maintainable and auditable.
```

### Issue 10. Fix the highest-value performance bottlenecks without reopening read-path drift
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
The latest query audit still shows three confirmed missing indexes, a heavy sales dashboard summary RPC, and an overly broad billing summary read path. These are founder-facing performance costs, but the fix must preserve one canonical read boundary per domain instead of reintroducing split query families.

Scope:
- Domain/workflow: sales dashboard, billing dashboard summary, admin audit trail, partner/referral directories
- Canonical entities/tables: leads, community_partner_organizations, referral_sources, audit_logs, billing dashboard source tables already used by the summary path
- Expected canonical read path: shared service or RPC boundary -> Supabase

Inspect first:
- supabase/migrations/0209_sales_dashboard_summary_lead_count_slimming.sql
- lib/services/sales-workflows.ts
- lib/services/sales-crm-read-model.ts
- lib/services/billing-read-supabase.ts
- lib/services/billing-preview-helpers.ts
- lib/services/admin-audit-trail.ts

Required approach:
1) Keep the sales dashboard behind one canonical RPC boundary.
2) Add forward-only migration(s) for the three confirmed missing indexes:
   - audit_logs(created_at desc)
   - community_partner_organizations(organization_name)
   - referral_sources(organization_name)
3) Slim the sales dashboard summary RPC so it does not rebuild unnecessary founder summary state from broad full-table work on each request.
4) Separate billing headline summary math from heavier preview/queue/batch reads so the founder-facing summary does not pay invoice-preview costs every time.
5) Preserve current displayed numbers and existing founder-facing filters.
6) Add focused regression coverage or proof that summary outputs did not change.

Validation:
- Run npm run typecheck.
- Run targeted billing/sales/admin tests.
- Report new migrations, changed read boundaries, and any intentionally deferred first-load fan-out issues.

Do not overengineer. Keep the fix maintainable and auditable.
```

## 3. Fix Priority Order

1. Harden the Supabase database boundary first: RPC execute grants plus broad RLS policies.
2. Make public submit throttling atomic and remove MCC hydrate-then-filter overfetch.
3. Stop replay-safe public signing from deleting committed clinical artifacts.
4. Add compare-and-set guards for enrollment resend and POF resend/void.
5. Make enrollment packet completion durably truthful.
6. Fail closed on unsafe existing-member relink during lead conversion.
7. Make care plan final signed file identity care-plan-specific.
8. Verify and repair the intake -> POF and signed POF -> MHP handoffs at the canonical service boundary.
9. Align notifications and action return truth with real readiness state.
10. Fix the highest-value performance bottlenecks without reopening read-path drift.

## 4. Founder Summary

The May 10 audit set still shows a small number of real production blockers rather than broad platform collapse. Production-readiness itself was clean, and the older canonicality/schema/resolver reports did not add a fresh code bug today. The highest-signal issues came from security, ACID, idempotency, workflow simulation, and query performance.

The most urgent work is still at the trust boundary. Supabase grants and broad RLS policies are still too permissive in places that matter, public enrollment submit throttling is still raceable, and Member Command Center detail still has one privileged overfetch path. Those are database-boundary and least-privilege issues, not UI polish issues.

After that, the biggest workflow blockers are still replay safety and stale-state transitions. Public POF and care-plan signing can still delete already-committed artifacts on replay. Enrollment resend and POF resend/void still trust stale pre-read state too much. Enrollment packet completion also still returns success before all required downstream truth is durably aligned.

The remaining work is important but second-tier: add a DB-side fail-closed guard for lead conversion member relinking, make care plan final signed file identity care-plan-specific, verify the intake -> POF handoff with real canonical proof, align readiness messaging with real persisted readiness, and then clean up the top founder-facing performance hot spots without reopening read-path drift.
