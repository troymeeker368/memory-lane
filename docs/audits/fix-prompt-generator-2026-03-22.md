# Fix Prompt Generator Report
Generated: 2026-03-22

## 1. Issues Detected

Coverage note:
- Reviewed the newest available in-repo reports for:
  - `docs/audits/acid-transaction-audit-2026-03-22.md`
  - `docs/audits/production-readiness-audit-2026-03-22.md`
  - `docs/audits/query-performance-audit-2026-03-22.md`
  - `docs/audits/workflow-simulation-audit-2026-03-22.md`
  - `docs/audits/supabase-schema-compatibility-audit-2026-03-11.md` as the latest in-repo schema-alignment / migration-safety artifact
- No fresh standalone in-repo markdown reports were present for:
  - Supabase RLS & Security Audit
  - Daily Canonicality Sweep
  - Shared Resolver Drift Check
  - Shared RPC Architecture Audit
  - Idempotency & Duplicate Submission Audit
- The 2026-03-22 Production Readiness Audit did not identify new code regressions. Its only open items are sandbox-only validation blockers (`build`, `quality:gates`, `db:check`, `reseed`), so those are not included below as Codex implementation prompts.
- The older 2026-03-11 schema audit is not treated as proof of current regressions unless the issue is also consistent with newer repo evidence.

### 1. Care plan public caregiver status can move backward after a newer committed state
- Sources:
  - `acid-transaction-audit-2026-03-22.md`
- Violated rules:
  - ACID transaction requirements
  - Workflow state integrity
  - Idempotency / replay safety
  - No synthetic or contradictory lifecycle truth
- Why this matters:
  - A stale public care plan page load can still write `viewed` or `expired` after the care plan has already been signed.
  - That can overwrite the canonical legal/operational truth.
- Safest fix:
  - Harden the Supabase RPC with compare-and-set guards and treat `signed` as terminal for public-link transitions.

### 2. Care plan sign/finalize flow is still operationally partial after signature commit
- Sources:
  - `acid-transaction-audit-2026-03-22.md`
  - `workflow-simulation-audit-2026-03-22.md`
- Violated rules:
  - ACID durability
  - Clear workflow handoffs
  - Explicit state transitions
- Why this matters:
  - Nurse sign-off can commit before version snapshot persistence or caregiver dispatch is fully complete.
  - The code is explicit about failure, but staff still lack durable staged readiness states.
- Safest fix:
  - Keep the current staged design, but formalize post-sign follow-up as durable explicit states owned by the service layer.

### 3. Enrollment packet lead-activity logging is still best-effort after send and complete
- Sources:
  - `workflow-simulation-audit-2026-03-22.md`
- Violated rules:
  - System event logging
  - Auditability
  - Clear handoffs between workflows
- Why this matters:
  - Packet send/completion can succeed while `lead_activities` silently drifts from the real lifecycle history.
- Safest fix:
  - Add a canonical repairable sync status or follow-up queue for enrollment-related lead-activity writes instead of relying on best-effort inserts after commit.

### 4. Action-required notifications are still non-blocking and easy to miss
- Sources:
  - `workflow-simulation-audit-2026-03-22.md`
- Violated rules:
  - Workflow state integrity
  - Clear operational ownership
  - Auditability
- Why this matters:
  - Real workflow completion can happen without the alert that tells staff to act next.
- Safest fix:
  - Preserve non-blocking notification delivery, but add a durable action-required record or queue for high-severity milestone failures so required follow-up does not depend on a transient notification send.

### 5. Signed POF downstream sync truth is still too easy to miss in staff workflows
- Sources:
  - `workflow-simulation-audit-2026-03-22.md`
- Violated rules:
  - Workflow truth must match downstream readiness
  - Clear handoffs between clinical workflows
  - Canonical service state should remain authoritative
- Why this matters:
  - Public signing already returns queued retry status, but staff can still treat a signed POF as fully operational before MHP/MAR sync finishes.
- Safest fix:
  - Surface the existing canonical post-sign sync status in staff-facing MCC/MAR entry points instead of only on the public confirmation screen.

### 6. MAR page reads still perform write-like reconciliation and PRN sync on normal page load
- Sources:
  - `query-performance-audit-2026-03-22.md`
- Violated rules:
  - Production readiness
  - One canonical write path per workflow
  - Maintainable service boundaries
- Why this matters:
  - `getMarWorkflowSnapshot()` still triggers sync work on reads, and schedule reconciliation fans out one RPC per member on page load.
- Safest fix:
  - Move reconciliation and PRN sync behind an explicit refresh path, freshness guard, or background job while preserving the existing canonical write boundary.

### 7. MAR monthly report member options still scan four operational tables in Node
- Sources:
  - `query-performance-audit-2026-03-22.md`
- Violated rules:
  - Production readiness
  - Shared resolver/service performance consistency
  - Canonical read-model discipline
- Why this matters:
  - Member-option loading walks medication and administration tables without date bounds, distinct SQL shaping, or pagination.
- Safest fix:
  - Replace the Node-side merge with one canonical SQL/RPC-backed member-options read model.

### 8. Dashboard and activity reads still over-fetch and rely on incomplete index support
- Sources:
  - `query-performance-audit-2026-03-22.md`
- Violated rules:
  - Production readiness
  - Migration-driven schema support for real query shapes
  - Shared read-model consistency
- Why this matters:
  - Progress notes still page in app memory, dashboard care-alerts read the full active census, and activity/detail screens still use many wide or repeated queries without all matching staff/date indexes.
- Safest fix:
  - Move paging and summary shaping into SQL/RPC, trim payload width in canonical services, and add only the confirmed supporting indexes.

## 2. Codex Fix Prompts

### Prompt 1
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Care plan public caregiver status can still move backward from a newer committed state because stale public loads can write `viewed` or `expired` after the care plan is already signed.

Scope:
- Domain/workflow: care plan public caregiver e-sign open / expiry / final sign
- Canonical entities/tables: care_plans, care_plan_signature_events, member_files, rpc_transition_care_plan_caregiver_status
- Expected canonical write path: Public page -> server action/service -> Supabase RPC -> durable state/artifacts

Required approach:
1) Inspect `lib/services/care-plan-esign-public.ts`, `lib/services/care-plan-esign.ts`, and `supabase/migrations/0073_delivery_and_member_file_rpc_hardening.sql`.
2) Confirm every place that calls `transitionCarePlanCaregiverStatus` and identify which states are currently allowed to overwrite newer states.
3) Harden the RPC with compare-and-set / expected-current-state guards for `viewed` and `expired`.
4) Treat `signed` as terminal for public-link status updates.
5) Preserve the existing canonical service and RPC boundary. Do not patch this only in the UI or page layer.
6) Make failed backward transitions explicit and safe for replayed/stale requests.

Validation:
- Run `npm run typecheck` and `npm run build` if the environment permits.
- List changed files and the final allowed transition matrix.
- Explain how stale public requests now fail without corrupting canonical status.

Do not overengineer. Keep the fix narrow, transactional, and auditable.
```

### Prompt 2
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Care plan sign/finalize workflows are still operationally partial after signature commit because version snapshot persistence and caregiver dispatch can fail later without a durable staged readiness state.

Scope:
- Domain/workflow: care plan create / review / nurse sign / caregiver dispatch
- Canonical entities/tables: care_plans, care_plan_versions, care_plan_review_history, care_plan_signature_events, any existing follow-up/action-required state fields
- Expected canonical write path: UI -> server action -> care plan service/RPC -> Supabase

Required approach:
1) Inspect `lib/services/care-plans-supabase.ts` focusing on `createCarePlan` and `reviewCarePlan`.
2) Preserve the current staged design and explicit repair behavior. Do not force a large rewrite if the workflow should remain staged.
3) Add durable explicit readiness states for post-sign follow-up such as snapshot pending and caregiver dispatch pending, or the closest equivalent that fits the existing schema.
4) Ensure those states are owned by the canonical service layer and remain truthful until the downstream step actually succeeds.
5) Update only the minimum read surfaces needed so staff can distinguish legally signed from fully operationally complete.
6) If schema support is missing, add a forward-only migration.

Validation:
- Run `npm run typecheck` and `npm run build` if the environment permits.
- List changed files, any migration added, and the final readiness states.
- Explain downstream effect on caregiver send/readiness views.

Do not overengineer. This is a staged-workflow hardening pass, not a care-plan redesign.
```

### Prompt 3
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Enrollment packet send/completion still writes `lead_activities` as best-effort follow-up, so sales history can drift from the real packet lifecycle.

Scope:
- Domain/workflow: enrollment packet send and public completion -> sales activity history
- Canonical entities/tables: enrollment_packet_requests, enrollment_packet_events, lead_activities, any workflow follow-up queue/status table you determine is canonical
- Expected canonical write path: UI -> server action -> enrollment packet service -> Supabase

Required approach:
1) Inspect `lib/services/enrollment-packet-mapping-runtime.ts`, `lib/services/enrollment-packets-send-runtime.ts`, and `lib/services/enrollment-packets-public-runtime.ts`.
2) Confirm every path where enrollment packet lifecycle writes try to insert `lead_activities`.
3) Keep the packet workflow authoritative and avoid blocking the main packet commit on optional activity history if that would be too risky.
4) Add one canonical repairable follow-up path so failed lead-activity writes are durably tracked and can be retried or surfaced, instead of disappearing as best-effort drift.
5) Keep business-rule ownership in shared services. Do not add page-level duplicate logic.
6) Make the resulting workflow truth visible enough that staff can see when packet progress succeeded but activity sync still needs repair.

Validation:
- Run `npm run typecheck` and `npm run build` if the environment permits.
- List changed files, any migration impact, and how failed activity sync is now persisted.
- Explain what sales staff can inspect when the packet is real but lead activity history is not yet caught up.

Do not overengineer. Prefer a small durable sync-status/follow-up fix over a broad lifecycle rewrite.
```

### Prompt 4
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
High-severity workflow notifications are still non-blocking, so action-required events can be real in Supabase while the inbox alert is missed.

Scope:
- Domain/workflow: lifecycle milestones and action-required follow-up
- Canonical entities/tables: workflow/system events, user_notifications, and any action-required queue/status table already used or needed
- Expected canonical write path: service milestone logic -> canonical follow-up persistence -> notification dispatch

Required approach:
1) Inspect `lib/services/lifecycle-milestones.ts` and `lib/services/notifications.ts`.
2) Identify which milestone categories are truly action-required and cannot rely only on best-effort notification dispatch.
3) Preserve non-blocking notification infrastructure for normal alerts, but add durable canonical follow-up persistence for high-severity action-required milestones.
4) Ensure the service layer, not the UI, owns that durable follow-up state.
5) Fail explicitly when recipient resolution or required schema is missing instead of silently pretending the follow-up was delivered.
6) Reuse any existing action-required queue/patterns if the repo already has one.

Validation:
- Run `npm run typecheck` and `npm run build` if the environment permits.
- List changed files and which milestone types now create durable follow-up records.
- Explain how this affects operations visibility when notification delivery fails.

Do not overengineer. The goal is durable operational ownership, not a notification-system rewrite.
```

### Prompt 5
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Signed POF downstream sync truth exists, but staff workflows can still miss it and assume MHP/MAR readiness too early.

Scope:
- Domain/workflow: signed POF -> MHP refresh -> MAR generation -> staff-facing readiness surfaces
- Canonical entities/tables: physician_orders / POF records, post-sign retry state, member health profiles, MAR readiness surfaces
- Expected canonical write path: public signing -> canonical service/RPC -> Supabase; staff reads should surface canonical state, not duplicate it

Required approach:
1) Inspect `lib/services/pof-esign-public.ts`, `lib/services/physician-orders-supabase.ts`, and the staff-facing MCC/MAR entry points that consume signed-POF status.
2) Preserve the existing replay-safe signing and post-sign sync path.
3) Identify the minimum staff-facing read surfaces that should show `postSignStatus`, retry state, or action-needed messaging.
4) Surface the existing canonical status in those staff views instead of adding a second readiness calculation.
5) Keep the source of truth in the shared service/resolver layer. Do not duplicate business rules in React components.
6) Make signed-but-still-syncing state plainly visible so staff do not treat it as fully ready.

Validation:
- Run `npm run typecheck` and `npm run build` if the environment permits.
- List changed files and the surfaces that now show queued/failed post-sign sync.
- Explain what staff will see when a POF is legally signed but MHP/MAR sync is still pending.

Do not overengineer. This is a staff-visibility truth fix, not a new workflow.
```

### Prompt 6
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
MAR read paths still do write-like reconciliation and PRN sync on normal page loads, creating repeated RPC fan-out and mixing read behavior with maintenance work.

Scope:
- Domain/workflow: MAR page and workflow snapshot reads
- Canonical entities/tables: MAR schedules, medication orders, PRN sync state, any freshness marker already used by the service
- Expected canonical write path: explicit action/job/service maintenance path -> Supabase; read path should stay read-oriented

Required approach:
1) Inspect `app/(portal)/health/mar/page.tsx` and `lib/services/mar-workflow-read.ts`.
2) Confirm exactly where page load triggers `syncTodayMarSchedules()` and PRN sync work.
3) Preserve Supabase as source of truth and preserve the existing canonical reconciliation/sync service boundary.
4) Move that work behind the smallest safe alternative: an explicit refresh action, a freshness guard, or a background/job-style path already consistent with the repo.
5) Keep normal reads fast and deterministic without silently skipping required maintenance forever.
6) Avoid introducing duplicate write paths or UI-owned business logic.

Validation:
- Run `npm run typecheck` and `npm run build` if the environment permits.
- List changed files and what now triggers reconciliation/PRN sync.
- Explain how the MAR page read path is lighter after the fix.

Do not overengineer. Keep the change focused on separating reads from maintenance work.
```

### Prompt 7
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
`getMarMonthlyReportMemberOptions()` still scans four operational tables in Node just to build a member dropdown, which will get slower as the system grows.

Scope:
- Domain/workflow: MAR monthly report member-option loading
- Canonical entities/tables: pof_medications, mar_administrations, medication_orders, med_administration_logs, and the final distinct member-options result
- Expected canonical write path: read-only improvement through canonical SQL/RPC-backed service logic

Required approach:
1) Inspect `lib/services/mar-monthly-report.ts` and any overlapping MAR member-option logic in `lib/services/mar-workflow-read.ts`.
2) Identify the canonical business rule for who should appear in the monthly MAR member selector.
3) Replace the Node-side multi-table scan/merge with one canonical SQL view or RPC that returns distinct eligible members directly from Supabase.
4) Reuse that same canonical member-options path anywhere else the MAR page currently duplicates this logic.
5) Keep the output contract stable unless a small contract cleanup is required to remove drift.
6) If the SQL path needs support, add a forward-only migration.

Validation:
- Run `npm run typecheck` and `npm run build` if the environment permits.
- List changed files, any migration added, and which page surfaces now share the same member-options source.
- Explain why the new SQL/RPC path is safer and cheaper than the old Node scan.

Do not overengineer. This is one canonical read-model fix.
```

### Prompt 8
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Dashboard, progress-note, and activity/detail reads still over-fetch, page in app memory, and lack some supporting staff/date indexes for the query shapes the app already uses.

Scope:
- Domain/workflow: health dashboard, progress notes dashboard, activity snapshots, member detail, staff detail
- Canonical entities/tables: progress notes, active member census, MCC/MHP alert reads, daily_activity_logs, toilet_logs, shower_logs, transportation_logs, intake_assessments, lead_activities, and any other confirmed history tables in scope
- Expected canonical write path: read-only service hardening plus forward-only migration support

Required approach:
1) Inspect `lib/services/health-dashboard.ts`, `lib/services/progress-notes-read-model.ts`, `lib/services/activity-snapshots.ts`, `lib/services/member-detail-read-model.ts`, and `lib/services/staff-detail-read-model.ts`.
2) Move pagination and summary shaping into SQL/RPC where the current service still loads full result sets into Node.
3) Trim payload width in canonical read services so screens stop using `select('*')` where the UI only needs a small subset.
4) Add only the confirmed missing indexes that match the retained query shapes, especially staff/date indexes called out in the March 22 audit.
5) Keep pages calling shared services; do not move query logic into route/page files.
6) If two read paths on the same page do the same member-option or timeline work, consolidate the highest-overlap path without turning this into a repo-wide refactor.

Validation:
- Run `npm run typecheck` and `npm run build` if the environment permits.
- List changed files, any migration added, and which queries now page in SQL instead of app memory.
- Explain remaining intentional broad reads, if any.

Do not overengineer. Focus on the worst confirmed read costs first.
```

## 3. Fix Priority Order

1. Harden care plan caregiver public-link transitions with compare-and-set guards.
2. Add durable staged readiness states for care plan post-sign follow-up.
3. Make enrollment packet lead-activity sync durable and repairable.
4. Add durable action-required ownership when notification dispatch fails for critical milestones.
5. Surface signed-POF queued downstream sync status in staff-facing workflows.
6. Stop MAR reads from triggering reconciliation and PRN sync on every page load.
7. Replace MAR monthly report member-option table scans with one canonical SQL/RPC path.
8. Move dashboard/progress-note/activity paging into SQL and add the remaining confirmed indexes.

## 4. Founder Summary

The March 22 audits are materially cleaner than earlier runs. Production-readiness did not find new code-level canonicality regressions in the audited domains, and the biggest remaining issues are now concentrated in a smaller set of workflow-truth and performance problems instead of broad platform instability.

The top production-risk fix is now the care plan public-link state machine. After that, the main architecture gaps are operational truth and handoff visibility: care-plan post-sign readiness still needs explicit staged states, enrollment packet sales activity can still drift after real packet progress, and action-required notifications still need a durable ownership path when delivery fails. The rest of the queue is mostly performance hardening, especially MAR read-path fan-out, the monthly MAR member-options scan, and dashboard/app-memory pagination.
