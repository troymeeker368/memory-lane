# Fix Prompt Generator - 2026-04-24

Source reports:
- `docs/audits/supabase-rls-security-audit-2026-04-24.md`
- `docs/audits/production-readiness-audit-2026-04-24.md`
- `docs/audits/acid-transaction-audit-2026-04-24.md`
- `docs/audits/workflow-simulation-audit-2026-04-24.md`
- `docs/audits/supabase-query-performance-audit-2026-04-24.md`
- `docs/audits/schema-migration-safety-audit-2026-04-02.md`
- `docs/audits/rpc-architecture-audit-2026-03-24.md`
- `docs/audits/shared-resolver-drift-check-2026-03-29.md`
- `docs/audits/idempotency-duplicate-submission-audit-2026-03-29.md`
- `docs/audits/daily-canonicality-sweep-raw-2026-03-27.json`

Notes:
- Daily canonicality, shared resolver drift, and the older idempotency audit did not add a fresh unresolved low-risk bug for this run.
- Schema migration safety is clean repo-side; the open issue is linked-project deployment state.

## 1. Issues Detected

1. Enrollment packet completion still has split-commit, follow-up-truth drift, expired-token replay, and raceable throttling gaps.
Rule violated: ACID transaction safety, workflow state integrity, idempotency/replay safety.

2. Intake Assessment security is still too broad in both RLS and app-layer gating.
Rule violated: preserve role restrictions, Supabase-enforced boundaries, canonical privileged write gating.

3. Legacy support tables still use broad authenticated policies, and `sites`, `lookup_lists`, and `punches_linked_time_punch_review` still lack explicit RLS.
Rule violated: Supabase-first security boundary, schema/runtime policy alignment.

4. MCC detail loading still hydrates privileged `member_files` rows before applying visibility filters.
Rule violated: canonical read boundaries must not pull restricted data and filter later.

5. Production is still blocked by undeployed migrations `0209` through `0223`.
Rule violated: migration-driven schema, schema/runtime alignment, production-readiness gating.

6. Lead activity durability and replay safety are still inconsistent across lead conversion and enrollment-packet sync.
Rule violated: one canonical write path, idempotency, explicit committed-vs-degraded truth.

7. Transportation and sales still contain duplicate resolver logic or fallback branches that mask canonical truth.
Rule violated: shared resolver boundaries, deterministic logic, no fallback masking.

8. Care-plan readiness can still overstate truth on reload failure.
Rule violated: workflow state integrity, explicit readback verification.

9. The biggest read-performance hotspots are still the sales dashboard, billing dashboard/module index, audit trail sort path, and sales directories.
Rule violated: one canonical read path per domain, no duplicated broad scans.

## 2. Codex Fix Prompts

### Issue 1. Enrollment packet atomicity and replay
Safest fix approach:
- Keep one canonical enrollment packet finalize boundary.
- Either move required artifact/follow-up writes under the transactional boundary, or persist one canonical repair owner before returning success.
- Reject expired parent tokens before completed-download token minting.
- Move submit throttling into one atomic RPC or transaction-backed claim path.

Copy-paste prompt:
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Enrollment packet completion still has split-commit behavior and public replay gaps. The packet can finalize before finalized artifacts and follow-up state are durably aligned, an expired parent token can still mint a completed-download token, and submit throttling is still raceable.

Inspect first:
- lib/services/enrollment-packets-public-runtime.ts
- lib/services/enrollment-packets-public-runtime-cascade.ts
- lib/services/enrollment-packets-public-runtime-follow-up.ts
- lib/services/enrollment-packets-public-runtime-context.ts
- lib/services/enrollment-packets-public-runtime-artifacts.ts

Required approach:
1) Preserve the canonical enrollment packet service/RPC boundary.
2) Fix finalize-before-artifacts/follow-up truth with one durable canonical boundary or one persisted repair owner.
3) Reject expired parent tokens before completed-download token minting.
4) Move public submit throttling into an atomic Supabase RPC or transaction-backed claim path.
5) Do not add UI-only patches, mock state, or synthetic success.
6) Add focused tests for post-finalize failure, follow-up-state failure, expired-token download attempts, and concurrent submit attempts.

Validation:
- Run npm run typecheck and targeted tests.
- Report changed files, migration/RPC impact, and rollout dependencies.
```

### Issue 2. Intake Assessment security boundary
Safest fix approach:
- Tighten RLS on `intake_assessments`, `assessment_responses`, and `intake_assessment_signatures`.
- Align history, detail, and create action to one clinical `canView`/`canEdit` boundary.
- Require explicit permission checks before privileged writes.

Copy-paste prompt:
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Intake Assessment security is still inconsistent. Broad RLS lets authenticated staff read/write intake assessment data too widely, the history page is broader than the clinical detail page, and createAssessmentAction still performs privileged writes after role-only gating.

Inspect first:
- app/(portal)/health/assessment/page.tsx
- app/(portal)/health/assessment/[assessmentId]/page.tsx
- app/intake-actions.ts
- intake services and current RLS migrations

Required approach:
1) Preserve the canonical intake service/RPC boundary.
2) Replace broad intake policies with permission-aware or service-only boundaries.
3) Align history and create action to the same clinical canView/canEdit boundary as detail.
4) Require explicit health-unit canEdit before privileged writes.
5) Add tests proving unauthorized authenticated staff cannot read/write cross-member intake data.

Validation:
- Run npm run typecheck and targeted tests.
- Report policy changes, app-layer changes, and downstream intake -> draft POF impact.
```

### Issue 3. Legacy RLS hardening and missing RLS enablement
Safest fix approach:
- Add one forward-only migration for the remaining broad-policy tables and the three missing-RLS tables.
- Preserve canonical service paths and avoid replacing RLS with more service-role reads.

Copy-paste prompt:
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Several legacy support tables still use broad authenticated RLS, and sites, lookup_lists, and punches_linked_time_punch_review still lack explicit repo-defined RLS.

Inspect first:
- current policies for member_photo_uploads, member_providers, member_equipment, member_notes
- enrollment packet staging/mapping/follow-up tables
- care_plan_signature_events and care_plan_diagnoses
- transportation_runs, transportation_run_results, bus_stop_directory, locker_assignment_history
- enrollment pricing tables

Required approach:
1) Add one forward-only migration that enables missing RLS and replaces broad authenticated policies with permission-aware predicates or service-only boundaries.
2) Keep existing canonical service/RPC paths authoritative.
3) Add focused tests for the most sensitive boundaries first.
4) Do not widen service-role usage to compensate for weaker policies.

Validation:
- Run npm run typecheck and targeted tests.
- Report hardened tables, intended access boundaries, and any runtime call sites adjusted.
```

### Issue 4. MCC privileged file hydration
Safest fix approach:
- Reuse the same category-permission helper for paged and detail reads.
- Push filters into the query before hydration.
- Remove duplicate category logic if present.

Copy-paste prompt:
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Member Command Center detail loading still reads privileged member_files rows first and filters clinical categories later.

Inspect first:
- lib/services/member-command-center-runtime.ts
- lib/services/member-command-center-detail-read-model.ts
- app/(portal)/operations/member-command-center/_actions/files.ts
- lib/services/member-files.ts

Required approach:
1) Keep one canonical permission-aware member-file read path.
2) Push category/actor visibility constraints into the query boundary before hydration.
3) Preserve the current safer paged behavior.
4) Remove duplicate category-classification logic if a shared helper already exists.
5) Add tests proving non-clinical actors never hydrate restricted clinical rows through the detail path.

Validation:
- Run npm run typecheck and relevant tests.
- Report changed files and any remaining intentional service-role usage.
```

### Issue 5. Pending migration deployment
Safest fix approach:
- Treat this as environment alignment, not a runtime refactor.
- Apply the missing migrations to the linked Supabase project, then regenerate types and rerun checks.

Copy-paste prompt:
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Important hardening migrations through 0223 exist locally but are not yet active in the linked Supabase project.

Inspect first:
- the repo's canonical db check workflow
- migration state for 0209 through 0223

Required approach:
1) Confirm exactly which migrations are pending remotely.
2) Repair/apply the migration sequence safely in the linked Supabase project.
3) Regenerate types only after migration state is correct.
4) Re-run the repo's db verification commands and report what is now active remotely.
5) Do not change runtime code unless deployment exposes a real schema/runtime mismatch.

Validation:
- Run the repo's db checks and db:types if needed.
- Report exact migrations applied and any blockers.
```

### Issue 6. Lead activity durability and idempotency
Safest fix approach:
- Preserve the safer current ordering where conversion happens before activity logging.
- Stop returning plain failure once conversion already committed.
- Extend DB-backed idempotency to enrollment-packet lead activity sync.

Copy-paste prompt:
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Lead conversion can still commit before lead activity logging, and enrollment-packet lead activity sync still uses weaker replay protection than the newer sales activity path.

Inspect first:
- lib/services/sales-lead-activities.ts
- lib/services/sales-lead-conversion-supabase.ts
- lib/services/enrollment-packet-mapping-runtime.ts
- migration 0222 and related lead-activity migrations

Required approach:
1) Preserve conversion-before-activity ordering.
2) Stop returning a plain failure once conversion already committed; return committed identifiers plus degraded/follow-up-needed truth instead.
3) Extend DB-backed replay safety to the enrollment-packet lead activity sync path.
4) Keep one canonical lead-activity insert boundary.
5) Add tests for committed conversion + failed activity insert and replayed enrollment-packet lead activity sync.

Validation:
- Run npm run typecheck and targeted tests.
- Report code changes, migration changes, and rollout dependency on 0222 or newer migration work.
```

### Issue 7. Transportation and sales fallback masking
Safest fix approach:
- Consolidate transportation rider-eligibility logic into one shared helper.
- Replace silent `transport_type` coercion with explicit normalization/failure.
- Remove sales detail fallback branches that hide canonical mismatch.

Copy-paste prompt:
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Transportation and sales still contain duplicated resolver logic and fallback branches that can mask canonical truth. Transportation rider eligibility is duplicated, invalid/null transport_type can silently become Door to Door, and sales detail read models still keep fallback query branches that hide schema or identity drift.

Inspect first:
- transportation services used by station and run-manifest builds
- sales lead detail and partner detail read models
- any existing shared resolver intended to be authoritative

Required approach:
1) Consolidate duplicated transportation logic into one shared helper.
2) Replace silent transport_type coercion with explicit normalization plus explicit failure or degraded handling.
3) Remove sales fallback query branches that currently mask canonical mismatch.
4) Preserve existing valid behavior for correct inputs.
5) Add focused tests for shared transportation truth and explicit sales failure on canonical mismatch.

Validation:
- Run npm run typecheck and relevant tests.
- Report changed files, downstream consumers, and any migration need.
```

### Issue 8. Care-plan readiness truth
Safest fix approach:
- Keep the current valid committed states, including `signed_pending_caregiver_dispatch`.
- Remove any ready-state fallback after reload verification fails.

Copy-paste prompt:
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Care-plan readiness can still overstate truth on reload failure. buildPersistedCarePlanActionState still has a ready-state fallback path that can imply the workflow is ready even when persisted reload verification failed.

Inspect first:
- lib/services/care-plans-supabase.ts
- related care-plan action-state/readiness helpers

Required approach:
1) Preserve valid committed states, including signed_pending_caregiver_dispatch.
2) Remove any fallback that reports ready when persisted readback failed.
3) Return explicit degraded/follow-up-needed truth instead.
4) Keep one canonical readiness helper or resolver.
5) Add tests for write success plus reload failure.

Validation:
- Run npm run typecheck and relevant tests.
- Report changed files and any UI/status copy impact.
```

### Issue 9. Highest-cost read-path hardening
Safest fix approach:
- Keep one canonical read boundary per domain.
- Remove the duplicate billing batch fetch first.
- Add the straightforward missing indexes.
- Slim the sales dashboard summary RPC only where the audit confirmed real broad work.

Copy-paste prompt:
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
The highest-cost founder-facing read paths are still the sales dashboard summary RPC, the billing dashboard/module index, and a few missing indexes for audit-log and sales-directory sorts.

Inspect first:
- sales dashboard summary RPC + caller
- lib/services/billing-read-supabase.ts
- lib/services/admin-audit-trail.ts
- lib/services/sales-crm-read-model.ts

Required approach:
1) Preserve one canonical read boundary per domain.
2) Remove the duplicate getBillingBatches() fetch from getBillingModuleIndex().
3) Slim the sales dashboard summary RPC only where the audit confirmed broad whole-table work.
4) Add forward-only indexes for:
   - audit_logs(created_at desc)
   - community_partner_organizations(organization_name)
   - referral_sources(organization_name)
5) Keep founder-facing numbers and list behavior unchanged.

Validation:
- Run npm run typecheck and relevant tests.
- Report changed files, new migrations, and any intentionally deferred hotspots.
```

## 3. Fix Priority Order

1. Enrollment packet atomicity, follow-up truth, expired-token replay, and atomic throttling
2. Intake Assessment end-to-end security hardening
3. Deploy pending Supabase migrations `0209` through `0223`
4. Lead activity durability and replay safety
5. Legacy support-table RLS hardening plus missing RLS enablement
6. MCC privileged file-read hardening
7. Care-plan readiness truth on reload failure
8. Transportation and sales fallback cleanup
9. Query-performance hardening for sales, billing, and missing indexes

## 4. Founder Summary

The repo is safer than earlier in April, but the newest audit set still shows a small number of real production blockers. The biggest one is still enrollment packet completion: it can commit before all downstream artifacts and follow-up truth are durably aligned, and the same public flow still has replay/race gaps. Intake Assessment is the clearest current security issue because both the RLS layer and the app layer are broader than the real clinical boundary.

The stale audit families did not add fresh open bugs for this run. The daily canonicality sweep still shows no runtime mock persistence or missing runtime schema objects. The older shared resolver drift and idempotency audits mostly confirm earlier fixes already landed. The schema migration safety audit is clean repo-side, but production is still blocked until the linked Supabase project actually applies the newer migrations.

If you only do three things first:
1. fix enrollment packet atomicity/replay truth
2. tighten Intake Assessment end to end
3. deploy the pending Supabase migrations so the current hardening is real in production
