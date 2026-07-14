# Fix Prompt Generator - 2026-06-15

Source reports reviewed:
- `docs/audits/supabase-rls-security-audit-2026-05-12.md`
- `docs/audits/production-readiness-audit-2026-05-12.md`
- `docs/audits/daily-canonicality-sweep-raw-2026-03-27.json`
- `docs/audits/schema-migration-safety-audit-2026-04-02.md`
- `docs/audits/shared-resolver-drift-check-2026-03-29.md`
- `docs/audits/rpc-architecture-audit-2026-03-24.md`
- `docs/audits/acid-transaction-audit-2026-05-12.md`
- `docs/audits/idempotency-duplicate-submission-audit-2026-05-10.md`
- `docs/audits/workflow-simulation-audit-2026-05-12.md`
- `docs/audits/supabase-query-performance-audit-2026-05-12.md`

Notes:
- There are no newer source audit reports than the May 2026 set above for the requested domains.
- `production-readiness-audit-2026-05-12.md` stayed clean in scoped runtime domains and did not add a new implementation defect.
- `daily-canonicality-sweep-raw-2026-03-27.json`, `schema-migration-safety-audit-2026-04-02.md`, and `shared-resolver-drift-check-2026-03-29.md` did not add a fresh open runtime bug in the current backlog. They were used as guardrails so prompts do not introduce drift.
- The latest standalone shared RPC artifact is still `docs/audits/rpc-architecture-audit-2026-03-24.md`. It is only used where newer May audits still point at the same boundary problem.

## 1. Issues Detected

### 1. Database authorization is still too open below the app layer
- Architectural rule violated:
  - preserve role restrictions and data integrity
  - Supabase-first authorization
  - migration-driven schema
- Safest fix approach:
  - Enable RLS on `sites`, `lookup_lists`, and `punches_linked_time_punch_review`.
  - Revoke `authenticated` execute from the highest-risk `SECURITY DEFINER` RPCs unless a caller-facing use case truly requires it.
  - Where an RPC must remain callable, add explicit in-function caller validation that matches the canonical service boundary.
  - Tighten the remaining broad authenticated RLS policies on intake, member support, care plan, enrollment staging, follow-up, locker, and pricing tables.

### 2. Public enrollment and public signing paths still lack one canonical abuse-protection boundary
- Architectural rule violated:
  - public workflows must be replay-safe and abuse-resistant
  - shared validation rules should stay canonical
  - protected storage writes must remain deterministic and auditable
- Safest fix approach:
  - Reuse the canonical `member-files` allowlist in public enrollment uploads.
  - Replace count-then-record submit throttling with one atomic claim path.
  - Add comparable token/IP throttling to public POF and care plan signing before expensive finalize work starts.

### 3. Member Command Center still overfetches restricted file rows before permission filtering
- Architectural rule violated:
  - least-privilege reads
  - role boundaries must be enforced before data hydration
  - shared read models should not overfetch restricted data
- Safest fix approach:
  - Refactor the MCC detail read so non-clinical viewers never fetch restricted `member_files` rows with privileged access before category filtering.
  - Preserve the canonical MCC runtime/read-model boundary and make the smallest read-path change.

### 4. Public POF and care-plan replay losers can still destroy committed artifacts
- Architectural rule violated:
  - ACID atomicity and isolation
  - idempotency and replay safety
  - workflow state integrity
- Safest fix approach:
  - Keep finalize RPCs authoritative.
  - Make replay-safe `was_already_signed` branches read-only for canonical artifact paths.
  - If cleanup remains, restrict it to attempt-scoped temporary artifacts only.

### 5. Enrollment resend and POF resend/void still trust stale pre-read state
- Architectural rule violated:
  - idempotency and replay safety
  - workflow state integrity
  - one canonical transition path per workflow
- Safest fix approach:
  - Add compare-and-set validation inside the locked RPC boundary.
  - Reject resend/void when the row already moved to a terminal or incompatible state.
  - Prevent stale losers from emitting duplicate emails, events, or contradictory state transitions.

### 6. Enrollment packet completion truth is still split across commit and post-commit repair
- Architectural rule violated:
  - ACID durability
  - shared RPC standard for lifecycle-critical workflows
  - explicit failure when downstream persistence or truth recording fails
- Safest fix approach:
  - Either widen the durable completion owner or create one durable repair-owner record that becomes the truth boundary for artifacts, linkage, notifications, and mapping.
  - Make fallback `action_required` truth fail closed if it cannot be durably recorded.

### 7. Lead conversion still accepts unsafe existing-member relinks at the DB boundary
- Architectural rule violated:
  - canonical entity identity
  - consistency requirements
  - fail closed on identity mismatch
- Safest fix approach:
  - Fix the DB function boundary, not just the TypeScript caller.
  - Accept `p_existing_member_id` only when it already belongs to the same lead or satisfies one explicitly safe shell-member rule.

### 8. Care plan final signed file identity can still collide across multiple plans for one member
- Architectural rule violated:
  - schema/runtime alignment
  - canonical document identity
  - migration-driven schema
- Safest fix approach:
  - Replace the shared final-signed care-plan `document_source` with a deterministic care-plan-specific value.
  - Keep the canonical `member_files` write boundary and add forward-only compatibility handling.

### 9. Workflow truth is still overstated in notifications, catch-return paths, and one physician-order proof gap
- Architectural rule violated:
  - workflow state integrity
  - auditability
  - do not return synthetic success when durable truth is degraded or unknown
- Safest fix approach:
  - Drive notifications from persisted readiness resolvers.
  - Remove or narrow false-success `ok: true` catch paths in high-risk actions.
  - Verify whether the workflow simulation `physician_orders` gap is a real write-path bug or missing regression proof, then fix the true boundary.

### 10. Founder-facing read paths still have unresolved scaling hot spots and five confirmed missing indexes
- Architectural rule violated:
  - keep one canonical read boundary per domain where possible
  - avoid unnecessarily broad Supabase reads
  - preserve maintainable shared read models
- Safest fix approach:
  - Add the five confirmed missing indexes first.
  - Then slim the sales dashboard summary RPC, decouple billing summary cards from heavy preview reads, reduce first-render exact counts, and narrow remaining wide export/read helpers.

## 2. Codex Fix Prompts

### Issue 1. Harden the database authorization boundary
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
The database boundary is still too permissive. Three repo-defined tables still lack RLS, several clinical/operational tables still allow overly broad authenticated access, and multiple SECURITY DEFINER RPCs are still executable by authenticated users without repo-visible caller validation inside the function.

Scope:
- Domain/workflow: Supabase authorization boundary hardening
- Canonical entities/tables: discover from the latest RLS audit first, then confirm in migrations
- Expected canonical write path: UI/public action -> service layer -> service-role-only RPC or in-function auth guard -> Supabase

Inspect first:
- docs/audits/supabase-rls-security-audit-2026-05-12.md
- supabase/migrations/0001_initial_schema.sql
- supabase/migrations/0017_reseed_schema_alignment.sql
- supabase/migrations/0073_delivery_and_member_file_rpc_hardening.sql
- supabase/migrations/0152_enrollment_packet_lifecycle_and_voiding.sql
- supabase/migrations/0180_enrollment_completion_follow_up_state.sql
- supabase/migrations/0212_care_plan_caregiver_prepare_terminal_guard.sql

Required approach:
1) Inspect migrations first, not only TypeScript callers.
2) Enable RLS on sites, lookup_lists, and punches_linked_time_punch_review with explicit policies matching real runtime access.
3) Revoke authenticated execute from the highest-risk SECURITY DEFINER RPCs unless a direct authenticated caller is truly required.
4) Where a function must stay callable, add explicit auth.uid()/permission checks inside the function body that align to the canonical service boundary.
5) Tighten broad RLS policies on intake, member support, care-plan, enrollment staging/mapping, follow-up, locker, and pricing tables.
6) Preserve current canonical service paths and server-only privileged access patterns.
7) Add focused regression coverage for one blocked direct-RPC path and one allowed canonical service path.

Validation:
- Run npm run typecheck.
- Report migrations changed, RPC grants changed, and any live-project follow-up needed.

Do not overengineer. Keep the fix explicit, auditable, and Supabase-first.
```

### Issue 2. Unify public workflow validation and add atomic abuse throttling
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Public enrollment uploads still use a wider allowlist than the canonical internal member-file validator, enrollment submit throttling is still count-then-record under concurrency, and public POF/care-plan signing still lacks comparable token/IP throttling before finalize work begins.

Scope:
- Domain/workflow: public enrollment uploads/submits, public POF signing, public care-plan signing
- Canonical entities/tables: enrollment_packet_requests, enrollment_packet_uploads, member_files, public signing request tables/events
- Expected canonical write path: public action -> service layer -> canonical validation/throttle boundary -> Supabase

Inspect first:
- docs/audits/supabase-rls-security-audit-2026-05-12.md
- app/sign/enrollment-packet/[token]/actions.ts
- lib/services/member-files.ts
- lib/services/enrollment-packet-public-helpers.ts
- lib/services/enrollment-packets-public-runtime-artifacts.ts
- lib/services/pof-esign-public.ts
- lib/services/care-plan-esign-public.ts

Required approach:
1) Reuse the canonical member-file MIME/type allowlist in the public enrollment artifact path.
2) Replace count-then-record enrollment throttling with one atomic Supabase claim/reject path.
3) Add equivalent token/IP throttling to public POF and care-plan signature flows before expensive finalization work begins.
4) Keep validation and throttling in the service/database boundary, not UI code or in-memory fallbacks.
5) Add regression coverage for blocked disallowed file types, concurrent enrollment submits, and public signature abuse throttling.

Validation:
- Run npm run typecheck.
- Report any new migration/RPC added and the exact canonical validation helper reused.

Do not overengineer. Keep the fix maintainable and auditable.
```

### Issue 3. Remove privileged MCC file overfetch
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Member Command Center detail still hydrates member_files with privileged access and only filters them after hydration for non-clinical viewers. That is both a least-privilege gap and unnecessary read-cost overhead.

Scope:
- Domain/workflow: Member Command Center detail reads
- Canonical entities/tables: member_files, members, MCC detail read model/runtime
- Expected canonical read path: MCC page -> shared read model/service -> permission-aware Supabase read

Inspect first:
- docs/audits/supabase-rls-security-audit-2026-05-12.md
- lib/services/member-command-center-detail-read-model.ts
- lib/services/member-command-center-runtime.ts
- tests/member-command-center-privileged-read.test.ts

Required approach:
1) Identify exactly where member_files are loaded before permission/category gating.
2) Refactor the read path so non-clinical viewers never fetch restricted rows they are not allowed to see.
3) Preserve the canonical MCC shared service boundary and current allowed-category behavior.
4) Reuse any existing permission-aware file query helper instead of creating a second read path.
5) Add regression coverage proving non-clinical viewers cannot hydrate restricted rows and clinical viewers still see expected files.

Validation:
- Run npm run typecheck.
- Run targeted MCC permission tests.
- Report changed files and any remaining intentional service-role read surfaces in MCC.

Do not overengineer. Keep the fix least-privilege and maintainable.
```

### Issue 4. Stop replay-safe public signing from deleting committed artifacts
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Public POF signing and public care-plan caregiver signing can still overwrite and then delete already-committed signed artifacts on replay. The losing request hits an already-signed finalize result but still touches deterministic canonical artifact paths.

Scope:
- Domain/workflow: public POF signing and public care-plan caregiver signing
- Canonical entities/tables: pof_requests, pof_signatures, care_plans, care_plan_signature_events, member_files, member-documents storage artifacts
- Expected canonical write path: public action -> service layer -> finalize RPC -> Supabase

Inspect first:
- docs/audits/acid-transaction-audit-2026-05-12.md
- docs/audits/idempotency-duplicate-submission-audit-2026-05-10.md
- lib/services/pof-esign-public.ts
- lib/services/care-plan-esign-public.ts
- lib/services/clinical-esign-artifacts.ts
- supabase/migrations/0053_artifact_drift_replay_hardening.sql

Required approach:
1) Confirm where replay-safe finalize results still trigger writes/cleanup on deterministic canonical paths.
2) Preserve current finalize RPC boundaries and replay guards.
3) Make was_already_signed / wasAlreadySigned branches strictly read-only for canonical committed artifact paths.
4) If cleanup must remain, only delete temp attempt-scoped artifacts proven to belong to the losing request.
5) Add regression tests that fail if replay-safe branches touch the winner's canonical signed artifacts.

Validation:
- Run npm run typecheck.
- Run targeted replay tests for public POF signing and care-plan caregiver signing.
- Report changed files and any remaining artifact cleanup edge cases.

Do not overengineer. Keep the fix maintainable and auditable.
```

### Issue 5. Add compare-and-set guards for resend and void transitions
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Enrollment packet resend can still reset a completed packet back to draft, and POF resend/void can still overwrite a request that was signed after the staff pre-read. The app pre-read is not enough because the locked write boundary still trusts stale state too much.

Scope:
- Domain/workflow: enrollment packet resend, POF resend, POF void
- Canonical entities/tables: enrollment_packet_requests, enrollment_packet_events, pof_requests, pof_signatures, document_events
- Expected canonical write path: UI -> Server Action -> service layer -> compare-and-set RPC/transaction boundary -> Supabase

Inspect first:
- docs/audits/idempotency-duplicate-submission-audit-2026-05-10.md
- lib/services/enrollment-packet-management.ts
- lib/services/enrollment-packets-send-runtime.ts
- supabase/migrations/0152_enrollment_packet_lifecycle_and_voiding.sql
- lib/services/pof-esign.ts
- lib/services/pof-request-runtime.ts
- supabase/migrations/0080_pof_request_delivery_rpc_insert_alignment.sql
- supabase/migrations/0098_false_failure_read_path_hardening.sql

Required approach:
1) Preserve the existing canonical resend/void service paths.
2) Add expected-current-state validation inside the locked RPC boundary for enrollment resend and POF resend/void.
3) Reject resend/void when the canonical row is already completed, expired, voided, signed, or otherwise incompatible.
4) Ensure stale losers do not emit misleading downstream events, duplicate sender signatures, duplicate resend emails, or contradictory POF events.
5) Add regression coverage for stale pre-read -> external completion/signature -> resend/void execution.

Validation:
- Run npm run typecheck.
- Run targeted enrollment packet and POF transition tests.
- Report migration changes, RPC contract changes, and caller updates.

Do not overengineer. Keep the fix maintainable and auditable.
```

### Issue 6. Make enrollment packet completion durably truthful
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Enrollment packet completion still marks the packet completed before finalized artifacts, member-file linkage, notifications, and downstream mapping are durably aligned. The fallback builder can also still return action_required truth even if that status failed to persist.

Scope:
- Domain/workflow: enrollment packet public completion and post-commit recovery
- Canonical entities/tables: enrollment_packet_requests, enrollment_packet_events, enrollment_packet_uploads, enrollment_packet_signatures, enrollment_packet_mapping_runs, enrollment_packet_follow_up_queue, member_files
- Expected canonical write path: public action -> service layer -> RPC/transaction boundary -> Supabase

Inspect first:
- docs/audits/acid-transaction-audit-2026-05-12.md
- docs/audits/workflow-simulation-audit-2026-05-12.md
- lib/services/enrollment-packets-public-runtime.ts
- lib/services/enrollment-packets-public-runtime-post-commit.ts
- lib/services/enrollment-packets-public-runtime-artifacts.ts
- lib/services/enrollment-packets-public-runtime-cascade.ts
- lib/services/enrollment-packets-public-runtime-follow-up.ts
- supabase/migrations/0180_enrollment_completion_follow_up_state.sql

Required approach:
1) Identify the minimum safe truth boundary that makes returned completion truth match durable Supabase truth.
2) Either move required artifact/linkage work inside the durable completion owner, or persist one explicit durable repair-owner record before success is returned.
3) Make fallback follow-up handling fail closed if the system cannot durably record fallback action_required truth.
4) Preserve current replay protections and canonical packet persistence rules.
5) Add regression coverage for committed packet + failed artifact persistence, committed packet + failed follow-up persistence, and replay after committed completion.

Validation:
- Run npm run typecheck.
- Run targeted enrollment packet completion tests.
- Report changed files, migration/RPC impact, and the chosen durable truth boundary.

Do not overengineer. Keep the fix maintainable and auditable.
```

### Issue 7. Fail closed on unsafe existing-member relink during lead conversion
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
The lead conversion database boundary still trusts p_existing_member_id too much. A privileged bad call can supply an unrelated member id and relink that row to the wrong lead.

Scope:
- Domain/workflow: lead conversion
- Canonical entities/tables: leads, members, lead_stage_history, lead_activities
- Expected canonical write path: UI -> Server Action -> service layer -> conversion RPC/function -> Supabase

Inspect first:
- docs/audits/acid-transaction-audit-2026-05-12.md
- supabase/migrations/0158_lead_conversion_shell_success_guard.sql
- lib/services/sales-lead-conversion-supabase.ts

Required approach:
1) Preserve the current canonical conversion RPC/function boundary.
2) Add a DB assertion so p_existing_member_id must either already belong to the same lead, be null, or satisfy one explicitly allowed safe-unlinked-shell condition.
3) Fail closed when a caller supplies an unrelated member id.
4) Keep app-layer canonical identity resolution intact, but do not rely on it as the only protection.
5) Add regression coverage for one valid existing-member path and one invalid cross-lead relink attempt.

Validation:
- Run npm run typecheck.
- Run targeted sales conversion tests.
- Report migration changes, rollout order, and any data preflight needed.

Do not overengineer. Keep the fix maintainable and auditable.
```

### Issue 8. Make care-plan final signed file identity care-plan-specific
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Care-plan final signed files still use one shared document_source per member, but the schema enforces unique (member_id, document_source). A member with more than one signed care plan can hit a durable collision.

Scope:
- Domain/workflow: care-plan final signed artifact persistence
- Canonical entities/tables: care_plans, care_plan_signature_events, member_files
- Expected canonical write path: care-plan finalize flow -> canonical member-files boundary -> Supabase

Inspect first:
- docs/audits/acid-transaction-audit-2026-05-12.md
- supabase/migrations/0053_artifact_drift_replay_hardening.sql
- supabase/migrations/0091_member_files_document_source_unique.sql
- lib/services/care-plan-esign-public.ts
- lib/services/clinical-esign-artifacts.ts

Required approach:
1) Keep the current finalize RPC/member-files contract authoritative.
2) Replace the shared final-signed care-plan document_source with a care-plan-specific deterministic source that is stable and auditable.
3) Add any required forward-only migration or compatibility update so existing signed care plans still resolve correctly.
4) Avoid creating a second member-file write path.
5) Add regression coverage proving one member can complete more than one signed care plan without document-source collision.

Validation:
- Run npm run typecheck.
- Run targeted care-plan signature tests.
- Report migration impact, backfill/compatibility plan, and downstream consumers affected.

Do not overengineer. Keep the fix maintainable and auditable.
```

### Issue 9. Align notifications, action returns, and physician-order handoff proof with real workflow truth
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Some notifications and server-action catch paths still overstate workflow readiness or return ok: true when the canonical workflow is degraded or failed. Separately, the workflow simulation audit still cannot prove the canonical physician_orders write in the intake -> draft POF and signed POF -> MHP handoffs.

Scope:
- Domain/workflow: signed POF/care-plan readiness messaging, high-risk action return contracts, intake -> POF handoff proof, signed POF -> MHP handoff proof
- Canonical entities/tables: physician_orders, pof_requests, care_plans, care_plan_signature_events, user_notifications
- Expected canonical path: persisted readiness state/resolver and canonical physician-order service boundary -> consumers

Inspect first:
- docs/audits/acid-transaction-audit-2026-05-12.md
- docs/audits/workflow-simulation-audit-2026-05-12.md
- lib/services/notification-content.ts
- app/care-plan-actions.ts
- app/intake-actions.ts
- app/sales-lead-actions.ts
- lib/services/intake-pof-mhp-cascade.ts
- lib/services/physician-orders-supabase.ts

Required approach:
1) Reuse the same persisted readiness state or readiness resolver that the workflows already use.
2) Make signed notifications impossible to read as fully ready when post-sign follow-up is queued, degraded, or action-required.
3) Audit the highest-risk ok: true catch-return paths and remove false-success behavior where the canonical workflow did not actually complete.
4) Verify the physician_orders handoffs end-to-end. If the write already exists, add regression proof so the audit stops flagging a false blocker. If the write is missing or bypassed, route the handoff through the canonical physician-order service/RPC boundary.
5) Preserve committed-but-follow-up-needed truth; do not convert committed writes into hard failures unless the primary write itself failed.

Validation:
- Run npm run typecheck.
- Run targeted notification, action-return, intake, POF, and MHP workflow tests.
- Report whether the physician_orders issue was a real bug or an audit-proof gap.

Do not overengineer. Keep the fix maintainable and auditable.
```

### Issue 10. Fix the highest-value performance bottlenecks without reopening read-path drift
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
The latest query audit still shows five confirmed missing indexes, a heavy sales dashboard summary RPC, a billing summary path coupled to heavyweight preview reads, exact-count costs on first render, and continued overfetch in shared member/MCC/export paths. The fix must preserve one canonical read boundary per domain instead of reintroducing split query families.

Scope:
- Domain/workflow: sales dashboard, billing dashboard summary, admin audit trail, partner/referral directories, member detail/MCC, MAR, billing exports
- Canonical entities/tables: audit_logs, community_partner_organizations, referral_sources, member_allergies, billing_export_jobs, leads, billing summary source tables, shared member detail/read-model tables
- Expected canonical read path: shared service or RPC boundary -> Supabase

Inspect first:
- docs/audits/supabase-query-performance-audit-2026-05-12.md
- supabase/migrations/0209_sales_dashboard_summary_lead_count_slimming.sql
- lib/services/sales-workflows.ts
- lib/services/billing-read-supabase.ts
- lib/services/billing-preview-helpers.ts
- lib/services/member-list-read.ts
- lib/services/member-detail-read-model.ts
- lib/services/member-command-center-runtime.ts
- lib/services/admin-audit-trail.ts
- lib/services/billing-exports.ts

Required approach:
1) Keep the sales dashboard behind one canonical RPC boundary.
2) Add forward-only migration(s) for the five confirmed missing indexes first.
3) Slim the sales dashboard summary RPC so it stops doing unnecessary whole-table work on each request.
4) Separate billing headline summary math from heavier preview/queue/batch reads so founder-facing cards do not pay invoice-preview costs every time.
5) Reduce first-render exact counts and overfetch where the page does not truly need them, while preserving canonical service boundaries and current UI outputs.
6) Replace remaining wide export/read helpers with explicit field lists where safe.

Validation:
- Run npm run typecheck.
- Run targeted billing/sales/admin tests.
- Report new migrations, changed read boundaries, and any intentionally deferred issues.

Do not overengineer. Keep the fix maintainable and auditable.
```

## 3. Fix Priority Order

1. Harden the database authorization boundary.
2. Unify public workflow validation and add atomic abuse throttling.
3. Remove privileged MCC file overfetch.
4. Stop replay-safe public signing from deleting committed artifacts.
5. Add compare-and-set guards for resend and void transitions.
6. Make enrollment packet completion durably truthful.
7. Fail closed on unsafe existing-member relink during lead conversion.
8. Make care-plan final signed file identity care-plan-specific.
9. Align notifications, action returns, and physician-order handoff proof with real workflow truth.
10. Fix the highest-value performance bottlenecks without reopening read-path drift.

## 4. Founder Summary

The most recent audit set still points to the same real launch blockers: the database boundary is too permissive, public workflows are not yet abuse-safe enough, replay-safe public signing is still not actually artifact-safe, and enrollment completion still does not have one durable truth boundary for all required downstream work.

The good news is that the production-readiness audit did not surface a new runtime mock, schema drift, or parallel write-path problem in the audited domains. The daily canonicality sweep, schema migration safety audit, and shared resolver drift check also did not add a fresh open bug to the current backlog. That means the prompt set above is focused on active defects, not stale audit noise.

If you want the smallest safe execution order, fix the database boundary and public-entry-point protections first, then remove replay artifact deletion, then close the stale-transition and split-commit issues. After that, clean up the lead-conversion identity guard, care-plan signed-file identity, workflow truth messaging, and the confirmed performance hotspots.
