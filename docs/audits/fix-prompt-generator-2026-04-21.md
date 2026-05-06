# Fix Prompt Generator Report
Generated: 2026-04-21

## 1. Issues Detected

### Issue 1. Database and app permission boundaries are still looser than the intended clinical and billing access model
- Audit sources:
  - `docs/audits/supabase-rls-security-audit-2026-04-21.md`
- Architectural rule being violated:
  - Preserve role restrictions and data integrity
  - Supabase-first architecture
  - Canonical service and authorization boundaries must agree with database policy boundaries
- Why this is still a live issue:
  - Older `authenticated using (true)` read policies still expose intake, physician-order, MHP, member-detail, and billing tables more broadly than the app intends.
  - The Intake Assessment index still uses a broader route gate than the detail and action paths.
  - Care-plan create/sign and intake create/sign are still not consistently requiring explicit edit permission before privileged writes.
- Safest fix approach:
  - Tighten database policies and app-side write authorization together.
  - Preserve one canonical service path per workflow and do not patch this in UI-only checks.
  - Treat low-risk missing-RLS tables as part of the same hardening pass if they are still live.

### Issue 2. Member Command Center file listing still leaks clinical file metadata to broader operations viewers
- Audit sources:
  - `docs/audits/supabase-rls-security-audit-2026-04-21.md`
  - `docs/audits/workflow-simulation-audit-2026-04-21.md`
- Architectural rule being violated:
  - Preserve role restrictions
  - Supabase is source of truth
  - Canonical server-only read paths must not expose more than the authorized caller should see
- Why this is still a live issue:
  - The current paged member-file path uses a service-role read and returns all file metadata before clinical-category filtering.
  - That means an operations viewer can still enumerate file names, categories, uploader details, and other metadata even if download remains gated.
- Safest fix approach:
  - Keep the paged canonical server path.
  - Filter at the authoritative service layer before returning metadata, not in the component.
  - Preserve clinical-user access and the recent file-history pagination improvement.

### Issue 3. Enrollment packet public token handling still has an expired-parent reuse gap and non-atomic throttling
- Audit sources:
  - `docs/audits/supabase-rls-security-audit-2026-04-21.md`
- Architectural rule being violated:
  - Public-link workflows must be replay-safe and idempotent
  - Workflow truth must come from durable canonical checks
  - Shared RPC or transaction-backed guards should own high-risk public submission rules
- Why this is still a live issue:
  - A completed enrollment packet can still mint a fresh completed-download token from an expired parent token because completion state is trusted before expiry is enforced.
  - Public packet submit throttling is still advisory because it counts attempts before writing the new attempt row.
- Safest fix approach:
  - Preserve the current public enrollment service boundary.
  - Reject expired parent tokens before issuing any descendant token.
  - Move throttling to a transactional RPC or similarly atomic database-backed guard.

### Issue 4. Signed intake still does not guarantee a provably ready draft POF
- Audit sources:
  - `docs/audits/workflow-simulation-audit-2026-04-21.md`
- Architectural rule being violated:
  - Workflow state integrity
  - Clear handoffs between workflows
  - Explicit persistence verification before downstream success
- Why this is still a live issue:
  - Intake persistence is durable, but draft physician-order creation can still fall into queued follow-up or missed immediate readback verification.
  - Staff can still interpret signed intake as operationally ready for POF follow-up when the draft order is not yet proven through the canonical read path.
- Safest fix approach:
  - Keep intake and physician-order services authoritative.
  - Tighten readiness truth so the workflow only reports ready when the draft POF is durably visible and canonical.
  - Preserve honest follow-up-needed states instead of faking completion.

### Issue 5. Signed POF still does not guarantee downstream MHP, MCC, and MAR readiness
- Audit sources:
  - `docs/audits/workflow-simulation-audit-2026-04-21.md`
- Architectural rule being violated:
  - Workflow state integrity
  - Clear handoffs between workflows
  - Shared resolver and service truth for staff-facing readiness
- Why this is still a live issue:
  - Provider signature completion is durable, but downstream sync can still be queued or degraded.
  - Staff can still misread signed state as clinically ready state unless the readiness model stays explicit.
- Safest fix approach:
  - Preserve the existing post-sign queue and sync boundary.
  - Tighten the staff-facing readiness contract so signed, queued, degraded, and ready remain distinct canonical states.

### Issue 6. Enrollment packet completion still depends on repair for immediate sales-side visibility
- Audit sources:
  - `docs/audits/workflow-simulation-audit-2026-04-21.md`
- Architectural rule being violated:
  - Clear handoffs between workflows
  - One canonical cross-module visibility path per workflow
  - Important downstream truth should be durably tracked, not only inferred from repair queues
- Why this is still a live issue:
  - Packet completion is durable, but lead-activity visibility can still lag behind because the lead-activity write can fall to queued repair after commit.
  - That leaves sales/admin users depending on retry timing instead of immediate canonical visibility.
- Safest fix approach:
  - Preserve packet completion truth and the current repair path.
  - Tighten the completion/readiness contract so staff-facing sales visibility reflects whether lead activity is durably present versus still pending repair.

### Issue 7. Billing custom-invoice orchestration is still not fully atomic end to end
- Audit sources:
  - `docs/audits/production-readiness-audit-2026-04-02.md`
- Architectural rule being violated:
  - Shared RPC standard
  - ACID atomicity
  - One canonical write path per workflow
- Why this is still a live issue:
  - Source reads and invoice numbering are still assembled in service code before RPC persistence.
  - That means durable billing truth is still split across TypeScript prework plus later transactional persistence.
- Safest fix approach:
  - Keep the billing RPC boundary authoritative.
  - Move only the workflow-critical pre-persist logic that affects durable outcome into the canonical transactional boundary.

### Issue 8. Query-scale risk is still concentrated in a small set of founder and staff read paths
- Audit sources:
  - `docs/audits/supabase-query-performance-audit-2026-04-21.md`
  - `docs/audits/rpc-architecture-audit-2026-03-24.md`
- Architectural rule being violated:
  - One canonical read boundary per screen
  - Production-readiness and scale safety
  - Shared read-model discipline
- Why this is still a live issue:
  - The sales dashboard summary RPC still does broad aggregation work.
  - The billing dashboard still re-reads overlapping raw billing facts in one request.
  - The admin audit trail, partner directory, and referral directory are still missing straightforward sort indexes.
  - Completed enrollment-packet reporting still over-reads instead of using true pagination.
  - MCC, MHP overview, and the health dashboard still pull wide first-load bundles.
- Safest fix approach:
  - Keep one canonical read-model boundary per screen.
  - Add missing indexes through forward-only migrations.
  - Slim the highest-cost read paths without reintroducing duplicate query families.

### Issue 9. Linked-project migration history still needs repair verification before treating schema safety as fully closed
- Audit sources:
  - `docs/audits/schema-migration-safety-audit-2026-04-02.md`
- Architectural rule being violated:
  - Migration-driven schema
  - Schema/runtime alignment must hold in the real linked Supabase project, not only in the repo
- Why this is still a live issue:
  - Repo-local runtime objects align to migrations, but the audit still calls out linked-project migration-history repair and applied-state verification as the blocker.
  - This is an operations and deployment safety issue rather than a runtime code bug, but it still blocks true production-ready confidence.
- Safest fix approach:
  - Repair the linked project migration history to match committed ordered filenames.
  - Re-run database checks and confirm the target Supabase project recognizes the same forward-only sequence as the repo.

## 2. Codex Fix Prompts

### Prompt 1. Tighten remaining DB and app authorization boundaries together
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Database read policies and app-side write permissions are still broader than the intended clinical and billing access model. Older `authenticated using (true)` policies still expose intake, physician-order, MHP, member-detail, and billing tables too broadly, and some current route/action paths still allow view-level or route-level access to reach privileged writes.

Scope:
- Domain/workflow: intake assessments, physician orders, member health profiles, care plans, billing, member detail support tables
- Canonical entities/tables: intake_assessments, assessment_responses, intake_assessment_signatures, physician_orders, member_health_profiles, member_providers, member_equipment, member_notes, billing_batches, billing_invoices, billing_invoice_lines, billing_coverages, billing_export_jobs
- Expected canonical write path: UI -> Server Action -> Service Layer -> Supabase

Required approach:
1) Inspect these first:
   - docs/audits/supabase-rls-security-audit-2026-04-21.md
   - app/(portal)/health/assessment/page.tsx
   - app/(portal)/health/assessment/[assessmentId]/page.tsx
   - app/intake-actions.ts
   - lib/services/care-plan-authorization.ts
   - lib/permissions/core.ts
   - the migrations that created the broad `authenticated using (true)` policies on the tables above
2) Replace the remaining broad read policies with explicit permission-aware predicates using the existing canonical permission helpers where possible.
3) Align app-side gates so the Intake Assessment index uses the same clinical boundary as the detail/action paths.
4) Require explicit edit permission for care-plan create/sign and intake create/sign flows before any privileged write path runs.
5) Preserve canonical server/service write paths. Do not solve this with UI-only checks or broader service-role use.
6) If `sites`, `lookup_lists`, or `punches_linked_time_punch_review` are still live runtime tables, enable RLS there in the same pass or explicitly document why they are intentionally excluded.

Validation:
- Run typecheck/build and report results.
- List every changed table policy, grant, and app-side permission check.
- Add focused regression coverage for one intake write path, one care-plan write path, and one unauthorized read boundary.

Do not overengineer. Keep DB and app permission truth aligned.
```

### Prompt 2. Stop leaking clinical file metadata from Member Command Center
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
The paged Member Command Center member-file list still exposes clinical file metadata to broader operations viewers because the canonical service-role read returns all file rows before clinical-category filtering.

Scope:
- Domain/workflow: Member Command Center file listing and file visibility
- Canonical entities/tables: member_files
- Expected canonical read path: UI -> server action -> canonical member-file service/read model -> Supabase

Required approach:
1) Inspect these first:
   - docs/audits/supabase-rls-security-audit-2026-04-21.md
   - app/(portal)/operations/member-command-center/_actions/files.ts
   - lib/services/member-command-center-runtime.ts
   - components/forms/member-command-center-file-manager.tsx
   - lib/services/member-files.ts
2) Keep the current paged server-only file listing path. Do not revert to unbounded reads.
3) Move metadata filtering to the authoritative service/action boundary so unauthorized viewers never receive hidden clinical file rows in the response payload.
4) Preserve existing download behavior for authorized clinical users and preserve the current pagination contract.
5) If a narrower canonical SQL/RPC read path is safer than filtering after a service-role read, use that instead of shipping another broad read plus JS filtering path.

Validation:
- Run typecheck/build and report results.
- Verify an operations viewer cannot see clinical file names/categories/uploader metadata.
- Verify an authorized clinical user still sees the same paged file list and can download allowed files.
- Report changed files and any permission-side downstream effects.

Do not patch only the component. Fix the canonical read boundary.
```

### Prompt 3. Harden enrollment-packet expired-token handling and make submit throttling atomic
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
A completed enrollment packet can still mint a new completed-download token from an expired parent token, and public submit throttling is still advisory because the code counts attempts before durably writing the new attempt.

Scope:
- Domain/workflow: public enrollment-packet confirmation/download and public submission throttling
- Canonical entities/tables: enrollment_packet_requests, enrollment_packet_events, any token/throttle tracking tables used by the public flow
- Expected canonical write path: public request -> canonical enrollment-packet service/RPC -> Supabase

Required approach:
1) Inspect these first:
   - docs/audits/supabase-rls-security-audit-2026-04-21.md
   - lib/services/enrollment-packets-public-runtime-context.ts
   - app/sign/enrollment-packet/[token]/confirmation/page.tsx
   - lib/services/enrollment-packets-public-runtime-artifacts.ts
   - lib/services/enrollment-packet-public-helpers.ts
2) Reject expired parent tokens before any completed-download token issuance.
3) Preserve valid completed-download behavior for unexpired, already-completed packet links.
4) Move submission throttling into an atomic DB/RPC boundary so concurrent requests cannot slip through the count-then-write gap.
5) Preserve current public-link replay protections and do not add a second public submission path.

Validation:
- Run typecheck/build and report results.
- Add or update regression coverage for expired completed parent tokens and concurrent submit throttling.
- Report changed files, schema/RPC impact, and the final rule for expired vs valid completed links.

Do not overengineer. Keep the existing public service boundary authoritative.
```

### Prompt 4. Make signed intake readiness mean draft POF is durably visible
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Signed intake still does not guarantee a provably ready draft POF. Intake can be durably complete while downstream draft physician-order creation is queued or immediate canonical readback is still missing.

Scope:
- Domain/workflow: intake assessment signing -> draft physician order creation/readiness
- Canonical entities/tables: intake_assessments, intake_assessment_signatures, intake_post_sign_follow_up_queue, physician_orders
- Expected canonical write path: UI -> server action -> intake service/RPC -> physician-order service/RPC -> Supabase

Required approach:
1) Inspect these first:
   - docs/audits/workflow-simulation-audit-2026-04-21.md
   - app/intake-actions.ts
   - lib/services/intake-pof-mhp-cascade.ts
   - lib/services/physician-orders-supabase.ts
   - lib/services/physician-orders-read.ts
2) Keep the current intake and physician-order service/RPC boundaries authoritative.
3) Identify where the workflow upgrades staff-facing truth before draft POF readback is canonical and durable.
4) Tighten the readiness contract so intake only reports ready-for-POF when the draft physician order is durably visible through the canonical read path.
5) Preserve honest queued/degraded/follow-up-needed states when the downstream draft still requires repair.

Validation:
- Run typecheck/build and report results.
- Add or update regression coverage for signed-intake success with proven draft POF visibility and for follow-up-needed cases.
- Report changed files and downstream UI/workflow effects.

Do not fake a ready state. Keep the fix small and canonical.
```

### Prompt 5. Separate provider-signed truth from downstream clinical readiness
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Signed POF still does not guarantee that downstream MHP, MCC, and MAR sync is complete. Staff-facing truth needs to distinguish signed, queued, degraded, and fully ready states.

Scope:
- Domain/workflow: provider POF signature -> downstream clinical sync -> staff-facing readiness
- Canonical entities/tables: physician_orders, pof_requests, pof_post_sign_sync_queue, member_health_profiles, member_command_centers, mar_schedules
- Expected canonical path: public/provider signature -> canonical POF finalize service -> post-sign sync service/queue -> Supabase-backed readiness truth

Required approach:
1) Inspect these first:
   - docs/audits/workflow-simulation-audit-2026-04-21.md
   - lib/services/pof-esign.ts
   - lib/services/pof-esign-public.ts
   - lib/services/physician-order-post-sign-service.ts
   - lib/services/pof-post-sign-runtime.ts
   - any staff-facing readiness/status consumers for physician orders, MHP, MCC, or MAR
2) Keep the current signature-finalization and post-sign sync boundary authoritative.
3) Tighten the canonical readiness model so staff-facing surfaces explicitly distinguish:
   - provider signed
   - downstream sync queued
   - downstream sync degraded / action required
   - downstream clinically ready
4) Update only the minimum downstream consumers needed to read the same canonical readiness truth.
5) Do not create a second sync path or hide queued/degraded states behind a generic signed badge.

Validation:
- Run typecheck/build and report results.
- Add or update regression coverage for signed-but-queued and signed-and-ready states.
- Report changed files and which screens/actions now read the stronger readiness contract.

Keep one canonical readiness model. Do not overengineer.
```

### Prompt 6. Make enrollment-packet sales visibility truth explicit when lead activity is still queued for repair
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Enrollment packet completion is durable, but lead-activity visibility can still fall to queued repair after commit. Sales/admin users should not misread packet completion as immediate confirmed sales-side visibility when the lead activity row is still pending.

Scope:
- Domain/workflow: enrollment packet completion -> lead activity visibility in sales/admin workflows
- Canonical entities/tables: enrollment_packet_requests, enrollment_packet_events, lead_activities, any packet completion follow-up status fields used by listings/detail pages
- Expected canonical path: public packet completion -> canonical enrollment service -> Supabase -> sales/admin read models

Required approach:
1) Inspect these first:
   - docs/audits/workflow-simulation-audit-2026-04-21.md
   - lib/services/enrollment-packet-mapping-runtime.ts
   - lib/services/enrollment-packets-public-runtime.ts
   - lib/services/enrollment-packets-listing.ts
   - any sales/admin detail or badge consumers that present completion status
2) Preserve the current durable packet completion path and repair queue.
3) Identify where staff-facing status currently implies immediate sales-side visibility even when lead-activity sync is still queued.
4) Tighten the canonical readiness/readback contract so sales/admin screens can distinguish:
   - packet completed
   - lead activity durably visible
   - lead activity still pending repair
5) Do not fall back to free-text inference or introduce a second lead-activity write path.

Validation:
- Run typecheck/build and report results.
- Add or update regression coverage for completed packet with immediate lead activity vs queued repair.
- Report changed files and which staff-facing consumers now use the explicit visibility truth.

Keep the fix practical and auditable. This is a handoff-truth fix, not a workflow rewrite.
```

### Prompt 7. Finish atomic custom-invoice orchestration inside the billing RPC boundary
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Billing custom-invoice orchestration is still not fully atomic end to end because source reads and invoice numbering are still assembled in service code before RPC persistence.

Scope:
- Domain/workflow: custom invoice generation
- Canonical entities/tables: billing_invoices, billing_invoice_lines, billing_adjustments, billing_batches, and any source tables used during custom invoice assembly
- Expected canonical write path: billing action -> canonical billing service -> transactional billing RPC -> Supabase

Required approach:
1) Inspect these first:
   - docs/audits/production-readiness-audit-2026-04-02.md
   - lib/services/billing-custom-invoices.ts
   - lib/services/billing-workflows.ts
   - lib/services/billing-rpc.ts
   - supabase/migrations/0178_harden_custom_invoice_rpc_atomicity.sql
2) Identify exactly which pre-RPC steps still affect durable outcome.
3) Move only the workflow-critical pieces into the transactional RPC/service boundary so one canonical path owns invoice numbering and persisted truth.
4) Preserve existing invoice behavior and downstream billing/reporting expectations.
5) Do not add a second custom-invoice write path or temporary fallback persistence.

Validation:
- Run typecheck/build and report results.
- Add or update regression coverage for retry/duplicate safety and invoice numbering truth.
- Report changed files and any schema/RPC impact.

Keep the change small, maintainable, and production-safe.
```

### Prompt 8. Slim the highest-cost founder and staff reads without creating duplicate query families
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Query-scale risk is still concentrated in the sales dashboard summary RPC, billing dashboard fan-out, audit trail newest-first sort, partner/referral directory sorting, completed enrollment-packet reporting, and wide first-load bundles on MCC, MHP overview, and the health dashboard.

Scope:
- Domain/workflow: founder/staff dashboards and list screens
- Canonical entities/tables: leads, lead_activities, billing_* tables used by dashboard summaries, audit_logs, community_partner_organizations, referral_sources, profiles, enrollment_packet_requests, members
- Expected canonical read path: one canonical Supabase read-model/RPC boundary per screen

Required approach:
1) Inspect these first:
   - docs/audits/supabase-query-performance-audit-2026-04-21.md
   - docs/audits/rpc-architecture-audit-2026-03-24.md
   - lib/services/sales-workflows.ts
   - lib/services/billing-preview-helpers.ts
   - lib/services/billing-read-supabase.ts
   - lib/services/admin-audit-trail.ts
   - lib/services/sales-crm-read-model.ts
   - lib/services/enrollment-packet-list-support.ts
   - lib/services/enrollment-packets-listing.ts
   - lib/services/member-command-center-runtime.ts
   - lib/services/member-health-profiles-read.ts
   - lib/services/health-dashboard.ts
2) Keep one canonical read boundary per screen. Do not split into competing query families.
3) Add forward-only migrations for the high-confidence missing indexes:
   - audit_logs(created_at desc)
   - community_partner_organizations(organization_name)
   - referral_sources(organization_name)
4) Slim the sales dashboard summary RPC without changing founder-facing numbers.
5) Refactor the billing dashboard summary so one request does not re-read overlapping raw billing facts.
6) Move completed enrollment-packet reporting toward true pagination instead of large bounded reads plus search/name-resolution fan-out.
7) Preserve the recent MCC paged member-file improvement and reduce first-load fan-out only where behavior can stay consistent.

Validation:
- Run typecheck/build and report results.
- Report which indexes were added and which queries were slimmed.
- Add focused regression coverage if summary/list behavior changes.

Do not overengineer. Keep the read-model boundaries canonical and auditable.
```

### Prompt 9. Repair linked Supabase migration history and verify deployed schema state
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
The repo-local migration sequence is clean, but schema safety is not fully closed until the linked Supabase project confirms the same ordered migration history and applied state.

Scope:
- Domain/workflow: schema migration safety / deployment readiness
- Canonical entities/tables: linked Supabase migration history, committed migrations 0175 through 0178 and any later required committed sequence
- Expected canonical path: committed forward-only migrations -> linked project applied state -> runtime code

Required approach:
1) Inspect these first:
   - docs/audits/schema-migration-safety-audit-2026-04-02.md
   - supabase/migrations/0175_fk_covering_indexes_hardening.sql
   - supabase/migrations/0176_safe_unused_index_cleanup.sql
   - supabase/migrations/0177_enrollment_packet_lead_lookup_index.sql
   - supabase/migrations/0178_harden_custom_invoice_rpc_atomicity.sql
2) Verify the linked project migration history and identify any filename/order mismatch between the repo and the target Supabase project.
3) Repair the linked-project migration history so the project recognizes the committed ordered filenames without rewriting production data history.
4) Re-run the repo database verification commands and confirm the linked project can apply the pending forward-only set cleanly.
5) Do not invent new schema objects in code as part of this repair. This is a migration-history and verification task.

Validation:
- Report the exact mismatch found and the exact repair performed.
- Re-run the schema safety checks and confirm runtime tables/RPCs/storage bucket still align to migrations.
- Call out any environment blocker explicitly if linked-project access is not available.

Keep this operationally safe. Do not use destructive migration history shortcuts.
```

## 3. Fix Priority Order
1. Prompt 1: tighten remaining DB and app authorization boundaries together.
2. Prompt 2: stop leaking clinical file metadata from Member Command Center.
3. Prompt 3: harden enrollment-packet expired-token handling and make submit throttling atomic.
4. Prompt 4: make signed intake readiness mean draft POF is durably visible.
5. Prompt 5: separate provider-signed truth from downstream clinical readiness.
6. Prompt 6: make enrollment-packet sales visibility truth explicit when lead activity is still queued for repair.
7. Prompt 7: finish atomic custom-invoice orchestration inside the billing RPC boundary.
8. Prompt 8: slim the highest-cost founder and staff reads without creating duplicate query families.
9. Prompt 9: repair linked Supabase migration history and verify deployed schema state.

## 4. Founder Summary
- The current highest-value fixes are narrower than the older audit backlog. Today’s reports point to three main buckets: permission boundary hardening, public-link safety, and workflow handoff truth.
- The most urgent issue is still access control. The repo has made real progress, but older broad RLS policies and a few app-side permission gaps still let the system trust broader staff access than intended.
- The newest concrete app bug is the Member Command Center file listing leak. The current paged file path is better for performance, but it still exposes clinical file metadata to broader operations viewers and should be fixed at the canonical service boundary.
- The main public-link gap is enrollment packets. Expired completed parent tokens can still mint a fresh download token, and submission throttling is still count-first/write-later instead of atomic.
- The main clinical handoff risks are unchanged: signed intake is not always the same as ready draft POF, and signed POF is not always the same as downstream clinically synced readiness. Those are workflow-truth problems, not fake persistence problems.
- Billing custom invoices are still the main production-readiness architecture debt item from the latest production-readiness audit.
- The latest available Daily Canonicality Sweep, Shared Resolver Drift Check, and Idempotency audit did not add a newer must-fix runtime bug beyond the items above. Their newest evidence mainly confirmed that the current remaining problems are now concentrated in authorization, workflow readiness truth, and a small set of heavier read paths.
