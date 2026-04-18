# Fix Prompt Generator Report
Generated: 2026-04-12

## 1. Issues Detected

### Issue 1. Enrollment packet completion still uses note-text matching instead of canonical packet linkage
- Audit sources:
  - `docs/audits/workflow-simulation-audit-2026-04-12.md`
- Architectural rule being violated:
  - Canonical entity identity
  - Shared resolver / service boundaries
  - Migration-driven schema and runtime alignment
- Why this is still a real issue:
  - Enrollment packet completion writes real lead activity, but downstream verification still proves packet linkage by searching the packet ID inside `lead_activities.notes`.
  - That is not a schema-backed relationship, so readback can drift even when the write happened.
- Safest fix approach:
  - Add one canonical packet linkage field or equivalent schema-backed relationship for enrollment-related lead activities.
  - Keep all lead-activity writes inside the existing enrollment packet service boundary and remove note-text linkage checks from readback and repair paths.

### Issue 2. Intake staff flows can still confuse committed intake with operational readiness
- Audit sources:
  - `docs/audits/workflow-simulation-audit-2026-04-12.md`
  - `docs/audits/acid-transaction-audit-2026-04-04.md`
- Architectural rule being violated:
  - Workflow state integrity
  - Shared resolver / service boundaries
  - Clear downstream handoffs
- Why this is still a real issue:
  - Intake signature and persistence are durable, but draft POF creation and file verification can still lag behind the committed intake.
  - The remaining risk is consumer drift: staff-facing flows can still key off generic success instead of the canonical readiness contract.
- Safest fix approach:
  - Preserve the existing RPC-backed intake and draft-POF boundaries.
  - Make one shared readiness signal authoritative in intake follow-up consumers and stop treating `ok: true` as equivalent to “POF ready”.

### Issue 3. Signed POF still looks more complete than downstream clinical readiness really is
- Audit sources:
  - `docs/audits/workflow-simulation-audit-2026-04-12.md`
  - `docs/audits/acid-transaction-audit-2026-04-04.md`
- Architectural rule being violated:
  - Workflow state integrity
  - ACID durability truth
  - Clear handoffs between workflows
- Why this is still a real issue:
  - A POF can be durably signed while MHP, MCC, medication sync, and MAR scheduling are still queued or failed for retry.
  - The repo is honest about this in services, but not all staff-facing consumers make the staged truth obvious.
- Safest fix approach:
  - Keep the queue-backed sync model and the current finalize/sign persistence boundary.
  - Push one shared readiness contract through the highest-traffic POF, MHP, MCC, and MAR-adjacent read surfaces.

### Issue 4. Routine MAR documentation still calls milestone delivery without a real notification contract
- Audit sources:
  - `docs/audits/workflow-simulation-audit-2026-04-12.md`
- Architectural rule being violated:
  - Workflow state integrity
  - Explicit operational alerting
  - Auditability
- Why this is still a real issue:
  - Routine MAR `Given` / standard documentation paths call `recordWorkflowMilestone`, but those event types are not mapped to an inbox notification contract.
  - That creates a false impression that routine MAR milestone delivery is covered when only exception paths are actually actionable today.
- Safest fix approach:
  - Keep durable MAR write logging and exception notifications.
  - Remove or reclassify routine non-exception milestone dispatch unless the product explicitly wants inbox rows for every routine MAR event.

### Issue 5. Manual and generated POF PDFs still collapse into a generic member-file identity
- Audit sources:
  - `docs/audits/workflow-simulation-audit-2026-04-12.md`
- Architectural rule being violated:
  - Canonical entity identity
  - Durable artifact persistence
  - Migration-backed schema/runtime alignment
- Why this is still a real issue:
  - The current manual/generated POF PDF save path uses a generic `Physician Order Form` source, so multiple POF versions for the same member can collapse into one `member_files` slot.
  - That weakens order-level auditability and version-specific file retrieval.
- Safest fix approach:
  - Make POF file identity order-specific in the canonical member-file save path.
  - Add schema support only if the existing `member_files` contract cannot already store the authoritative order/version reference.

### Findings Reviewed But Not Promoted To New Fix Prompts
- Sales dashboard RPC slimming:
  - Current worktree already contains `supabase/migrations/0209_sales_dashboard_summary_lead_count_slimming.sql` and `tests/sales-dashboard-rpc-slimming.test.ts`, so I treated this as actively in progress instead of reissuing it as fresh work.
- Missing query-performance indexes:
  - Current worktree already contains `supabase/migrations/0210_query_audit_missing_indexes.sql` and `tests/query-audit-index-hardening.test.ts`, so I did not promote the April 11 index prompt again.
- Billing export / draft-finalize read containment:
  - Current worktree already shows related edits in billing read services and billing pages, so I did not duplicate that prompt.
- `user_permissions` RLS hardening:
  - Prior prompt-generator runs and repo evidence indicated this was already landed via the earlier hardening migration set, so I did not revive the stale April 2 prompt.
- Billing custom-invoice atomicity:
  - Prior repo evidence still suggests the older production-readiness atomicity finding was already addressed with the `0178` / `0185` hardening wave and related tests.

## 2. Codex Fix Prompts

### Prompt 1. Replace enrollment packet lead-activity note matching with canonical packet linkage
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Enrollment packet completion currently proves lead-activity linkage by searching the packet ID inside `lead_activities.notes` instead of using a schema-backed packet reference.

Scope:
- Domain/workflow: enrollment packet completion -> lead activity logging and readback
- Canonical entities/tables: `enrollment_packet_requests`, `lead_activities`, enrollment packet completion/follow-up services
- Expected canonical write path: public completion -> canonical enrollment service layer -> Supabase

Required approach:
1) Inspect `lib/services/enrollment-packet-mapping-runtime.ts` and `lib/services/enrollment-packet-completion-cascade.ts` first.
2) Keep enrollment packet completion and lead-activity writes inside the current canonical service path. Do not patch this in page code.
3) Add one schema-backed way to link a lead activity row to an enrollment packet request. Prefer the smallest clean option:
   - add `enrollment_packet_request_id` to `lead_activities` with a forward-only migration and index, or
   - use an existing canonical field only if one already exists and is production-safe.
4) Update the enrollment packet lead-activity write path to populate that canonical reference.
5) Replace note-text matching checks and repair logic with the schema-backed link.
6) If old rows need compatibility, add a bounded backfill or fallback read path that is explicitly temporary and only used for legacy rows.

Validation:
- Run typecheck.
- Add/update regression coverage proving packet completion readback no longer depends on `notes.includes(packetId)`.
- Report migration impact, changed files, and any legacy-row compatibility handling.

Do not overengineer. Do not create a second activity write path. Keep Supabase as source of truth and keep the enrollment service layer authoritative.
```

### Prompt 2. Make intake readiness metadata authoritative in staff-facing follow-up flows
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Intake signing is durable, but staff-facing intake flows can still treat a committed intake as operationally ready too early when draft POF creation or follow-up verification is still pending.

Scope:
- Domain/workflow: intake post-sign -> draft POF -> intake follow-up readiness
- Canonical entities/tables: `intake_assessments`, `intake_post_sign_follow_up_queue`, `physician_orders`, related member-file persistence
- Expected canonical write path: UI -> server action -> canonical service/RPC -> Supabase

Required approach:
1) Inspect `app/intake-actions.ts`, `app/(portal)/health/assessment/[assessmentId]/actions.ts`, `lib/services/intake-pof-mhp-cascade.ts`, and `lib/services/intake-post-sign-readiness.ts`.
2) Keep `rpc_finalize_intake_assessment_signature` and `rpc_create_draft_physician_order_from_intake` as the authoritative persistence boundaries.
3) Find the remaining places where callers or UI state still rely on generic success/`ok` instead of the committed-readiness contract.
4) Make the canonical readiness field and founder-readable readiness message the operational source of truth for intake follow-up decisions.
5) Preserve the staged workflow model. Do not turn this into a fake all-or-nothing status and do not add a second local vocabulary.

Validation:
- Run typecheck.
- Add/update regression coverage proving an intake can be committed while still surfacing `queued_degraded` or `follow_up_required`.
- List the staff-facing intake surfaces that now consume readiness metadata explicitly.

Keep the fix incremental and auditable.
```

### Prompt 3. Make signed-POF downstream readiness impossible to miss in staff views
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
A POF can be durably signed while downstream MHP, MCC, medication sync, and MAR schedule generation are still queued or failed for retry, and staff-facing views can still make that look more complete than it really is.

Scope:
- Domain/workflow: provider POF signature -> downstream clinical sync
- Canonical entities/tables: `physician_orders`, `pof_requests`, `pof_post_sign_sync_queue`, downstream member clinical tables
- Expected canonical path: public sign action -> canonical finalize/sign service -> queued sync boundary -> Supabase

Required approach:
1) Inspect `app/sign/pof/[token]/actions.ts`, `lib/services/pof-post-sign-runtime.ts`, `lib/services/physician-order-clinical-sync.ts`, and `lib/services/physician-order-post-sign-service.ts`.
2) Keep the current queue-backed sync model and canonical sign persistence unchanged.
3) Reuse the shared committed workflow vocabulary already present in the repo. Do not create another readiness resolver.
4) Identify the highest-traffic staff views that still bury or fail to emphasize queued sync state, and wire the canonical readiness metadata through those views.
5) Preserve role boundaries and current retry semantics.

Validation:
- Run typecheck.
- Add/update regression coverage for signed POF + queued sync and signed POF + failed sync follow-up.
- Report exactly which staff views now surface the canonical readiness state.

Do not move sync orchestration into the UI.
```

### Prompt 4. Stop treating routine MAR documentation as a delivered notification milestone
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Routine MAR documentation paths call `recordWorkflowMilestone`, but the routine MAR event type does not map to a real inbox notification contract. That makes the code look like routine milestone delivery exists when only exception notifications are actionable today.

Scope:
- Domain/workflow: routine scheduled MAR and PRN documentation milestones
- Canonical entities/tables: MAR workflow services, `system_events`, `user_notifications`
- Expected canonical path: MAR service -> workflow event / notification boundary -> Supabase

Required approach:
1) Inspect `lib/services/mar-workflow.ts`, `lib/services/mar-prn-workflow.ts`, `lib/services/lifecycle-milestones.ts`, `lib/services/notifications-runtime.ts`, and any notification type definitions.
2) Preserve durable MAR write persistence and preserve the existing exception/action-required notification paths (`Not Given`, ineffective PRN follow-up, workflow errors).
3) Remove or reclassify routine non-exception MAR milestone dispatch so the code no longer implies inbox delivery for routine documentation when no such contract exists.
4) If the repo already has a safe low-noise notification type for routine MAR events, you may use it. Otherwise prefer explicit non-notification workflow logging over silent no-op milestone calls.
5) Keep auditability: routine MAR documentation should still write canonical workflow/system events.

Validation:
- Run typecheck.
- Add/update regression coverage proving routine MAR documentation no longer depends on an unmapped milestone notification path while exception notifications still fire.
- Report whether you removed the routine milestone call or mapped it to an explicit supported notification contract.

Do not create notification spam and do not weaken exception alerts.
```

### Prompt 5. Make POF PDF member-file identity order-specific
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Manual and generated POF PDFs still use a generic member-file identity, so multiple POF versions for the same member can collapse into one `member_files` slot instead of staying order-specific.

Scope:
- Domain/workflow: physician order / POF PDF persistence
- Canonical entities/tables: `physician_orders`, `member_files`, canonical POF PDF save helpers
- Expected canonical write path: POF service layer -> member-file persistence service/RPC -> Supabase

Required approach:
1) Inspect the canonical POF PDF persistence path first. Start with the POF signing and PDF save services, then follow into the shared member-file save helpers.
2) Keep one canonical member-file write path. Do not add one-off page-level naming rules.
3) Make the saved document identity order-specific using the authoritative physician order id/version metadata.
4) Add a forward-only migration only if the current schema cannot already store the required order reference cleanly.
5) Preserve existing access controls and existing signed-artifact persistence behavior.

Validation:
- Run typecheck.
- Add/update regression coverage proving two different POF versions for the same member do not collapse into one generic member-file slot.
- Report schema impact, changed files, and downstream effects on downloads/history views.

Keep this maintainable and auditable. Do not introduce mock or fallback persistence.
```

## 3. Fix Priority Order
1. Replace enrollment packet lead-activity note matching with canonical packet linkage.
2. Make intake readiness metadata authoritative in staff-facing follow-up flows.
3. Make signed-POF downstream readiness impossible to miss in staff views.
4. Stop treating routine MAR documentation as a delivered notification milestone.
5. Make POF PDF member-file identity order-specific.

## 4. Founder Summary
- The most important new issue from the April 12 workflow audit is not fake persistence. It is canonical linkage and staged-workflow truth.
- The cleanest new architecture bug is enrollment packet lead activity: the packet is still linked back to sales activity by searching text in `lead_activities.notes`. That is the best next structural fix because it removes schema drift risk instead of just changing UI wording.
- Intake and signed-POF readiness are still the main operational-truth risks. Those workflows now commit honestly, but staff can still move too early if consumers treat committed as fully ready.
- Routine MAR notifications are a smaller but real trust problem. Right now the code can look like routine MAR milestone delivery exists when it does not. That should be cleaned up so the notification layer only claims what it actually does.
- The April 11 performance work is already visibly in flight in the current worktree:
  - sales dashboard RPC slimming (`0209`)
  - query-audit missing indexes (`0210`)
  - billing read-boundary containment edits
  I did not duplicate those as fresh prompts.
