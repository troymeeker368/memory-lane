# Fix Prompt Generator Report
Generated: 2026-04-08

## 0. Execution Status Refresh

After direct repo inspection on 2026-04-08, these prompts group into three buckets:

### Already Implemented In Repo
- `user_permissions` RLS/admin-boundary hardening already exists in:
  - `supabase/migrations/0183_user_permissions_rls_hardening.sql`
  - `supabase/migrations/0186_user_permissions_grants_hardening.sql`
  - `supabase/migrations/0198_user_permissions_admin_boundary_hardening.sql`
- Intake -> draft POF already routes through the canonical shared service and RPC boundary:
  - `app/intake-actions.ts`
  - `lib/services/intake-pof-mhp-cascade.ts`
  - `lib/services/physician-orders-supabase.ts`
- Shared staged-workflow readiness vocabulary is already live in:
  - `lib/services/committed-workflow-state.ts`
  - `lib/services/intake-post-sign-readiness.ts`
  - `lib/services/enrollment-packet-readiness.ts`
  - `lib/services/physician-order-clinical-sync.ts`
  - `lib/services/care-plan-post-sign-readiness.ts`
- Artifact/notification truth is already materially hardened in:
  - `lib/services/intake-pof-mhp-cascade.ts`
  - `lib/services/enrollment-packet-completion-cascade.ts`
  - `lib/services/lifecycle-milestones.ts`

### Implemented But Needed Explicit Validation Coverage
- `0207` query/index hardening migration:
  - `supabase/migrations/0207_system_events_open_alert_and_mhp_trgm_indexes.sql`
- Shared member-list read boundary:
  - `lib/services/member-list-read.ts`
  - `lib/services/member-command-center-runtime.ts`
  - `lib/services/member-health-profiles-supabase.ts`
- MAR dashboard read consolidation:
  - `lib/services/mar-dashboard-read-model.ts`
  - `lib/services/health-dashboard.ts`

### Still Truly Open
- Main MAR workflow first-load containment in `lib/services/mar-workflow-read.ts`
- Founder-visible runner health / stale-queue surfacing for enrollment and POF follow-up
- Public enrollment packet pre-finalize work reduction
- Member-file delete repair safety can still be improved further, even though it now records durable repair alerts

## 1. Issues Detected

### Issue 1. `user_permissions` still lacks repo-defined RLS protection
- Audit source:
  - `docs/audits/supabase-rls-security-audit-2026-04-02.md`
- Architectural rule violated:
  - Preserve role restrictions and data integrity.
  - Supabase must enforce canonical permission boundaries, not just app-layer guards.
- Why this is still open:
  - `public.user_permissions` is used by the live user-management flow, but the repo audit still could not find RLS enablement or policies for it.
- Safest fix approach:
  - Add one forward-only migration enabling RLS and allow only explicit admin/service-role access.

### Issue 2. Intake -> draft POF still has an unresolved canonicality/readiness conflict
- Audit sources:
  - `docs/audits/workflow-simulation-audit-2026-04-08.md`
  - `docs/audits/acid-transaction-audit-2026-04-04.md`
- Architectural rule violated:
  - One canonical write path per workflow.
  - Shared service/resolver truth must be consistent across audits and downstream consumers.
- Why this is still open:
  - Workflow simulation still marks Intake -> POF as broken and says canonical `physician_orders` persistence is not evidenced.
  - ACID audit says the workflow is intentionally staged, which means the real issue may be readiness truth rather than missing persistence.
- Safest fix approach:
  - Verify the canonical intake -> POF write path first, then fix either the real persistence gap or the shared readiness/result contract that is causing audit and downstream drift.

### Issue 3. Required artifact persistence and milestone-notification truth is still too weak
- Audit sources:
  - `docs/audits/workflow-simulation-audit-2026-04-08.md`
  - `docs/audits/acid-transaction-audit-2026-04-04.md`
- Architectural rule violated:
  - Do not claim completion until required artifacts are durably saved.
  - Significant lifecycle events must be logged and surfaced from canonical service boundaries.
- Why this is still open:
  - The latest workflow simulation still calls out weak completion evidence for:
    - completed enrollment packet artifacts in `member_files`
    - intake PDF persistence in `member_files`
    - enrollment milestone notifications
- Safest fix approach:
  - Keep current canonical writes, but tighten the "fully complete" contract so artifact/notification failure yields explicit follow-up-required truth instead of plain success.

### Issue 4. Shared staged-workflow readiness vocabulary is still fragmented
- Audit sources:
  - `docs/audits/acid-transaction-audit-2026-04-04.md`
  - `docs/audits/workflow-simulation-audit-2026-04-08.md`
  - Daily canonicality support: `docs/audits/daily-canonicality-sweep-raw-2026-03-27.json`
- Architectural rule violated:
  - Shared resolver/service boundaries.
  - Clear handoffs between workflows.
- Why this is still open:
  - The repo no longer shows broad Supabase drift or mock-runtime splits, but the main canonicality risk remains "committed but not operationally ready" truth drifting across enrollment, intake, POF, and care plan flows.
- Safest fix approach:
  - Reuse existing Supabase-backed readiness fields and queues.
  - Introduce one shared founder-readable readiness vocabulary/helper instead of parallel local status logic.

### Issue 5. Public enrollment packet submit still does too much work before finalization
- Audit source:
  - `docs/audits/acid-transaction-audit-2026-04-04.md`
- Architectural rule violated:
  - Idempotency and replay safety for public-link workflows.
  - Keep irreversible work behind canonical transaction boundaries where possible.
- Why this is still open:
  - The public flow still stages uploads and artifacts before `rpc_finalize_enrollment_packet_submission`, so close retries can do duplicate work before one request wins finalization.
- Safest fix approach:
  - Reduce pre-finalize work and keep replay losers deterministic, without changing the final canonical RPC.

### Issue 6. Member-file delete is still not repair-safe after storage-first cleanup
- Audit source:
  - `docs/audits/acid-transaction-audit-2026-04-04.md`
- Architectural rule violated:
  - Durability.
  - No false success and no silent drift between storage and canonical database rows.
- Why this is still open:
  - The service correctly avoids false success, but storage can be deleted before the DB row delete finishes, leaving a dangling canonical record pointing to a missing object.
- Safest fix approach:
  - Add a small repair-safe delete contract, such as a tombstone/reconcile path or an auditable cleanup queue, without reworking member-file persistence.

### Issue 7. Retry-runner health is still a real production dependency without enough visible guardrails
- Audit sources:
  - `docs/audits/acid-transaction-audit-2026-04-04.md`
  - `docs/audits/production-readiness-audit-2026-04-02.md`
- Architectural rule violated:
  - Completion criteria require downstream persistence and operational readiness signals, not just first-stage commits.
- Why this is still open:
  - POF and enrollment follow-up truth is now more honest in code, but real durability still depends on queue runners, secrets, and cron health that are not yet surfaced as a first-class release-safety signal.
- Safest fix approach:
  - Add founder-visible runner health and stale-queue monitoring before treating queued follow-up as production-safe.

### Issue 8. MAR remains the main open read-performance hotspot
- Audit source:
  - `docs/audits/supabase-query-performance-audit-2026-04-07.md`
- Architectural rule violated:
  - Shared read boundaries should avoid repeated broad Supabase reads.
- Why this is still open:
  - The health dashboard still overlaps MAR reads, and the main MAR workflow still loads broad organization-wide datasets on first load.
- Safest fix approach:
  - Consolidate the MAR dashboard read boundary first, then contain first-load payload size on the main MAR page if that can be done without changing medication-safety behavior.
- Current worktree note:
  - `lib/services/health-dashboard.ts` and `lib/services/mar-dashboard-read-model.ts` already have local uncommitted changes, so this item may be actively in progress.

### Issue 9. Alert and MHP search index hardening should be finished and verified
- Audit source:
  - `docs/audits/supabase-query-performance-audit-2026-04-07.md`
- Architectural rule violated:
  - Migration-driven schema should reflect real runtime query shapes.
- Why this is still open:
  - The audit still expects:
    - one partial `system_events` open-alert lookup index
    - trigram indexes for `provider_directory.provider_name`
    - trigram indexes for `hospital_preference_directory.hospital_name`
- Safest fix approach:
  - Ship the smallest forward-only migration matching the real query paths and verify behavior stays unchanged.
- Current worktree note:
  - `supabase/migrations/0207_system_events_open_alert_and_mhp_trgm_indexes.sql` already exists uncommitted and appears to implement this fix.

### Issue 10. Member-list read logic still needs one shared canonical boundary
- Audit source:
  - `docs/audits/supabase-query-performance-audit-2026-04-07.md`
- Architectural rule violated:
  - Shared resolver/service boundaries.
  - Maintainability and consistent paging/search/sort behavior.
- Why this is still open:
  - Member Directory, Member Command Center index, and MHP index still solve similar list behavior in separate services.
- Safest fix approach:
  - Introduce the smallest shared read boundary that centralizes paging/search/sort without rewriting the screens.
- Current worktree note:
  - `lib/services/member-list-read.ts` already exists uncommitted and appears to be the start of this consolidation.

### What Did Not Produce A New Prompt
- Daily Canonicality Sweep:
  - The latest artifact is still `docs/audits/daily-canonicality-sweep-raw-2026-03-27.json`.
  - It did not show missing runtime tables, missing RPCs, missing storage buckets, mock-runtime imports, or banned production fallback patterns.
- Shared Resolver Drift Check:
  - The latest `docs/audits/shared-resolver-drift-check-2026-03-29.md` says the focused resolver drift items it audited were already fixed.
- Shared RPC Architecture Audit:
  - The latest `docs/audits/rpc-architecture-audit-2026-03-24.md` is still useful for long-term direction, but it did not expose a newer small safe fix beyond the already-known staged workflow/read-model issues above.
- Schema Migration Safety Audit:
  - `docs/audits/schema-migration-safety-audit-2026-04-02.md` did not show new local schema drift. The remaining issue is linked-project migration parity, which is operational, not a new code bug.
- Idempotency & Duplicate Submission Audit:
  - The latest `docs/audits/idempotency-duplicate-submission-audit-2026-03-29.md` says the fresh low-risk duplicate-write gap it found was already fixed.

## 2. Codex Fix Prompts

### Prompt 1. Add RLS to `user_permissions`
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
`public.user_permissions` is a live permission-boundary table, but the repo audit still cannot find RLS enablement or policies for it.

Scope:
- Domain/workflow: user management and staff permission overrides
- Canonical entities/tables: `public.user_permissions`
- Expected canonical write path: admin UI -> server action/service -> Supabase

Required approach:
1) Inspect the current migration history and the live repo usage in `lib/services/user-management.ts`.
2) Add one forward-only migration that:
   - enables RLS on `public.user_permissions`
   - allows only the intended admin role path for normal runtime reads/writes
   - preserves `service_role` maintenance access where needed
3) Do not change the canonical user-management service path unless a policy requires a small service adjustment.
4) Keep the policy names and conditions explicit and auditable.
5) Avoid broad authenticated access and avoid app-layer-only permission assumptions.

Validation:
- Run typecheck.
- Show the migration file added.
- Explain which runtime callers can still read/write `user_permissions` after the change.
- Call out any linked-project/deployed-policy verification that still must happen outside the repo.
```

### Prompt 2. Verify and fix the Intake -> draft POF handoff
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
The latest workflow simulation says Intake -> Physician Orders / POF generation cannot evidence canonical `physician_orders` persistence, while the ACID audit suggests the real issue may be staged readiness rather than a missing write.

Scope:
- Domain/workflow: intake post-sign -> draft physician order creation
- Canonical entities/tables: `intake_assessments`, `physician_orders`, intake follow-up queues
- Expected canonical write path: UI -> server action -> service/RPC -> Supabase

Required approach:
1) Inspect the full path starting with `app/intake-actions.ts`, `lib/services/intake-pof-mhp-cascade.ts`, and `lib/services/physician-orders-supabase.ts`.
2) Confirm whether `createDraftPhysicianOrderFromAssessment` and `rpc_create_draft_physician_order_from_intake` are the authoritative write boundary.
3) If the write is actually missing or bypassed, fix the canonical service path so the draft POF is durably created in `physician_orders`.
4) If the write is already correct, tighten the shared readiness/result contract and regression coverage so the workflow cannot be misclassified as broken.
5) Preserve one canonical write path. Do not add a second direct `physician_orders` write path from UI or action code.

Validation:
- Show the final canonical write path you confirmed.
- Add regression coverage for signed intake -> draft POF persistence and follow-up-required truth.
- Report downstream impact on POF, MHP, MCC, and workflow simulation evidence.
```

### Prompt 3. Tighten artifact persistence and milestone notification truth
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Workflow simulation still flags weak completion evidence for completed enrollment packet artifacts, intake PDF member-file persistence, and enrollment milestone notifications.

Scope:
- Domain/workflow: enrollment packet completion, intake post-sign artifact persistence, enrollment milestone notifications
- Canonical entities/tables: `member_files`, `enrollment_packet_requests`, `intake_assessments`, `user_notifications`, relevant lifecycle events
- Expected canonical write path: UI -> server action -> service layer -> Supabase

Required approach:
1) Inspect the current service boundaries that save:
   - the completed enrollment packet artifact
   - the signed intake PDF
   - enrollment milestone notifications
2) Preserve current canonical commits, but make "fully complete" truth depend on the required durable artifact/notification writes when the architecture contract requires them.
3) If a required save can lag or fail, return explicit follow-up-required truth instead of plain completion.
4) Keep event logging and notification creation in the service layer only.
5) Do not add fake fallback success or UI-only status patches.

Validation:
- Run typecheck.
- List which completion states changed.
- Add regression coverage for:
  - completed packet artifact saved to `member_files`
  - intake PDF saved to `member_files`
  - enrollment milestone notification emitted only after durable success
```

### Prompt 4. Unify staged workflow readiness vocabulary
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Enrollment, intake, signed POF, and care plan flows still expose committed-vs-ready truth in different shapes, which creates handoff confusion even when canonical writes are correct.

Scope:
- Domain/workflow: staged workflow readiness across enrollment packet, intake, POF post-sign, and care plan post-sign flows
- Canonical entities/tables: discover current readiness columns, follow-up queues, and shared helper files first
- Expected canonical path: existing writes stay authoritative; shared readiness helper/resolver becomes authoritative for read-side truth

Required approach:
1) Inspect existing readiness helpers and fields, including `lib/services/committed-workflow-state.ts` and the current enrollment/intake/POF/care-plan follow-up helpers.
2) Reuse existing Supabase-backed readiness fields and queues. Do not replace them with in-memory logic.
3) Introduce one shared founder-readable vocabulary for:
   - committed
   - operationally ready
   - follow-up required
4) Update only the necessary server actions and staff-facing read paths to use that shared truth.
5) Preserve legal/document signature state separately from downstream operational readiness.

Validation:
- Show the final shared readiness vocabulary.
- List the screens/actions updated to use it.
- Explain any workflow intentionally left on a narrower local helper and why.
```

### Prompt 5. Reduce public enrollment packet pre-finalize work
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
The public enrollment packet submit flow still performs too much staging work before `rpc_finalize_enrollment_packet_submission`, which increases duplicate work during near-simultaneous retries.

Scope:
- Domain/workflow: public enrollment packet completion
- Canonical entities/tables: enrollment packet submission artifacts, uploads, requests, and finalize RPC state
- Expected canonical write path: public action -> canonical service -> finalize RPC -> Supabase

Required approach:
1) Inspect `lib/services/enrollment-packets-public-runtime.ts` and related public upload/artifact helpers.
2) Identify which work is non-essential before finalization and can safely move after the canonical finalize step.
3) Keep replay safety intact and keep the existing final RPC authoritative.
4) Make replay losers do minimal pre-finalize work and keep cleanup deterministic.
5) Do not introduce a UI workaround or a second finalize path.

Validation:
- Add regression coverage for two near-simultaneous submit attempts.
- Explain what now happens before and after finalization.
- Report any remaining staged follow-up that is intentionally preserved.
```

### Prompt 6. Make member-file delete repair-safe
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
`lib/services/member-files.ts` avoids false success on delete, but it can still leave a database row pointing to a missing storage object if storage deletion succeeds and the DB delete fails afterward.

Scope:
- Domain/workflow: member file deletion
- Canonical entities/tables: `member_files`, storage object path for the same artifact
- Expected canonical write path: server action -> member-files service -> Supabase/storage

Required approach:
1) Inspect the current delete flow in `lib/services/member-files.ts`.
2) Keep the existing "no plain success on failure" behavior.
3) Add the smallest repair-safe contract possible, such as:
   - a tombstone/repair marker
   - an auditable cleanup queue
   - or another deterministic reconcile path
4) Preserve canonical service ownership. Do not push this problem into the UI.
5) Make the drift state observable and repairable if the DB and storage steps split.

Validation:
- Run typecheck.
- Explain the new drift/repair behavior.
- Add a regression test or deterministic failure-path coverage if practical.
```

### Prompt 7. Add visible health checks for enrollment and POF follow-up runners
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
POF and enrollment follow-up truth is more honest now, but real durability still depends on retry runners, cron wiring, and secrets that are not surfaced as a first-class operational safety signal.

Scope:
- Domain/workflow: enrollment packet mapping follow-up and POF post-sign follow-up runners
- Canonical entities/tables: follow-up queues, workflow observability/system events, any existing operational reliability surfaces
- Expected canonical path: service/runner observability -> Supabase

Required approach:
1) Inspect the queue claim routes and current observability helpers for enrollment and POF follow-up work.
2) Add the smallest founder-visible runner health signal that can show:
   - last successful runner activity
   - stale queue age / backlog risk
   - configuration or auth failures when detectable
3) Keep workflow business writes unchanged. This is an observability hardening pass, not a workflow rewrite.
4) Reuse existing `system_events` / operational reliability infrastructure where possible.

Validation:
- Show where the health signal is surfaced.
- Explain what conditions trigger an operational warning.
- Call out any remaining environment-only gaps that cannot be proven from repo code.
```

### Prompt 8. Finish MAR read-boundary containment
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
MAR is still the main remaining read-performance hotspot. The dashboard and main workflow paths are broader than they need to be.

Scope:
- Domain/workflow: MAR dashboard and MAR workflow reads
- Canonical entities/tables/views: `v_mar_today`, `v_mar_overdue_today`, `v_mar_not_given_today`, shared MAR read services
- Expected canonical path: shared read model/service -> Supabase

Required approach:
1) Inspect `lib/services/mar-workflow-read.ts`, `lib/services/health-dashboard.ts`, and `lib/services/mar-dashboard-read-model.ts`.
2) Build one canonical read boundary so overlapping dashboard MAR reads do not hit the same view twice.
3) If safe, contain first-load payload size for the main MAR page by splitting primary queue data from secondary/on-demand reads.
4) Preserve medication-safety behavior and do not move business logic into components.
5) Check for existing uncommitted local work first and continue that path instead of creating a competing solution.

Validation:
- Show the before/after read boundary.
- Confirm no medication-state behavior changed.
- Report changed files and any first-load data tradeoff.
```

### Prompt 9. Finish and verify the alert/MHP search index migration
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
The query audit still expects one `system_events` open-alert lookup index and two MHP trigram search indexes, and an uncommitted migration already appears to implement them.

Scope:
- Domain/workflow: workflow alert de-dupe writes and MHP directory search
- Canonical entities/tables: `system_events`, `provider_directory`, `hospital_preference_directory`
- Expected canonical path: migration-only hardening

Required approach:
1) Inspect `supabase/migrations/0207_system_events_open_alert_and_mhp_trgm_indexes.sql` and confirm it exactly matches the live query shapes in `lib/services/workflow-observability.ts` and `lib/services/member-health-profiles-supabase.ts`.
2) If the migration is correct, finish the validation/reporting work instead of rewriting it.
3) If it needs adjustment, keep the fix minimal and forward-only.
4) Do not change business logic unless an index mismatch proves the query shape is wrong.

Validation:
- Show the final migration contents.
- Explain which queries each index supports.
- Confirm no application behavior changed.
```

### Prompt 10. Finish the shared member-list read boundary
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Member Directory, Member Command Center index, and MHP index still have drifting paging/search/sort logic, and an uncommitted `lib/services/member-list-read.ts` suggests the consolidation has started.

Scope:
- Domain/workflow: member list/index reads
- Canonical entities/tables: current member list services and shared member row shape
- Expected canonical path: shared read service -> Supabase

Required approach:
1) Inspect the current uncommitted `lib/services/member-list-read.ts` plus the MCC and MHP member-list callers.
2) Continue the smallest shared-boundary refactor already in progress instead of inventing a parallel abstraction.
3) Centralize common paging/search/sort behavior in one service boundary.
4) Preserve role restrictions and any screen-specific presentation differences.
5) Do not rewrite the screens unless a small call-site adjustment is needed to adopt the shared boundary.

Validation:
- Show the final shared boundary.
- List affected consumers.
- Call out any intentionally retained differences between Directory, MCC, and MHP index behavior.
```

## 3. Fix Priority Order
1. Add RLS to `user_permissions`.
2. Verify and fix the Intake -> draft POF handoff.
3. Tighten artifact persistence and milestone notification truth.
4. Unify staged workflow readiness vocabulary.
5. Reduce public enrollment packet pre-finalize work.
6. Make member-file delete repair-safe.
7. Add visible health checks for enrollment and POF follow-up runners.
8. Finish MAR read-boundary containment.
9. Finish and verify the alert/MHP search index migration.
10. Finish the shared member-list read boundary.

## 4. Founder Summary
- The latest audit set did not uncover a broad new Supabase/canonicality collapse. The daily canonicality sweep, latest schema migration safety audit, focused resolver-drift audit, and latest duplicate-submission audit all point to a repo that is materially cleaner than the earlier March runs.
- The open work is now concentrated in a smaller set of real production issues:
  - one confirmed database security boundary gap (`user_permissions` RLS)
  - staged workflow truth and artifact durability
  - public enrollment replay hygiene
  - runner-health visibility
  - a few remaining read-performance/read-boundary cleanups
- Several query-performance items appear to already be in progress in the current worktree:
  - `supabase/migrations/0207_system_events_open_alert_and_mhp_trgm_indexes.sql`
  - `lib/services/member-list-read.ts`
  - local changes in `lib/services/health-dashboard.ts` and `lib/services/mar-dashboard-read-model.ts`
- The most important unresolved ambiguity is still Intake -> POF. That should be treated as a verify-the-canonical-path-first fix, not blindly assumed to be either fully broken or fully resolved.
