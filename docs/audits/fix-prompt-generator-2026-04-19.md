# Fix Prompt Generator Report
Generated: 2026-04-19

## 1. Issues Detected

### Issue 1. Privileged member-file and workflow-control RPCs are still callable by broad authenticated users
- Audit sources:
  - `docs/audits/supabase-rls-security-audit-2026-04-18.md`
  - `docs/audits/supabase-query-performance-audit-2026-04-19.md`
- Architectural rule being violated:
  - Supabase-first architecture with explicit role boundaries
  - Canonical service write/read paths
  - Shared RPC boundaries
- Why this is still a real issue:
  - `rpc_list_member_files(uuid)` is still granted to `authenticated`, which creates a direct cross-member metadata exposure path outside the stricter app guardrail.
  - The same RPC also returns full per-member file history with no pagination, so the security boundary and the read-volume boundary are both weaker than they should be.
  - `rpc_reconcile_expired_pof_requests(integer)` is still a workflow-control RPC granted to `authenticated` even though it should only run from a trusted system boundary.
- Safest fix approach:
  - Revoke broad execute grants first.
  - Keep file listing and POF reconciliation behind canonical server-only wrappers.
  - Add pagination to the member-file list boundary while preserving current MCC behavior and category restrictions.

### Issue 2. Sensitive intake, care-plan, billing, and operational tables still rely on broad authenticated RLS policies
- Audit sources:
  - `docs/audits/supabase-rls-security-audit-2026-04-18.md`
- Architectural rule being violated:
  - Supabase-first architecture
  - Preserve role restrictions and data integrity
  - Canonical service write paths
- Why this is still a real issue:
  - Intake, care-plan, billing, and several operational/member tables still allow reads or writes with broad `authenticated` access patterns that do not match the stricter application role model.
  - This means a direct Supabase caller can bypass app-level authorization assumptions.
- Safest fix approach:
  - Add forward-only hardening migrations that align RLS predicates to explicit permission helpers and intended role scopes.
  - Preserve the current canonical service layer so runtime callers do not need alternate write paths.

### Issue 3. Intake -> draft POF handoff is still not provably canonical end to end
- Audit sources:
  - `docs/audits/workflow-simulation-audit-2026-04-19.md`
  - `docs/audits/fix-prompt-generator-2026-04-15.md`
- Architectural rule being violated:
  - Canonical write path
  - Workflow state integrity
  - Explicit persistence verification before downstream success
- Why this is still a real issue:
  - Workflow simulation still marks Intake Assessment -> Physician Orders / POF generation as broken because the handoff does not yet produce strong enough evidence that the expected `physician_orders` write was durably completed and read back through the canonical path.
- Safest fix approach:
  - Keep the intake and physician-order RPC/service boundary authoritative.
  - Tighten the readback and follow-up contract so downstream consumers only report success when the created draft physician order is explicitly verifiable.

### Issue 4. Care-plan post-sign flows can still return failure after committed writes, and resend guards are not fully production-real
- Audit sources:
  - `docs/audits/acid-transaction-audit-2026-04-18.md`
- Architectural rule being violated:
  - ACID durability
  - Workflow state integrity
  - Migration-driven schema
- Why this is still a real issue:
  - The workflow now correctly allows `signed_pending_caregiver_dispatch`, but the later write-boundary assertion still expects `ready`, which can cause false failure after the care plan already committed.
  - The care-plan terminal resend guard exists only in workspace migration `0212`, so the database boundary is still not guaranteed in production until it is committed and applied.
- Safest fix approach:
  - Update the service-layer boundary check to accept the legitimate pending state and always surface persisted truth on partial-commit paths.
  - Commit/apply the paired migration so resend protection is enforced at the database layer, not only in code.

### Issue 5. Enrollment packet completion still has schema/runtime and post-commit durability gaps
- Audit sources:
  - `docs/audits/acid-transaction-audit-2026-04-18.md`
  - `docs/audits/workflow-simulation-audit-2026-04-19.md`
  - `docs/audits/production-readiness-audit-2026-04-02.md`
- Architectural rule being violated:
  - Migration-driven schema
  - ACID atomicity and durability
  - Explicit failures when persistence or required side effects fail
- Why this is still a real issue:
  - Runtime code now depends on `lead_activities.enrollment_packet_request_id`, but the required schema lives only in untracked migration `0215`.
  - Packet completion still marks the packet completed before finalized artifacts and follow-up state are durably persisted, so workflow truth can drift from what Supabase actually stores.
- Safest fix approach:
  - Ship the schema-backed lead-activity link as part of the same deploy unit as the runtime change.
  - Add a durable artifact-batch/follow-up persistence contract so packet completion cannot report upgraded truth when artifact or follow-up writes did not persist.

### Issue 6. Query-heavy founder/staff dashboards still carry near-term scaling risk
- Audit sources:
  - `docs/audits/supabase-query-performance-audit-2026-04-19.md`
  - `docs/audits/rpc-architecture-audit-2026-03-24.md`
- Architectural rule being violated:
  - Shared canonical read boundary discipline
  - Production-readiness / scale safety
- Why this is still a real issue:
  - The sales dashboard RPC still rebuilds broad summary state from the full `leads` table and unrelated whole-table counts.
  - The billing revenue dashboard still re-reads overlapping raw billing tables through multiple heavy paths in one request.
  - The admin audit trail still lacks a standalone `created_at desc` index.
- Safest fix approach:
  - Preserve one canonical RPC/read-model per screen.
  - Slim the existing sales and billing read boundaries instead of adding more parallel queries.
  - Add the missing descending/sort indexes through one forward-only migration.

### Findings Reviewed But Not Promoted To New Fix Prompts
- Daily canonicality sweep:
  - the newest available canonicality artifact is still `daily-canonicality-sweep-raw-2026-03-27.json`, and it does not introduce a fresher open runtime drift item beyond the workflow/schema issues already promoted above.
- Shared resolver drift check:
  - the latest report documents fixes that already landed for member-file identity checks, MCC attendance billing filters, and provider/hospital normalized writes.
- Idempotency & duplicate submission audit:
  - the latest report does not expose a new must-fix production bug beyond already-known staged workflow issues; the remaining manual member-file duplicate question is still a product-rule decision, not a safe blind code prompt.
- Schema migration safety audit:
  - no fresh repo-side table/RPC/bucket drift was found; the actionable migration issue is the newer dirty-workspace `0215` schema/runtime dependency from the ACID audit.

## 2. Codex Fix Prompts

### Prompt 1. Lock down privileged RPCs and paginate member-file history
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Two RPC boundaries are still too broad. `rpc_list_member_files(uuid)` is callable by `authenticated` and returns full per-member file history, and `rpc_reconcile_expired_pof_requests(integer)` is still callable by `authenticated` even though it is a workflow-control function.

Scope:
- Domain/workflow: member files and POF expiry reconciliation
- Canonical entities/tables: member_files, pof_requests, document_events
- Expected canonical path: UI -> server action -> service layer -> server-only Supabase wrapper -> RPC/Supabase

Required approach:
1) Inspect these files first:
   - supabase/migrations/0145_reports_and_member_files_read_rpcs.sql
   - supabase/migrations/0204_pof_expiry_reconciliation_rpc.sql
   - lib/services/member-command-center-runtime.ts
   - lib/services/member-files.ts
2) Revoke `authenticated` execute from both RPCs and grant only the minimum trusted role needed.
3) Route both call sites through canonical server-only wrappers so direct app behavior stays the same.
4) Update the member-file list boundary so MCC first load fetches a paginated initial slice instead of the full file history.
5) Preserve existing role/category restrictions and do not introduce UI-side Supabase reads.

Validation:
- Run typecheck and report results.
- List the exact grants changed and the files updated.
- Add or update regression coverage for service-role-only member-file listing and paginated MCC file loading.

Do not overengineer. Keep Supabase as source of truth and keep one canonical read path.
```

### Prompt 2. Replace broad authenticated RLS with explicit permission-aware policies
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Several sensitive tables still allow reads or writes through broad authenticated RLS policies that do not match Memory Lane's intended role and permission model.

Scope:
- Domain/workflow: intake, care plans, billing, and operational/member tables
- Canonical entities/tables: intake_assessments, assessment_responses, intake_assessment_signatures, care_plan_sections, care_plan_versions, care_plan_review_history, care_plan_signature_events, billing_batches, billing_invoices, billing_adjustments, billing_invoice_lines, billing_coverages, billing_export_jobs, attendance_records, member_notes, member_files, member_health_profiles, and related tables named in the audit
- Expected canonical path: app/service authorization and database RLS agree on the same permission boundary

Required approach:
1) Inspect these files first:
   - docs/audits/supabase-rls-security-audit-2026-04-18.md
   - lib/permissions/core.ts
   - lib/services/care-plan-authorization.ts
   - lib/services/progress-note-authorization.ts
   - the migrations that currently define the flagged policies
2) Add forward-only migrations that replace broad `using (true)` / `with check (true)` style policies with explicit role/permission-aware predicates.
3) Align read and write policies to the canonical permission helpers the app already uses, or tighten the helpers first if the helper itself is too broad.
4) Preserve canonical service paths and do not solve this by widening service-role usage.
5) Update tests so the intended staff roles still work and out-of-scope authenticated users no longer do.

Validation:
- Run typecheck and report results.
- Report every table/policy changed and any permission helper changes required.
- Add regression coverage for at least one intake write path, one care-plan path, and one billing/operational read path.

Do not add new fallback authorization paths. Keep the DB boundary and app boundary aligned.
```

### Prompt 3. Make intake -> draft POF persistence and readback explicit
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
The workflow simulation still marks Intake Assessment -> Physician Orders / POF generation as broken because the canonical `physician_orders` write/readback proof is not explicit enough.

Scope:
- Domain/workflow: intake assessment -> draft physician order creation
- Canonical entities/tables: intake_assessments, intake_post_sign_follow_up_queue, physician_orders
- Expected canonical write path: UI -> server action -> canonical intake service -> physician-order service/RPC -> Supabase

Required approach:
1) Inspect these files first:
   - app/intake-actions.ts
   - lib/services/intake-pof-mhp-cascade.ts
   - lib/services/physician-orders-supabase.ts
   - lib/services/physician-orders-read.ts
2) Keep the existing RPC/service boundary authoritative. Do not patch this in page components.
3) Identify why downstream code cannot prove the draft physician order exists after the intake handoff.
4) Tighten the service contract so caller success only upgrades when canonical `physician_orders` readback is explicit and deterministic.
5) Preserve staged follow-up truth for queued/degraded cases. Do not fake a fully ready downstream state.

Validation:
- Run typecheck and report results.
- Add or update regression coverage for successful intake-created draft POF readback.
- List changed files and downstream impact on intake and physician-order flows.

Keep the fix small, canonical, and auditable.
```

### Prompt 4. Fix care-plan false-failure after commit and make resend protection production-real
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Care-plan create/review flows can still fail after the care plan already committed because the write-boundary assertion still expects `ready` even when the legitimate persisted state is `signed_pending_caregiver_dispatch`. The terminal resend guard also exists only as an unapplied workspace migration.

Scope:
- Domain/workflow: care-plan post-sign create/review/send flows
- Canonical entities/tables: care_plans, care_plan_signature_events, care_plan_versions
- Expected canonical path: UI -> server action -> care-plan service/RPC -> Supabase

Required approach:
1) Inspect these files first:
   - lib/services/care-plans-supabase.ts
   - app/care-plan-actions.ts
   - supabase/migrations/0212_care_plan_caregiver_prepare_terminal_guard.sql
2) Update the boundary check so the service accepts the legitimate pending readiness state when caregiver dispatch is still outstanding.
3) Ensure any partial-commit error path always returns persisted truth with the `carePlanId` instead of a generic failure.
4) Commit/apply the terminal resend guard migration and keep regression coverage paired with it.
5) Preserve current staged readiness vocabulary. Do not collapse pending caregiver dispatch into `ready`.

Validation:
- Run typecheck and report results.
- Add or update regression coverage for create/review after nurse/admin signature and resend attempts from non-terminal states.
- Report changed files, migration impact, and any downstream UI behavior change.

Do not weaken auditability and do not return synthetic failure after a committed save.
```

### Prompt 5. Ship enrollment packet schema/runtime together and make completion durability explicit
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Enrollment packet completion still has two linked durability problems: runtime now depends on `lead_activities.enrollment_packet_request_id` before the schema is safely committed/applied, and finalized artifacts/follow-up state are still persisted after the packet is already marked completed.

Scope:
- Domain/workflow: enrollment packet completion, lead-activity linkage, finalized artifacts, follow-up status
- Canonical entities/tables: enrollment_packet_requests, enrollment_packet_uploads, member_files, enrollment_packet_mapping_runs, lead_activities
- Expected canonical path: public packet completion -> canonical enrollment service -> Supabase + durable post-commit repair state

Required approach:
1) Inspect these files first:
   - lib/services/enrollment-packet-completion-cascade.ts
   - lib/services/enrollment-packet-mapping-runtime.ts
   - lib/services/enrollment-packets-public-runtime-artifacts.ts
   - lib/services/enrollment-packets-public-runtime-follow-up.ts
   - supabase/migrations/0215_lead_activity_enrollment_packet_link.sql
2) Treat the `0215` migration and runtime linkage change as one deploy unit. Do not ship runtime ahead of schema.
3) Replace notes-text linkage checks with the schema-backed relationship.
4) Add a durable artifact/follow-up persistence contract so packet completion cannot report upgraded truth unless artifact and follow-up writes are either durably complete or explicitly marked for repair.
5) Preserve current public token safety and canonical enrollment service boundaries.

Validation:
- Run typecheck and report results.
- Add or update regression coverage for schema-backed lead-activity linkage and for partial artifact/follow-up failure handling.
- Report migration impact, changed files, and what repair state exists when post-commit work degrades.

Do not introduce a second enrollment completion path. Keep the fix canonical and migration-driven.
```

### Prompt 6. Slim the founder-facing dashboards and add the missing read indexes
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
The sales dashboard RPC and billing revenue dashboard still do too much work per request, and the admin audit trail still lacks a standalone `created_at desc` index.

Scope:
- Domain/workflow: founder/staff dashboard read paths
- Canonical entities/tables: leads, lead_activities, community_partner_organizations, referral_sources, audit_logs, billing_* tables used by dashboard summary reads
- Expected canonical path: one canonical Supabase read-model/RPC boundary per screen

Required approach:
1) Inspect these files first:
   - supabase/migrations/0209_sales_dashboard_summary_lead_count_slimming.sql
   - lib/services/sales-workflows.ts
   - lib/services/billing-preview-helpers.ts
   - lib/services/billing-read-supabase.ts
   - lib/services/admin-audit-trail.ts
2) Keep one canonical sales dashboard RPC boundary, but reduce full-table lead-state rebuilds and unrelated whole-table counts where possible.
3) Refactor the billing dashboard summary so one request does not re-read overlapping transportation, ancillary, and adjustment data through multiple heavy paths.
4) Add a forward-only migration for the missing index set from the April 19 query audit, starting with `audit_logs(created_at desc)`, `community_partner_organizations(organization_name)`, and `referral_sources(organization_name)`.
5) Preserve current founder/staff-visible numbers and avoid introducing duplicate query families.

Validation:
- Run typecheck and report results.
- Report exactly which queries were slimmed and which indexes were added.
- Add or update focused regression coverage if summary behavior changes.

Do not overengineer. Keep Supabase canonical and keep one read-model boundary per screen.
```

## 3. Fix Priority Order
1. Prompt 4: fix care-plan false-failure after commit and make resend protection production-real.
2. Prompt 5: ship enrollment packet schema/runtime together and make completion durability explicit.
3. Prompt 1: lock down privileged RPCs and paginate member-file history.
4. Prompt 2: replace broad authenticated RLS with explicit permission-aware policies.
5. Prompt 3: make intake -> draft POF persistence and readback explicit.
6. Prompt 6: slim the founder-facing dashboards and add the missing read indexes.

## 4. Founder Summary
- The highest-risk work is no longer broad “audit cleanup.” It is a smaller set of concrete production boundaries that can still return the wrong truth or expose the wrong data.
- The top blockers are the care-plan false-failure-after-commit path and the enrollment packet completion durability/schema gap. Both can tell staff the wrong thing about what really persisted.
- Security work is next: privileged RPCs are still too broad, and several sensitive tables still trust database policies that are looser than the app’s intended role model.
- The intake -> draft POF handoff still needs a stronger proof-of-write/readback contract, but it looks fixable inside the existing canonical service/RPC boundary rather than with a rewrite.
- Shared resolver drift and the last idempotency pass mostly confirmed already-landed fixes, so I did not pad this run with stale prompts.
- The best performance work to queue after the safety fixes is still the dashboard read paths and the missing read-side indexes, especially for `audit_logs` and the partner/referral directories.
