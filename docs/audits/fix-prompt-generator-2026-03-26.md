# Fix Prompt Generator - 2026-03-26

## Issues Detected

### 1. Enrollment packet public submit can return failure after the packet already committed
- Source audits:
  - `acid-transaction-audit-2026-03-26.md`
  - `workflow-simulation-audit-founder-2026-03-26.md`
- Architectural rule violated:
  - workflow state integrity
  - ACID durability / false-success prevention
  - canonical service result contract
- Confirmed root cause:
  - `submitPublicEnrollmentPacket()` can finalize the filing RPC, then throw later when downstream mapping/readiness is incomplete.
  - `app/sign/enrollment-packet/[token]/actions.ts` still turns that into `ok: false`.
- Safest fix approach:
  - keep the filing RPC and readiness queue
  - return a committed result shape with readiness/action-needed fields instead of throwing after commit
  - preserve replay/idempotency protections already added in `0149` and `0151`

### 2. Staged workflows still do not share one canonical operational-readiness contract
- Source audits:
  - `acid-transaction-audit-2026-03-26.md`
  - `workflow-simulation-audit-founder-2026-03-26.md`
- Architectural rule violated:
  - shared resolver/service boundaries
  - workflow state integrity
  - one canonical resolver path per shared business rule
- Confirmed root cause:
  - intake, enrollment packet, care plan, and signed POF all persist a legally committed step first, but callers still handle readiness inconsistently.
  - some actions return `ok: true`, some return string errors, and some imply completion too early.
- Safest fix approach:
  - keep the current staged-readiness columns and queues
  - standardize one shared committed-vs-operationally-ready response contract across these workflows
  - update UI surfaces to read canonical readiness instead of inferring from `signed` or `filed`

### 3. Member-file delete is not durability-safe
- Source audits:
  - `acid-transaction-audit-2026-03-26.md`
- Architectural rule violated:
  - durability
  - explicit failure without data drift
  - auditable artifact lifecycle
- Confirmed root cause:
  - `deleteMemberFileRecordAndStorage()` deletes the DB row before deleting Supabase storage.
  - if storage cleanup fails, the canonical row is already gone and the system is left with orphaned storage.
- Safest fix approach:
  - replace delete-row-first with a durable two-stage delete or tombstone/reconciliation model
  - keep Supabase canonical and make cleanup repairable/auditable

### 4. MAR actions can show failure after a committed write because audit logging throws
- Source audits:
  - `acid-transaction-audit-2026-03-26.md`
- Architectural rule violated:
  - durability
  - no synthetic user-visible failure after durable persistence
  - service-layer auditability
- Confirmed root cause:
  - `app/(portal)/health/mar/actions-impl.ts` awaits `insertAudit()` after MAR writes and monthly report saves.
  - if the audit insert fails, the action returns an error even though the MAR administration or member-file save already committed.
- Safest fix approach:
  - keep the current canonical MAR write/RPC path
  - switch post-commit audit logging to a non-throwing helper pattern with an operational alert

### 5. Signed POF downstream sync depends on runner health that is not treated as a release-safety contract
- Source audits:
  - `acid-transaction-audit-2026-03-26.md`
  - `workflow-simulation-audit-founder-2026-03-26.md`
- Architectural rule violated:
  - workflow lifecycle integrity
  - operational readiness must be explicit
  - no hidden dependency on unmonitored async infrastructure
- Confirmed root cause:
  - signed POF is legally complete before MHP/MAR sync finishes.
  - if the internal runner is misconfigured or stale, orders can stay queued without strong enough release-safety visibility.
- Safest fix approach:
  - preserve the queue-backed design
  - add a canonical ops health surface and release-safety check for missing secrets and stale queue rows
  - surface `signed, sync pending` more aggressively to staff

### 6. Physician orders index still fetches first and filters later
- Source audits:
  - `query-performance-audit-2026-03-26.md`
- Architectural rule violated:
  - query performance guardrails
  - canonical read-model efficiency
- Confirmed root cause:
  - `listPhysicianOrdersPage()` orders the table by `updated_at`, fetches a page, and still relies on app-layer search composition that does not fully push the search workload into SQL.
  - the page also still preloads full active-member filter options.
- Safest fix approach:
  - keep one canonical physician-order read service
  - move all supported text/member/status filtering into SQL and finalize true pagination
  - add an index only if the final query shape needs it

### 7. Member Health Profile detail is still a heavy all-at-once cross-domain read
- Source audits:
  - `query-performance-audit-2026-03-26.md`
  - `rpc-architecture-audit-2026-03-24.md`
- Architectural rule violated:
  - canonical read-model boundaries
  - build/runtime performance guardrails
- Confirmed root cause:
  - `getMemberHealthProfileDetailSupabase()` loads profile, diagnoses, meds, allergies, providers, equipment, notes, assessments, MCC, and optional directories in one request.
  - the page adds more cross-domain reads on top.
- Safest fix approach:
  - preserve canonical service ownership
  - split heavy collections into tab-aware loaders or a narrower read model without a large rewrite

### 8. Audit coverage gap: no fresh standalone March 26 RLS, shared-resolver-drift, or idempotency report artifact
- Source audits:
  - repo inventory check on 2026-03-26
  - latest available supporting artifacts: `daily-canonicality-sweep-raw-2026-03-26.json`, `rpc-architecture-audit-2026-03-24.md`, `supabase-schema-compatibility-audit-2026-03-11.md`
- Architectural rule affected:
  - production auditability
- Confirmed root cause:
  - the repo contains no new standalone March 26 markdown artifact for:
    - Supabase RLS & Security Audit
    - Shared Resolver Drift Check
    - Idempotency & Duplicate Submission Audit
- Safest fix approach:
  - do not invent code fixes from missing reports
  - generate a dedicated audit-run prompt so the missing report set is refreshed before the next implementation pass

## Codex Fix Prompts

### Prompt 1. Enrollment packet public submit should return committed follow-up-required state
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
The public enrollment packet completion flow can file the packet successfully and then still return a generic failure because downstream mapping/readiness is incomplete.

Scope:
- Domain/workflow: enrollment packet public completion
- Canonical entities/tables: enrollment_packet_requests, enrollment_packet_fields, enrollment_packet_signatures, enrollment_packet_uploads, enrollment_packet_mapping_runs, member_files, enrollment_packet_follow_up_queue
- Expected canonical write path: Public form -> server action -> enrollment packet public service -> Supabase RPC/service layer

Inspect first:
- app/sign/enrollment-packet/[token]/actions.ts
- lib/services/enrollment-packets-public-runtime.ts
- lib/services/enrollment-packet-completion-cascade.ts
- any shared readiness/result types already used by intake/care plan/POF flows

Required approach:
1. Confirm exactly where the filing RPC commits and where post-commit readiness failures still throw.
2. Keep Supabase as source of truth and preserve the existing filing RPC, replay safety, and follow-up queue behavior.
3. Refactor the canonical service result so a filed packet can return a committed state like:
   - committed: true
   - operationallyReady: boolean
   - actionNeeded: boolean
   - readinessStatus / message
   instead of throwing after commit.
4. Update the server action so it does not return `ok: false` once filing already succeeded.
5. Preserve explicit failure for true pre-commit validation or persistence failures.
6. Update the confirmation/redirect handling only as needed so caregivers are not encouraged to retry a packet that already filed.
7. Add or update regression coverage for:
   - fully ready success
   - filed but mapping/follow-up still required
   - true pre-commit failure

Validation:
- Run typecheck/build and report results.
- List changed files and downstream impact.
- Call out blockers explicitly if schema or existing result types need follow-up.

Do not overengineer. Do not replace the existing readiness queue. Keep the fix maintainable and auditable.
```

### Prompt 2. Standardize one canonical operational-readiness contract across staged workflows
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Intake, enrollment packet, care plan, and signed POF all have staged post-commit readiness, but they do not expose one consistent committed-vs-operationally-ready contract.

Scope:
- Domain/workflow: intake post-sign, enrollment packet completion, care plan post-sign, signed POF post-sign sync
- Canonical entities/tables: discover current readiness columns and follow-up queues first
- Expected canonical write path: UI -> Server Action -> Service Layer -> Supabase

Inspect first:
- app/intake-actions.ts
- lib/services/enrollment-packets-public-runtime.ts
- lib/services/care-plans-supabase.ts
- lib/services/pof-post-sign-runtime.ts
- any existing readiness helpers such as intake/care plan/physician-order readiness resolvers

Required approach:
1. Identify the current committed-state and readiness-state outputs for all four workflows.
2. Define one shared result contract for committed staged workflows. It should distinguish:
   - pre-commit failure
   - committed and operationally ready
   - committed but follow-up required
3. Keep existing Supabase-backed readiness columns/queues. Do not replace working persistence with in-memory status logic.
4. Move shared response construction into canonical service/resolver helpers rather than duplicating it in each action.
5. Update the affected server actions/pages to read the shared contract instead of inferring completion from `signed`, `filed`, or ad hoc error text.
6. Preserve current role restrictions and explicit follow-up/audit behavior.
7. Add targeted tests for one workflow per state so this contract cannot drift again.

Validation:
- Run typecheck/build.
- Summarize downstream UI/state changes.
- Call out any workflow that still needs separate treatment and why.

Do not do a giant rewrite. This is a contract-standardization pass, not a new workflow engine.
```

### Prompt 3. Make member-file deletion durability-safe
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Member-file deletion currently removes the database row before storage cleanup. If storage deletion fails, the canonical row is already gone and the file becomes an orphan.

Scope:
- Domain/workflow: member files delete lifecycle
- Canonical entities/tables: member_files, related storage object path fields, any delete RPCs/migrations already backing this path
- Expected canonical write path: UI/action -> member-files service -> Supabase DB/storage

Inspect first:
- lib/services/member-files.ts
- the current delete RPC migration for member files
- any existing workflow observability/alert helpers for durable cleanup follow-up

Required approach:
1. Confirm the current delete sequence and all callers.
2. Replace delete-row-first behavior with the smallest durable pattern that fits the current architecture:
   - preferred: mark row pending delete, delete storage, then finalize DB delete
   - acceptable: keep a tombstone/reconciliation record if a row cannot remain in place
3. Keep Supabase as source of truth and make cleanup failures auditable/recoverable.
4. Preserve role restrictions and existing delete RPC boundaries where practical.
5. Add explicit follow-up visibility for failed cleanup so staff can repair it.
6. If schema changes are required, add forward-only migration(s) and align runtime code to them.
7. Update tests or add narrow regression coverage for:
   - successful delete
   - storage cleanup failure after request starts
   - retry/reconciliation behavior

Validation:
- Run typecheck/build.
- Report schema impact and downstream operational impact.

Do not paper over the problem with a swallowed storage error. The fix must preserve auditability.
```

### Prompt 4. Stop MAR audit logging from turning committed writes into user-visible failures
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
MAR administrations and monthly MAR report saves can already commit successfully, but a later audit-log insert failure still causes the action to return an error to the UI.

Scope:
- Domain/workflow: MAR administration + monthly MAR report actions
- Canonical entities/tables: mar_administrations, member_files, audit_logs
- Expected canonical write path: UI -> server action -> MAR workflow/member-files service -> Supabase

Inspect first:
- app/(portal)/health/mar/actions-impl.ts
- app/action-helpers.ts
- any existing non-throwing audit helper pattern already used elsewhere

Required approach:
1. Confirm which MAR actions perform durable writes first and then call `insertAudit()`.
2. Preserve the existing canonical MAR RPC/service write paths and member-file save path.
3. Replace post-commit throwing audit inserts with a non-throwing helper that:
   - records/alerts the audit failure
   - does not convert a committed MAR write into a user-visible failure
4. Keep true write failures as hard failures.
5. Recheck scheduled MAR, PRN admin, PRN outcome, and monthly MAR report generation.
6. Add regression coverage for “write succeeded, audit failed”.

Validation:
- Run typecheck/build.
- Summarize which MAR actions changed and confirm user-visible behavior for partial post-commit audit failure.

Do not move business writes into the UI. Keep the fix narrow and deterministic.
```

### Prompt 5. Treat the POF post-sign runner as release-safety infrastructure
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Signed POF is legally complete before MHP/MAR sync is guaranteed complete, and the queue runner health is not enforced strongly enough as a release-safety contract.

Scope:
- Domain/workflow: signed POF post-sign sync queue
- Canonical entities/tables: physician_orders, pof_post_sign_sync_queue, MHP/MAR downstream records, workflow alerts/events
- Expected canonical write path: public POF sign -> canonical finalize/sign service -> queued post-sign sync -> Supabase-backed downstream sync

Inspect first:
- lib/services/pof-post-sign-runtime.ts
- app/api/internal/pof-post-sign-sync/route.ts
- physician-order clinical sync status readers/UI surfaces
- any existing ops/health checks for internal runners

Required approach:
1. Confirm current queue runner dependencies (`POF_POST_SIGN_SYNC_SECRET`, `CRON_SECRET`, stale queue behavior).
2. Keep the current queue-backed design. Do not force synchronous clinical sync into the public sign request.
3. Add a production-safe health surface/check that:
   - flags missing runner secrets/configuration
   - flags stale queued rows past an alert threshold
   - is visible to operations or fails release-safety checks clearly
4. Strengthen staff-facing status language so signed POFs with queued sync are visibly not fully operational.
5. Preserve existing compare-and-set/replay protections and workflow alerts.
6. Add minimal regression coverage or deterministic checks for the stale/misconfigured-runner paths.

Validation:
- Run typecheck/build.
- Report any env or schema blockers explicitly.

Do not overengineer with a new queue system. Harden the current canonical queue path.
```

### Prompt 6. Push physician-order index filtering into SQL and finish pagination
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
The physician orders index remains one of the heaviest open list pages. Search/filter behavior is not fully pushed into SQL, and the page still relies on broad member lookup preloads.

Scope:
- Domain/workflow: physician orders index/list page
- Canonical entities/tables: physician_orders, members, any queue-status/read-model helpers already used by the page
- Expected canonical read path: page -> one canonical physician-order read service -> Supabase

Inspect first:
- lib/services/physician-orders-read.ts
- app/(portal)/health/physician-orders/page.tsx
- shared member lookup helpers used by this screen

Required approach:
1. Confirm the current query shape, search behavior, and page/filter contracts.
2. Keep one canonical physician-order read service. Do not duplicate list logic in the page.
3. Push supported text/member/status filtering into SQL rather than app-memory post-processing.
4. Keep or improve real pagination and total counts.
5. Narrow the member filter lookup path if the page does not need a full active roster preload.
6. Only add a supporting index if the final query shape still needs one after cleanup.
7. Run typecheck and summarize any user-visible filter/paging changes.

Validation:
- Run typecheck/build.
- Report any migration/index added and why.

Do not rewrite the whole physician-order module. Keep this a list-read hardening pass.
```

### Prompt 7. Slim the Member Health Profile detail read path
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
The Member Health Profile detail page still loads too many collections together and adds cross-domain reads on top, making it one of the heaviest member-detail paths left in the app.

Scope:
- Domain/workflow: member health profile detail
- Canonical entities/tables: member_health_profiles, member_diagnoses, member_medications, member_allergies, member_providers, member_equipment, member_notes, intake_assessments, member_command_centers, plus the extra page-level care plan/payor/POF reads
- Expected canonical read path: page -> canonical MHP read model/service -> Supabase

Inspect first:
- lib/services/member-health-profiles-supabase.ts
- app/(portal)/health/member-health-profiles/[memberId]/page.tsx
- any existing tab-aware loader patterns already used in nearby pages

Required approach:
1. Measure which collections are always loaded now and which are actually tab-specific.
2. Preserve one canonical service boundary for MHP reads.
3. Split or defer the heaviest collections so the initial page load becomes lighter without changing stored truth.
4. Keep provider/hospital directory behavior aligned with current tab-aware behavior.
5. Avoid duplicating business rules across tabs/pages.
6. Add only the minimal UI/service changes needed to support narrower loads.

Validation:
- Run typecheck/build.
- Describe what became lighter and any remaining heavy cross-domain reads left for later.

Do not add mock fallbacks. Do not turn this into a large frontend rewrite.
```

### Prompt 8. Refresh the missing audit artifacts before the next fix pass
```text
Refresh the missing Memory Lane audit artifacts before the next implementation pass.

Problem:
- The repo does not currently contain fresh standalone March 26 markdown reports for:
  - Supabase RLS & Security Audit
  - Shared Resolver Drift Check
  - Idempotency & Duplicate Submission Audit
- I do not want guessed code fixes based on missing audit output.

What to do:
1. Run or regenerate the missing audit reports using the repo’s canonical audit workflows.
2. Save the artifacts into docs/audits with today’s date.
3. If an audit cannot run locally, say exactly why and what environment/config is missing.
4. Summarize only new confirmed findings that still need implementation work.
5. Do not edit product code in this pass unless the audit runner itself is broken and needs a safe fix.

Output:
- exact audit files created or updated
- blocker list if any audits could not run
- concise list of new confirmed findings only
```

## Fix Priority Order

1. Enrollment packet committed-after-failure response fix
2. Shared staged-readiness contract across intake/enrollment/care plan/POF
3. Member-file delete durability hardening
4. MAR post-commit audit non-throwing behavior
5. POF post-sign runner health and stale-queue visibility
6. Physician orders SQL filtering + pagination hardening
7. Member Health Profile detail read slimming
8. Refresh missing standalone audit artifacts

## Founder Summary

- The March 26 audit set does **not** show a new broad Supabase-bypass regression. Most of the remaining work is now about truthful workflow completion, durability after commit, and a smaller set of heavy read paths.
- The highest-value bug is still enrollment packet public completion returning a failure after the packet has already been filed. That is the clearest production confusion and retry-risk issue in the current reports.
- The broader architecture issue behind several findings is the same one: Memory Lane now has safer staged workflows, but the app still needs one canonical way to say “committed but not operationally ready yet.”
- The cleanest durability fix is member-file delete order. Right now storage cleanup can drift behind the deleted DB row.
- On performance, the physician orders index and MHP detail page now stand out more clearly because other March 25 read-model fixes already landed.
- No fresh standalone March 26 markdown artifact exists in the repo for RLS/security, shared resolver drift, or idempotency. I did not invent fixes for those; I added an audit-refresh prompt instead.
