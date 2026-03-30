# Fix Prompt Generator - 2026-03-30

## 1. Issues Detected

### Coverage Notes
- Reviewed latest available artifacts on March 30, 2026:
  - `production-readiness-audit-2026-03-30.md`
  - `acid-transaction-audit-2026-03-30.md`
  - `query-performance-audit-2026-03-30.md`
  - `workflow-simulation-audit-2026-03-30.md`
  - `shared-resolver-drift-check-2026-03-29.md`
  - `idempotency-duplicate-submission-audit-2026-03-29.md`
  - `rpc-architecture-audit-2026-03-24.md`
  - `daily-canonicality-sweep-raw-2026-03-27.json`
  - `supabase-schema-compatibility-audit-2026-03-11.md`
- No clearly named current `Supabase RLS & Security Audit` report was present in `docs/audits` on March 30, 2026, so no security-specific fix prompt was generated from that stream.
- The latest canonicality sweep artifact was raw JSON from March 27, 2026 and did not show missing `.from(...)`, `.rpc(...)`, storage refs, or mock-runtime imports. It exposed only unresolved dynamic token references, not a clear production bug.
- The latest schema-safety artifact available was March 11, 2026. It mostly described migration-environment drift and earlier mock-era dependencies, so only still-relevant migration/readiness concerns were carried forward.

### Open Issues Chosen For Fix Prompts
1. Shared generated-PDF member-file persistence can delete the new storage object after the database row already committed.
2. Command Center manual member-file upload can surface false failure after a likely committed write.
3. Signed POF downstream sync still depends on retry-runner configuration and queue-age monitoring being healthy in production.
4. Enrollment packet completion is intentionally staged, but staff-facing surfaces can still misread `filed` as fully ready if `mapping_sync_status` is not authoritative everywhere.
5. Intake signing is intentionally staged, but staff-facing surfaces can still misread signed intake as operationally complete if `post_sign_readiness_status` is not authoritative everywhere.
6. Lifecycle milestone notifications are missing in some successful workflow paths.
7. Multiple server actions still return `ok: true` from catch blocks, creating silent-success risk.
8. Member Health Profile detail still over-fetches and fans out into roughly 14 reads on a normal page open.
9. Shared active-member preload helpers still use capped full-list loading, creating both scaling cost and silent truncation after 200 members.
10. The standalone send-enrollment-packet page still preloads up to 500 eligible leads on page load instead of using a search-first or paged selector.

## 2. Codex Fix Prompts

### Issue 1. Shared generated PDF member-file persistence can create DB/storage drift

#### Problem Summary
Generated PDFs across intake, MAR, care plans, face sheet, diet card, and similar flows use one shared member-file helper. Right now that helper can upload a file, write or upsert the `member_files` row, then delete the storage object if the immediate verification read misses. That breaks the core durability rule: the database can say the file exists while storage no longer has it.

#### Root Cause Framing
- Architectural rule violated: explicit failures when persistence or required side effects fail; ACID durability; one canonical write path must not fabricate rollback after commit.
- Affected workflow/domain: shared Member Files persistence used by multiple clinical and document workflows.
- Issue class: data safety, workflow integrity.

#### Best Codex Fix Prompt
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
The shared generated-document Member Files helper can delete a newly uploaded storage object after the database row already committed, creating DB/storage drift and possible duplicate fallthrough behavior.

Scope:
- Domain/workflow: shared generated PDF persistence into Member Files
- Canonical entities/tables: member_files, member-documents storage bucket
- Expected canonical write path: UI -> Server Action -> Service Layer -> Supabase
- Primary files to inspect first:
  - lib/services/member-files.ts
  - app/intake-actions.ts
  - app/(portal)/health/mar/actions-impl.ts
  - app/(portal)/health/care-plans/[carePlanId]/actions.ts
  - app/(portal)/members/[memberId]/face-sheet/actions.ts

Required approach:
1) Inspect saveGeneratedMemberPdfToFiles end-to-end and identify the exact post-write verification and cleanup branches.
2) Preserve the canonical Member Files RPC boundary. Do not move write logic into UI/server actions.
3) Treat successful member_files upsert as the commit boundary.
4) Split pre-commit failure handling from post-commit verification handling.
5) After upsertMemberFileByDocumentSource succeeds, never delete the new storage object just because an immediate readback misses.
6) Make the replace-existing path exit deterministically after a successful upsert so it cannot fall through into the create path.
7) If verification cannot confirm the row after a likely committed write, return an explicit committed-but-verification-pending or action-needed result that downstream callers can handle safely.
8) Preserve auditability and document_source uniqueness behavior. Do not add mock fallback persistence.

Validation:
- Run typecheck and report results.
- If build is blocked by environment, say that explicitly.
- List every workflow that still uses this helper and any downstream behavior change.
- Call out whether a follow-up reconciliation or queue item is still needed for verification-pending cases.

Do not overengineer. Do not introduce a new framework or background system unless the current architecture already has a clear place for it.
```

#### Regression Risks
- Intake PDF filing could regress if callers assume the helper always returns a fully hydrated row.
- MAR monthly report persistence could regress if the new return state is not handled.
- Care plan and face-sheet document replacement could create duplicate UX messages if create vs replace branching changes.

#### Retest Checklist
- Sign an intake and confirm the intake PDF row exists in `member_files` and the storage object still exists.
- Generate a MAR PDF and confirm it appears in Member Files and downloads successfully.
- Replace an existing generated document with the same `document_source` and verify only one canonical row remains.
- Force or simulate a post-write readback miss and confirm the system does not delete the new storage object.
- Verify staff do not see a fake hard failure after the file was already committed.

#### Optional Follow-up Prompt
```text
Add a small reconciliation path for member_files so storage-object-path drift can be detected and surfaced early without changing the canonical write path.
```

### Issue 2. Command Center manual member-file upload can return false failure after commit

#### Problem Summary
Manual Command Center uploads can likely finish the storage upload and row upsert, then still return a failure if the immediate reload misses. That encourages staff to retry a document that may already be saved, which creates operational confusion.

#### Root Cause Framing
- Architectural rule violated: do not return synthetic failure when persistence likely succeeded; preserve one canonical service truth.
- Affected workflow/domain: Command Center member-file uploads.
- Issue class: data safety, UX, workflow integrity.

#### Best Codex Fix Prompt
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
saveCommandCenterMemberFileUpload can throw a hard failure after the upload and member_files upsert likely already committed, causing false-failure UX and replay confusion.

Scope:
- Domain/workflow: manual member-file uploads from Member Command Center
- Canonical entities/tables: member_files, member-documents storage bucket
- Expected canonical write path: UI -> Server Action -> Service Layer -> Supabase
- Primary files to inspect first:
  - lib/services/member-files.ts
  - app/(portal)/operations/member-command-center/file-actions.ts
  - components/forms/member-command-center-file-manager.tsx

Required approach:
1) Reuse the same post-commit handling pattern chosen for saveGeneratedMemberPdfToFiles.
2) Keep member-files.ts as the authoritative boundary.
3) If upload + upsert likely committed but reload verification misses, do not surface a misleading hard failure.
4) Return an explicit committed-but-unverified or action-needed result that the action/UI can display honestly.
5) Preserve canonical member resolution, role checks, and auditability.
6) Do not change the existing product rule that a new upload token can intentionally create a new canonical file row.

Validation:
- Run typecheck and report results.
- List changed files and explain any UI message changes.
- Call out whether retries are now safe and how staff can tell the difference between true failure and verification-pending.

Do not overengineer. Keep the change local and maintainable.
```

#### Regression Risks
- File manager UI may assume every success path returns a fully reloaded row.
- Upload retry behavior may need message updates so users do not double-submit.

#### Retest Checklist
- Upload a file from Member Command Center and confirm the row exists in `member_files`.
- Confirm the document is downloadable after upload.
- Simulate a reload miss after upsert and confirm the UI does not claim the upload definitely failed.
- Retry only when there is a real failure and confirm no unintended duplicate row is created from the same upload token replay.

#### Optional Follow-up Prompt
```text
Add a lightweight staff-facing status message for committed-but-unverified member-file uploads so operations users know when to wait versus retry.
```

### Issue 3. Signed POF downstream sync depends on runner health

#### Problem Summary
Signed POF writes are durable, but the downstream sync into MHP, MCC, and MAR still depends on the queue runner being configured, scheduled, and monitored. If that runner is missing or unhealthy, the signed order can exist while downstream clinical read models remain stale.

#### Root Cause Framing
- Architectural rule violated: workflow completion must reflect durable downstream state or an explicit staged readiness truth.
- Affected workflow/domain: signed POF post-sign queue and downstream clinical sync.
- Issue class: data safety, workflow integrity.

#### Best Codex Fix Prompt
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Signed POF downstream sync is queue-backed, but runner configuration and queue-age monitoring are not yet treated as release-critical. That can leave MHP/MCC/MAR stale after a legally signed order.

Scope:
- Domain/workflow: POF post-sign sync queue
- Canonical entities/tables: physician_orders, pof_requests, pof_post_sign_sync_queue, member_health_profiles, member_command_centers, mar_schedules
- Expected canonical write path: UI/public sign -> Service Layer/RPC -> Supabase -> queue-backed follow-up
- Primary files to inspect first:
  - lib/services/pof-post-sign-runtime.ts
  - app/api/internal/pof-post-sign-sync/route.ts
  - lib/services/physician-orders-supabase.ts
  - relevant env/config docs and any health-check or cron wiring already in repo

Required approach:
1) Confirm the canonical queue claim path and preserve the current RPC/queue model.
2) Do not collapse legally signed POF persistence and downstream sync into a fake synchronous UI success path.
3) Add the smallest production-safe protections so runner health becomes explicit:
   - startup/config validation for required secret(s)
   - a deterministic health/readiness check or operational status helper
   - queue-age monitoring or alertable signal for stale queued rows
4) Ensure staff-facing or admin-facing surfaces can distinguish "signed" from "downstream sync complete" when the queue is behind.
5) Preserve FOR UPDATE SKIP LOCKED claim behavior and current RPC boundaries.

Validation:
- Run typecheck and report results.
- Document exact environment variables or scheduling assumptions required in production.
- Explain how to verify queue health and aged-row detection after deployment.

Do not overengineer. This is an operational-hardening fix, not a major workflow rewrite.
```

#### Regression Risks
- Overly strict startup checks could block non-production environments if not scoped carefully.
- Admin/status surfaces could become noisy if queue age thresholds are poorly chosen.

#### Retest Checklist
- Complete a signed POF flow and confirm a queue row is created or claimed as expected.
- Verify the internal sync route rejects unauthenticated calls and honors the configured secret.
- Confirm downstream MHP/MCC/MAR state updates after the runner executes.
- Simulate a stale queue row and verify the new health/alert signal is visible.

#### Optional Follow-up Prompt
```text
Create a small admin diagnostic view for aged pof_post_sign_sync_queue rows so production support can confirm whether downstream sync is healthy without reading raw tables.
```

### Issue 4. Enrollment packet staged completion needs stronger readiness truth

#### Problem Summary
Enrollment packets can be durably filed before downstream MCC, MHP, and POF mapping finishes. That staged model is acceptable, but only if every operational surface treats `mapping_sync_status` and readiness state as authoritative instead of treating `filed` or `completed` as fully done.

#### Root Cause Framing
- Architectural rule violated: workflow completion must match downstream persistence truth; staged workflows must expose explicit readiness states.
- Affected workflow/domain: enrollment packet completion and downstream mapping.
- Issue class: workflow integrity.

#### Best Codex Fix Prompt
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Enrollment packet completion is intentionally staged, but staff-facing surfaces may still treat filed/completed packet state as fully operationally ready even when downstream mapping is still pending or failed.

Scope:
- Domain/workflow: enrollment packet completion -> downstream mapping cascade
- Canonical entities/tables: enrollment_packet_requests, enrollment_packet_mapping_runs, member_files, downstream MCC/MHP/POF mapping state
- Expected canonical write path: public submit -> service/RPC finalize -> Supabase -> staged mapping follow-up
- Primary files to inspect first:
  - lib/services/enrollment-packets-public-runtime.ts
  - lib/services/enrollment-packet-completion-cascade.ts
  - lib/services/enrollment-packet-mapping-runtime.ts
  - enrollment packet listing/read-model files
  - any staff-facing page or badge logic that decides packet readiness

Required approach:
1) Discover every place that derives packet readiness for staff.
2) Preserve the staged architecture. Do not force packet filing and downstream mapping into one fake all-or-nothing UI step if that is not how the workflow is designed.
3) Make mapping_sync_status and explicit operational readiness authoritative in listings, detail views, and downstream decision points.
4) Remove any local UI or action-layer logic that infers readiness from filed/completed state alone.
5) Preserve alerts/action-needed paths when mapping fails.

Validation:
- Run typecheck and report results.
- List the screens or service functions updated to respect readiness truth.
- Explain what staff will now see for pending, failed, and ready states.

Do not overengineer. Keep one canonical readiness contract and align consumers to it.
```

#### Regression Risks
- Packet list badges and filters could change behavior if they previously used raw status.
- Staff may need updated wording if "completed" no longer implies fully mapped.

#### Retest Checklist
- Submit a public enrollment packet and confirm the request can be `filed` while mapping is still pending.
- Verify packet listings and detail screens show the readiness state correctly.
- Simulate mapping failure and confirm staff see action-needed instead of silent success.
- Confirm downstream MCC/MHP/POF workflows do not proceed from a packet that is not operationally ready.

#### Optional Follow-up Prompt
```text
Add regression tests around enrollment-packet readiness derivation so future UI changes cannot silently reintroduce filed-equals-ready logic.
```

### Issue 5. Intake post-sign staged workflow needs stronger readiness truth

#### Problem Summary
Signed intake can commit before draft POF creation and intake PDF filing finish. That is acceptable only if operational surfaces use `post_sign_readiness_status` instead of raw signature state when deciding whether intake is actually complete.

#### Root Cause Framing
- Architectural rule violated: staged workflow completion must use explicit readiness truth, not the first committed step.
- Affected workflow/domain: intake signing, draft POF follow-up, intake PDF persistence.
- Issue class: workflow integrity.

#### Best Codex Fix Prompt
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Intake signing is intentionally staged, but some surfaces may still treat signed intake as fully complete even when draft POF creation or intake PDF filing still needs follow-up.

Scope:
- Domain/workflow: intake sign -> draft POF creation -> intake PDF persistence
- Canonical entities/tables: intake_assessments, intake_assessment_signatures, physician_orders, member_files, intake_post_sign_follow_up_queue
- Expected canonical write path: sign intake -> service/RPC commit -> staged follow-up
- Primary files to inspect first:
  - app/intake-actions.ts
  - lib/services/intake-post-sign-follow-up.ts
  - lib/services/intake-post-sign-readiness.ts
  - lib/services/physician-orders-supabase.ts
  - any UI/read-model code that displays intake completion status

Required approach:
1) Find every place that presents or consumes intake completion state after signature.
2) Preserve the current staged model and RPC/service boundaries.
3) Make post_sign_readiness_status the canonical operational truth for downstream decisions.
4) Remove any local logic that treats signed status alone as enough.
5) Keep failure and action-needed states explicit when draft POF creation or PDF filing is incomplete.

Validation:
- Run typecheck and report results.
- List updated consumers of post_sign_readiness_status.
- Explain any UI wording change between signed, pending follow-up, failed follow-up, and ready.

Do not overengineer. Align the existing staged workflow instead of redesigning it.
```

#### Regression Risks
- Intake detail screens or related work queues may currently key off signature status only.
- Staff expectations could change if a previously "done" intake now shows "follow-up pending."

#### Retest Checklist
- Sign an intake and confirm readiness stays pending until draft POF creation and PDF filing complete.
- Simulate follow-up failure and confirm the intake does not present as fully complete.
- Confirm downstream POF workflows and Member Files visibility update once readiness becomes ready.

#### Optional Follow-up Prompt
```text
Add regression coverage around intake post-sign readiness so signed-only state cannot be mistaken for operational completion in future changes.
```

### Issue 6. Lifecycle milestone notifications are missing

#### Problem Summary
The workflow simulation audit found missing notifications for at least some lifecycle milestones, especially enrollment-related milestones. This weakens operational handoff visibility and can hide successful or failed downstream steps from staff.

#### Root Cause Framing
- Architectural rule violated: significant lifecycle events should be logged in the service layer and user notifications must reflect durable state changes, not best-effort UI behavior.
- Affected workflow/domain: lifecycle milestones and notifications.
- Issue class: workflow integrity, UX.

#### Best Codex Fix Prompt
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Lifecycle milestone notifications are missing in some successful workflow paths. Enrollment milestones should notify, but expected notifications are absent in current lifecycle code paths.

Scope:
- Domain/workflow: lifecycle milestone recording -> user notifications
- Canonical entities/tables: system_events, user_notifications
- Expected canonical write path: service-layer durable workflow success -> lifecycle milestone recording -> notification creation
- Primary files to inspect first:
  - lib/services/lifecycle-milestones.ts
  - lib/services/notifications.ts
  - enrollment, POF, care plan, and MAR service paths that record milestone events

Required approach:
1) Inspect where successful lifecycle milestones are already recorded.
2) Keep notification creation in service-layer or canonical lifecycle helpers, not UI components.
3) Add notifications only after the durable business write succeeds.
4) Avoid duplicate-notification logic by using one canonical milestone-to-notification path.
5) Preserve role restrictions and notification read-model behavior.

Validation:
- Run typecheck and report results.
- List which milestone types now create notifications.
- Explain duplicate-prevention behavior if the same lifecycle event is replayed.

Do not overengineer. Reuse the existing notifications service and lifecycle boundaries.
```

#### Regression Risks
- Duplicate notifications if lifecycle replay paths are not idempotent.
- Missing notifications could persist if some workflows bypass the shared milestone helper.

#### Retest Checklist
- Complete an enrollment packet lifecycle and confirm the expected notification appears in the inbox.
- Complete a POF signature and confirm the relevant downstream notification appears only once.
- Create or sign a care plan and verify the notification path still respects permissions.
- Record MAR-related milestones and verify the inbox reflects the successful event.

#### Optional Follow-up Prompt
```text
Add a narrow audit query or admin diagnostic to compare recent lifecycle milestones against recent user_notifications so missing notification wiring becomes easy to spot.
```

### Issue 7. Server actions still return `ok: true` in catch blocks

#### Problem Summary
The workflow simulation audit flagged multiple action files where catch blocks still return `ok: true`. That creates silent success: the UI can show completion even when the write failed or downstream work did not persist.

#### Root Cause Framing
- Architectural rule violated: success must never be returned if persistence or required downstream side effects failed.
- Affected workflow/domain: care plans, documentation, intake, and sales lead actions.
- Issue class: data safety, workflow integrity.

#### Best Codex Fix Prompt
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Multiple server actions still return ok:true from catch blocks, creating silent-success behavior in production paths.

Scope:
- Domain/workflow: action-layer result handling across care plans, documentation, intake, and sales lead workflows
- Primary files to inspect first:
  - app/care-plan-actions.ts
  - app/documentation-actions-impl.ts
  - app/documentation-create-actions-impl.ts
  - app/intake-actions.ts
  - app/sales-lead-actions.ts

Required approach:
1) Inspect each flagged catch block and confirm whether it masks a true failure.
2) Preserve the canonical service write path. Do not patch around the issue only in UI components.
3) Replace fake success responses with explicit failure or action-needed results that match what really persisted.
4) If a workflow is intentionally staged, return a truthful staged result, not a generic success.
5) Preserve existing user-facing messaging where possible, but make the success/failure contract honest and deterministic.
6) Keep audit/event logging inside service boundaries.

Validation:
- Run typecheck and report results.
- List every catch block changed and whether the new result is failure, staged, or action-needed.
- Call out any screen that may need a message update because it previously treated silent success as normal.

Do not overengineer. This is a truthfulness and safety pass, not a rewrite.
```

#### Regression Risks
- Some screens may currently depend on `ok: true` to avoid surfacing errors.
- Changing result contracts could expose existing service-level failures that were previously hidden.

#### Retest Checklist
- Trigger a real failure in each affected action path and verify the UI no longer reports success.
- Confirm successful writes still return success and persist in Supabase.
- For intentionally staged workflows, confirm the result clearly shows pending/action-needed rather than generic success.

#### Optional Follow-up Prompt
```text
Add a small shared helper for action result truthfulness only if it removes repeated ok:true catch patterns without changing the canonical service boundaries.
```

### Issue 8. Member Health Profile detail over-fetches heavily

#### Problem Summary
The MHP detail page still does roughly 14 reads on a normal open. That is now the top confirmed query-performance issue. It slows the page and increases cross-domain query load even when the user only needs one tab.

#### Root Cause Framing
- Architectural rule violated: one canonical read path per workflow where possible; avoid fragmented read waterfalls.
- Affected workflow/domain: Member Health Profile detail.
- Issue class: performance.

#### Best Codex Fix Prompt
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
The Member Health Profile detail page still over-fetches heavily on normal open by loading too many member-specific and cross-domain datasets before the active tab needs them.

Scope:
- Domain/workflow: Member Health Profile detail reads
- Canonical entities/tables: member_health_profiles and related member clinical tables
- Expected canonical read path: preserve canonical service/read-model boundaries, reduce unnecessary fan-out
- Primary files to inspect first:
  - app/(portal)/health/member-health-profiles/[memberId]/page.tsx
  - lib/services/member-health-profiles-supabase.ts
  - any related tab/read helper files

Required approach:
1) Inspect the current page open path and count which reads are paid on the default tab.
2) Preserve Supabase as source of truth and keep writes unchanged.
3) Split the page into a lighter default read and defer tab-specific data until the active tab actually needs it.
4) Avoid moving business logic into UI components; keep derivation in canonical services/read helpers.
5) If a shared read model is the cleanest minimal fix, keep it narrow and specific to MHP detail.

Validation:
- Run typecheck and report results.
- Explain how many reads are paid on default open before vs after.
- List any tabs that now load lazily and confirm no data correctness changed.

Do not overengineer. This is a targeted read-path reduction, not a full redesign.
```

#### Regression Risks
- Tab switching could show loading states that did not exist before.
- Hidden assumptions about all data being present at first render may break.

#### Retest Checklist
- Open MHP detail on the default tab and confirm the core member view renders correctly.
- Switch to each tab and confirm the tab-specific data still loads from Supabase.
- Verify no write paths changed for diagnoses, medications, allergies, providers, equipment, or notes.

#### Optional Follow-up Prompt
```text
If the MHP page is still heavy after tab-aware loading, propose one narrow canonical read-model consolidation for the remaining default-tab payload only.
```

### Issue 9. Shared active-member preload helper causes scaling and truncation risk

#### Problem Summary
Many screens still preload a capped list of active members through shared helper paths. This is both a performance problem and a correctness problem because the helper defaults to 200 rows, so valid members can silently disappear as census grows.

#### Root Cause Framing
- Architectural rule violated: canonical shared resolver/read logic should not silently truncate operational data.
- Affected workflow/domain: documentation, care plans, reports, ancillary, health dashboard, physician orders, and other member pickers.
- Issue class: performance, workflow integrity.

#### Best Codex Fix Prompt
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Repeated active-member preload pickers still use a capped full-list helper, creating both unnecessary broad reads and a silent 200-member truncation risk across multiple workflows.

Scope:
- Domain/workflow: member lookup pickers across documentation, care plans, reports, ancillary, health dashboard, and physician orders
- Canonical entities/tables: members and canonical member resolution helpers
- Expected canonical read path: shared search-first member lookup behavior, not repeated preload-first lists
- Primary files to inspect first:
  - lib/services/shared-lookups-supabase.ts
  - lib/services/documentation.ts
  - lib/services/physician-orders-read.ts
  - representative page call sites from documentation, care plans, reports, ancillary, and health dashboard

Required approach:
1) Find the shared preload helper and its major callers.
2) Replace preload-first behavior with a search-first or paged shared lookup path.
3) Preserve canonical member resolution and existing permission boundaries.
4) Remove silent truncation risk. Do not just raise the cap.
5) Update callers to use the new shared lookup contract instead of each screen inventing its own query shape.

Validation:
- Run typecheck and report results.
- List updated call sites.
- Explain how the new lookup behaves when census exceeds 200 active members.

Do not overengineer. One shared lookup improvement is better than many local picker rewrites.
```

#### Regression Risks
- Picker UX may change from instant preload to search-first interaction.
- Some screens may assume member labels are available synchronously at first render.

#### Retest Checklist
- Open each updated picker surface and confirm users can still find a member quickly.
- Verify members beyond the first 200 are now discoverable.
- Confirm downstream actions still resolve to the correct canonical member id.

#### Optional Follow-up Prompt
```text
Add one reusable member lookup UI pattern after the shared search-first service contract is in place, but only if it reduces repeated caller code without moving business logic into the client.
```

### Issue 10. Send Enrollment Packet page still preloads 500 leads

#### Problem Summary
The standalone send-enrollment-packet page still loads up to 500 eligible leads on page open. That is broader than a picker needs, scales poorly, and can silently omit valid leads as the sales dataset grows.

#### Root Cause Framing
- Architectural rule violated: canonical read paths should not depend on broad preload lists that silently omit valid operational records.
- Affected workflow/domain: sales lead selection for enrollment-packet send flow.
- Issue class: performance, workflow integrity.

#### Best Codex Fix Prompt
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
The standalone send-enrollment-packet page still preloads up to 500 eligible leads on page load instead of using a search-first or paged selector. This scales poorly and can silently omit valid leads.

Scope:
- Domain/workflow: send enrollment packet lead picker
- Canonical entities/tables: leads, enrollment_packet_requests, lead activity context
- Expected canonical read path: sales read model/service boundary backed by Supabase
- Primary files to inspect first:
  - app/(portal)/sales/new-entries/send-enrollment-packet/page.tsx
  - lib/services/sales-crm-read-model.ts
  - any shared sales picker or search helper already in repo

Required approach:
1) Inspect the current eligible-leads preload path and preserve the canonical sales service boundary.
2) Replace preload-on-open with a search-first or paged lead selector.
3) Do not move lead filtering logic into the client.
4) If the current SQL shape remains in use anywhere important, add the smallest matching migration-driven index only if it still materially helps the final query plan.
5) Explain the downstream UI impact in plain English.

Validation:
- Run typecheck and report results.
- If a migration is added, list it and explain why it matches the final query shape.
- Confirm the selector still returns the correct canonical lead and packet send flow still works.

Do not overengineer. Keep it practical and production-safe.
```

#### Regression Risks
- Sales staff may need slightly different interaction if the picker becomes search-first.
- If a migration is added unnecessarily after removing the preload path, that would add schema noise without real benefit.

#### Retest Checklist
- Open the send-enrollment-packet page and confirm it no longer loads 500 leads on first paint.
- Search for leads in different eligible stages and confirm the correct lead appears.
- Send a packet and verify the request, events, and lead activity still persist correctly.

#### Optional Follow-up Prompt
```text
After refactoring the lead picker, run one focused sales query-performance review to confirm whether the composite leads(status, stage, inquiry_date desc) index is still needed.
```

## 3. Fix Priority Order

1. Shared generated-PDF member-file durability fix
   - Blocks launch and affects many workflows at once.
2. Command Center member-file false-failure fix
   - Same architectural bug family and easy to align with issue 1.
3. Remove silent-success `ok:true` catch blocks
   - Prevents fake success across multiple production workflows.
4. POF post-sign runner health hardening
   - Release-critical if the runner is missing or unmonitored.
5. Enrollment packet readiness truth alignment
   - Prevents staff from acting on filed-but-not-ready packet state.
6. Intake post-sign readiness truth alignment
   - Prevents staff from acting on signed-but-not-ready intake state.
7. Lifecycle milestone notifications
   - Improves operational visibility after durable success.
8. MHP detail over-fetch reduction
   - Highest confirmed current query-performance hotspot.
9. Shared active-member preload replacement
   - Removes both scaling waste and silent truncation risk.
10. Send-enrollment-packet lead picker refactor
   - Useful performance hardening, but lower safety risk than the items above.

## 4. Founder Summary

- The most urgent real bug on March 30, 2026 is not a UI issue. It is a durability bug in the shared Member Files generated-document helper. That one helper sits under intake, MAR, care plans, face sheet, and other document workflows, so a bad cleanup branch there can create widespread DB/storage drift.
- The second cluster is truthfulness. The workflow audit still found server actions that return `ok: true` inside catch blocks, and the lifecycle simulation still found missing notifications. Those two patterns make the system look healthier than it really is when something failed or never notified staff.
- The staged-workflow concerns are still real, but they are not telling you to rewrite those workflows. Enrollment packet completion and intake signing are allowed to be staged. The fix is to make readiness state authoritative everywhere staff make downstream decisions.
- The main performance problem has shifted. Enrollment packet lists improved, so the current top read hotspot is the Member Health Profile detail page. After that, the biggest scaling issue is still the repeated capped active-member preload pattern and the 500-lead preload on the send-enrollment-packet page.
- The latest available resolver drift and idempotency audits mostly show earlier low-risk fixes already landed. The remaining open work is now concentrated in durability, workflow truthfulness, readiness-state enforcement, and read-path scaling.
