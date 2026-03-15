# Fix Prompt Generator Report
Generated: 2026-03-15
Source reports reviewed:
- `docs/audits/workflow-simulation-audit.md`
- `docs/audits/workflow-simulation-audit-current.md`
- `docs/audits/referential-integrity-cascade-audit-2026-03-15.md`
- `docs/audits/supabase-schema-compatibility-audit-2026-03-11.md`
- `docs/audits/supabase-schema-audit-data.json`

Missing current in-repo reports for this run:
- Supabase RLS & Security Audit
- Production Readiness Audit
- Daily Canonicality Sweep
- Schema Migration Safety Audit beyond the 2026-03-11 schema compatibility pass
- Shared Resolver Drift Check
- Shared RPC Architecture Audit
- Memory Lane ACID Audit
- Idempotency & Duplicate Submission Audit
- Supabase Query Performance Audit

## 1. Issues Detected

### Issue 1. POF post-sign retry queue has no scheduled runner
- Violated rule: multi-step workflows must be durable; success cannot leave required downstream clinical sync indefinitely pending.
- Evidence source: `workflow-simulation-audit.md`
- Why this matters: a physician order can be signed while MHP and MAR remain stale if the first post-sign sync attempt fails.
- Safest fix approach: add one canonical retry runner that calls the existing retry service, records repeated failures, and does not create a second write path.

### Issue 2. Enrollment packet completion still has partial-write risk
- Violated rule: multi-table lifecycle transitions must use RPC or transaction-backed service operations.
- Evidence source: `workflow-simulation-audit.md`, `referential-integrity-cascade-audit-2026-03-15.md`
- Why this matters: completed packet data can reach some downstream tables but not all, leaving MCC, contacts, member files, and POF staging out of sync.
- Safest fix approach: move the downstream mapping/finalization boundary into one RPC-backed transaction, or make failure explicit and repairable with rollback semantics.

### Issue 3. Intake signing and draft POF creation are not atomic
- Violated rule: workflow completion cannot be claimed when required downstream persistence fails.
- Evidence source: `workflow-simulation-audit.md`
- Why this matters: intake can finish successfully while the expected draft POF never gets created.
- Safest fix approach: combine intake signature completion and draft POF creation into one canonical workflow boundary, or persist an explicit follow-up failure state that blocks silent success.

### Issue 4. Lifecycle notifications are inconsistent and partly tied to manual fallback paths
- Violated rule: lifecycle milestones should be system-driven, durable, and only marked after persistence succeeds.
- Evidence source: `workflow-simulation-audit.md`, `workflow-simulation-audit-current.md`
- Why this matters: staff can miss send/sign/documentation milestones or rely on success messages that do not correspond to a durable operational event.
- Safest fix approach: standardize milestone notification creation in the service layer after durable writes, and replace manual fallback success language with explicit failed/prepared states.

### Issue 5. One lead can still resolve to multiple members
- Violated rule: every business entity must have one canonical identity and one canonical persistence path.
- Evidence source: `referential-integrity-cascade-audit-2026-03-15.md`
- Why this matters: duplicate `members.source_lead_id` values break canonical lead/member resolution and create split-brain downstream workflows.
- Safest fix approach: add a migration-backed unique constraint after duplicate cleanup and make the resolver fail explicitly if duplicates remain.

### Issue 6. Active enrollment packet uniqueness is enforced only in service code
- Violated rule: idempotency and duplicate protection must be enforced durably, not only with pre-insert reads.
- Evidence source: `referential-integrity-cascade-audit-2026-03-15.md`
- Why this matters: concurrent sends or bypassed paths can create multiple active public packets for the same lead/member episode.
- Safest fix approach: add a partial unique index for active packet states and handle unique conflicts in the canonical service.

### Issue 7. Care plans lack a canonical root uniqueness rule
- Violated rule: one canonical record per workflow concept where possible; avoid duplicate top-level lifecycle objects.
- Evidence source: `referential-integrity-cascade-audit-2026-03-15.md`
- Why this matters: a member can end up with multiple concurrent top-level care plans for the same track.
- Safest fix approach: define the intended active-plan contract, enforce it with a migration, and update care-plan services to respect that contract.

### Issue 8. Scheduled MAR documentation does not re-validate active schedule and active medication state
- Violated rule: system workflow states must be explicit and validated at write time.
- Evidence source: `referential-integrity-cascade-audit-2026-03-15.md`
- Why this matters: staff can document a scheduled administration against a deactivated schedule or inactive medication.
- Safest fix approach: tighten the existing canonical MAR write path with fresh schedule and medication checks before insert.

### Issue 9. Downstream consumers can confuse "POF signed" with "clinical sync complete"
- Violated rule: derived workflow state must reflect actual persisted downstream status, not a loosely related upstream state.
- Evidence source: `referential-integrity-cascade-audit-2026-03-15.md`
- Why this matters: downstream reads may treat a signed order as fully cascaded when MHP or MAR sync is still queued.
- Safest fix approach: introduce one canonical resolver or explicit completion marker for "signed and fully cascaded" and update downstream consumers to use it.

### Issue 10. High-impact runtime entry points still depend on mock-era services
- Violated rule: Supabase is the only supported runtime backend; production paths must not depend on mock persistence.
- Evidence source: `supabase-schema-compatibility-audit-2026-03-11.md`, `supabase-schema-audit-data.json`
- Why this matters: sales, admin reporting, and shared action paths can drift away from canonical Supabase behavior or hide production-only failures.
- Safest fix approach: remove runtime mock imports from high-impact entry points first and route all operational reads/writes through canonical Supabase services.

## 2. Codex Fix Prompts

### Prompt 1. Add the missing POF post-sign retry runner
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Signed physician orders can leave MHP and MAR stale because the retry queue for post-sign sync exists but no in-repo runner appears to execute it.

Scope:
- Domain/workflow: POF signing -> MHP sync -> medication propagation -> MAR generation
- Canonical entities/tables: physician_orders, member_health_profiles, pof_medications, mar_schedules, system/event logging for retry state
- Expected canonical write path: public POF sign action -> canonical POF service/RPC finalization -> canonical post-sign sync service -> Supabase

Required approach:
1) Inspect `lib/services/pof-esign.ts`, `lib/services/physician-orders-supabase.ts`, and any existing cron/job entry points first.
2) Confirm `retryQueuedPhysicianOrderPostSignSync` is the authoritative retry path and do not create a second cascade implementation.
3) Add one scheduled/server-side runner that executes the existing retry function on a bounded batch size.
4) Persist durable retry results and repeated-failure signals in the existing canonical logging/event path only.
5) Make sure the runner is safe to replay and does not double-apply downstream medication or MAR generation.
6) If there is no existing scheduler entry point, add the smallest maintainable one that fits the repo's current deployment pattern.
7) Update any downstream resolver/read path that currently assumes a signed POF always means MHP/MAR are current.

Validation:
- Run `npm run typecheck`.
- Run `npm run build` if the new runner touches app entry points or route handlers.
- Report changed files, how the retry path is triggered, and any deployment/env prerequisite needed to actually schedule it.

Do not overengineer. Do not add a new framework. Preserve the existing canonical post-sign sync code as the single source of truth.
```

### Prompt 2. Make enrollment packet completion atomic
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Enrollment packet completion can partially update downstream records because packet finalization and downstream mapping are not protected by one atomic database boundary.

Scope:
- Domain/workflow: public enrollment packet completion -> downstream member setup
- Canonical entities/tables: enrollment_packet_requests, enrollment_packet_fields, enrollment_packet_signatures, enrollment_packet_uploads, enrollment_packet_events, member_files, member_command_centers, member_contacts, physician_orders, member_health_profiles
- Expected canonical write path: public packet submit action -> canonical enrollment packet service -> shared RPC/transaction boundary -> Supabase

Required approach:
1) Inspect `lib/services/enrollment-packets.ts`, `lib/services/enrollment-packet-intake-mapping.ts`, related public packet actions, and the current completion RPCs first.
2) Identify the exact writes that happen before versus after completion is marked.
3) Move the downstream mapping/finalization into one canonical RPC-backed transaction if feasible with the current schema.
4) If a full RPC move is not feasible in one pass, make partial completion impossible: persist an explicit failed/repair-needed state and prevent success from being returned until required downstream persistence succeeds.
5) Preserve the current canonical service entry point so UI and public token flows keep one write path.
6) Keep artifact filing, lead activity logging, and member file persistence aligned with the same success boundary.
7) Add or tighten idempotency protection so replaying packet submit does not duplicate downstream records.

Validation:
- Run `npm run typecheck`.
- Run `npm run build`.
- Report whether a new migration/RPC was added and which downstream tables are now covered atomically.

Do not patch this only in the UI. Do not add fallback success states. Keep Supabase and the shared service/RPC boundary authoritative.
```

### Prompt 3. Make intake signing and draft POF creation one durable workflow
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
An intake assessment can be signed successfully while draft POF auto-creation fails afterward, leaving the next clinical step missing.

Scope:
- Domain/workflow: intake assessment signing -> auto-created draft physician order
- Canonical entities/tables: intake_assessments, assessment_responses, intake_assessment_signatures, physician_orders, member_files
- Expected canonical write path: intake action -> canonical intake service -> canonical cascade/RPC boundary -> Supabase

Required approach:
1) Inspect `app/actions.ts`, `lib/services/intake-assessment-esign.ts`, and `lib/services/intake-pof-mhp-cascade.ts` first.
2) Confirm whether `createAssessmentAction` or the intake signing path is currently returning success before `autoCreateDraftPhysicianOrderFromIntake` is durable.
3) Make the workflow atomic if the current service/RPC patterns support it.
4) If true atomicity is too large for this pass, persist an explicit follow-up status such as repair-needed/failed-pof-draft and make that visible to the canonical next-step readers so intake is not treated as fully complete.
5) Preserve the current assessment persistence, signature artifact filing, and member file behavior.
6) Keep one canonical write path; do not duplicate the POF creation logic in UI code.
7) Call out any migration or RPC work needed if the current schema lacks a durable follow-up state field.

Validation:
- Run `npm run typecheck`.
- Run `npm run build`.
- Report changed files, whether the success contract changed, and how staff can detect/repair a failed draft-POF follow-up.

Do not overengineer. Focus on preventing false operational success.
```

### Prompt 4. Standardize lifecycle notifications after durable success
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Enrollment, POF, care plan, and MAR milestones do not notify consistently, and some current flows still rely on manual fallback language instead of explicit durable states.

Scope:
- Domain/workflow: lifecycle milestone notifications across enrollment packet send/completion, POF send/resend/sign, care plan send/sign, and MAR documentation milestones
- Canonical entities/tables: user_notifications plus the workflow-specific request/event tables for each milestone
- Expected canonical write path: workflow action -> canonical service -> durable workflow persistence -> notification/event logging -> Supabase

Required approach:
1) Inspect `lib/services/notifications.ts` and the service-layer success points in `lib/services/enrollment-packets.ts`, `lib/services/pof-esign.ts`, `lib/services/care-plan-esign.ts`, and `lib/services/mar-workflow.ts`.
2) Identify which milestones are intended to notify staff operationally and which ones already have durable event boundaries.
3) Add notification creation only after the underlying workflow write succeeds durably in Supabase.
4) Replace manual "prepared/draft/not configured" success-style messaging in canonical service results with explicit status values that do not imply completion when delivery prerequisites are missing.
5) Preserve role restrictions and avoid writing notifications from UI actions directly.
6) Reuse one shared helper such as `recordWorkflowMilestone` if it already exists; otherwise add the smallest shared service helper needed to avoid duplicating business rules.
7) Keep notification semantics deterministic and auditable.

Validation:
- Run `npm run typecheck`.
- Run `npm run build`.
- Report which milestones now notify, which intentionally still do not, and any env/deployment dependency for outbound delivery.

Do not add optimistic notifications. Do not mark workflow stages as sent/completed when delivery or downstream persistence failed.
```

### Prompt 5. Enforce one canonical member per lead
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
`members.source_lead_id` is not unique, so one lead can resolve to multiple members and break canonical identity assumptions.

Scope:
- Domain/workflow: lead -> member conversion and all downstream member resolution
- Canonical entities/tables: leads, members
- Expected canonical write path: sales/enrollment actions -> canonical resolver/service -> Supabase

Required approach:
1) Inspect `supabase/migrations/0007_sales_backend_alignment.sql`, `lib/services/canonical-person-ref.ts`, and the lead conversion services/actions first.
2) Confirm the current duplicate behavior and where `.maybeSingle()` is hiding an integrity problem.
3) Add a production-safe migration plan to enforce uniqueness on `members.source_lead_id` for non-null values.
4) Before hard-enforcing the unique index, add a duplicate-detection step or explicit blocker so migration/runtime does not silently choose one duplicate.
5) Update canonical resolver code to fail explicitly with an operationally useful error if duplicates still exist.
6) Preserve the existing canonical lead->member conversion path; do not add alternate identity translation logic.
7) Report any required data cleanup before the unique index can be applied safely in production.

Validation:
- Run `npm run typecheck`.
- If a migration is added, explain rollout order and whether existing data must be repaired first.
- List changed files and downstream workflows affected by stricter resolver behavior.

Do not auto-merge duplicate members in this pass. Keep the fix auditable and deterministic.
```

### Prompt 6. Add database-backed uniqueness for active enrollment packets
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Active enrollment packet uniqueness is enforced only in service code, so concurrent sends can still create duplicate active packets for the same episode.

Scope:
- Domain/workflow: enrollment packet send/resend lifecycle
- Canonical entities/tables: enrollment_packet_requests, enrollment_packet_events, leads, members
- Expected canonical write path: sales action -> canonical enrollment packet service -> Supabase

Required approach:
1) Inspect `lib/services/enrollment-packets.ts` and migration `0024_enrollment_packet_workflow.sql` first.
2) Define the canonical active-state set for enrollment packets based on current workflow semantics.
3) Add a partial unique index that prevents more than one active packet for the same canonical lead/member episode.
4) Update the service layer to handle unique-constraint violations as an explicit duplicate-active-packet error instead of relying only on pre-insert reads.
5) Preserve resend behavior for the same active request where appropriate.
6) Keep token generation and request lifecycle history intact.
7) Call out any edge case where the active-state definition needs founder confirmation before migration.

Validation:
- Run `npm run typecheck`.
- Report the chosen active statuses, migration impact, and any existing data that would block rollout.

Do not rely on UI disabling or client-side checks for duplicate prevention.
```

### Prompt 7. Enforce canonical care-plan uniqueness
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Care plans have uniqueness at section/version level, but not at the root plan level, so a member can end up with multiple top-level plans for the same track.

Scope:
- Domain/workflow: care plan creation/review/sign lifecycle
- Canonical entities/tables: care_plans, care_plan_sections, care_plan_versions, care_plan_review_history, care_plan_signature_events
- Expected canonical write path: care plan actions -> canonical care plan service -> Supabase

Required approach:
1) Inspect `supabase/migrations/0013_care_plans_and_billing_execution.sql`, `lib/services/care-plans-supabase.ts`, and care-plan actions first.
2) Determine the intended business rule: one persistent care plan per member/track, or one active/current care plan per member/track.
3) Implement the smallest migration-backed uniqueness rule that matches the real workflow contract.
4) Update create/review/sign service logic so it uses the canonical uniqueness contract rather than allowing parallel root records.
5) Preserve existing sections, versions, and signature history behavior.
6) If existing duplicate root plans are possible, surface a safe rollout/data-cleanup plan instead of silently collapsing them.

Validation:
- Run `npm run typecheck`.
- Report the chosen uniqueness rule, migration impact, and any existing-data blocker.

Do not solve this by hiding duplicates only in UI queries.
```

### Prompt 8. Tighten scheduled MAR write-time validation
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Scheduled MAR documentation can insert administrations without re-checking that the selected schedule is still active and the linked medication is still active and center-administered.

Scope:
- Domain/workflow: scheduled MAR administration documentation
- Canonical entities/tables: mar_schedules, mar_administrations, pof_medications, physician_orders
- Expected canonical write path: MAR action -> canonical MAR service -> Supabase

Required approach:
1) Inspect `lib/services/mar-workflow.ts`, especially `documentScheduledMarAdministration`, and compare it to the stricter PRN validation path.
2) Add fresh validation that the selected `mar_schedules` row is active and still belongs to an actionable medication workflow.
3) Re-check the linked `pof_medications` row for `active`, center-administered, and scheduled-dose compatibility before insert.
4) Fail explicitly when the schedule or medication is no longer valid; do not write a best-effort administration.
5) Preserve existing audit/event logging and downstream report compatibility.
6) Avoid duplicating medication-state logic if a shared resolver/helper already exists.

Validation:
- Run `npm run typecheck`.
- Run targeted manual verification for active vs inactive schedules and medications.
- Report changed files and whether any UI handling had to change for the new explicit errors.

Do not add fallback inserts. Keep MAR documentation deterministic and auditable.
```

### Prompt 9. Separate signed POF from clinically cascaded state
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Current downstream consumers can treat `physician_orders.status = signed` as if MHP sync and MAR generation are already complete, even though post-sign sync can still be queued.

Scope:
- Domain/workflow: signed physician orders and downstream clinical readiness reads
- Canonical entities/tables: physician_orders, member_health_profiles, pof_medications, mar_schedules, any retry/status tracking table already used by post-sign sync
- Expected canonical resolver/read path: shared resolver/service reads clinical readiness from canonical sync state, not from `status = signed` alone

Required approach:
1) Inspect `lib/services/physician-orders-supabase.ts` plus any downstream readers in MHP, MCC, and MAR workflows that rely on signed order state.
2) Identify the current canonical source of truth for post-sign sync queue/completion state.
3) Add the smallest shared resolver or explicit completion marker needed to represent "signed and fully cascaded".
4) Update downstream consumers to use that canonical readiness signal where they currently assume signed means fully synced.
5) Preserve the existing legal/document signature state while making clinical readiness explicit.
6) Avoid broad UI rewrites; change only the readers or services that consume the wrong state contract.

Validation:
- Run `npm run typecheck`.
- Report which downstream consumers changed and whether any schema/migration work was required.

Do not overload one status field with two different meanings if the current model already needs separate legal-signature and clinical-sync concepts.
```

### Prompt 10. Remove high-impact mock dependencies from production runtime paths
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
High-impact runtime entry points still depend on mock-era services, which violates Memory Lane's Supabase-only production contract.

Scope:
- Domain/workflow: shared app actions, sales actions, and admin reporting reads/writes
- Canonical entities/tables: discover first from the affected services
- Expected canonical write path: UI -> server action -> canonical service layer -> Supabase

Required approach:
1) Inspect the latest schema audit findings in `docs/audits/supabase-schema-compatibility-audit-2026-03-11.md` and `docs/audits/supabase-schema-audit-data.json`.
2) Start with the highest-impact files explicitly flagged there: `app/actions.ts`, `app/sales-actions.ts`, `lib/services/admin-reporting-foundation.ts`, and any runtime imports that still route through `lib/mock-data.ts` or `lib/mock-repo.ts`.
3) Discover the canonical Supabase service/resolver for each affected workflow before editing.
4) Replace mock-backed runtime behavior with canonical Supabase reads/writes only.
5) If a canonical Supabase service does not exist yet for a production path, add the smallest shared service needed instead of embedding queries in UI/actions.
6) Preserve feature behavior where possible, but remove fake fallback success/data paths from production code.
7) Call out any route that is still blocked by missing schema, policy, or migration support rather than reintroducing mock behavior.

Validation:
- Run `npm run typecheck`.
- Run `npm run build`.
- Report which mock dependencies were removed, which production paths now use canonical Supabase services, and any remaining blockers.

Do not leave mixed mock/Supabase runtime split-brain in production paths.
```

## 3. Fix Priority Order

1. Prompt 2: Enrollment packet completion atomicity
2. Prompt 3: Intake sign + draft POF durability
3. Prompt 1: POF post-sign retry runner
4. Prompt 9: Signed POF vs clinically cascaded state contract
5. Prompt 8: Scheduled MAR write-time validation
6. Prompt 5: One canonical member per lead
7. Prompt 6: Active enrollment packet uniqueness
8. Prompt 4: Lifecycle notification standardization
9. Prompt 7: Care-plan root uniqueness
10. Prompt 10: Mock runtime dependency cleanup

Priority rationale:
- The top four can directly leave clinical or intake workflows in a false-success or stale-state condition.
- The next three harden canonical identity and write-time safety.
- Notification coverage and mock cleanup matter, but they are lower risk than false clinical readiness or duplicate canonical records.

## 4. Founder Summary

The current repo evidence points to three kinds of problems:
- lifecycle steps that can say "done" before all required downstream writes are actually durable,
- canonical identity/uniqueness rules that are enforced in code but not strongly enough in the database,
- a smaller but real layer of old mock/runtime drift still hanging off important entry points.

The safest next execution order is:
- first make enrollment, intake, and POF post-sign cascades durable and explicit,
- then harden canonical uniqueness at the schema layer,
- then clean up notifications and remaining mock-backed runtime paths.

That sequence reduces the highest production risk first: false operational success in healthcare workflows.
