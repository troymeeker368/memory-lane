# Fix Prompt Generator Report
Generated: 2026-03-20

## 1. Issues Detected

Coverage note:
- Reviewed the newest available in-repo reports for:
  - `docs/audits/query-performance-audit-2026-03-20.md`
  - `docs/audits/workflow-simulation-audit-2026-03-20.md`
  - `docs/audits/production-readiness-audit-2026-03-19.md`
  - `docs/audits/acid-transaction-audit-2026-03-19.md`
  - `docs/audits/supabase-schema-compatibility-audit-2026-03-11.md`
- No fresh standalone March 20/19 in-repo reports were present for RLS/security, canonicality sweep, shared resolver drift, shared RPC, or duplicate-submission audits. No new findings were invented for those categories.

### 1. Post-commit event/audit writes still create false failure windows
- Sources: `acid-transaction-audit-2026-03-19.md`
- Violated rules:
  - ACID transaction requirements
  - Workflow state integrity
  - One canonical success boundary per workflow
- Safest fix:
  - Keep the business RPC/service commit as the success boundary.
  - Move required event writes into the transaction or make observability writes best-effort with durable alerting.

### 2. Public POF open flow still lacks compare-and-set protection
- Sources: `acid-transaction-audit-2026-03-19.md`
- Violated rules:
  - ACID transaction requirements
  - Idempotency and replay safety
  - Workflow state integrity
- Safest fix:
  - Add expected-current-state validation in the canonical delivery-state RPC and return explicit no-op/conflict results.

### 3. PRN MAR administration is still not replay-safe
- Sources: `acid-transaction-audit-2026-03-19.md`
- Violated rules:
  - Idempotency and replay safety
  - ACID transaction requirements
  - One canonical write path per workflow
- Safest fix:
  - Add a narrow DB-backed duplicate guard and enforce it in the canonical MAR service path.

### 4. Some server actions still return synthetic success after exceptions
- Sources: `workflow-simulation-audit-2026-03-20.md`
- Violated rules:
  - Explicit failure handling
  - No synthetic success when persistence or required side effects fail
  - Auditability
- Safest fix:
  - Review each flagged catch path and stop returning `ok: true` for required write failures. Use durable warnings only for optional follow-up failures.

### 5. MAR dashboard reads still do reconciliation work on the hot path
- Sources: `query-performance-audit-2026-03-20.md`
- Violated rules:
  - Production readiness
  - Shared RPC/service boundaries
  - Predictable downstream effects
- Safest fix:
  - Keep schedule generation canonical, but move or gate reconciliation off the default read path and add only the smallest needed supporting indexes.

### 6. MHP and MCC index pages still do ensure-on-read work
- Sources: `query-performance-audit-2026-03-20.md`
- Violated rules:
  - Production readiness
  - Shared resolver/service boundaries
  - Supabase-first predictable reads
- Safest fix:
  - Remove per-member ensure writes from page loads, narrow list selects, and backfill missing canonical rows outside the hot path.

### 7. Care plan list reads still have repeated count fan-out and a due-date index gap
- Sources: `query-performance-audit-2026-03-20.md`
- Violated rules:
  - Production readiness
  - Shared service boundaries
  - Maintainability
- Safest fix:
  - Replace repeated count queries with one grouped query or RPC and add the smallest safe `care_plans(next_due_date)` index support if the final query shape still needs it.

### 8. Reporting and staff/activity reads still push too much work into app memory
- Sources: `query-performance-audit-2026-03-20.md`, `production-readiness-audit-2026-03-19.md`, `supabase-schema-compatibility-audit-2026-03-11.md`
- Violated rules:
  - Supabase-first architecture
  - Migration-driven schema alignment
  - Production readiness
- Safest fix:
  - Push more filtering/aggregation into canonical SQL reads, bound unbounded history screens, and add only the confirmed missing index bundle.

## 2. Codex Fix Prompts

### Prompt 1
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Post-commit event/audit writes can still make committed workflows look failed to staff.

Scope:
- Domain/workflow: lead conversion, enrollment packet send, POF send/resend, signed POF post-sign sync, care plan send
- Canonical entities/tables: leads, members, enrollment_packet_requests, pof_requests, physician_orders, care_plans, system_events and related workflow event tables
- Expected canonical write path: UI -> Server Action -> Service Layer -> Supabase

Required approach:
1) Inspect the success boundary first in `lib/services/sales-lead-conversion-supabase.ts`, `lib/services/enrollment-packets.ts`, `lib/services/pof-esign.ts`, `lib/services/physician-orders-supabase.ts`, and `lib/services/care-plan-esign.ts`.
2) Identify which writes are business-critical and which are observability-only follow-up writes.
3) Preserve the existing RPC/service commit as the authoritative business success boundary.
4) Move required event writes into the canonical transaction, or make post-commit observability writes best-effort with durable follow-up alerting.
5) Do not let a failed follow-up insert throw a user-visible workflow failure after the core business record already committed.
6) Update callers only as needed so success/failure semantics stay explicit and consistent.

Validation:
- Run `npm run typecheck` and `npm run build` if the environment permits.
- List changed files and downstream impact.
- Call out any workflow where audit/event persistence truly belongs inside SQL/RPC.

Do not overengineer. Keep one canonical success boundary per workflow.
```

### Prompt 2
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
The public POF open flow can overwrite a newly voided or changed request back to `opened`.

Scope:
- Domain/workflow: POF public token open flow
- Canonical entities/tables: pof_requests
- Expected canonical write path: UI -> Server Action -> Service Layer -> Supabase RPC

Required approach:
1) Inspect `lib/services/pof-esign.ts`, `supabase/migrations/0073_delivery_and_member_file_rpc_hardening.sql`, and `supabase/migrations/0082_fix_pof_delivery_state_rpc_ambiguity.sql`.
2) Keep `rpc_transition_pof_request_delivery_state` as the canonical state-transition boundary.
3) Add compare-and-set protection so callers can require an expected current state before moving a request to `opened`.
4) Update the public-open caller so it does not overwrite requests already voided, declined, expired, or otherwise changed.
5) Return an explicit no-op/conflict result when the state no longer matches.

Validation:
- Run `npm run typecheck` and `npm run build` if the environment permits.
- List changed files and schema impact.
- Report how stale-token opens now behave.

Do not overengineer. Keep this fix inside the canonical RPC path.
```

### Prompt 3
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
PRN MAR documentation still has no duplicate-submission guard, so double-clicks or retries can create duplicate administrations.

Scope:
- Domain/workflow: PRN MAR administration documentation
- Canonical entities/tables: mar_administrations, pof_medications, members
- Expected canonical write path: UI -> Server Action -> Service Layer -> Supabase

Required approach:
1) Inspect `lib/services/mar-workflow.ts`, especially `documentPrnMarAdministration`, plus relevant MAR migrations.
2) Keep the canonical MAR service path authoritative. Do not patch this only in the UI.
3) Add the smallest safe duplicate-protection design that still allows legitimate separate administrations at different times.
4) Prefer a DB-backed safeguard plus service-level validation using the true PRN event identity.
5) Return an explicit duplicate-safe result instead of inserting a second row.

Validation:
- Run `npm run typecheck` and `npm run build` if the environment permits.
- List changed files and any migration/index added.
- Explain how the fix distinguishes accidental replay from a legitimate later PRN administration.

Do not overengineer. The goal is replay safety, not a MAR redesign.
```

### Prompt 4
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Several server actions still return `ok: true` from catch blocks after exceptions, which can report success when required persistence failed.

Scope:
- Domain/workflow: documentation, sales, partner, time, member badge, and incidents action flows
- Canonical entities/tables: discover per action before editing
- Expected canonical write path: UI -> Server Action -> Service Layer -> Supabase

Required approach:
1) Inspect the flagged catch paths in `app/documentation-actions-impl.ts`, `app/sales-lead-actions.ts`, `app/sales-partner-actions.ts`, `app/time-actions.ts`, `app/(portal)/members/[memberId]/name-badge/actions.ts`, and `app/(portal)/documentation/incidents/actions.ts`.
2) For each catch path, classify the failing operation as a required canonical write or an optional secondary effect.
3) If the failing operation is required, return explicit failure and stop reporting success.
4) If it is secondary, keep the main success truthful and replace silent success with a durable warning or follow-up path.
5) Preserve role restrictions, auditability, and canonical service boundaries.

Validation:
- Run `npm run typecheck` and `npm run build` if the environment permits.
- List each changed action and whether it now fails explicitly or records a durable warning.

Do not overengineer. Remove synthetic success without adding UI-side fallback behavior.
```

### Prompt 5
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
`getMarWorkflowSnapshot()` still performs heavy reconciliation work on the hot read path before the MAR dashboard loads.

Scope:
- Domain/workflow: MAR dashboard read model
- Canonical entities/tables: mar_schedules, mar_administrations, pof_medications and related MAR views
- Expected canonical write path: preserve existing MAR generation/write boundaries

Required approach:
1) Inspect `lib/services/mar-workflow.ts`, especially `getMarWorkflowSnapshot()` and the reconciliation path it triggers before reading.
2) Keep MAR schedule generation and sync logic in canonical service/RPC boundaries.
3) Remove or gate reconciliation from the hot read path so routine page loads do not always trigger write-like work.
4) Narrow broad selects to fields the dashboard actually renders where safe.
5) Add the smallest safe supporting indexes needed by the final today/history/PRN query patterns.

Validation:
- Run `npm run typecheck` and `npm run build` if the environment permits.
- List changed files, migration impact, and when reconciliation now runs.

Do not overengineer. This is a targeted read-path hardening pass.
```

### Prompt 6
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
The MHP and MCC index pages still do ensure-on-read work for missing canonical rows and MCC still pulls broader row shapes than the list pages need.

Scope:
- Domain/workflow: shared MHP and Member Command Center index reads
- Canonical entities/tables: members, member_health_profiles, member_command_centers, member_attendance_schedules
- Expected canonical write path: read-only service hardening; preserve existing write paths

Required approach:
1) Inspect `lib/services/member-health-profiles-supabase.ts` and `lib/services/member-command-center-supabase.ts`.
2) Keep one canonical service boundary per read model, but stop doing per-member ensure writes during page load.
3) Replace broad list-view reads with explicit list-view selects where safe.
4) Move missing-row repair into a batched repair path, background task, or RPC-backed backfill instead of page-load fanout.
5) Preserve Supabase as source of truth, current role boundaries, and current downstream data semantics.

Validation:
- Run `npm run typecheck` and `npm run build` if the environment permits.
- List changed files and explain how missing canonical rows are now repaired without blocking page loads.

Do not overengineer. This is a focused hot-path read cleanup.
```

### Prompt 7
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
`getCarePlans()` still performs repeated count fan-out and all-member due-date ordering without full index support.

Scope:
- Domain/workflow: care plan list and dashboard reads
- Canonical entities/tables: care_plans, members, related care plan summary reads
- Expected canonical write path: read-only service hardening; preserve existing write paths

Required approach:
1) Inspect `lib/services/care-plans-supabase.ts`, especially the list query, repeated count queries, and member-name search path.
2) Keep one canonical service boundary for care plan list reads.
3) Replace repeated count fan-out with one grouped query or canonical RPC where practical.
4) Preserve pagination and current filtering behavior.
5) Add the smallest safe forward-only migration support for global all-member due-date ordering if the final query shape still needs it.

Validation:
- Run `npm run typecheck` and `npm run build` if the environment permits.
- List changed files, any migration added, and what summary/count work moved into grouped SQL or RPC.

Do not overengineer. This is a focused care-plan read optimization pass.
```

### Prompt 8
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Admin reporting and staff/activity read paths still pull full date ranges or broad history slices into app memory and still lack some supporting composite indexes.

Scope:
- Domain/workflow: admin reporting, staff detail, and activity snapshot reads
- Canonical entities/tables: billing_invoices, leads, transportation_logs, blood_sugar_logs, member_photo_uploads, ancillary_charge_logs, and related reporting/activity read models
- Expected canonical write path: read-only service hardening; preserve existing write paths

Required approach:
1) Inspect `lib/services/admin-reporting-foundation.ts`, `lib/services/activity-snapshots.ts`, and `lib/services/staff-detail-read-model.ts`.
2) Keep one canonical service boundary per report/read model. Do not scatter SQL into UI pages.
3) Push filtering and aggregation into SQL where practical instead of reading large date ranges into app memory first.
4) Add pagination, bounded windows, or explicit date caps to screens that are effectively unbounded.
5) Add only the smallest forward-only index migration bundle needed for the final confirmed query shapes.

Validation:
- Run `npm run typecheck` and `npm run build` if the environment permits.
- List changed files, any migrations added, and what work moved from app memory into SQL.

Do not overengineer. Focus on the biggest current read amplifiers first.
```

## 3. Fix Priority Order

1. Stop false failures after committed writes
2. Add compare-and-set protection to the POF public open flow
3. Make PRN MAR documentation replay-safe
4. Remove synthetic success from flagged action catch blocks
5. Move MAR reconciliation off the hot read path
6. Remove ensure-on-read behavior from MHP and MCC index pages
7. Simplify care plan list reads and add due-date index support
8. Push reporting and staff/activity read work closer to SQL

## 4. Founder Summary

The highest-risk items are still workflow-truth and replay-safety problems, not UI issues. The March 19 ACID report still points to the same top integrity gaps: false failures after committed writes, stale public POF open transitions, and missing PRN MAR duplicate protection. The March 20 workflow simulation stayed strong overall, but it still surfaced one real trust problem: some server actions continue to return `ok: true` after exceptions.

The strongest new signal from today is performance concentration. The next best production-readiness wins after the integrity fixes are MAR dashboard pre-read reconciliation, MHP/MCC ensure-on-read behavior, care plan list query fan-out, and reporting/staff-history reads that still do too much work in app memory.
