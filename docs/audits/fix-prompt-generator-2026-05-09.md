# Fix Prompt Generator - 2026-05-09

Source reports used:
- `docs/audits/supabase-rls-security-audit-2026-05-06.md`
- `docs/audits/production-readiness-audit-2026-05-09.md`
- `docs/audits/daily-canonicality-sweep-raw-2026-03-27.json`
- `docs/audits/schema-migration-safety-audit-2026-04-02.md`
- `docs/audits/shared-resolver-drift-check-2026-03-29.md`
- `docs/audits/rpc-architecture-audit-2026-03-24.md`
- `docs/audits/acid-transaction-audit-2026-05-09.md`
- `docs/audits/idempotency-duplicate-submission-audit-2026-05-09.md`
- `docs/audits/workflow-simulation-audit-2026-05-07.md`
- `docs/audits/supabase-query-performance-audit-2026-05-09.md`

Notes:
- Some required audit families still do not have a fresher dated artifact in `docs/audits`. This report uses the latest available file for those families instead of inventing newer findings.
- The 2026-05-09 production-readiness audit was clean in the audited domains and did not add a new implementation bug to promote.
- The latest available daily canonicality, schema migration safety, and shared resolver drift artifacts did not surface a fresh open runtime defect for today. They remain useful guardrails and source-of-truth checks, but they are not the highest-signal prompt sources for this run.

## 1. Issues Detected

### 1. Public signing replay can still delete already-committed clinical artifacts
Architectural rule violated:
- ACID transaction requirements
- idempotency and replay safety
- workflow state integrity

Safest fix approach:
- Keep the current finalize RPCs authoritative.
- Make replay-safe `was_already_signed` branches read-only.
- Never clean up deterministic canonical signed paths unless the request can prove the files are orphaned temp artifacts created by that losing request.

Audit basis:
- `acid-transaction-audit-2026-05-09.md`
- `idempotency-duplicate-submission-audit-2026-05-09.md`

### 2. Enrollment packet resend and POF resend/void still allow stale-state regressions
Architectural rule violated:
- idempotency and replay safety
- canonical service write paths
- workflow state integrity

Safest fix approach:
- Push compare-and-set state validation into the locked RPC boundary, not just the app pre-read.
- Refuse resend/void once the canonical row has already moved to a terminal or incompatible state.
- Keep one canonical transition path per workflow and prevent downstream event emission on stale losers.

Audit basis:
- `idempotency-duplicate-submission-audit-2026-05-09.md`

### 3. Enrollment packet completion is still a split commit
Architectural rule violated:
- ACID durability requirements
- shared RPC standard
- one canonical write path per workflow

Safest fix approach:
- Either move required finalized artifact persistence and linkage under the canonical completion owner, or persist one explicit durable repair-owner record before success is returned.
- Make follow-up truth fail closed if the repair/follow-up state itself cannot be durably recorded.

Audit basis:
- `acid-transaction-audit-2026-05-09.md`
- `workflow-simulation-audit-2026-05-07.md`

### 4. Lead conversion still trusts `p_existing_member_id` too much
Architectural rule violated:
- canonical entity identity
- consistency requirements
- fail closed on identity mismatch

Safest fix approach:
- Fix the DB boundary, not only the app caller.
- Add a DB assertion so an existing member id is only accepted when it already belongs to the same lead or satisfies an explicitly safe reuse condition.

Audit basis:
- `acid-transaction-audit-2026-05-09.md`

### 5. Intake and public enrollment security boundaries are still too broad
Architectural rule violated:
- preserve role restrictions
- Supabase-first authorization
- canonical service write paths with explicit permission enforcement

Safest fix approach:
- Preserve the new app-layer intake permission hardening already in progress.
- Tighten RLS and public token boundaries next: permission-aware intake policies, expired-parent-token rejection before completed-download minting, and atomic submit throttling.
- Remove privileged hydrate-then-filter reads where non-clinical users should never hydrate those rows at all.

Audit basis:
- `supabase-rls-security-audit-2026-05-06.md`
- `production-readiness-audit-2026-05-09.md`

### 6. Care plan final signed file identity is still not safe for multiple signed plans per member
Architectural rule violated:
- canonical entity identity
- schema/runtime alignment
- migration-driven schema

Safest fix approach:
- Replace the shared final signed care-plan `document_source` with a deterministic care-plan-specific source.
- Keep the canonical member-files write boundary and add migration-safe compatibility handling.

Audit basis:
- `acid-transaction-audit-2026-05-09.md`

### 7. Workflow truth is still overstated in notifications and some action return paths
Architectural rule violated:
- workflow state integrity
- auditability
- do not return synthetic success when required downstream truth is degraded or unknown

Safest fix approach:
- Drive readiness messaging from the same persisted readiness state or resolver used by the workflow.
- Remove or narrow `ok: true` catch-return patterns in high-risk operational actions where failures should not look complete.
- Keep committed-but-follow-up-needed truth distinct from full readiness.

Audit basis:
- `acid-transaction-audit-2026-05-09.md`
- `workflow-simulation-audit-2026-05-07.md`

### 8. Founder-facing read paths still have clear performance hotspots and missing indexes
Architectural rule violated:
- one canonical read path per domain where possible
- shared resolver/read-model boundaries
- avoid duplicate or unnecessarily broad Supabase reads

Safest fix approach:
- Add the three confirmed missing indexes first.
- Then slim the sales dashboard summary RPC and split billing homepage summary math away from heavyweight preview workloads.
- Preserve current canonical RPC/service boundaries instead of reintroducing split reads.

Audit basis:
- `supabase-query-performance-audit-2026-05-09.md`
- `rpc-architecture-audit-2026-03-24.md`

## 2. Codex Fix Prompts

### Issue 1. Stop replay cleanup from deleting committed POF and care-plan artifacts
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Public POF signing and public care plan caregiver signing can still delete already-committed signed files on replay. The losing request uploads deterministic canonical paths, the finalize RPC returns an already-signed result, and the replay branch still cleans up those same canonical files.

Scope:
- Domain/workflow: Public POF signing and public care plan caregiver signing
- Canonical entities/tables: pof_requests, pof_signatures, care_plans, care_plan_signature_events, member_files, member-documents storage artifacts
- Expected canonical write path: Public action -> service layer -> finalize RPC -> Supabase

Inspect first:
- lib/services/pof-esign-public.ts
- lib/services/care-plan-esign-public.ts
- lib/services/clinical-esign-artifacts.ts
- supabase/migrations/0053_artifact_drift_replay_hardening.sql
- existing public signing replay tests

Required approach:
1) Confirm exactly where replay-safe finalize results still trigger cleanup on deterministic canonical paths.
2) Preserve the current finalize RPC boundaries and replay guards.
3) Change replay handling so `was_already_signed` / `wasAlreadySigned` never deletes the winning committed canonical artifacts.
4) If cleanup must remain, only delete files that can be proven to be orphaned temp files created by the losing request.
5) Prefer unique temporary upload paths before finalize if that is the smallest clean fix across both workflows.
6) Keep member-file linkage and current signed-result return shape intact.
7) Add regression tests for near-simultaneous replay on both public POF signing and care plan caregiver signing.

Validation:
- Run npm run typecheck.
- Run targeted signing replay tests.
- Report changed files, whether temp-path migration was needed, and any remaining artifact-cleanup edge cases.

Do not overengineer. Keep the fix maintainable and auditable.
```

### Issue 2. Add compare-and-set resend/void guards for enrollment packets and POF
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Enrollment packet resend can still reset a now-completed packet back to draft, and POF resend/void can still overwrite a request that was signed after the staff pre-read. The app pre-read is not enough; the locked write boundary still trusts stale state too much.

Scope:
- Domain/workflow: Enrollment packet resend, POF resend, POF void
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
5) Keep real deliberate resend history where appropriate, but prevent race-driven regressions and duplicate-side-effect drift.
6) Add regression coverage for staff pre-read -> external completion/signature -> stale resend/void execution.

Validation:
- Run npm run typecheck.
- Run targeted enrollment packet and POF transition tests.
- Report migration changes, RPC contract changes, and any caller updates needed.

Do not overengineer. Keep the fix maintainable and auditable.
```

### Issue 3. Make enrollment packet completion durably truthful
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Enrollment packet completion still marks the packet completed before finalized artifacts, member-file linkage, notifications, and downstream mapping are durably aligned. That leaves the canonical packet row ahead of the operationally required follow-up work.

Scope:
- Domain/workflow: Enrollment packet public completion and post-commit recovery
- Canonical entities/tables: enrollment_packet_requests, enrollment_packet_events, enrollment_packet_uploads, enrollment_packet_signatures, enrollment_packet_mapping_runs, enrollment_packet_follow_up_queue, member_files
- Expected canonical write path: Public action -> service layer -> RPC/transaction boundary -> Supabase

Inspect first:
- lib/services/enrollment-packets-public-runtime.ts
- lib/services/enrollment-packets-public-runtime-post-commit.ts
- lib/services/enrollment-packets-public-runtime-artifacts.ts
- lib/services/enrollment-packets-public-runtime-cascade.ts
- lib/services/enrollment-packets-public-runtime-follow-up.ts
- supabase/migrations/0180_enrollment_completion_follow_up_state.sql
- existing enrollment packet completion tests

Required approach:
1) Identify the minimum safe boundary that makes returned completion truth match durable Supabase truth.
2) Either move required finalized artifact/linkage work into the durable completion boundary, or persist one explicit repair-owner record before success is returned and make that record the canonical source of follow-up truth.
3) Make follow-up failure handling fail closed if the system cannot durably record follow-up status.
4) Preserve current replay protections and canonical packet persistence rules.
5) Add targeted regression tests for committed packet + failed artifact persistence, committed packet + failed follow-up persistence, and replay after committed completion.

Validation:
- Run npm run typecheck.
- Run targeted enrollment packet tests.
- Report changed files, migration/RPC impact, and the chosen truth boundary.

Do not overengineer. Keep the fix maintainable and auditable.
```

### Issue 4. Fail closed on unsafe existing-member relink during lead conversion
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
The lead conversion database boundary still trusts `p_existing_member_id` too much. A privileged bad call can supply an unrelated member id and the function can relink that row to the wrong lead.

Scope:
- Domain/workflow: Lead conversion
- Canonical entities/tables: leads, members, lead_stage_history, lead_activities
- Expected canonical write path: UI -> Server Action -> service layer -> conversion RPC/function -> Supabase

Inspect first:
- supabase/migrations/0158_lead_conversion_shell_success_guard.sql
- the current definition of `apply_lead_stage_transition_with_member_upsert`
- lib/services/sales-lead-conversion-supabase.ts
- any tests covering existing-member conversion paths

Required approach:
1) Preserve the current canonical conversion RPC/function boundary.
2) Add a DB assertion so `p_existing_member_id` must either already belong to the same lead, be null, or satisfy one explicitly allowed safe-unlinked condition.
3) Fail closed when a caller supplies an unrelated member id.
4) Keep app-layer canonical identity resolution intact, but do not rely on it as the only protection.
5) Add regression coverage for a valid existing-member path and for an invalid cross-lead relink attempt.

Validation:
- Run npm run typecheck.
- Run targeted sales conversion tests.
- Report migration changes, rollout order, and any data backfill or preflight needed.

Do not overengineer. Keep the fix maintainable and auditable.
```

### Issue 5. Tighten intake and public enrollment security at the database boundary
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Recent app-layer hardening improved intake action/page permissions, but the database and public workflow boundaries are still too broad. Intake tables still use overly permissive RLS, expired enrollment-packet parent tokens can still mint completed-download tokens, public submit throttling is still raceable, and Member Command Center detail still has at least one privileged hydrate-then-filter file path.

Scope:
- Domain/workflow: Intake Assessment, public enrollment packet confirmation/submit, MCC least-privilege reads
- Canonical entities/tables: intake_assessments, assessment_responses, intake_assessment_signatures, enrollment_packet_requests, enrollment_packet_events, enrollment_packet_follow_up_queue, member_files
- Expected canonical write path: UI/public action -> service layer -> permission-aware RLS or RPC boundary -> Supabase

Inspect first:
- intake-related RLS migrations
- app/(portal)/health/assessment/page.tsx
- app/(portal)/health/assessment/[assessmentId]/page.tsx
- app/intake-actions.ts
- lib/services/enrollment-packets-public-runtime-context.ts
- lib/services/enrollment-packets-public-runtime-artifacts.ts
- app/sign/enrollment-packet/[token]/confirmation/page.tsx
- lib/services/enrollment-packet-public-helpers.ts
- lib/services/member-command-center-runtime.ts
- lib/services/member-command-center-detail-read-model.ts

Required approach:
1) Preserve the new app-layer intake permission checks already present in the workspace.
2) Replace broad intake RLS with permission-aware predicates or service-only boundaries that match the true clinical access model.
3) Reject expired parent tokens before any completed-download token can be minted.
4) Move public submit throttling into an atomic Supabase RPC or transaction-backed claim path so concurrent requests cannot bypass it.
5) Refactor MCC detail reads so non-clinical viewers do not hydrate privileged member_files rows and then filter afterward.
6) Add focused tests for unauthorized intake access, expired completed-download token minting, and concurrent public submit throttling.

Validation:
- Run npm run typecheck.
- Run targeted security/permission tests.
- Report policy changes, migration changes, and any remaining intentional service-role usage.

Do not overengineer. Keep the fix maintainable and auditable.
```

### Issue 6. Make care plan final signed file identity care-plan-specific
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Care plan final signed files still use one shared `document_source = 'Care Plan Final Signed'` per member, but the schema enforces unique `(member_id, document_source)`. A member with more than one signed care plan can hit a durable collision.

Scope:
- Domain/workflow: Care plan final signed artifact persistence
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
2) Replace the shared final-signed care-plan `document_source` contract with a care-plan-specific source that remains deterministic and auditable.
3) Add any required forward-only migration or runtime compatibility update so existing signed care plans still resolve correctly.
4) Avoid creating a second parallel member-file write path.
5) Add regression coverage proving one member can complete more than one signed care plan without document-source collision.

Validation:
- Run npm run typecheck.
- Run targeted care plan signature tests.
- Report migration impact, backfill/compatibility plan, and downstream consumers affected by the new document source contract.

Do not overengineer. Keep the fix maintainable and auditable.
```

### Issue 7. Align workflow notifications and action truth with real readiness state
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Some Memory Lane workflows now correctly preserve committed-but-follow-up-needed truth, but notifications and some server actions still overstate readiness or return `ok: true` from catch paths in ways that can look fully successful when the canonical workflow is degraded or failed.

Scope:
- Domain/workflow: Signed POF/care plan readiness messaging and high-risk operational action return contracts
- Canonical entities/tables: physician_orders, pof_requests, user_notifications, care_plans, care_plan_signature_events, any workflow result payloads that surface readiness or completion
- Expected canonical read path: service-layer readiness resolver/status -> notification/UI/action consumer

Inspect first:
- lib/services/notification-content.ts
- lib/services/pof-post-sign-runtime.ts
- lib/services/physician-order-clinical-sync.ts
- lib/services/care-plan-esign-public.ts
- app/intake-actions.ts
- app/sales-lead-actions.ts
- app/care-plan-actions.ts
- workflow audit lines that flag `catch` branches returning `ok: true`

Required approach:
1) Use the same persisted readiness truth or readiness resolver that the workflows already use.
2) Make signed notifications impossible to read as fully ready when post-sign follow-up is queued, degraded, or action-required.
3) Audit the highest-risk `ok: true` catch-return paths and remove false-success behavior where the canonical workflow did not actually complete.
4) Preserve committed-but-follow-up-needed truth; do not convert committed writes into hard failures unless the primary write itself failed.
5) Add focused tests around notification content and at least one previously false-success action path.

Validation:
- Run npm run typecheck.
- Run targeted workflow-result and notification tests.
- Report changed files and any remaining follow-up-needed workflows still using older messaging contracts.

Do not overengineer. Keep the fix maintainable and auditable.
```

### Issue 8. Fix the highest-value performance bottlenecks without reopening read-path drift
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
The latest query audit still shows three confirmed index gaps, a heavy sales dashboard summary RPC, and an overly broad billing summary read path. These are founder-facing performance costs, but the fix must preserve one canonical read boundary per domain instead of reintroducing split query families.

Scope:
- Domain/workflow: Sales dashboard, billing dashboard summary, admin audit trail, partner/referral directories
- Canonical entities/tables: leads, lead_activities, community_partner_organizations, referral_sources, audit_logs, billing batches/charges/settings used by the dashboard summary
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
3) Slim the sales dashboard summary RPC so it does not rebuild unnecessary global summary state from broad full-table work on each request.
4) Separate billing headline summary math from the heavier preview/queue/batch reads so the founder-facing summary does not pay invoice-generation-grade costs every time.
5) Preserve current displayed numbers and existing founder-facing filters.
6) Add focused regression coverage or snapshot proof for unchanged summary outputs.

Validation:
- Run npm run typecheck.
- Run targeted billing/sales/admin tests.
- Report new migrations, changed read boundaries, and any intentionally deferred first-load fan-out issues.

Do not overengineer. Keep the fix maintainable and auditable.
```

## 3. Fix Priority Order

1. Stop replay cleanup from deleting committed POF and care-plan artifacts.
2. Add compare-and-set resend/void guards for enrollment packets and POF.
3. Make enrollment packet completion durably truthful.
4. Fail closed on unsafe existing-member relink during lead conversion.
5. Tighten intake and public enrollment security at the database boundary.
6. Make care plan final signed file identity care-plan-specific.
7. Align workflow notifications and action truth with real readiness state.
8. Fix the highest-value performance bottlenecks without reopening read-path drift.

## 4. Founder Summary

The May 9 audit set is still concentrated around a small number of real production risks, not broad platform instability. Production-readiness itself was clean, and the stale canonicality/schema/resolver audit families did not add a fresh bug today. The new signal came mainly from ACID, idempotency, security, workflow simulation, and query performance.

The top blockers are still replay safety and stale-state transition safety. Public POF and care plan signing can still delete already-committed files on replay. Enrollment packet resend and POF resend/void still trust stale pre-read state too much, so a staff retry can regress a row that already moved forward canonically. Enrollment packet completion also still returns success before all required follow-up truth is durably aligned.

After those blockers, the next work is about boundary hardening and clean operational truth. Lead conversion still needs a DB-side fail-closed guard on `p_existing_member_id`. Intake/public enrollment still need tighter Supabase-side authorization and token handling. Care plan final signed file identity still needs one schema-safe fix. Then the remaining high-value work is performance: add the three confirmed indexes, slim the sales dashboard RPC, and split billing homepage summaries away from heavy preview reads.
