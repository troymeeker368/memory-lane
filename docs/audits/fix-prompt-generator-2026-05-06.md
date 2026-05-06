# Fix Prompt Generator - 2026-05-06

Source reports:
- `docs/audits/supabase-rls-security-audit-2026-04-24.md`
- `docs/audits/production-readiness-audit-2026-04-24.md`
- `docs/audits/acid-transaction-audit-2026-04-24.md`
- `docs/audits/workflow-simulation-audit-2026-05-06.md`
- `docs/audits/supabase-query-performance-audit-2026-04-24.md`
- `docs/audits/schema-migration-safety-audit-2026-04-02.md`
- `docs/audits/rpc-architecture-audit-2026-03-24.md`
- `docs/audits/shared-resolver-drift-check-2026-03-29.md`
- `docs/audits/idempotency-duplicate-submission-audit-2026-03-29.md`
- `docs/audits/daily-canonicality-sweep-raw-2026-03-27.json`

Notes:
- The newest workflow simulation report added a fresh signal around intake-to-POF handoff evidence and synthetic success returns. That signal should be validated carefully before broad refactor work, but it is specific enough to generate a hardening prompt.
- Schema migration safety is still clean repo-side. The open schema problem is deployment drift, not a missing local migration object.
- Shared resolver drift and the older idempotency audit did not reopen a new low-risk repo bug outside the broader workflow issues already captured below.

## 1. Issues Detected

### 1. Enrollment packet completion still violates atomic truth and replay safety
Architectural rule violated:
- ACID transaction requirements
- workflow state integrity
- idempotency and replay safety
- explicit failure when required side effects fail

Safest fix approach:
- Keep one canonical enrollment packet finalize boundary.
- Either move required finalized artifact persistence and completion follow-up writes under the transactional boundary, or persist one canonical repair owner before returning success.
- Reject expired parent tokens before completed-download token minting.
- Move submit throttling into an atomic RPC or transaction-backed claim path.

### 2. Intake Assessment security and write gating are still broader than the real clinical boundary
Architectural rule violated:
- preserve role restrictions
- Supabase-first security boundaries
- canonical service write path with explicit permission enforcement

Safest fix approach:
- Tighten RLS on `intake_assessments`, `assessment_responses`, and `intake_assessment_signatures`.
- Align history, detail, and create action to one clinical `canView`/`canEdit` boundary.
- Require explicit health-unit edit permission before privileged intake writes.

### 3. Several workflow actions still advertise success from catch blocks after downstream failure
Architectural rule violated:
- do not return synthetic success when persistence or downstream effects fail
- workflow state integrity
- auditability

Safest fix approach:
- Audit the specific `ok: true` catch paths flagged by the workflow simulation report.
- Convert them to explicit degraded or failed states unless committed truth was already verified.
- Where a business write already committed, return committed identifiers plus follow-up-needed truth instead of plain success or plain failure.

### 4. Intake Assessment to Physician Orders / POF still needs canonical handoff verification and hardening
Architectural rule violated:
- required shared workflow domain boundary for physician orders
- canonical write path
- schema/runtime alignment evidence

Safest fix approach:
- Validate the intake-to-POF handoff end to end before changing schema or UI.
- Confirm that draft POF creation always persists to `physician_orders` through the canonical service/RPC boundary.
- If static simulation is missing evidence because the path is fragmented, consolidate the handoff into one explicit shared service boundary and add regression coverage.

### 5. Lead conversion and enrollment-driven lead activity writes still have mixed durability and replay guarantees
Architectural rule violated:
- one canonical write path
- idempotency and replay safety
- explicit committed-vs-degraded truth

Safest fix approach:
- Preserve conversion-before-activity ordering.
- Stop returning a plain failure once lead/member conversion already committed.
- Extend DB-backed idempotency to the enrollment-packet lead activity sync path so all canonical lead-activity writes share one durability story.

### 6. Remaining RLS hardening gaps and privileged file hydration still expose too much data
Architectural rule violated:
- Supabase-first authorization
- least-privilege read boundaries
- no privileged hydrate-then-filter patterns for restricted data

Safest fix approach:
- Add forward-only hardening for the remaining broad-policy tables and the three missing-RLS tables.
- Refactor MCC detail file reads so category/actor filters happen in the query boundary before hydration.
- Preserve canonical service and RPC paths instead of compensating with more service-role reads.

### 7. Production is still blocked by undeployed Supabase migrations `0209` through `0223`
Architectural rule violated:
- migration-driven schema
- schema/runtime alignment
- production readiness checklist

Safest fix approach:
- Treat this as a deployment-state fix, not a runtime refactor.
- Repair/apply the missing migration sequence to the linked Supabase project, then regenerate types and rerun DB verification.

### 8. Query and resolver hotspots still carry duplicated work, fallback masking, and avoidable Supabase load
Architectural rule violated:
- one canonical read path per domain
- shared resolver boundaries
- no fallback masking of canonical truth

Safest fix approach:
- Remove the duplicate billing batch read first.
- Slim the sales dashboard RPC only where broad whole-table work is already confirmed.
- Add the missing safe indexes.
- Consolidate transportation rider eligibility into one shared helper and remove sales/transportation fallback branches that hide canonical mismatch.

## 2. Codex Fix Prompts

### Issue 1. Enrollment packet atomicity and replay
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Enrollment packet completion still has split-commit behavior and public replay gaps. The packet can finalize before finalized artifacts and completion follow-up state are durably aligned, an expired parent token can still mint a completed-download token, and submit throttling is still raceable.

Scope:
- Domain/workflow: Enrollment packet public completion and post-commit cascade
- Canonical entities/tables: enrollment_packet_requests, enrollment_packet_events, enrollment_packet_uploads, enrollment_packet_signatures, member_files, enrollment_packet_mapping_runs
- Expected canonical write path: Public action -> service layer -> RPC/transaction boundary -> Supabase

Inspect first:
- lib/services/enrollment-packets-public-runtime.ts
- lib/services/enrollment-packets-public-runtime-cascade.ts
- lib/services/enrollment-packets-public-runtime-follow-up.ts
- lib/services/enrollment-packets-public-runtime-context.ts
- lib/services/enrollment-packets-public-runtime-artifacts.ts
- related finalize/throttle migrations and tests

Required approach:
1) Identify the true root cause for each open gap: finalize-before-artifacts, follow-up-state truth drift, expired-token download minting, and raceable throttling.
2) Preserve the canonical enrollment packet service/RPC boundary.
3) Move required finalized artifact work and completion follow-up truth under one durable boundary, or persist one canonical repair owner before returning success.
4) Reject expired parent tokens before any completed-download token can be issued.
5) Replace advisory submit throttling with an atomic Supabase RPC or transaction-backed claim path.
6) Do not add UI-only patches, mock state, or synthetic success.
7) Add focused regression tests for post-finalize failure, follow-up-state persistence failure, expired-token download attempts, and concurrent submit attempts.

Validation:
- Run npm run typecheck.
- Run targeted enrollment packet tests.
- Report changed files, migration/RPC impact, and rollout dependencies.

Do not overengineer. Keep the fix maintainable and auditable.
```

### Issue 2. Intake Assessment security boundary
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Intake Assessment security is still inconsistent. Broad RLS lets authenticated staff read and write intake assessment data too widely, the history page is broader than the clinical detail page, and createAssessmentAction still performs privileged writes after role-only gating.

Scope:
- Domain/workflow: Intake Assessment
- Canonical entities/tables: intake_assessments, assessment_responses, intake_assessment_signatures
- Expected canonical write path: UI -> Server Action -> Service Layer/RPC -> Supabase

Inspect first:
- app/(portal)/health/assessment/page.tsx
- app/(portal)/health/assessment/[assessmentId]/page.tsx
- app/intake-actions.ts
- intake services and current intake RLS migrations

Required approach:
1) Preserve the canonical intake create/finalize service and RPC boundaries.
2) Replace broad intake RLS policies with permission-aware or service-only boundaries that match the actual clinical access model.
3) Align the history page, detail page, and create action to the same clinical canView/canEdit boundary.
4) Require explicit health-unit canEdit before any privileged intake write path runs.
5) Keep valid intake workflows working for authorized staff and fail explicitly for unauthorized authenticated staff.
6) Add focused tests proving unauthorized staff cannot read or write cross-member intake data.

Validation:
- Run npm run typecheck.
- Run targeted intake permission tests.
- Report policy changes, app-layer changes, and downstream intake -> draft POF impact.

Do not overengineer. Keep the fix maintainable and auditable.
```

### Issue 3. Synthetic success cleanup across workflow actions
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
The workflow simulation audit flagged multiple action-layer catch blocks that still return ok:true after downstream failure. That can create synthetic success in care plan, documentation, intake, sales, partner, and time workflows.

Scope:
- Domain/workflow: Action-layer workflow result truth
- Canonical entities/tables: discover per action before editing
- Expected canonical write path: UI -> Server Action -> Service Layer -> Supabase

Inspect first:
- app/care-plan-actions.ts
- app/documentation-actions-impl.ts
- app/documentation-create-core.ts
- app/intake-actions.ts
- app/sales-lead-actions.ts
- app/sales-partner-actions.ts
- app/time-actions.ts
- any shared workflow result helpers already used by stronger actions

Required approach:
1) Inspect each flagged ok:true catch path and classify it as one of:
   - safe committed-with-follow-up-needed truth
   - explicit failure
   - dead/stale code path
2) Preserve any path where committed persistence is already verified, but return committed identifiers plus degraded/follow-up-needed truth instead of synthetic success.
3) For uncommitted failures, return explicit failure and do not mark the workflow successful.
4) Move repeated result-shaping logic into a shared helper only if the helper already fits the existing architecture; do not introduce broad abstraction for its own sake.
5) Add focused regression tests for at least the highest-risk action families first: intake, care plan, documentation, and sales.

Validation:
- Run npm run typecheck.
- Run targeted tests around affected action families.
- Report which ok:true catch paths were changed, which were intentionally preserved, and why.

Do not overengineer. Keep the fix maintainable and auditable.
```

### Issue 4. Intake to POF canonical handoff
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
The latest workflow simulation audit marked the Intake Assessment -> Physician Orders / POF handoff as broken because expected canonical physician_orders writes were not clearly evidenced end to end. This may be a real handoff bug or a fragmented-but-working path that needs consolidation and regression proof.

Scope:
- Domain/workflow: Intake Assessment -> draft Physician Order / POF creation
- Canonical entities/tables: intake_assessments, assessment_responses, physician_orders, pof_requests
- Expected canonical write path: UI -> intake action/service -> shared physician-order service/RPC -> Supabase

Inspect first:
- lib/services/intake-pof-mhp-cascade.ts
- lib/services/physician-orders-supabase.ts
- app/(portal)/health/physician-orders/actions.ts
- app/(portal)/health/physician-orders/new/page.tsx
- existing intake and physician-order tests

Required approach:
1) Verify the current handoff end to end before changing behavior.
2) Confirm whether draft POF creation always persists to physician_orders through one canonical service or RPC boundary.
3) If the workflow is fragmented, consolidate the intake-to-POF handoff into one explicit shared service boundary and remove duplicate side paths.
4) Preserve current valid downstream behavior for provider signature dispatch and signed-order sync.
5) Add regression coverage that proves an intake submission creates or links the expected physician_orders record for the same canonical member and source assessment.

Validation:
- Run npm run typecheck.
- Run targeted intake/physician-order tests.
- Report whether the audit finding was a real bug, a visibility gap, or both.

Do not overengineer. Keep the fix maintainable and auditable.
```

### Issue 5. Lead activity durability and replay safety
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Lead conversion can still commit before lead activity logging, and enrollment-packet lead activity sync still uses weaker replay protection than the newer sales activity path.

Scope:
- Domain/workflow: Sales lead conversion and enrollment-driven lead activity sync
- Canonical entities/tables: leads, members, lead_activities, enrollment_packet_requests
- Expected canonical write path: UI -> Server Action -> Service Layer/RPC -> Supabase

Inspect first:
- lib/services/sales-lead-activities.ts
- lib/services/sales-lead-conversion-supabase.ts
- lib/services/enrollment-packet-mapping-runtime.ts
- supabase/migrations/0222_lead_activity_idempotency_hardening.sql
- related lead-activity migrations and tests

Required approach:
1) Preserve conversion-before-activity ordering.
2) Stop returning a plain failure once conversion already committed; return committed identifiers plus degraded/follow-up-needed truth instead.
3) Extend DB-backed replay safety to the enrollment-packet lead activity sync path so all canonical lead-activity writes share one durability story.
4) Keep one canonical lead-activity insert boundary where possible.
5) Add tests for committed conversion plus failed activity insert and for replayed enrollment-packet lead activity sync.

Validation:
- Run npm run typecheck.
- Run targeted sales/enrollment tests.
- Report code changes, migration changes, and rollout dependencies.

Do not overengineer. Keep the fix maintainable and auditable.
```

### Issue 6. RLS hardening and MCC privileged file hydration
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Remaining broad authenticated policies still expose sensitive support tables, three older tables still lack explicit RLS, and Member Command Center detail loading still hydrates privileged member_files rows before applying actor/category visibility filters.

Scope:
- Domain/workflow: Supabase authorization and MCC file detail reads
- Canonical entities/tables: member_photo_uploads, member_providers, member_equipment, member_notes, care_plan_signature_events, care_plan_diagnoses, enrollment_packet_pof_staging, enrollment_packet_mapping_runs, enrollment_packet_mapping_records, enrollment_packet_follow_up_queue, transportation_runs, transportation_run_results, bus_stop_directory, locker_assignment_history, enrollment_pricing_community_fees, enrollment_pricing_daily_rates, sites, lookup_lists, punches_linked_time_punch_review, member_files
- Expected canonical read/write path: permission-aware service/RPC boundaries backed by RLS

Inspect first:
- current policy migrations for the listed tables
- lib/services/member-command-center-runtime.ts
- lib/services/member-command-center-detail-read-model.ts
- app/(portal)/operations/member-command-center/_actions/files.ts
- lib/services/member-files.ts

Required approach:
1) Add forward-only migration(s) that enable missing RLS and replace broad authenticated policies with explicit permission-aware predicates or service-only boundaries.
2) Keep existing canonical service and RPC paths authoritative.
3) Refactor MCC detail file reads so actor/category filters are applied before privileged hydration, matching the safer paged list direction.
4) Remove duplicate member-file category classification logic if a shared helper already exists.
5) Add focused tests for the most sensitive boundaries first.

Validation:
- Run npm run typecheck.
- Run targeted permission tests.
- Report hardened tables, runtime call-site adjustments, and any intentional service-role usage that remains.

Do not overengineer. Keep the fix maintainable and auditable.
```

### Issue 7. Pending migration deployment
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Important hardening migrations through 0223 exist locally but are not yet active in the linked Supabase project, so repo fixes are not fully real in production.

Scope:
- Domain/workflow: deployment-state schema alignment
- Canonical entities/tables: discover from pending migrations 0209 through 0223
- Expected canonical write path: forward-only migration deployment to linked Supabase

Inspect first:
- the repo's canonical db check workflow
- current remote migration state
- migration files 0209 through 0223

Required approach:
1) Confirm exactly which migrations are pending remotely.
2) Repair and apply the migration sequence safely in the linked Supabase project.
3) Regenerate types only after migration state is correct.
4) Re-run the repo's DB verification workflow and report what is now active remotely.
5) Do not change runtime code unless deployment exposes a real schema/runtime mismatch.

Validation:
- Run the repo DB verification commands and db:types if needed.
- Report exact migrations applied and any blockers.

Do not overengineer. Keep the fix maintainable and auditable.
```

### Issue 8. Query and resolver hotspot hardening
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
The highest-cost founder-facing read paths are still the sales dashboard summary RPC, the billing dashboard/module index, and a few missing indexes. Transportation and sales also still contain duplicated resolver logic or fallback branches that can mask canonical truth.

Scope:
- Domain/workflow: sales, billing, transportation, admin audit trail
- Canonical entities/tables: leads, lead_activities, community_partner_organizations, referral_sources, audit_logs, billing_export_jobs, transportation runs/manifests
- Expected canonical read path: one shared service or RPC boundary per domain

Inspect first:
- sales dashboard summary RPC and caller
- lib/services/billing-read-supabase.ts
- lib/services/admin-audit-trail.ts
- lib/services/sales-crm-read-model.ts
- transportation services used by station and run-manifest builds

Required approach:
1) Preserve one canonical read or resolver boundary per domain.
2) Remove the duplicate getBillingBatches() fetch from getBillingModuleIndex().
3) Slim the sales dashboard summary RPC only where the audit already confirmed broad whole-table work.
4) Add forward-only indexes for audit_logs(created_at desc), community_partner_organizations(organization_name), and referral_sources(organization_name), and only add profiles(full_name) or billing export sort indexes if current query shapes justify them.
5) Consolidate duplicated transportation rider-eligibility logic into one shared helper.
6) Remove sales or transportation fallback branches that hide canonical identity or schema mismatch; fail explicitly instead.

Validation:
- Run npm run typecheck.
- Run targeted tests for billing/sales/transportation.
- Report changed files, new migrations, and intentionally deferred hotspots.

Do not overengineer. Keep the fix maintainable and auditable.
```

## 3. Fix Priority Order

1. Enrollment packet atomicity, follow-up truth, expired-token replay, and atomic throttling
2. Intake Assessment end-to-end security hardening
3. Synthetic success cleanup in action-layer workflow results
4. Deploy pending Supabase migrations `0209` through `0223`
5. Intake Assessment -> POF canonical handoff verification and hardening
6. Lead activity durability and replay safety
7. Remaining RLS hardening and MCC privileged file-read hardening
8. Query, resolver, and performance hotspot hardening

## 4. Founder Summary

The newest audit set still collapses down to a fairly small group of real problems. The biggest production issue is still enrollment packet completion: it can report success before all required downstream truth is durably aligned, and the same public path still has replay and throttling gaps. Intake Assessment is still the clearest security problem because both the database policy layer and the action/page boundary are broader than the true clinical workflow.

The genuinely new signal in this run is workflow truth drift at the action layer. The workflow simulation report flagged several `ok: true` catch paths that may still claim success after downstream failure. That matters because it cuts directly against your “no synthetic success” rule and can mislead staff about whether a workflow really committed.

The workflow simulation report also raised a fresh intake-to-POF handoff concern. I would treat that as a verify-and-harden item, not as proof that the whole workflow is broken. The right next step is to inspect the canonical handoff end to end, then either prove the path with regression coverage or consolidate it into one clearer shared service boundary.

The older audit families did not reopen a new schema drift or mock-persistence bug. The local schema remains aligned to runtime usage. The production blocker there is still migration deployment state: the repo-side hardening is ahead of what the linked Supabase project is actually enforcing until migrations `0209` through `0223` are applied.
