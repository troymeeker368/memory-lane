# Fix Prompt Generator - 2026-05-08

Source reports used:
- `docs/audits/supabase-rls-security-audit-2026-05-06.md`
- `docs/audits/production-readiness-audit-2026-05-08.md`
- `docs/audits/workflow-simulation-audit-founder-2026-05-08.md`
- `docs/audits/schema-migration-safety-audit-2026-04-02.md`
- `docs/audits/shared-resolver-drift-check-2026-03-29.md`
- `docs/audits/rpc-architecture-audit-2026-03-24.md`
- `docs/audits/acid-transaction-audit-2026-05-08.md`
- `docs/audits/idempotency-duplicate-submission-audit-2026-03-29.md`
- `docs/audits/daily-canonicality-sweep-raw-2026-03-27.json`
- `docs/audits/supabase-query-performance-audit-2026-05-08.md`

Notes:
- Some required audit families do not have a newer dated artifact in `docs/audits`. This report uses the latest available file for those families.
- The 2026-05-08 production-readiness audit materially closed several older prompts, including the duplicate billing batch fetch, care-plan preview split reads, referral normalization drift, MCC privileged list-boundary drift, and intake action/page permission hardening. Those were not promoted again here.
- The schema migration safety audit did not identify a new repo-side schema/runtime drift bug. It still matters as deployment verification, but it is not one of the highest-signal implementation prompts for this run.

## 1. Issues Detected

### 1. Public signing replay can delete already-committed clinical artifacts
Architectural rule violated:
- ACID transaction requirements
- idempotency and replay safety
- do not return synthetic success when downstream persistence can be invalidated after commit

Safest fix approach:
- Keep the existing RPC-backed finalize boundary authoritative.
- Stop replay branches from deleting deterministic canonical storage paths after `was_already_signed` / `wasAlreadySigned`.
- Prefer temporary upload paths or explicit orphan-only cleanup if the code can prove which files were created by the losing request.

Audit basis:
- `acid-transaction-audit-2026-05-08.md`

### 2. Enrollment packet completion still has split-commit truth and an unclear conversion handoff
Architectural rule violated:
- workflow state integrity
- shared RPC standard
- ACID durability requirements
- one canonical write path per workflow

Safest fix approach:
- Keep one canonical enrollment completion boundary.
- Either move finalized artifact persistence, member-file linkage, and required downstream mapping under the durable completion boundary, or persist one canonical repair owner before success is returned.
- Separately decide whether packet completion should automatically trigger formal lead conversion, then wire that rule canonically instead of leaving the activity wording and conversion trigger mismatched.

Audit basis:
- `acid-transaction-audit-2026-05-08.md`
- `workflow-simulation-audit-founder-2026-05-08.md`

### 3. Lead conversion still trusts `p_existing_member_id` too much at the database boundary
Architectural rule violated:
- canonical entity identity
- consistency requirements
- fail closed on identity mismatch

Safest fix approach:
- Fix the database function, not just the app caller.
- Add a DB assertion so `p_existing_member_id` must already belong to the same lead, or be explicitly eligible for safe reuse, otherwise the RPC fails closed.

Audit basis:
- `acid-transaction-audit-2026-05-08.md`

### 4. Intake and enrollment public security boundaries are still too broad in Supabase
Architectural rule violated:
- preserve role restrictions
- Supabase-first authorization
- canonical service write paths with explicit permission enforcement

Safest fix approach:
- Keep the recent app-layer intake permission hardening.
- Tighten the database layer next: replace broad intake RLS, reject expired parent token reuse before completed-download minting, and move public submit throttling into an atomic claim boundary.
- Remove privileged hydrate-then-filter patterns where non-clinical actors should never receive the rows in the first place.

Audit basis:
- `supabase-rls-security-audit-2026-05-06.md`
- `production-readiness-audit-2026-05-08.md`

### 5. Workflow messaging and action truth still overstate readiness in some committed-but-degraded states
Architectural rule violated:
- workflow state integrity
- auditability
- do not let UI truth drift from canonical workflow truth

Safest fix approach:
- Use the same readiness resolver or persisted status that the workflow already uses.
- Signed POF notifications must not claim readiness while post-sign sync is still queued or degraded.
- Review action/UI consumers that still treat `ok: true` as full completion when the service layer is returning follow-up-needed truth.

Audit basis:
- `acid-transaction-audit-2026-05-08.md`
- `workflow-simulation-audit-founder-2026-05-08.md`

### 6. Care plan signed-file identity is still not safe for multiple signed plans per member
Architectural rule violated:
- canonical entity identity
- schema/runtime alignment
- migration-driven schema

Safest fix approach:
- Change the final signed care-plan `document_source` contract so it is unique per care plan, not one shared label per member.
- Keep the member-files boundary canonical and migration-backed.

Audit basis:
- `acid-transaction-audit-2026-05-08.md`

### 7. Founder-facing query paths still have confirmed scaling hotspots and missing indexes
Architectural rule violated:
- one canonical read path per domain where possible
- shared resolver/read-model boundaries
- avoid duplicate or unnecessarily broad Supabase reads

Safest fix approach:
- Keep the canonical RPC/service boundary in place.
- First add the three confirmed missing indexes.
- Then slim the sales dashboard summary RPC and separate billing summary math from the heavier preview/read families.
- Revisit exact counts and broad first-load fan-out only after the clear index and summary-boundary wins are in place.

Audit basis:
- `supabase-query-performance-audit-2026-05-08.md`
- `rpc-architecture-audit-2026-03-24.md`

## 2. Codex Fix Prompts

### Issue 1. Stop replay cleanup from deleting committed POF and care-plan artifacts
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Public POF signing and public care plan caregiver signing can delete already-committed signed files on replay. The losing request uploads deterministic canonical paths, the finalize RPC returns an already-signed result, and the replay branch still cleans up those same canonical files.

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

### Issue 2. Make enrollment packet completion and conversion handoff canonically truthful
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Enrollment packet completion still finalizes the packet before finalized artifacts, member-file linkage, and downstream mapping are fully durably aligned. Separately, packet completion writes the activity outcome `Enrollment Packet Completed`, but automatic conversion logic still listens for different outcome wording, so staff-facing enrollment truth and formal conversion truth can drift.

Scope:
- Domain/workflow: Enrollment packet completion, post-commit repair, and lead-conversion handoff
- Canonical entities/tables: enrollment_packet_requests, enrollment_packet_events, enrollment_packet_uploads, enrollment_packet_signatures, enrollment_packet_mapping_runs, enrollment_packet_follow_up_queue, lead_activities, leads, members, member_files
- Expected canonical write path: Public action -> service layer -> RPC/transaction boundary -> Supabase

Inspect first:
- lib/services/enrollment-packets-public-runtime.ts
- lib/services/enrollment-packets-public-runtime-post-commit.ts
- lib/services/enrollment-packets-public-runtime-artifacts.ts
- lib/services/enrollment-packets-public-runtime-cascade.ts
- lib/services/enrollment-packets-public-runtime-follow-up.ts
- lib/services/enrollment-packet-completion-cascade.ts
- lib/services/sales-lead-activities.ts
- supabase/migrations/0180_enrollment_completion_follow_up_state.sql
- existing enrollment packet completion tests

Required approach:
1) Identify the minimum safe boundary that makes returned completion truth match durable Supabase truth.
2) Either move required finalized artifact/linkage work into the durable completion boundary, or persist one explicit repair-owner record before success is returned and make that record the canonical follow-up truth.
3) Make fallback follow-up truth fail closed if the root row cannot be updated, or persist one durable repair source of truth instead of logging-and-continuing.
4) Decide whether packet completion should automatically trigger formal lead conversion. If yes, wire that handoff canonically. If no, make the activity outcome and downstream conversion trigger language consistent so the manual boundary is explicit.
5) Preserve current replay protections and existing packet data persistence.
6) Add targeted regression tests for committed packet + failed follow-up persistence, committed packet + missing finalized artifact path, and packet completion -> lead activity -> conversion handoff truth.

Validation:
- Run npm run typecheck.
- Run targeted enrollment packet tests.
- Report changed files, migration/RPC impact, and whether automatic conversion was implemented or the manual boundary was clarified instead.

Do not overengineer. Keep the fix maintainable and auditable.
```

### Issue 3. Fail closed on unsafe existing-member relink during lead conversion
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

### Issue 4. Tighten remaining intake and public enrollment security at the database boundary
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Recent app-layer hardening improved intake page/action permissions, but the database and public workflow boundaries are still too broad. Intake tables still use overly permissive RLS, expired enrollment-packet parent tokens can still mint completed-download tokens, public submit throttling is still raceable, and some Member Command Center detail reads still overfetch privileged rows before filtering.

Scope:
- Domain/workflow: Intake Assessment, public enrollment packet confirmation/submit, MCC least-privilege reads
- Canonical entities/tables: intake_assessments, assessment_responses, intake_assessment_signatures, enrollment_packet_requests, enrollment_packet_events, enrollment_packet_follow_up_queue, member_files
- Expected canonical write path: UI/public action -> service layer -> permission-aware RLS or RPC boundary -> Supabase

Inspect first:
- supabase migrations that define intake RLS
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
1) Preserve the new app-layer intake permission checks already added in the current workspace.
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

### Issue 5. Align workflow messaging and UI truth with real readiness state
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Some Memory Lane workflows now correctly preserve committed-but-follow-up-needed truth, but user-facing notifications and some action/UI consumers still overstate readiness. The clearest confirmed case is signed POF messaging claiming documents are ready while post-sign sync is still queued or degraded.

Scope:
- Domain/workflow: Signed POF post-sign readiness messaging and related committed-truth consumers
- Canonical entities/tables: physician_orders, pof_requests, pof_post_sign_sync_queue, user_notifications, any workflow result payloads that surface readiness
- Expected canonical read path: service-layer readiness resolver -> notification/UI consumer

Inspect first:
- lib/services/notification-content.ts
- lib/services/physician-order-post-sign-service.ts
- lib/services/physician-order-clinical-sync.ts
- lib/services/pof-post-sign-runtime.ts
- the highest-risk UI/action consumers that currently key off `ok: true` without checking follow-up/readiness fields

Required approach:
1) Use the same persisted readiness truth or readiness resolver that the post-sign workflow already uses.
2) Make signed POF notifications and related banners impossible to read as fully ready when post-sign sync is queued or degraded.
3) Audit the highest-risk consumer paths and make sure committed-but-follow-up-needed states are rendered distinctly from true completion.
4) Preserve committed truth; do not turn committed-but-degraded states into hard failure unless the write did not commit.
5) Add focused tests around notification content and at least one consumer that previously treated `ok: true` as full readiness.

Validation:
- Run npm run typecheck.
- Run targeted POF and workflow-result tests.
- Report changed files and any remaining workflows that still need the same readiness-truth pattern.

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

### Issue 7. Fix the highest-value performance bottlenecks without reopening read-path drift
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
The latest query audit still shows three confirmed index gaps, a heavy sales dashboard summary RPC, and an overly broad billing summary read path. These are founder-facing performance costs, but the fix must preserve one canonical read boundary per domain instead of reintroducing split query families.

Scope:
- Domain/workflow: Sales dashboard, billing dashboard summary, admin audit trail, partner/referral directories
- Canonical entities/tables: leads, lead_activities, community_partner_organizations, referral_sources, audit_logs, billing_batches, billing_export_jobs, billing adjustments/charges used by the dashboard summary
- Expected canonical read path: shared service or RPC boundary -> Supabase

Inspect first:
- supabase/migrations/0209_sales_dashboard_summary_lead_count_slimming.sql
- lib/services/sales-workflows.ts
- lib/services/billing-read-supabase.ts
- lib/services/billing-preview-helpers.ts
- lib/services/admin-audit-trail.ts
- lib/services/sales-crm-read-model.ts

Required approach:
1) Keep the sales dashboard behind one canonical RPC boundary.
2) Add forward-only migration(s) for the three confirmed missing indexes:
   - audit_logs(created_at desc)
   - community_partner_organizations(organization_name)
   - referral_sources(organization_name)
3) Slim the sales dashboard summary RPC so it does not rebuild unnecessary global summary state from broad full-table work on each request.
4) Separate billing headline summary math from the heavier preview/queue/batch reads so the founder-facing summary does not pay for invoice-generation-grade data every time.
5) Preserve current displayed numbers and existing founder-facing filters.
6) Add focused regression coverage or snapshot proof for unchanged summary outputs.

Validation:
- Run npm run typecheck.
- Run targeted billing/sales/admin tests.
- Report new migrations, changed read boundaries, and any intentionally deferred first-load fan-out issues.

Do not overengineer. Keep the fix maintainable and auditable.
```

## 3. Fix Priority Order

1. Stop replay cleanup from deleting committed POF and care-plan artifacts
2. Make enrollment packet completion and conversion handoff canonically truthful
3. Fail closed on unsafe existing-member relink during lead conversion
4. Tighten remaining intake and public enrollment security at the database boundary
5. Align workflow messaging and UI truth with real readiness state
6. Make care plan final signed file identity care-plan-specific
7. Fix the highest-value performance bottlenecks without reopening read-path drift

## 4. Founder Summary

The May 8 audit set is narrower than the older reports. Several previously open issues were already hardened in the current workspace, so the remaining prompts are concentrated around true launch-risk items instead of general cleanup.

The biggest production blockers are now very specific. Two public signing flows can still delete already-committed clinical files on replay. Enrollment packet completion still has split-commit truth, and the handoff from packet completion to formal conversion is still semantically muddy. Lead conversion itself also still needs one fail-closed database assertion so a bad privileged call cannot relink the wrong member.

The next layer is security and operational truth. Intake permissions improved at the app layer on May 8, but the database policies and public enrollment boundaries still need hardening. Signed POF messaging also still overstates readiness in queued/degraded states. After those are fixed, the remaining work is mostly contained performance hardening and one care-plan member-file identity correction.
