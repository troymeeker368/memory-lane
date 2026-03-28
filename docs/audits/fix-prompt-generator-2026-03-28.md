# Fix Prompt Generator - 2026-03-28

## Issues Detected

### 1. Intake draft POF reload can still publish a false failed state after a durable create
- Source audits:
  - `acid-transaction-audit-2026-03-27.md`
- Architectural rule violated:
  - workflow state integrity
  - no false success / false failure state
  - canonical service result truth must match Supabase truth
- Confirmed issue:
  - the draft POF RPC can durably create a `physician_order_id`, but a later readback miss can still let the intake workflow publish `draft_pof_failed`
  - this creates operational drift between the real Supabase record and the visible status
- Safest fix approach:
  - preserve the current RPC-backed create path
  - separate create failure from post-commit readback failure
  - keep follow-up visibility without downgrading a durable create to a failed status

### 2. Staged workflows still do not share one canonical committed-vs-ready contract
- Source audits:
  - `acid-transaction-audit-2026-03-27.md`
  - `workflow-simulation-audit-founder-2026-03-27.md`
- Architectural rule violated:
  - shared resolver/service boundaries
  - canonical workflow truth
  - explicit state transitions
- Confirmed issue:
  - intake, enrollment packet, care plan, and signed POF all support committed-but-not-fully-ready states
  - callers and staff-facing flows still risk treating `signed`, `filed`, or equivalent first-stage status as if downstream work is already complete
- Safest fix approach:
  - keep the current staged queues and readiness fields
  - move to one shared contract for pre-commit failure vs committed-ready vs committed-follow-up-required
  - align actions and read models to that contract

### 3. Signed POF downstream sync still depends on queue-runner readiness being visible and enforced
- Source audits:
  - `acid-transaction-audit-2026-03-27.md`
  - `workflow-simulation-audit-founder-2026-03-27.md`
- Architectural rule violated:
  - ACID durability
  - workflow lifecycle integrity
  - no hidden dependency on unverified async infrastructure
- Confirmed issue:
  - legal POF signature finalization can succeed while MHP/MCC/MAR sync is queued for retry
  - if the runner config, secret, or monitoring is missing in production, downstream clinical truth can stay stale
- Safest fix approach:
  - preserve the queue-backed design
  - add explicit stale-queue health visibility and readiness checks
  - make `signed but sync pending` operationally obvious

### 4. Enrollment packet completion still needs one canonical operational-readiness model
- Source audits:
  - `acid-transaction-audit-2026-03-27.md`
  - `workflow-simulation-audit-founder-2026-03-27.md`
- Architectural rule violated:
  - canonical workflow truth
  - shared resolver boundaries
  - clear handoffs between workflows
- Confirmed issue:
  - packet completion now safely persists the public filing path, but downstream mapping and follow-up can still lag
  - staff can still over-trust `filed` unless one shared readiness model says whether downstream work is actually settled
- Safest fix approach:
  - preserve current public success-path behavior
  - add one canonical readiness helper/read model for filed-and-ready vs filed-follow-up-required
  - align staff surfaces and docs to that truth

### 5. Care plan post-sign readiness is still fragmented across create, review, and sign flows
- Source audits:
  - `acid-transaction-audit-2026-03-27.md`
  - `workflow-simulation-audit-founder-2026-03-27.md`
  - `rpc-architecture-audit-2026-03-24.md`
- Architectural rule violated:
  - shared service boundaries
  - workflow state integrity
  - auditability of downstream work
- Confirmed issue:
  - root care plan/signature persistence is durable, but snapshot history and caregiver dispatch can still fail afterward
  - the readiness contract is not yet standardized across create/review/sign entry points
- Safest fix approach:
  - preserve the current commit-first legal write path
  - centralize one post-sign readiness helper/contract
  - add aging visibility for plans stuck in follow-up-required state

### 6. Sales pipeline stage pages and follow-up dashboard still use unbounded lead-list reads
- Source audits:
  - `query-performance-audit-2026-03-27.md`
- Architectural rule violated:
  - query performance guardrails
  - canonical read-model efficiency
- Confirmed issue:
  - dedicated stage pages and the follow-up dashboard still call the canonical lead list without pagination
  - those pages will read whole stage buckets into memory as lead volume grows
- Safest fix approach:
  - keep one canonical lead-list path
  - require bounded pagination for those pages
  - add the stage-supporting index only if the final query shape still needs it

### 7. Shared active-member dropdown preloads are still repeated across many screens
- Source audits:
  - `query-performance-audit-2026-03-27.md`
- Architectural rule violated:
  - query performance guardrails
  - canonical lookup/read-model separation
- Confirmed issue:
  - many pages still preload active member options via `getMembers()` on page load
  - the capped preload is safer than before, but repeated eager roster reads still create unnecessary load
- Safest fix approach:
  - preserve one canonical member lookup service
  - move clear form/filter cases to search-first lookup
  - keep full page read models separate from lightweight member lookup behavior

### 8. Member Health Profile detail remains one of the heaviest single-member read paths
- Source audits:
  - `query-performance-audit-2026-03-27.md`
  - `rpc-architecture-audit-2026-03-24.md`
- Architectural rule violated:
  - canonical read-model boundaries
  - runtime performance guardrails
- Confirmed issue:
  - the MHP detail service still loads many collections together
  - the page layers more cross-domain reads on top, making initial load heavier than necessary
- Safest fix approach:
  - preserve the canonical MHP service boundary
  - split more payload by tab or section
  - keep the fix incremental and avoid a full page rewrite

### 9. Provider and hospital directory saves still use fuzzy lookup shapes instead of deterministic normalized upserts
- Source audits:
  - `query-performance-audit-2026-03-27.md`
- Architectural rule violated:
  - deterministic canonical write paths
  - query performance guardrails
- Confirmed issue:
  - MHP write helpers still use `ilike + order(updated_at desc) + limit(1)` even though the schema already has normalized unique indexes
  - this is broader and less deterministic than the canonical write path should be
- Safest fix approach:
  - keep Supabase as source of truth
  - align writes to normalized equality or real upsert semantics
  - prevent duplicate directory rows

### 10. Audit coverage is still incomplete for several required architecture checks
- Source audits:
  - current `docs/audits` inventory as of 2026-03-28
- Architectural rule violated:
  - production auditability
  - release-safety verification
- Confirmed issue:
  - there are still no fresh saved artifacts for:
    - Supabase RLS & Security Audit
    - Schema Migration Safety Audit
    - Shared Resolver Drift Check
    - Idempotency & Duplicate Submission Audit
  - the newest saved RPC architecture audit is still `2026-03-24`
- Safest fix approach:
  - do not invent product-code fixes from missing reports
  - refresh the missing audits first, then generate new implementation prompts from confirmed findings only

## Codex Fix Prompts

### Prompt 1. Fix the intake false-failure path after durable draft POF creation
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
The intake signing flow can durably create a draft physician order and then still publish `draft_pof_failed` if the immediate post-commit reload misses.

Scope:
- Domain/workflow: intake signed -> draft POF creation/readback
- Canonical entities/tables: intake_assessments, physician_orders, intake_post_sign_follow_up_queue
- Expected canonical write path: UI -> Server Action -> Service Layer -> Supabase RPC

Inspect first:
- app/intake-actions.ts
- lib/services/physician-orders-supabase.ts
- supabase/migrations/0055_intake_draft_pof_atomic_creation.sql

Required approach:
1. Trace the exact flow where the RPC returns a durable `physician_order_id` and a later reload miss still marks the intake as failed.
2. Preserve Supabase as source of truth and keep the existing draft-POF RPC authoritative.
3. Separate "draft create failed" from "post-commit reload failed."
4. Do not write `draft_pof_failed` when the durable draft order already exists.
5. Keep follow-up visibility and queue behavior, but label the state truthfully as committed with follow-up/readback required.
6. Update any caller/result contract that currently infers failure from the reload miss.
7. Add regression coverage for:
   - true RPC failure
   - durable draft created + reload miss
   - successful create + reload

Validation:
- Run typecheck and report results.
- List changed files and downstream impact.
- Call out any schema or migration blocker explicitly.

Do not overengineer. Do not replace the existing RPC or queue path. Keep the fix deterministic and auditable.
```

### Prompt 2. Standardize one canonical committed-vs-ready workflow contract
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Intake, enrollment packet, care plan, and signed POF all support staged follow-up, but they do not expose one consistent canonical contract for "committed and ready" vs "committed but follow-up required."

Scope:
- Domain/workflow: staged workflows across intake, enrollment packet, care plan, and signed POF
- Canonical entities/tables: discover current readiness columns, statuses, and follow-up queues first
- Expected canonical write path: UI -> Server Action -> Service Layer -> Supabase

Inspect first:
- app/intake-actions.ts
- app/sign/enrollment-packet/[token]/actions.ts
- app/care-plan-actions.ts
- lib/services/pof-post-sign-runtime.ts
- lib/services/intake-post-sign-readiness.ts
- lib/services/enrollment-packet-readiness.ts
- lib/services/care-plan-post-sign-readiness.ts
- any existing shared committed-workflow-state helpers

Required approach:
1. Identify the current committed-state and readiness-state result shapes in each workflow.
2. Define one shared service/result contract that distinguishes:
   - pre-commit failure
   - committed and operationally ready
   - committed but follow-up required
3. Keep existing Supabase-backed readiness fields and follow-up queues. Do not replace them with in-memory status logic.
4. Move shared response construction into canonical service/resolver helpers, not scattered action-specific logic.
5. Update the affected actions and staff-facing consumers to use the shared contract instead of reading `signed` or `filed` alone.
6. Preserve role restrictions, auditability, and explicit failure for real write failures.
7. Add narrow regression coverage for at least one workflow per state.

Validation:
- Run typecheck and report results.
- Summarize downstream UI/state contract changes.
- Call out any workflow that still needs separate treatment and why.

Do not build a new workflow engine. This is a contract-standardization pass only.
```

### Prompt 3. Harden POF post-sign sync as a release-safety dependency
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Signed POF is legally complete before MHP/MCC/MAR sync is guaranteed complete, and the queue runner is still not enforced strongly enough as a production-readiness dependency.

Scope:
- Domain/workflow: signed POF -> post-sign sync queue -> MHP/MCC/MAR
- Canonical entities/tables: physician_orders, pof_post_sign_sync_queue, member_health_profiles, member_command_centers, mar_schedules
- Expected canonical write path: public POF sign -> canonical finalize/sign service -> queued post-sign sync -> Supabase-backed downstream sync

Inspect first:
- lib/services/pof-esign-public.ts
- lib/services/pof-post-sign-runtime.ts
- lib/services/physician-orders-supabase.ts
- app/api/internal/pof-post-sign-sync/route.ts
- any existing ops/health or stale-queue alert helpers

Required approach:
1. Confirm current dependencies on runner secrets, schedule, and queue execution.
2. Keep the queue-backed design. Do not force downstream sync into the public sign request.
3. Add or tighten a production-safe health/readiness surface that:
   - flags missing runner config/secrets
   - flags stale queue rows past an agreed threshold
   - is visible to operations or fails readiness checks clearly
4. Make staff-facing status language and read models clearly show "signed but sync pending" vs "fully synced."
5. Preserve replay/idempotency protections and current canonical service boundaries.
6. Add deterministic checks or regression coverage for stale queue and missing-runner scenarios.

Validation:
- Run typecheck and report results.
- Report any env/config blocker explicitly.
- List changed files and downstream impact.

Do not overengineer with a new queue system. Harden the current canonical queue path.
```

### Prompt 4. Create one canonical operational-readiness model for enrollment packet completion
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Enrollment packet public completion is durable, but staff still lack one canonical operational-readiness model that distinguishes "filed" from "filed and downstream-ready."

Scope:
- Domain/workflow: enrollment packet completion -> downstream mapping/readiness
- Canonical entities/tables: enrollment_packet_requests, enrollment_packet_fields, enrollment_packet_signatures, enrollment_packet_uploads, enrollment_packet_mapping_runs, enrollment_packet_follow_up_queue, member_files
- Expected canonical write path: public form -> server action -> enrollment packet service/RPC -> Supabase

Inspect first:
- app/sign/enrollment-packet/[token]/actions.ts
- lib/services/enrollment-packets-public-runtime.ts
- lib/services/enrollment-packet-completion-cascade.ts
- lib/services/enrollment-packet-readiness.ts
- docs/workflow-hardening-rollout.md

Required approach:
1. Confirm the current durable filing boundary and how mapping/follow-up state is stored afterward.
2. Preserve the existing public success-path UX and mapping queue behavior.
3. Add one canonical readiness helper or read model for:
   - filed and downstream ready
   - filed and follow-up required
   - true failure before filing
4. Update staff-facing consumers and docs to use that canonical readiness model instead of `filed` alone.
5. Preserve replay safety, artifact persistence, and current canonical service boundaries.
6. Add narrow regression coverage for a filed-but-follow-up-required packet.

Validation:
- Run typecheck and report results.
- List changed files and downstream impact.
- Call out any schema dependency explicitly if a migration is needed.

Do not rewrite the whole enrollment flow. Keep the fix centered on truthful canonical readiness.
```

### Prompt 5. Standardize care plan post-sign readiness and aging visibility
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Care plan create/review/sign flows can commit before snapshot history and caregiver dispatch are durably complete, and the post-sign readiness contract is still fragmented.

Scope:
- Domain/workflow: care plan create/review/sign -> snapshot -> caregiver dispatch
- Canonical entities/tables: care_plans, care_plan_versions, care_plan_review_history, care_plan_signature_events, member_files
- Expected canonical write path: UI -> Server Action -> care plan service/RPC -> Supabase

Inspect first:
- app/care-plan-actions.ts
- lib/services/care-plans-supabase.ts
- lib/services/care-plan-esign.ts
- lib/services/care-plan-post-sign-readiness.ts

Required approach:
1. Trace the create, review, and sign flows and identify where each one reports readiness today.
2. Preserve the current commit-first behavior for legally important writes.
3. Centralize one canonical care-plan post-sign readiness contract that all three flows use.
4. Make it explicit when a plan is committed but still waiting on snapshot persistence or caregiver dispatch.
5. Add aging visibility or alert hooks for plans stuck in follow-up-required state too long.
6. Preserve role restrictions, signature auditability, and existing RPC/service boundaries.

Validation:
- Run typecheck and report results.
- Summarize downstream UI/state changes.
- Call out any remaining non-standard edge cases.

Do not overengineer. This is a contract and visibility hardening pass, not a workflow rewrite.
```

### Prompt 6. Paginate the sales stage pages and follow-up dashboard through one canonical lead-list path
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Dedicated sales stage pages and the follow-up dashboard still read whole lead buckets into memory because they call the canonical lead-list service without pagination.

Scope:
- Domain/workflow: sales pipeline stage pages + follow-up dashboard
- Canonical entities/tables: leads, lead_stage_history, lead_activities
- Expected canonical read path: page -> one canonical lead-list/read-model service -> Supabase

Inspect first:
- lib/services/sales-crm-read-model.ts
- app/(portal)/sales/pipeline/inquiry/page.tsx
- app/(portal)/sales/pipeline/tour/page.tsx
- app/(portal)/sales/pipeline/eip/page.tsx
- app/(portal)/sales/pipeline/nurture/page.tsx
- app/(portal)/sales/pipeline/referrals-only/page.tsx
- app/(portal)/sales/pipeline/closed-won/page.tsx
- app/(portal)/sales/pipeline/closed-lost/page.tsx
- app/(portal)/sales/pipeline/follow-up-dashboard/page.tsx

Required approach:
1. Confirm the current query shape and where `.range(...)` is skipped because callers omit pagination.
2. Preserve one canonical lead-list service path. Do not duplicate list logic in each page.
3. Move the dedicated stage pages and dashboard onto bounded paginated reads.
4. Keep current stage filters and sort behavior practical for staff.
5. Only add the `leads (status, stage, inquiry_date desc)` index if the final query shape still needs it.
6. Add or update regression coverage for paging/filtering contracts where practical.

Validation:
- Run typecheck and report results.
- Summarize user-visible paging/filtering changes.
- Report any migration/index added and why.

Do not do a broad sales rewrite. Keep this a read-model hardening pass.
```

### Prompt 7. Replace repeated member preloads with canonical search-first lookup
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Many Memory Lane pages still preload active member dropdown options on page load even when a search-first lookup would be sufficient.

Scope:
- Domain/workflow: shared member lookup behavior for forms and filters
- Canonical entities/tables: members
- Expected canonical read path: page/form -> canonical shared lookup service -> Supabase

Inspect first:
- lib/services/documentation.ts
- lib/services/shared-lookups-supabase.ts
- representative callers in documentation, care plans, physician orders, dashboards, and reports

Required approach:
1. Identify which callers truly need a preload and which should use search-first lookup instead.
2. Preserve one canonical member lookup service boundary.
3. Introduce or expand a search-first path for forms and filters that do not need a full active roster upfront.
4. Keep page/table read models separate from lightweight lookup reads.
5. Avoid a large UI refactor; change only the callers that are clear eager-read debt.
6. Add narrow regression coverage or deterministic checks for lookup behavior where practical.

Validation:
- Run typecheck and report results.
- Summarize which pages changed and how the lookup behavior differs.

Do not introduce mock caching or duplicate member lookup logic.
```

### Prompt 8. Slim the Member Health Profile detail payload by section
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
The Member Health Profile detail page still loads too many collections together and adds more cross-domain reads on top, making it one of the heaviest single-member screens in the app.

Scope:
- Domain/workflow: Member Health Profile detail read path
- Canonical entities/tables: member_health_profiles, member_diagnoses, member_medications, member_allergies, member_providers, member_equipment, member_notes, intake_assessments, plus page-level care plan/payor/POF/progress-note reads
- Expected canonical read path: page -> canonical MHP read model/service -> Supabase

Inspect first:
- lib/services/member-health-profiles-supabase.ts
- app/(portal)/health/member-health-profiles/[memberId]/page.tsx
- any nearby tab-aware or section-aware loading patterns already used in the repo

Required approach:
1. Identify which collections are always loaded now and which are actually tab/section specific.
2. Preserve the canonical MHP service boundary.
3. Split or defer the heaviest collections so the initial page load becomes lighter without changing business truth.
4. Keep provider/hospital directory behavior aligned with current UI expectations.
5. Avoid duplicating business rules across page sections.
6. Keep the fix incremental and production-safe.

Validation:
- Run typecheck and report results.
- Describe what became lighter and what heavy reads remain for later.

Do not add mock fallbacks or turn this into a large frontend rewrite.
```

### Prompt 9. Align provider and hospital directory saves to deterministic normalized upserts
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Provider and hospital directory write helpers still use fuzzy `ilike + order(updated_at desc) + limit(1)` matching even though the schema already has normalized unique indexes.

Scope:
- Domain/workflow: Member Health Profile provider/hospital directory saves
- Canonical entities/tables: provider_directory, hospital_preference_directory
- Expected canonical write path: UI -> server action -> MHP write service -> Supabase

Inspect first:
- lib/services/member-health-profiles-write-supabase.ts
- the migrations that define normalized uniqueness for provider and hospital directories

Required approach:
1. Confirm the current fuzzy lookup path and all callers.
2. Preserve Supabase as source of truth and keep one canonical write service boundary.
3. Replace fuzzy match-first behavior with deterministic normalized equality or true upsert semantics aligned to the existing unique indexes.
4. Prevent duplicate directory rows and avoid app-layer ambiguity during saves.
5. Add a migration only if runtime code cannot align cleanly to the current schema.
6. Add narrow regression coverage for duplicate-prevention behavior.

Validation:
- Run typecheck and report results.
- Call out any schema dependency or migration added.

Do not overengineer. Keep this a deterministic write-shape correction.
```

### Prompt 10. Refresh the missing audit artifacts before another implementation pass
```text
Refresh the missing Memory Lane audit artifacts before the next implementation pass.

Problem:
- The repo currently does not contain fresh saved artifacts for:
  - Supabase RLS & Security Audit
  - Schema Migration Safety Audit
  - Shared Resolver Drift Check
  - Idempotency & Duplicate Submission Audit
- The latest saved RPC architecture audit is still from 2026-03-24.
- I do not want guessed product-code fixes based on missing audit output.

What to do:
1. Run or regenerate the missing audits using the repo's canonical audit workflows.
2. Save the artifacts into `docs/audits` with the current run date.
3. If an audit cannot run locally, say exactly why and what env/config/tooling is missing.
4. Summarize only new confirmed findings that still need implementation work.
5. Do not edit product code in this pass unless the audit runner itself is broken and needs a safe fix.

Output:
- exact audit files created or updated
- blocker list for any audit that could not run
- concise list of new confirmed findings only
```

## Fix Priority Order

1. Intake draft POF false-failure after durable create
2. Shared committed-vs-ready contract across staged workflows
3. POF post-sign runner health and readiness enforcement
4. Canonical enrollment packet operational-readiness model
5. Care plan post-sign readiness standardization
6. Sales stage-page and follow-up-dashboard pagination
7. Shared member lookup preload cleanup
8. Member Health Profile detail payload slimming
9. Deterministic provider/hospital directory upserts
10. Refresh missing audit artifacts

## Founder Summary

- There are no newer saved audit artifacts after the March 27 report set, so this run re-reviewed the latest available evidence rather than inventing new findings.
- The smallest clean product fix is still the intake false-failure bug. It is the clearest case where the visible workflow state can contradict durable Supabase truth.
- The broader architecture issue is still staged workflow truth. Memory Lane needs one canonical way to say "committed but follow-up required" across intake, enrollment, signed POF, and care plan workflows.
- The biggest non-code operational risk is still the POF post-sign runner. If the real environment is not configured and monitored correctly, legal signature state can outrun downstream clinical sync.
- Performance priorities remain the same as yesterday's latest audit: sales stage-page pagination first, then repeated member dropdown preloads, then the heavy MHP detail payload.
- I still did not generate guessed RLS, migration-safety, shared-resolver-drift, or idempotency code prompts because fresh saved audit artifacts for those categories are still missing.
