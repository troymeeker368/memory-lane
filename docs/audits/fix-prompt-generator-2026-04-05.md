# Fix Prompt Generator - 2026-04-05

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
- `docs/audits/workflow-simulation-audit-2026-04-05.md`
- `docs/audits/supabase-query-performance-audit-2026-04-05.md`
- The latest daily canonicality sweep still does not show a fresh direct canonicality defect. It found no missing runtime tables, RPCs, storage buckets, mock-runtime imports, or banned runtime fallback patterns.
- The latest shared resolver drift check says the focused member-file, MCC, and MHP resolver drift items from that run were fixed.
- The latest idempotency audit says the last narrow low-risk duplicate-write defect was fixed. Remaining replay concerns are larger staged-workflow issues, not small standalone duplicate-row bugs.
- The latest schema migration safety audit does not show a fresh repo-side schema drift bug. Its open item is linked-project migration-history verification, which is environment alignment work rather than a new local code defect.
- The older RPC architecture audit still surfaces larger structural consolidation opportunities, but the freshest higher-value work now comes from security, staged workflow truth, operational durability, and query-performance hotspots.

### Open Issues Selected
1. `public.user_permissions` still lacks repo-defined RLS and policies.
2. Public enrollment packet completion still does too much irreversible work before the finalize RPC, increasing replay waste and cleanup risk.
3. Memory Lane still lacks one shared committed-vs-ready vocabulary across enrollment, intake, signed POF, and care plan staged workflows.
4. Member-file delete can still leave database/storage drift if storage deletion succeeds before the row delete.
5. Signed POF and enrollment follow-up still depend on queue-runner health that is not surfaced strongly enough as a release-safety contract.
6. Documentation tracker and reports still bypass tighter canonical progress-note/documentation read models and over-read large row sets.
7. Documentation due-date alerts and ordered tracker reads still lack the due-date index the current query shape needs.
8. Sales follow-up dashboard still does one list query plus four extra count queries over the same `leads` population.
9. Enrollment packet eligible-lead search still uses `caregiver_email ilike` without a matching trigram index.
10. MAR schedule freshness sync still scans too much of the active MHP medication set before deciding which members need reconciliation.

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
1) Inspect `lib/services/enrollment-packets-public-runtime.ts` and the upload/artifact helpers it calls before finalize.
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
5) Reuse existing notifications, alerts, or milestone infrastructure where appropriate instead of inventing a parallel monitoring system.

Validation:
- Run typecheck and report results.
- Explain how a founder/operator can now tell if queued work is healthy, delayed, or misconfigured.
- List any env assumptions that still cannot be proven locally.

Do not overengineer. This is operational safety and visibility hardening.
```

### Issue 6. Harden documentation tracker and reports onto one canonical read model

- Violated architectural rule: shared resolver/read logic should be canonical and not duplicated; large dashboard reads should not rebuild reminder truth in application memory.
- Safest fix approach: paginate the tracker path, reuse the existing progress-note tracker RPC where it fits, and add a documentation-focused shared read model only if the current RPC cannot cleanly serve both consumers.

```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
The documentation dashboard still loads the full `documentation_tracker` table and then loads progress-note reminder source rows for all returned members in app memory. Reports home also rebuilds related reminder state with its own extra `progress_notes` query. This is both a performance problem and a canonical read-model drift problem.

Scope:
- Domain/workflow: documentation tracker and reports home read paths
- Canonical entities/tables: documentation_tracker, progress_notes, members
- Expected canonical read path: shared service/RPC read model -> Supabase -> UI

Required approach:
1) Inspect `lib/services/documentation.ts`, `lib/services/reports.ts`, and `lib/services/progress-notes-read-model.ts` first.
2) Replace the current load-all tracker plus load-all reminder-source pattern with a tighter canonical read path.
3) Paginate `getDocumentationTracker` instead of loading the full table.
4) Reuse the existing progress-note tracker RPC where possible. Only add a new shared read helper or RPC if the documentation screen needs combined data that the current RPC cannot provide cleanly.
5) Keep Supabase as the source of truth and avoid duplicate reminder-state logic in multiple screens.

Validation:
- Run typecheck and report results.
- List the shared helper or RPC now used by both documentation/report consumers.
- Explain the before/after data volume at a high level.

Do not overengineer. This is a canonical read-path hardening pass.
```

### Issue 7. Add the missing documentation due-date index

- Violated architectural rule: migration-driven schema must support real production query paths; dashboard alerts should not rely on broad scans when a narrow index is obvious.
- Safest fix approach: add one forward-only partial index that matches incomplete care-plan due-date reads and ordered tracker lists.

```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Documentation tracker overdue checks and due-date ordered reads still do not have the due-date index their current query shape needs. As data grows, the dashboard alert and tracker list can degrade into wider scans.

Scope:
- Domain/workflow: documentation due-date alerts and tracker ordering
- Canonical entities/tables: public.documentation_tracker
- Expected canonical path: shared service query -> migration-backed index support

Required approach:
1) Inspect the relevant reads in `lib/services/dashboard.ts` and `lib/services/documentation.ts` first.
2) Add a forward-only migration for the smallest safe partial index that matches incomplete care-plan due-date usage, starting from:
   `create index if not exists idx_documentation_tracker_care_plan_due_open on public.documentation_tracker (next_care_plan_due asc, member_id) where care_plan_done = false;`
3) Verify the index still matches the current query predicates/order and adjust only if the real query shape requires it.
4) Do not widen scope into unrelated tracker indexing unless the same query evidence clearly justifies it.

Validation:
- Run typecheck and report results.
- List the migration added.
- Explain which query paths benefit from the index.

Do not overengineer. This is a targeted schema-performance fix.
```

### Issue 8. Replace sales follow-up fan-out counts with one canonical summary path

- Violated architectural rule: one canonical resolver/read path per business concept where possible; the current dashboard repeats the same `leads` work across multiple queries.
- Safest fix approach: extend or reuse the existing sales summary RPC pattern instead of layering more ad hoc counts onto the current page service.

```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
The sales follow-up dashboard still does one paged `leads` query plus four extra count queries over the same filtered population. That is repeated work for one screen and keeps one sales surface off a canonical summary path.

Scope:
- Domain/workflow: sales follow-up dashboard
- Canonical entities/tables: leads, lead_activities and the existing sales summary RPC/read-model layer
- Expected canonical read path: shared sales read model or RPC -> Supabase -> UI

Required approach:
1) Inspect `lib/services/sales-crm-read-model.ts` around the follow-up dashboard reads and compare it to the existing sales summary RPC path used elsewhere.
2) Replace the extra bucket-count fan-out with one canonical summary call.
3) Prefer extending the existing sales summary RPC pattern over creating a second competing summary path.
4) Preserve current UI output, sorting behavior, and filters.
5) Do not move lead-state logic into the page component.

Validation:
- Run typecheck and report results.
- List the service/RPC changes made.
- Explain how many lead queries the page performs before versus after the change.

Do not overengineer. This is a summary-read consolidation.
```

### Issue 9. Add a trigram index for `leads.caregiver_email`

- Violated architectural rule: migration-driven schema should back the actual search fields used in production; email search should not be the unindexed branch inside a canonical lead picker.
- Safest fix approach: add one forward-only trigram index matching the existing `ilike` search and leave application behavior unchanged.

```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
The enrollment packet eligible-lead picker searches `caregiver_email` with `ilike`, but the repo only shows trigram indexes for `member_name` and `caregiver_name`. That means the email-search branch can become the slow part of the picker as `leads` grows.

Scope:
- Domain/workflow: enrollment packet eligible-lead search
- Canonical entities/tables: public.leads
- Expected canonical path: existing shared sales/enrollment lead picker query backed by migrations

Required approach:
1) Inspect the eligible-lead search in `lib/services/sales-crm-read-model.ts`.
2) Confirm the current query still searches `caregiver_email` with `ilike`.
3) Add the smallest safe forward-only migration for:
   `create index if not exists idx_leads_caregiver_email_trgm on public.leads using gin (caregiver_email gin_trgm_ops);`
4) Verify `pg_trgm` support is already present in the project migrations. If not, add the minimum required extension setup safely.
5) Preserve current search behavior and result ordering.

Validation:
- Run typecheck and report results.
- List the migration added.
- Explain the specific query branch the index supports.

Do not overengineer. This is a narrow search-index fix.
```

### Issue 10. Reduce MAR freshness-sync scan width

- Violated architectural rule: canonical background workflows should not scan large active datasets when a narrower indexed boundary can identify the members that actually need work.
- Safest fix approach: add the smallest safe partial index and tighten the read path before considering any larger RPC redesign.

```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
`syncTodayMarSchedules` still loads too much of the active center-administered MHP medication set before deciding which members actually need schedule reconciliation. That is acceptable at small scale but becomes expensive as medication history grows.

Scope:
- Domain/workflow: MAR schedule freshness sync
- Canonical entities/tables: pof_medications, mar_schedules, any existing MAR sync/read helpers
- Expected canonical path: shared MAR workflow read helper -> Supabase -> reconciliation workflow

Required approach:
1) Inspect `lib/services/mar-workflow-read.ts` around `syncTodayMarSchedules`.
2) Confirm which filters define the current sync candidate set and how much of that narrowing happens in memory instead of in SQL.
3) Add the smallest safe partial index if the current query shape justifies it, starting from the audit suggestion:
   `create index if not exists idx_pof_medications_mhp_mar_sync on public.pof_medications (member_id, updated_at desc) where active = true and given_at_center = true and prn = false and source_medication_id like 'mhp-%';`
4) Tighten the read path so the workflow scans less data before deciding which members need regeneration.
5) Preserve current reconciliation correctness and canonical MAR generation behavior.

Validation:
- Run typecheck and report results.
- List any migration added and any query shape changed.
- Explain the before/after scan boundary at a high level.

Do not overengineer. This is a bounded performance hardening pass.
```

## 3. Fix Priority Order

1. `public.user_permissions` RLS hardening.
Reason: this is the clearest confirmed security gap and the only direct database-boundary issue still open from the latest security audit.

2. Public enrollment packet pre-finalize replay reduction.
Reason: it is a public-link flow with avoidable duplicate work and cleanup surface under concurrent retry.

3. Shared staged-workflow readiness contract.
Reason: multiple domains still risk staff misreading committed state as fully operationally ready.

4. Queue-runner health visibility for signed POF and enrollment follow-up.
Reason: once committed-state truth is honest, operational safety depends on visible runner health rather than hidden queue lag.

5. Member-file delete repair-safety.
Reason: this is a real durability/reconciliation gap, but narrower than the security and workflow-truth items above.

6. Documentation tracker/report canonical read-path hardening.
Reason: this is now the highest-value confirmed read-performance and duplicated-logic issue in the repo.

7. Documentation due-date index.
Reason: simple, low-risk schema support for an already-confirmed hot query path.

8. Sales follow-up summary consolidation.
Reason: repeated `leads` reads are wasteful, but lower urgency than the workflow integrity and documentation tracker issues.

9. `leads.caregiver_email` trigram index.
Reason: targeted search hardening with clear value, but smaller blast radius than the items above.

10. MAR freshness-sync scan reduction.
Reason: confirmed likely near-term scaling risk, but less urgent than the now-clearer documentation and sales read hotspots.

## 4. Founder Summary

The repo is materially cleaner than the earlier March runs. The latest canonicality, resolver-drift, idempotency, and schema-safety artifacts did not produce a new direct code bug for me to package. I intentionally did not generate prompts for issues those newer audits already say were fixed.

The still-open work is concentrated in four areas:
- one real security boundary gap: `user_permissions` RLS
- two staged-workflow integrity gaps: enrollment replay waste and inconsistent committed-vs-ready vocabulary
- one durability gap: member-file delete reconciliation
- a new main performance cluster: documentation tracker/report reads, then sales follow-up and a few targeted indexes

If you want the best next execution order for Codex, start with `user_permissions` RLS, then public enrollment replay hardening, then the shared readiness contract. After that, move into the documentation tracker/report read-model work, because that is now the clearest remaining query-performance hotspot in the latest 2026-04-05 audit evidence.
