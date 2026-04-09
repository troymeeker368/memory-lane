# Fix Prompt Generator Report
Generated: 2026-04-09

## 1. Issues Detected

### Issue 1. `user_permissions` still lacks repo-defined RLS protection
- Audit sources:
  - `docs/audits/supabase-rls-security-audit-2026-04-02.md`
- Architectural rule being violated:
  - Preserve role restrictions and data integrity.
  - Supabase must be the canonical permission boundary, not only page-level guards.
- Why this is still a real issue:
  - The security audit still finds `public.user_permissions` used by the live user-management flow without repo-defined RLS enablement or policies.
- Safest fix approach:
  - Add one forward-only migration that enables RLS on `public.user_permissions` and limits reads/writes to explicit admin and `service_role` access.

### Issue 2. Intake still reports success before draft POF readiness is true
- Audit sources:
  - `docs/audits/workflow-simulation-audit-2026-04-09.md`
  - `docs/audits/acid-transaction-audit-2026-04-04.md`
- Architectural rule being violated:
  - Workflow state integrity.
  - One canonical write path per workflow, with explicit staged truth when downstream work is not ready.
- Why this is still a real issue:
  - Intake can finish with a durable signature while draft POF creation is failed or queued, and staff can still read that as completed intake.
- Safest fix approach:
  - Preserve the existing canonical intake write and draft POF RPC boundary, but tighten the shared result contract so intake is not shown as fully complete when draft POF creation is failed or follow-up-required.

### Issue 3. POF signature completion still overstates downstream clinical readiness
- Audit sources:
  - `docs/audits/workflow-simulation-audit-2026-04-09.md`
  - `docs/audits/acid-transaction-audit-2026-04-04.md`
- Architectural rule being violated:
  - Clear handoffs between workflows.
  - Explicit state transitions and predictable downstream effects.
- Why this is still a real issue:
  - Signed POF persistence is strong, but MHP, MCC, and MAR sync can still be queued or stale while the workflow returns success.
- Safest fix approach:
  - Keep the signed-order persistence path unchanged, but make staff-facing result and readiness states clearly separate "signed" from "operationally synced."

### Issue 4. Billing custom invoice orchestration is still not fully atomic end-to-end
- Audit sources:
  - `docs/audits/production-readiness-audit-2026-04-02.md`
  - `docs/audits/rpc-architecture-audit-2026-03-24.md`
- Architectural rule being violated:
  - Shared RPC standard for multi-step writes.
  - ACID requirements for invoice numbering and source-row consumption.
- Why this is still a real issue:
  - Production readiness still flags custom invoices as partially assembled in service code before RPC persistence, which leaves atomicity weaker than the repo contract expects.
- Safest fix approach:
  - Verify the current service/RPC split, then move any remaining invoice numbering and source-materialization decisions behind the single canonical RPC boundary instead of patching callers.

### Issue 5. Audit writers still have an output-path bug
- Audit sources:
  - `docs/audits/workflow-simulation-audit-2026-04-09.md`
  - `docs/audits/docs/audits/workflow-simulation-audit-2026-04-09.md`
  - `docs/audits/README.md`
- Architectural rule being violated:
  - Auditability.
  - Required audit output contract.
- Why this is still a real issue:
  - This run produced a nested output under `docs/audits/docs/audits/...`, which means at least one audit writer is bypassing the canonical output-path helper.
- Safest fix approach:
  - Find the writer that hardcodes or re-joins `docs/audits`, switch it to `buildAuditOutputPath` / `ensureAuditOutputPath`, and add a regression check so future audits cannot escape the canonical directory contract.

### Issue 6. MAR reconcile/read access is still split across multiple wrappers
- Audit sources:
  - `docs/audits/workflow-simulation-audit-2026-04-09.md`
  - `docs/audits/supabase-query-performance-audit-2026-04-07.md`
- Architectural rule being violated:
  - Shared resolver/service boundaries.
  - One canonical resolver path for derived workflow truth where possible.
- Why this is still a real issue:
  - Workflow simulation now calls out that both `lib/services/mar-workflow.ts` and `lib/services/mar-workflow-read.ts` wrap the same MAR reconcile boundary, which increases drift risk over time.
- Safest fix approach:
  - Keep the existing RPC authoritative, but collapse duplicate wrapper responsibility so MAR reconcile/read behavior has one shared service boundary.

### Issue 7. Linked-project migration parity is still an operational blocker
- Audit sources:
  - `docs/audits/schema-migration-safety-audit-2026-04-02.md`
- Architectural rule being violated:
  - Migration-driven schema.
  - Schema/runtime alignment must hold in the actual linked Supabase project, not just in git.
- Why this is still a real issue:
  - Local runtime objects map cleanly to migrations, but the audit still could not verify that the linked Supabase project recognizes the current ordered migration set.
- Safest fix approach:
  - Repair linked-project migration history first, then rerun schema verification before treating the repo as fully production-ready.

### What Did Not Produce A New Prompt
- Daily Canonicality Sweep:
  - `docs/audits/daily-canonicality-sweep-raw-2026-03-27.json` still shows no missing runtime tables, RPCs, storage buckets, runtime mock usage, or banned fallback patterns.
- Shared Resolver Drift Check:
  - `docs/audits/shared-resolver-drift-check-2026-03-29.md` reports the focused resolver issues it audited as already fixed.
- Idempotency & Duplicate Submission Audit:
  - `docs/audits/idempotency-duplicate-submission-audit-2026-03-29.md` did not expose a fresh low-risk code bug after its prior fixes.
- April 7-8 performance prompts:
  - MAR first-load containment, runner-health visibility, enrollment packet replay short-circuiting, and shared member-list consolidation all appear to be actively in the current local worktree already, so they are not repeated here as fresh prompt work.

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
1) Inspect the current migration history plus the live read/write path in `lib/services/user-management.ts`.
2) Add one forward-only migration that:
   - enables RLS on `public.user_permissions`
   - allows only the intended admin path for normal runtime reads/writes
   - preserves `service_role` maintenance access where needed
3) Keep policy conditions explicit and auditable.
4) Do not broaden authenticated access and do not rely on app-layer page guards as the only boundary.
5) Adjust the service layer only if a small policy-driven change is required.

Validation:
- Run typecheck.
- Show the migration added.
- Explain which runtime callers can still read/write `user_permissions`.
- Call out any live-project policy/grant verification that still must happen outside the repo.
```

### Prompt 2. Tighten intake completion truth around draft POF readiness
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Intake can return a success state even when draft POF creation failed or was pushed to follow-up, which lets staff read intake as complete before the next clinical handoff is actually ready.

Scope:
- Domain/workflow: intake post-sign -> draft physician order creation
- Canonical entities/tables: `intake_assessments`, `intake_post_sign_follow_up_queue`, `physician_orders`
- Expected canonical write path: UI -> server action -> service/RPC -> Supabase

Required approach:
1) Inspect `app/intake-actions.ts`, `lib/services/intake-pof-mhp-cascade.ts`, and `lib/services/physician-orders-supabase.ts`.
2) Confirm that `createDraftPhysicianOrderFromAssessment` and `rpc_create_draft_physician_order_from_intake` remain the authoritative draft POF boundary.
3) Preserve the staged workflow model if the intake commit must stay durable even when downstream work lags.
4) Tighten the shared result contract so intake is not surfaced as fully complete when draft POF status is `failed` or `action_required`.
5) Reuse shared readiness helpers if they already exist. Do not add a second local status vocabulary in the UI.

Validation:
- Run typecheck.
- Add regression coverage for: intake signed + draft POF failed; intake signed + draft POF follow-up queued.
- Report downstream impact on physician orders, MHP, MCC, and workflow-simulation evidence.
```

### Prompt 3. Separate POF signed state from operational sync readiness
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
A POF can be durably signed while MHP, MCC, and MAR downstream sync is still queued or stale, but the current staff-facing success path can still read as if the order is fully live.

Scope:
- Domain/workflow: POF signature completion -> MHP/MCC/MAR downstream sync
- Canonical entities/tables: `physician_orders`, `pof_requests`, `pof_post_sign_sync_queue`, downstream member clinical tables
- Expected canonical path: public sign action -> canonical finalize/sign service -> queued follow-up/sync service -> Supabase

Required approach:
1) Inspect `app/sign/pof/[token]/actions.ts`, `lib/services/pof-post-sign-runtime.ts`, and `lib/services/physician-order-post-sign-service.ts`.
2) Keep signed artifact persistence and signed-order status unchanged as the canonical committed boundary.
3) Introduce or reuse one shared readiness/result shape that clearly distinguishes:
   - signed/committed
   - operationally synced
   - follow-up required
4) Update only the necessary service/action/UI contract surfaces so staff can no longer confuse signature success with downstream clinical readiness.
5) Do not move clinical sync into the UI and do not replace the existing queue-backed follow-up model.

Validation:
- Run typecheck.
- Add regression coverage for: POF signed + sync queued; POF signed + sync failed into action-required state.
- Explain which screen/action payloads changed and what downstream workflows consume the new readiness truth.
```

### Prompt 4. Finish custom invoice atomicity at the RPC boundary
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Billing custom invoice creation is improved, but the production-readiness audit still says some orchestration and invoice-numbering/source decisions are happening in service code before the canonical RPC persistence boundary.

Scope:
- Domain/workflow: billing custom invoice creation
- Canonical entities/tables: `billing_invoices`, `billing_invoice_lines`, related source logs/adjustments, `rpc_create_custom_invoice`
- Expected canonical write path: billing action -> billing service -> `rpc_create_custom_invoice` -> Supabase

Required approach:
1) Inspect `lib/services/billing-custom-invoices.ts`, `lib/services/billing-rpc.ts`, and the latest `rpc_create_custom_invoice` migrations, especially `0178` and `0185`.
2) Identify any remaining pre-RPC orchestration that can still cause invoice-numbering or source-row-consumption drift.
3) Move the smallest remaining multi-step decision set behind the single RPC boundary instead of duplicating logic in TypeScript.
4) Preserve current billing behavior and payload shape unless a contract change is required to make the boundary truly atomic.
5) Avoid a broad billing refactor. Keep this scoped to the custom-invoice workflow.

Validation:
- Run typecheck.
- List the exact service-side logic that stayed outside the RPC and why.
- Add or update regression coverage proving duplicate source-row consumption and invoice-number drift are blocked.
```

### Prompt 5. Fix the audit output path bug
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
At least one audit writer generated output under `docs/audits/docs/audits/...` instead of the canonical `docs/audits` directory.

Scope:
- Domain/workflow: audit report generation
- Canonical files/helpers: `lib/config/audit-paths.ts`, `docs/audits/README.md`, the workflow simulation audit writer
- Expected canonical path: audit writer -> `ensureAuditOutputPath` / `buildAuditOutputPath` -> `docs/audits`

Required approach:
1) Identify the specific audit writer that produced `docs/audits/docs/audits/workflow-simulation-audit-2026-04-09.md`.
2) Replace any hardcoded or double-joined audit directory logic with the canonical helper from `lib/config/audit-paths.ts`.
3) Preserve current audit content and filenames; only fix path resolution and directory safety.
4) Add a regression check or helper-level assertion so future audit writers cannot accidentally nest `docs/audits` inside itself.
5) Do not scatter one-off path fixes across multiple scripts if a shared helper contract can prevent the bug centrally.

Validation:
- Run the affected audit writer if practical, or add deterministic test coverage for path generation.
- Show the corrected output path behavior.
- Confirm no audit writer still emits to `docs/audits/docs/audits`.
```

### Prompt 6. Collapse MAR reconcile access behind one shared boundary
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Both `lib/services/mar-workflow.ts` and `lib/services/mar-workflow-read.ts` wrap the same MAR reconcile boundary, which increases drift risk for medication workflow truth over time.

Scope:
- Domain/workflow: MAR reconcile/read path
- Canonical entities/tables/views: current MAR reconcile RPC plus the read services that consume it
- Expected canonical path: shared MAR service boundary -> Supabase RPC/view reads

Required approach:
1) Inspect `lib/services/mar-workflow.ts` and `lib/services/mar-workflow-read.ts` and identify the overlapping reconcile wrapper logic.
2) Keep the existing Supabase RPC authoritative.
3) Move duplicate wrapper behavior into one shared service/helper so read and write flows use the same canonical MAR reconcile access pattern.
4) Preserve current medication-safety behavior and UI payloads unless a tiny call-site adjustment is required.
5) Do not mix this with the separate performance work already happening in the MAR page/dashboard files.

Validation:
- Run typecheck.
- Explain the before/after boundary.
- Add or update regression coverage if there is existing MAR boundary test coverage to extend.
```

### Prompt 7. Repair linked-project migration parity
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Local runtime objects map cleanly to migrations, but the schema safety audit still could not verify that the linked Supabase project recognizes the current committed migration history.

Scope:
- Domain/workflow: Supabase migration history and linked-project parity
- Canonical files/commands: `supabase/migrations`, project link state, `npm run db:check` / related migration verification commands
- Expected canonical path: committed migrations -> linked project -> schema/runtime parity

Required approach:
1) Inspect the current ordered migration set and any repo guidance for the linked project history.
2) Repair remote migration history/parity without renaming committed migrations again unless absolutely required.
3) Re-run the safest available migration verification commands after repair.
4) Preserve the current ordered local sequence and avoid introducing a new migration-number drift.
5) If the blocker is environment/auth/project-link related, report that explicitly instead of pretending repo code is fixed.

Validation:
- Show which verification command(s) ran and the result.
- Confirm whether the linked project now recognizes the current committed migration set.
- Call out any remaining environment or auth blocker explicitly.
```

## 3. Fix Priority Order
1. Add RLS to `user_permissions`.
2. Tighten intake completion truth around draft POF readiness.
3. Separate POF signed state from operational sync readiness.
4. Finish custom invoice atomicity at the RPC boundary.
5. Fix the audit output path bug.
6. Collapse MAR reconcile access behind one shared boundary.
7. Repair linked-project migration parity.

## 4. Founder Summary
- Today’s audit set is narrower than earlier runs. The repo no longer looks broadly non-canonical or mock-backed. The main remaining problems are staged workflow truth, one confirmed database security gap, one remaining billing atomicity gap, and one audit tooling bug.
- The highest-value workflow fix is intake/POF readiness truth. The newest workflow simulation on 2026-04-09 makes clear that the risk is not fake persistence anymore; it is staff seeing success before downstream readiness is actually true.
- The security blocker remains `user_permissions` RLS. That is still the cleanest must-fix before claiming production-safe permissions.
- Several April 7-8 prompts should not be regenerated as new work because they already appear to be in the current local worktree:
  - enrollment replay short-circuiting
  - founder-visible runner health
  - MAR first-load containment
  - shared member-list read consolidation
- The schema safety audit did not find new repo drift, but linked-project migration parity still needs real verification before treating the environment as fully aligned.
