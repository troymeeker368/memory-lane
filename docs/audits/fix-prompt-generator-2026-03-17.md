# Fix Prompt Generator Report
Generated: 2026-03-17

Latest in-repo audit sources found for this run:
- `docs/audits/workflow-simulation-audit.md`
- `docs/audits/referential-integrity-cascade-audit-2026-03-17.md`
- `docs/audits/production-readiness-system-map-2026-03-15.md`
- `docs/audits/supabase-schema-compatibility-audit-2026-03-11.md`
- `docs/audits/supabase-schema-audit-data.json`

Requested audit categories with no newer in-repo report found this run:
- Supabase RLS & Security Audit
- Daily Canonicality Sweep
- Schema Migration Safety Audit beyond the 2026-03-11 schema compatibility pass
- Shared Resolver Drift Check
- Shared RPC Architecture Audit
- Memory Lane ACID Audit
- Idempotency & Duplicate Submission Audit
- Supabase Query Performance Audit

## 1. Issues Detected

### Issue 1. POF post-sign sync can stall with no in-repo runner
- Architectural rule violated: ACID durability and workflow lifecycle integrity. A successful POF signature cannot leave required downstream MHP/MAR sync dependent on an unscheduled retry path.
- Evidence source: `workflow-simulation-audit.md`, `referential-integrity-cascade-audit-2026-03-17.md`
- Safest fix approach: keep the existing canonical retry service and add one real scheduled caller plus durable alerting for aged queue rows.

### Issue 2. Enrollment packet `filed` overstates lifecycle completion
- Architectural rule violated: canonical workflow states must reflect real downstream persistence, not only the first committed phase.
- Evidence source: `workflow-simulation-audit.md`, `referential-integrity-cascade-audit-2026-03-17.md`, `production-readiness-system-map-2026-03-15.md`
- Safest fix approach: preserve the current filing RPC, but add one canonical readiness contract for `filed + mapped`, then update downstream consumers to stop treating raw `status = filed` as fully complete.

### Issue 3. Intake signing is still split from draft POF completion
- Architectural rule violated: success cannot be returned when required downstream clinical persistence is still pending or failed.
- Evidence source: `workflow-simulation-audit.md`, `referential-integrity-cascade-audit-2026-03-17.md`, `production-readiness-system-map-2026-03-15.md`
- Safest fix approach: either move the signed-intake to draft-POF handoff into one canonical orchestration boundary, or make `draft_pof_status` the explicit lifecycle truth that blocks false completion.

### Issue 4. MAR milestones do not reach `user_notifications`
- Architectural rule violated: significant lifecycle events must be logged and dispatched through shared service-layer notification logic.
- Evidence source: `workflow-simulation-audit.md`
- Safest fix approach: add MAR milestone aliases to the existing notification canonicalization layer instead of creating MAR-specific notification logic.

### Issue 5. Enrollment packet completion can lose lead-activity visibility silently
- Architectural rule violated: significant lifecycle events must not fail silently, and service-layer workflow logging must stay durable and auditable.
- Evidence source: `workflow-simulation-audit.md`, `production-readiness-system-map-2026-03-15.md`
- Safest fix approach: keep lead-activity writes on the existing canonical service path, but replace console-only failure swallowing with durable retry, alert, or explicit failure state.

### Issue 6. Care plans still lack a canonical diagnosis relation
- Architectural rule violated: schema and runtime behavior must stay aligned; important clinical references should be modeled canonically with migration-backed constraints.
- Evidence source: `referential-integrity-cascade-audit-2026-03-17.md`
- Safest fix approach: add a forward-only `care_plan_diagnoses` relation with real FKs, then route care-plan diagnosis linkage through shared services.

### Issue 7. Mock-era runtime dependencies still exist in production paths
- Architectural rule violated: Supabase is the only runtime source of truth. Production code cannot depend on mock-backed services.
- Evidence source: `supabase-schema-compatibility-audit-2026-03-11.md`, `supabase-schema-audit-data.json`
- Safest fix approach: remove mock-backed imports from the highest-impact runtime entry points first and route them through existing canonical Supabase services.

## 2. Codex Fix Prompts

### Prompt 1. Add the missing POF post-sign retry runner
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Signed physician orders can leave MHP, MCC, and MAR stale because post-sign retry logic exists, but this repo does not include a real scheduled runner for queued retries.

Scope:
- Domain/workflow: POF signature completion -> post-sign sync -> MHP/MCC/MAR
- Canonical entities/tables: physician_orders, pof_post_sign_sync_queue, member_health_profiles, pof_medications, mar_schedules
- Expected canonical write path: public POF sign action -> canonical POF finalization service/RPC -> canonical post-sign retry service -> Supabase

Required approach:
1) Inspect `lib/services/physician-orders-supabase.ts`, `lib/services/pof-esign.ts`, and `app/api/internal/pof-post-sign-sync/route.ts` first.
2) Treat `retryQueuedPhysicianOrderPostSignSync` as the single authoritative retry implementation. Do not create a second cascade path.
3) Add the smallest maintainable in-repo scheduler or server-side runner that invokes the existing retry path with bounded batch size and existing secret protection.
4) Persist repeated failure visibility through existing alert/system-event patterns so aged queued rows do not stay invisible.
5) Keep replay safety intact so retries do not duplicate medication propagation or MAR schedule generation.
6) Update any canonical readiness reader that currently assumes `physician_orders.status = 'signed'` means downstream sync is complete.

Validation:
- Run `npm run typecheck`.
- Run `npm run build` if you add or change route/scheduler entry points.
- Report changed files, required env/config, and how queued rows now converge.

Do not overengineer. Keep Supabase as source of truth and preserve one canonical post-sign sync path.
```

### Prompt 2. Separate enrollment packet filing from downstream readiness
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Enrollment packets can be marked `filed` while downstream MCC/MHP/contact/POF staging sync is still `pending` or `failed`, which overstates lifecycle completion.

Scope:
- Domain/workflow: public enrollment packet completion -> downstream enrollment mapping
- Canonical entities/tables: enrollment_packet_requests, enrollment_packet_mapping_runs, enrollment_packet_mapping_records, member_command_centers, member_contacts, member_health_profiles, enrollment_packet_pof_staging, member_files
- Expected canonical write path: public packet action -> canonical enrollment packet service -> filing RPC -> canonical mapping/readiness service -> Supabase

Required approach:
1) Inspect `lib/services/enrollment-packets.ts`, `lib/services/enrollment-packet-intake-mapping.ts`, and the filing/mapping migrations first.
2) Preserve the current filing RPC as the authoritative packet filing boundary.
3) Add one canonical resolver/service contract for operational readiness that requires both packet filing and `mapping_sync_status = completed`.
4) Update downstream consumers and status surfaces that currently treat raw `status = filed` as fully operationalized.
5) If a narrower lifecycle state or derived readiness field is needed, implement it in the canonical service/resolver layer and back it with migration-driven schema only if necessary.
6) Keep replay/idempotency protections intact and do not add UI-only business rules.

Validation:
- Run `npm run typecheck`.
- Run `npm run build`.
- Report changed files, any migration impact, and which downstream consumers now rely on canonical readiness instead of raw filed status.

Do not invent fallback success. Keep one canonical resolver path for enrollment packet readiness.
```

### Prompt 3. Close the signed-intake to draft-POF split state
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
An intake assessment can be saved and signed while draft POF creation is still pending or failed, which leaves a false-ready clinical handoff.

Scope:
- Domain/workflow: intake assessment completion -> draft physician order creation
- Canonical entities/tables: intake_assessments, assessment_responses, intake_assessment_signatures, physician_orders, member_files
- Expected canonical write path: intake action -> canonical intake service -> canonical RPC/service orchestration -> Supabase

Required approach:
1) Inspect `app/intake-actions.ts`, `lib/services/intake-assessment-esign.ts`, and `lib/services/intake-pof-mhp-cascade.ts` first.
2) Confirm the current success boundary and where `draft_pof_status` is set or left pending/failed.
3) Use the existing canonical draft-POF RPC/service path. Do not recreate POF creation logic in UI or action code.
4) Either move the signed-intake -> draft-POF handoff behind one tighter canonical orchestration boundary, or make downstream readers and UI rely explicitly on `draft_pof_status` instead of assuming signed intake means POF-ready.
5) Preserve current signature artifact persistence, intake PDF filing, and auditability.
6) Ensure failures remain explicit and retryable. Do not return synthetic success for a fully-complete intake if required downstream clinical state is missing.

Validation:
- Run `npm run typecheck`.
- Run `npm run build`.
- Report changed files, whether schema/migration work was needed, and how staff now detect a signed intake that still needs POF follow-up.

Do not overengineer. Focus on truthful lifecycle state and one canonical handoff path.
```

### Prompt 4. Canonicalize MAR milestone notifications
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
MAR milestone events such as `mar_administration_documented` and `mar_prn_outcome_documented` are emitted, but they do not canonicalize into `user_notifications`.

Scope:
- Domain/workflow: MAR documentation -> lifecycle milestone notifications
- Canonical entities/tables: mar_administrations, system_events, user_notifications
- Expected canonical write path: MAR action -> canonical MAR service -> lifecycle milestone service -> notification dispatcher -> Supabase

Required approach:
1) Inspect `lib/services/notifications.ts`, `lib/services/lifecycle-milestones.ts`, and the MAR emitters in `lib/services/mar-workflow.ts` first.
2) Reuse the existing shared notification canonicalization path. Do not add MAR-only notification writes from UI or action code.
3) Add the missing MAR event aliases so durable MAR documentation milestones can create inbox notifications through the shared dispatcher.
4) Preserve role restrictions, auditability, and existing milestone naming if already used elsewhere.
5) Keep notification creation tied to durable MAR writes only.

Validation:
- Run `npm run typecheck`.
- Report changed files and exactly which MAR milestone event names now map into `user_notifications`.

Do not add optimistic notifications or duplicate event wiring.
```

### Prompt 5. Stop swallowing enrollment packet lead-activity failures
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Enrollment packet completion attempts to write lead activity, but failures are swallowed with console logging, which can silently break sales visibility.

Scope:
- Domain/workflow: enrollment packet completion -> lead activity logging
- Canonical entities/tables: lead_activities, enrollment_packet_requests, enrollment_packet_events
- Expected canonical write path: packet completion service -> canonical lead activity service -> Supabase

Required approach:
1) Inspect `lib/services/enrollment-packets.ts` and the canonical lead-activity write path in sales services first.
2) Keep lead activity logging in the service layer and reuse the canonical lead-activity writer.
3) Replace console-only failure swallowing with one production-safe path: explicit failure return, durable alert/system event, or retryable queued follow-up.
4) Preserve packet completion durability and idempotency. Do not make public packet submission replay-unsafe.
5) Make sure downstream staff can distinguish "packet filed" from "lead activity logging failed" if those remain separate phases.

Validation:
- Run `npm run typecheck`.
- Report changed files, the chosen failure-handling behavior, and whether packet completion semantics changed.

Do not patch this only in the UI. Keep auditability explicit.
```

### Prompt 6. Add a canonical care-plan diagnosis relation
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Care plans do not have a canonical FK-backed diagnosis relation, so the system cannot verify that care-plan diagnoses point at real member diagnosis rows.

Scope:
- Domain/workflow: care plan creation/review and diagnosis linkage
- Canonical entities/tables: care_plans, member_diagnoses, new care_plan_diagnoses join table if needed
- Expected canonical write path: care plan actions -> canonical care plan service -> Supabase

Required approach:
1) Inspect current care-plan create/review services plus the latest migrations around care plans and member diagnoses first.
2) Add the smallest forward-only migration that creates a canonical `care_plan_diagnoses` relation with real foreign keys and uniqueness protection.
3) Backfill conservatively only if the current runtime already has a deterministic source for care-plan diagnosis linkage. If not, call that out instead of guessing.
4) Route diagnosis linkage writes through the shared care-plan service layer, not UI code.
5) Preserve current care-plan sections, versions, signatures, and review history behavior.

Validation:
- Run `npm run typecheck`.
- If a migration is added, report rollout/backfill considerations and any existing data blocker.
- List changed files and downstream care-plan behavior impact.

Do not introduce a fake inferred relation. Keep schema/runtime alignment explicit and auditable.
```

### Prompt 7. Remove mock-backed runtime paths from high-impact workflows
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
High-impact runtime files still depend on mock-era services, which violates Memory Lane's Supabase-only production contract.

Scope:
- Domain/workflow: shared app actions, sales actions, admin reporting, and other operational services still importing mock-backed code
- Canonical entities/tables: discover per affected workflow before editing
- Expected canonical write path: UI -> server action -> canonical service layer -> Supabase

Required approach:
1) Inspect `docs/audits/supabase-schema-audit-data.json` and start with the highest-impact files it flags: `app/actions.ts`, `app/sales-actions.ts`, `lib/services/admin-reporting-foundation.ts`, `lib/services/holds.ts`, and related runtime mock imports.
2) For each affected workflow, identify the existing canonical Supabase service/resolver first.
3) Remove mock-backed runtime imports from production paths and route the behavior through canonical Supabase services only.
4) If a canonical Supabase service does not exist yet for one of these runtime paths, add the smallest shared service needed instead of embedding raw queries in UI/actions.
5) Preserve current role restrictions and operational behavior, but remove fallback mock success/data paths from production runtime code.
6) Call out any blocked path that still needs migration, policy, or schema support rather than papering over it with mocks.

Validation:
- Run `npm run typecheck`.
- Run `npm run build`.
- Report which mock dependencies were removed and which production paths remain blocked.

Do not leave split-brain mock/Supabase behavior in production workflows.
```

## 3. Fix Priority Order

1. POF post-sign retry runner and readiness contract
2. Enrollment packet readiness vs raw `filed` state
3. Intake signed vs draft POF completion truth
4. Enrollment packet lead-activity durability
5. MAR notification canonicalization
6. Mock-runtime cleanup in production paths
7. Canonical care-plan diagnosis relation

Priority rationale:
- The top three can leave clinical or enrollment workflows in a false-success or stale downstream state.
- The next two improve auditability and staff visibility for operational follow-up.
- The last two harden longer-term schema and canonicality gaps without the same immediate workflow-risk level.

## 4. Founder Summary

The most important open problems are no longer basic Supabase wiring. They are lifecycle truthfulness problems: some workflows can be legally or operationally "done" in one table while the next required downstream state is still stale, queued, or failed.

The safest next pass is:
- make POF, enrollment packet, and intake readiness explicit and durable,
- stop silent lead-activity drift after enrollment packet completion,
- then clean up missing notification mapping and remaining mock-backed runtime paths.

I did not invent findings for the audit categories that were not present in the repo this run. This prompt pack only uses the latest audit artifacts that were actually available on disk.
