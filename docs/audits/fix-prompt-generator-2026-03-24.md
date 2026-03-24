# Fix Prompt Generator - 2026-03-24

## 1. Issues Detected

Fresh March 24 markdown artifacts were present for:
- Production Readiness Audit
- Memory Lane ACID Audit
- Workflow Simulation Audit
- Supabase Query Performance Audit

No fresh standalone March 24 markdown artifacts were present in `docs/audits` for:
- Supabase RLS & Security Audit
- Daily Canonicality Sweep
- Schema Migration Safety Audit
- Shared Resolver Drift Check
- Shared RPC Architecture Audit
- Idempotency & Duplicate Submission Audit

Those missing artifacts are treated as audit-input gaps, not invented findings.

### Issue 1
- Title: Clinical parent/member lineage is not enforced at the schema boundary
- Source audits:
  - `docs/audits/acid-transaction-audit-2026-03-24.md` (Finding C1)
- Violated rule:
  - Canonical Entity Identity
  - Schema Drift Prevention
  - ACID Transaction Requirements
- Why it matters:
  - Intake, POF, and MAR child rows can still point at valid parent rows that belong to a different member. That is a data-corruption risk, not just a UI bug.
- Safest fix approach:
  - Run a read-only mismatch audit first.
  - Then add composite uniqueness on parent tables and composite foreign keys on child tables so `(parent_id, member_id)` lineage is enforced by Supabase.

### Issue 2
- Title: Billing custom invoice writes are still non-atomic
- Source audits:
  - `docs/audits/production-readiness-audit-2026-03-24.md`
- Violated rule:
  - Shared RPC Standard
  - ACID Transaction Requirements
  - Required write path: UI -> Server Action -> Service Layer -> Supabase
- Why it matters:
  - Invoice header, lines, source rows, and coverage writes can partially succeed and leave billing in an inconsistent state.
- Safest fix approach:
  - Move the full custom-invoice save/finalize path behind one shared RPC-backed billing service operation.

### Issue 3
- Title: Enrollment packet operational readiness is still easy to misread downstream
- Source audits:
  - `docs/audits/acid-transaction-audit-2026-03-24.md` (Finding A2, D2)
  - `docs/audits/workflow-simulation-audit-founder-2026-03-24.md`
- Violated rule:
  - Workflow State Integrity
  - Shared Resolver / Service Boundaries
  - Completion Criteria
- Why it matters:
  - A packet can be filed while mapping, lead activity, or follow-up work is still pending. Staff can treat `filed` as done when operationally it is not.
- Safest fix approach:
  - Keep the staged workflow.
  - Standardize all downstream reads and UI badges/buttons on one canonical readiness resolver or one already-returned readiness field.

### Issue 4
- Title: Manual intake/enrollment repair queues still allow overlapping retries
- Source audits:
  - `docs/audits/acid-transaction-audit-2026-03-24.md` (Finding I1)
- Violated rule:
  - Idempotency and Replay Safety
  - ACID Transaction Requirements
- Why it matters:
  - Two staff retries can pick up the same repair task and create duplicate attempts, noisy alerts, and racey operator behavior.
- Safest fix approach:
  - Add a lightweight claim/lease step before manual retry execution, while preserving the existing replay-safe canonical writes.

### Issue 5
- Title: Admin audit trail still scans too much data without real pagination
- Source audits:
  - `docs/audits/query-performance-audit-2026-03-24.md`
- Violated rule:
  - Maintainability
  - Auditability
  - Build Performance Guardrails
- Why it matters:
  - The audit trail page loads up to 1,000 rows without proper paging and lacks a supporting `audit_logs(action, created_at desc)` index.
- Safest fix approach:
  - Add real page/range support in the canonical read service and add the smallest safe index.

### Issue 6
- Title: Blood sugar page still pays full MAR snapshot cost
- Source audits:
  - `docs/audits/query-performance-audit-2026-03-24.md`
- Violated rule:
  - Shared Resolver / Service Boundaries
  - Maintainability
- Why it matters:
  - A focused blood-sugar workflow still loads broad MAR reads it does not render, which will scale badly.
- Safest fix approach:
  - Split a dedicated blood-sugar read model and add the small global `checked_at desc` index if query shape still needs it.

### Issue 7
- Title: Member Command Center still uses whole-census reads for locker and add-rider flows
- Source audits:
  - `docs/audits/query-performance-audit-2026-03-24.md`
- Violated rule:
  - Shared Resolver / Service Boundaries
  - Maintainability
- Why it matters:
  - Locker availability and transportation add-rider options still scale with the entire active roster.
- Safest fix approach:
  - Replace whole-table roster reads with narrower server-filtered queries or shared RPC-backed option loaders.

### Issue 8
- Title: Member Health Profile detail still reloads full provider and hospital directories
- Source audits:
  - `docs/audits/query-performance-audit-2026-03-24.md`
- Violated rule:
  - Shared Resolver / Service Boundaries
  - Maintainability
- Why it matters:
  - Every member-detail load re-reads broad lookup directories and the same lookup logic is duplicated across read and write services.
- Safest fix approach:
  - Introduce one shared lookup helper and defer or narrow directory loading to only the edit flows that need it.

### Issue 9
- Title: Several operational server actions still return success-like results from catch blocks
- Source audits:
  - `docs/audits/workflow-simulation-audit-2026-03-24.md`
  - `docs/audits/workflow-simulation-audit-founder-2026-03-24.md`
- Violated rule:
  - Workflow State Integrity
  - Completion Criteria
  - Do-Not Rule: do not return synthetic success when persistence or downstream effects fail
- Why it matters:
  - Silent-success patterns can tell staff a workflow completed when a durable write or downstream side effect actually failed.
- Safest fix approach:
  - Audit the listed action modules and convert catch paths to explicit failure or partial-failure results with durable follow-up state where needed.

## 2. Codex Fix Prompts

### Prompt 1
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Clinical child tables still allow parent/member lineage mismatches across intake, POF, and MAR workflows.

Scope:
- Domain/workflow: intake, physician orders, MAR
- Canonical entities/tables: intake_assessment_signatures, intake_post_sign_follow_up_queue, pof_medications, mar_schedules, mar_administrations and their parent tables
- Expected canonical write path: UI -> Server Action -> Service Layer -> Supabase

Required approach:
1) Inspect the current schema and service assumptions first. Confirm exactly which child tables carry both a parent id and member_id.
2) Add a read-only drift audit query pack first so we can detect any existing mismatches before enforcing new constraints.
3) Implement the smallest clean migration set that adds parent-side composite uniqueness like (id, member_id) where needed and replaces single-column child foreign keys with composite foreign keys that enforce lineage.
4) Preserve current canonical service boundaries. Do not patch this only in UI or action code.
5) If any service writes depend on old FK shapes, update those services in the same pass.
6) Fail explicitly on mismatched lineage. Do not add fallback logic or silent coercion.

Validation:
- Run typecheck and report results.
- Summarize the drift-audit output shape, new constraints, rollout cautions, and any required pre-migration cleanup.
- List changed files and downstream impact.

Do not overengineer. Do not introduce new frameworks. Keep the fix maintainable and auditable.
```

### Prompt 2
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Billing custom invoice creation/finalization is still multi-step and non-atomic across invoice header, invoice lines, coverage updates, and source-row side effects.

Scope:
- Domain/workflow: billing custom invoices
- Canonical entities/tables: billing_invoices, billing_invoice_lines, billing_coverages, related source rows discovered in lib/services/billing-custom-invoices.ts
- Expected canonical write path: UI -> Server Action -> Service Layer -> Supabase

Required approach:
1) Inspect the full custom invoice write path end-to-end, starting with the server action and lib/services/billing-custom-invoices.ts.
2) Identify every table write and side effect that currently happens outside one transaction boundary.
3) Move the authoritative write path behind one shared RPC-backed service operation so the invoice either commits completely or fails completely.
4) Preserve existing pricing/rate resolution behavior and the new shared billing-effective resolver logic.
5) Remove any remaining partial-success behavior from the invoice flow. If downstream persistence fails, return an explicit failure.
6) Add or update migration-backed RPCs only as needed. Keep schema/runtime alignment explicit.

Validation:
- Run typecheck/build and report results.
- List changed files, migration impact, and any rollout/deployment blockers.
- Call out downstream billing/reporting surfaces that now rely on the atomic path.

Do not overengineer. Do not introduce new frameworks. Keep the fix maintainable and auditable.
```

### Prompt 3
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Enrollment packet workflows already return staged readiness signals, but some downstream consumers can still treat packet status=filed as if the workflow is fully operationally ready.

Scope:
- Domain/workflow: enrollment packet completion, downstream mapping, sales handoff
- Canonical entities/tables: enrollment_packet_requests, enrollment_packet_events, enrollment_packet_mapping_runs, lead_activities, member_files
- Expected canonical write path: UI -> Server Action -> Service Layer -> Supabase

Required approach:
1) Inspect the current public completion path and canonical read models first, especially lib/services/enrollment-packets-public-runtime.ts and any list/detail pages that show enrollment packet status.
2) Identify all staff-facing pages/actions/badges/buttons/reports that still imply filed = fully ready.
3) Standardize those consumers on one canonical readiness truth. Prefer reusing the existing operationalReadinessStatus or one shared resolver rather than introducing another state source.
4) Preserve the current staged design. Do not try to force all downstream mapping inline.
5) Make the UI explicit about pending/action-required follow-up when filing succeeded but downstream work is not complete.
6) Keep lead/member identity handling canonical and avoid duplicate status logic in UI components.

Validation:
- Run typecheck/build and report results.
- List every screen or read path changed.
- Explain downstream impact for sales, MCC, MHP, and packet tracking surfaces.

Do not overengineer. Do not introduce new frameworks. Keep the fix maintainable and auditable.
```

### Prompt 4
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Manual intake and enrollment follow-up retries still allow overlapping operators to retry the same repair task at the same time.

Scope:
- Domain/workflow: intake post-sign follow-up and enrollment packet follow-up/manual retry flows
- Canonical entities/tables: intake_post_sign_follow_up_queue, enrollment packet follow-up/repair tables discovered in the current canonical services
- Expected canonical write path: UI -> Server Action -> Service Layer -> Supabase

Required approach:
1) Inspect the current manual retry actions and follow-up queue services first.
2) Add a lightweight claim/lease step before retry execution so only one retry attempt owns a queued task at a time.
3) Preserve the existing replay-safe/idempotent canonical writes underneath the retry path.
4) Keep the fix small. Reuse the existing claim-based enrollment mapping pattern if that is the best architectural fit.
5) Make stale-claim recovery explicit if a retry crashes or times out.
6) Return explicit status to the UI so staff can tell whether the task was claimed, already in progress, succeeded, or still needs action.

Validation:
- Run typecheck/build and report results.
- Add or update deterministic regression coverage for two nearly-simultaneous retries.
- List changed files, migration impact, and manual concurrency retest steps.

Do not overengineer. Do not introduce new frameworks. Keep the fix maintainable and auditable.
```

### Prompt 5
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
The admin audit trail page still loads a large descending window with weak index support and no real pagination.

Scope:
- Domain/workflow: admin reporting / audit trail
- Canonical entities/tables: audit_logs
- Expected canonical read path: page -> shared service -> Supabase

Required approach:
1) Inspect app/(portal)/admin-reports/audit-trail/page.tsx and lib/services/admin-audit-trail.ts first.
2) Replace the current large fixed read with real pagination or cursor/range support in the shared service layer.
3) Keep Supabase as source of truth and preserve current filters/sorts.
4) Add the smallest safe migration-backed index for audit_logs(action, created_at desc).
5) Update the page to consume the paged read model without moving business logic into the UI.
6) Keep the response shape clear and auditable for staff users.

Validation:
- Run typecheck/build and report results.
- List changed files and the default page size/cursor behavior.
- Note any remaining live EXPLAIN follow-up still needed.

Do not overengineer. Do not introduce new frameworks. Keep the fix maintainable and auditable.
```

### Prompt 6
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
The blood sugar workflow page still calls a broad health/MAR snapshot even though it only needs blood sugar history and member lookup data.

Scope:
- Domain/workflow: blood sugar documentation
- Canonical entities/tables: blood_sugar_logs plus any member lookup tables the form actually needs
- Expected canonical read path: page -> shared service -> Supabase

Required approach:
1) Inspect app/(portal)/documentation/blood-sugar/page.tsx plus lib/services/health-workflows.ts and lib/services/health-dashboard.ts first.
2) Create a dedicated blood-sugar read model that returns only the data the page actually renders.
3) Preserve current UI behavior and canonical service boundaries. Do not leave this as a UI-only optimization.
4) If the final query shape still needs it, add the smallest safe index for blood_sugar_logs(checked_at desc).
5) Do not reintroduce broad MAR snapshot loading through helper reuse.

Validation:
- Run typecheck/build and report results.
- List changed files and any migration added.
- Explain what broad reads were removed and what downstream behavior stays the same.

Do not overengineer. Do not introduce new frameworks. Keep the fix maintainable and auditable.
```

### Prompt 7
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Member Command Center still performs whole-census reads for locker availability and transportation add-rider options.

Scope:
- Domain/workflow: Member Command Center runtime reads
- Canonical entities/tables: members, member_command_centers, member_contacts and any narrow supporting tables actually needed
- Expected canonical read path: page/action -> shared service -> Supabase

Required approach:
1) Inspect lib/services/member-command-center-runtime.ts first, especially the locker availability and add-rider option loaders.
2) Replace whole-table reads with narrower server-filtered queries or a small shared RPC if that is the cleanest canonical boundary.
3) Preserve current option behavior and role restrictions.
4) Keep business rules in shared services, not UI components.
5) Reuse one canonical active-member option path where possible instead of duplicating similar roster logic again.

Validation:
- Run typecheck/build and report results.
- List changed files and the before/after query-shape change.
- Call out any follow-up EXPLAIN targets for production verification.

Do not overengineer. Do not introduce new frameworks. Keep the fix maintainable and auditable.
```

### Prompt 8
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Member Health Profile detail still reloads full provider and hospital directories on every member page load, and similar lookup logic is duplicated in the write service.

Scope:
- Domain/workflow: Member Health Profile detail and edit lookups
- Canonical entities/tables: provider/hospital lookup tables discovered in lib/services/member-health-profiles-supabase.ts and lib/services/member-health-profiles-write-supabase.ts
- Expected canonical read/write path: page/action -> shared service -> Supabase

Required approach:
1) Inspect the current MHP read and write services first.
2) Identify the smallest clean shared lookup helper or narrow read path that both services can reuse.
3) Stop full-directory reads on every detail page load. Prefer deferred or edit-only lookup loading if that preserves current UX.
4) Remove duplicated lookup-query logic where possible without changing core business behavior.
5) Keep Supabase as source of truth and preserve role enforcement.

Validation:
- Run typecheck/build and report results.
- List changed files and explain which full-directory reads were removed.
- Note any UI behavior changes if edit-tab lazy loading is introduced.

Do not overengineer. Do not introduce new frameworks. Keep the fix maintainable and auditable.
```

### Prompt 9
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Several operational server actions still catch errors and return success-like ok:true responses, which can hide failed persistence or failed downstream workflow steps.

Scope:
- Domain/workflow: documentation actions, documentation create actions, sales lead actions, sales partner actions
- Canonical entities/tables: discover first from the affected action modules and the canonical services they call
- Expected canonical write path: UI -> Server Action -> Service Layer -> Supabase

Required approach:
1) Inspect the listed catch blocks in app/documentation-actions-impl.ts, app/documentation-create-actions-impl.ts, app/sales-lead-actions.ts, and app/sales-partner-actions.ts first.
2) For each path, identify whether the operation should fail hard, return an explicit partial-failure state, or create a durable follow-up/action-required record.
3) Remove synthetic success responses where persistence or required side effects failed.
4) Preserve canonical service boundaries and avoid duplicating business-rule logic in actions.
5) Keep user-facing error states deterministic and auditable.
6) If a path is intentionally best-effort, make that explicit in the returned status instead of implying success.

Validation:
- Run typecheck/build and report results.
- List every catch path changed and why.
- Call out any remaining paths intentionally left best-effort, with justification.

Do not overengineer. Do not introduce new frameworks. Keep the fix maintainable and auditable.
```

## 3. Fix Priority Order

1. Schema-level clinical lineage enforcement
2. Billing custom invoice atomicity
3. Enrollment packet operational-readiness truth
4. Silent-success catch block cleanup
5. Manual follow-up queue claim/lease hardening
6. Admin audit trail pagination + index
7. Blood sugar dedicated read model
8. Member Command Center roster narrowing
9. Member Health Profile lookup dedupe/defer

## 4. Founder Summary

- The most important open problem is still structural data safety, not UI polish: the database can still accept some clinically contradictory parent/member relationships unless schema constraints are tightened.
- The biggest workflow integrity gap in audited business logic is billing custom invoices still not being saved atomically.
- Enrollment packet and some other staged workflows are not pretending to be fully atomic anymore, but staff-facing consumers still need stronger canonical readiness truth so "filed" is not mistaken for "fully ready."
- The biggest remaining performance wins are now focused and practical: admin audit trail pagination, blood sugar over-fetching, MCC whole-census reads, and MHP directory reloads.
- March 24 did not include fresh standalone markdown artifacts for RLS/security, canonicality sweep, shared resolver drift, shared RPC architecture, schema migration safety, or idempotency. Those missing inputs should be generated separately rather than guessed from code.
