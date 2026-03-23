# Memory Lane Fix Prompt Generator

Date: 2026-03-23

## Inputs Reviewed

Fresh in-repo audit artifacts reviewed for this run:
- `docs/audits/production-readiness-audit-2026-03-23.md`
- `docs/audits/acid-transaction-audit-2026-03-23.md`
- `docs/audits/workflow-simulation-audit-2026-03-23.md`
- `docs/audits/query-performance-audit-2026-03-23.md`
- `docs/audits/supabase-schema-compatibility-audit-2026-03-11.md`

Requested audit categories with no fresh standalone in-repo markdown artifact found for this run:
- Supabase RLS & Security Audit
- Daily Canonicality Sweep
- Shared Resolver Drift Check
- Shared RPC Architecture Audit
- Idempotency & Duplicate Submission Audit

This report only generates prompts from findings that are present in the latest available in-repo audit evidence.

## 1. Issues Detected

### 1. Intake signed state overstates downstream completion
- Source audits:
  - `acid-transaction-audit-2026-03-23.md` (A1, D2)
  - `workflow-simulation-audit-2026-03-23.md`
- Problem:
  - Intake signature can commit before draft POF creation and intake PDF persistence finish.
  - The platform has queue-based repair behavior, but downstream screens can still treat "signed" as more complete than it really is.
- Violated architectural rule:
  - Workflow state integrity
  - ACID durability requirements
  - Explicit failures / truthful completion semantics
- Safest fix approach:
  - Keep the current follow-up queue.
  - Add one canonical readiness field or resolver state so downstream consumers distinguish "signed" from "signed and downstream-complete."

### 2. Enrollment packet retry processing has no concurrency claim step
- Source audits:
  - `acid-transaction-audit-2026-03-23.md` (I1)
- Problem:
  - Two retry runners can process the same failed enrollment packet mapping work at the same time.
- Violated architectural rule:
  - Isolation
  - Idempotency and replay safety
  - Shared RPC standard for multi-step workflows
- Safest fix approach:
  - Mirror the POF post-sign queue claim pattern with one canonical Supabase RPC that claims retryable enrollment packet follow-up work before processing.

### 3. Public enrollment packet submit silently drops malformed structured answers
- Source audits:
  - `acid-transaction-audit-2026-03-23.md` (C1)
- Problem:
  - Malformed `intakePayload` JSON is normalized to `{}` instead of failing explicitly.
- Violated architectural rule:
  - Consistency
  - Supabase/source-of-truth integrity
  - No silent fallback behavior in production paths
- Safest fix approach:
  - Validate and reject malformed payloads in the action/service boundary.
  - Log a guard failure and return an explicit user-safe error.

### 4. Enrollment packet state and sales lead timeline still drift
- Source audits:
  - `workflow-simulation-audit-2026-03-23.md`
  - `acid-transaction-audit-2026-03-23.md` (A2)
- Problem:
  - Enrollment packet send/complete can succeed while `lead_activities` sync is still queued or failed.
- Violated architectural rule:
  - Clear handoffs between workflows
  - Canonical downstream consumer alignment
  - Shared RPC standard for lifecycle-critical writes
- Safest fix approach:
  - Keep filing atomic and truthful.
  - Strengthen canonical readiness gating so all downstream sales/ops consumers use operational readiness instead of raw `filed`.
  - Where feasible, move lead-activity sync into one transaction-backed canonical path.

### 5. Scheduled MAR documentation still uses app-side read-then-insert
- Source audits:
  - `acid-transaction-audit-2026-03-23.md` (C2, I2)
- Problem:
  - Duplicate prevention relies on a unique index, but the app still does a race-prone read-before-insert flow.
- Violated architectural rule:
  - Shared RPC standard
  - ACID isolation
  - Idempotency and replay safety
- Safest fix approach:
  - Replace the read-then-insert path with one RPC-backed replay-safe write that either inserts once or returns the existing administration row.

### 6. Health dashboard still over-fetches the MAR workflow snapshot
- Source audits:
  - `query-performance-audit-2026-03-23.md`
- Problem:
  - `/health` still loads most of the MAR board data even though the dashboard only uses a small summary subset.
- Violated architectural rule:
  - Production readiness
  - Maintainability
  - Canonical read-model discipline
- Safest fix approach:
  - Split a lightweight dashboard read model or RPC from the full MAR workflow snapshot without changing the MAR board's canonical behavior.

### 7. Care-plan/member detail pages still duplicate expensive reads
- Source audits:
  - `query-performance-audit-2026-03-23.md`
- Problem:
  - Member Command Center detail loads care-plan summary and list data through overlapping read paths, and member detail still fans out exact-count preview queries.
- Violated architectural rule:
  - One canonical resolver/read path where possible
  - Query performance auditability
- Safest fix approach:
  - Consolidate care-plan member reads into one shared read model and trim exact-count fan-out where totals are not immediately required.

### 8. Sales lookup reads still rely on broad preload patterns and missing supporting indexes
- Source audits:
  - `query-performance-audit-2026-03-23.md`
  - `supabase-schema-compatibility-audit-2026-03-11.md`
- Problem:
  - Sales form lookups still preload large capped sets, and `leads(created_at desc)` plus active-member roster index support remain incomplete.
- Violated architectural rule:
  - Production readiness
  - Migration-driven schema alignment
  - Canonical service-backed read performance
- Safest fix approach:
  - Move to search-first/recent-item read models and add the smallest justified migration-backed indexes.

## 2. Codex Fix Prompts

### Prompt 1. Canonical intake post-sign readiness

1. Problem Summary
- Signed intake currently overstates completion. Staff can have a real signed intake record while draft POF creation or intake PDF member-file persistence is still pending or failed. If this stays unfixed, downstream clinical workflows can assume onboarding is complete when repair work is still required.

2. Root Cause Framing
- Likely architectural cause: signature completion is canonical, but downstream follow-up artifacts are handled after commit and the platform does not expose one authoritative readiness state for those handoffs.
- Affected workflow/domain: intake assessment -> draft POF -> member files.
- Issue class: workflow integrity, data safety.

3. Best Codex Fix Prompt
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Signed intake is being treated as complete before its required downstream follow-up work is durable.

Scope:
- Domain/workflow: intake assessment post-sign completion
- Canonical entities/tables: intake_assessments, intake follow-up queue objects, member_files, physician order draft creation path
- Expected canonical write path: UI -> Server Action -> Service Layer -> Supabase

Required approach:
1) Inspect the current end-to-end path first:
   - app/intake-actions.ts -> createAssessmentAction
   - app/(portal)/health/assessment/[assessmentId]/actions.ts
   - lib/services/intake-post-sign-follow-up.ts
   - lib/services/intake-pof-mhp-cascade.ts
   - any current readiness/status resolver used by intake detail or downstream screens
2) Identify the true authoritative completion boundary after an intake is signed.
3) Add one canonical readiness field, enum, or shared resolver outcome so the platform can distinguish:
   - signed but downstream follow-up still required
   - signed and downstream-complete
4) Preserve the existing follow-up queue. Do not try to force the whole workflow into one giant rewrite if the current queue is the intended recovery pattern.
5) Update downstream readers/screens that currently treat signature alone as completion truth so they use the new canonical readiness state instead.
6) Keep failures explicit. Do not add silent fallbacks, fabricated success, or UI-only status patches.
7) If schema changes are required, add a forward-only migration and align TypeScript/runtime code to that migration.

Validation:
- Run typecheck/build and report results.
- List changed files, schema impact, and downstream impact.
- Give manual retest steps that prove a signed intake with failed draft POF/PDF follow-up is visibly not downstream-complete.

Do not overengineer. Keep the queue, keep Supabase as source of truth, and make the readiness truth auditable.
```

4. Regression Risks
- Intake detail page may show the wrong state if it still keys off signature only.
- Draft POF follow-up dashboards may miss queued work if the new readiness state is not wired everywhere.
- Any member onboarding/reporting logic that assumes "signed = ready" may need alignment.

5. Retest Checklist
- Sign an intake where draft POF creation succeeds and confirm the intake shows downstream-complete.
- Force draft POF creation failure and confirm the intake remains signed but not downstream-complete.
- Force intake PDF member-file persistence failure and confirm the same truthful readiness behavior.
- Verify a queued follow-up repair can move the intake to downstream-complete without manual DB edits.

6. Optional Follow-up Prompt
- Add a regression test that prevents any intake reader from treating signature alone as the completion truth when follow-up work is still queued.

### Prompt 2. Claim-based enrollment packet retry processing

1. Problem Summary
- Enrollment packet retry processing can run twice against the same failed mapping work when cron/manual runners overlap. The shared conversion RPC limits corruption, but redundant retries still waste work and can duplicate telemetry or confuse operators.

2. Root Cause Framing
- Likely architectural cause: retry processing lacks a canonical claim/lease step before follow-up workers start acting on queued enrollment packet repair work.
- Affected workflow/domain: enrollment packet completion -> downstream mapping retry queue.
- Issue class: workflow integrity, data safety.

3. Best Codex Fix Prompt
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Failed enrollment packet downstream mapping retries do not have a canonical claim step, so overlapping runners can process the same retry work at the same time.

Scope:
- Domain/workflow: enrollment packet completion follow-up / retry processing
- Canonical entities/tables: enrollment_packet_requests, enrollment packet follow-up queue objects, lead activity sync follow-up
- Expected canonical write path: cron/manual trigger -> service layer -> shared Supabase RPC claim -> canonical retry processor

Required approach:
1) Inspect the current retry path first:
   - app/api/internal/enrollment-packet-mapping-sync/route.ts
   - lib/services/enrollment-packet-mapping-runtime.ts
   - lib/services/enrollment-packet-follow-up.ts
   - related migrations including 0106_enrollment_atomicity_and_intake_follow_up_queue.sql and 0110_enrollment_packet_follow_up_queue.sql
2) Mirror the existing POF post-sign claim pattern if there is already a canonical queue-claim RPC elsewhere in the repo.
3) Add one Supabase RPC that claims retryable enrollment packet follow-up rows atomically before work begins.
4) Update the retry runner to process only rows it successfully claimed.
5) Preserve existing readiness and mapping-status semantics. This change should remove overlapping work, not rewrite the business workflow.
6) Keep auditability clear: claimed_at, claimed_by/worker marker, attempt counts, and terminal outcomes should stay visible if the current queue model already tracks them.
7) Do not add app-memory locking, local mutexes, or non-Supabase coordination.

Validation:
- Run typecheck/build and report results.
- List changed files and migration impact.
- Include a manual concurrency retest where two retry triggers fire at nearly the same time and only one claims a given packet retry item.

Do not overengineer. Reuse the repo's existing queue claim pattern if available.
```

4. Regression Risks
- Retry rows can get stuck if the claim state is not released or terminalized correctly.
- Existing admin retry UI/API responses may need small alignment if they assumed blind retry selection.
- Lead-activity follow-up could regress if claim filtering accidentally narrows too much.

5. Retest Checklist
- Create a failed enrollment packet mapping item and verify one runner claims it.
- Trigger a second runner at the same time and verify it skips the claimed item.
- Confirm successful retry updates canonical readiness/mapping status as before.
- Confirm failed retry increments attempts and remains auditable without duplicate side effects.

6. Optional Follow-up Prompt
- Add a regression test for overlapping enrollment packet retry calls that proves duplicate processing does not occur.

### Prompt 3. Malformed enrollment packet payloads must fail explicitly

1. Problem Summary
- Public enrollment packet submission can silently replace malformed structured answers with an empty object. That hides client or payload bugs and can discard caregiver-entered data without an explicit failure.

2. Root Cause Framing
- Likely architectural cause: a permissive parsing fallback in the public action/service path normalizes invalid input instead of rejecting it at the boundary.
- Affected workflow/domain: public enrollment packet submission.
- Issue class: data safety, workflow integrity.

3. Best Codex Fix Prompt
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Malformed enrollment packet intakePayload JSON is silently converted to {} instead of failing explicitly.

Scope:
- Domain/workflow: public enrollment packet submit/progress path
- Canonical entities/tables: enrollment_packet_requests, enrollment_packet_fields / submission payload persistence
- Expected canonical write path: public action -> service layer -> Supabase RPC / canonical persistence

Required approach:
1) Inspect:
   - app/sign/enrollment-packet/[token]/actions.ts
   - parseIntakePayload
   - lib/services/enrollment-packets-public-runtime.ts
   - savePublicEnrollmentPacketProgress / submitPublicEnrollmentPacket related helpers
2) Remove the silent malformed-JSON fallback.
3) Make malformed structured payloads fail explicitly at the action/service boundary with a clear guard failure.
4) Preserve valid public-link behavior, token checks, and existing successful payload handling.
5) Log an auditable error path if there is already a canonical workflow event / error logging mechanism for public submissions.
6) Do not accept malformed JSON by coercing it to {} or any synthetic default.

Validation:
- Run typecheck/build and report results.
- Show changed files.
- Include manual retests for: valid payload succeeds, malformed payload fails explicitly, and valid structured answers still persist unchanged.

Keep the change small, deterministic, and truthful.
```

4. Regression Risks
- Public enrollment packet form submissions may start surfacing errors that were previously hidden.
- Any client-side caller relying on permissive parsing will need to send well-formed payloads.
- Error messaging must avoid leaking sensitive internals to public users.

5. Retest Checklist
- Submit a valid packet with structured intake answers and confirm answers persist.
- Submit malformed JSON and confirm the action fails explicitly.
- Verify no empty-object payload is written for the malformed case.
- Confirm staff can still review correctly saved structured answers afterward.

6. Optional Follow-up Prompt
- Add a focused server-action test for malformed `intakePayload` parsing so silent coercion cannot return later.

### Prompt 4. Enrollment packet operational readiness must gate downstream consumers

1. Problem Summary
- Enrollment packet send/complete can be real in Supabase while the sales lead timeline and downstream follow-up work are still pending. If readers keep using raw `filed` or sent/completed state as the whole truth, staff can see misleading workflow handoffs.

2. Root Cause Framing
- Likely architectural cause: the main packet transaction is canonical, but downstream sales/ops consumer logic is still partially keyed to lifecycle state instead of authoritative operational readiness.
- Affected workflow/domain: enrollment packet send/completion -> lead activity -> sales/ops consumers.
- Issue class: workflow integrity.

3. Best Codex Fix Prompt
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Enrollment packet records can be truly filed while downstream lead-activity and operational follow-up are still pending, and some consumers may still treat raw filed status as fully complete.

Scope:
- Domain/workflow: enrollment packet send/completion and downstream operational readiness
- Canonical entities/tables: enrollment_packet_requests, enrollment packet follow-up queue/state, lead_activities
- Expected canonical write path: UI/public submit -> service layer -> Supabase -> canonical readiness/read models for downstream consumers

Required approach:
1) Inspect:
   - lib/services/enrollment-packets-send-runtime.ts
   - lib/services/enrollment-packets-public-runtime.ts
   - lib/services/enrollment-packet-mapping-runtime.ts
   - any read models/UI surfaces that display packet completion/readiness
2) Identify where consumers still key off raw lifecycle state instead of operational readiness.
3) Make one canonical readiness field/resolver outcome the required downstream truth for sales/ops consumers.
4) Preserve the current staged design if that is intentional. Do not fake atomicity if the architecture already uses truthful staged completion plus follow-up repair.
5) If one narrow RPC/service change can safely move lead-activity sync into a more canonical transaction boundary, do that only if it does not create a larger risky rewrite.
6) Keep follow-up queue behavior auditable and explicit.

Validation:
- Run typecheck/build and report results.
- List changed files and any migration impact.
- Include manual retests showing a packet can be filed yet still visibly not operationally ready until follow-up completes.

Do not overengineer. The goal is truthful downstream gating, not a large enrollment rewrite.
```

4. Regression Risks
- Sales detail pages and enrollment dashboards can disagree if not all readers switch to the same readiness truth.
- Alerting/follow-up UX could hide legitimate pending work if the resolver is too optimistic.
- Any report keyed to raw packet status may need explicit documentation if semantics change.

5. Retest Checklist
- Send and complete an enrollment packet with follow-up success and confirm operational readiness resolves true.
- Force lead-activity sync failure and confirm the packet is filed but not operationally ready.
- Verify sales/ops surfaces show the same readiness state.
- Confirm repair/follow-up completion promotes readiness without duplicate side effects.

6. Optional Follow-up Prompt
- Add one shared resolver test proving no downstream consumer can treat `filed` alone as "fully operationally ready."

### Prompt 5. Replay-safe scheduled MAR documentation RPC

1. Problem Summary
- Scheduled MAR documentation still uses an app-side read-then-insert path. The unique index prevents duplicate writes, but concurrent staff actions still turn into exceptions instead of replay-safe reuse of the existing administration row.

2. Root Cause Framing
- Likely architectural cause: scheduled-dose documentation predates the current shared RPC hardening standard and still relies on app-side sequencing.
- Affected workflow/domain: scheduled MAR administration.
- Issue class: workflow integrity, data safety.

3. Best Codex Fix Prompt
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Scheduled MAR administration still uses a read-then-insert app flow instead of one replay-safe canonical RPC.

Scope:
- Domain/workflow: MAR scheduled dose documentation
- Canonical entities/tables: mar_administrations, mar_schedules, related audit/event side effects
- Expected canonical write path: UI -> server action -> service layer -> Supabase RPC

Required approach:
1) Inspect:
   - lib/services/mar-workflow.ts -> documentScheduledMarAdministration
   - the current unique constraint/index for scheduled administration
   - any server actions that call this service
2) Replace the read-before-insert flow with one small Supabase RPC or equivalently safe canonical write path that:
   - inserts once for a schedule
   - returns the existing committed row when the same schedule is documented again
3) Preserve existing audit/event behavior, not-given branching, and role/permission enforcement.
4) Keep `mar_schedule_id` uniqueness as the durable DB guard.
5) Do not add UI-only duplicate suppression or local in-memory locks.
6) Add/align TypeScript types if a new RPC is introduced.

Validation:
- Run typecheck/build and report results.
- List changed files and migration impact.
- Include manual retests for first documentation success and duplicate-click / concurrent-submit replay-safe behavior.

Keep the fix small and RPC-centered.
```

4. Regression Risks
- Not-given and alert-generation branches can regress if the new RPC path does not preserve current logic.
- PRN flows must remain separate if they are intentionally different from scheduled-dose behavior.
- Existing server actions may need response-shape alignment.

5. Retest Checklist
- Document one scheduled dose and confirm a single `mar_administrations` row is created.
- Repeat the same documentation request and confirm the existing row is returned rather than a raw uniqueness error.
- Verify alerts and audit behavior still work for not-given paths.
- Confirm PRN documentation remains unchanged.

6. Optional Follow-up Prompt
- Add a concurrency-focused regression test around duplicate scheduled MAR submissions.

### Prompt 6. Split a health-dashboard-safe MAR read model

1. Problem Summary
- `/health` still pays for most of the MAR workflow snapshot even though it only needs summary/dashboard data. This increases read cost and makes the dashboard scale worse than necessary.

2. Root Cause Framing
- Likely architectural cause: the health dashboard reuses the full MAR board read model instead of a narrower canonical dashboard read path.
- Affected workflow/domain: health dashboard and MAR summary reads.
- Issue class: performance.

3. Best Codex Fix Prompt
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
The health dashboard still calls the broad MAR workflow snapshot even though it only needs a small summary subset.

Scope:
- Domain/workflow: /health dashboard read path
- Canonical entities/tables: MAR views/read models already used by health dashboard and MAR board
- Expected canonical read path: dashboard service -> shared narrow read model or RPC -> Supabase

Required approach:
1) Inspect:
   - lib/services/health-dashboard.ts
   - lib/services/mar-workflow-read.ts
   - app/(portal)/health/page.tsx or equivalent health dashboard entrypoint
2) Identify exactly which dashboard fields are actually used versus which MAR snapshot fields are currently over-fetched.
3) Create one lightweight dashboard-safe MAR read model or RPC that only fetches what /health needs.
4) Preserve the full MAR board behavior and keep it on its existing canonical read path.
5) Do not move logic into the UI and do not duplicate business-rule computation across two unrelated read implementations.
6) If helpful, add one migration-backed read RPC rather than layering more app-memory filtering onto the existing broad snapshot.

Validation:
- Run typecheck/build and report results.
- List changed files and migration impact.
- Explain what data stopped loading on /health and why that is safe.

Do not overengineer. Reduce over-fetching without destabilizing the MAR board.
```

4. Regression Risks
- Health dashboard summary cards can drift from MAR board truth if logic is duplicated instead of shared.
- Dashboard widgets may accidentally lose fields if the new narrow read path is underspecified.
- Any route that reused the old dashboard service output may need alignment.

5. Retest Checklist
- Load `/health` and confirm the dashboard still shows the expected due-med and recent-health summary information.
- Verify the full MAR page still works unchanged.
- Confirm the dashboard path no longer requests PRN options/member-option payloads that it does not render.

6. Optional Follow-up Prompt
- After the refactor, capture real `EXPLAIN` plans for `/health` queries in a live environment and check whether more MAR indexes are actually needed.

### Prompt 7. Consolidate care-plan member reads and trim exact-count fan-out

1. Problem Summary
- Member pages still duplicate care-plan reads and pay for multiple exact-count preview queries up front. This increases latency and keeps read logic spread across overlapping services.

2. Root Cause Framing
- Likely architectural cause: summary and list views evolved separately and now call overlapping read helpers instead of one shared member-detail read model.
- Affected workflow/domain: Member Command Center detail, member health detail, care-plan summary reads.
- Issue class: performance, maintainability.

3. Best Codex Fix Prompt
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Member-facing detail pages still duplicate care-plan reads and fan out several exact-count preview queries.

Scope:
- Domain/workflow: member detail / Member Command Center / care plan summaries
- Canonical entities/tables: care_plans and related member-detail preview tables
- Expected canonical read path: shared member-detail read model -> Supabase

Required approach:
1) Inspect:
   - lib/services/member-command-center-runtime.ts
   - lib/services/care-plans-read-model.ts
   - lib/services/member-detail-read-model.ts
2) Find where the same member care-plan set is loaded twice in one request.
3) Consolidate summary + list reads behind one shared read path where possible.
4) Review the exact-count preview queries in member detail and remove or defer the ones that are not required on first load.
5) Preserve current UI behavior unless a count becomes intentionally lazy/deferred and that change is clearly justified.
6) Do not push business rules into components.

Validation:
- Run typecheck/build and report results.
- List changed files.
- Explain which duplicated reads were removed and which preview counts were deferred or replaced.

Keep the fix incremental and auditable.
```

4. Regression Risks
- Member detail tabs can lose totals if deferred loading is not wired correctly.
- Care-plan summary widgets may disagree with list views if they stop sharing the same dataset.
- MCC and MHP pages may each depend on slightly different response shapes.

5. Retest Checklist
- Open member detail and confirm care-plan summary and list still agree.
- Verify the page still loads recent preview widgets correctly.
- Confirm any deferred counts load only when the corresponding tab/section needs them.

6. Optional Follow-up Prompt
- Add a narrow benchmark/logging pass to compare member-detail query counts before and after the consolidation.

### Prompt 8. Sales lookup read-model and index hardening

1. Problem Summary
- Sales form lookups still preload broad capped datasets, and the repo still lacks a few small supporting indexes for lead recency and active-member roster reads. This will get slower and less complete as tables grow.

2. Root Cause Framing
- Likely architectural cause: convenience preload logic remained after core sales summary RPC work was improved, and migrations have not yet added the last small supporting indexes identified by the audit.
- Affected workflow/domain: sales dashboard/form lookups and active-member roster style reads.
- Issue class: performance.

3. Best Codex Fix Prompt
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Sales form lookups still preload broad 500-row datasets, and a few low-risk supporting indexes are still missing for lead recency and active-member roster reads.

Scope:
- Domain/workflow: sales form lookups, sales dashboard snapshots, active-member roster lookups
- Canonical entities/tables: leads, community_partner_organizations, referral_sources, members
- Expected canonical read path: shared sales/member read services -> Supabase, with migration-backed indexes

Required approach:
1) Inspect:
   - lib/services/sales-crm-read-model.ts
   - lib/services/member-command-center-runtime.ts
   - lib/services/health-dashboard.ts
   - current index migrations, especially 0117_query_performance_indexes_partials.sql
2) Replace broad preload lookups with one smaller recent-items or search-first canonical read model where safe.
3) Add the smallest justified forward-only migration for the remaining audit-backed indexes, likely:
   - leads(created_at desc)
   - members(status, display_name)
   - optional locker-number trigram support if current member search still needs it
4) Preserve canonical service boundaries. Do not move search logic into the UI.
5) Keep runtime/schema alignment explicit: any new query shape should be backed by migrations.

Validation:
- Run typecheck/build and report results.
- List changed files and new migration names.
- Include manual retests for sales form lookups, member roster search, and any changed search-as-you-type behavior.

Do not overengineer. Prefer small read-model narrowing plus low-risk indexes.
```

4. Regression Risks
- Sales forms can lose expected dropdown options if the new read model is too narrow.
- Search UX can feel different if recent-items and search-first logic are not balanced.
- Index additions need deployment before production performance benefits appear.

5. Retest Checklist
- Open sales forms and confirm recent lead/partner/referral lookups still work.
- Search for a member by name and locker number if that search path remains supported.
- Verify recent-lead lookups still sort correctly by newest first.
- Confirm migrations apply cleanly in the target Supabase environment.

6. Optional Follow-up Prompt
- After shipping, capture live query plans for the sales lookup and active-member roster paths to verify the new indexes are actually used.

## 3. Fix Priority Order

1. Malformed enrollment packet payloads must fail explicitly.
2. Claim-based enrollment packet retry processing.
3. Canonical intake post-sign readiness.
4. Enrollment packet operational readiness gating for downstream consumers.
5. Replay-safe scheduled MAR documentation RPC.
6. Split a health-dashboard-safe MAR read model.
7. Consolidate care-plan member reads and trim exact-count fan-out.
8. Sales lookup read-model and index hardening.

Priority rationale:
- Items 1-5 are workflow truth / replay safety fixes with the highest production-risk reduction.
- Items 6-8 are performance and read-model hardening after the core workflow-safety issues.

## 4. Founder Summary

The repo is in better shape than the earlier March 22 baseline. The newest audits do not show new fake-persistence or direct Supabase-bypass regressions in the audited priority domains. The current remaining issues are mostly about truthful staged completion, retry orchestration, and a smaller set of broad read paths.

The most important implementation prompts for Codex are now:
- stop silent data loss on malformed public enrollment packet payloads
- add claim-based concurrency protection for enrollment packet retry processing
- make intake signed state and enrollment packet readiness more truthful for downstream users
- finish the remaining replay-safe MAR write hardening
- trim the remaining dashboard/member-detail over-fetching

The main gap in today's inputs is audit coverage, not just runtime issues. There is no fresh standalone in-repo report for RLS/security, canonicality sweep, resolver drift, shared RPC architecture, or idempotency by those exact names. That means this prompt pack is grounded in the latest audit evidence that actually exists in the repo, not a complete cross-audit picture.
