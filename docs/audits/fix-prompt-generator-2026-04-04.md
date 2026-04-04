# Fix Prompt Generator - 2026-04-04

## 1. Issues Detected

### Coverage Notes
- Reviewed the latest available artifact for each requested stream:
- `docs/audits/supabase-rls-security-audit-2026-04-02.md`
- `docs/audits/production-readiness-audit-2026-04-02.md`
- `docs/audits/daily-canonicality-sweep-raw-2026-03-27.json`
- `docs/audits/schema-migration-safety-audit-2026-04-02.md`
- `docs/audits/shared-resolver-drift-check-2026-03-29.md`
- `docs/audits/rpc-architecture-audit-2026-03-24.md`
- `docs/audits/acid-transaction-audit-2026-04-04.md`
- `docs/audits/idempotency-duplicate-submission-audit-2026-03-29.md`
- `docs/audits/workflow-simulation-audit-2026-04-04.md`
- `docs/audits/supabase-query-performance-audit-2026-04-04.md`
- The latest daily canonicality sweep did not surface a fresh runtime schema drift, mock-runtime path, or banned fallback pattern.
- The latest shared resolver drift check says its focused drift bugs were fixed in that run and did not leave a fresh low-risk resolver bug open.
- The latest idempotency audit says the last narrow low-risk duplicate-write defect was already fixed. Remaining replay issues are larger staged-workflow problems, not tiny patch candidates.
- The latest production-readiness audit still mentions custom-invoice atomicity risk, but the newer schema safety audit shows `0178_harden_custom_invoice_rpc_atomicity.sql` exists. I did not promote that item into a fresh prompt because the audit stream is internally stale and needs re-verification before more code churn.

### Open Issues Selected
1. `public.user_permissions` still lacks repo-defined RLS and policies.
2. Public enrollment packet completion still does too much irreversible work before the finalize RPC, increasing replay waste and cleanup risk.
3. Memory Lane still lacks one shared committed-vs-ready vocabulary across enrollment, intake, signed POF, and care plan staged workflows.
4. Member-file delete can still leave database/storage drift if storage deletion succeeds before the row delete.
5. Signed POF operational readiness still depends on queue runner health, and that health is not yet elevated into a founder-visible release-safety contract.
6. MAR exception alerts can still disappear if the medication write succeeds but notification delivery fails.
7. MAR read models still rely on date-function-heavy views that do not line up well with current indexes.
8. Care plan "latest for member" reads are duplicated and missing the index that matches their real sort path.
9. MHP and progress-note reporting still over-fetch history instead of using tighter canonical read models.
10. Linked Supabase migration history still needs repair and verification through the committed `0175` to `0178` sequence.

## 2. Codex Fix Prompts

### Issue 1. Add database-enforced RLS to `public.user_permissions`

- Violated architectural rule: preserve role restrictions and data integrity; Supabase must be the canonical permission boundary, not only app-layer guards.
- Safest fix approach: add a forward-only migration enabling RLS on `public.user_permissions` with explicit admin and service-role policies while preserving the current canonical user-management service path.

```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
The canonical staff permission override table `public.user_permissions` is used by the live user-management flow but still has no repo-defined RLS enablement or policies. That leaves the table relying too much on app-layer admin checks instead of a database-enforced boundary.

Scope:
- Domain/workflow: user management / staff permission overrides
- Canonical entities/tables: public.user_permissions
- Expected canonical write path: admin UI -> server action/service -> Supabase admin path for writes

Required approach:
1) Inspect `supabase/migrations/0002_rbac_roles_permissions.sql` and `lib/services/user-management.ts` first.
2) Add a forward-only migration that:
   - enables RLS on `public.user_permissions`
   - grants only the intended admin/service-role access
   - avoids broad authenticated policies
3) Keep the current canonical user-management service write path intact. Do not move permission logic into UI code.
4) If `roles` or `role_permissions` are already real runtime dependencies, note whether they need follow-up hardening. Do not widen scope unless the runtime clearly depends on them.
5) Document any live-project verification that cannot be proven from repo code alone.

Validation:
- Run typecheck and report results.
- List the migration added and any service/page files touched.
- Explain how admin-only reads/writes are enforced after the change.

Do not overengineer. This is a database-boundary hardening fix.
```

### Issue 2. Reduce pre-finalize replay work in public enrollment packet completion

- Violated architectural rule: public-link workflows must be idempotent and replay-safe; irreversible work should stay behind the canonical finalize boundary where possible.
- Safest fix approach: keep `rpc_finalize_enrollment_packet_submission` authoritative, but move or dedupe non-essential pre-finalize artifact work so replay losers do less work.

```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
The public enrollment packet submit flow still uploads signature/artifact payloads and other staged work before `rpc_finalize_enrollment_packet_submission`. If two submits happen close together, both can do expensive staging work before only one wins finalization.

Scope:
- Domain/workflow: public enrollment packet completion
- Canonical entities/tables: enrollment_packet_requests, enrollment_packet_uploads, enrollment_packet_signatures, enrollment_packet_events, member_files
- Expected canonical write path: public action -> service layer -> finalize RPC -> explicit post-commit follow-up

Required approach:
1) Inspect `lib/services/enrollment-packets-public-runtime.ts` and any helper modules it calls for uploads/artifacts before finalize.
2) Identify exactly which work is truly required before `rpc_finalize_enrollment_packet_submission` and which work can move after finalize or be deduped more tightly.
3) Keep the finalize RPC as the authoritative token-consuming persistence boundary.
4) Reduce replay waste so a near-simultaneous loser does minimal pre-finalize work and deterministic cleanup.
5) Preserve current committed-state-safe behavior after finalize. Do not reintroduce false failure after commit.
6) Add focused regression coverage for two near-simultaneous submits against the same packet token.

Validation:
- Run typecheck and report results.
- List changed files and describe the before/after replay behavior.
- Call out any artifact work that must remain pre-finalize and why.

Do not overengineer. Keep this a bounded public-flow hardening pass.
```

### Issue 3. Add one shared readiness contract across staged workflows

- Violated architectural rule: workflow state integrity; "committed" must not be confused with "operationally ready"; shared resolver/service logic should own this vocabulary.
- Safest fix approach: introduce or extend one shared committed/readiness resolver contract and align enrollment, intake, signed POF, and care plan surfaces to it.

```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Memory Lane still represents staged workflow truth differently across enrollment packet completion, intake post-sign follow-up, signed POF downstream sync, and care plan post-sign follow-up. Staff can still misread signed/completed state as fully ready when downstream work is queued or degraded.

Scope:
- Domain/workflow: staged workflow readiness across enrollment, intake, POF, and care plans
- Canonical entities/tables: discover first, but start with the existing committed/follow-up status fields already used in these workflows
- Expected canonical path: server action -> shared workflow service/resolver -> Supabase-backed truth

Required approach:
1) Inspect `lib/services/committed-workflow-state.ts`, `lib/services/pof-post-sign-runtime.ts`, `lib/services/intake-pof-mhp-cascade.ts`, and the enrollment/care-plan follow-up status helpers first.
2) Identify the current status vocabulary each workflow uses and where the meanings diverge.
3) Add one shared founder-readable readiness contract that clearly distinguishes:
   - committed
   - ready
   - follow-up-required
   - queued/degraded
4) Keep existing durable writes and queue-backed staged workflows intact. Do not fake synchronous completion.
5) Update only the shared helpers and the consumers that display/return these statuses so downstream truth stays consistent.

Validation:
- Run typecheck and report results.
- List the shared resolver/helper added or updated.
- Show the final common readiness vocabulary and where it is now used.

Do not overengineer. This is a cross-workflow truth-alignment fix, not a rewrite.
```

### Issue 4. Make member-file delete repair-safe when storage and DB get out of sync

- Violated architectural rule: durability and auditability; success must not be claimed early, but cleanup drift also needs a deterministic repair path.
- Safest fix approach: preserve no-false-success behavior and add a tombstone, repair queue, or similarly explicit reconciliation path when storage delete succeeds before DB row delete.

```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
`lib/services/member-files.ts` currently deletes the storage object before deleting the database row. If storage deletion succeeds but the DB delete fails, the system can be left with a `member_files` row pointing to a missing object.

Scope:
- Domain/workflow: member file deletion
- Canonical entities/tables: member_files, document_events or any existing file/audit queue table, member-documents bucket
- Expected canonical write path: service layer -> Supabase/storage -> explicit durable result

Required approach:
1) Inspect the member-file delete flow in `lib/services/member-files.ts` first.
2) Preserve the current no-false-success contract. Do not return success if the row delete fails.
3) Add the smallest clean repair-safe contract so drift is explicit and auditable when storage is gone but the row remains.
4) Prefer an existing audit/repair queue pattern if one already exists in the repo. If not, add the narrowest possible durable repair signal.
5) Do not add runtime mock cleanup or UI-only patch logic.

Validation:
- Run typecheck and report results.
- Explain the new failure/repair behavior.
- List any schema change, queue table reuse, or event logging added.

Do not overengineer. This is a reconciliation-safety fix.
```

### Issue 5. Make queue-runner health a real release-safety contract for signed POF and enrollment follow-up

- Violated architectural rule: workflow completion claims are only safe when required downstream operational dependencies are visible and monitored.
- Safest fix approach: keep the queue-backed architecture, but add explicit health/readiness checks and stale-queue visibility instead of assuming cron/secret wiring is healthy.

```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Signed POF downstream sync and enrollment follow-up are intentionally queue-backed, but production safety still depends on the internal runner routes and secrets being healthy. Right now queue-runner health is not elevated enough into an explicit release-safety signal.

Scope:
- Domain/workflow: internal runner health for `pof_post_sign_sync_queue` and enrollment follow-up/mapping queues
- Canonical entities/tables: pof_post_sign_sync_queue, enrollment packet follow-up/mapping queue tables, any existing operational alert tables
- Expected canonical path: queue-backed workflow -> internal runner route -> durable status/alert visibility

Required approach:
1) Inspect `app/api/internal/pof-post-sign-sync/route.ts`, `app/api/internal/enrollment-packet-mapping-sync/route.ts`, and the queue read/write helpers first.
2) Identify what founder-visible signal exists today for stale queue age, missing secrets, or runner inactivity.
3) Add the smallest clean health contract so stale queue age or missing runner config becomes explicit and auditable.
4) Keep the queue-backed staged workflow design. Do not force synchronous downstream work.
5) Reuse existing notifications/alerts/milestone infrastructure where appropriate instead of inventing a parallel monitoring system.

Validation:
- Run typecheck and report results.
- Explain how a founder/operator can now tell if queued work is healthy, delayed, or misconfigured.
- List any env assumptions that still cannot be proven locally.

Do not overengineer. This is operational safety and visibility hardening.
```

### Issue 6. Harden MAR exception alerts so follow-up cannot disappear on notification failure

- Violated architectural rule: required downstream side effects for medication exceptions must be durable and auditable; console logging alone is not sufficient.
- Safest fix approach: keep the medication write canonical and add a durable fallback alert/repair record when exception notification delivery fails.

```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
In MAR exception paths, the medication administration write commits first, then the follow-up alert can fail and only log to the server console. That means a `Not Given` dose or ineffective PRN can lose its escalation signal.

Scope:
- Domain/workflow: MAR scheduled exception follow-up and ineffective PRN follow-up
- Canonical entities/tables: mar_administrations, user_notifications, workflow milestone/alert tables already used by the repo
- Expected canonical write path: MAR service/RPC -> durable medication write -> durable alert or explicit repair-needed record

Required approach:
1) Inspect `lib/services/mar-workflow.ts` and `lib/services/mar-prn-workflow.ts` first.
2) Find the exact exception paths where failed follow-up notification work falls back to `console.error` only.
3) Preserve the current durable MAR write boundary.
4) Add a durable fallback so failed alert delivery creates a system alert, queue item, or other repair-safe record instead of disappearing.
5) Reuse existing workflow milestone or notification infrastructure if possible.
6) Keep the result contract truthful about medication write success versus alert follow-up degradation.

Validation:
- Run typecheck and report results.
- Describe the new behavior for `Not Given` and ineffective PRN paths.
- List the durable fallback record/table used.

Do not overengineer. This is a clinical follow-up durability fix.
```

### Issue 7. Rewrite MAR read models so Postgres can use indexes cleanly

- Violated architectural rule: production-readiness and maintainability; canonical Supabase reads should not rely on query shapes that defeat the indexes the workflow depends on.
- Safest fix approach: rewrite the heavy MAR views or replace them with one canonical read model that filters by explicit Eastern day boundaries, then add the missing `mar_administrations` indexes.

```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
MAR today/overdue/history reads still depend on views that apply date functions directly to indexed timestamp columns. That makes the query planner more likely to miss the current indexes as data grows.

Scope:
- Domain/workflow: MAR dashboard and MAR workflow reads
- Canonical entities/tables: v_mar_today, v_mar_overdue_today, v_mar_administration_history, mar_administrations, mar_schedules
- Expected canonical read path: shared MAR read model -> Supabase/view or RPC -> UI

Required approach:
1) Inspect `lib/services/mar-workflow-read.ts`, `lib/services/mar-dashboard-read-model.ts`, and the migrations that define the MAR views first.
2) Rewrite the view/RPC filtering so it uses explicit Eastern-day start/end timestamp boundaries instead of `timezone(column)::date` style filters.
3) Add the smallest forward-only migration(s) needed for:
   - `mar_administrations(status, administration_date desc, administered_at desc)`
   - `mar_administrations(administered_at desc)`
4) Keep Supabase as the source of truth and preserve current screen behavior.
5) Update all current MAR consumers only as needed to stay on one canonical read path.

Validation:
- Run typecheck and report results.
- List the migration(s) added.
- Explain how the new query shape lines up with the indexes.

Do not overengineer. Focus on planner-friendly query shapes and minimal runtime churn.
```

### Issue 8. Add the care plan latest-row index and consolidate duplicated latest-plan helpers

- Violated architectural rule: shared read logic should be canonical and not duplicated across helpers; schema/runtime alignment should support the actual sort path used in production.
- Safest fix approach: add the missing composite index and route the duplicated latest-plan lookups through one shared helper or read model.

```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Care plan readers repeatedly ask for "latest plan for this member" by sorting on `review_date` and `updated_at`, but there is no matching `(member_id, review_date desc, updated_at desc)` index and the latest-row logic is duplicated across helpers.

Scope:
- Domain/workflow: care plan latest-row reads
- Canonical entities/tables: public.care_plans
- Expected canonical read path: shared care plan read model/helper -> Supabase

Required approach:
1) Inspect `lib/services/care-plans-read-model.ts` first, especially the latest-plan helpers called by summary/detail consumers.
2) Add a forward-only migration for:
   - `create index if not exists idx_care_plans_member_review_updated_desc on public.care_plans (member_id, review_date desc, updated_at desc);`
3) Consolidate the duplicated latest-plan lookup logic onto one shared helper or canonical read path.
4) Preserve current behavior for member overview, summary, and latest-id consumers.
5) Do not create multiple competing helpers after the change.

Validation:
- Run typecheck and report results.
- List the helpers consolidated and the migration added.
- Explain which downstream consumers now share the same canonical lookup path.

Do not overengineer. This is an index-plus-read-path cleanup.
```

### Issue 9. Stop over-fetching MHP assessments and progress-note history

- Violated architectural rule: canonical read models should return the data the screen actually needs, not large history sets filtered in application memory.
- Safest fix approach: replace history-heavy reads with tighter SQL/RPC-backed summaries that preserve canonical member resolution and current UI behavior.

```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
The Member Health Profile index still loads all intake assessments for paged members and then keeps only the latest one in memory. The reports home also pulls full progress note history for up to 200 members instead of using a tighter summary read model.

Scope:
- Domain/workflow: MHP index and reports home read performance
- Canonical entities/tables: intake_assessments, progress_notes, members and the existing progress-note tracker read model
- Expected canonical read path: shared service or RPC-backed read model -> Supabase

Required approach:
1) Inspect `lib/services/member-health-profiles-supabase.ts`, `lib/services/reports.ts`, and `lib/services/progress-notes-read-model.ts` first.
2) Replace the MHP assessment history fetch with a query/RPC that returns only the latest relevant assessment per member.
3) Replace reports-home full progress-note history loading with the existing progress-note tracker read model or a narrow summary RPC if needed.
4) Preserve current UI outputs and canonical member resolution.
5) Do not move filtering logic into page components.

Validation:
- Run typecheck and report results.
- List the read paths changed and whether an RPC or SQL rewrite was used.
- Explain the before/after data volume at a high level.

Do not overengineer. This is an over-fetch reduction pass.
```

### Issue 10. Repair linked-project migration history and verify the ordered `0175` to `0178` set

- Violated architectural rule: migration-driven schema is the contract; runtime safety depends on the target Supabase project recognizing the same ordered migration history as the repo.
- Safest fix approach: repair remote history to match the committed filenames, then rerun migration verification before treating the environment as production-ready.

```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
The local migration set is now clean through `0178`, but the latest schema migration safety audit still says linked-project migration history repair is required before production signoff.

Scope:
- Domain/workflow: Supabase migration history / environment alignment
- Canonical entities/tables: not a runtime table bug; this is linked-project schema history through migrations `0175` to `0178`
- Expected canonical path: committed forward-only migrations -> linked Supabase project -> verified applied history

Required approach:
1) Inspect the current migration files `0175` through `0178` and the repo's Supabase verification scripts/commands first.
2) Determine what the linked project currently thinks is applied versus what the repo now commits.
3) Repair the linked project history so the applied sequence matches the committed ordered filenames.
4) Re-run the repo's migration verification checks after repair.
5) Do not rename or reshuffle committed migrations again unless the verification evidence requires it.

Validation:
- Report exactly what was out of sync.
- List the commands run and their results.
- Confirm whether the linked project now recognizes the committed `0175` to `0178` sequence cleanly.

Do not overengineer. This is an environment-history alignment fix.
```

## 3. Fix Priority Order

1. MAR exception alert durability.
Reason: this is the clearest clinical safety gap because a medication exception can save successfully while the follow-up signal disappears.

2. `public.user_permissions` RLS hardening.
Reason: the canonical permission override table still lacks the database boundary expected for a healthcare operations platform.

3. Public enrollment packet pre-finalize replay reduction.
Reason: it is a public-link flow with avoidable duplicate work and cleanup surface under concurrent retry.

4. Shared staged-workflow readiness contract.
Reason: multiple domains still risk staff misreading committed state as fully operationally ready.

5. Queue-runner health visibility for signed POF and enrollment follow-up.
Reason: these workflows are intentionally staged, so operational safety now depends on visible runner health rather than code-path correctness alone.

6. Member-file delete repair-safety.
Reason: this is a real durability/reconciliation gap, but lower immediate harm than the alerting and permission boundary issues above.

7. MAR read-model performance rewrite plus indexes.
Reason: this is the highest-impact query-planning risk and should be fixed before production data volumes grow further.

8. Care plan latest-row index plus helper consolidation.
Reason: smaller than the MAR issue, but straightforward and worth doing once the more urgent safety items are closed.

9. MHP and progress-note over-fetch reduction.
Reason: confirmed performance debt, but less urgent than the canonical safety and alerting items.

10. Linked-project migration history repair.
Reason: still a production signoff blocker, but it depends on environment access and should be executed alongside release preparation.

## 4. Founder Summary

The repo is safer than it was yesterday, but the remaining work is now about hardening real production edges instead of chasing obvious fake-success bugs.

The highest-value fixes are:
- make MAR exception alerts durable
- close the `user_permissions` database security gap
- reduce replay waste in public enrollment completion
- make staged workflow readiness impossible to misread

I did not generate prompts for older resolver-drift, canonicality, or idempotency items that the latest reports already say were fixed or no longer present. I also did not push a new custom-invoice code prompt because the freshest evidence is mixed: production-readiness still flags it, but schema safety shows a newer atomicity migration already landed. That item needs re-audit before more churn.

If you want the best next execution order for Codex, start with MAR exception alerts and `user_permissions` RLS, then move to enrollment replay hardening and shared readiness vocabulary. Those four changes improve clinical safety, security, and operational truth with the least architectural risk.
