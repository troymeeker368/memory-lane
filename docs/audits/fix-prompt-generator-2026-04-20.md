# Fix Prompt Generator Report
Generated: 2026-04-20

## 1. Issues Detected

### Issue 1. Care-plan post-sign flows can still return failure after a committed save
- Audit sources:
  - `docs/audits/acid-transaction-audit-2026-04-18.md`
  - `docs/audits/workflow-simulation-audit-2026-04-20.md`
- Architectural rule being violated:
  - ACID durability
  - Workflow state integrity
  - Explicit failures when persistence or required side effects fail
- Why this is still a live issue:
  - Care-plan create/review can commit the plan, signature event, and snapshot, then still fail because the write-boundary assertion still expects `ready` while the legitimate persisted state is now `signed_pending_caregiver_dispatch`.
  - That creates a false-failure path that can lead staff to retry a workflow that already saved.
- Safest fix approach:
  - Keep the care-plan service and RPC boundary authoritative.
  - Update the write-boundary contract to accept the real persisted pending state and ensure partial-commit paths always return persisted truth with `carePlanId`.
  - Pair the code change with the still-uncommitted terminal resend guard migration.

### Issue 2. Enrollment packet completion still has linked schema/runtime and post-commit durability gaps
- Audit sources:
  - `docs/audits/acid-transaction-audit-2026-04-18.md`
  - `docs/audits/workflow-simulation-audit-2026-04-20.md`
- Architectural rule being violated:
  - Migration-driven schema
  - ACID atomicity and durability
  - Supabase as source of truth
- Why this is still a live issue:
  - Runtime code now depends on `lead_activities.enrollment_packet_request_id`, but that schema still lives only in untracked migration `0215`.
  - Packet completion can still durably mark the packet completed before finalized artifact persistence and follow-up state persistence are fully durable.
- Safest fix approach:
  - Treat migration `0215` and the runtime linkage change as one deploy unit.
  - Add a durable artifact-batch / repair-state contract so completion truth is not upgraded unless artifacts and follow-up persistence are durably tracked.

### Issue 3. Sensitive database boundaries are still broader than the app’s intended permission model
- Audit sources:
  - `docs/audits/supabase-rls-security-audit-2026-04-18.md`
- Architectural rule being violated:
  - Preserve role restrictions and data integrity
  - Supabase-first architecture
  - Canonical service boundaries
- Why this is still a live issue:
  - Intake, care-plan, billing, operational, member-health-profile, and member-file tables still contain broad authenticated RLS paths that are looser than the app’s real authorization model.
  - Two privileged `security definer` RPCs remain too broad: `rpc_list_member_files(uuid)` and `rpc_reconcile_expired_pof_requests(integer)`.
  - Several write-capable health permission helpers still rely on `canView` instead of `canEdit`.
- Safest fix approach:
  - Tighten DB policies and RPC execute grants first, not UI checks.
  - Align health write helpers to the same explicit permission boundary.
  - Keep reads and writes behind canonical server/service wrappers instead of widening service-role usage.

### Issue 4. Signed intake is still not the same as a provably ready draft POF
- Audit sources:
  - `docs/audits/workflow-simulation-audit-2026-04-20.md`
  - `docs/audits/acid-transaction-audit-2026-04-18.md`
- Architectural rule being violated:
  - Canonical write path
  - Workflow state integrity
  - Explicit persistence verification before downstream success
- Why this is still a live issue:
  - The intake write path is durable, but draft POF creation can still degrade into queued follow-up or unclear readback proof.
  - Staff can see a signed intake without a clearly verified downstream `physician_orders` record being available yet.
- Safest fix approach:
  - Preserve the existing intake and physician-order RPC boundary.
  - Tighten the success/readback contract so signed intake only reports a fully ready downstream state when the draft physician order is durably visible through the canonical read path.

### Issue 5. Signed POF is still not the same as clinically ready downstream state
- Audit sources:
  - `docs/audits/workflow-simulation-audit-2026-04-20.md`
- Architectural rule being violated:
  - Workflow state integrity
  - Clear handoffs between workflows
  - Shared resolver/service truth
- Why this is still a live issue:
  - Provider signature completion is durable, but MHP, MCC, and MAR sync can still be queued or degraded afterward.
  - Staff can misread “signed” as “clinically synced and ready” when those are not the same thing.
- Safest fix approach:
  - Keep the post-sign queue/service boundary authoritative.
  - Tighten the staff-facing readiness model so downstream UI truth distinguishes signed, queued, degraded, and ready states without inventing a second workflow path.

### Issue 6. Billing custom-invoice orchestration is still not fully atomic end to end
- Audit sources:
  - `docs/audits/production-readiness-audit-2026-04-02.md`
- Architectural rule being violated:
  - Shared RPC standard
  - ACID atomicity
  - One canonical write path per workflow
- Why this is still a live issue:
  - Custom invoice source reads and invoice numbering are still assembled in service code before RPC persistence, so the workflow is not yet one fully atomic boundary.
  - That is an architectural production-readiness gap even though no new fallback fabrication was detected.
- Safest fix approach:
  - Keep custom invoice generation on one canonical billing RPC-backed service path.
  - Move pre-persist orchestration that affects durable outcome into the transactional boundary instead of splitting truth across TS prework plus RPC write.

### Issue 7. Founder-facing dashboards and list screens still have a small set of concentrated read-scale risks
- Audit sources:
  - `docs/audits/supabase-query-performance-audit-2026-04-20.md`
  - `docs/audits/rpc-architecture-audit-2026-03-24.md`
- Architectural rule being violated:
  - One canonical read boundary per screen
  - Production-readiness / scale safety
  - Shared RPC/read-model discipline
- Why this is still a live issue:
  - The sales dashboard summary RPC still rebuilds broad lead state and whole-table counts.
  - The billing revenue dashboard still re-reads overlapping raw billing tables in one request.
  - The admin audit trail and partner/referral directories still miss a few useful read-side indexes.
  - Completed enrollment-packet reporting still does bounded over-read plus search fan-out instead of true pagination.
- Safest fix approach:
  - Preserve one canonical read-model boundary per screen.
  - Slim the heaviest RPC/read paths and add the missing indexes through forward-only migrations.
  - Do not reintroduce unbounded MCC member-file loading; that issue improved in the current tree.

## 2. Codex Fix Prompts

### Prompt 1. Fix care-plan false-failure after commit and make resend protection production-real
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Care-plan create/review can still fail after the care plan already committed because the write-boundary assertion still expects `ready` even when the legitimate persisted state is `signed_pending_caregiver_dispatch`. The terminal resend guard also still lives only in workspace migration `0212`.

Scope:
- Domain/workflow: care-plan create, review, post-sign dispatch, resend/reset safety
- Canonical entities/tables: care_plans, care_plan_signature_events, care_plan_versions
- Expected canonical write path: UI -> server action -> care-plan service/RPC -> Supabase

Required approach:
1) Inspect these files first:
   - lib/services/care-plans-supabase.ts
   - app/care-plan-actions.ts
   - lib/services/care-plan-esign.ts
   - supabase/migrations/0212_care_plan_caregiver_prepare_terminal_guard.sql
2) Keep the care-plan service and RPC boundary authoritative. Do not patch this in UI components.
3) Update the write-boundary assertion so it accepts the legitimate persisted pending state when caregiver dispatch is still outstanding.
4) Ensure any partial-commit error path always carries `carePlanId` so the action can return persisted truth instead of a generic failure.
5) Commit/apply the terminal resend guard migration and preserve the current readiness vocabulary. Do not collapse pending caregiver dispatch into `ready`.

Validation:
- Run typecheck/build and report results.
- Add or update regression coverage for create/review after nurse/admin signature and resend attempts from non-terminal states.
- List changed files, migration impact, and downstream UI behavior changes.

Do not overengineer. Do not return synthetic failure after a committed save.
```

### Prompt 2. Ship enrollment packet schema/runtime together and harden completion durability
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Enrollment packet completion still has linked schema/runtime and durability gaps. Runtime now depends on `lead_activities.enrollment_packet_request_id` before migration `0215` is safely committed/applied, and finalized artifacts / follow-up state are still persisted after the packet is already marked completed.

Scope:
- Domain/workflow: enrollment packet completion, lead-activity linkage, finalized artifacts, follow-up persistence
- Canonical entities/tables: enrollment_packet_requests, enrollment_packet_uploads, member_files, enrollment_packet_follow_up_queue, lead_activities
- Expected canonical path: public packet completion -> canonical enrollment service -> Supabase + durable repair state

Required approach:
1) Inspect these files first:
   - lib/services/enrollment-packet-completion-cascade.ts
   - lib/services/enrollment-packet-mapping-runtime.ts
   - lib/services/enrollment-packets-public-runtime-artifacts.ts
   - lib/services/enrollment-packets-public-runtime-follow-up.ts
   - lib/services/enrollment-packets-public-runtime-post-commit.ts
   - supabase/migrations/0215_lead_activity_enrollment_packet_link.sql
2) Treat migration `0215` and the runtime linkage change as one deploy unit. Do not ship runtime ahead of schema.
3) Replace notes-text linkage assumptions with the schema-backed relationship.
4) Add a durable artifact-batch or equivalent repair-owned persistence contract so packet completion cannot report upgraded truth unless finalized artifacts and follow-up persistence are durably tracked.
5) Preserve current public token safety, canonical enrollment services, and explicit degraded/repair states when post-commit work fails.

Validation:
- Run typecheck/build and report results.
- Add or update regression coverage for schema-backed lead-activity linkage and partial artifact/follow-up failure handling.
- Report changed files, migration impact, and what repair state exists when post-commit work degrades.

Do not create a second enrollment completion path. Keep the fix canonical and migration-driven.
```

### Prompt 3. Tighten DB authorization boundaries and privileged RPC access
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Sensitive tables still rely on broad authenticated RLS paths, two privileged security-definer RPCs are still callable too broadly, and several health write-capability helpers still allow write workflows with `canView` instead of `canEdit`.

Scope:
- Domain/workflow: intake, care plans, billing, operational/member reads, member files, POF expiry reconciliation, health write actions
- Canonical entities/tables: intake_assessments, assessment_responses, intake_assessment_signatures, care_plan_sections, care_plan_versions, care_plan_review_history, care_plan_signature_events, billing_* tables flagged in the audit, attendance_records, member_notes, member_files, member_health_profiles, pof_requests
- Expected canonical path: DB policy + service authorization agree on the same permission boundary

Required approach:
1) Inspect these files first:
   - docs/audits/supabase-rls-security-audit-2026-04-18.md
   - lib/permissions/core.ts
   - lib/services/care-plan-authorization.ts
   - lib/services/progress-note-authorization.ts
   - lib/services/member-command-center-runtime.ts
   - supabase/migrations/0145_reports_and_member_files_read_rpcs.sql
   - supabase/migrations/0204_pof_expiry_reconciliation_rpc.sql
2) Add forward-only migrations that replace broad authenticated policies with explicit permission-aware predicates.
3) Revoke broad execute access from `rpc_list_member_files(uuid)` and `rpc_reconcile_expired_pof_requests(integer)` and route usage through the minimum trusted server/service wrapper.
4) Change write-capable health permission helpers to require `canEdit` where the workflow truly mutates data.
5) Preserve canonical service paths and do not solve this by widening service-role usage or adding UI-only guards.

Validation:
- Run typecheck/build and report results.
- Report every table/policy/grant/helper changed.
- Add regression coverage for at least one intake write path, one care-plan or POF write path, and one privileged RPC access boundary.

Do not add fallback authorization paths. Keep the DB boundary and app boundary aligned.
```

### Prompt 4. Make signed intake -> draft POF readiness provable
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Signed intake is still not the same as a provably ready draft POF. The durable intake path exists, but downstream draft physician-order creation can still degrade into queued follow-up or unclear readback proof.

Scope:
- Domain/workflow: intake assessment signing -> draft physician order / POF creation
- Canonical entities/tables: intake_assessments, intake_post_sign_follow_up_queue, physician_orders
- Expected canonical write path: UI -> server action -> intake service/RPC -> physician-order service/RPC -> Supabase

Required approach:
1) Inspect these files first:
   - app/intake-actions.ts
   - lib/services/intake-pof-mhp-cascade.ts
   - lib/services/physician-orders-supabase.ts
   - lib/services/physician-orders-read.ts
2) Preserve the existing intake and physician-order service/RPC boundary. Do not patch this in page components.
3) Identify why downstream code cannot prove the draft physician order exists after intake signing.
4) Tighten the service contract so the workflow only reports fully ready downstream truth when canonical `physician_orders` readback is explicit and deterministic.
5) Preserve staged follow-up truth for queued/degraded cases. Do not fake a ready state when the draft POF still needs repair or follow-up.

Validation:
- Run typecheck/build and report results.
- Add or update regression coverage for successful signed-intake draft POF readback and degraded follow-up cases.
- List changed files and downstream impact on intake and physician-order workflows.

Keep the fix small, canonical, and auditable.
```

### Prompt 5. Separate “provider signed” from “clinically synced and ready”
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Signed POF is still not the same as clinically ready downstream state. MHP, MCC, and MAR sync can still be queued or degraded after provider signature, but staff-facing truth can blur those states together.

Scope:
- Domain/workflow: provider POF signature -> downstream MHP/MCC/MAR post-sign sync
- Canonical entities/tables: physician_orders, pof_requests, pof_post_sign_sync_queue, member_health_profiles, member_command_centers, mar_schedules
- Expected canonical path: public/provider signature -> canonical POF finalize service -> post-sign sync queue/service -> Supabase-backed readiness truth

Required approach:
1) Inspect these files first:
   - lib/services/pof-esign.ts
   - lib/services/pof-esign-public.ts
   - lib/services/physician-order-post-sign-service.ts
   - lib/services/pof-post-sign-runtime.ts
   - any staff-facing readiness/status consumers for POF, MHP, MCC, or MAR
2) Keep the current signature-finalization and post-sign queue boundary authoritative.
3) Tighten the readiness/status contract so staff-facing UI and service responses clearly distinguish:
   - provider signed
   - queued for downstream sync
   - degraded / action required
   - downstream clinically ready
4) Preserve current durable signature behavior and do not introduce a second sync path.
5) Update only the minimum downstream consumers needed to keep canonical readiness truth consistent.

Validation:
- Run typecheck/build and report results.
- Add or update regression coverage for signed-but-queued and signed-and-ready states.
- Report changed files and what downstream screens or actions now read the tightened readiness truth.

Do not overengineer. Keep one canonical post-sign readiness model.
```

### Prompt 6. Finish atomic custom-invoice orchestration inside the billing boundary
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Billing custom-invoice orchestration is still not fully atomic end to end. Source reads and invoice numbering are still assembled in service code before RPC persistence, so durable billing truth is split across pre-RPC TypeScript work and the later database write.

Scope:
- Domain/workflow: custom invoice generation
- Canonical entities/tables: billing_invoices, billing_invoice_lines, billing_adjustments, billing_batches, any source tables read during custom invoice assembly
- Expected canonical write path: billing action -> canonical billing service -> transactional billing RPC -> Supabase

Required approach:
1) Inspect these files first:
   - docs/audits/production-readiness-audit-2026-04-02.md
   - lib/services/billing-custom-invoices.ts
   - lib/services/billing-workflows.ts
   - lib/services/billing-rpc.ts
   - supabase/migrations/0178_harden_custom_invoice_rpc_atomicity.sql
2) Identify which pre-RPC steps still affect durable outcome (source material, invoice numbering, conflict handling, or side-effect truth).
3) Move the minimum necessary orchestration into the transactional RPC/service boundary so one canonical path owns the durable result.
4) Preserve existing invoice behavior and downstream billing/reporting expectations.
5) Do not add a second custom-invoice write path or temporary fallback persistence.

Validation:
- Run typecheck/build and report results.
- Add or update regression coverage for duplicate/retry safety and invoice numbering truth.
- Report changed files and any schema/RPC impact.

Keep the fix maintainable and production-safe.
```

### Prompt 7. Slim the highest-cost founder/staff reads and finish the missing indexes
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
A small set of founder/staff reads still carry the main scaling risk: the sales dashboard summary RPC, the billing revenue dashboard fan-out, the admin audit trail newest-first read, partner/referral directory sorting, and completed enrollment-packet reporting over-read.

Scope:
- Domain/workflow: founder/staff dashboards and list screens
- Canonical entities/tables: leads, lead_activities, community_partner_organizations, referral_sources, audit_logs, billing_* tables used by dashboard summary reads, enrollment_packet_requests, profiles
- Expected canonical path: one canonical Supabase read-model/RPC boundary per screen

Required approach:
1) Inspect these files first:
   - docs/audits/supabase-query-performance-audit-2026-04-20.md
   - docs/audits/rpc-architecture-audit-2026-03-24.md
   - supabase/migrations/0209_sales_dashboard_summary_lead_count_slimming.sql
   - lib/services/sales-workflows.ts
   - lib/services/billing-preview-helpers.ts
   - lib/services/billing-read-supabase.ts
   - lib/services/admin-audit-trail.ts
   - lib/services/enrollment-packet-list-support.ts
   - lib/services/enrollment-packets-listing.ts
2) Keep one canonical read-model boundary per screen.
3) Slim the sales dashboard RPC without changing founder-facing summary numbers.
4) Refactor the billing dashboard summary so one request does not re-read overlapping raw billing tables.
5) Add forward-only indexes for `audit_logs(created_at desc)`, `community_partner_organizations(organization_name)`, and `referral_sources(organization_name)`, and validate any lower-priority index before adding it.
6) Convert completed enrollment-packet reporting toward true pagination instead of large bounded reads plus search fan-out.
7) Preserve the current paged MCC member-file behavior and do not reintroduce full-history file loads.

Validation:
- Run typecheck/build and report results.
- Report exactly which queries were slimmed and which indexes were added.
- Add focused regression coverage if summary/list behavior changes.

Do not create duplicate query families. Keep Supabase canonical and the read-model boundaries auditable.
```

## 3. Fix Priority Order
1. Prompt 1: care-plan false-failure after commit and resend guard.
2. Prompt 2: enrollment packet schema/runtime deploy safety and completion durability.
3. Prompt 3: DB authorization boundaries, privileged RPC grants, and write-capability helpers.
4. Prompt 4: signed intake -> draft POF readiness proof.
5. Prompt 5: signed POF downstream readiness truth.
6. Prompt 6: billing custom-invoice atomicity.
7. Prompt 7: dashboard/query performance and missing indexes.

## 4. Founder Summary
- The newest high-value issues are still not “general cleanup.” They are a short list of places where the system can return the wrong operational truth, ship runtime ahead of schema, or trust a looser database boundary than the app really intends.
- The two most urgent fixes are the care-plan false-failure-after-commit bug and the enrollment packet completion/schema deploy gap. Both can mislead staff about what really persisted.
- Security is the next serious bucket. The database still has some broad authenticated access that should not exist, and a few privileged RPC / write-helper boundaries are still too loose.
- Workflow handoff work should focus on one thing: make “signed” and “ready” mean different things when they truly are different, especially for intake -> POF and POF -> MHP/MCC/MAR.
- Billing custom-invoice atomicity is still an architecture debt item from the most recent production-readiness audit, and it is worth fixing before that workflow becomes more operationally central.
- The best performance work after the safety fixes is still the same small set of founder/staff reads: sales dashboard, billing dashboard, audit trail, partner/referral directories, and completed enrollment-packet reporting.
- The latest available reports for canonicality (`2026-03-27`), shared resolver drift (`2026-03-29`), idempotency (`2026-03-29`), schema migration safety (`2026-04-02`), and RPC architecture (`2026-03-24`) did not add a fresher must-fix bug beyond the issues promoted above. They mostly confirmed prior cleanup or pointed at larger longer-horizon consolidation work.
