# Fix Prompt Generator Report
Generated: 2026-04-07

## 1. Issues Detected

### Issue 1. Synthetic success paths still exist in server actions
- Architectural rule violated:
  - Do not return synthetic success when persistence or downstream effects fail.
  - Workflow state integrity and ACID durability.
- Why this is still open:
  - The newest workflow simulation report flags multiple `catch` blocks returning `ok: true`, including paths in `app/care-plan-actions.ts`, `app/documentation-actions-impl.ts`, `app/documentation-create-core.ts`, `app/intake-actions.ts`, `app/sales-lead-actions.ts`, `app/sales-partner-actions.ts`, and `app/time-actions.ts`.
- Safest fix approach:
  - Audit each flagged action and change only the cases where a catch is hiding a failed canonical write or failed required side effect.
  - Preserve staged-workflow "committed but follow-up required" results where those are real and already modeled, but stop returning plain success for true failures.

### Issue 2. Intake -> draft POF lifecycle evidence is inconsistent across the latest workflow audits
- Architectural rule violated:
  - One canonical write path per workflow.
  - Shared resolver/service truth must be consistent across consumers and audits.
- Why this is still open:
  - `workflow-simulation-audit-2026-04-07.md` marks Intake -> POF as broken and says `physician_orders` persistence is not evidenced.
  - `workflow-simulation-audit-2026-04-06.md` says direct code review found the canonical RPC-backed path is real.
- Safest fix approach:
  - Treat this as a canonicality/readiness contract gap first, not a UI rewrite.
  - Verify the real path end-to-end, then either fix the broken handoff or tighten shared readiness/result helpers and regression coverage so the workflow cannot be misclassified again.

### Issue 3. Required artifact persistence and milestone notification checks are still weak in workflow handoffs
- Architectural rule violated:
  - Completion claims are forbidden unless required artifacts are saved.
  - Significant lifecycle events must be logged in the service layer.
- Why this is still open:
  - The latest workflow simulation report still calls out:
    - completed enrollment packet artifact persistence
    - intake PDF persistence to `member_files`
    - enrollment milestone notifications
- Safest fix approach:
  - Keep existing canonical flows.
  - Add missing durable verification and explicit follow-up/action-required truth where artifact save or notification persistence is required before a workflow is treated as fully complete.

### Issue 4. Staged workflow readiness is still fragmented across enrollment, intake, POF, and care plan flows
- Architectural rule violated:
  - Shared resolver/service boundaries.
  - Clear handoffs between workflows.
- Why this is still open:
  - The ACID audit still says committed truth versus operational readiness is represented differently across modules.
  - Staff can still misread signed/completed/filed as fully ready when follow-up queues still exist.
- Safest fix approach:
  - Reuse existing readiness fields and queues.
  - Introduce one shared founder-readable readiness vocabulary/helper instead of adding parallel status logic.

### Issue 5. Billing custom invoice creation is still not one fully atomic canonical boundary
- Architectural rule violated:
  - Shared RPC standard for multi-table writes.
  - ACID atomicity for lifecycle-critical billing workflows.
- Why this is still open:
  - Production readiness still flags custom invoice orchestration as partially pre-RPC.
  - `lib/services/billing-custom-invoices.ts` still assembles member reads, payor snapshot data, schedule-derived line items, variable rows, coverage payloads, and source updates before the final RPC call.
- Safest fix approach:
  - Keep the current RPC-backed write boundary authoritative.
  - Move only the remaining workflow-critical pre-write assembly that must be canonical into the RPC or an adjacent canonical DB boundary, without rewriting billing screens.

### Issue 6. MAR reads are still the biggest remaining performance hotspot
- Architectural rule violated:
  - Query performance audit expectations.
  - Shared read boundaries should avoid repeated broad Supabase reads.
- Why this is still open:
  - The finished 2026-04-07 query audit says the main MAR workflow page still loads full organization-wide datasets with no paging or hard cap.
  - The health dashboard still hits `v_mar_today` twice for overlapping slices.
- Safest fix approach:
  - Keep the current UI behavior and medication-safety rules.
  - First consolidate MAR dashboard reads behind one canonical shared read boundary, then decide whether the full MAR page can split first-load queue data from secondary history/on-demand reads.

### Issue 7. Workflow alert de-dupe checks still need one index that matches the real lookup shape
- Architectural rule violated:
  - Migration-driven schema alignment for runtime query behavior.
  - Performance hardening for canonical service-layer alert writes.
- Why this is still open:
  - The finished 2026-04-07 query audit says `recordImmediateSystemAlert` and related alert de-dupe checks still query `system_events` without one index that matches the actual lookup path.
- Safest fix approach:
  - Add the smallest safe forward-only partial index aligned to `event_type='system_alert'`, `status='open'`, `entity_type`, `correlation_id`, and optional `entity_id`.

### Issue 8. MHP provider and hospital directory search still lacks dedicated search indexes
- Architectural rule violated:
  - Query performance audit expectations.
  - Migration-driven schema alignment for runtime query behavior.
- Why this is still open:
  - The finished 2026-04-07 query audit says MHP search now uses targeted search functions, but those searches still rely on `ilike` without trigram indexes on `provider_name` and `hospital_name`.
- Safest fix approach:
  - Add the smallest safe trigram indexes and verify the current targeted search actions keep the same behavior.

### Issue 9. Member list read logic still drifts across Member Directory, MCC index, and MHP index
- Architectural rule violated:
  - Shared resolver/service boundaries.
  - Maintainability and consistent paging/filter/sort behavior.
- Why this is still open:
  - The finished 2026-04-07 query audit still flags duplicated member directory logic across Member Directory, Member Command Center, and MHP index reads.
- Safest fix approach:
  - Prefer the smallest shared read boundary or read-model consolidation that reduces drift without rewriting those screens.

### Issue 10. Linked-project migration parity is still a production-readiness blocker
- Architectural rule violated:
  - Schema/runtime alignment and migration-driven schema.
- Why this is still open:
  - The schema migration safety audit found repo alignment clean but explicitly left deployed migration-history parity unverified.
- Safest fix approach:
  - Repair linked-project migration history and verify the target Supabase project recognizes the committed ordered migrations before treating the repo as fully production-ready.

## 2. Codex Fix Prompts

### Prompt 1. Remove synthetic success in action catch blocks
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Some server actions still return `ok: true` from catch blocks even when canonical persistence or required downstream work failed.

Scope:
- Domain/workflow: care plan, documentation, intake, sales lead, sales partner, and time actions
- Canonical entities/tables: discover per action before editing
- Expected canonical write path: UI -> Server Action -> Service Layer -> Supabase

Required approach:
1) Inspect the exact catch blocks flagged in `docs/audits/workflow-simulation-audit-2026-04-07.md`.
2) Separate true failures from valid staged-workflow results such as "committed but follow-up required".
3) For true failures, stop returning plain success and return an explicit failure or committed-with-follow-up-required result from the canonical service boundary.
4) Do not patch UI only. Keep service-layer truth authoritative.
5) Preserve existing staged readiness fields and queues where they already exist.
6) Add or tighten regression coverage so these actions cannot silently report success after failed persistence.

Validation:
- Run typecheck and build if the environment allows.
- List each changed action and explain whether it now returns failure or staged committed truth.
- Call out any action that still intentionally returns success and why that is safe.

Do not overengineer. Do not add new status systems if a canonical one already exists.
```

### Prompt 2. Resolve the Intake -> draft POF canonicality/readiness conflict
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
The latest workflow simulation report says Intake -> Physician Orders / POF generation is broken and cannot evidence `physician_orders` persistence, but the prior day’s direct code review says the canonical RPC-backed path is real. Resolve the actual gap instead of papering over the audit.

Scope:
- Domain/workflow: intake post-sign -> draft physician order creation
- Canonical entities/tables: `intake_assessments`, `physician_orders`, intake follow-up queues
- Expected canonical write path: UI -> Server Action -> Service Layer -> RPC/Service -> Supabase

Required approach:
1) Inspect the end-to-end path starting with `app/intake-actions.ts`, `lib/services/intake-pof-mhp-cascade.ts`, and `lib/services/physician-orders-supabase.ts`.
2) Confirm whether `createDraftPhysicianOrderFromAssessment` and `rpc_create_draft_physician_order_from_intake` are the true canonical boundary.
3) If the runtime handoff is actually broken, fix the canonical service path so draft POF creation persists to `physician_orders`.
4) If persistence is already correct, fix the shared readiness/result contract or regression coverage so the workflow is not misclassified and downstream consumers do not infer readiness from signature alone.
5) Preserve Supabase-first behavior and avoid duplicate write paths from the editor/new-page flow.

Validation:
- Show the canonical write path you confirmed.
- Add regression coverage for signed intake -> draft POF persistence and follow-up-required truth.
- Report changed files and downstream impact on POF/MHP/MCC.
```

### Prompt 3. Harden artifact persistence and milestone notification truth
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Workflow simulation still flags weak completion checks around completed enrollment packet artifacts, intake PDF member-file persistence, and enrollment milestone notifications.

Scope:
- Domain/workflow: enrollment packet completion, intake post-sign artifact persistence, enrollment lifecycle notifications
- Canonical entities/tables: `member_files`, `enrollment_packet_requests`, `enrollment_packet_signatures`, `intake_assessments`, `system_events`, `user_notifications`
- Expected canonical write path: UI -> Server Action -> Service Layer -> Supabase

Required approach:
1) Inspect the current service boundaries for completed packet artifact saving, intake PDF saving, and milestone notification creation.
2) Preserve current workflow commits, but make fully-complete status depend on durable artifact persistence when the architecture contract requires it.
3) If a required artifact or notification write can lag or fail, return explicit follow-up-required truth instead of plain completion.
4) Keep lifecycle event logging in the service layer only.
5) Add regression coverage for:
   - completed packet artifact saved to `member_files`
   - intake PDF saved to `member_files`
   - enrollment milestone notification emitted only after durable success

Validation:
- Run typecheck and report results.
- Show which completion states changed and why.
- List manual retest steps for packet completion, intake signing, and notification visibility.
```

### Prompt 4. Unify staged workflow readiness vocabulary
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Enrollment, intake, signed POF, and care plan workflows still expose committed-vs-ready truth in different shapes, which makes downstream screens and staff handoffs inconsistent.

Scope:
- Domain/workflow: staged workflow readiness across enrollment packet, intake, POF post-sign, and care plan post-sign flows
- Canonical entities/tables: discover current readiness columns, follow-up queues, and shared helper files first
- Expected canonical write path: existing workflow writes remain unchanged; shared resolver/readiness helpers become authoritative for read-side truth

Required approach:
1) Inspect current shared readiness helpers such as `lib/services/committed-workflow-state.ts`, `lib/services/intake-post-sign-readiness.ts`, and the equivalent enrollment/care plan/POF helpers.
2) Reuse existing Supabase-backed readiness fields and queues. Do not replace them with in-memory logic.
3) Introduce one shared founder-readable readiness vocabulary for:
   - committed
   - operationally ready
   - follow-up required / queued degraded
4) Update only the necessary server actions and staff-facing read paths to use that shared truth.
5) Preserve legal/document signature state separately from downstream operational readiness.

Validation:
- Show the final shared readiness vocabulary.
- List the screens/actions updated to use it.
- Call out any workflow intentionally left on a narrower local helper and why.
```

### Prompt 5. Finish the billing custom-invoice atomic boundary
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Billing custom invoice creation still assembles too much workflow-critical state in service code before the final RPC write boundary, so the workflow is not fully atomic end-to-end.

Scope:
- Domain/workflow: custom invoice creation
- Canonical entities/tables: `billing_invoices`, `billing_invoice_lines`, `billing_coverages`, source billing tables used for custom invoice materialization
- Expected canonical write path: UI -> Server Action -> Service Layer -> RPC -> Supabase

Required approach:
1) Inspect the full custom invoice flow starting with the payor actions and `lib/services/billing-custom-invoices.ts`.
2) Identify which pre-RPC assembly work is still part of the canonical billing transaction boundary versus which reads can safely stay in service code.
3) Move only the workflow-critical pieces needed for true atomicity into the canonical DB/RPC boundary.
4) Preserve current invoice behavior, numbering rules, and billing snapshots unless a change is required to make the transaction safe.
5) Do not create a parallel billing write path.

Validation:
- Run typecheck and build if the environment permits.
- Explain what moved into the canonical atomic boundary and what intentionally stayed outside.
- List schema impact and downstream billing/reporting effects.
```

### Prompt 6. Consolidate MAR dashboard and workflow reads
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
MAR is still the clearest remaining performance hotspot. The health dashboard reads `v_mar_today` twice for overlapping slices, and the main MAR workflow page still loads broad organization-wide datasets with no first-load containment.

Scope:
- Domain/workflow: MAR dashboard and MAR workflow read paths
- Canonical entities/tables/views: `v_mar_today`, `v_mar_overdue_today`, `v_mar_not_given_today`, related MAR read services
- Expected canonical path: shared read model/service -> Supabase

Required approach:
1) Inspect the current read paths in `lib/services/mar-workflow-read.ts`, `lib/services/health-dashboard.ts`, and `lib/services/mar-dashboard-read-model.ts`.
2) Build one canonical read boundary so the health dashboard stops querying overlapping MAR views separately.
3) Audit whether the main MAR page truly needs all organization-wide rows on first load. If safe, split first-load queue reads from secondary/on-demand reads.
4) Preserve current UI behavior and medication safety rules. Do not move MAR business logic into components.

Validation:
- Show the before/after read boundary.
- Confirm no medication-state behavior changed.
- Report changed files and any tradeoff around first-load data shape.
```

### Prompt 7. Add the missing `system_events` open-alert lookup index
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Workflow alert de-dupe checks still do not have one index that matches the real open-alert lookup shape in `workflow-observability.ts`.

Scope:
- Domain/workflow: system alert de-dupe writes
- Canonical entities/tables: `system_events`
- Expected canonical write path: service layer -> Supabase

Required approach:
1) Inspect the alert de-dupe queries in `lib/services/workflow-observability.ts`.
2) Add the smallest safe forward-only migration for a partial index matching open system-alert lookups.
3) Keep current alert semantics and dedupe logic unchanged.
4) Do not broaden the index beyond what the real lookup path needs.

Validation:
- Show the migration file added.
- Confirm no business logic changed.
- Note any downstream alert-write paths that now benefit from the index.
```

### Prompt 8. Add safe trigram indexes for MHP directory search
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
MHP provider and hospital search now uses targeted lookup functions, but those searches still rely on `ilike` without dedicated trigram indexes.

Scope:
- Domain/workflow: Member Health Profile directory search
- Canonical entities/tables: `provider_directory`, `hospital_preference_directory`
- Expected canonical path: migration-driven search hardening only

Required approach:
1) Inspect the current targeted search paths in `lib/services/member-health-profiles-supabase.ts`.
2) Add the smallest safe forward-only migrations for:
   - `provider_directory.provider_name` trigram search
   - `hospital_preference_directory.hospital_name` trigram search
3) Preserve current search behavior and permissions.
4) Do not rewrite the search UI if the current service path is already canonical.

Validation:
- Show the migration file(s) added.
- Confirm MHP directory search behavior stays the same.
- Note any `pg_trgm` requirement if it is not already present in the repo.
```

### Prompt 9. Consolidate member list read boundaries
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Member Directory, Member Command Center index, and MHP index still solve paging/search/sort in separate service paths, which increases read drift and makes future optimization harder.

Scope:
- Domain/workflow: member list/index reads
- Canonical entities/tables: discover current member list services first
- Expected canonical read path: shared read model/service -> Supabase

Required approach:
1) Inspect the current read paths in the member directory, MCC index, and MHP index services.
2) Identify the smallest shared read boundary that can own common paging, search, and sort behavior without a large rewrite.
3) Preserve current role restrictions and screen-specific presentation behavior.
4) Do not move business rules into components.

Validation:
- Show the shared boundary introduced or tightened.
- List affected consumers.
- Call out any intentionally retained differences between the screens.
```

### Prompt 10. Repair linked Supabase migration parity
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
The repo’s migration ordering looks clean, but production readiness is still blocked until the linked Supabase project confirms the committed migration history and applied state match.

Scope:
- Domain/workflow: Supabase migration history / linked project integrity
- Canonical entities/tables: discover from migration history and linked project state
- Expected canonical write path: migration-driven schema only

Required approach:
1) Inspect the current local migration sequence and the repo audit note in `docs/audits/schema-migration-safety-audit-2026-04-02.md`.
2) Verify linked project history against the committed migration files without editing runtime code first.
3) Repair remote migration-history mismatch using the safest forward-only process available for Supabase.
4) Re-run the schema migration safety checks after repair and confirm runtime tables, RPCs, and storage bucket usage still align.

Validation:
- Report exact linked-project mismatch found.
- List commands run and their outcome.
- Call out anything still blocked by environment or Supabase auth.
```

## 3. Fix Priority Order
1. Synthetic success catch blocks.
2. Intake -> draft POF canonicality/readiness conflict.
3. Artifact persistence and milestone notification truth.
4. Shared staged-workflow readiness vocabulary.
5. Billing custom-invoice atomic boundary.
6. MAR read consolidation and payload containment.
7. `system_events` open-alert lookup index.
8. MHP directory search trigram indexes.
9. Member list read-boundary consolidation.
10. Linked-project migration parity.

## 4. Founder Summary
- The finished audit set shifted the performance work. Several items I carried last time are now closed by the later 2026-04-07 query audit: the billing `invoice_date` index, operational reliability snapshot RPC, POF expiry reconciliation RPC, and the earlier MHP full-directory overfetch concern are already improved in-tree.
- The highest-signal open issues now are not "add more infrastructure." They are:
  - stop synthetic success
  - make staged workflow truth consistent
  - tighten artifact-persistence truth
  - finish the remaining billing atomicity debt
  - close the remaining MAR and alert/index performance gaps
- One important conflict needs careful handling: the April 7 workflow simulation marks Intake -> POF as broken, but the April 6 report says direct code review found the canonical RPC-backed path. That should be treated as a verify-and-fix prompt, not accepted blindly as missing persistence.
