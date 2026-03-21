# Fix Prompt Generator Report
Generated: 2026-03-21

## 1. Issues Detected

Coverage note:
- Reviewed the newest available in-repo reports for:
  - `docs/audits/acid-transaction-audit-2026-03-21.md`
  - `docs/audits/production-readiness-audit-2026-03-21.md`
  - `docs/audits/query-performance-audit-2026-03-21.md`
  - `docs/audits/workflow-simulation-audit-2026-03-21.md`
  - `docs/audits/supabase-schema-compatibility-audit-2026-03-11.md` as the latest migration-safety/schema-alignment artifact
- No new standalone March 21 markdown reports were present in-repo for:
  - Supabase RLS & Security Audit
  - Daily Canonicality Sweep
  - Shared Resolver Drift Check
  - Shared RPC Architecture Audit
  - Idempotency & Duplicate Submission Audit
- The March 21 ACID and workflow reports still surface cross-category issues that overlap canonicality, RPC-boundary, and replay-safety rules. No separate standalone findings were invented for missing report files.
- The March 21 Production Readiness Audit records two scoped fixes as already remediated in the working tree:
  - pricing history read moved behind a canonical service boundary
  - MCC reduced-schema fallback removed so schema drift fails explicitly

### 1. Enrollment packet downstream mapping is still split across canonical boundaries
- Sources:
  - `acid-transaction-audit-2026-03-21.md`
  - `workflow-simulation-audit-2026-03-21.md`
- Violated rules:
  - ACID transaction requirements
  - Shared RPC standard
  - Workflow state integrity
  - One canonical write path per workflow
- Why this is still open:
  - The packet can be filed and `mapping_sync_status` can look complete before contact and payor writes finish.
  - Contact writes still happen outside the conversion RPC and can drift under retry/replay.
- Safest fix:
  - Move contact and payor handoff behind one canonical RPC/service-owned transaction boundary.
  - Only mark mapping complete after every required downstream write commits.

### 2. Public enrollment packet submit still hides the true downstream state
- Sources:
  - `acid-transaction-audit-2026-03-21.md`
  - `workflow-simulation-audit-2026-03-21.md`
- Violated rules:
  - Workflow truth must match durable state
  - No synthetic success when required downstream effects are still pending
  - Auditability
- Why this is still open:
  - The public action still returns plain success semantics instead of exposing whether downstream mapping is complete, pending, or failed.
- Safest fix:
  - Return the real canonical downstream status from the action and keep `filed` separate from `operationally ready`.

### 3. Signed intake follow-up still depends on manual repair instead of durable queued ownership
- Sources:
  - `acid-transaction-audit-2026-03-21.md`
  - `workflow-simulation-audit-2026-03-21.md`
- Violated rules:
  - Durability
  - Workflow state integrity
  - Clear operational ownership for failed downstream steps
- Why this is still open:
  - Draft POF creation and intake PDF persistence can fail after signature completion and currently rely on alerting/error text instead of a durable repair queue.
- Safest fix:
  - Keep the staged workflow, but create a canonical retry/action-required queue owned by the service layer.

### 4. Signed POF completion still does not expose downstream sync truth to callers
- Sources:
  - `acid-transaction-audit-2026-03-21.md`
  - `workflow-simulation-audit-2026-03-21.md`
- Violated rules:
  - Workflow truth must reflect downstream clinical sync state
  - Shared service boundaries must remain authoritative
- Why this is still open:
  - Legal signature completion can succeed while MHP/MCC/MAR sync is queued or retrying, but the caller is not told that state.
- Safest fix:
  - Return post-sign sync status and retry metadata from the public signing boundary without weakening the existing canonical sync path.

### 5. Search-heavy reads still lack the main production-safe index bundle
- Sources:
  - `query-performance-audit-2026-03-21.md`
- Violated rules:
  - Production readiness
  - Migration-driven schema support for real query shapes
  - Shared resolver/service performance consistency
- Why this is still open:
  - Member search, audit-log area filtering, referral directory search, partner search, and workflow alert de-dup reads still lack index support that matches real runtime predicates.
- Safest fix:
  - Add a small forward-only migration bundle for confirmed trigram and composite indexes, then verify services still use the canonical query paths.

### 6. Sales summary metrics still load the full leads table into app memory
- Sources:
  - `query-performance-audit-2026-03-21.md`
- Violated rules:
  - Production readiness
  - Shared resolver/service boundaries
  - One canonical resolver path for shared business summaries
- Why this is still open:
  - Sales dashboard metrics are still duplicated across modules and built by loading broad lead sets into Node instead of one shared SQL/RPC aggregate.
- Safest fix:
  - Centralize lead summary counts behind one canonical SQL/RPC read model and update all current consumers to use it.

### 7. Member/staff detail and activity snapshot reads still over-fetch history and payload width
- Sources:
  - `query-performance-audit-2026-03-21.md`
- Violated rules:
  - Production readiness
  - Maintainability
  - Shared read-model consistency
- Why this is still open:
  - Member detail, staff detail, and activity snapshot services still read many wide history tables with `select("*")`, incomplete limits, and incomplete member/date or staff/date index coverage.
- Safest fix:
  - Page and trim these histories inside canonical read services first, then add only the confirmed supporting indexes for the remaining query shapes.

## 2. Codex Fix Prompts

### Prompt 1
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Enrollment packet downstream mapping is still split across canonical boundaries, so the packet can look fully handed off before contact and payor writes are durably complete.

Scope:
- Domain/workflow: public enrollment packet completion -> member/contact/payor/MCC/MHP handoff
- Canonical entities/tables: enrollment_packet_requests, members, member_contacts, member_health_profiles, member_command_centers, member_billing_settings
- Expected canonical write path: UI -> Server Action -> Service Layer -> Supabase RPC

Required approach:
1) Inspect `lib/services/enrollment-packets.ts`, `lib/services/enrollment-packet-intake-mapping.ts`, `supabase/migrations/0061_enrollment_packet_conversion_rpc.sql`, and `supabase/migrations/0076_rpc_returns_table_ambiguity_hardening.sql`.
2) Confirm exactly where `mapping_sync_status` becomes `completed` and which contact/payor writes still happen afterward in app code.
3) Keep one canonical transactional boundary for the downstream handoff. Move contact writes and payor assignment into the same RPC-owned boundary, or create one new canonical RPC that owns the entire post-filed handoff.
4) Do not allow `mapping_sync_status = completed` until every required downstream write has committed.
5) Add canonical dedupe/upsert handling for responsible-party and emergency-contact writes so retries cannot create duplicate or drifting `member_contacts`.
6) Preserve Supabase as source of truth and avoid UI-only patches or parallel write paths.

Validation:
- Run `npm run typecheck` and `npm run build` if the environment permits.
- List changed files, migration impact, and exactly what now defines the enrollment handoff success boundary.
- Call out any blocker if existing schema cannot support canonical contact identity dedupe cleanly.

Do not overengineer. Keep the fix narrow, transactional, and auditable.
```

### Prompt 2
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
The public enrollment packet submit action still hides the real downstream state and can make a filed packet look operationally ready when mapping is still pending or failed.

Scope:
- Domain/workflow: public enrollment packet submit boundary
- Canonical entities/tables: enrollment_packet_requests and downstream mapping status fields
- Expected canonical write path: UI -> Server Action -> Service Layer -> Supabase

Required approach:
1) Inspect `app/sign/enrollment-packet/[token]/actions.ts` and `lib/services/enrollment-packets.ts`.
2) Preserve the existing service boundary as authoritative. Do not move workflow truth into the page component.
3) Change the action result so it returns the real workflow state, including `packetId`, packet status, `mappingSyncStatus`, and any action-needed or follow-up message.
4) Make sure callers can distinguish:
   - filed and downstream complete
   - filed but downstream pending
   - filed but downstream failed/action required
5) Keep success semantics explicit. Do not return plain `ok: true` for a workflow that is only partially handed off.
6) Update only the minimum UI/action handling needed so staff UX stays truthful without redesigning the whole flow.

Validation:
- Run `npm run typecheck` and `npm run build` if the environment permits.
- List changed files and show the final action payload shape.
- Explain how staff can now tell whether the packet is only filed or truly downstream ready.

Do not overengineer. This is a workflow-truth fix, not a visual redesign.
```

### Prompt 3
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Signed intake follow-up still relies on manual repair when draft POF creation or intake PDF member-file persistence fails after the intake itself is already signed.

Scope:
- Domain/workflow: intake signature -> draft POF creation -> intake PDF persistence
- Canonical entities/tables: intake_assessments, intake_assessment_signatures, physician_orders, member_files, plus any action-required/retry table you determine is canonical
- Expected canonical write path: UI -> Server Action -> Service Layer -> Supabase

Required approach:
1) Inspect `app/intake-actions.ts`, `lib/services/intake-pof-mhp-cascade.ts`, and `lib/services/member-files.ts`.
2) Preserve the current staged workflow where signature completion remains explicit and durable.
3) Add a canonical service-owned retry or action-required queue for failed draft-POF creation and intake-PDF persistence. The queue must persist in Supabase and give operations a durable ownership trail.
4) Do not hide failures behind alerts only, and do not mark follow-up work complete unless the downstream artifact truly exists.
5) Reuse existing shared services where possible instead of creating a second parallel repair path.
6) If schema support is missing, add a forward-only migration and keep the workflow states explicit.

Validation:
- Run `npm run typecheck` and `npm run build` if the environment permits.
- List changed files, migration impact, and how operations can now find and retry failed intake follow-up work.
- Call out downstream effects on POF and Member Files behavior.

Do not overengineer. The goal is durable operational ownership after partial success.
```

### Prompt 4
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Public POF signing still does not return downstream sync truth, so legal signature completion can be mistaken for completed MHP/MCC/MAR clinical sync.

Scope:
- Domain/workflow: public POF signature completion -> post-sign clinical sync
- Canonical entities/tables: pof_requests, pof_signatures, member_health_profiles, MAR sync/retry state, post-sign queue state
- Expected canonical write path: UI -> Server Action -> Service Layer -> Supabase

Required approach:
1) Inspect `app/sign/pof/[token]/actions.ts`, `lib/services/pof-esign.ts`, and `lib/services/physician-orders-supabase.ts`.
2) Keep the existing replay-safe signature finalization path authoritative. Do not weaken the current canonical signing RPC.
3) Extend the public action/service result to return downstream post-sign truth such as `postSignStatus`, attempt count, retry timing, and any action-needed message.
4) Preserve the legal signature success boundary, but make the returned payload explicit when downstream sync is queued or retrying.
5) Update only the minimum caller/UI handling needed to prevent staff confusion about MHP/MAR freshness.

Validation:
- Run `npm run typecheck` and `npm run build` if the environment permits.
- List changed files and the final payload contract.
- Explain how a signed-but-still-syncing POF is represented after the fix.

Do not overengineer. This is a workflow-truth improvement on top of an already-strong signing path.
```

### Prompt 5
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Search-heavy runtime reads still lack the main production-safe index bundle for member search, audit-log area filtering, workflow alert de-dup, and partner/referral directory search.

Scope:
- Domain/workflow: shared read-model performance hardening
- Canonical entities/tables: members, audit_logs, system_events, community_partner_organizations, referral_sources
- Expected canonical write path: no behavior rewrite; migration-driven schema support for existing canonical reads

Required approach:
1) Inspect `lib/services/member-command-center-supabase.ts`, `lib/services/shared-lookups-supabase.ts`, `lib/services/admin-audit-trail.ts`, `lib/services/workflow-observability.ts`, and `lib/services/sales-crm-supabase.ts`.
2) Confirm the current query predicates and keep the existing canonical service boundaries authoritative.
3) Add the smallest forward-only Supabase migration bundle for the confirmed missing indexes:
   - trigram support for `members.display_name`
   - trigram support for `audit_logs.entity_type` if wildcard filtering remains the intended behavior
   - composite alert de-dup index centered on `system_events.correlation_id`
   - trigram indexes for partner/referral searched text columns
4) Do not change UI search behavior unless the service query shape truly needs adjustment after the index pass.
5) Preserve migration-driven schema/runtime alignment and avoid speculative indexes beyond the confirmed audit findings.

Validation:
- Run `npm run typecheck` and `npm run build` if the environment permits.
- List changed files and the exact indexes added.
- Explain which query paths should improve and which still need later SQL redesign.

Do not overengineer. This is a small schema-support hardening pass.
```

### Prompt 6
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Sales dashboard summary metrics still load broad lead sets into app memory, and lead summary logic is duplicated across multiple modules.

Scope:
- Domain/workflow: sales dashboard and reporting summary reads
- Canonical entities/tables: leads, lead stage/status/source summary outputs
- Expected canonical write path: read-only shared resolver/service hardening; preserve existing write paths

Required approach:
1) Inspect `lib/services/sales-crm-supabase.ts`, `lib/services/sales-workflows.ts`, and `lib/services/reports-ops.ts`.
2) Identify every current lead summary aggregation path and choose one canonical shared SQL or RPC-backed read model.
3) Replace app-memory full-table summary reads with that one canonical aggregate path.
4) Update all current consumers to use the same aggregate so reporting drift and performance drift both go down.
5) Preserve existing business meaning for stage/status/source counts and call out any current mismatches before changing them.

Validation:
- Run `npm run typecheck` and `npm run build` if the environment permits.
- List changed files and whether you added an RPC or consolidated an existing service query.
- Explain any downstream reporting differences caused by removing duplicate aggregation logic.

Do not overengineer. This is a shared summary-read cleanup, not a CRM rewrite.
```

### Prompt 7
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Member detail, staff detail, and activity snapshot reads still over-fetch long histories with wide payloads, and some remaining time-range queries still lack supporting indexes.

Scope:
- Domain/workflow: member detail, staff detail, and activity snapshot read models
- Canonical entities/tables: activity history tables including blood_sugar_logs, member_photo_uploads, ancillary_charge_logs, transportation logs, documentation tables, and related detail feeds
- Expected canonical write path: read-only service hardening; preserve existing write paths

Required approach:
1) Inspect `lib/services/member-detail-read-model.ts`, `lib/services/staff-detail-read-model.ts`, `lib/services/activity-snapshots.ts`, and `lib/services/health-dashboard.ts`.
2) Keep one canonical service boundary per detail/snapshot surface. Do not push ad hoc SQL into pages.
3) Replace `select("*")` with explicit UI-needed column lists where practical.
4) Add pagination or bounded history windows for large feeds so one detail page does not read full lifetime history by default.
5) Add only the confirmed missing member/date and staff/date indexes for the final retained query shapes, especially for blood sugar, photo upload, and ancillary charge timelines.
6) If you find repeated timeline logic across these modules, consolidate only the highest-overlap paths that materially reduce drift without creating a large refactor.

Validation:
- Run `npm run typecheck` and `npm run build` if the environment permits.
- List changed files, any migration added, and which histories are now paged or trimmed.
- Call out any UX surface that still intentionally shows broad history and why.

Do not overengineer. Focus on payload width, limits, and the worst remaining time-range indexes first.
```

## 3. Fix Priority Order

1. Make enrollment packet downstream mapping truly atomic and canonical.
2. Stop public enrollment packet submit from reporting filed-only as operationally ready.
3. Add durable queued ownership for signed intake follow-up failures.
4. Expose signed-POF post-sign sync truth to callers and staff.
5. Add the search and alert-dedupe index bundle.
6. Replace sales dashboard full-table app-memory summaries with one canonical aggregate path.
7. Trim and page member/staff/activity history reads and add the remaining timeline indexes.

## 4. Founder Summary

The current fix queue is narrower than it was on March 20. Several earlier integrity risks now look materially improved in the repo: POF public open compare-and-set, PRN MAR duplicate protection, MCC schema-drift fail-fast behavior, pricing-history service canonicalization, MHP/MCC list-path cleanup, and care-plan/MAR read-path hardening. That means the remaining highest-risk work is concentrated instead of scattered.

The top unresolved production issue is still enrollment packet completion. Right now the system can file the packet before every downstream contact and payor write is durably complete, and the public action still hides that truth. After that, the next most important operational fix is giving signed-intake follow-up a durable queue instead of relying on manual repair. The rest of the open work is now mostly performance hardening: index support for real search and alert predicates, one canonical sales summary aggregate, and tighter member/staff/activity history reads.
