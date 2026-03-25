# Fix Prompt Generator - 2026-03-25

## Audit Coverage Note

Reviewed the newest in-repo audit artifacts that exist today:
- `docs/audits/production-readiness-audit-2026-03-25.md`
- `docs/audits/acid-transaction-audit-2026-03-25.md`
- `docs/audits/workflow-simulation-audit-founder-2026-03-25.md`
- `docs/audits/query-performance-audit-2026-03-25.md`
- `docs/audits/rpc-architecture-audit-2026-03-24.md`
- `docs/audits/supabase-schema-compatibility-audit-2026-03-11.md`

No fresh standalone in-repo March 25 markdown reports were present for:
- Supabase RLS & Security Audit
- Daily Canonicality Sweep
- Shared Resolver Drift Check
- Idempotency & Duplicate Submission Audit

I did not invent findings for those missing standalone reports. Where relevant, I only used issues that were explicitly surfaced in the available March 25 production-readiness, ACID, workflow-simulation, query-performance, and March 24 RPC architecture reports.

## 1 Issues Detected

### Issue 1
- Issue:
  - Enrollment packet child tables still do not enforce packet/member lineage at the database boundary.
- Source audits:
  - ACID Transaction Audit (2026-03-25)
  - Workflow Simulation Audit (2026-03-25)
- Architectural rule violated:
  - Canonical Entity Identity
  - Schema Drift Prevention
  - ACID Transaction Requirements
  - Supabase is source of truth
- Why it matters:
  - Service-layer checks exist, but Supabase can still accept split-brain child rows if a future bug, manual SQL repair, or non-canonical write passes the wrong `member_id`.

### Issue 2
- Issue:
  - Intake, enrollment packet, care plan, and signed-POF downstream handoffs are still staged, but not all operator-facing surfaces clearly use staged readiness as the source of truth.
- Source audits:
  - ACID Transaction Audit (2026-03-25)
  - Workflow Simulation Audit (2026-03-25)
- Architectural rule violated:
  - Workflow State Integrity
  - Shared Resolver / Service Boundaries
  - ACID Durability and truthful completion boundaries
- Why it matters:
  - Staff can read a signed or filed primary state as "done" even when downstream mapping, POF sync, caregiver dispatch, or file persistence is still queued or failed.

### Issue 3
- Issue:
  - Care plan create/review/sign still has a false-failure operator experience when the core record is saved but post-sign follow-up fails.
- Source audits:
  - ACID Transaction Audit (2026-03-25)
- Architectural rule violated:
  - Workflow State Integrity
  - ACID Durability
  - explicit failures when required side effects are incomplete
- Why it matters:
  - The workflow is safer than before because it does not claim false success, but staff can still interpret the error as "nothing saved" and retry against an already-committed care plan.

### Issue 4
- Issue:
  - Shared member lookup helpers still default to full-roster reads, and `/members` still returns the full matching roster without pagination.
- Source audits:
  - Query Performance Audit (2026-03-25)
- Architectural rule violated:
  - Shared Resolver / Service Boundaries
  - Maintainability and canonical read-path discipline
- Why it matters:
  - Whole-roster reads are now the main repeated performance pattern across members, dashboard cards, and workflow pickers.

### Issue 5
- Issue:
  - Sales summary reporting still loads broad sales/member data into app memory, and canonical sales summary RPC usage is still duplicated across service layers.
- Source audits:
  - Query Performance Audit (2026-03-25)
  - RPC Architecture Audit (2026-03-24)
- Architectural rule violated:
  - Shared RPC Standard
  - Shared Resolver / Service Boundaries
  - one canonical resolver/read path per workflow where possible
- Why it matters:
  - The report will degrade as lead history grows, and duplicated RPC wrapper logic makes drift more likely.

### Issue 6
- Issue:
  - Founder/staff reports and MHP detail still have broad app-side reads that should move to narrower canonical read models.
- Source audits:
  - Query Performance Audit (2026-03-25)
  - RPC Architecture Audit (2026-03-24)
- Architectural rule violated:
  - Shared RPC Standard
  - Shared Resolver / Service Boundaries
  - Supabase-first read-model discipline
- Why it matters:
  - `reports-ops`, MHP detail, and `listMemberFilesSupabase` still do broader reads than necessary, which will keep scaling costs and response times up even after the March 24-25 fixes.

### Not Included As Fix Prompts
- Production Readiness Audit (2026-03-25) found no new code regressions in audited priority domains.
- The only unresolved production-readiness blocker in that report is host-level validation failure (`spawn EPERM` / `spawnSync EPERM`) for `build`, `reseed`, `quality:gates`, and `db:check`.
- That is an environment restriction in this host context, not a repo-side implementation prompt.

## 2 Codex Fix Prompts

### Prompt Pack 1: Enrollment Packet Lineage Enforcement

#### 1. Problem Summary
Enrollment packet child tables still trust service-layer lineage checks more than the database. That means packet/member split-brain rows are still structurally possible in Supabase even though the canonical workflow is supposed to guarantee one packet lineage.

#### 2. Root Cause Framing
- Likely root cause:
  - The March 24 lineage-enforcement pass fixed intake, POF, and MAR child lineage, but the same composite-parent/composite-child constraint pattern was not extended to enrollment packet child tables.
- Affected workflow/domain:
  - Enrollment packets, downstream mapping, follow-up queue, lead/member handoff.
- Issue class:
  - data safety
  - workflow integrity

#### 3. Best Codex Fix Prompt
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Enrollment packet child tables still allow packet/member lineage drift at the database boundary.

Scope:
- Domain/workflow: enrollment packet completion, downstream mapping, and follow-up queue
- Canonical entities/tables:
  - enrollment_packet_requests
  - enrollment_packet_pof_staging
  - enrollment_packet_mapping_runs
  - enrollment_packet_mapping_records
  - enrollment_packet_field_conflicts
  - enrollment_packet_follow_up_queue
- Expected canonical write path: UI -> Server Action -> Service Layer -> Supabase

Required approach:
1) Inspect the current lineage pattern in `supabase/migrations/0127_clinical_lineage_enforcement.sql` and reuse that exact repair-then-enforce strategy.
2) First add a read-only drift audit query pack for enrollment packet child tables so any existing packet/member mismatches can be measured safely before constraint changes.
3) Add the smallest forward-only migration needed to:
   - ensure `enrollment_packet_requests` has a unique parent-side `(id, member_id)` key suitable for composite FK use
   - deterministically backfill/fix any existing child-row lineage mismatches using the canonical parent packet row
   - add composite foreign keys `(packet_id, member_id)` on child tables that already store both values
4) Preserve the current canonical service-layer checks in `lib/services/enrollment-packet-follow-up.ts` and related enrollment services. Do not replace them with UI-only validation.
5) Keep nullable `lead_id` handling explicit. Only add DB-level lead parity enforcement if it can be done cleanly without blocking valid pre-conversion packet flows.
6) Do not add alternate write paths, runtime fallbacks, or synthetic success behavior.
7) Verify downstream enrollment packet completion, mapping retries, and follow-up queue writes still use one canonical service path.

Validation:
- Run typecheck and report results.
- If possible, run db sync/check in this environment; if blocked, say exactly why.
- List changed files, migration sections, rollout cautions, and manual verification SQL queries.

Do not overengineer. Do not introduce new frameworks. Keep the fix maintainable and auditable.
```

#### 4. Regression Risks
- Enrollment packet completion could fail if composite constraints are added before drift is repaired.
- Follow-up queue inserts could start failing if any caller still passes non-canonical `member_id`.
- Manual admin repair SQL scripts may need updating if they were writing child rows loosely.

#### 5. Retest Checklist
1. Submit an enrollment packet and verify all child rows created for that packet carry the same canonical `member_id` as `enrollment_packet_requests`.
2. Run a manual retry for enrollment packet follow-up and verify the queue row still inserts/updates successfully.
3. Try a deliberately mismatched child insert in SQL against a local/dev database and verify Supabase rejects it.
4. Confirm the packet still files and downstream mapping/follow-up rows still persist for a normal real packet.

#### 6. Optional Follow-up Prompt
```text
Add regression coverage for enrollment packet lineage enforcement in Memory Lane.

Focus on proving that enrollment packet child rows cannot persist with a mismatched `(packet_id, member_id)` pair after the new migration lands. Prefer one migration verification query pack plus one service-level regression test around the canonical enrollment follow-up queue write path.
```

### Prompt Pack 2: Staged Readiness Truth Across Operator Surfaces

#### 1. Problem Summary
Several workflows are intentionally staged for safety, but operator-facing pages and handoffs can still imply "done" too early if they rely on first-stage states like signed or filed instead of the canonical readiness field.

#### 2. Root Cause Framing
- Likely root cause:
  - The staged readiness fields exist, but consumer screens and CTA logic were fixed incrementally per workflow instead of being audited as one cross-domain truth pass.
- Affected workflow/domain:
  - Intake, enrollment packets, care plans, signed POF downstream sync.
- Issue class:
  - workflow integrity
  - UX

#### 3. Best Codex Fix Prompt
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Operator-facing screens still risk treating signed/filed primary state as full completion even when staged readiness fields already exist.

Scope:
- Domain/workflow:
  - intake post-sign follow-up
  - enrollment packet downstream readiness
  - care plan post-sign follow-up
  - signed POF downstream sync visibility
- Canonical entities/tables: discover exact read models first, but preserve the existing authoritative readiness fields:
  - `post_sign_readiness_status`
  - `post_sign_ready`
  - `operationalReadinessStatus`
  - any existing canonical POF post-sign sync detail surfaced by the current read model
- Expected canonical read/write path:
  - UI -> Server Action -> Service Layer -> Supabase

Required approach:
1) Inspect the current read models and pages that render workflow completion state for intake, enrollment packets, care plans, and signed POFs.
2) Identify every place that still uses signature/filed state alone for staff-facing completion copy, CTA enablement, status badges, redirects, or "done" messaging.
3) Update those surfaces to use the canonical staged readiness field from the shared service/read model, not local UI inference.
4) Preserve the current staged workflow design. Do not try to force everything into one blocking transaction if the current architecture intentionally queues safe follow-up work.
5) Reuse existing shared services/resolvers. Do not duplicate readiness logic in components.
6) Keep the UI practical and explicit: if a record is saved but downstream work is pending, show that plainly and point staff to the repair/retry path.
7) List every screen changed and what readiness field it now trusts.

Validation:
- Run typecheck and report results.
- Summarize downstream impact by workflow.
- Call out any screens that still cannot be corrected cleanly without a larger read-model refactor.

Do not overengineer. Do not introduce new frameworks. Keep the fix maintainable and auditable.
```

#### 4. Regression Risks
- Overcorrecting status copy could hide legitimately completed records behind "pending" wording.
- Any page that uses stale ad hoc status derivation may need read-model updates, not just UI changes.
- Signed POF surfaces could drift if one page uses new sync detail and another still keys off signature status only.

#### 5. Retest Checklist
1. Create an intake where draft POF or PDF follow-up is forced to fail and verify every staff surface shows staged readiness, not simple signed completion.
2. Complete an enrollment packet with downstream mapping failure and verify list/detail views show operational follow-up pending.
3. Sign a care plan and force caregiver dispatch or snapshot follow-up failure; verify the saved record is visible with post-sign readiness status.
4. Sign a POF and force downstream sync queueing; verify staff can see signed versus fully synced separately.

#### 6. Optional Follow-up Prompt
```text
After the staged-readiness truth pass, add a small audit helper or test matrix that lists every staff-facing status surface for intake, enrollment packet, care plan, and POF workflows, and asserts each one consumes the canonical readiness field instead of local UI inference.
```

### Prompt Pack 3: Care Plan Partial-Commit Operator UX

#### 1. Problem Summary
Care plan core writes can already be committed before later snapshot or caregiver-dispatch follow-up fails. The current behavior avoids false success, but the resulting error can still mislead staff into thinking the whole care plan failed to save.

#### 2. Root Cause Framing
- Likely root cause:
  - The write path is correctly staged, but the post-action redirect/error UX does not clearly center the already-saved care plan and next action.
- Affected workflow/domain:
  - care plan create/review/sign
- Issue class:
  - workflow integrity
  - UX

#### 3. Best Codex Fix Prompt
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Care plan create/review/sign can return an error after the core care plan record is already saved, which creates a false-failure user experience.

Scope:
- Domain/workflow: care plans
- Canonical entities/tables:
  - care_plans
  - care_plan_versions
  - care_plan_signature_events
  - any existing care plan post-sign readiness fields/events
- Expected canonical write path: UI -> Server Action -> Service Layer -> Supabase

Required approach:
1) Inspect `lib/services/care-plans-supabase.ts` and the care plan server actions to trace exactly what data is already durable before post-sign follow-up can fail.
2) Preserve the current canonical write path and staged safety behavior. Do not convert this into a UI-only workaround and do not downgrade a true partial-follow-up failure into silent success.
3) Change the operator experience so when the core care plan already exists, staff are routed back to the saved care plan with:
   - explicit post-sign readiness messaging
   - a clear resume/retry follow-up action if one already exists in the current architecture
   - no confusing generic "failed" dead end that encourages duplicate record creation
4) Reuse the existing readiness status and action-required patterns where possible.
5) Keep downstream care plan signature history, caregiver dispatch state, and saved version history truthful.

Validation:
- Run typecheck and report results.
- List changed files and describe how the create, review, and sign paths now behave on partial-follow-up failure.
- Call out any remaining gap that would require a later dedicated repair action.

Do not overengineer. Do not introduce new frameworks. Keep the fix maintainable and auditable.
```

#### 4. Regression Risks
- Redirect changes could break the happy-path create/review/sign flow if they assume a saved id is always present.
- Caregiver dispatch retry UX could drift from the canonical follow-up queue/action-required model if implemented ad hoc.
- Error handling might accidentally hide true "nothing saved" failures if the durable-save boundary is not traced carefully.

#### 5. Retest Checklist
1. Create a care plan and force post-sign follow-up failure; verify the app lands on the saved care plan, not a dead-end error state.
2. Confirm the record id, nurse signature state, and readiness status are visible after the failure.
3. Retry the follow-up and verify no duplicate care plan is created.
4. Verify the normal happy path still routes and messages correctly when no follow-up failure occurs.

#### 6. Optional Follow-up Prompt
```text
Add regression coverage for care plan partial-commit behavior in Memory Lane. The test should prove that a follow-up failure after durable save does not create duplicate care plans and that the resulting UI/state points staff back to the saved record with canonical readiness detail.
```

### Prompt Pack 4: Canonical Member Lookup and Members Page Pagination

#### 1. Problem Summary
Shared member lookup helpers still return the full roster by default, and `/members` still loads the full matching member list without pagination. This is now one of the most repeated scaling risks in the app.

#### 2. Root Cause Framing
- Likely root cause:
  - Shared lookup helpers were designed for convenience and small rosters, so multiple screens inherited a full-roster default instead of explicit search/paged read models.
- Affected workflow/domain:
  - members roster, dashboard snapshots, blood sugar picker, workflow dropdowns, shared lookups.
- Issue class:
  - performance

#### 3. Best Codex Fix Prompt
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Shared member lookup helpers still default to full-roster reads, and the main members page still returns the full matching roster without pagination.

Scope:
- Domain/workflow:
  - shared member lookup helpers
  - `/members`
  - dashboard/member picker consumers that currently preload the roster
- Canonical services/files to inspect first:
  - `lib/services/member-command-center-runtime.ts`
  - `lib/services/shared-lookups-supabase.ts`
  - `app/(portal)/members/page.tsx`
  - current dashboard/form callers surfaced by the March 25 query audit
- Expected canonical read path: UI -> Server Action/read model -> Service Layer -> Supabase

Required approach:
1) Inspect the current shared member lookup helpers and identify which callers truly need:
   - search-based lookup
   - paginated table results
   - small bounded default lists
2) Introduce one canonical search-based member lookup path with explicit `q`, `limit`, and status filtering for dropdowns/forms.
3) Introduce or finish one canonical paginated member-list path for `/members` and any table-style consumers.
4) Update current callers so forms and dashboards stop preloading the full roster unless the screen explicitly requires it.
5) Preserve role restrictions and existing member identity semantics.
6) Do not create separate local lookup logic per page. Keep the shared service path authoritative.
7) Report which callers were converted and which intentionally still use a broader read.

Validation:
- Run typecheck and report results.
- Summarize downstream impact and any UI behavior changes.
- Call out any remaining screen that still needs a separate follow-up because it depends on a broad roster read.

Do not overengineer. Do not introduce new frameworks. Keep the fix maintainable and auditable.
```

#### 4. Regression Risks
- Dropdowns may appear empty until the user types if minimum-search behavior is introduced without practical UI handling.
- Existing pages may rely on full-roster behavior implicitly for client-side filtering/export.
- `/members` paging can drift from current sort/filter semantics if not traced carefully through the existing service path.

#### 5. Retest Checklist
1. Load `/members` with a large expected roster and verify the first page loads without requesting the whole roster.
2. Search for a member in each updated dropdown and verify results are limited and accurate.
3. Confirm member selection still works in blood sugar and other updated workflow pickers.
4. Verify role restrictions and canonical member identity handling did not change.

#### 6. Optional Follow-up Prompt
```text
After the member lookup refactor, add a quick inventory doc or test list of every shared member lookup caller so future pages do not silently reintroduce full-roster defaults.
```

### Prompt Pack 5: Sales Summary Report and Canonical Sales RPC Usage

#### 1. Problem Summary
The sales summary report still aggregates broad lead/member/location datasets in app memory, and the shared sales dashboard summary RPC wrapper is duplicated across service layers. That is both a scaling problem and a canonical read-path drift risk.

#### 2. Root Cause Framing
- Likely root cause:
  - The lighter dashboard path was consolidated first, but the heavier report path and wrapper cleanup were left behind.
- Affected workflow/domain:
  - sales summary reporting and canonical sales read models.
- Issue class:
  - performance
  - maintainability

#### 3. Best Codex Fix Prompt
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
The sales summary report still loads broad sales/member data into app memory, and `rpc_get_sales_dashboard_summary` usage is duplicated across service layers.

Scope:
- Domain/workflow: sales summary/home reporting
- Canonical entities/tables:
  - leads
  - members (converted/discharged linkage via `source_lead_id`)
  - member_command_centers or related location data used by the report
- Canonical services/files to inspect first:
  - `lib/services/sales-summary-report.ts`
  - `lib/services/sales-crm-read-model.ts`
  - `lib/services/sales-workflows.ts`
  - current sales summary RPC migration(s)
- Expected canonical read path: UI/report -> shared read model/RPC wrapper -> Supabase

Required approach:
1) Inspect the current sales summary report path end-to-end and confirm the exact output shape the page/export needs.
2) Replace the broad app-memory aggregation with one canonical Supabase-backed read model or RPC that accepts date range and optional location filters.
3) Preserve canonical lead/member identity logic. Do not let TypeScript re-implement stage/status normalization or converted-member linkage differently from the canonical sales boundary.
4) Consolidate duplicated `rpc_get_sales_dashboard_summary` wrapper logic into one authoritative shared function used by both sales read paths.
5) Add supporting indexes only if the final query shape actually needs them.
6) Do not add mock fallbacks or a parallel report-specific resolver path.

Validation:
- Run typecheck and report results.
- List changed files and the downstream report/output impact.
- Call out any schema or migration requirements explicitly.

Do not overengineer. Do not introduce new frameworks. Keep the fix maintainable and auditable.
```

#### 4. Regression Risks
- Sales totals may shift if existing app-memory logic had implicit edge-case handling that the new RPC misses.
- Duplicate wrapper cleanup can break callers if one path was shaping dates or defaults differently.
- Location filtering and discharged-member attribution need careful parity checks against the current report.

#### 5. Retest Checklist
1. Run the sales summary for a known date range before and after the change and compare totals.
2. Verify optional location filtering still matches the current report behavior.
3. Confirm the sales home/dashboard path still renders correctly after wrapper consolidation.
4. Check one converted/discharged lead/member example to verify attribution stays correct.

#### 6. Optional Follow-up Prompt
```text
After moving the sales summary report onto one canonical RPC/read model, add a small parity harness or snapshot test for a fixed seed/date range so future changes do not reintroduce TypeScript-side aggregation drift.
```

### Prompt Pack 6: Reports Home, MHP Detail, and Member Files Read Slimming

#### 1. Problem Summary
Several remaining broad reads are no longer in the hottest workflow write paths, but they are still expensive and will keep scaling poorly: `reports-ops`, MHP detail loads, and the extra `member_files` read.

#### 2. Root Cause Framing
- Likely root cause:
  - The repo already fixed the most obvious bottlenecks first, but these read paths still mix convenience queries, broad collections, and app-side aggregation instead of narrower canonical read models.
- Affected workflow/domain:
  - reports home, member health profile detail, member files.
- Issue class:
  - performance

#### 3. Best Codex Fix Prompt
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Reports home, MHP detail, and member-files listing still do broader reads than necessary, which will scale poorly as operational history grows.

Scope:
- Domain/workflow:
  - `lib/services/reports-ops.ts`
  - `lib/services/member-health-profiles-supabase.ts`
  - `lib/services/member-command-center-runtime.ts` (`listMemberFilesSupabase`)
- Expected canonical read path: UI -> shared read model/service -> Supabase

Required approach:
1) Inspect these three read paths separately and choose the smallest safe improvement for each:
   - reports home: replace broad app-memory aggregation with bounded/aggregated Supabase queries or one shared RPC
   - MHP detail: keep overview light and move heavy collections/directory reads behind narrower tab-aware reads or search-based lookups
   - member files: remove the second `member_files` read without breaking legacy inline-file detection
2) Preserve existing UI output shape where possible.
3) Reuse shared helpers and canonical read boundaries instead of adding per-page query logic.
4) Do not add mock fallbacks.
5) Add indexes only if the final query shapes prove they are needed.
6) Report each sub-fix separately so downstream risk is easy to review.

Validation:
- Run typecheck and report results.
- List changed files and which reads were eliminated or narrowed.
- Call out anything deferred because it needs a larger read-model refactor.

Do not overengineer. Do not introduce new frameworks. Keep the fix maintainable and auditable.
```

#### 4. Regression Risks
- MHP tabs may start loading data lazily and need explicit loading/error states.
- Reports-home totals could change if current app-memory logic includes undocumented filters.
- Legacy member-file rows could disappear from the list if inline-file detection is not preserved correctly.

#### 5. Retest Checklist
1. Open reports home and verify summary totals still render correctly without broad table reads.
2. Open MHP overview and each heavy tab; verify data still loads correctly and provider/hospital lookups remain usable.
3. Open member files for a record with legacy inline file data and verify the file still appears correctly after removing the second query.
4. Confirm no role/permission boundaries changed on any of these read surfaces.

#### 6. Optional Follow-up Prompt
```text
After slimming reports home, MHP detail, and member-files reads, run a focused query-performance audit just on those paths and summarize remaining whole-table reads, remaining app-memory joins, and whether any new supporting index is actually justified.
```

## 3 Fix Priority Order

1. Enrollment packet child lineage enforcement
   - Highest data-integrity value because it closes a remaining DB-boundary split-brain risk in a lifecycle-critical workflow.
2. Staged readiness truth across operator surfaces
   - Highest workflow-safety value because it prevents staff from acting on incomplete downstream handoffs.
3. Care plan partial-commit operator UX
   - Next because it reduces duplicate retry confusion around already-saved care plans.
4. Canonical member lookup and `/members` pagination
   - Highest broad performance payoff across many screens.
5. Sales summary report and canonical sales RPC usage
   - High-value reporting/performance cleanup with clear canonical boundary benefits.
6. Reports home, MHP detail, and member-files read slimming
   - Important, but safer to do after the higher-value lineage/readiness fixes and member lookup cleanup.

## 4 Founder Summary

- Good news:
  - The March 25 production-readiness audit did not find new canonicality or Supabase-backing regressions in the priority domains.
  - The biggest launch-blocking billing atomicity issue from yesterday is already closed.
  - The blood-sugar and admin-audit performance fixes from March 24 are holding.

- What is still meaningfully open:
  - One remaining schema-integrity gap in enrollment packet child lineage.
  - A cross-screen truth problem where some workflows are safe-but-staged, and the UI still needs to make that staged state clearer to staff.
  - A smaller but important care-plan false-failure UX problem.
  - The next performance bottlenecks are now shared member lookups, the sales summary report, reports home, MHP detail loads, and the extra member-files read.

- What I did not invent:
  - There are still no fresh standalone March 25 in-repo markdown reports for RLS/security, daily canonicality, shared resolver drift, or idempotency/duplicate submission.
  - I only generated prompts from the current reports that actually exist in the repo.
