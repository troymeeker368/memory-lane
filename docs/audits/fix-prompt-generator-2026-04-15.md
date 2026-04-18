# Fix Prompt Generator Report
Generated: 2026-04-15

## 1. Issues Detected

### Issue 1. Intake -> draft POF handoff is still the only workflow currently marked broken
- Audit sources:
  - `docs/audits/workflow-simulation-audit-2026-04-15.md`
  - `docs/audits/acid-transaction-audit-2026-04-04.md`
- Architectural rule being violated:
  - Supabase-first canonical write path
  - Workflow state integrity
  - Explicit persistence verification before claiming downstream readiness
- Why this is still a real issue:
  - The repo has canonical intake and physician-order services, but the newest workflow simulation still could not prove the intake handoff is durably evidenced as a `physician_orders` write.
  - Current code already handles committed-readback misses, which suggests the real gap is not “no POF logic exists,” but “the canonical persistence/readback contract is still too implicit for downstream consumers and regression coverage.”
- Safest fix approach:
  - Keep `rpc_create_draft_physician_order_from_intake` and the existing physician-order service boundary authoritative.
  - Tighten the handoff so the post-sign/readback contract explicitly proves the draft physician order exists and is the only canonical follow-up result returned to staff-facing consumers.

### Issue 2. Enrollment packet completion still uses note-text matching for lead-activity linkage
- Audit sources:
  - `docs/audits/workflow-simulation-audit-2026-04-15.md`
- Architectural rule being violated:
  - Canonical entity identity
  - Shared resolver / service boundaries
  - Migration-driven schema alignment
- Why this is still a real issue:
  - `lib/services/enrollment-packet-completion-cascade.ts` still checks lead-activity linkage by searching packet ids inside `lead_activities.notes`.
  - That is not a schema-backed relationship, so completion repair/readback can drift even when the actual activity write happened.
- Safest fix approach:
  - Add one schema-backed packet reference for enrollment-generated lead activities.
  - Keep the write and verification logic inside the existing enrollment packet service boundary.

### Issue 3. Staged workflow readiness is still not fully standardized across intake, enrollment, signed POF, and care plan flows
- Audit sources:
  - `docs/audits/acid-transaction-audit-2026-04-04.md`
  - `docs/audits/workflow-simulation-audit-2026-04-15.md`
- Architectural rule being violated:
  - Workflow state integrity
  - Clear handoffs between workflows
  - Shared resolver / service boundaries
- Why this is still a real issue:
  - The repo now has real committed/readiness vocabulary, but audits still show staff can misread “signed” or “completed” as “operationally ready” when follow-up queues are still pending or degraded.
  - This is now a consumer-alignment problem, not a persistence-fabrication problem.
- Safest fix approach:
  - Reuse the existing committed/readiness vocabulary and push it through the highest-traffic staged workflow consumers instead of adding new status terms.

### Issue 4. Health dashboard MAR still loads more data than the dashboard actually needs
- Audit sources:
  - `docs/audits/supabase-query-performance-audit-2026-04-11.md`
- Architectural rule being violated:
  - Shared canonical read boundary discipline
  - Production-readiness / scale safety
- Why this is still a real issue:
  - The main MAR board got safer, but the health dashboard still reads the full `v_mar_today` dataset and trims it in application code just to render a small action window and recent-admin list.
  - That keeps a homepage-style screen heavier than it needs to be.
- Safest fix approach:
  - Build one narrower dashboard-specific MAR read boundary or RPC.
  - Preserve current dashboard behavior and keep Supabase as the source of truth.

### Issue 5. Member-file delete is still not repair-safe after storage-first success
- Audit sources:
  - `docs/audits/acid-transaction-audit-2026-04-04.md`
- Architectural rule being violated:
  - ACID durability
  - Explicit failure and auditability
- Why this is still a real issue:
  - The service avoids false success, but if storage deletion succeeds and the DB delete fails, the system can still be left with a `member_files` row pointing to a missing object.
  - That is safer than silent success, but still leaves durable drift that should be repairable and auditable.
- Safest fix approach:
  - Preserve the current no-false-success contract.
  - Add a deterministic repair-safe delete pattern instead of treating the storage-first partial failure as a one-off edge case.

### Findings Reviewed But Not Promoted To New Fix Prompts
- `user_permissions` RLS hardening:
  - stale audit finding; current repo already contains `0183`, `0186`, and `0198` hardening migrations.
- Sales dashboard RPC slimming:
  - current worktree already contains `supabase/migrations/0209_sales_dashboard_summary_lead_count_slimming.sql` and related tests.
- Missing query-performance indexes:
  - current worktree already contains `supabase/migrations/0210_query_audit_missing_indexes.sql` and related tests.
- Billing read containment:
  - current worktree already shows billing read/page edits in progress, so I did not duplicate that prompt.
- Schema migration safety:
  - no fresh repo-side drift finding; remaining blocker is linked-project migration history repair outside this code-review-only run.
- Shared resolver drift and idempotency duplicate audit:
  - latest available reports describe fixes that already landed and do not expose a new still-open low-risk prompt.

## 2. Codex Fix Prompts

### Prompt 1. Make intake -> draft POF persistence/readback explicit and canonical
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
The latest workflow simulation still marks Intake Assessment -> Physician Orders / POF generation as broken because the canonical physician_orders write/readback contract is not explicit enough. Intake can commit, but downstream proof of the draft POF handoff is still too fragile.

Scope:
- Domain/workflow: intake assessment -> draft physician order creation
- Canonical entities/tables: intake_assessments, intake_post_sign_follow_up_queue, physician_orders
- Expected canonical write path: UI -> server action -> canonical intake/physician-order service -> Supabase RPC -> physician_orders

Required approach:
1) Inspect these files first:
   - app/(portal)/health/assessment/[assessmentId]/actions.ts
   - app/intake-actions.ts
   - lib/services/intake-pof-mhp-cascade.ts
   - lib/services/physician-orders-supabase.ts
   - lib/services/physician-orders-read.ts
2) Keep rpc_create_draft_physician_order_from_intake as the authoritative persistence boundary. Do not move this into page code.
3) Find the exact gap between committed intake success and canonical proof that the draft physician order exists.
4) Tighten the service/action contract so staff-facing callers only treat the handoff as ready when physician_orders readback is explicit and canonical.
5) Preserve the existing staged truth model for follow-up-required cases. Do not fake “all ready” success if the draft POF committed but verification still needs follow-up.
6) Remove any duplicate or weaker fallback logic that can disagree with the canonical physician-order service boundary.

Validation:
- Run typecheck and report results.
- Add or update regression coverage proving intake follow-up now explicitly verifies the physician_orders handoff.
- List changed files and downstream effects on intake and physician-order flows.

Do not overengineer. Keep Supabase as source of truth and keep one canonical write path.
```

### Prompt 2. Replace enrollment packet lead-activity note matching with schema-backed linkage
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Enrollment packet completion still proves lead-activity linkage by searching the packet id inside lead_activities.notes instead of using a schema-backed packet reference.

Scope:
- Domain/workflow: enrollment packet completion -> lead activity logging and repair/readback
- Canonical entities/tables: enrollment_packet_requests, lead_activities
- Expected canonical write path: public packet completion -> canonical enrollment service -> Supabase

Required approach:
1) Inspect these files first:
   - lib/services/enrollment-packet-completion-cascade.ts
   - lib/services/enrollment-packet-mapping-runtime.ts
   - lib/services/sales-crm-supabase.ts
2) Keep enrollment packet completion and lead-activity writes inside the current canonical service path. Do not patch this in UI code.
3) Add one schema-backed way to link enrollment-generated lead activities to enrollment_packet_requests.
4) Update the canonical write path to populate that link.
5) Replace notes-based verification and repair logic with the schema-backed relationship.
6) If legacy rows need compatibility, add a bounded legacy fallback only for old rows and keep it clearly temporary.

Validation:
- Run typecheck and report results.
- Add or update regression coverage proving packet completion readback no longer depends on notes text matching.
- List migration impact, changed files, and any legacy-row compatibility handling.

Do not create a second lead-activity write path. Keep schema and runtime aligned.
```

### Prompt 3. Standardize staged-workflow readiness on the existing canonical vocabulary
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Enrollment, intake, signed POF, and care plan flows now have real committed/readiness truth, but staff-facing consumers still do not use that shared vocabulary consistently. That makes some staged workflows look more ready than they really are.

Scope:
- Domain/workflow: staged workflow readiness across enrollment, intake, POF, and care plan follow-up
- Canonical entities/tables: existing workflow tables plus the shared committed-workflow-state helpers
- Expected canonical path: service layer computes readiness -> server actions/pages render that canonical truth

Required approach:
1) Inspect these files first:
   - lib/services/committed-workflow-state.ts
   - lib/services/enrollment-packet-readiness.ts
   - lib/services/intake-post-sign-readiness.ts
   - lib/services/physician-order-clinical-sync.ts
   - lib/services/care-plan-post-sign-readiness.ts
2) Reuse the existing readiness vocabulary (committed, ready, queued_degraded, follow_up_required). Do not invent new status labels.
3) Identify the highest-traffic staff-facing consumers that still bury or bypass the canonical readiness meaning.
4) Wire those consumers to the shared readiness helpers so “signed” or “completed” is never shown as fully ready when follow-up is still pending.
5) Preserve current queue-backed and follow-up-required behavior. Do not collapse staged truth into one generic success message.

Validation:
- Run typecheck and report results.
- Add or update regression coverage for at least one queued_degraded and one follow_up_required path.
- Report exactly which staff-facing views/actions now consume the shared readiness contract.

Keep the fix incremental and auditable.
```

### Prompt 4. Contain the health dashboard MAR read path
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
The health dashboard still loads the full v_mar_today dataset and trims it in application code, even though the page only needs a narrow action window plus a small recent-administration list.

Scope:
- Domain/workflow: health dashboard MAR summary
- Canonical entities/tables: v_mar_today and any existing MAR read-model RPC/view boundary
- Expected canonical read path: dashboard service -> one narrow Supabase-backed read boundary

Required approach:
1) Inspect these files first:
   - lib/services/mar-dashboard-read-model.ts
   - lib/services/health-dashboard.ts
   - any existing MAR read RPCs/views that could safely support a narrower dashboard payload
2) Keep Supabase as source of truth.
3) Build the smallest safe read boundary that returns only the rows and counts the health dashboard actually needs.
4) Preserve current founder/staff-visible dashboard behavior.
5) Do not patch this with client-side trimming or duplicate ad hoc queries.

Validation:
- Run typecheck and report results.
- Add or update regression coverage proving the dashboard no longer depends on a full v_mar_today payload.
- Report changed files and any schema/RPC impact.

Do not overengineer. Prefer one canonical dashboard read path.
```

### Prompt 5. Make member-file delete repair-safe after storage-first partial failure
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Member-file delete avoids false success, but if storage deletion succeeds and the DB delete fails, the system can still be left with a member_files row pointing to a missing object.

Scope:
- Domain/workflow: member file deletion
- Canonical entities/tables: member_files and the member-documents storage bucket
- Expected canonical write path: service layer delete contract -> Supabase DB + storage

Required approach:
1) Inspect lib/services/member-files.ts first and trace the current delete flow end to end.
2) Preserve the current no-false-success behavior.
3) Add a deterministic repair-safe pattern for storage-first partial failure. Prefer a small auditable contract such as explicit repair metadata, a cleanup queue, or a clearly bounded drift-repair path.
4) Keep the delete boundary canonical in the service layer. Do not push repair logic into the UI.
5) Preserve existing role restrictions and auditability.

Validation:
- Run typecheck and report results.
- Add or update regression coverage for: storage delete succeeds, DB delete fails, and repair/follow-up remains deterministic.
- Report changed files, schema impact if any, and how staff will know cleanup is still required.

Do not weaken durability truth and do not return synthetic success.
```

## 3. Fix Priority Order
1. Make intake -> draft POF persistence/readback explicit and canonical.
2. Replace enrollment packet lead-activity note matching with schema-backed linkage.
3. Standardize staged-workflow readiness on the existing canonical vocabulary.
4. Contain the health dashboard MAR read path.
5. Make member-file delete repair-safe after storage-first partial failure.

## 4. Founder Summary
- The newest audit set narrows the real work down to five still-actionable themes instead of ten separate reports worth of noise.
- The top issue is now the intake -> draft POF handoff. It is the only workflow the April 15 simulation still marks as outright broken, so it should move ahead of softer “readiness wording” cleanup.
- Enrollment packet lead activity is still a structural bug, not just a reporting annoyance, because packet linkage is still proven by text inside `lead_activities.notes` instead of a schema-backed relationship.
- The repo has improved on committed-vs-ready truth, but the next hardening step is to make more staff-facing surfaces actually consume that shared readiness contract consistently.
- The highest-value performance fix still open is the health dashboard MAR read path. Sales dashboard slimming and the missing index migration are already visibly in progress in the current dirty worktree, so I did not reissue them.
- I intentionally did not revive stale prompts for `user_permissions` RLS, older query indexes, or shared-resolver/idempotency items that newer repo evidence shows are already landed or already in flight.
