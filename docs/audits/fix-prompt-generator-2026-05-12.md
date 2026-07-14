# Fix Prompt Generator - 2026-05-12

Source reports used:
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
- The 2026-05-12 production-readiness audit stayed clean in its scoped domains and did not add a new implementation defect to promote.
- The latest available daily canonicality sweep, schema migration safety audit, and shared resolver drift check did not introduce a fresh open runtime bug for today. They were still used as guardrails to avoid inventing duplicate work.
- The latest standalone shared RPC architecture artifact is still `2026-03-24`. I only carried it forward where newer May audits still point at the same boundary problem.
- This run removes stale carryover findings that the May 12 RLS audit explicitly marked as already hardened in later migrations.

## 1. Issues Detected

### 1. Database authorization is still too open below the app layer
Architectural rule violated:
- preserve role restrictions and data integrity
- Supabase-first authorization
- migration-driven schema
- canonical service write paths

Safest fix approach:
- Revoke `authenticated` execute from the highest-risk `SECURITY DEFINER` RPCs first, or add strict in-function caller validation where those RPCs must remain callable.
- Tighten the remaining broad RLS policies on intake, member support, care-plan diagnosis/signature history, enrollment staging/mapping, follow-up queue, locker history, and pricing tables.
- Add RLS to the three repo-defined tables still missing it: `sites`, `lookup_lists`, and `punches_linked_time_punch_review`.

Audit basis:
- `supabase-rls-security-audit-2026-05-12.md`

### 2. Public enrollment and signature entry points still need one canonical abuse-protection boundary
Architectural rule violated:
- public workflows must be replay-safe and abuse-resistant
- shared validation rules should stay canonical
- protected storage writes must remain deterministic and auditable

Safest fix approach:
- Reuse the canonical `member-files` allowlist in the public enrollment upload path instead of keeping a wider public-only list.
- Move enrollment submit throttling into one atomic claim path.
- Add equivalent token/IP throttling to public POF and care-plan signature flows before expensive finalization work begins.

Audit basis:
- `supabase-rls-security-audit-2026-05-12.md`

### 3. Member Command Center still performs a privileged file hydrate before permission filtering
Architectural rule violated:
- least-privilege reads
- role boundaries must be enforced before data hydration
- shared read models should not overfetch restricted data

Safest fix approach:
- Refactor the MCC detail file-read path so non-clinical viewers never fetch restricted `member_files` rows with service-role access before category filtering.
- Preserve the canonical MCC runtime/read-model boundary and make the smallest read-path change that removes privileged overfetch.

Audit basis:
- `supabase-rls-security-audit-2026-05-12.md`
- `supabase-query-performance-audit-2026-05-12.md`

### 4. Public POF and care-plan replay losers can still destroy already-committed artifacts
Architectural rule violated:
- ACID atomicity and isolation
- idempotency and replay safety
- workflow state integrity

Safest fix approach:
- Keep the current finalize RPCs authoritative.
- Make replay-safe `was_already_signed` branches strictly read-only for canonical artifact paths.
- Only clean up attempt-scoped temporary artifacts, never the deterministic committed paths.

Audit basis:
- `acid-transaction-audit-2026-05-12.md`
- `idempotency-duplicate-submission-audit-2026-05-10.md`

### 5. Enrollment resend and POF resend/void still trust stale pre-read state too much
Architectural rule violated:
- idempotency and replay safety
- workflow state integrity
- one canonical transition path per workflow

Safest fix approach:
- Add compare-and-set validation inside the locked RPC boundary.
- Reject resend or void transitions when the row has already moved into a terminal or incompatible state.
- Prevent stale losers from sending duplicate emails, duplicate events, or contradictory state transitions.

Audit basis:
- `idempotency-duplicate-submission-audit-2026-05-10.md`

### 6. Enrollment packet completion truth is still split across commit and post-commit recovery
Architectural rule violated:
- ACID durability
- shared RPC standard for lifecycle-critical workflows
- explicit failure when downstream persistence or truth recording fails

Safest fix approach:
- Either widen the durable completion owner or create one explicit durable repair-owner record that becomes the truth boundary for artifact persistence, linkage, notifications, and mapping.
- Make fallback `action_required` truth fail closed if it cannot be durably recorded.

Audit basis:
- `acid-transaction-audit-2026-05-12.md`
- `workflow-simulation-audit-2026-05-12.md`
- `rpc-architecture-audit-2026-03-24.md`

### 7. Lead conversion still accepts unsafe existing-member relinks in the DB boundary
Architectural rule violated:
- canonical entity identity
- consistency requirements
- fail closed on identity mismatch

Safest fix approach:
- Fix the DB function boundary, not just the TypeScript caller.
- Accept `p_existing_member_id` only when it already belongs to the same lead or satisfies one explicitly safe shell-member rule.

Audit basis:
- `acid-transaction-audit-2026-05-12.md`

### 8. Care plan final signed file identity can still collide across multiple signed plans for one member
Architectural rule violated:
- schema/runtime alignment
- canonical document identity
- migration-driven schema

Safest fix approach:
- Replace the shared final-signed care-plan `document_source` with a deterministic care-plan-specific value.
- Keep the canonical `member_files` write boundary and add migration-safe compatibility handling for existing rows.

Audit basis:
- `acid-transaction-audit-2026-05-12.md`

### 9. Workflow truth is still overstated in notifications, some catch-return paths, and one simulation handoff proof gap
Architectural rule violated:
- workflow state integrity
- auditability
- do not return synthetic success when durable truth is degraded or unknown

Safest fix approach:
- Drive notifications from the same persisted readiness resolvers used by runtime workflows.
- Remove or narrow false-success `ok: true` catch paths in high-risk actions.
- Verify whether the workflow simulation `physician_orders` gap is a true bug or an audit-proof gap, then either route the handoff through the canonical physician-order service or add regression proof.

Audit basis:
- `acid-transaction-audit-2026-05-12.md`
- `workflow-simulation-audit-2026-05-12.md`

### 10. Founder-facing read paths still have unresolved scaling hot spots and five confirmed missing indexes
Architectural rule violated:
- keep one canonical read boundary per domain where possible
- avoid unnecessarily broad Supabase reads
- preserve maintainable shared read models

Safest fix approach:
- Add the five confirmed missing indexes first.
- Then slim the sales dashboard summary RPC, decouple billing headline summaries from heavy preview reads, reduce first-render exact counts, and narrow remaining wide export/read helpers.
- Preserve canonical service/RPC read boundaries instead of creating split query families.

Audit basis:
- `supabase-query-performance-audit-2026-05-12.md`
- `rpc-architecture-audit-2026-03-24.md`

## 2. Codex Fix Prompts

### Issue 1. Harden the Supabase database boundary: missing RLS, broad policies, and authenticated-executable SECURITY DEFINER RPCs
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Several high-risk SECURITY DEFINER RPCs are still executable by authenticated users, several live tables still have broad authenticated RLS that does not match the app's real clinical/operational permission model, and three repo-defined tables still do not have RLS enabled. App-layer checks are not enough if a signed-in user can call Supabase directly.

Scope:
- Domain/workflow: database authorization boundary hardening
- Canonical entities/tables: sites, lookup_lists, punches_linked_time_punch_review, intake_assessments, assessment_responses, intake_assessment_signatures, member_photo_uploads, member_providers, member_equipment, member_notes, care_plan_diagnoses, care_plan_signature_events, enrollment_packet_pof_staging, enrollment_packet_mapping_runs, enrollment_packet_mapping_records, enrollment_packet_follow_up_queue, locker_assignment_history, enrollment_pricing_community_fees, enrollment_pricing_daily_rates
- High-risk RPCs to inspect first: rpc_upsert_member_file_by_source, rpc_delete_member_file_record, rpc_prepare_care_plan_caregiver_request, rpc_prepare_enrollment_packet_request, rpc_transition_enrollment_packet_delivery_state, rpc_save_enrollment_packet_progress, rpc_finalize_enrollment_packet_submission, rpc_void_enrollment_packet_request, rpc_prepare_pof_request_delivery, rpc_transition_pof_request_delivery_state
- Expected canonical write path: UI/public action -> service layer -> service-role-only RPC or in-function auth guard -> Supabase

Required approach:
1) Inspect migrations first, not only TypeScript callers.
2) Enable RLS on sites, lookup_lists, and punches_linked_time_punch_review with explicit policies that match real runtime access.
3) Revoke authenticated execute from the highest-risk SECURITY DEFINER RPCs unless there is a clear caller-facing use case that must remain supported.
4) Where a function must stay callable, add explicit auth.uid()/permission checks inside the function body that match the canonical service boundary.
5) Tighten the remaining broad RLS policies so clinical and internal workflow rows are not broadly readable/writable by any authenticated user.
6) Preserve existing canonical service paths and server-only service-role usage. Do not move business logic into UI code.
7) Add focused regression coverage for one blocked direct-RPC path and one allowed canonical service path.

Validation:
- Run npm run typecheck.
- Report each migration changed, each table whose RLS/policy changed, and each RPC grant changed.
- Call out any live-project follow-up needed if deployed grants/policies may differ from repo migrations.

Do not overengineer. Keep the fix explicit, auditable, and aligned with Supabase-first authorization.
```

### Issue 2. Unify public workflow validation and add atomic abuse throttling
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Public enrollment packet uploads still use a wider allowlist than the canonical internal member-file validator, enrollment submit throttling is still count-then-record under concurrency, and public POF/care-plan signing still lacks comparable pre-finalization abuse throttling.

Scope:
- Domain/workflow: public enrollment uploads and submits, public POF signing, public care-plan signing
- Canonical entities/tables: enrollment_packet_requests, enrollment_packet_uploads, member_files, public signing request tables/events
- Expected canonical write path: public action -> service layer -> canonical validation/throttle boundary -> Supabase

Inspect first:
- app/sign/enrollment-packet/[token]/actions.ts
- lib/services/member-files.ts
- lib/services/enrollment-packet-public-helpers.ts
- lib/services/enrollment-packets-public-runtime-artifacts.ts
- lib/services/pof-esign-public.ts
- lib/services/care-plan-esign-public.ts

Required approach:
1) Reuse the canonical member-file MIME/type allowlist in the public enrollment artifact path instead of keeping a separate wider public list.
2) Replace count-then-record enrollment throttling with one atomic Supabase claim/reject path under concurrency.
3) Add equivalent token/IP throttling to public POF and care-plan signature flows before expensive finalization work begins.
4) Keep all validation and throttling in the service/database boundary, not UI code or in-memory fallbacks.
5) Add regression coverage for blocked disallowed file types, concurrent enrollment submits, and basic abuse throttling on the other public signature flows.

Validation:
- Run npm run typecheck.
- Report any new migration/RPC added for throttling and the exact canonical validation helper reused.
- Call out remaining live-environment follow-up if storage rules or rate-limit tables need deployment verification.

Do not overengineer. Keep the fix maintainable and auditable.
```

### Issue 3. Remove privileged MCC file overfetch and enforce least-privilege at query time
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Member Command Center detail still hydrates full member_files rows with service-role access and only filters them after hydration for non-clinical viewers. That is both a least-privilege security gap and an unnecessary read-cost hotspot.

Scope:
- Domain/workflow: Member Command Center detail reads
- Canonical entities/tables: member_files, members, MCC detail read model/runtime
- Expected canonical read path: MCC page -> shared read model/service -> permission-aware Supabase read

Inspect first:
- lib/services/member-command-center-detail-read-model.ts
- lib/services/member-command-center-runtime.ts
- any shared permission-aware member-file query helpers
- tests/member-command-center-privileged-read.test.ts

Required approach:
1) Identify exactly where member_files are loaded before permission/category gating.
2) Refactor the read path so non-clinical viewers never fetch restricted rows they are not allowed to see.
3) Preserve the canonical MCC shared service boundary and current allowed-category behavior.
4) Reuse existing permission-aware file query helpers if they already exist instead of creating a second file-read model.
5) Add regression coverage proving non-clinical viewers cannot hydrate restricted file rows and clinical viewers still see expected files.

Validation:
- Run npm run typecheck.
- Run the targeted MCC permission tests.
- Report changed files and any remaining intentional service-role read surfaces in MCC.

Do not overengineer. Keep the fix least-privilege and maintainable.
```

### Issue 4. Stop replay-safe public signing from overwriting or deleting committed artifacts
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Public POF signing and public care-plan caregiver signing can still overwrite and then delete already-committed signed artifacts on replay. The losing request hits an already-signed finalize result but still touches deterministic canonical artifact paths.

Scope:
- Domain/workflow: public POF signing and public care-plan caregiver signing
- Canonical entities/tables: pof_requests, pof_signatures, care_plans, care_plan_signature_events, member_files, member-documents storage artifacts
- Expected canonical write path: public action -> service layer -> finalize RPC -> Supabase

Inspect first:
- lib/services/pof-esign-public.ts
- lib/services/care-plan-esign-public.ts
- lib/services/clinical-esign-artifacts.ts
- supabase/migrations/0053_artifact_drift_replay_hardening.sql
- existing public signing replay tests

Required approach:
1) Confirm where replay-safe finalize results still trigger writes/cleanup on deterministic canonical paths.
2) Preserve the current finalize RPC boundaries and replay guards.
3) Make was_already_signed / wasAlreadySigned branches strictly read-only for canonical committed artifact paths.
4) If cleanup must remain, only delete temp attempt-scoped artifacts that can be proven to belong to the losing request.
5) Add regression tests that fail if replay-safe branches touch the winner's canonical signed artifacts.

Validation:
- Run npm run typecheck.
- Run targeted replay tests for public POF signing and care-plan caregiver signing.
- Report changed files and any remaining artifact cleanup edge cases.

Do not overengineer. Keep the fix maintainable and auditable.
```

### Issue 5. Add compare-and-set guards for enrollment resend and POF resend/void
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Enrollment packet resend can still reset a completed packet back to draft, and POF resend/void can still overwrite a request that was signed after the staff pre-read. The app pre-read is not enough because the locked write boundary still trusts stale state too much.

Scope:
- Domain/workflow: enrollment packet resend, POF resend, POF void
- Canonical entities/tables: enrollment_packet_requests, enrollment_packet_events, pof_requests, pof_signatures, document_events
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
2) Add expected-current-state validation inside the locked RPC boundary for enrollment resend and POF resend/void.
3) Reject resend/void when the canonical row is already completed, expired, voided, signed, or otherwise incompatible with the attempted transition.
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
- lib/services/enrollment-packets-public-runtime.ts
- lib/services/enrollment-packets-public-runtime-post-commit.ts
- lib/services/enrollment-packets-public-runtime-artifacts.ts
- lib/services/enrollment-packets-public-runtime-cascade.ts
- lib/services/enrollment-packets-public-runtime-follow-up.ts
- supabase/migrations/0180_enrollment_completion_follow_up_state.sql

Required approach:
1) Identify the minimum safe truth boundary that makes returned completion truth match durable Supabase truth.
2) Either move required artifact/linkage work inside the durable completion owner, or persist one explicit durable repair-owner record before success is returned and make that record the canonical follow-up truth boundary.
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
- supabase/migrations/0158_lead_conversion_shell_success_guard.sql
- the current definition of apply_lead_stage_transition_with_member_upsert
- lib/services/sales-lead-conversion-supabase.ts
- any tests covering existing-member conversion paths

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
Care-plan final signed files still use one shared document_source = 'Care Plan Final Signed' per member, but the schema enforces unique (member_id, document_source). A member with more than one signed care plan can hit a durable collision.

Scope:
- Domain/workflow: care-plan final signed artifact persistence
- Canonical entities/tables: care_plans, care_plan_signature_events, member_files
- Expected canonical write path: care-plan finalize flow -> canonical member-files boundary -> Supabase

Inspect first:
- supabase/migrations/0053_artifact_drift_replay_hardening.sql
- supabase/migrations/0091_member_files_document_source_unique.sql
- lib/services/care-plan-esign-public.ts
- lib/services/clinical-esign-artifacts.ts
- any care-plan finalization tests that touch member_files

Required approach:
1) Keep the current finalize RPC/member-files contract authoritative.
2) Replace the shared final-signed care-plan document_source with a care-plan-specific deterministic source that is stable and auditable.
3) Add any required forward-only migration or compatibility update so existing signed care plans still resolve correctly.
4) Avoid creating a second member-file write path.
5) Add regression coverage proving one member can complete more than one signed care plan without document-source collision.

Validation:
- Run npm run typecheck.
- Run targeted care-plan signature tests.
- Report migration impact, backfill/compatibility plan, and downstream consumers affected by the new document-source contract.

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
- lib/services/notification-content.ts
- lib/services/pof-post-sign-runtime.ts
- lib/services/care-plan-esign-public.ts
- app/care-plan-actions.ts
- app/intake-actions.ts
- app/sales-lead-actions.ts
- lib/services/intake-pof-mhp-cascade.ts
- lib/services/physician-orders-supabase.ts
- workflow simulation evidence around physician_orders handoffs

Required approach:
1) Reuse the same persisted readiness state or readiness resolver that the workflows already use.
2) Make signed notifications impossible to read as fully ready when post-sign follow-up is queued, degraded, or action-required.
3) Audit the highest-risk ok: true catch-return paths and remove false-success behavior where the canonical workflow did not actually complete.
4) Verify the physician_orders handoffs end-to-end. If the write already exists, add regression proof so the audit can stop flagging a false blocker. If the write is missing or bypassed, route the handoff through the canonical physician-order service/RPC boundary.
5) Preserve committed-but-follow-up-needed truth; do not convert committed writes into hard failures unless the primary write itself failed.

Validation:
- Run npm run typecheck.
- Run targeted notification, action-return, intake, POF, and MHP workflow tests.
- Report whether the physician_orders issue was a true bug or an audit-proof gap, and list files/tests changed.

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
2) Add forward-only migration(s) for the five confirmed missing indexes:
   - audit_logs(created_at desc)
   - community_partner_organizations(organization_name)
   - referral_sources(organization_name)
   - member_allergies(member_id, updated_at desc)
   - billing_export_jobs(generated_at desc, created_at desc)
3) Slim the sales dashboard summary RPC so it stops doing unnecessary whole-table work on each request.
4) Separate billing headline summary math from heavier preview/queue/batch reads so founder-facing cards do not pay invoice-preview costs every time.
5) Reduce first-render exact counts and overfetch where the page does not truly need them, while preserving canonical service boundaries and current UI outputs.
6) Replace remaining wide export/read helpers with explicit field lists where safe.

Validation:
- Run npm run typecheck.
- Run targeted billing/sales/admin tests.
- Report new migrations, changed read boundaries, and any intentionally deferred first-load fan-out issues.

Do not overengineer. Keep the fix maintainable and auditable.
```

## 3. Fix Priority Order

1. Harden the Supabase database boundary: missing RLS, broad policies, and authenticated-executable SECURITY DEFINER RPCs.
2. Unify public workflow validation and add atomic abuse throttling.
3. Remove privileged MCC file overfetch and enforce least-privilege at query time.
4. Stop replay-safe public signing from overwriting or deleting committed artifacts.
5. Add compare-and-set guards for enrollment resend and POF resend/void.
6. Make enrollment packet completion durably truthful.
7. Fail closed on unsafe existing-member relink during lead conversion.
8. Make care-plan final signed file identity care-plan-specific.
9. Align notifications, action returns, and physician-order handoff proof with real workflow truth.
10. Fix the highest-value performance bottlenecks without reopening read-path drift.

## 4. Founder Summary

The May 12 audit set keeps the same overall shape as May 11: production readiness in the audited runtime domains stayed clean, but the platform still has a concentrated set of real launch blockers below the page layer. The biggest risks remain database authorization, public workflow abuse protection, replay safety, and truthful lifecycle completion boundaries.

The clearest clarification from today is that one earlier security finding needed refinement, not escalation: the public enrollment packet upload path is validated, but it uses a wider file allowlist than the canonical internal member-file path. So the fix is to unify validation rules, not to build validation from scratch. The May 12 RLS audit also explicitly removed several older policy findings from the active-open list because later migrations already hardened them. That means the remaining open security backlog is narrower and better defined now.

The most urgent workflow defects are still replay and split-commit issues. Public POF and care-plan signing can still let a replay loser overwrite and delete winning signed artifacts. Enrollment packet completion is still durably `completed` before all required artifacts, linkage, and downstream recovery work share one truth boundary. Lead conversion still needs a DB-side fail-closed guard for `p_existing_member_id`, and care-plan final signed files still risk `document_source` collision for members with more than one signed plan.

After those are fixed, the next best return is operational truth and performance hardening: align notifications and catch-return contracts with real persisted readiness, prove or fix the physician-order simulation handoff, add the five confirmed indexes, slim the sales dashboard RPC, and decouple billing headline summaries from heavy preview reads.
