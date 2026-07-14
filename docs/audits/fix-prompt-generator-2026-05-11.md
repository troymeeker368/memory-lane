# Fix Prompt Generator - 2026-05-11

Source reports used:
- `docs/audits/supabase-rls-security-audit-2026-05-11.md`
- `docs/audits/production-readiness-audit-2026-05-11.md`
- `docs/audits/daily-canonicality-sweep-raw-2026-03-27.json`
- `docs/audits/schema-migration-safety-audit-2026-04-02.md`
- `docs/audits/shared-resolver-drift-check-2026-03-29.md`
- `docs/audits/rpc-architecture-audit-2026-03-24.md`
- `docs/audits/acid-transaction-audit-2026-05-11.md`
- `docs/audits/idempotency-duplicate-submission-audit-2026-05-10.md`
- `docs/audits/workflow-simulation-audit-2026-05-11.md`
- `docs/audits/supabase-query-performance-audit-2026-05-11.md`

Notes:
- The 2026-05-11 production-readiness audit was clean in scoped domains and did not add a new implementation defect to promote.
- The latest available daily canonicality sweep, schema migration safety audit, and shared resolver drift check did not surface a fresh open runtime bug for today. They remain guardrails and were used to avoid duplicating or inventing work.
- The latest standalone shared RPC architecture artifact is still `2026-03-24`. I only carried it forward where newer May audits still point at the same boundary problem.

## 1. Issues Detected

### 1. High-risk `SECURITY DEFINER` RPC grants and broad RLS policies still let signed-in users bypass app-layer intent
Architectural rule violated:
- preserve role restrictions and data integrity
- Supabase-first authorization
- canonical service write paths
- migration-driven schema

Safest fix approach:
- Revoke `authenticated` execute from the highest-risk `SECURITY DEFINER` RPCs first, or add strict in-function `auth.uid()` and permission checks where a public or authenticated caller truly must remain supported.
- Tighten broad legacy policies on intake, member support, care plan, enrollment internal workflow, pricing, photo, locker, and follow-up tables.
- Preserve existing service-layer boundaries and make the DB boundary match the real permission model instead of relying on UI checks.

Audit basis:
- `supabase-rls-security-audit-2026-05-11.md`

### 2. Public enrollment packet uploads and public signature flows still need stronger abuse protection
Architectural rule violated:
- public workflows must be replay-safe and abuse-resistant
- reuse canonical validation rules instead of creating split rule sets
- protected storage writes must stay auditable and deterministic

Safest fix approach:
- Reuse the canonical member-file MIME/type validation in the public enrollment packet artifact path so public submitters cannot persist arbitrary file types.
- Move enrollment packet submit throttling into one atomic database/RPC claim path.
- Add equivalent token/IP throttling to public POF and care-plan signature flows before expensive finalization work begins.

Audit basis:
- `supabase-rls-security-audit-2026-05-11.md`

### 3. Member Command Center detail still has a privileged hydrate-then-filter file-read path
Architectural rule violated:
- least-privilege reads
- role boundaries must be enforced before data hydration
- shared read models should not overfetch restricted data

Safest fix approach:
- Refactor the MCC detail file read path so non-clinical viewers never fetch restricted `member_files` rows through service role before category filtering.
- Preserve the canonical shared service/read-model boundary.
- Prefer the smallest read-model change that removes privileged overfetch instead of a large MCC rewrite.

Audit basis:
- `supabase-rls-security-audit-2026-05-11.md`
- `supabase-query-performance-audit-2026-05-11.md`

### 4. Public POF and public care-plan replay losers can still delete committed signed artifacts
Architectural rule violated:
- ACID transaction requirements
- idempotency and replay safety
- workflow state integrity

Safest fix approach:
- Keep the current finalize RPCs authoritative.
- Make replay-safe `was_already_signed` branches read-only.
- Never delete deterministic canonical signed artifact paths from a replay-safe loser branch.

Audit basis:
- `acid-transaction-audit-2026-05-11.md`
- `idempotency-duplicate-submission-audit-2026-05-10.md`

### 5. Enrollment resend and POF resend/void still trust stale pre-read state too much
Architectural rule violated:
- idempotency and replay safety
- workflow state integrity
- one canonical transition path per workflow

Safest fix approach:
- Add compare-and-set validation at the locked RPC boundary.
- Refuse stale resend or void attempts after terminal or incompatible state transitions.
- Prevent stale losers from emitting duplicate sender signatures, duplicate resend events, duplicate emails, or contradictory final states.

Audit basis:
- `idempotency-duplicate-submission-audit-2026-05-10.md`

### 6. Enrollment packet completion is still a split commit and fallback follow-up truth can still fail open
Architectural rule violated:
- ACID durability
- shared RPC standard for lifecycle-critical multi-step workflows
- explicit failure when downstream persistence or truth recording fails

Safest fix approach:
- Move more required artifact/linkage work under the completion owner, or persist one explicit durable repair-owner record before success is returned.
- Make fallback follow-up truth fail closed if the fallback `action_required` state cannot be durably recorded.
- Keep one canonical completion truth boundary.

Audit basis:
- `acid-transaction-audit-2026-05-11.md`
- `workflow-simulation-audit-2026-05-11.md`
- `rpc-architecture-audit-2026-03-24.md`

### 7. Lead conversion still trusts `p_existing_member_id` too much inside the DB boundary
Architectural rule violated:
- canonical entity identity
- consistency requirements
- fail closed on identity mismatch

Safest fix approach:
- Fix the DB function boundary, not just the TypeScript caller.
- Add an assertion so an existing member id is accepted only when it already belongs to the same lead or satisfies one explicitly safe shell-member rule.

Audit basis:
- `acid-transaction-audit-2026-05-11.md`

### 8. Care plan final signed file identity still collides across multiple signed plans for one member
Architectural rule violated:
- schema/runtime alignment
- canonical document identity
- migration-driven schema

Safest fix approach:
- Replace the shared final-signed care-plan `document_source` with a deterministic care-plan-specific source.
- Keep the canonical member-files write boundary and add migration-safe compatibility handling for existing rows.

Audit basis:
- `acid-transaction-audit-2026-05-11.md`

### 9. Workflow truth is still overstated in notifications, some catch-return paths, and one workflow simulation handoff
Architectural rule violated:
- workflow state integrity
- auditability
- do not return synthetic success when durable truth is degraded or unknown

Safest fix approach:
- Drive readiness messaging from the same persisted readiness resolvers used by the workflow.
- Remove or narrow false-success catch paths in high-risk actions.
- Verify the intake -> POF and signed POF -> MHP handoffs at the canonical physician-order boundary; if the workflow scan is a false positive, add regression proof instead of leaving the gap ambiguous.

Audit basis:
- `acid-transaction-audit-2026-05-11.md`
- `workflow-simulation-audit-2026-05-11.md`

### 10. Founder-facing read paths still have unresolved scaling hot spots and five confirmed missing indexes
Architectural rule violated:
- keep one canonical read boundary per domain where possible
- avoid unnecessarily broad Supabase reads
- preserve maintainable shared read models

Safest fix approach:
- Add the five confirmed missing indexes first.
- Then slim the sales dashboard summary RPC, split billing headline summaries away from heavyweight preview workloads, and reduce first-render overfetch/count work in shared member, MCC, MAR, and export reads.
- Preserve canonical RPC/service read boundaries and avoid reintroducing split query families.

Audit basis:
- `supabase-query-performance-audit-2026-05-11.md`
- `rpc-architecture-audit-2026-03-24.md`

## 2. Codex Fix Prompts

### Issue 1. Harden the Supabase database boundary first: RPC execute grants plus broad RLS policies
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Several high-risk SECURITY DEFINER RPCs are still executable by authenticated users, and several live tables still have broad read/write RLS that does not match the app's real clinical or operational permission model. App-layer checks are not enough if a signed-in user can call Supabase directly.

Scope:
- Domain/workflow: authorization boundary hardening
- Canonical entities/tables: intake_assessments, assessment_responses, intake_assessment_signatures, member_photo_uploads, member_providers, member_equipment, member_notes, enrollment_packet_pof_staging, enrollment_packet_mapping_runs, enrollment_packet_mapping_records, enrollment_packet_field_conflicts, enrollment_packet_follow_up_queue, care_plan_signature_events, care_plan_diagnoses, locker_assignment_history, enrollment_pricing_community_fees, enrollment_pricing_daily_rates
- High-risk RPCs to inspect first: rpc_upsert_member_file_by_source, rpc_delete_member_file_record, rpc_prepare_care_plan_caregiver_request, rpc_prepare_enrollment_packet_request, rpc_save_enrollment_packet_progress, rpc_transition_enrollment_packet_delivery_state, rpc_finalize_enrollment_packet_submission, rpc_void_enrollment_packet_request, rpc_prepare_pof_request_delivery, rpc_transition_pof_request_delivery_state
- Expected canonical write path: UI/public action -> service layer -> service-role-only RPC or in-function auth guard -> Supabase

Required approach:
1) Inspect the current grants and policies first in the migrations, not only the TypeScript callers.
2) Revoke authenticated execute from the highest-risk SECURITY DEFINER RPCs unless there is a clear public-token use case that must stay callable.
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

### Issue 2. Reuse canonical upload validation and add atomic throttling to public workflows
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Public enrollment packet uploads still accept arbitrary file types if the caller has a valid packet link, and public enrollment submit throttling is still count-then-record so concurrent requests can beat the limit. Public POF and care-plan signature flows also appear to lack comparable token/IP throttling.

Scope:
- Domain/workflow: public enrollment packet uploads, public enrollment submit throttling, public POF signing, public care-plan signing
- Canonical entities/tables: enrollment_packet_requests, enrollment_packet_uploads, member_files, member-documents storage artifacts, public signing request tables/events
- Expected canonical write path: public action -> service layer -> canonical validation/throttle boundary -> Supabase

Inspect first:
- lib/services/enrollment-packet-artifacts.ts
- lib/services/member-files.ts
- lib/services/enrollment-packet-public-helpers.ts
- lib/services/enrollment-packets-public-runtime.ts
- lib/services/pof-esign-public.ts
- lib/services/care-plan-esign-public.ts

Required approach:
1) Reuse the canonical member-file MIME/type and size validation rules in the public enrollment packet artifact path instead of inventing a second public-only rule set.
2) Replace count-then-record throttling with one atomic Supabase write path that claims or rejects the attempt under concurrency.
3) Add equivalent token/IP throttling to public POF and care-plan signature flows before expensive finalization work begins.
4) Keep all throttling and validation in the service/database boundary, not in UI code or in-memory fallback logic.
5) Add focused regression coverage for blocked disallowed file types, concurrent enrollment submits, and basic abuse throttling on the other public signature flows.

Validation:
- Run npm run typecheck.
- Report any new migration/RPC added for throttling and the exact canonical validation helper reused.
- Call out remaining live-environment follow-up if storage rules or rate-limit tables also need deployment verification.

Do not overengineer. Keep the fix maintainable and auditable.
```

### Issue 3. Remove MCC privileged file overfetch and enforce least-privilege at read time
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Member Command Center detail still reads full member_files rows with service-role access and only filters them after hydration for non-clinical viewers. That is both a least-privilege security gap and a performance smell.

Scope:
- Domain/workflow: Member Command Center detail reads
- Canonical entities/tables: member_files, members, member command center detail read model
- Expected canonical read path: MCC page -> shared read model/service -> permission-aware Supabase read

Inspect first:
- lib/services/member-command-center-detail-read-model.ts
- lib/services/member-command-center-runtime.ts
- any shared file-list helpers already used by safer MCC or member-file surfaces
- tests/member-command-center-privileged-read.test.ts

Required approach:
1) Identify exactly where member_files are being loaded before permission/category gating.
2) Refactor the read path so non-clinical viewers never fetch restricted rows they are not allowed to see.
3) Preserve the canonical MCC shared service boundary and existing allowed categories/UX behavior.
4) Reuse existing permission-aware file query helpers if they already exist instead of inventing a second file-read model.
5) Add regression coverage proving non-clinical viewers cannot hydrate restricted file rows and clinical viewers still see expected files.

Validation:
- Run npm run typecheck.
- Run the targeted MCC permission tests.
- Report changed files and any remaining intentional service-role read surfaces in MCC.

Do not overengineer. Keep the fix maintainable and least-privilege.
```

### Issue 4. Stop replay-safe public signing from deleting committed clinical artifacts
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
3) Make was_already_signed / wasAlreadySigned branches strictly read-only for canonical committed artifact paths.
4) If cleanup must remain, only delete files that can be proven to be temp attempt-scoped artifacts created by the losing request.
5) Prefer attempt-scoped temporary uploads only if that is the smallest clean shared fix across both workflows.
6) Add regression tests that fail if replay-safe branches delete the winner's canonical signed artifacts.

Validation:
- Run npm run typecheck.
- Run targeted replay tests for both public POF signing and care plan caregiver signing.
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
4) Ensure stale losing transitions do not emit misleading downstream packet events, duplicate sender_staff signatures, duplicate resend emails, or contradictory POF events.
5) Keep legitimate resend history where appropriate, but prevent race-driven regressions.
6) Add regression coverage for stale pre-read -> external completion/signature -> resend/void execution.

Validation:
- Run npm run typecheck.
- Run targeted enrollment packet and POF transition tests.
- Report migration changes, RPC contract changes, and any caller updates needed.

Do not overengineer. Keep the fix maintainable and auditable.
```

### Issue 6. Make enrollment packet completion durably truthful
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Enrollment packet completion still marks the packet completed before finalized artifacts, member-file linkage, notifications, and downstream mapping are durably aligned. The fallback builder can also still continue if action_required truth fails to persist.

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
The lead conversion database boundary still trusts p_existing_member_id too much. A privileged bad call can supply an unrelated member id and the function can relink that row to the wrong lead.

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

### Issue 8. Make care plan final signed file identity care-plan-specific
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Care plan final signed files still use one shared document_source = 'Care Plan Final Signed' per member, but the schema enforces unique (member_id, document_source). A member with more than one signed care plan can hit a durable collision.

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

### Issue 9. Align workflow truth, notifications, and physician-order handoff proof
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Some Memory Lane workflows now correctly preserve committed-but-follow-up-needed truth, but notifications and some server-action catch paths still overstate readiness or return ok: true in ways that can look fully successful when the canonical workflow is degraded or failed. Separately, the workflow simulation audit still cannot prove the canonical physician_orders write in the intake -> draft POF and signed POF -> MHP handoffs.

Scope:
- Domain/workflow: signed POF/care plan readiness messaging, high-risk operational action return contracts, intake -> POF handoff proof, signed POF -> MHP handoff proof
- Canonical entities/tables: physician_orders, pof_requests, care_plans, care_plan_signature_events, user_notifications, workflow result payloads that surface readiness
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
- workflow simulation report evidence for intake -> POF and signed POF -> MHP

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
The latest query audit still shows five confirmed missing indexes, a heavy sales dashboard summary RPC, an overly broad billing summary read path, first-render exact-count costs, and continued overfetch in MCC/member/POF/export paths. These are founder-facing performance costs, but the fix must preserve one canonical read boundary per domain instead of reintroducing split query families.

Scope:
- Domain/workflow: sales dashboard, billing dashboard summary, admin audit trail, partner/referral directories, MCC/member detail, MAR, POF/export reads
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
- lib/services/pof-read.ts
- lib/services/billing-exports.ts

Required approach:
1) Keep the sales dashboard behind one canonical RPC boundary.
2) Add forward-only migration(s) for the five confirmed missing indexes:
   - audit_logs(created_at desc)
   - community_partner_organizations(organization_name)
   - referral_sources(organization_name)
   - member_allergies(member_id, updated_at desc)
   - billing_export_jobs(generated_at desc, created_at desc)
3) Slim the sales dashboard summary RPC so it does not rebuild unnecessary founder summary state from broad full-table work on each request.
4) Separate billing headline summary math from heavier preview/queue/batch reads so the founder-facing summary does not pay invoice-preview costs every time.
5) Reduce first-render exact counts and overfetch where the page does not truly need them, while preserving canonical service boundaries and current UI outputs.
6) Replace select(*) in POF and billing export helpers with explicit field lists where safe.

Validation:
- Run npm run typecheck.
- Run targeted billing/sales/admin tests.
- Report new migrations, changed read boundaries, and any intentionally deferred first-load fan-out issues.

Do not overengineer. Keep the fix maintainable and auditable.
```

## 3. Fix Priority Order

1. Harden the Supabase database boundary first: RPC execute grants plus broad RLS policies.
2. Reuse canonical upload validation and add atomic throttling to public workflows.
3. Remove MCC privileged file overfetch and enforce least-privilege at read time.
4. Stop replay-safe public signing from deleting committed clinical artifacts.
5. Add compare-and-set guards for enrollment resend and POF resend/void.
6. Make enrollment packet completion durably truthful.
7. Fail closed on unsafe existing-member relink during lead conversion.
8. Make care plan final signed file identity care-plan-specific.
9. Align workflow truth, notifications, and physician-order handoff proof.
10. Fix the highest-value performance bottlenecks without reopening read-path drift.

## 4. Founder Summary

The May 11 audit set still points to a fairly concentrated problem list rather than broad platform instability. Production-readiness itself stayed clean, and the older canonicality/schema/resolver artifacts did not add a new open bug today. The real work remains in security boundaries, public workflow hardening, replay safety, lifecycle truth, and a smaller group of founder-visible performance hot spots.

The biggest trust-boundary issue is still below the UI. Some high-risk `SECURITY DEFINER` RPCs remain callable by `authenticated`, and several tables still have broad authenticated RLS that does not match the actual app permission model. A newly confirmed security gap also surfaced today: public enrollment packet uploads are not reusing the internal member-file MIME allowlist, so a valid public link can currently persist file types that the internal upload path would reject.

The highest-risk workflow defects are still replay and stale-state problems. Public POF and care-plan signing can still delete already-committed artifacts on replay. Enrollment resend and POF resend/void can still trust stale pre-read state too much. Enrollment packet completion is also still a split commit, so packet truth can get ahead of finalized artifacts and downstream linkage unless you harden the completion owner.

The remaining work is important but second-tier. Member Command Center detail still has one privileged overfetch path, lead conversion still needs a DB-side fail-closed guard for `p_existing_member_id`, care plan final signed files still need care-plan-specific document identity, and notifications/action returns still need to match real persisted readiness truth. After those are addressed, the next best return is performance hardening: add the five confirmed indexes, slim the sales dashboard RPC, and stop making billing summaries and shared member reads do so much work on first render.
