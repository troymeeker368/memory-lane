# Fix Prompt Generator - 2026-04-06

## 1. Issues Detected

### Coverage Notes
- Reviewed the most recent available artifact for each requested audit family:
- `docs/audits/supabase-rls-security-audit-2026-04-02.md`
- `docs/audits/production-readiness-audit-2026-04-02.md`
- `docs/audits/daily-canonicality-sweep-raw-2026-03-27.json`
- `docs/audits/schema-migration-safety-audit-2026-04-02.md`
- `docs/audits/shared-resolver-drift-check-2026-03-29.md`
- `docs/audits/rpc-architecture-audit-2026-03-24.md`
- `docs/audits/acid-transaction-audit-2026-04-04.md`
- `docs/audits/idempotency-duplicate-submission-audit-2026-03-29.md`
- `docs/audits/workflow-simulation-audit-2026-04-06.md`
- `docs/audits/supabase-query-performance-audit-2026-04-06.md`
- The latest daily canonicality sweep still shows no fresh missing tables, missing RPCs, mock-runtime imports, or banned runtime fallback patterns.
- The latest shared resolver drift check says the narrow member-file, MCC billing, and MHP directory drift items from that pass were fixed.
- The latest idempotency audit says the last low-risk duplicate-write gap in provider and hospital directory writes was fixed. Remaining replay issues now live in staged workflows instead of tiny isolated duplicate-row bugs.
- The latest schema migration safety audit does not show a new repo-side schema drift defect. Its remaining blocker is linked-project migration history repair and remote verification.
- The RPC architecture audit still shows larger consolidation opportunities, but the freshest open work is concentrated in security boundaries, staged workflow truth, queue-backed operational readiness, and query-performance hotspots.

### Open Issues Selected
1. `public.user_permissions` still lacks repo-defined RLS and policies.
2. Public enrollment packet completion still performs too much work before `rpc_finalize_enrollment_packet_submission`, increasing replay waste and cleanup surface.
3. Memory Lane still lacks one shared committed-vs-ready-vs-follow-up-required vocabulary across enrollment, intake, signed POF, and care plan workflows.
4. Queue-backed follow-up for signed POF and enrollment packet completion is still an operational dependency without a strong enough founder-visible health contract.
5. Member-file delete can still leave `member_files` rows pointing to missing storage objects if storage deletion succeeds before the row delete.
6. POF read paths still perform expiration repair one row at a time during list and timeline reads, turning reads into repeated writes.
7. Billing and report date-range reads still filter on `billing_invoices.invoice_date` without a direct supporting index.
8. Enrollment packet sender-name search still uses `profiles.full_name ilike(...)` without a matching trigram index.
9. MHP detail still loads full provider and hospital directory tables into memory when those reference surfaces are requested.
10. Operational reliability snapshots still assemble one dashboard from many separate exact-count and list queries instead of one canonical read model.

## 2. Codex Fix Prompts

### Issue 1. Add database-enforced RLS to `public.user_permissions`

- Violated architectural rule: preserve role restrictions and data integrity; Supabase must be the canonical permission boundary, not just the page-level guard.
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

- Violated architectural rule: workflow state integrity; committed persistence must not be confused with operational readiness; shared resolver/service logic should own this vocabulary.
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
1) Inspect `lib/services/committed-workflow-state.ts`, `lib/services/pof-post-sign-runtime.ts`, `lib/services/intake-pof-mhp-cascade.ts`, `lib/services/enrollment-packet-completion-cascade.ts`, and the care plan follow-up status helpers first.
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

### Issue 4. Make queue-runner health a release-safety contract for staged follow-up

- Violated architectural rule: workflow completion claims are only safe when required downstream operational dependencies are visible and monitored.
- Safest fix approach: keep the queue-backed architecture, but add explicit health/readiness checks and stale-queue visibility instead of assuming cron and secret wiring is healthy.

```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Signed POF downstream sync and enrollment packet follow-up are intentionally queue-backed, but production safety still depends on the internal runner routes and secrets being healthy. Right now queue-runner health is not elevated enough into an explicit release-safety signal.

Scope:
- Domain/workflow: internal runner health for `pof_post_sign_sync_queue` and enrollment packet follow-up/mapping queues
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

### Issue 5. Make member-file delete repair-safe when storage and DB get out of sync

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

### Issue 6. Refactor POF read paths so reads stop doing per-row expiry repair

- Violated architectural rule: read paths should stay read-only where possible; canonical expiry behavior should not depend on repeated write-side side effects during list rendering.
- Safest fix approach: preserve canonical expiry truth, but move repair into an explicit write boundary such as an RPC or maintenance path.

```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
`lib/services/pof-read.ts` still refreshes expired requests by looping through expired rows and calling per-row update plus event insert logic during list/detail reads. That turns reads into repeated writes and creates both performance and side-effect risk.

Scope:
- Domain/workflow: physician order / POF list and timeline reads
- Canonical entities/tables: pof_requests, document_events or related POF event tables, any existing POF maintenance helpers
- Expected canonical path: read path stays read-only; expiry repair runs through one explicit service or RPC boundary

Required approach:
1) Inspect `lib/services/pof-read.ts` first, especially `refreshExpiredRequests` and the read methods that call it.
2) Preserve canonical POF expiry behavior and current user-facing truth for expired requests.
3) Move the expiry repair out of list/detail reads and into one safer explicit boundary, such as:
   - a batch RPC
   - a maintenance service method
   - or another existing canonical write path
4) Keep the final source of truth in Supabase. Do not replace expiry truth with UI-only derivation unless there is already a shared canonical resolver for that meaning.
5) Minimize blast radius. This is a read-path cleanup, not a full POF workflow rewrite.

Validation:
- Run typecheck and report results.
- List changed files and explain the before/after read behavior.
- Call out whether expiry is now repaired lazily elsewhere or derived canonically at read time without side effects.

Do not overengineer. Keep the fix maintainable and auditable.
```

### Issue 7. Add the missing `billing_invoices(invoice_date desc)` index

- Violated architectural rule: migration-driven schema must support real production query paths; common date-range reporting should not rely on avoidable scans.
- Safest fix approach: add one forward-only index aligned to the existing report query shape and keep application behavior unchanged.

```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Admin revenue summary and on-demand billing reports still filter on `billing_invoices.invoice_date` without a direct supporting index. As invoice history grows, those report reads can degrade into broader scans.

Scope:
- Domain/workflow: admin billing and revenue reporting
- Canonical entities/tables: public.billing_invoices
- Expected canonical path: existing shared reporting services backed by migration-defined indexes

Required approach:
1) Inspect `lib/services/admin-reporting-foundation.ts` first where `invoice_date` range filters are applied.
2) Add the smallest safe forward-only migration for:
   `create index if not exists idx_billing_invoices_invoice_date_desc on public.billing_invoices (invoice_date desc);`
3) Confirm the current report predicates and ordering still match that index. Only widen to a composite index if the actual query evidence clearly requires it.
4) Preserve current report behavior and output.

Validation:
- Run typecheck and report results.
- List the migration added.
- Explain which report queries benefit from the index.

Do not overengineer. This is a targeted schema-performance fix.
```

### Issue 8. Add a trigram index for `profiles.full_name`

- Violated architectural rule: migration-driven schema should back the actual search fields used in production; search performance should not depend on broad scans through staff profile names.
- Safest fix approach: add one forward-only trigram index matching the existing sender-name search and leave application behavior unchanged.

```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Enrollment packet sender-name search resolves matches by running `ilike` against `profiles.full_name`, but the repo does not show a matching trigram index for that field. That can turn sender-name search into a profile scan as staff history grows.

Scope:
- Domain/workflow: enrollment packet sender-name search
- Canonical entities/tables: public.profiles
- Expected canonical path: existing shared enrollment packet list support query backed by migrations

Required approach:
1) Inspect `lib/services/enrollment-packet-list-support.ts` first around the `profiles.full_name` search path.
2) Confirm the current query still uses `ilike` against `full_name`.
3) Add the smallest safe forward-only migration for:
   `create index if not exists idx_profiles_full_name_trgm on public.profiles using gin (full_name gin_trgm_ops);`
4) Verify `pg_trgm` support is already present in migrations. If not, add the minimum safe extension setup needed for this index.
5) Preserve current search behavior and result ordering.

Validation:
- Run typecheck and report results.
- List the migration added.
- Explain the exact query branch the index supports.

Do not overengineer. This is a narrow search-index fix.
```

### Issue 9. Narrow MHP reference-directory reads so detail screens stop loading full tables

- Violated architectural rule: shared read paths should avoid avoidable over-fetching; reference directories should stay Supabase-backed without dragging whole tables into memory when a narrower lookup surface is enough.
- Safest fix approach: keep Supabase as source of truth, but replace full-directory loads with tighter shared lookup paths.

```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
`lib/services/member-health-profiles-supabase.ts` still loads the full `provider_directory` and `hospital_preference_directory` tables and sorts them in app memory when those reference surfaces are requested. That is acceptable only while those tables stay tiny.

Scope:
- Domain/workflow: member health profile detail reads
- Canonical entities/tables: provider_directory, hospital_preference_directory, member health profile detail readers
- Expected canonical path: shared service read helper -> Supabase -> UI

Required approach:
1) Inspect `lib/services/member-health-profiles-supabase.ts` first around the provider and hospital directory loads.
2) Identify what the UI actually needs on first render versus what can be fetched lazily or via a narrower search/select path.
3) Replace the current full-table loads with the smallest clean shared lookup path that preserves the same source of truth.
4) Avoid duplicating directory-selection logic in UI components.
5) Keep current behavior intact for selected records and existing directory references.

Validation:
- Run typecheck and report results.
- List changed files and describe the before/after payload shape at a high level.
- Call out any follow-up if the UI still needs an explicit search endpoint or smaller lookup helper.

Do not overengineer. This is a bounded over-fetch reduction.
```

### Issue 10. Consolidate operational reliability into one canonical read model

- Violated architectural rule: one canonical resolver/read path per business concept where possible; dashboards should not spread one snapshot across many separate count and list queries.
- Safest fix approach: keep output behavior the same, but move the summary composition into one stronger read model or RPC-backed aggregation if that materially reduces repeated reads.

```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
`lib/services/operational-reliability.ts` still builds the operational reliability snapshot from many separate exact-count and list queries across the same workflow domains. That keeps performance tuning scattered and prevents one canonical read boundary for this dashboard.

Scope:
- Domain/workflow: operational reliability dashboard
- Canonical entities/tables: discover first from `lib/services/operational-reliability.ts`, but include the workflow queue/status tables currently counted separately
- Expected canonical path: shared service or RPC read model -> Supabase -> UI

Required approach:
1) Inspect `lib/services/operational-reliability.ts` first, especially the summary count and snapshot composition paths.
2) Identify where the current dashboard does repeated exact counts or repeated status queries against the same workflow domains.
3) Replace the multi-query summary with one more canonical read boundary:
   - prefer a shared service read model if the current query set can be consolidated safely
   - use an RPC-backed aggregation if that materially reduces repeated reads without duplicating business logic elsewhere
4) Preserve current output semantics and founder-visible wording.
5) Do not move business-rule logic into the page layer.

Validation:
- Run typecheck and report results.
- List changed files and whether a migration/RPC was added.
- Explain how many summary queries were reduced and what stayed intentionally separate.

Do not overengineer. This is a dashboard read-model consolidation.
```

## 3. Fix Priority Order

1. `public.user_permissions` RLS hardening.
Reason: this remains the clearest confirmed security gap and the only direct database-boundary weakness still open in the latest security audit.

2. Public enrollment packet pre-finalize replay reduction.
Reason: this is a public-link workflow with avoidable duplicate work and cleanup risk under concurrent retry.

3. Shared staged-workflow readiness contract.
Reason: multiple critical workflows still risk staff reading committed state as fully operationally ready.

4. Queue-runner health visibility for signed POF and enrollment follow-up.
Reason: once committed-state truth is honest, operational safety depends on surfacing runner health and stale queue backlog.

5. Member-file delete repair-safety.
Reason: this is a real durability and reconciliation gap, but narrower than the public-flow and workflow-truth items above.

6. POF read-path expiry repair cleanup.
Reason: it is both a performance issue and a read-side side-effect issue on a clinically important workflow.

7. `billing_invoices(invoice_date desc)` index.
Reason: clear near-term reporting scale protection with low implementation risk.

8. `profiles.full_name` trigram index.
Reason: targeted search hardening with clear value, but smaller blast radius than the higher workflow-integrity items.

9. MHP directory over-fetch reduction.
Reason: a real medium-severity performance issue, but less urgent than the queue, read-side side-effect, and index work.

10. Operational reliability read-model consolidation.
Reason: likely high value, but it touches a broader dashboard surface and should follow the narrower higher-signal fixes first.

## 4. Founder Summary

The repo still looks materially safer than the earlier March baseline. The latest canonicality, resolver-drift, idempotency, and schema-safety artifacts did not produce a fresh direct code bug for me to package. I intentionally excluded items the newer audits already say were fixed, so this list is tighter than yesterday's.

The main open work is now concentrated in four areas:
- one real security boundary gap: `user_permissions` RLS
- three staged-workflow integrity gaps: enrollment replay waste, inconsistent readiness vocabulary, and queue-runner health visibility
- one durability gap: member-file delete reconciliation
- a narrower performance cluster: POF read-side expiry writes, two missing indexes, MHP directory over-fetch, and the operational reliability dashboard's fragmented read model

If you want the best next execution order for Codex, start with `user_permissions` RLS, then the public enrollment replay hardening, then the shared readiness contract. After that, move into queue health visibility and the POF read-path cleanup, because those directly affect how safely staff can trust staged clinical workflows in production.
