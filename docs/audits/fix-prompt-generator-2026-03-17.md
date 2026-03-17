# Fix Prompt Generator Report
Generated: 2026-03-17

## Issues Detected

### 1. Enrollment packet `filed` status still overstates operational completion
- Audit sources:
  - `docs/audits/workflow-simulation-audit-2026-03-17.md`
  - `docs/audits/referential-integrity-cascade-audit-2026-03-17.md`
  - `docs/audits/production-readiness-audit-2026-03-15.md`
- Architectural rule violated:
  - Workflow state integrity
  - Shared resolver / service boundaries
  - ACID transaction requirements
- Why this is still open:
  - The packet can be durably filed while `mapping_sync_status` is still `pending` or `failed`, so downstream users can treat the packet as complete before MCC/MHP/contact/POF staging sync is actually done.
- Safest fix approach:
  - Keep the current filing RPC as the canonical write boundary.
  - Add one canonical readiness resolver/service contract for "filed and downstream-mapped".
  - Update downstream consumers to use that readiness contract instead of raw `status = 'filed'`.

### 2. Signed intake can still exist without a usable draft POF
- Audit sources:
  - `docs/audits/workflow-simulation-audit-2026-03-17.md`
  - `docs/audits/referential-integrity-cascade-audit-2026-03-17.md`
  - `docs/audits/production-readiness-audit-2026-03-15.md`
- Architectural rule violated:
  - Workflow state integrity
  - Shared RPC standard
  - ACID transaction requirements
- Why this is still open:
  - Intake creation, signature finalization, and draft POF creation each have stronger boundaries now, but the full clinical handoff still spans multiple steps. `signature_status = 'signed'` can coexist with `draft_pof_status = 'pending'` or `failed`.
- Safest fix approach:
  - Preserve the current RPCs.
  - Make one canonical intake readiness contract that clearly distinguishes "assessment signed" from "draft POF ready".
  - Route all UI status and downstream readers through that contract instead of inferring readiness from signed state alone.

### 3. Signed POF still does not mean downstream clinical sync is ready
- Audit sources:
  - `docs/audits/workflow-simulation-audit-2026-03-17.md`
  - `docs/audits/referential-integrity-cascade-audit-2026-03-17.md`
  - `docs/workflow-hardening-rollout.md`
- Architectural rule violated:
  - Workflow state integrity
  - Shared resolver / service boundaries
  - Canonical resolver path for derived business logic
- Why this is still open:
  - The retry runner is now wired in-repo, but `physician_orders.status = 'signed'` can still coexist with queued post-sign sync. Any consumer that treats signed as fully synced can present false-ready MHP/MAR state.
- Safest fix approach:
  - Preserve the existing signed-state RPC and retry runner.
  - Add one canonical clinical-readiness resolver that only returns ready when post-sign sync has completed.
  - Update dashboards and downstream readers to depend on that resolver, not raw signed status.

### 4. Care plans still have no canonical diagnosis relation
- Audit sources:
  - `docs/audits/referential-integrity-cascade-audit-2026-03-17.md`
- Architectural rule violated:
  - Schema drift prevention
  - Canonical entity identity
  - Migration-driven schema alignment
- Why this is still open:
  - Diagnoses exist on the member side, but care plans do not persist a canonical relation to the diagnoses they rely on. That leaves diagnosis references unauditable and not FK-protected.
- Safest fix approach:
  - Add a forward-only migration for a canonical join table.
  - Backfill conservatively.
  - Update care-plan services to write diagnosis linkage through the canonical service layer.

### 5. Enrollment packet completion still swallows lead-activity write failures
- Audit sources:
  - `docs/audits/workflow-simulation-audit-2026-03-17.md`
- Architectural rule violated:
  - System event logging
  - Explicit failure handling
  - No synthetic success when required downstream effects fail
- Why this is still open:
  - Packet completion tries to write `lead_activities`, but failures are only logged to console. Sales activity views can silently drift from the canonical packet lifecycle.
- Safest fix approach:
  - Keep packet completion durable even if lead activity is a secondary effect.
  - Replace console-only failure handling with a canonical alert or retry path so the drift is visible and repairable.

### 6. MAR milestone events still do not reach `user_notifications`
- Audit sources:
  - `docs/audits/workflow-simulation-audit-2026-03-17.md`
- Architectural rule violated:
  - Shared resolver / service boundaries
  - Canonical event-to-notification mapping
- Why this is still open:
  - MAR services emit milestone events such as `mar_administration_documented`, but notification canonicalization does not map those event names into inbox notification types.
- Safest fix approach:
  - Keep milestone emission where it is.
  - Extend the shared notification mapping layer so MAR events flow into the existing `user_notifications` path without adding duplicate notification logic in UI or actions.

### 7. Mock-era runtime dependencies still remain in production-adjacent code paths
- Audit sources:
  - `docs/audits/supabase-schema-compatibility-audit-2026-03-11.md`
  - `docs/audits/supabase-schema-audit-data.json`
- Architectural rule violated:
  - Supabase source of truth
  - Mock data boundaries
  - No runtime split-brain
- Why this is still open:
  - The schema audit still flags mock runtime references in operational/admin files, including sales and reporting paths. Even if not currently hit often, they are a production canonicality risk.
- Safest fix approach:
  - Inspect the flagged files from the schema audit data.
  - Remove mock imports or quarantine them to test/dev-only code paths.
  - Ensure all important runtime reads/writes stay backed by canonical Supabase services.

## Codex Fix Prompts

### Prompt 1. Enrollment packet readiness semantics
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Enrollment packets can be marked/filed while downstream mapping is still pending or failed, so downstream screens can treat the packet as operationally complete too early.

Scope:
- Domain/workflow: Enrollment packet completion -> downstream mapping -> member operational readiness
- Canonical entities/tables: enrollment_packet_requests, enrollment_packet_mapping_runs, enrollment_packet_mapping_records, member_files
- Expected canonical write path: UI -> Server Action -> Service Layer -> Supabase

Required approach:
1) Inspect the current packet completion path end-to-end, starting with `lib/services/enrollment-packets.ts` and the downstream mapping services/resolvers it calls.
2) Preserve the existing filing/finalization RPC as the canonical write boundary. Do not move business writes into UI code.
3) Add one canonical readiness resolver/service contract that distinguishes:
   - caregiver submitted / packet filed
   - downstream mapping complete and operationally ready
4) Update only the downstream consumers that currently over-read `status = 'filed'` so they use the canonical readiness contract instead.
5) Keep failures explicit. Do not add fallback success states. If mapping is pending/failed, the readiness contract must say so clearly.
6) Preserve current auditability and role restrictions.

Validation:
- Run `npm run typecheck` and report results.
- List changed files and downstream impact.
- Call out any blocker if a new derived field/view/function is needed in Supabase.

Do not overengineer. Do not rewrite the enrollment workflow. Keep the filing RPC authoritative and make lifecycle truth clearer.
```

### Prompt 2. Intake signed-vs-draft-POF truth
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
A signed intake assessment can still exist without a successfully created draft POF, but downstream code can easily misread signed state as POF-ready.

Scope:
- Domain/workflow: Intake assessment -> signature finalization -> draft physician order creation
- Canonical entities/tables: intake_assessments, intake_assessment_signatures, physician_orders
- Expected canonical write path: UI -> Server Action -> Service Layer -> Supabase

Required approach:
1) Inspect the end-to-end intake create/sign/draft-POF path first, including `app/intake-actions.ts`, `lib/services/intake-pof-mhp-cascade.ts`, and `lib/services/intake-assessment-esign.ts`.
2) Preserve the existing RPC boundaries for intake creation, signature finalization, and draft POF creation.
3) Add one canonical intake readiness contract/resolver that clearly exposes the real lifecycle state instead of forcing consumers to infer from `signature_status`.
4) Update the intake detail/status surfaces and any downstream readers that currently assume signed means draft POF exists.
5) Keep `draft_pof_status` authoritative. Do not duplicate lifecycle logic in UI components.
6) If there is already a suitable shared resolver, extend it instead of creating a parallel one.

Validation:
- Run `npm run typecheck` and report results.
- List changed files and downstream impact.
- Explicitly state whether the fix changes user-visible status text only, shared resolver behavior, or both.

Do not overengineer. Do not attempt a full end-to-end transaction rewrite unless the current code proves a smaller resolver/status fix is insufficient.
```

### Prompt 3. POF clinical-readiness resolver
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Signed POF status can be true while downstream clinical sync is still queued, so MHP/MAR consumers can present false-ready clinical state.

Scope:
- Domain/workflow: POF signature completion -> post-sign sync queue -> MHP/MAR readiness
- Canonical entities/tables: physician_orders, pof_post_sign_sync_queue, member_health_profiles, pof_medications, mar_schedules
- Expected canonical write path: UI -> Server Action -> Service Layer -> Supabase

Required approach:
1) Inspect the current signed POF finalize path and the post-sign retry path first, including `lib/services/physician-orders-supabase.ts`, `lib/services/pof-esign.ts`, and `app/api/internal/pof-post-sign-sync/route.ts`.
2) Preserve the current signed-state RPC boundary and the existing retry runner. Do not re-implement scheduling.
3) Add one canonical clinical-readiness resolver/service contract that only returns ready when:
   - the POF is signed, and
   - the linked post-sign sync work is complete
4) Update the main downstream readers/dashboards that currently equate `status = 'signed'` with fully synced clinical state.
5) Keep all lifecycle/audit logging centralized in service code.
6) Make pending/queued/failed sync states observable and explicit rather than silently falling back to signed-only truth.

Validation:
- Run `npm run typecheck` and report results.
- List changed files and downstream impact.
- Note any screens that still intentionally show legal-signature state separately from clinical-readiness state.

Do not overengineer. This is a readiness-truth fix, not a new queueing system.
```

### Prompt 4. Care plan diagnosis relation
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Care plans have no canonical Supabase-backed relation to the member diagnoses they reference, so diagnosis linkage is not FK-protected or auditable.

Scope:
- Domain/workflow: Care plan create/review persistence
- Canonical entities/tables: care_plans, member_diagnoses
- Expected canonical write path: UI -> Server Action -> Service Layer -> Supabase

Required approach:
1) Inspect how care plans currently store or infer diagnosis content in `lib/services/care-plans-supabase.ts` and related actions/components.
2) Add a forward-only Supabase migration for a canonical join table, for example `care_plan_diagnoses`, with proper foreign keys and uniqueness.
3) Backfill conservatively from current persisted care-plan data only if a safe mapping is actually available. If not, leave existing rows unlinked and report the blocker clearly.
4) Update canonical care-plan create/review write paths so diagnosis linkage is written through the service layer, not directly from UI.
5) Update read/resolver paths only as needed so care plans resolve diagnosis references from canonical linked rows.
6) Preserve role restrictions and auditability.

Validation:
- Run `npm run typecheck` and report results.
- List changed files, schema impact, and any required deploy/backfill steps.
- Call out any unresolved data-mapping gap explicitly.

Do not overengineer. Prefer a small, explicit relation table over a broad care-plan schema redesign.
```

### Prompt 5. Enrollment packet lead-activity durability
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Enrollment packet completion can succeed even when the follow-up `lead_activities` write fails, and that failure is currently swallowed with console logging.

Scope:
- Domain/workflow: Enrollment packet completion -> lead activity logging
- Canonical entities/tables: enrollment_packet_requests, lead_activities, system_events
- Expected canonical write path: UI -> Server Action -> Service Layer -> Supabase

Required approach:
1) Inspect `submitPublicEnrollmentPacket` and the current `addLeadActivity` failure path in `lib/services/enrollment-packets.ts`.
2) Preserve packet filing as the canonical success boundary. Do not roll back filed packet state just because lead activity logging is secondary.
3) Replace console-only failure handling with one canonical durable repair path:
   - either a persisted retry mechanism, or
   - a durable system alert/event that operations can act on
4) Keep the logic in the service layer. Do not add UI-side compensating writes.
5) Ensure the drift is visible and auditable, not silent.

Validation:
- Run `npm run typecheck` and report results.
- List changed files and downstream impact.
- Explain whether the fix is retry-based, alert-based, or both.

Do not overengineer. This is about making a secondary write failure visible and recoverable.
```

### Prompt 6. MAR notification mapping
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
MAR documentation milestones are emitted, but they do not get canonicalized into `user_notifications`, so staff inboxes miss MAR workflow events.

Scope:
- Domain/workflow: MAR documentation -> workflow milestones -> user notifications
- Canonical entities/tables: system_events, user_notifications, mar_administrations
- Expected canonical write path: UI -> Server Action -> Service Layer -> Supabase

Required approach:
1) Inspect the event emission path in `lib/services/mar-workflow.ts` and the canonical notification mapping in `lib/services/notifications.ts` and related milestone services.
2) Preserve current milestone emission behavior.
3) Extend the shared notification mapping layer so MAR events like `mar_administration_documented` and `mar_prn_outcome_documented` resolve into the existing notification pipeline.
4) Do not duplicate notification logic in actions or components.
5) Keep role restrictions and existing notification semantics intact.

Validation:
- Run `npm run typecheck` and report results.
- List changed files and note which MAR events now create inbox notifications.
- Call out any event names that are still intentionally excluded.

Do not overengineer. This should be a shared mapping fix, not a new notification subsystem.
```

### Prompt 7. Mock runtime cleanup
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
The schema audit still reports mock-era runtime references in production-adjacent sales/admin/reporting code, which risks split-brain behavior against the Supabase source of truth.

Scope:
- Domain/workflow: Sales/admin/reporting runtime data paths
- Canonical entities/tables: discover from current Supabase services before editing
- Expected canonical write path: UI -> Server Action -> Service Layer -> Supabase

Required approach:
1) Inspect the current schema audit outputs first, especially `docs/audits/supabase-schema-audit-data.json`, and identify the exact mock imports still referenced in runtime code.
2) Verify whether each flagged file is truly on a production path or already isolated to test/dev-only usage.
3) For production paths, remove mock/runtime fallback usage and route reads/writes through the existing canonical Supabase services.
4) For dev/test-only code, quarantine the mock dependency clearly so it cannot be imported by production runtime paths.
5) Preserve behavior where possible, but fail explicitly rather than silently falling back to mock data.

Validation:
- Run `npm run typecheck` and report results.
- List changed files and confirm which flagged mock dependencies were removed or quarantined.
- Call out any file that still cannot be fixed safely without a broader refactor.

Do not overengineer. This is a canonicality cleanup pass, not a redesign of reporting.
```

## Fix Priority Order
1. Enrollment packet readiness semantics
2. Intake signed-vs-draft-POF truth
3. POF clinical-readiness resolver
4. Care plan diagnosis relation
5. Enrollment packet lead-activity durability
6. MAR notification mapping
7. Mock runtime cleanup

## Founder Summary

The highest-risk issues are now mostly about lifecycle truth, not raw persistence gaps. The repo already has a POF retry runner wired through [`/D:/Memory Lane App/vercel.json`](/D:/Memory%20Lane%20App/vercel.json) and [`/D:/Memory Lane App/app/api/internal/pof-post-sign-sync/route.ts`](/D:/Memory%20Lane%20App/app/api/internal/pof-post-sign-sync/route.ts), so that is no longer the right first fix prompt.

The remaining work is to stop downstream screens from reading partial states as if they are complete. The first three prompts focus on that: enrollment packets that are filed but not fully mapped, intakes that are signed but still do not have a draft POF ready, and POFs that are legally signed but not yet clinically synced. After that, the next clean structural fix is adding a canonical care-plan diagnosis relation, then cleaning up two narrower integrity gaps: silent lead-activity failures after packet completion and missing MAR inbox notifications.

Coverage note: there is still no dedicated in-repo artifact for the requested Supabase Query Performance Audit, and there is no standalone new RLS/security report beyond what is referenced indirectly in the production-readiness and schema-compatibility audits. This report does not invent findings for categories that are not currently present in the repo.
