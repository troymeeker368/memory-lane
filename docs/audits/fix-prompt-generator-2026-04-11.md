# Fix Prompt Generator Report
Generated: 2026-04-11

## 1. Issues Detected

### Issue 1. Intake staff flows can still treat committed intake as operationally ready too early
- Audit sources:
  - `docs/audits/workflow-simulation-audit-2026-04-11.md`
  - `docs/audits/acid-transaction-audit-2026-04-04.md`
- Architectural rule being violated:
  - Workflow state integrity
  - Shared resolver/service boundaries
  - Clear handoffs between workflows
- Why this is still a real issue:
  - The repo now has a shared committed-versus-ready vocabulary, but the workflow audit still flags Intake Assessment -> draft POF as a weak handoff. The remaining risk is consumer drift: staff-facing flows can still key off `ok: true` instead of the readiness stage from the canonical intake post-sign path.
- Safest fix approach:
  - Keep intake signature and draft-POF creation on the existing canonical RPC-backed path.
  - Tighten consumers so intake screens, actions, and follow-up surfaces all treat `readinessStage` as the operational source of truth, not generic action success.

### Issue 2. Signed POF can still look fully live before MHP/MCC/MAR sync finishes
- Audit sources:
  - `docs/audits/workflow-simulation-audit-2026-04-11.md`
  - `docs/audits/acid-transaction-audit-2026-04-04.md`
- Architectural rule being violated:
  - Workflow state integrity
  - ACID durability truth
  - Clear downstream handoffs
- Why this is still a real issue:
  - The sign path is durable and replay-safe, but the audit still marks Provider POF signature -> MHP/MCC/MAR sync as weak because downstream sync can stay queued or failed while top-level staff views remain too easy to misread.
- Safest fix approach:
  - Preserve the queue-backed retry model and canonical sign/finalize boundary.
  - Make the shared POF readiness metadata impossible to miss in MHP, MCC, MAR-dependent, and provider-order detail surfaces.

### Issue 3. Enrollment packet readiness still is not surfaced everywhere staff act on completed packets
- Audit sources:
  - `docs/audits/workflow-simulation-audit-2026-04-11.md`
  - `docs/audits/acid-transaction-audit-2026-04-04.md`
- Architectural rule being violated:
  - Workflow state integrity
  - Canonical shared readiness logic
  - Predictable downstream effects
- Why this is still a real issue:
  - Enrollment completion now records follow-up truth honestly, but the workflow audit still calls out completion -> lead activity / mapping as partial. The remaining issue is not persistence; it is staff visibility outside the most obvious completion views.
- Safest fix approach:
  - Reuse `lib/services/enrollment-packet-readiness.ts` as the canonical resolver.
  - Push operational-readiness state into the staff surfaces where completed packets drive action, instead of adding another local wording layer.

### Issue 4. Health dashboard MAR still over-reads the full `v_mar_today` dataset
- Audit sources:
  - `docs/audits/supabase-query-performance-audit-2026-04-11.md`
- Architectural rule being violated:
  - Production readiness
  - Canonical shared read boundaries should scale safely
- Why this is still a real issue:
  - The main MAR page is now contained, but the health dashboard still loads all `v_mar_today` rows and trims them in application code just to show the next action window and recent administrations.
- Safest fix approach:
  - Keep Supabase views authoritative.
  - Add a narrower dashboard-specific shared read boundary or RPC that returns only the needed action and recent slices.

### Issue 5. Sales dashboard summary RPC still does full-table dashboard-time work
- Audit sources:
  - `docs/audits/supabase-query-performance-audit-2026-04-11.md`
- Architectural rule being violated:
  - Canonical RPC/read-model boundaries should avoid repeated whole-table work
  - Production readiness
- Why this is still a real issue:
  - The current RPC rebuilds canonical lead state across the whole `leads` table and layers several table-wide counts on top of that work for every dashboard load.
- Safest fix approach:
  - Keep one canonical RPC boundary.
  - Slim the SQL work per request or move expensive counters behind a smaller cached/snapshotted shape without changing founder-facing metrics.

### Issue 6. Billing exports and draft finalization still over-read whole billing tables
- Audit sources:
  - `docs/audits/supabase-query-performance-audit-2026-04-11.md`
- Architectural rule being violated:
  - Canonical shared read boundaries should stay maintainable and production-safe
  - Query behavior should match migration-backed performance contracts
- Why this is still a real issue:
  - Invoice list pages are now paged, but `billing_batches`, `billing_export_jobs`, and the draft "Finalize All" helper still read more rows than those pages need.
- Safest fix approach:
  - Preserve the new shared invoice list helper.
  - Bound export/batch/draft-id reads for page loads and keep any truly full-table reads inside export-only flows.

### Issue 7. Several real query shapes still lack matching indexes
- Audit sources:
  - `docs/audits/supabase-query-performance-audit-2026-04-11.md`
- Architectural rule being violated:
  - Migration-driven schema must stay aligned to real runtime query shapes
  - Production readiness
- Why this is still a real issue:
  - The latest query audit still confirms missing indexes for the global lead activity feed, generated member-file duplicate-name checks, and the current billing list sort/filter shapes.
- Safest fix approach:
  - Add one forward-only performance migration for the confirmed missing indexes only.
  - Do not use indexes as a substitute for the broader MAR and sales dashboard read-boundary fixes.

### Findings Reviewed But Not Promoted To New Fix Prompts
- `user_permissions` RLS hardening:
  - Current repo evidence shows this is already implemented via `0183`, `0186`, and `0198`, so I did not reissue that stale April 2 prompt.
- Reports home aggregate scan reduction:
  - The repo now contains `0208_reports_home_recent_window.sql`, so I treated this as already in progress/landed locally rather than a fresh new prompt.
- Main MAR first-load containment and main billing invoice pagination:
  - The April 11 performance audit explicitly confirms those two improvements already landed.
- Shared resolver drift and idempotency:
  - The latest available reports do not surface a fresh narrow open bug beyond the staged-readiness issues above.
- Billing custom-invoice atomicity:
  - Current repo evidence (`0178`, `0185`, and `tests/custom-invoice-rpc-boundary.test.ts`) suggests the older production-readiness finding is likely already addressed locally.

## 2. Codex Fix Prompts

### Prompt 1. Make intake readiness metadata authoritative in staff-facing workflows
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Intake signing is durable, but staff-facing intake flows can still treat a committed intake as operationally ready too early when draft POF creation, readback verification, or intake PDF member-file persistence still needs follow-up.

Scope:
- Domain/workflow: intake post-sign -> draft POF -> intake follow-up readiness
- Canonical entities/tables: `intake_assessments`, `intake_post_sign_follow_up_queue`, `physician_orders`, related member-file persistence
- Expected canonical write path: UI -> server action -> canonical service/RPC -> Supabase

Required approach:
1) Inspect `app/intake-actions.ts`, `app/(portal)/health/assessment/[assessmentId]/actions.ts`, `lib/services/intake-pof-mhp-cascade.ts`, and `lib/services/intake-post-sign-readiness.ts`.
2) Keep `rpc_finalize_intake_assessment_signature` and `rpc_create_draft_physician_order_from_intake` as the authoritative persistence boundaries.
3) Find the remaining places where callers or UI state still rely on generic success/`ok` instead of the committed-readiness contract.
4) Make `readinessStage` plus the canonical founder-readable message the operational source of truth for intake follow-up decisions.
5) Preserve the staged workflow model. Do not convert this into a fake all-or-nothing UI state and do not add a second local status vocabulary.

Validation:
- Run typecheck.
- Add/update regression coverage proving an intake can be committed while still surfacing `queued_degraded` or `follow_up_required`.
- List the staff-facing intake surfaces that now consume readiness metadata explicitly.
```

### Prompt 2. Make queued signed-POF sync impossible to miss in staff views
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
A POF can be durably signed while downstream MHP, MCC, and MAR sync is still queued or failed for retry, and staff-facing views can still make that look more complete than it really is.

Scope:
- Domain/workflow: provider POF signature -> downstream clinical sync
- Canonical entities/tables: `physician_orders`, `pof_requests`, `pof_post_sign_sync_queue`, downstream member clinical tables
- Expected canonical path: public sign action -> canonical finalize/sign service -> queued sync boundary -> Supabase

Required approach:
1) Inspect `app/sign/pof/[token]/actions.ts`, `lib/services/pof-post-sign-runtime.ts`, `lib/services/physician-order-clinical-sync.ts`, `lib/services/physician-order-post-sign-service.ts`, and the highest-traffic POF/MHP/MCC/MAR consumer surfaces.
2) Keep the current queue-backed sync model and canonical sign persistence unchanged.
3) Reuse the shared committed workflow vocabulary already used in this repo (`ready`, `committed`, `queued_degraded`, `follow_up_required`).
4) Identify the top-level staff views that still bury or fail to emphasize queued sync state, and wire the canonical readiness metadata through those views.
5) Do not move sync orchestration into the UI and do not create a parallel readiness resolver.

Validation:
- Run typecheck.
- Add/update regression coverage for signed POF + queued sync and signed POF + failed sync follow-up.
- Report exactly which staff views now surface the canonical readiness state.
```

### Prompt 3. Surface enrollment packet operational readiness anywhere staff act on completed packets
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Enrollment packet completion is durable and replay-safe, but staff can still act on a completed packet before mapping sync, lead activity sync, or completion follow-up is actually operationally ready.

Scope:
- Domain/workflow: enrollment packet completion -> mapping/follow-up readiness
- Canonical entities/tables: `enrollment_packet_requests`, `enrollment_packet_events`, follow-up queue tables, downstream lead/member mapping records
- Expected canonical path: public completion -> canonical finalize flow -> follow-up queue/services -> Supabase

Required approach:
1) Inspect `lib/services/enrollment-packet-readiness.ts`, `lib/services/enrollment-packet-completion-cascade.ts`, `lib/services/enrollment-packet-list-support.ts`, and the main staff-facing enrollment packet pages/actions.
2) Keep the existing completion/finalize boundary and current follow-up queue truth.
3) Reuse the canonical enrollment readiness resolver instead of adding page-local readiness rules.
4) Surface committed-versus-ready truth anywhere staff use completed packets for next actions, not only on the completed packets report.
5) Avoid wording drift. Keep founder/staff messaging aligned to the shared readiness vocabulary.

Validation:
- Run typecheck.
- Add/update regression coverage proving a completed packet with follow-up still renders as not operationally ready in the key staff surfaces you changed.
- List those surfaces and the downstream workflow impact.
```

### Prompt 4. Finish MAR containment by narrowing the health dashboard read boundary
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
The main MAR page is now contained, but the health dashboard still loads the full `v_mar_today` dataset and trims it in application code just to show the next action window and recent administrations.

Scope:
- Domain/workflow: health dashboard MAR snapshot
- Canonical entities/tables/views: `v_mar_today`, dashboard MAR read service, health dashboard loader
- Expected canonical read path: dashboard page -> shared service/RPC -> Supabase

Required approach:
1) Inspect `lib/services/mar-dashboard-read-model.ts` and `lib/services/health-dashboard.ts`.
2) Keep Supabase as the source of truth and preserve current dashboard behavior.
3) Build the smallest safe shared read boundary that returns only the action-window and recent-admin rows the dashboard actually uses.
4) If a dedicated RPC is the smallest clean fix, keep it migration-backed and auditable.
5) Do not push the filtering burden further into page code and do not mix this with unrelated MAR write-path changes.

Validation:
- Run typecheck.
- Add/update regression coverage for the new dashboard MAR boundary.
- Explain whether you used a narrower view query or a new RPC and what data the dashboard now loads.
```

### Prompt 5. Slim the sales dashboard summary RPC without changing founder-facing metrics
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
The sales dashboard summary RPC still rebuilds canonical lead state across the full `leads` table and layers multiple whole-table counters on every request.

Scope:
- Domain/workflow: sales dashboard summary
- Canonical entities/tables/RPCs: `leads`, `lead_activities`, `community_partner_organizations`, `referral_sources`, `partner_activities`, `rpc_get_sales_dashboard_summary`
- Expected canonical read path: sales dashboard service -> one shared RPC -> Supabase

Required approach:
1) Inspect `lib/services/sales-workflows.ts` and `supabase/migrations/0200_sales_dashboard_follow_up_summary_rpc.sql`.
2) Keep one canonical RPC boundary for the dashboard.
3) Identify the most expensive whole-table work being repeated on every request and shrink it without changing the founder-facing metric contract.
4) Prefer a smaller SQL shape, bounded work, or a clearly labeled snapshot/cached approach over adding more app-side aggregation.
5) Avoid splitting this into several competing read paths.

Validation:
- Run typecheck.
- Add/update focused coverage that locks the dashboard contract you preserved.
- Report what SQL work was removed or bounded and any migration added.
```

### Prompt 6. Finish billing read containment for exports and draft finalization helpers
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
The main invoice lists are now paged, but billing exports, billing batch pages, and the draft "Finalize All" helper still read more rows than those screens need.

Scope:
- Domain/workflow: billing exports, batch list reads, draft finalization helpers
- Canonical entities/tables: `billing_batches`, `billing_export_jobs`, `billing_invoices`
- Expected canonical read path: billing pages -> shared billing read service -> Supabase

Required approach:
1) Inspect `lib/services/billing-read-supabase.ts`, `lib/services/billing-read.ts`, `app/(portal)/operations/payor/exports/page.tsx`, and `app/(portal)/operations/payor/invoices/draft/page.tsx`.
2) Preserve the new shared paged invoice list helper.
3) Bound or page `billing_batches`, `billing_export_jobs`, and the draft id loader used for "Finalize All Drafts" on page render.
4) Keep any truly full reads inside export-only or action-only flows if they are still required there.
5) Do not reintroduce duplicate query shapes across billing services.

Validation:
- Run typecheck.
- Add/update regression coverage for the bounded billing reads you changed.
- Report which page loads are now bounded and which flows intentionally still do fuller reads.
```

### Prompt 7. Add the confirmed missing performance indexes
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Several real runtime query shapes still lack matching indexes: the global recent lead-activity feed, generated member-file duplicate-name checks, and the current billing list sort/filter shapes.

Scope:
- Domain/workflow: shared performance/index hardening
- Canonical entities/tables: `lead_activities`, `member_files`, `billing_invoices`
- Expected canonical path: forward-only migration -> Supabase -> unchanged service callers

Required approach:
1) Inspect the current query shapes in `lib/services/sales-crm-read-model.ts`, `lib/services/member-files.ts`, and `lib/services/billing-read-supabase.ts`.
2) Add one forward-only migration with only the confirmed missing indexes that match those shapes:
   - `lead_activities(activity_at desc)`
   - `member_files(member_id, file_name)`
   - `billing_invoices(invoice_status, invoice_month desc, created_at desc)`
   - `billing_invoices(invoice_source, invoice_status, invoice_month desc, created_at desc)`
3) Do not change runtime behavior unless a tiny query-shape adjustment is needed to align with the new indexes.
4) Keep this scoped to index hardening. Do not use it as a substitute for the broader MAR or sales dashboard fixes.

Validation:
- Show the migration added.
- Run typecheck.
- Report which audited query each index is intended to support.
```

## 3. Fix Priority Order
1. Make intake readiness metadata authoritative in staff-facing workflows.
2. Make queued signed-POF sync impossible to miss in staff views.
3. Surface enrollment packet operational readiness anywhere staff act on completed packets.
4. Finish MAR containment by narrowing the health dashboard read boundary.
5. Slim the sales dashboard summary RPC.
6. Finish billing read containment for exports and draft finalization helpers.
7. Add the confirmed missing performance indexes.

## 4. Founder Summary
- The newest audit pack says the repo is no longer failing on fake persistence or obvious schema drift. The real remaining issue is staged workflow truth: some workflows now commit honestly, but staff can still move too early if screens treat success as readiness.
- The two highest-risk workflow prompts are still intake -> draft POF and signed POF -> downstream clinical sync. Enrollment packet readiness is the next one behind them.
- On performance, the big wins from yesterday are real: main MAR first load, main billing invoice pages, and reports-home windowing all improved. The remaining work is narrower now:
  - health dashboard MAR over-read
  - sales dashboard RPC full-table work
  - billing export/draft-finalize helper over-read
  - missing targeted indexes
- I intentionally did not reissue the stale `user_permissions` RLS prompt, the older reports-home prompt, or the older custom-invoice atomicity prompt because the current repo already shows those changes landed locally.
