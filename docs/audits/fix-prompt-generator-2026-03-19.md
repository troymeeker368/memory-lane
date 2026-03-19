# Fix Prompt Generator Report
Generated: 2026-03-19

## 1. Issues Detected

Coverage note:
- Reviewed the newest available in-repo reports for:
  - `docs/audits/production-readiness-audit-2026-03-19.md`
  - `docs/audits/acid-transaction-audit-2026-03-19.md`
  - `docs/audits/workflow-simulation-audit-2026-03-19.md`
  - `docs/audits/query-performance-audit-2026-03-19.md`
  - `docs/audits/supabase-schema-compatibility-audit-2026-03-11.md` as the latest available schema/migration compatibility artifact
- I did not find fresh standalone March 19 report files for:
  - Supabase RLS & Security Audit
  - Daily Canonicality Sweep
  - Shared Resolver Drift Check
  - Shared RPC Architecture Audit
  - Idempotency & Duplicate Submission Audit
- This report does not invent findings for missing standalone audit outputs.

### 1. Post-commit event logging can still turn committed workflows into visible failures
- Audit sources:
  - `docs/audits/acid-transaction-audit-2026-03-19.md`
- Architectural rule violated:
  - ACID transaction requirements
  - Workflow state integrity
  - Explicit failures when persistence or required side effects fail
- Why this is open:
  - Lead conversion, signed POF post-sign sync, enrollment packet send, POF send/resend, and care plan send still commit the core business write first and then do required event/audit logging in app code.
  - If the event insert fails after commit, staff can see an error and retry a workflow that already succeeded.
- Safest fix approach:
  - Keep the existing RPC/service commit as the success boundary.
  - Make post-commit observability writes best-effort, or move them into the canonical RPC where they are truly required for success.

### 2. Public POF open flow can overwrite a newly voided request back to `opened`
- Audit sources:
  - `docs/audits/acid-transaction-audit-2026-03-19.md`
- Architectural rule violated:
  - ACID transaction requirements
  - Idempotency and replay safety
  - Workflow state integrity
- Why this is open:
  - The POF delivery-state transition RPC still allows a stale public-open call to move a request back to `opened` without an expected-current-state guard.
- Safest fix approach:
  - Add compare-and-set delivery-state validation in the canonical RPC and update callers to respect no-op/conflict results.

### 3. PRN MAR administration still has no duplicate-submission guard
- Audit sources:
  - `docs/audits/acid-transaction-audit-2026-03-19.md`
- Architectural rule violated:
  - Idempotency and replay safety
  - ACID transaction requirements
  - One canonical write path per workflow
- Why this is open:
  - `documentPrnMarAdministration` can insert duplicate administrations on double-click, retry, or near-simultaneous staff actions.
- Safest fix approach:
  - Add a narrow DB-backed uniqueness/idempotency rule and enforce it in the canonical MAR service path.

### 4. `member_files` still lacks one canonical uniqueness rule for generated artifacts
- Audit sources:
  - `docs/audits/acid-transaction-audit-2026-03-19.md`
- Architectural rule violated:
  - Canonical entity identity
  - Schema drift prevention
  - Migration-driven schema alignment
- Why this is open:
  - Runtime code treats `(member_id, document_source)` as an upsert key, but the database does not enforce that for generated artifacts broadly enough.
- Safest fix approach:
  - Deduplicate existing rows safely, then add one forward-only unique index and keep the RPC upsert path canonical.

### 5. Member-file delete still uses the wrong durability order
- Audit sources:
  - `docs/audits/acid-transaction-audit-2026-03-19.md`
- Architectural rule violated:
  - ACID transaction requirements
  - Durability
  - Success must never be returned if required downstream persistence fails
- Why this is open:
  - Storage deletion currently happens before DB row deletion, so a DB failure can leave a live row pointing to a missing file.
- Safest fix approach:
  - Move deletion behind one canonical RPC/workflow, or at minimum make the DB record state authoritative before destructive storage removal.

### 6. Failed enrollment packet finalization can leave staged upload rows behind
- Audit sources:
  - `docs/audits/acid-transaction-audit-2026-03-19.md`
- Architectural rule violated:
  - Durability
  - Auditability
  - Explicit failures when persistence or required side effects fail
- Why this is open:
  - Cleanup removes storage/member-file artifacts when possible, but failed batches can still leave `enrollment_packet_uploads` metadata rows behind.
- Safest fix approach:
  - Add one canonical cleanup RPC or service boundary that also removes or marks failed upload rows.

### 7. Several server actions still return `ok: true` after caught errors
- Audit sources:
  - `docs/audits/workflow-simulation-audit-2026-03-19.md`
- Architectural rule violated:
  - Explicit failure handling
  - No synthetic success when persistence or required side effects fail
  - Auditability
- Why this is open:
  - The latest workflow audit still flags catch paths in documentation, sales, time, member badge, and incidents actions that can report success after exceptions.
- Safest fix approach:
  - Classify each catch path as required write failure vs optional follow-up failure and stop returning synthetic success for required paths.

### 8. Shared member lookup still pulls too much data on hot read paths
- Audit sources:
  - `docs/audits/query-performance-audit-2026-03-19.md`
- Architectural rule violated:
  - Maintainability
  - Shared resolver / service boundaries
  - Production readiness
- Why this is open:
  - `listMembersSupabase()` still loads a broad member set and applies search in memory, and the same helper is reused by multiple screens.
- Safest fix approach:
  - Replace shared full-list usage with either paginated search or a lightweight lookup query while keeping one canonical member lookup boundary.

### 9. MAR dashboard read path still performs write-like sync work and wide reads
- Audit sources:
  - `docs/audits/query-performance-audit-2026-03-19.md`
- Architectural rule violated:
  - Production readiness
  - Shared RPC/service boundaries
  - Predictable downstream effects
- Why this is open:
  - `getMarWorkflowSnapshot()` still forces schedule reconciliation before each read and still pulls broad view payloads.
- Safest fix approach:
  - Keep MAR generation/write workflows canonical, but move reconciliation off the hot read path or gate it behind freshness checks and narrow the read selects.

### 10. Admin reporting and audit reads still push too much work into app memory
- Audit sources:
  - `docs/audits/query-performance-audit-2026-03-19.md`
  - `docs/audits/production-readiness-audit-2026-03-19.md`
  - `docs/audits/supabase-schema-compatibility-audit-2026-03-11.md`
- Architectural rule violated:
  - Supabase-first architecture
  - Shared service boundaries
  - Production readiness
- Why this is open:
  - New reporting reads pull full date ranges into app memory, and admin audit filtering still relies on app-side post-processing.
- Safest fix approach:
  - Push more aggregation/filtering into canonical SQL/service reads and add the smallest safe index support needed by current query patterns.

## 2. Codex Fix Prompts

### Prompt 1. Stop false failures after committed writes

#### 1. Problem Summary
Several workflow commits are durable in Supabase before a later event/audit insert runs in app code. If that trailing insert fails, the user can see an error and retry a workflow that already committed.

#### 2. Root Cause Framing
- Likely architectural cause: canonical business success and observability success are still coupled after the transaction boundary
- Affected workflow/domain: lead conversion, enrollment packet send, POF send/resend, signed POF post-sign sync, care plan send
- Issue class: data safety

#### 3. Best Codex Fix Prompt
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Post-commit event/audit writes can still make committed workflows look failed to staff.

Scope:
- Domain/workflow: lead conversion, enrollment packet send, POF send/resend, signed POF post-sign sync, care plan send
- Canonical entities/tables: leads, members, enrollment_packet_requests, pof_requests, physician_orders, care_plans, system_events and related workflow event tables
- Expected canonical write path: UI -> Server Action -> Service Layer -> Supabase

Required approach:
1) Inspect the current success boundary first in:
   - `lib/services/sales-lead-conversion-supabase.ts`
   - `lib/services/physician-orders-supabase.ts`
   - `lib/services/enrollment-packets.ts`
   - `lib/services/pof-esign.ts`
   - `lib/services/care-plan-esign.ts`
2) Identify which writes are business-critical and which are observability/audit follow-up only.
3) Preserve the current canonical RPC/service commit as the authoritative business success boundary.
4) For post-commit observability writes, either:
   - move them into the canonical RPC if they are required for success, or
   - make them best-effort/non-blocking after the business write already committed.
5) Do not let a failed follow-up event insert throw a user-visible workflow failure after the core business record already committed.
6) Preserve auditability by logging/alerting failed follow-up writes somewhere durable, but do not reintroduce duplicate business writes or UI-side patches.
7) Update related callers only as needed so success/failure semantics are explicit and consistent.

Validation:
- Run `npm run typecheck` and `npm run build` if the environment permits.
- List changed files and downstream impact.
- Call out any workflow where audit/event persistence is truly part of the transaction and must move into SQL/RPC instead of becoming best-effort.

Do not overengineer. Keep Supabase as source of truth and keep one canonical success boundary per workflow.
```

#### 4. Regression Risks
- Lead conversion retries could start hiding event-log failures instead of surfacing them durably.
- Enrollment/POF/care plan send screens could drift if they still equate event insert success with workflow success.
- Operational alerts could become less visible if observability failures are swallowed instead of rerouted to a durable warning path.

#### 5. Retest Checklist
1. Convert a lead and verify the member conversion persists even if a follow-up event insert is forced to fail.
2. Send an enrollment packet and confirm the request row is persisted once with no duplicate live links.
3. Send and resend a POF request and verify request state stays accurate if event logging fails.
4. Complete a signed POF post-sign sync path and verify committed clinical state is not rolled back by observability errors.
5. Send a care plan for signature and verify the request remains durable and auditable.

#### 6. Optional Follow-up Prompt
```text
After the false-failure fix, add one small reliability audit that detects workflows where the canonical business write committed but the follow-up observability write failed. Store the alert in a durable operational table or queue so staff can reconcile it later without retrying the original workflow.
```

### Prompt 2. Add compare-and-set protection to POF public open transitions

#### 1. Problem Summary
A provider opening a POF link can overwrite a request that was just voided or otherwise changed, because the public open path still lacks expected-current-state validation.

#### 2. Root Cause Framing
- Likely architectural cause: stale public-link state transition is not guarded at the canonical RPC boundary
- Affected workflow/domain: POF public signing delivery-state transitions
- Issue class: workflow integrity

#### 3. Best Codex Fix Prompt
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
The public POF open flow can overwrite a newly voided or changed request back to `opened`.

Scope:
- Domain/workflow: POF public token open flow
- Canonical entities/tables: pof_requests
- Expected canonical write path: UI -> Server Action -> Service Layer -> Supabase RPC

Required approach:
1) Inspect the full public-open path first in:
   - `lib/services/pof-esign.ts`
   - `supabase/migrations/0073_delivery_and_member_file_rpc_hardening.sql`
   - `supabase/migrations/0082_fix_pof_delivery_state_rpc_ambiguity.sql`
2) Keep `rpc_transition_pof_request_delivery_state` as the canonical state-transition boundary.
3) Add compare-and-set protection so callers can require an expected current state before moving a request to `opened`.
4) Update the public-open caller so it does not blindly overwrite requests that were already voided, declined, expired, or otherwise changed after the page was first loaded.
5) Return an explicit no-op/conflict result when the state no longer matches instead of fabricating success.
6) Preserve current role/public-token boundaries and avoid UI-only state guards.

Validation:
- Run `npm run typecheck` and `npm run build` if the environment permits.
- List changed files and schema impact.
- Explicitly report how stale-token opens now behave for already-voided and already-opened requests.

Do not overengineer. This is a transaction-safety hardening fix inside the canonical RPC path.
```

#### 4. Regression Risks
- Existing open-link telemetry may depend on unconditional `opened` transitions.
- Some repeated-open flows may now return a safe no-op instead of writing a fresh timestamp.
- Public signing pages could need small message updates when a request is no longer valid.

#### 5. Retest Checklist
1. Open a valid POF link and verify the request moves to `opened`.
2. Void the request, then retry the old public-open path and confirm it does not move back to `opened`.
3. Retry opening an already-open request and confirm behavior is explicit and non-destructive.
4. Confirm expired or declined requests still reject public open correctly.

#### 6. Optional Follow-up Prompt
None.

### Prompt 3. Make PRN MAR documentation replay-safe

#### 1. Problem Summary
PRN MAR administration can still be recorded twice for the same real-world event, which is unsafe for medication documentation and hard to unwind later.

#### 2. Root Cause Framing
- Likely architectural cause: canonical MAR write path lacks DB-backed duplicate protection for PRN submissions
- Affected workflow/domain: PRN medication administration documentation
- Issue class: data safety

#### 3. Best Codex Fix Prompt
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
PRN MAR documentation still has no duplicate-submission guard, so double-clicks or retries can create duplicate administrations.

Scope:
- Domain/workflow: PRN MAR administration documentation
- Canonical entities/tables: mar_administrations, pof_medications, members
- Expected canonical write path: UI -> Server Action -> Service Layer -> Supabase

Required approach:
1) Inspect `lib/services/mar-workflow.ts`, especially `documentPrnMarAdministration`, and the relevant MAR migrations first.
2) Keep the canonical MAR service path authoritative. Do not patch this only in the UI.
3) Add the smallest safe duplicate-protection design that still allows legitimate separate administrations at different times.
4) Prefer a DB-backed safeguard plus service-level validation. If an idempotency token does not already exist, use a narrow uniqueness/duplicate window keyed off the true PRN event identity.
5) Return an explicit duplicate-safe result instead of inserting a second row for the same event.
6) Preserve role boundaries, auditability, and existing MAR downstream reads.

Validation:
- Run `npm run typecheck` and `npm run build` if the environment permits.
- List changed files and any migration/index added.
- Explain how the fix distinguishes accidental replay from a legitimate later PRN administration.

Do not overengineer. The goal is replay safety, not a full MAR redesign.
```

#### 4. Regression Risks
- An overly broad uniqueness rule could block legitimate later PRN administrations.
- UI callers may need to handle duplicate-safe responses differently than generic errors.
- Existing reports may assume every submit creates a new row.

#### 5. Retest Checklist
1. Submit one PRN administration and verify exactly one row is created.
2. Double-submit the same PRN action and confirm no duplicate row is inserted.
3. Record a later legitimate PRN administration and confirm it still succeeds.
4. Verify MAR history, dashboards, and notifications still show the correct single event.

#### 6. Optional Follow-up Prompt
```text
Add a small duplicate-detection audit query for recent PRN MAR rows so operations can find and reconcile legacy duplicates created before the replay-safe fix shipped.
```

### Prompt 4. Enforce one canonical `member_files` row per `(member_id, document_source)`

#### 1. Problem Summary
Generated document artifacts still rely on app-level upsert assumptions that are not fully enforced by the database, so race conditions can create duplicate canonical files.

#### 2. Root Cause Framing
- Likely architectural cause: runtime upsert contract is stronger than current DB constraints
- Affected workflow/domain: member files across intake, care plans, MAR reports, incidents, and similar generated artifacts
- Issue class: consistency

#### 3. Best Codex Fix Prompt
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
`member_files` still lacks one canonical database uniqueness rule for generated artifacts keyed by `(member_id, document_source)`.

Scope:
- Domain/workflow: generated member-file persistence
- Canonical entities/tables: member_files
- Expected canonical write path: UI -> Server Action -> Service Layer -> Supabase RPC/service

Required approach:
1) Inspect the current canonical upsert path first in:
   - `lib/services/member-files.ts`
   - `rpc_upsert_member_file_by_source` and related migrations
2) Confirm where runtime code already treats `document_source` as the canonical upsert key.
3) Add a forward-only migration that:
   - safely detects and resolves existing duplicates where possible
   - creates one unique index on `(member_id, document_source)` where `document_source is not null`
4) Keep the RPC/service upsert path as the only canonical write boundary for these artifacts.
5) Update callers only if needed to align with the stricter DB contract.
6) Fail explicitly if legacy duplicates block rollout. Do not silently pick random winners without reporting them.

Validation:
- Run `npm run typecheck` and `npm run build` if the environment permits.
- List changed files, migration impact, and any dedupe/backfill work required before deploy.
- Confirm which workflows now rely on the canonical unique index.

Do not overengineer. This is a schema-truth fix that should stay narrow and auditable.
```

#### 4. Regression Risks
- Existing duplicate rows may block migration rollout until cleaned.
- Some legacy callers may still create artifacts without stable `document_source` values.
- Reports or pages that assume duplicate generated files are allowed may change behavior.

#### 5. Retest Checklist
1. Generate the same canonical document twice and confirm the same member file row is updated, not duplicated.
2. Retry a document generation workflow and verify no second row appears.
3. Check intake, care plan, and MAR report artifacts for the same member and confirm each canonical source still resolves correctly.

#### 6. Optional Follow-up Prompt
None.

### Prompt 5. Fix member-file delete durability ordering

#### 1. Problem Summary
Deleting storage before deleting the database row can leave the system with a file record that points to a file that no longer exists.

#### 2. Root Cause Framing
- Likely architectural cause: destructive storage side effect runs before canonical DB state change is secured
- Affected workflow/domain: member file deletion in MCC and related document flows
- Issue class: data safety

#### 3. Best Codex Fix Prompt
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Member-file deletion still removes storage before it durably resolves the canonical DB record state.

Scope:
- Domain/workflow: member-file deletion
- Canonical entities/tables: member_files and the linked storage object path
- Expected canonical write path: UI -> Server Action -> Service Layer -> Supabase

Required approach:
1) Inspect the current delete path first in:
   - `lib/services/member-files.ts`
   - `deleteCommandCenterMemberFile`
   - related storage delete helpers
2) Keep the service layer authoritative. Do not patch this in UI code.
3) Change the deletion workflow so the DB record state is authoritative before destructive storage removal, ideally through one canonical RPC/workflow.
4) If a full RPC is too large for this pass, use the smallest safe step that prevents live rows from pointing at missing files.
5) Preserve auditability and explicit failures. Do not return success if the record and storage are out of sync.
6) Report any migration or soft-delete need clearly if the current schema is not sufficient.

Validation:
- Run `npm run typecheck` and `npm run build` if the environment permits.
- List changed files and whether schema changes were needed.
- Explain the final failure order for: DB failure, storage failure, and partial cleanup.

Do not overengineer. This is a durability-order fix for regulated operational records.
```

#### 4. Regression Risks
- Storage cleanup jobs may need to handle rows already marked deleted.
- Existing UI may assume delete is immediate and final even if cleanup becomes staged.
- Download/view flows may need to honor a soft-deleted or pending-delete state.

#### 5. Retest Checklist
1. Delete a member file successfully and confirm both the DB row state and storage object state are correct.
2. Simulate a DB failure after storage access is available and confirm the system does not leave a live row pointing to a missing file.
3. Simulate a storage failure and confirm the record does not claim full deletion.

#### 6. Optional Follow-up Prompt
None.

### Prompt 6. Clean up failed enrollment packet upload rows canonically

#### 1. Problem Summary
Failed enrollment packet finalization can still leave stale upload metadata behind, which weakens audit clarity and can confuse later cleanup/review.

#### 2. Root Cause Framing
- Likely architectural cause: cleanup boundary handles storage/member files but not all packet-owned metadata
- Affected workflow/domain: enrollment packet public submission/finalization cleanup
- Issue class: workflow integrity

#### 3. Best Codex Fix Prompt
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Failed enrollment packet finalization can leave `enrollment_packet_uploads` rows behind even after artifact cleanup runs.

Scope:
- Domain/workflow: enrollment packet public submission cleanup
- Canonical entities/tables: enrollment_packet_requests, enrollment_packet_uploads, member_files
- Expected canonical write path: UI -> Server Action -> Service Layer -> Supabase

Required approach:
1) Inspect the failure and cleanup paths first in:
   - `lib/services/enrollment-packets.ts`
   - `lib/services/enrollment-packet-artifacts.ts`
   - related enrollment packet cleanup migrations
2) Keep enrollment packet finalization and cleanup inside canonical service boundaries.
3) Add the smallest safe cleanup improvement so failed batches do not leave stale `enrollment_packet_uploads` rows behind.
4) Prefer one canonical cleanup path that handles storage, member_files, and packet upload metadata together.
5) Preserve auditability. If rows should not be hard-deleted, mark them explicitly with a failed/cleaned status rather than leaving them looking live.
6) Do not add UI-side cleanup logic or silent fallbacks.

Validation:
- Run `npm run typecheck` and `npm run build` if the environment permits.
- List changed files and schema impact.
- Explain how packet review now distinguishes active uploads from failed cleaned-up uploads.

Do not overengineer. Keep the cleanup path explicit and auditable.
```

#### 4. Regression Risks
- Existing packet review screens may assume every upload row is active.
- Cleanup changes could affect retry flows if they rely on old staged rows.
- Hard delete vs status-mark decisions could change audit history expectations.

#### 5. Retest Checklist
1. Trigger a failed packet finalization and confirm staged upload rows are removed or clearly marked failed/cleaned.
2. Verify related storage objects and member_files rows are also reconciled.
3. Retry the packet flow and confirm stale rows do not interfere with the next submission.

#### 6. Optional Follow-up Prompt
None.

### Prompt 7. Remove synthetic success from flagged action catch blocks

#### 1. Problem Summary
Some server actions can still tell the UI that work succeeded after an exception, which creates false operational truth and hides persistence failures.

#### 2. Root Cause Framing
- Likely architectural cause: broad catch handlers were used to preserve UX but now mask required persistence failures
- Affected workflow/domain: documentation, sales, time, member badge, incidents
- Issue class: workflow integrity

#### 3. Best Codex Fix Prompt
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Several server actions still return `ok: true` from catch blocks even after exceptions, which can report success when required persistence failed.

Scope:
- Domain/workflow: documentation, sales, time, member badge, and incidents action flows
- Canonical entities/tables: discover per action before editing
- Expected canonical write path: UI -> Server Action -> Service Layer -> Supabase

Required approach:
1) Inspect the currently flagged catch paths first in:
   - `app/documentation-actions-impl.ts`
   - `app/sales-lead-actions.ts`
   - `app/sales-partner-actions.ts`
   - `app/time-actions.ts`
   - `app/(portal)/members/[memberId]/name-badge/actions.ts`
   - `app/(portal)/documentation/incidents/actions.ts`
2) For each catch path that returns `ok: true`, determine whether the failing operation is:
   - a required canonical write, or
   - an optional secondary effect
3) If the failing operation is required, return explicit failure and stop reporting success.
4) If the failing operation is secondary, keep the main canonical write boundary but replace silent success with a durable warning or follow-up path.
5) Preserve role restrictions, auditability, and canonical service boundaries.
6) Do not patch over failures in UI components and do not add in-memory fallback behavior.

Validation:
- Run `npm run typecheck` and `npm run build` if the environment permits.
- List each changed action and whether it now fails explicitly or records a durable warning.
- Call out any catch path that still needs a deeper architectural follow-up.

Do not overengineer. Focus on removing synthetic success while preserving the intended workflow boundary.
```

#### 4. Regression Risks
- Some screens may currently depend on permissive `ok: true` results and need minor response handling cleanup.
- Optional secondary effects might become more visible to staff after durable warnings are introduced.
- Hidden bugs can surface once false-success masking is removed.

#### 5. Retest Checklist
1. Force a required write failure in each changed action and confirm the UI receives explicit failure.
2. Force an optional secondary-effect failure and confirm the primary write stays truthful and the warning is visible/durable.
3. Verify the affected pages still refresh/revalidate correctly on real success.

#### 6. Optional Follow-up Prompt
```text
After removing synthetic success from the currently flagged actions, run a repo-wide audit for `catch` blocks in server actions and route handlers that still return success-like payloads after exceptions. Convert the remaining risky cases into explicit failure or durable-warning patterns.
```

### Prompt 8. Replace broad member-list reads with canonical paged and lookup queries

#### 1. Problem Summary
High-traffic pages still reuse a shared member-list helper that pulls more rows than needed and filters in app memory, which will scale poorly as member count grows.

#### 2. Root Cause Framing
- Likely architectural cause: one shared helper is being reused for both dropdown lookups and broader list screens even though they need different query shapes
- Affected workflow/domain: dashboard, MCC-adjacent lookups, shared member selectors
- Issue class: performance

#### 3. Best Codex Fix Prompt
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Shared member lookup paths still load too much member data and apply some search/filter work in app memory.

Scope:
- Domain/workflow: shared member list and member lookup reads
- Canonical entities/tables: members
- Expected canonical write path: read-only service hardening; preserve existing write paths

Required approach:
1) Inspect the current shared member read helpers first in:
   - `lib/services/member-command-center-supabase.ts`
   - `lib/services/shared-lookups-supabase.ts`
   - current callers such as `app/(portal)/dashboard/page.tsx`
2) Keep one canonical service boundary for member lookups, but split the read shapes clearly:
   - paginated searchable list path for full list screens
   - lightweight `id/display_name` lookup path for dropdowns/widgets
3) Replace remaining broad full-list call sites with the correct canonical helper.
4) Push search/filtering into SQL where safe instead of filtering large sets in app memory.
5) Add the smallest safe index/search support only if the query pattern requires it.
6) Preserve role restrictions and current business semantics. Do not move business logic into UI components.

Validation:
- Run `npm run typecheck` and `npm run build` if the environment permits.
- List changed files and downstream screens affected.
- Call out any remaining caller that still needs a larger pagination refactor.

Do not overengineer. This is a focused hot-path read cleanup, not a member module rewrite.
```

#### 4. Regression Risks
- Dropdowns may break if callers were relying on fields that are no longer selected.
- Search behavior can change slightly when it moves from in-memory matching to SQL-backed matching.
- Shared lookup consumers could drift if the new boundaries are not named clearly.

#### 5. Retest Checklist
1. Load the dashboard and confirm member lookups still render correctly.
2. Open each changed member picker and verify only the required member fields are returned.
3. Search for a member by name and confirm results still match expected active/inactive filters.

#### 6. Optional Follow-up Prompt
None.

### Prompt 9. Move MAR reconciliation off the hot read path

#### 1. Problem Summary
The MAR dashboard still does write-like reconciliation work before serving reads, which makes a heavily used clinical read screen more expensive and less predictable than it should be.

#### 2. Root Cause Framing
- Likely architectural cause: read model and schedule-generation maintenance work are still coupled in the same service path
- Affected workflow/domain: MAR dashboard and daily administration views
- Issue class: performance

#### 3. Best Codex Fix Prompt
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
`getMarWorkflowSnapshot()` still performs heavy reconciliation work on the hot read path and still pulls wider data than the UI needs.

Scope:
- Domain/workflow: MAR dashboard read model
- Canonical entities/tables: mar_schedules, mar_administrations, pof_medications and related MAR views
- Expected canonical write path: preserve existing MAR generation/write boundaries

Required approach:
1) Inspect `lib/services/mar-workflow.ts`, especially `getMarWorkflowSnapshot()` and the reconciliation path it triggers before reading.
2) Keep MAR schedule generation and sync logic in canonical service/RPC boundaries. Do not move write logic into UI code.
3) Remove or gate reconciliation from the hot read path so routine page loads do not always trigger write-like work.
4) Narrow broad selects to the fields the dashboard actually renders where safe.
5) Add the smallest safe supporting indexes needed by the existing today/history query patterns.
6) Preserve current clinical behavior and make any freshness/staleness rules explicit.

Validation:
- Run `npm run typecheck` and `npm run build` if the environment permits.
- List changed files, migration impact, and downstream MAR screens affected.
- Explain when reconciliation now runs and how the dashboard stays current.

Do not overengineer. This is a targeted read-path hardening pass.
```

#### 4. Regression Risks
- If reconciliation moves too far from reads, MAR views could become stale.
- Narrower selects can break UI code that was implicitly using extra fields.
- Added freshness gates need to be clear so staff still trust same-day MAR state.

#### 5. Retest Checklist
1. Load the MAR dashboard and verify it still shows current schedules and administrations.
2. Confirm routine dashboard refreshes no longer trigger unnecessary reconciliation work.
3. Sign a POF or otherwise create a real MAR-changing event and confirm the dashboard still reflects the change on the next intended refresh boundary.

#### 6. Optional Follow-up Prompt
None.

### Prompt 10. Push reporting and audit filtering closer to SQL

#### 1. Problem Summary
Reporting and audit pages still pull too many rows into app memory and then filter or aggregate them there, which will become costly as operational history grows.

#### 2. Root Cause Framing
- Likely architectural cause: new reporting abstractions still rely on app-side aggregation instead of canonical SQL-side read models
- Affected workflow/domain: admin reporting, audit trail, documentation/activity history
- Issue class: performance

#### 3. Best Codex Fix Prompt
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Admin reporting and audit reads still pull full date ranges into app memory and still do some filtering after the SQL limit.

Scope:
- Domain/workflow: admin reporting and audit read paths
- Canonical entities/tables: audit_logs, profiles, billing/reporting source tables, transportation logs, documentation/activity tables
- Expected canonical write path: read-only service hardening; preserve existing write paths

Required approach:
1) Inspect the current read paths first in:
   - `lib/services/admin-reporting-foundation.ts`
   - `lib/services/admin-audit-trail.ts`
   - any related shared reporting helpers
2) Keep one canonical service boundary for each report/read model. Do not scatter SQL into UI pages.
3) Push filtering and aggregation into SQL where practical instead of reading large ranges into app memory first.
4) Remove post-limit app-side filtering from admin audit reads.
5) Add pagination or bounded windows where the current read is effectively unbounded.
6) Add the smallest safe index support needed by the final query shape, using forward-only migrations if required.

Validation:
- Run `npm run typecheck` and `npm run build` if the environment permits.
- List changed files, any migrations added, and the reporting surfaces affected.
- Explain what work moved from app memory into SQL and any remaining known heavy reads.

Do not overengineer. Focus on the biggest current read amplifiers and preserve the existing report outputs.
```

#### 4. Regression Risks
- Report totals can drift if SQL-side aggregation does not exactly match current app-side rules.
- Audit pages may show different row counts if filtering behavior changes from post-limit to pre-limit.
- Large reporting queries may require careful index rollout to avoid temporary regressions.

#### 5. Retest Checklist
1. Load each changed admin report and confirm totals match the previous expected output on the same date range.
2. Filter the admin audit trail by area and confirm matching rows are not hidden by a SQL limit artifact.
3. Test a large date range and verify the report still loads with correct data and no missing categories.

#### 6. Optional Follow-up Prompt
```text
After the reporting/audit read hardening pass, run a focused Supabase query performance audit on the changed report queries and add any final missing composite indexes only where the final query shapes prove they are needed.
```

## 3. Fix Priority Order

1. Stop false failures after committed writes
2. Add compare-and-set protection to POF public open transitions
3. Make PRN MAR documentation replay-safe
4. Remove synthetic success from flagged action catch blocks
5. Enforce one canonical `member_files` row per `(member_id, document_source)`
6. Fix member-file delete durability ordering
7. Clean up failed enrollment packet upload rows canonically
8. Move MAR reconciliation off the hot read path
9. Replace broad member-list reads with canonical paged and lookup queries
10. Push reporting and audit filtering closer to SQL

Priority rationale:
- The first four items are workflow-truth and duplicate-risk issues that can misstate success or create unsafe medication/state behavior.
- The next three items harden durability and canonical artifact identity in regulated document workflows.
- The final three items are scaling and hot-path risks. They matter for production readiness, but they are less likely than the first group to create immediate false-success or duplicate clinical records.

## 4. Founder Summary

The biggest current problems are still not styling or UI issues. They are truthfulness and replay safety:
- some workflows can still commit correctly and then look failed because follow-up event logging throws afterward
- the public POF open path can still race against a void/change without compare-and-set protection
- PRN MAR documentation still needs a real duplicate guard
- some action handlers still report `ok: true` after exceptions

The cleanest next implementation order is:
- fix false-failure semantics after committed writes
- harden POF public state transitions
- add PRN MAR idempotency protection
- remove synthetic success catch blocks

Performance is still the main non-integrity theme from today’s reports. The highest-value read-path cleanup targets are:
- shared member list/lookup reads
- MAR snapshot read behavior
- admin reporting and audit filtering

Coverage note:
- Today’s repo has fresh March 19 reports for Production Readiness, ACID, Workflow Simulation, Referential Integrity/Cascade, and Query Performance.
- This report uses only the categories requested by the automation where actual artifacts were present, plus the latest available March 11 schema compatibility report for migration/schema alignment context.
- I did not find fresh standalone March 19 artifacts for RLS/security, canonicality sweep, shared resolver drift, shared RPC, or duplicate-submission audits, so I did not invent new findings for those categories.
