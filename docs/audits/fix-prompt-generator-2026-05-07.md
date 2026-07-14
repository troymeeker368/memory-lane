# Fix Prompt Generator - 2026-05-07

Source reports used:
- `docs/audits/supabase-rls-security-audit-2026-05-06.md`
- `docs/audits/production-readiness-audit-2026-05-07.md`
- `docs/audits/workflow-simulation-audit-2026-05-07.md`
- `docs/audits/schema-migration-safety-audit-2026-04-02.md`
- `docs/audits/shared-resolver-drift-check-2026-03-29.md`
- `docs/audits/rpc-architecture-audit-2026-03-24.md`
- `docs/audits/acid-transaction-audit-2026-04-24.md`
- `docs/audits/idempotency-duplicate-submission-audit-2026-03-29.md`
- `docs/audits/daily-canonicality-sweep-raw-2026-03-27.json`
- `docs/audits/supabase-query-performance-audit-2026-04-24.md`

Notes:
- Some requested audit families do not have a newer dated report in `docs/audits`. For those families, this report uses the latest available source above.
- The 2026-05-07 production-readiness audit is mostly a clean validation pass. It materially reduces open work in MCC and care-plan preview scope, so those items were not carried forward as new fix prompts.
- The highest-signal open issues still cluster around enrollment packet truth, intake/POF workflow wiring, intake security, synthetic success responses, lead-activity durability, and a smaller set of performance/index gaps.

## 1. Issues Detected

### 1. Enrollment packet completion still violates atomic truth and replay safety
Architectural rule violated:
- ACID transaction requirements
- workflow state integrity
- idempotency and replay safety
- do not return synthetic success when required downstream persistence fails

Safest fix approach:
- Keep one canonical enrollment packet completion boundary.
- Move required finalized artifact persistence and completion follow-up state under the same durable transaction/RPC truth boundary where practical.
- If full atomic consolidation is too risky for one pass, persist one canonical repair owner before returning success and wire the existing cleanup/recovery path into that owner.
- Reject expired parent tokens before any completed-download token can be minted.
- Replace advisory public submit throttling with an atomic claim path.

Audit basis:
- `supabase-rls-security-audit-2026-05-06.md`
- `acid-transaction-audit-2026-04-24.md`
- `workflow-simulation-audit-2026-05-07.md`

### 2. Intake Assessment security is still broader than the real clinical boundary
Architectural rule violated:
- preserve role restrictions
- Supabase-first authorization
- canonical service write path with explicit permission enforcement

Safest fix approach:
- Tighten RLS on `intake_assessments`, `assessment_responses`, and `intake_assessment_signatures`.
- Align the intake history page, detail page, and create action to one clinical `canView` / `canEdit` permission model.
- Require explicit health-unit edit permission before privileged intake writes.

Audit basis:
- `supabase-rls-security-audit-2026-05-06.md`

### 3. Intake Assessment to Physician Orders / POF handoff is not clearly persisting through one canonical path
Architectural rule violated:
- required shared workflow domain boundary for physician orders
- canonical service write path
- shared RPC standard for lifecycle-sensitive multi-step workflows

Safest fix approach:
- Verify the intake-to-POF path end to end before changing behavior.
- If draft physician-order creation is fragmented or bypasses the canonical service boundary, consolidate it to one shared service/RPC path that persists to `physician_orders`.
- Add regression proof that the same canonical member and source assessment produce the expected draft order.

Audit basis:
- `workflow-simulation-audit-2026-05-07.md`
- `rpc-architecture-audit-2026-03-24.md`

### 4. Action-layer catch blocks still advertise success after downstream failure
Architectural rule violated:
- do not return synthetic success when persistence or downstream effects fail
- workflow state integrity
- auditability

Safest fix approach:
- Audit the flagged `ok: true` catch blocks.
- Preserve committed truth where a durable write already happened, but return committed identifiers plus degraded/follow-up-needed status rather than plain success.
- Return explicit failure for uncommitted paths.
- Prefer a small shared result helper only if it fits existing architecture; do not create a broad abstraction layer.

Audit basis:
- `workflow-simulation-audit-2026-05-07.md`

### 5. Lead conversion and enrollment-driven lead activity logging still have split durability and replay protection
Architectural rule violated:
- one canonical write path per workflow
- ACID durability requirements
- idempotency and replay safety

Safest fix approach:
- Preserve conversion-before-activity ordering.
- Stop returning a plain failure after conversion has already committed.
- Extend database-backed idempotency to enrollment-packet lead activity sync so all canonical lead-activity insert paths share one replay contract.

Audit basis:
- `acid-transaction-audit-2026-04-24.md`
- `workflow-simulation-audit-2026-05-07.md`

### 6. Remaining RLS hardening and MCC file-read overfetch still expose too much privileged data
Architectural rule violated:
- least-privilege read boundaries
- Supabase-first authorization
- no privileged hydrate-then-filter pattern for restricted data

Safest fix approach:
- Enable RLS on `sites`, `lookup_lists`, and `punches_linked_time_punch_review`.
- Replace broad authenticated policies on the remaining support/workflow tables with permission-aware or service-only boundaries.
- Refactor MCC detail file reads so category/actor filtering happens before service-role hydration.

Audit basis:
- `supabase-rls-security-audit-2026-05-06.md`

### 7. Production schema safety is mostly clean locally, but deployment-state migration drift is still a real rollout blocker
Architectural rule violated:
- migration-driven schema
- schema/runtime alignment
- production readiness checklist

Safest fix approach:
- Treat this as a deployment-state problem, not a runtime code refactor.
- Confirm the linked Supabase project has the required hardening migrations applied, especially the newer security and lead-activity migrations.
- Regenerate types only after remote migration state is correct and rerun DB verification.

Audit basis:
- `schema-migration-safety-audit-2026-04-02.md`
- `production-readiness-audit-2026-05-07.md`
- `supabase-rls-security-audit-2026-05-06.md`

### 8. Query hotspots still carry duplicated reads, missing indexes, and broad first-load fan-out
Architectural rule violated:
- one canonical read path per domain where possible
- shared resolver/read-model boundaries
- avoid duplicate query families and unnecessary Supabase load

Safest fix approach:
- Remove the duplicate billing batch read first.
- Add the missing high-value indexes first (`audit_logs(created_at desc)`, partner/referral alphabetical sort indexes).
- Keep sales dashboard optimization inside the canonical RPC boundary instead of reopening multiple read paths.
- Defer larger breadth reductions in MCC/MHP/dashboard reads until after the clear duplicate/index wins are done.

Audit basis:
- `supabase-query-performance-audit-2026-04-24.md`
- `rpc-architecture-audit-2026-03-24.md`

## 2. Codex Fix Prompts

### Issue 1. Enrollment packet atomicity, replay, and returned-truth hardening
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Enrollment packet completion still has split-commit behavior and public replay gaps. The packet can finalize before finalized artifacts and completion follow-up truth are durably aligned, an expired parent token can still mint a completed-download token, and public submit throttling is still raceable.

Scope:
- Domain/workflow: Enrollment packet public completion and post-commit cascade
- Canonical entities/tables: enrollment_packet_requests, enrollment_packet_events, enrollment_packet_uploads, enrollment_packet_signatures, member_files, enrollment_packet_mapping_runs, enrollment_packet_follow_up_queue
- Expected canonical write path: Public action -> service layer -> RPC/transaction boundary -> Supabase

Inspect first:
- lib/services/enrollment-packets-public-runtime.ts
- lib/services/enrollment-packets-public-runtime-cascade.ts
- lib/services/enrollment-packets-public-runtime-follow-up.ts
- lib/services/enrollment-packets-public-runtime-context.ts
- lib/services/enrollment-packets-public-runtime-artifacts.ts
- lib/services/enrollment-packet-public-helpers.ts
- app/sign/enrollment-packet/[token]/confirmation/page.tsx
- related enrollment-packet RPC migrations and tests

Required approach:
1) Identify the real root cause for each open gap: finalize-before-artifacts, follow-up-state truth drift, expired-token download minting, and raceable submit throttling.
2) Preserve the canonical enrollment-packet service/RPC boundary. Do not add UI-only patches.
3) Move required finalized artifact work and follow-up-state persistence under one durable truth boundary where practical. If a full RPC move is too risky for one pass, persist one canonical repair owner and wire the existing cleanup/recovery path into that owner before returning success.
4) Reject expired parent tokens before any completed-download token can be issued.
5) Replace advisory submit throttling with an atomic Supabase RPC or transaction-backed claim path.
6) Ensure returned workflow truth matches committed Supabase truth. Do not return synthetic success.
7) Add focused regression tests for post-finalize failure, follow-up-state persistence failure, expired-token download attempts, and concurrent submit attempts.

Validation:
- Run npm run typecheck.
- Run targeted enrollment-packet tests.
- Report changed files, migration/RPC impact, and rollout dependencies.

Do not overengineer. Keep the fix maintainable and auditable.
```

### Issue 2. Intake Assessment security boundary hardening
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Intake Assessment security is still inconsistent. Broad RLS lets authenticated staff read and write cross-member intake data too widely, the history page is broader than the clinical detail page, and createAssessmentAction still performs privileged writes after role-only gating.

Scope:
- Domain/workflow: Intake Assessment
- Canonical entities/tables: intake_assessments, assessment_responses, intake_assessment_signatures
- Expected canonical write path: UI -> Server Action -> Service Layer/RPC -> Supabase

Inspect first:
- app/(portal)/health/assessment/page.tsx
- app/(portal)/health/assessment/[assessmentId]/page.tsx
- app/intake-actions.ts
- intake service files and current intake RLS migrations

Required approach:
1) Preserve the canonical intake create/finalize service and RPC boundaries.
2) Replace broad intake RLS policies with permission-aware predicates or service-only boundaries that match the true clinical access model.
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

### Issue 3. Intake to Physician Orders / POF canonical handoff repair
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

### Issue 4. Synthetic success cleanup across workflow actions
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
   - committed-with-follow-up-needed truth
   - explicit failure
   - dead or stale code path
2) Preserve any path where committed persistence is already verified, but return committed identifiers plus degraded/follow-up-needed truth instead of synthetic success.
3) For uncommitted failures, return explicit failure and do not mark the workflow successful.
4) Move repeated result-shaping logic into a shared helper only if that helper already fits existing architecture; do not add broad abstraction for its own sake.
5) Add focused regression tests for the highest-risk action families first: intake, care plan, documentation, and sales.

Validation:
- Run npm run typecheck.
- Run targeted tests around affected action families.
- Report which ok:true catch paths changed, which were preserved, and why.

Do not overengineer. Keep the fix maintainable and auditable.
```

### Issue 5. Lead conversion and enrollment-driven lead activity durability
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Lead conversion can still commit before lead activity logging finishes, and enrollment-packet lead activity sync still uses weaker replay protection than the newer sales activity path.

Scope:
- Domain/workflow: Sales lead conversion and enrollment-driven lead activity sync
- Canonical entities/tables: leads, members, lead_activities, enrollment_packet_requests
- Expected canonical write path: UI -> Server Action -> Service Layer/RPC -> Supabase

Inspect first:
- lib/services/sales-lead-activities.ts
- lib/services/sales-lead-conversion-supabase.ts
- lib/services/enrollment-packet-mapping-runtime.ts
- supabase/migrations/0222_lead_activity_idempotency_hardening.sql
- related lead-activity tests and migrations

Required approach:
1) Preserve conversion-before-activity ordering.
2) Stop returning a plain failure once conversion already committed; return committed identifiers plus degraded/follow-up-needed truth instead.
3) Extend DB-backed replay safety to the enrollment-packet lead activity sync path so all canonical lead-activity writes share one durability story.
4) Keep one canonical lead-activity insert boundary where practical.
5) Add tests for committed conversion plus failed activity insert and for replayed enrollment-packet lead activity sync.

Validation:
- Run npm run typecheck.
- Run targeted sales/enrollment tests.
- Report code changes, migration changes, and rollout dependencies.

Do not overengineer. Keep the fix maintainable and auditable.
```

### Issue 6. RLS hardening and MCC file-read least-privilege fix
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Several support/workflow tables still have broad authenticated policies, three older tables still lack explicit RLS, and Member Command Center detail loading still hydrates privileged member_files rows before applying actor/category visibility filters.

Scope:
- Domain/workflow: Supabase authorization and MCC file detail reads
- Canonical entities/tables: sites, lookup_lists, punches_linked_time_punch_review, member_photo_uploads, member_providers, member_equipment, member_notes, care_plan_signature_events, care_plan_diagnoses, enrollment_packet_pof_staging, enrollment_packet_mapping_runs, enrollment_packet_mapping_records, enrollment_packet_follow_up_queue, locker_assignment_history, enrollment_pricing_community_fees, enrollment_pricing_daily_rates, member_files
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
4) Remove duplicate member-file category classification logic only if a shared helper already exists.
5) Add focused tests for the most sensitive boundaries first.

Validation:
- Run npm run typecheck.
- Run targeted permission tests.
- Report hardened tables, runtime call-site adjustments, and any intentional service-role usage that remains.

Do not overengineer. Keep the fix maintainable and auditable.
```

### Issue 7. Remote migration-state repair and schema verification
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Local schema/runtime alignment looks clean, but production readiness still depends on the linked Supabase project having the newer hardening migrations actually applied. Repo-side fixes are not real in production until remote migration state matches the committed migration set.

Scope:
- Domain/workflow: deployment-state schema alignment
- Canonical entities/tables: discover from the currently pending remote migrations, especially newer hardening/security/lead-activity changes
- Expected canonical write path: forward-only migration deployment to linked Supabase

Inspect first:
- the repo's db verification workflow
- current remote migration state
- recent migrations tied to security, lead activity idempotency, and policy hardening

Required approach:
1) Confirm exactly which migrations are pending or mismatched remotely.
2) Repair and apply the migration sequence safely in the linked Supabase project.
3) Regenerate types only after migration state is correct.
4) Re-run db verification and report what is now active remotely.
5) Do not change runtime code unless deployment verification exposes a real schema/runtime mismatch.

Validation:
- Run the repo DB verification commands and db:types if needed.
- Report exact migrations applied and any blockers.

Do not overengineer. Keep the fix maintainable and auditable.
```

### Issue 8. Query hotspot and duplicate-read hardening
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
The highest-cost founder-facing read paths still include a duplicate billing batch read, missing high-value indexes, and broad sales-dashboard aggregation work inside the canonical RPC boundary.

Scope:
- Domain/workflow: billing, sales, admin audit trail
- Canonical entities/tables: billing_batches, billing_export_jobs, audit_logs, community_partner_organizations, referral_sources, leads, lead_activities
- Expected canonical read path: one shared service or RPC boundary per domain

Inspect first:
- lib/services/billing-read-supabase.ts
- lib/services/sales-workflows.ts
- lib/services/sales-crm-read-model.ts
- lib/services/admin-audit-trail.ts
- sales dashboard RPC migration(s)

Required approach:
1) Preserve one canonical read or RPC boundary per domain. Do not create a new parallel dashboard query family.
2) Remove the duplicate getBillingBatches() fetch from getBillingModuleIndex().
3) Add a forward-only migration for the highest-value confirmed missing indexes:
   - audit_logs(created_at desc)
   - community_partner_organizations(organization_name)
   - referral_sources(organization_name)
4) Slim the sales dashboard summary RPC only where the audit already confirmed broad whole-table aggregation or unrelated global counts.
5) Preserve founder-facing numbers and existing filters.

Validation:
- Run npm run typecheck.
- Run targeted tests for billing/sales/admin audit trail.
- Report changed files, new migrations, and any intentionally deferred hotspots.

Do not overengineer. Keep the fix maintainable and auditable.
```

## 3. Fix Priority Order

1. Enrollment packet atomicity, replay, and returned-truth hardening
2. Intake Assessment security boundary hardening
3. Intake Assessment -> Physician Orders / POF canonical handoff repair
4. Synthetic success cleanup across workflow actions
5. Lead conversion and enrollment-driven lead activity durability
6. RLS hardening and MCC file-read least-privilege fix
7. Remote migration-state repair and schema verification
8. Query hotspot and duplicate-read hardening

## 4. Founder Summary

The newest audit set still points to a small number of real production risks, not a giant architecture rewrite. The biggest unresolved issue is still enrollment packet completion. It can still finalize before every downstream artifact and follow-up state is durably aligned, and the same public flow still has replay-style gaps around expired token reuse and raceable submit throttling.

The clearest security issue is still Intake Assessment. The database policies are broader than the real clinical boundary, the page-level permissions are inconsistent, and the create action still escalates to privileged writes without a strong enough edit gate. Separately, the workflow simulation audit raised a real canonicality concern around the intake-to-POF handoff. That one needs end-to-end verification first, then either a targeted bug fix or a small consolidation into one explicit shared service/RPC path.

The other important theme from this run is workflow truth. Several action-layer catch blocks still look capable of returning `ok: true` after downstream failure. That directly violates the "no synthetic success" rule and is worth fixing before it creates more founder or staff confusion. The remaining work after that is mostly narrower hardening: lead-activity durability, the last RLS gaps, remote migration-state verification, and a few query/index fixes.
