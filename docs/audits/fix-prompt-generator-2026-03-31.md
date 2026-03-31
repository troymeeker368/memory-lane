# Fix Prompt Generator - 2026-03-31

## 1. Issues Detected

### Coverage Notes
- Reviewed latest available artifacts on March 31, 2026:
  - `production-readiness-audit-2026-03-31.md`
  - `acid-transaction-audit-2026-03-31.md`
  - `query-performance-audit-2026-03-31.md`
  - `workflow-simulation-audit-2026-03-30.md`
  - `shared-resolver-drift-check-2026-03-29.md`
  - `idempotency-duplicate-submission-audit-2026-03-29.md`
  - `rpc-architecture-audit-2026-03-24.md`
  - `daily-canonicality-sweep-raw-2026-03-27.json`
- No clearly named current `Supabase RLS & Security Audit` report was present in `docs/audits` on March 31, 2026, so no new security-specific fix prompt was generated from that stream.
- The latest schema-safety artifact still available in `docs/audits` is `supabase-schema-compatibility-audit-2026-03-11.md`, which is too stale to drive a fresh schema-only prompt today.
- The latest daily canonicality sweep artifact remains raw JSON from March 27, 2026. It did not show missing runtime `.from(...)`, `.rpc(...)`, storage refs, or mock-runtime imports, so it did not surface a new direct canonicality bug by itself.
- The March 31 production-readiness audit fixed the billing masked-read gap during the audit run, so that issue is not included as an open prompt below.
- The March 30 member-file durability fixes from the automation memory appear to have landed, and the March 31 ACID audit no longer treats shared member-file persistence as the top blocker.

### Open Issues Chosen For Fix Prompts
1. Signature finalize flows can still delete newly uploaded artifacts after ambiguous finalize-RPC errors, even when signed state may already be committed.
2. Care plan caregiver replay handling still has a concurrency truth gap because the `wasAlreadySigned` path does not re-read canonical post-sign readiness before returning `actionNeeded: false`.
3. Signed POF downstream sync still depends on production runner secrets, cron execution, and queue-age visibility that cannot be fully trusted from repo code alone.
4. Enrollment packet completion remains intentionally staged, but staff-facing readiness must keep `mapping_sync_status` authoritative everywhere.
5. Intake signing remains intentionally staged, but staff-facing readiness must keep `post_sign_readiness_status` authoritative everywhere.
6. Lifecycle milestone notifications are still missing in some successful workflow paths, especially enrollment-related milestones.
7. Billing custom-invoice generation remains a multi-step workflow without one atomic shared RPC boundary.
8. Member Health Profile detail is still the top confirmed read-performance hotspot because one page open triggers a large fixed fan-out across cross-domain reads.
9. Shared active-member lookup helpers still preload capped full lists, creating both scaling waste and silent truncation once census exceeds 200.
10. The standalone Send Enrollment Packet page still preloads up to 500 eligible leads and still uses a wider lead payload than the page actually needs.

## 2. Codex Fix Prompts

### Issue 1. Signature finalize cleanup can destroy artifacts after commit

- Architectural rule violated: ACID durability; explicit failure handling after commit; no destructive rollback after the canonical write may already be durable.
- Safest fix approach: preserve current RPC finalize boundaries, but split pre-commit cleanup from post-commit ambiguity handling and treat committed signed rows as authoritative.

```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
The public signature finalize flows still run destructive artifact cleanup after finalize-RPC errors. If the RPC committed but the client lost the response, the cleanup path can delete signature artifacts or signed PDFs that canonical signed rows now reference.

Scope:
- Domain/workflow: intake, care plan, care plan nurse, and POF signature finalize flows
- Canonical entities/tables: intake_assessment_signatures, care_plan_signature_events, pof_signatures, physician_orders, member_files, member-documents storage bucket
- Expected canonical write path: public sign -> service layer -> finalize RPC -> durable post-sign follow-up
- Inspect first:
  - lib/services/pof-esign-public.ts
  - lib/services/care-plan-esign-public.ts
  - lib/services/care-plan-nurse-esign.ts
  - lib/services/intake-assessment-esign.ts
  - any shared artifact helper used by these flows

Required approach:
1) Trace each finalize flow end-to-end and identify where cleanup runs after a thrown finalize-RPC error.
2) Preserve the existing RPC finalize boundaries. Do not move lifecycle writes into UI code.
3) Split failure handling into:
   - pre-commit failure, where cleanup may still be valid
   - ambiguous post-commit failure, where cleanup must not delete artifacts until canonical signed state is disproven
4) On finalize error, re-read canonical signed state before deciding whether cleanup is safe.
5) If signed state already exists, keep artifacts, return a truthful committed-or-action-needed result, and record an alert instead of deleting storage.
6) Keep auditability and replay safety intact. Do not add mock fallback persistence or synthetic success.

Validation:
- Run typecheck and report results.
- List which finalize paths were changed and what each path now does on ambiguous RPC failure.
- Call out any remaining staged follow-up steps that are still intentionally asynchronous.

Do not overengineer. Keep the fix inside canonical service and RPC boundaries.
```

### Issue 2. Care plan caregiver replay path reports false readiness

- Architectural rule violated: workflow truth must come from canonical readiness state, not replay shortcuts.
- Safest fix approach: keep replay-safe behavior, but re-read canonical post-sign readiness before deciding whether follow-up is complete.

```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
The care plan caregiver public-sign replay path returns actionNeeded:false when finalized.wasAlreadySigned is true, but it does not re-read canonical post_sign_readiness_status first. That can hide real follow-up work after a replay or ambiguous prior completion.

Scope:
- Domain/workflow: care plan caregiver public signature replay handling
- Canonical entities/tables: care_plans, care_plan_signature_events, member_files
- Expected canonical write path: public sign -> service layer -> finalize RPC -> post-sign readiness check
- Inspect first:
  - lib/services/care-plan-esign-public.ts
  - any readiness helper or read model used to derive post_sign_readiness_status

Required approach:
1) Inspect the finalized.wasAlreadySigned branch and identify how actionNeeded is currently decided.
2) Preserve replay-safe idempotent behavior for already-signed requests.
3) Before returning actionNeeded:false, re-read the canonical care plan detail/readiness state and derive the response from post_sign_readiness_status.
4) Keep the response contract truthful:
   - ready -> actionNeeded false
   - pending/failed follow-up -> actionNeeded true with a real message
5) Do not duplicate care plan readiness logic in the action/UI layer. Reuse or strengthen one canonical helper.

Validation:
- Run typecheck and report results.
- Explain the before/after behavior for replaying a caregiver sign request after the original sign already committed.
- Call out any screens or handlers that depend on the response shape.

Do not overengineer. This is a canonical truth fix, not a workflow rewrite.
```

### Issue 3. POF post-sign runner health is still an operational dependency

- Architectural rule violated: workflow success must stay honest about downstream durability; queue-backed follow-up must be observable.
- Safest fix approach: keep the queue-backed design, but make runner configuration and aged work visibility explicit and release-auditable.

```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Signed POF downstream sync is queue-backed and the code is stronger than before, but real production durability still depends on runner secrets, cron execution, and visibility into aged queue rows. That operational dependency is not fully enforced or surfaced yet.

Scope:
- Domain/workflow: signed POF -> downstream MHP/MCC/MAR sync
- Canonical entities/tables: pof_post_sign_sync_queue, physician_orders, member_health_profiles, member_command_centers, mar_schedules
- Expected canonical write path: sign POF -> finalize RPC -> durable queue row -> internal runner claims work
- Inspect first:
  - app/api/internal/pof-post-sign-sync/route.ts
  - lib/services/pof-post-sign-runtime.ts
  - lib/services/physician-orders-supabase.ts
  - vercel.json and any env/config docs already in repo

Required approach:
1) Confirm the current queue claim path and keep it authoritative.
2) Add the smallest production-safe hardening so runner health is explicit:
   - clear required-secret/config validation
   - a deterministic health/readiness response
   - aged-queue metrics or alertable stale-work signals
3) Preserve FOR UPDATE SKIP LOCKED and current queue semantics.
4) Make sure staff/admin diagnostics can distinguish "POF legally signed" from "downstream sync complete."
5) Do not fake synchronous completion in UI paths.

Validation:
- Run typecheck and report results.
- List required production env/config assumptions for this runner.
- Explain how to verify stale queued work after deployment.

Do not overengineer. This is operational hardening around the existing canonical queue boundary.
```

### Issue 4. Enrollment packet staged readiness needs one authoritative contract

- Architectural rule violated: staged workflows must expose explicit operational readiness truth.
- Safest fix approach: preserve staged filing and downstream mapping, but force all staff-facing consumers to use `mapping_sync_status` and follow-up truth.

```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Enrollment packet completion is intentionally staged, but staff-facing views and downstream decision points must not treat filed/completed packet state as fully operationally ready when mapping_sync_status is still pending or failed.

Scope:
- Domain/workflow: enrollment packet completion -> downstream mapping readiness
- Canonical entities/tables: enrollment_packet_requests, enrollment_packet_mapping_runs, member_files, downstream mapping artifacts
- Expected canonical write path: public packet submit -> finalize service/RPC -> staged mapping follow-up -> readiness state
- Inspect first:
  - lib/services/enrollment-packets-public-runtime.ts
  - lib/services/enrollment-packet-completion-cascade.ts
  - lib/services/enrollment-packet-mapping-runtime.ts
  - enrollment packet listing/read-model files and any staff-facing status badges

Required approach:
1) Find every place that derives packet readiness for staff or downstream automation.
2) Preserve the staged workflow. Do not force packet filing and all downstream mapping into one fake synchronous success step.
3) Make mapping_sync_status and action-needed state authoritative in listing/detail/read-model code.
4) Remove any local logic that infers readiness from filed/completed alone.
5) Keep failure and retry states explicit.

Validation:
- Run typecheck and report results.
- List the screens/services updated to use the canonical readiness contract.
- Explain what staff now see for pending, failed, and ready packet states.

Do not overengineer. Align consumers to one canonical readiness truth.
```

### Issue 5. Intake post-sign readiness still needs consistent downstream truth

- Architectural rule violated: signed does not equal operationally complete when downstream filing and draft creation are staged.
- Safest fix approach: preserve staged intake design, but make `post_sign_readiness_status` the authoritative downstream truth everywhere.

```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Intake signing is intentionally staged, but staff-facing surfaces must not treat signed intake as fully complete while draft POF creation or intake PDF filing is still pending or failed.

Scope:
- Domain/workflow: intake sign -> draft POF creation -> intake PDF persistence
- Canonical entities/tables: intake_assessments, intake_assessment_signatures, intake_post_sign_follow_up_queue, physician_orders, member_files
- Expected canonical write path: sign intake -> finalize service/RPC -> staged follow-up -> readiness state
- Inspect first:
  - app/intake-actions.ts
  - lib/services/intake-assessment-esign.ts
  - lib/services/intake-post-sign-follow-up.ts
  - lib/services/intake-post-sign-readiness.ts
  - any UI/read-model code that displays intake completion state

Required approach:
1) Find every consumer that uses raw signed status to imply completion.
2) Preserve the current staged service/RPC design.
3) Make post_sign_readiness_status the canonical operational truth for UI badges, downstream decisions, and action-needed messaging.
4) Remove local signed-means-ready assumptions.
5) Keep failures explicit when draft POF creation or PDF filing did not finish.

Validation:
- Run typecheck and report results.
- List updated readiness consumers.
- Explain the user-visible difference between signed, pending follow-up, failed follow-up, and ready.

Do not overengineer. This is a truth-alignment pass on the existing staged workflow.
```

### Issue 6. Lifecycle milestone notifications are still missing

- Architectural rule violated: significant lifecycle events should generate auditable service-layer notifications after durable success.
- Safest fix approach: keep notification writes inside shared lifecycle and notification services, with idempotent milestone-to-notification mapping.

```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Lifecycle milestone notifications are missing in some successful workflow paths, especially enrollment-related milestones. That weakens operational handoff visibility even when the underlying workflow succeeded.

Scope:
- Domain/workflow: lifecycle milestones -> user notifications
- Canonical entities/tables: system_events, user_notifications
- Expected canonical write path: durable service-layer workflow success -> shared lifecycle helper -> notification creation
- Inspect first:
  - lib/services/lifecycle-milestones.ts
  - lib/services/notifications.ts
  - enrollment, POF, care plan, and MAR service paths that already record milestones

Required approach:
1) Trace which successful lifecycle milestones are already recorded but do not notify.
2) Keep notification creation in service-layer lifecycle helpers, not UI code.
3) Create notifications only after durable business success.
4) Use one canonical milestone-to-notification path so replays do not create duplicate notifications.
5) Preserve permission boundaries and current inbox read models.

Validation:
- Run typecheck and report results.
- List which milestone families now create notifications.
- Explain duplicate-prevention behavior for replayed lifecycle events.

Do not overengineer. Reuse the existing notification service and lifecycle boundaries.
```

### Issue 7. Billing custom invoice creation still lacks one atomic write boundary

- Architectural rule violated: multi-step workflows with multiple writes should use one transaction-backed or RPC-backed canonical boundary.
- Safest fix approach: move custom-invoice creation into one shared RPC/service transaction boundary instead of patching the UI or action layer.

```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Billing custom-invoice generation is still a multi-step workflow without one shared atomic RPC boundary. That leaves strict ACID guarantees weaker than they should be for a billing write path.

Scope:
- Domain/workflow: custom invoice generation in billing
- Canonical entities/tables: billing_invoices, billing_invoice_lines, related billing adjustment/source tables used by custom invoice creation
- Expected canonical write path: UI -> server action -> billing service -> one transaction-backed RPC/service boundary -> Supabase
- Inspect first:
  - billing custom-invoice action file(s)
  - lib/services/billing-rpc.ts
  - lib/services/billing-supabase.ts
  - any current custom-invoice builder/service helper
  - related billing migrations

Required approach:
1) Trace the current custom-invoice creation path and list every write it performs.
2) Preserve one canonical billing service entry point.
3) Move the multi-step write into one atomic boundary using the existing billing RPC pattern if feasible.
4) Add or update a migration only if a new RPC/function is required.
5) Keep failures explicit and prevent partial invoice persistence.

Validation:
- Run typecheck and report results.
- If a migration is added, list it and explain why it matches the runtime write path.
- Explain what partial-write risk existed before and how the new boundary removes it.

Do not overengineer. Use the smallest clean billing RPC hardening that preserves current behavior.
```

### Issue 8. Member Health Profile detail still over-fetches on default open

- Architectural rule violated: one workflow should not depend on a broad fixed query fan-out when a smaller canonical read model would work.
- Safest fix approach: split the default MHP open path from tab-scoped reads without moving business logic into the client.

```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
The Member Health Profile detail page is still the top confirmed read hotspot. One page open triggers a heavy fixed fan-out into diagnoses, medications, allergies, providers, notes, assessments, command-center photo, care plans, billing payor, physician orders, and progress-note summary reads.

Scope:
- Domain/workflow: Member Health Profile detail reads
- Canonical entities/tables: member_health_profiles and related member clinical tables
- Expected canonical read path: narrow shared service/read-model boundary backed by Supabase
- Inspect first:
  - app/(portal)/health/member-health-profiles/[memberId]/page.tsx
  - lib/services/member-health-profiles-supabase.ts
  - any related tab-specific read helpers

Required approach:
1) Count which reads are paid on default page open today.
2) Preserve current write boundaries and Supabase source-of-truth behavior.
3) Split the default open path into a smaller core payload and defer care-plan, billing, physician-order, progress-note, and other tab-specific reads until the screen actually needs them.
4) Keep business derivation in shared services/read helpers, not in UI components.
5) If a new shared read model is needed, keep it narrow and specific to the default MHP screen load.

Validation:
- Run typecheck and report results.
- Explain the before/after read shape on default open.
- Confirm which tabs now load lazily and what downstream behavior stays unchanged.

Do not overengineer. This is a targeted read-path reduction.
```

### Issue 9. Shared active-member preloads still cause broad reads and truncation

- Architectural rule violated: canonical shared lookups must not silently omit valid operational records.
- Safest fix approach: replace preload-first member lists with one shared search-first or paged lookup contract and selected-id backfill support.

```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Shared active-member lookup helpers still preload capped full lists, creating unnecessary broad reads and a silent truncation bug once active census exceeds 200 members.

Scope:
- Domain/workflow: member pickers across documentation, care plans, reports, ancillary, health dashboard, and physician orders
- Canonical entities/tables: members and shared member lookup helpers
- Expected canonical read path: one shared search-first or paged member lookup service, not repeated preload-first lists
- Inspect first:
  - lib/services/shared-lookups-supabase.ts
  - lib/services/documentation.ts
  - lib/services/physician-orders-read.ts
  - representative caller pages named in the query-performance audit

Required approach:
1) Identify the shared preload helper and its highest-impact callers.
2) Replace preload-first behavior with one shared search-first or paged lookup path.
3) Keep selected-member backfill support so existing forms still open correctly when an item is already chosen.
4) Remove silent truncation risk. Do not just raise the cap from 200 to a bigger number.
5) Preserve canonical member resolution and permission boundaries.

Validation:
- Run typecheck and report results.
- List updated callers.
- Explain how the new lookup behaves when there are more than 200 active members.

Do not overengineer. One canonical lookup improvement is the goal.
```

### Issue 10. Send Enrollment Packet still uses a broad 500-lead preload

- Architectural rule violated: operational pickers should not rely on broad preload lists that can silently omit valid records and waste queries.
- Safest fix approach: narrow the lead lookup payload, move to search-first or paged selection, and add a migration-backed index only if the final query shape still needs it.

```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
The standalone Send Enrollment Packet page still preloads up to 500 eligible leads on page load and still reads a wider lead payload than the page actually renders.

Scope:
- Domain/workflow: send enrollment packet lead selection
- Canonical entities/tables: leads, enrollment_packet_requests, lead activity context
- Expected canonical read path: sales read model/service boundary backed by Supabase
- Inspect first:
  - app/(portal)/sales/new-entries/send-enrollment-packet/page.tsx
  - lib/services/sales-crm-read-model.ts
  - any shared sales search/picker helper already in repo

Required approach:
1) Trace the current preload path and preserve the canonical sales service boundary.
2) Replace page-load preload with a search-first or paged selector.
3) Narrow the selected payload to the fields the page actually needs unless another consumer truly requires more.
4) If the final query shape still benefits from indexing, add the smallest migration-driven composite or partial index that matches the actual production query.
5) Do not push lead eligibility logic into the client.

Validation:
- Run typecheck and report results.
- If a migration is added, list it and explain why it matches the final query shape.
- Confirm the send flow still persists packet requests/events/lead activity correctly.

Do not overengineer. Keep it practical, canonical, and production-safe.
```

## 3. Fix Priority Order

1. Signature finalize cleanup semantics
   - Highest current durability risk and the clearest launch blocker in the March 31 ACID audit.
2. Care plan caregiver replay truth gap
   - Same workflow family as issue 1 and directly affects truthful post-sign readiness.
3. POF post-sign runner health hardening
   - Downstream clinical sync still depends on live operational configuration and observability.
4. Enrollment packet readiness truth alignment
   - Prevents staff from acting on filed-but-not-ready packets.
5. Intake post-sign readiness truth alignment
   - Prevents staff from acting on signed-but-not-ready intake assessments.
6. Lifecycle milestone notifications
   - Improves operational handoff visibility after durable success.
7. Billing custom-invoice atomic boundary
   - Important ACID hardening for a billing write path.
8. Member Health Profile read fan-out reduction
   - Highest confirmed current read-performance hotspot.
9. Shared active-member lookup replacement
   - Removes scaling waste and the silent 200-member truncation bug.
10. Send Enrollment Packet lead picker refactor
   - Useful performance hardening, but lower immediate safety risk than the items above.

## 4. Founder Summary

- The biggest issue changed again on March 31. Yesterday's shared member-file durability problem looks materially improved. The new top blocker is the signature finalize cleanup pattern: some sign flows still act like any finalize-RPC error means nothing committed, which is too aggressive for production and can delete artifacts after the database already accepted signed state.
- The next important class is workflow truthfulness, not wholesale redesign. Enrollment packets and intake assessments are still allowed to be staged. The fix is to make their readiness fields authoritative everywhere staff make downstream decisions.
- The POF queue is in a better place than before, but it is still only as safe as the production runner configuration and monitoring. That is now an operational-hardening issue more than a core code-path bug.
- On performance, the system's main remaining hotspots are still the MHP detail fan-out, the capped shared active-member preload pattern, and the 500-lead preload on the standalone enrollment-packet send page.
- Two audit streams were not useful for new prompts today: there was no current RLS/security report in `docs/audits`, and the only schema-compatibility audit on disk is still March 11, 2026, which is too stale to drive a fresh schema-specific fix pass.
