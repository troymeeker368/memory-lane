# Fix Prompt Generator Report
Generated: 2026-03-18

## 1. Issues Detected

### 1. Enrollment packet `filed` status still overstates operational completion
- Audit sources:
  - `docs/audits/referential-integrity-cascade-audit-2026-03-18.md`
  - `docs/audits/workflow-simulation-audit-2026-03-18.md`
- Architectural rule violated:
  - Workflow state integrity
  - Shared resolver / service boundaries
  - Canonical resolver path for derived business logic
- Why this is still open:
  - `enrollment_packet_requests.status = 'filed'` can still coexist with `mapping_sync_status = 'pending'` or `failed`, so downstream consumers can treat a packet as operationally complete before MCC/MHP/contact mapping has converged.
- Safest fix approach:
  - Keep the existing filing RPC as the canonical write boundary.
  - Add one shared readiness resolver/service contract for "filed and downstream mapped".
  - Update downstream consumers to use that resolver instead of raw packet status.

### 2. Signed intake can still exist without a ready draft POF
- Audit sources:
  - `docs/audits/referential-integrity-cascade-audit-2026-03-18.md`
- Architectural rule violated:
  - Workflow state integrity
  - Shared RPC standard
  - ACID transaction requirements
- Why this is still open:
  - Intake signature finalization and draft POF creation are still separate lifecycle steps, so `signature_status = 'signed'` can coexist with `draft_pof_status = 'pending'` or `failed`.
- Safest fix approach:
  - Preserve existing RPC boundaries.
  - Add one canonical readiness contract that distinguishes "signed" from "draft POF ready".
  - Route downstream readers and status surfaces through that contract.

### 3. Signed POF still does not mean downstream clinical sync is complete
- Audit sources:
  - `docs/audits/referential-integrity-cascade-audit-2026-03-18.md`
  - `docs/audits/workflow-simulation-audit-2026-03-18.md`
- Architectural rule violated:
  - Workflow state integrity
  - Shared resolver / service boundaries
  - Canonical resolver path for derived business logic
- Why this is still open:
  - `physician_orders.status = 'signed'` can still coexist with `pof_post_sign_sync_queue.status = 'queued'`, so MHP, MCC, medications, and MAR surfaces can read a false-ready state if they key off signed status alone.
- Safest fix approach:
  - Keep the existing sign RPC and retry queue.
  - Add one canonical clinical-readiness resolver/service contract.
  - Update downstream readers to depend on clinical readiness, not raw signed state.

### 4. Care plans still have no canonical diagnosis relation
- Audit sources:
  - `docs/audits/referential-integrity-cascade-audit-2026-03-18.md`
- Architectural rule violated:
  - Schema drift prevention
  - Migration-driven schema alignment
  - Canonical entity identity
- Why this is still open:
  - Care plans do not persist an FK-backed, auditable relation to `member_diagnoses`, so diagnosis references cannot be validated or reliably resolved.
- Safest fix approach:
  - Add a forward-only migration for a canonical join table such as `care_plan_diagnoses`.
  - Backfill only where a safe mapping exists.
  - Update canonical care-plan write/read services to use that relation.

### 5. New physician order page still performs direct table reads instead of a canonical read service
- Audit sources:
  - `docs/audits/workflow-simulation-audit-2026-03-18.md`
- Architectural rule violated:
  - Shared resolver / service boundaries
  - One canonical resolver/read path per workflow where possible
  - UI components must not implement canonical business rules
- Why this is still open:
  - `app/(portal)/health/physician-orders/new/page.tsx` still creates its own Supabase client and reads `members` directly for the member picker, while the rest of the workflow already depends on canonical services in `lib/services/physician-orders-supabase.ts` and shared member resolution.
- Safest fix approach:
  - Move the member picker read into one shared service/read helper.
  - Keep identity resolution and permission assumptions centralized.
  - Remove UI-level direct Supabase table reads from this handoff page.

### 6. High-impact server actions still return `ok: true` from catch blocks
- Audit sources:
  - `docs/audits/workflow-simulation-audit-2026-03-18.md`
- Architectural rule violated:
  - Explicit failure handling
  - Success must never be returned if required persistence fails
  - No synthetic success when persistence or required side effects fail
- Why this is still open:
  - The workflow audit still flags multiple catch blocks in action files that return `ok: true` after errors, including `app/documentation-actions-impl.ts`, `app/sales-lead-actions.ts`, `app/sales-partner-actions.ts`, `app/time-actions.ts`, `app/(portal)/members/[memberId]/name-badge/actions.ts`, and `app/(portal)/documentation/incidents/actions.ts`.
- Safest fix approach:
  - Inspect each flagged catch path and classify whether the failed operation is required or optional.
  - Return explicit failure for required persistence failures.
  - For optional secondary effects, keep the main write boundary but replace silent success with a durable alert/retry path.

### 7. Mock-era runtime dependencies are still present in production-adjacent services
- Audit sources:
  - `docs/audits/supabase-schema-compatibility-audit-2026-03-11.md`
  - `docs/audits/supabase-schema-audit-data.json`
- Architectural rule violated:
  - Supabase source of truth
  - Mock data boundaries
  - No runtime split-brain
- Why this is still open:
  - The latest available schema-compatibility audit still reports production-adjacent mock dependencies in operational services such as `lib/services/admin-reporting-foundation.ts`, `lib/services/admin-reports.ts`, `lib/services/member-files.ts`, `lib/services/physician-orders.ts`, and other legacy service files.
- Safest fix approach:
  - Re-audit the currently flagged files.
  - Remove mock imports from runtime paths or quarantine them to test/dev-only code.
  - Route remaining runtime behavior through canonical Supabase services.

## 2. Codex Fix Prompts

### Prompt 1. Enrollment packet readiness semantics
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Enrollment packets can be marked filed while downstream mapping is still pending or failed, so downstream screens can treat the packet as operationally complete too early.

Scope:
- Domain/workflow: Enrollment packet completion -> downstream mapping -> member operational readiness
- Canonical entities/tables: enrollment_packet_requests, enrollment_packet_mapping_runs, enrollment_packet_mapping_records, member_files
- Expected canonical write path: UI -> Server Action -> Service Layer -> Supabase

Required approach:
1) Inspect the current packet completion path end-to-end, starting with `lib/services/enrollment-packets.ts`, the filing RPC migrations, and the downstream mapping/read consumers that rely on packet status.
2) Preserve the existing filing RPC as the canonical write boundary. Do not move business writes into UI code.
3) Add one canonical readiness resolver/service contract that distinguishes:
   - packet filed
   - downstream mapping complete and operationally ready
4) Update downstream consumers to use the canonical readiness contract instead of inferring readiness from raw `status = 'filed'`.
5) Keep failures explicit. If mapping is pending or failed, the readiness contract must say so clearly.
6) Preserve current auditability, role restrictions, and Supabase-backed persistence.

Validation:
- Run `npm run typecheck` and `npm run build` if the environment permits.
- List changed files and downstream impact.
- Call out any schema blocker explicitly if a new resolver/view/function is required.

Do not overengineer. Keep the filing RPC authoritative and make lifecycle truth clearer.
```

### Prompt 2. Intake signed-vs-draft-POF readiness truth
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
A signed intake assessment can still exist without a successfully created draft POF, but downstream code can easily misread signed state as POF-ready.

Scope:
- Domain/workflow: Intake assessment -> signature finalization -> draft physician order creation
- Canonical entities/tables: intake_assessments, intake_assessment_signatures, physician_orders
- Expected canonical write path: UI -> Server Action -> Service Layer -> Supabase

Required approach:
1) Inspect the end-to-end intake create/sign/draft-POF path first, including `app/intake-actions.ts`, `lib/services/intake-pof-mhp-cascade.ts`, `lib/services/intake-assessment-esign.ts`, and the relevant RPC migrations.
2) Preserve the existing RPC boundaries for intake creation, signature finalization, and draft POF creation.
3) Add one canonical readiness contract/resolver that clearly exposes the real lifecycle state instead of forcing consumers to infer from `signature_status`.
4) Update intake status surfaces and downstream readers that currently assume signed means draft POF exists.
5) Keep `draft_pof_status` authoritative. Do not duplicate lifecycle logic in UI components.
6) If there is already a suitable shared resolver, extend it instead of creating a parallel one.

Validation:
- Run `npm run typecheck` and `npm run build` if the environment permits.
- List changed files and downstream impact.
- Explicitly state whether the fix changes shared resolver behavior, status copy, or both.

Do not overengineer. Do not do a broad workflow rewrite unless the current code proves a smaller readiness fix is insufficient.
```

### Prompt 3. POF clinical-readiness resolver
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Signed POF status can be true while downstream clinical sync is still queued, so MHP/MCC/MAR consumers can present false-ready clinical state.

Scope:
- Domain/workflow: POF signature completion -> post-sign sync queue -> clinical readiness
- Canonical entities/tables: physician_orders, pof_post_sign_sync_queue, member_health_profiles, pof_medications, mar_schedules
- Expected canonical write path: UI -> Server Action -> Service Layer -> Supabase

Required approach:
1) Inspect the signed POF finalize path and retry path first, including `lib/services/physician-orders-supabase.ts`, `lib/services/pof-esign.ts`, and any readers that currently treat `status = 'Signed'` as fully synced.
2) Preserve the current sign RPC boundary and the existing retry runner. Do not re-implement queueing.
3) Add one canonical clinical-readiness resolver/service contract that only returns ready when:
   - the POF is signed, and
   - the linked post-sign sync work is completed
4) Update MHP, MCC, medication, and MAR readers only as needed so they depend on clinical readiness instead of raw signed state.
5) Keep lifecycle and audit logging centralized in the service layer.
6) Make pending, queued, and failed sync states explicit rather than silently falling back to signed-only truth.

Validation:
- Run `npm run typecheck` and `npm run build` if the environment permits.
- List changed files and downstream impact.
- Note which screens should still show legal-signature state separately from clinical readiness.

Do not overengineer. This is a readiness-truth fix, not a new post-sign processing system.
```

### Prompt 4. Care plan diagnosis relation
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Care plans have no canonical Supabase-backed relation to the member diagnoses they reference, so diagnosis linkage is not FK-protected or auditable.

Scope:
- Domain/workflow: Care plan create/review persistence
- Canonical entities/tables: care_plans, member_diagnoses, proposed care_plan_diagnoses
- Expected canonical write path: UI -> Server Action -> Service Layer -> Supabase

Required approach:
1) Inspect how care plans currently store or infer diagnosis content in `lib/services/care-plans-supabase.ts`, related actions, and any current persisted JSON/text diagnosis fields.
2) Add a forward-only Supabase migration for a canonical join table such as `care_plan_diagnoses` with FK constraints and a uniqueness guard on `(care_plan_id, member_diagnosis_id)`.
3) Backfill conservatively only if a safe mapping from existing persisted care-plan diagnosis data to `member_diagnoses` rows is actually available. If not, leave old rows unlinked and report the blocker explicitly.
4) Update canonical care-plan create/review write paths so diagnosis linkage is written through the service layer, not directly from UI.
5) Update read/resolver paths only as needed so care plans resolve diagnosis references from canonical linked rows.
6) Preserve role restrictions, auditability, and existing care-plan workflow behavior outside this relation.

Validation:
- Run `npm run typecheck` and `npm run build` if the environment permits.
- List changed files, schema impact, and any required deploy/backfill steps.
- Call out unresolved historical-data mapping gaps explicitly.

Do not overengineer. Prefer a small explicit relation table over a broad care-plan schema redesign.
```

### Prompt 5. Canonicalize new physician order page reads
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
`app/(portal)/health/physician-orders/new/page.tsx` still performs direct Supabase table reads for the member picker instead of using one canonical read/service path.

Scope:
- Domain/workflow: Intake Assessment -> Physician Orders / POF generation
- Canonical entities/tables: members, physician_orders
- Expected canonical write path: UI -> Server Action -> Service Layer -> Supabase

Required approach:
1) Inspect `app/(portal)/health/physician-orders/new/page.tsx` first, then discover the best existing canonical read helper in `lib/services/physician-orders-supabase.ts`, member services, or shared resolvers before editing.
2) Remove UI-level direct `createClient().from("members")` reads from this page.
3) Move the active-member picker data load into one canonical service/read helper that can also centralize schema expectations and identity-safe filtering.
4) Preserve current behavior and page UX.
5) Do not duplicate member resolution logic already handled by `resolveCanonicalMemberRef`.
6) Keep role restrictions enforced and fail explicitly if required schema is missing.

Validation:
- Run `npm run typecheck` and `npm run build` if the environment permits.
- List changed files and downstream impact.
- Call out whether any other physician-order pages still bypass the canonical read path.

Do not overengineer. This should be a small canonical-read refactor, not a full physician-order service rewrite.
```

### Prompt 6. Remove synthetic success from flagged action catch blocks
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Several high-impact server actions still return `ok: true` from catch blocks, which can report success even when required persistence or side effects failed.

Scope:
- Domain/workflow: Documentation, sales, time, member badge, and incidents action flows
- Canonical entities/tables: discover per action before editing
- Expected canonical write path: UI -> Server Action -> Service Layer -> Supabase

Required approach:
1) Inspect the exact files flagged by the latest workflow audit first:
   - `app/documentation-actions-impl.ts`
   - `app/sales-lead-actions.ts`
   - `app/sales-partner-actions.ts`
   - `app/time-actions.ts`
   - `app/(portal)/members/[memberId]/name-badge/actions.ts`
   - `app/(portal)/documentation/incidents/actions.ts`
2) For each `catch` path returning `ok: true`, determine whether the failing operation is:
   - a required canonical write, or
   - an optional secondary effect
3) If the failing operation is required, return explicit failure and stop reporting success.
4) If the failing operation is secondary, keep the main canonical write boundary but replace silent success with a durable alert/retry/event path so the drift is visible and auditable.
5) Keep fixes in server actions/service layers. Do not patch around failures in UI components.
6) Preserve current role restrictions and audit logging.

Validation:
- Run `npm run typecheck` and `npm run build` if the environment permits.
- List each changed action and whether it now fails explicitly or records a durable warning/alert.
- Call out any catch path that still needs a larger architectural follow-up.

Do not overengineer. Focus on false-success prevention and durable operational truth.
```

### Prompt 7. Remove mock runtime dependencies from production-adjacent services
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
The latest available schema-compatibility audit still reports mock-era dependencies in production-adjacent services, which risks split-brain behavior against Supabase as the source of truth.

Scope:
- Domain/workflow: sales, admin reporting, member files, physician orders, and related legacy service paths
- Canonical entities/tables: discover from current Supabase services before editing
- Expected canonical write path: UI -> Server Action -> Service Layer -> Supabase

Required approach:
1) Inspect `docs/audits/supabase-schema-audit-data.json` first and verify which flagged files are still on runtime paths.
2) For production/runtime paths, remove mock imports and route reads/writes through existing canonical Supabase services.
3) For files that are truly dev-only or test-only, quarantine the mock dependency so it cannot be pulled into production runtime code.
4) Preserve current behavior where possible, but fail explicitly rather than silently falling back to mock data.
5) Do not introduce a second persistence path.
6) Report any flagged file that cannot be fixed safely without a larger refactor.

Validation:
- Run `npm run typecheck` and `npm run build` if the environment permits.
- List changed files and confirm which mock dependencies were removed or isolated.
- Call out any remaining production-path mock usage explicitly.

Do not overengineer. This is a canonicality cleanup pass, not a rewrite of reporting.
```

## 3. Fix Priority Order

1. Remove synthetic success from flagged action catch blocks
2. Enrollment packet readiness semantics
3. POF clinical-readiness resolver
4. Intake signed-vs-draft-POF readiness truth
5. Canonicalize new physician order page reads
6. Care plan diagnosis relation
7. Remove mock runtime dependencies from production-adjacent services

Priority rationale:
- `ok: true` on failed actions is the most immediate false-success risk because it can tell staff a write succeeded when it did not.
- The next three issues are lifecycle-truth risks in clinically important workflows.
- The physician-order page direct read is a smaller but clear canonicality gap in a live handoff path.
- The care-plan diagnosis relation is a structural schema fix with good long-term value but likely broader change surface.
- Mock runtime cleanup still matters, but the latest evidence for it is older than today’s lifecycle findings and needs targeted re-validation during implementation.

## 4. Founder Summary

Today’s audit set is mostly strong on core workflow wiring. The remaining issues are less about missing tables and more about truthfulness: some workflows can still look complete before their downstream state is actually ready, and several server actions can still report success after exceptions.

The cleanest next fixes are:
- stop false-success catch blocks from returning `ok: true`
- separate “legally/syntactically complete” from “operationally ready” for enrollment packets, intake-to-POF, and signed POF downstream sync
- close the remaining canonicality gap on the new POF page and the missing care-plan diagnosis relation

Coverage note:
- I found current local reports for Production Readiness, Workflow Simulation, Referential Integrity/Cascade, and the latest available Schema Compatibility audit data.
- I did not find fresh standalone 2026-03-18 markdown reports in-repo for Supabase RLS & Security, Daily Canonicality Sweep, Shared Resolver Drift, Shared RPC Architecture, ACID, Idempotency/Duplicate Submission, or Supabase Query Performance beyond what is reflected indirectly in the current lifecycle and production-readiness artifacts.
- This report does not invent findings for missing standalone audit outputs.
