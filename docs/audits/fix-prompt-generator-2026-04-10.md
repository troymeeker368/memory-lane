# Fix Prompt Generator Report
Generated: 2026-04-10

## 1. Issues Detected

### Issue 1. `user_permissions` still lacks repo-defined RLS protection
- Audit sources:
  - `docs/audits/supabase-rls-security-audit-2026-04-02.md`
- Architectural rule being violated:
  - Preserve role restrictions and data integrity.
  - Supabase must be the canonical permission boundary, not only app-layer page guards.
- Why this is still a real issue:
  - The latest RLS audit still finds live runtime use of `public.user_permissions` without repo-defined RLS enablement or policies.
- Safest fix approach:
  - Add one forward-only migration that enables RLS on `public.user_permissions` and restricts access to explicit admin and `service_role` paths only.

### Issue 2. Intake can still look complete before draft POF readiness is true
- Audit sources:
  - `docs/audits/workflow-simulation-audit-2026-04-10.md`
  - `docs/audits/acid-transaction-audit-2026-04-04.md`
- Architectural rule being violated:
  - Workflow state integrity.
  - Explicit staged truth when downstream follow-up is still open.
- Why this is still a real issue:
  - Intake signing is durable, but draft POF creation can still fail or require follow-up while nurse-facing workflow state reads as if the handoff is done.
- Safest fix approach:
  - Preserve the canonical intake write and draft-POF RPC boundary, but standardize a shared readiness contract so signed intake is not treated as operationally ready when draft POF follow-up is open.

### Issue 3. Signed POF still overstates downstream clinical readiness
- Audit sources:
  - `docs/audits/workflow-simulation-audit-2026-04-10.md`
  - `docs/audits/acid-transaction-audit-2026-04-04.md`
- Architectural rule being violated:
  - Clear handoffs between workflows.
  - Predictable downstream effects after critical clinical milestones.
- Why this is still a real issue:
  - POF signature commit is strong, but MHP, MCC, and MAR sync can still be queued or action-required while staff surfaces can still read "signed" as "fully live."
- Safest fix approach:
  - Keep the queued retry model, but reuse one shared operational-readiness vocabulary across POF detail, MHP, MCC, and nursing surfaces so signed never implies synced.

### Issue 4. Enrollment packet filing still overstates downstream operational readiness
- Audit sources:
  - `docs/audits/workflow-simulation-audit-2026-04-10.md`
  - `docs/audits/acid-transaction-audit-2026-04-04.md`
- Architectural rule being violated:
  - Workflow state integrity.
  - Clear handoffs between enrollment completion and downstream operational setup.
- Why this is still a real issue:
  - Packet filing is replay-safe and durable, but mapping sync, lead activity visibility, and operational shell readiness can still need staff follow-up after commit.
- Safest fix approach:
  - Preserve the durable filing boundary, but push the same committed-versus-ready truth into sales dashboards, confirmation surfaces, and follow-up queues so filed does not read as fully operational.

### Issue 5. Billing custom-invoice orchestration still needs one fully atomic write boundary
- Audit sources:
  - `docs/audits/production-readiness-audit-2026-04-02.md`
- Architectural rule being violated:
  - Shared RPC standard for multi-step writes.
  - ACID requirements for invoice numbering and source-row consumption.
- Why this is still a real issue:
  - The latest production-readiness audit still says custom-invoice orchestration is partly assembled in service code before RPC persistence, which weakens the single canonical write-boundary contract.
- Safest fix approach:
  - Verify the current service/RPC split, then move any remaining numbering and source-materialization decisions into the single authoritative custom-invoice RPC instead of patching callers.

### Issue 6. MAR first load still fetches unbounded `today` and `overdue` center-wide queues
- Audit sources:
  - `docs/audits/supabase-query-performance-audit-2026-04-10.md`
- Architectural rule being violated:
  - Production readiness.
  - Canonical read paths must scale without hiding risk behind the UI.
- Why this is still a real issue:
  - The previous not-given cap helped, but the biggest live MAR reads still load full `v_mar_today` and `v_mar_overdue_today` datasets on page load.
- Safest fix approach:
  - Keep Supabase and the existing MAR views authoritative, but introduce the smallest segmented read boundary so the first page render does not fetch the full center-wide live queues.

### Issue 7. Billing invoice readers still use unpaged `select("*")` list reads
- Audit sources:
  - `docs/audits/supabase-query-performance-audit-2026-04-10.md`
- Architectural rule being violated:
  - Canonical shared read boundaries should stay maintainable and production-safe.
  - Query behavior should match migration-backed performance contracts.
- Why this is still a real issue:
  - Draft, finalized, and custom invoice readers still pull full rows and often full result sets, which raises payload cost, scan cost, and drift risk across billing services.
- Safest fix approach:
  - Consolidate invoice list reads behind one canonical paged list/read helper with narrow field selection, then add only the matching indexes required by the real sort/filter shapes.

### Issue 8. Reports home still scans full historical staff-event tables on every load
- Audit sources:
  - `docs/audits/supabase-query-performance-audit-2026-04-10.md`
- Architectural rule being violated:
  - Shared RPC/read-model boundaries should avoid repeat full-table work for dashboard paths.
- Why this is still a real issue:
  - `rpc_get_reports_home_staff_aggregates` improved organization, but it still scans all historical `documentation_events` and `time_punches` without a bounded window.
- Safest fix approach:
  - Keep the founder-readable reports home contract, but move the heavy work to a bounded recent window or a cached snapshot path inside the canonical RPC/read-model boundary.

### Issue 9. Linked-project migration parity is still a production-readiness blocker
- Audit sources:
  - `docs/audits/schema-migration-safety-audit-2026-04-02.md`
- Architectural rule being violated:
  - Migration-driven schema.
  - Schema/runtime alignment must hold in the linked Supabase project, not only in git.
- Why this is still a real issue:
  - The repo looks aligned locally, but the latest schema safety audit still could not verify that the linked Supabase project recognizes the committed migration sequence.
- Safest fix approach:
  - Repair linked-project migration history first, then rerun schema verification instead of assuming repo-local alignment equals deployed alignment.

### What Did Not Produce A New Prompt
- Daily Canonicality Sweep:
  - The latest available canonicality sweep still shows no missing runtime tables, RPCs, storage buckets, mock persistence, or banned fallback patterns.
- Shared Resolver Drift Check:
  - The latest resolver-drift report says its scoped drift issues were already fixed and does not surface a fresh open low-risk bug.
- Idempotency & Duplicate Submission Audit:
  - The latest idempotency report does not identify a new narrow code fix beyond the larger staged-workflow readiness issues already captured above.
- Query-performance sub-items not promoted to their own prompt:
  - `lead_activities(activity_at desc)` and `member_files(member_id, file_name)` index gaps are real, but they are lower-value follow-ons than the larger MAR, billing list, and reports-home read-boundary issues above.

## 2. Codex Fix Prompts

### Prompt 1. Add RLS to `user_permissions`
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
`public.user_permissions` is a live permission-boundary table, but the repo still does not define RLS or explicit policies for it.

Scope:
- Domain/workflow: user management and staff permission overrides
- Canonical entities/tables: `public.user_permissions`
- Expected canonical write path: admin UI -> server action/service -> Supabase

Required approach:
1) Inspect the current migration history and the live read/write path in `lib/services/user-management.ts`.
2) Add one forward-only migration that:
   - enables RLS on `public.user_permissions`
   - allows only the intended admin runtime path for normal reads/writes
   - preserves `service_role` maintenance access where needed
3) Keep policy conditions explicit and auditable.
4) Do not broaden authenticated access and do not rely on page guards as the only boundary.
5) Adjust service code only if a small policy-driven change is required.

Validation:
- Run typecheck.
- Show the migration added.
- Explain which runtime callers can still read/write `user_permissions`.
- Call out any live-project policy/grant verification that still must happen outside the repo.
```

### Prompt 2. Tighten intake readiness truth around draft POF follow-up
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Intake can return a signed/complete outcome even when draft POF creation failed or still needs follow-up, which lets staff read the intake workflow as ready before the next clinical handoff is actually ready.

Scope:
- Domain/workflow: intake post-sign -> draft physician order creation
- Canonical entities/tables: `intake_assessments`, `intake_post_sign_follow_up_queue`, `physician_orders`
- Expected canonical write path: UI -> server action -> service/RPC -> Supabase

Required approach:
1) Inspect `app/intake-actions.ts`, `lib/services/intake-pof-mhp-cascade.ts`, `lib/services/physician-orders-supabase.ts`, and any shared committed/readiness helpers already used elsewhere.
2) Confirm `createDraftPhysicianOrderFromAssessment` and `rpc_create_draft_physician_order_from_intake` remain the authoritative draft-POF boundary.
3) Preserve the staged workflow model if the intake commit must remain durable even when downstream work lags.
4) Reuse one shared readiness/result vocabulary so intake is not surfaced as fully ready when draft POF status is `failed`, `queued`, or `action_required`.
5) Update nurse-facing intake and physician-order surfaces only as needed to reflect canonical staged truth.
6) Do not add a second local status vocabulary in UI code.

Validation:
- Run typecheck.
- Add regression coverage for: intake signed + draft POF queued, and intake signed + draft POF action-required.
- Report downstream impact on physician orders, MHP, MCC, and workflow follow-up views.
```

### Prompt 3. Separate POF signed state from operational sync readiness
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
A POF can be durably signed while MHP, MCC, and MAR downstream sync is still queued or stale, but the current staff-facing path can still read as if the order is fully operational.

Scope:
- Domain/workflow: POF signature completion -> MHP/MCC/MAR downstream sync
- Canonical entities/tables: `physician_orders`, `pof_requests`, `pof_post_sign_sync_queue`, downstream member clinical tables
- Expected canonical path: public sign action -> canonical finalize/sign service -> queued follow-up/sync service -> Supabase

Required approach:
1) Inspect `app/sign/pof/[token]/actions.ts`, `lib/services/pof-esign-public.ts`, `lib/services/pof-post-sign-runtime.ts`, and `lib/services/physician-order-post-sign-service.ts`.
2) Keep signed artifact persistence and signed-order status unchanged as the canonical committed boundary.
3) Reuse or introduce one shared readiness/result shape that clearly distinguishes:
   - signed/committed
   - operationally synced
   - follow-up required
4) Update only the necessary service/action/UI contract surfaces so staff can no longer confuse signature success with downstream readiness.
5) Do not move downstream clinical sync into the UI and do not replace the existing queue-backed retry model.

Validation:
- Run typecheck.
- Add regression coverage for: POF signed + sync queued, and POF signed + sync action-required.
- Explain which screens or payloads changed and what downstream workflows now consume the new readiness truth.
```

### Prompt 4. Make enrollment packet committed-versus-ready truth impossible to miss
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Enrollment packet filing is durable and replay-safe, but staff can still read a filed packet as fully operational even when mapping sync, lead activity visibility, or operational shell readiness still needs follow-up.

Scope:
- Domain/workflow: enrollment packet completion -> downstream mapping/follow-up readiness
- Canonical entities/tables: `enrollment_packet_requests`, `enrollment_packet_events`, follow-up queue tables, downstream lead/member mapping records
- Expected canonical write path: public packet submit -> canonical finalize flow -> follow-up queue/services -> Supabase

Required approach:
1) Inspect `lib/services/enrollment-packets-public-runtime.ts`, `lib/services/enrollment-packets-public-runtime-cascade.ts`, `lib/services/enrollment-packet-completion-cascade.ts`, and the main staff-facing enrollment packet read surfaces.
2) Preserve the current durable filing/finalize boundary.
3) Reuse the shared committed-versus-ready readiness vocabulary instead of inventing enrollment-only wording.
4) Push that readiness truth into the sales/dashboard/follow-up surfaces that staff actually use after packet completion.
5) Keep follow-up queues and auditability explicit. Do not hide action-required state behind generic success messaging.

Validation:
- Run typecheck.
- Add regression coverage for: packet filed + follow-up required.
- Explain which staff-facing surfaces now show committed versus operationally ready truth.
```

### Prompt 5. Finish custom-invoice atomicity at the RPC boundary
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Billing custom-invoice creation is improved, but the production-readiness audit still says some orchestration and invoice-numbering/source decisions are happening in service code before the canonical RPC persistence boundary.

Scope:
- Domain/workflow: billing custom invoice creation
- Canonical entities/tables: `billing_invoices`, `billing_invoice_lines`, related source logs/adjustments, `rpc_create_custom_invoice`
- Expected canonical write path: billing action -> billing service -> `rpc_create_custom_invoice` -> Supabase

Required approach:
1) Inspect `lib/services/billing-custom-invoices.ts`, `lib/services/billing-rpc.ts`, and the latest custom-invoice RPC migrations.
2) Identify any remaining pre-RPC orchestration that can still cause invoice-numbering or source-row-consumption drift.
3) Move the smallest remaining multi-step decision set behind the single RPC boundary instead of duplicating it in TypeScript.
4) Preserve current billing behavior and payload shape unless a contract change is required to make the boundary truly atomic.
5) Avoid a broad billing refactor. Keep this scoped to the custom-invoice workflow.

Validation:
- Run typecheck.
- List the exact service-side logic that stayed outside the RPC and why.
- Add or update regression coverage proving duplicate source-row consumption and invoice-number drift are blocked.
```

### Prompt 6. Contain MAR first-load reads for `today` and `overdue`
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
The MAR page still loads full center-wide `today` and `overdue` datasets on first render, which leaves the main nursing page as the clearest remaining clinical scaling risk.

Scope:
- Domain/workflow: MAR first-load read path
- Canonical entities/tables/views: `v_mar_today`, `v_mar_overdue_today`, existing MAR read services
- Expected canonical read path: page -> shared MAR read service -> Supabase view/query boundary

Required approach:
1) Inspect `app/(portal)/health/mar/page.tsx` and `lib/services/mar-workflow-read.ts`.
2) Keep Supabase views authoritative and preserve current nursing workflow correctness.
3) Introduce the smallest segmented or paged read boundary so first load does not fetch the full center-wide live queues.
4) Keep today/overdue behavior deterministic and auditable; do not add client-only filtering as the main fix.
5) Avoid mixing this with unrelated MAR reconcile or PRN changes.

Validation:
- Run typecheck.
- Add regression coverage for the new first-load containment contract.
- Explain which MAR slices changed and what the user will now load initially versus on demand.
```

### Prompt 7. Replace unpaged billing invoice list reads with one canonical paged boundary
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Billing invoice list readers still use unpaged `select("*")` reads and overlapping query shapes across multiple services, which raises scan cost, payload size, and boundary drift.

Scope:
- Domain/workflow: billing invoice list/read paths
- Canonical entities/tables: `billing_invoices`, list/export readers, supporting invoice indexes
- Expected canonical read path: billing screens -> shared billing read helper/RPC -> Supabase

Required approach:
1) Inspect `lib/services/billing-read-supabase.ts`, `lib/services/billing-exports.ts`, and `lib/services/billing-invoice-document.ts`.
2) Identify the canonical list/read boundary that should own invoice list shape, field selection, pagination, and sort rules.
3) Replace unpaged `select("*")` list reads with narrow field selection and explicit pagination for draft/finalized/custom invoice screens.
4) Add only the minimal index migration(s) needed to match the real status/source + sort patterns after the canonical list shape is settled.
5) Preserve export/detail correctness. Do not break downstream invoice documents by over-pruning fields they still need.

Validation:
- Run typecheck.
- Show the canonical list helper or boundary after consolidation.
- Add or update regression coverage for invoice list ordering, pagination, and custom-invoice filtering.
- Show the migration added if indexes are required.
```

### Prompt 8. Stop reports home from scanning all historical staff-event rows on every load
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
The reports home staff aggregate RPC still scans full historical `documentation_events` and `time_punches` on every page load.

Scope:
- Domain/workflow: reports home staff productivity/time aggregates
- Canonical entities/tables/RPCs: `documentation_events`, `time_punches`, `rpc_get_reports_home_staff_aggregates`
- Expected canonical read path: reports home service -> RPC/read-model -> Supabase

Required approach:
1) Inspect `lib/services/reports-ops.ts` and the migration that defines `rpc_get_reports_home_staff_aggregates`.
2) Preserve the existing founder-readable output contract.
3) Move the heavy work to either:
   - a bounded recent window, or
   - a cached snapshot path
   whichever is the smaller production-safe change for this repo.
4) Keep the read boundary canonical inside SQL/RPC or one shared service path. Do not push aggregation into page code.
5) Call out any tradeoff where the UI needs to label the date window or snapshot freshness explicitly.

Validation:
- Run typecheck.
- Show the adjusted RPC/read boundary and the date-window or snapshot contract.
- Explain downstream impact on reports home and any admin reporting consumers.
```

### Prompt 9. Repair linked-project migration parity before treating schema alignment as done
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Local runtime objects map cleanly to migrations, but the schema safety audit still could not verify that the linked Supabase project recognizes the current committed migration history.

Scope:
- Domain/workflow: Supabase migration history and linked-project parity
- Canonical files/commands: `supabase/migrations`, project link state, `npm run db:check` or equivalent verification commands
- Expected canonical path: committed migrations -> linked project -> schema/runtime parity

Required approach:
1) Inspect the current ordered migration set and repo guidance for the linked project state.
2) Repair remote migration history/parity without renaming committed migrations again unless absolutely required.
3) Re-run the safest available migration verification commands after repair.
4) Preserve the current ordered local sequence and avoid introducing new migration-number drift.
5) If the blocker is environment, auth, or project-link related, report that explicitly instead of pretending repo code is fixed.

Validation:
- Show which verification command(s) ran and the result.
- Confirm whether the linked project now recognizes the current committed migration set.
- Call out any remaining environment or auth blocker explicitly.
```

## 3. Fix Priority Order
1. Add RLS to `user_permissions`.
2. Tighten intake readiness truth around draft POF follow-up.
3. Separate POF signed state from operational sync readiness.
4. Make enrollment packet committed-versus-ready truth impossible to miss.
5. Finish custom-invoice atomicity at the RPC boundary.
6. Contain MAR first-load reads for `today` and `overdue`.
7. Replace unpaged billing invoice list reads with one canonical paged boundary.
8. Stop reports home from scanning all historical staff-event rows on every load.
9. Repair linked-project migration parity.

## 4. Founder Summary
- The newest audit set still points to one real security blocker: `user_permissions` needs database-enforced RLS, not only admin page guards.
- The biggest workflow problems are no longer fake writes or mock fallbacks. They are staged-truth problems: intake, POF signing, and enrollment packet filing can all commit safely while downstream readiness still lags, and staff-facing surfaces need to make that impossible to misread.
- The newest performance audit shifts the next scaling work toward three concrete read paths:
  - MAR first load
  - billing invoice lists
  - reports home staff aggregates
- The production-readiness/billing issue is still separate from the performance work. Custom invoice creation still needs one fully atomic RPC-backed write boundary.
- Daily canonicality, resolver drift, and idempotency did not add a fresh narrow fix this run. Those reports mainly confirm earlier hardening is holding.
