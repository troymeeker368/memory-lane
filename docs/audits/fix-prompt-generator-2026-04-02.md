# Fix Prompt Generator - 2026-04-02

## 1. Issues Detected

### Coverage Notes
- Reviewed latest available artifacts on April 2, 2026:
  - `production-readiness-audit-2026-04-02.md`
  - `acid-transaction-audit-2026-04-02.md`
  - `workflow-simulation-audit-2026-04-02.md`
  - `query-performance-audit-2026-03-31.md`
  - `shared-resolver-drift-check-2026-03-29.md`
  - `idempotency-duplicate-submission-audit-2026-03-29.md`
  - `rpc-architecture-audit-2026-03-24.md`
  - `daily-canonicality-sweep-raw-2026-03-27.json`
  - `supabase-schema-compatibility-audit-2026-03-11.md`
- No standalone current `Supabase RLS & Security Audit` report was present in `docs/audits` on April 2, 2026.
- No fresh standalone `Schema Migration Safety Audit` report was present in `docs/audits`; the latest schema-only artifact remains the March 11 compatibility audit.
- The latest daily canonicality artifact is still raw JSON from March 27, 2026. It did not show missing runtime `.from(...)`, `.rpc(...)`, storage refs, or mock-runtime imports, so it did not surface a fresh direct canonicality defect by itself.
- The latest shared-resolver drift and idempotency audits say their focused low-risk gaps were fixed in those runs; they do not contribute a new open code fix today.

### Open Issues Chosen For Fix Prompts
1. Public care plan signing can still tell caregivers the signature failed after the canonical sign already committed when post-sign readiness work fails.
2. Intake and care plan nurse signature flows can still report failure after commit because post-commit workflow telemetry is treated like part of the canonical sign result.
3. Enrollment packet mapping retry processing still lacks runner observability parity with the signed-POF runner.
4. Billing custom invoice generation still assembles source reads and invoice numbering outside one fully atomic canonical RPC boundary.
5. Notification delivery is still not truthful enough: some lifecycle milestones can be marked delivered when zero `user_notifications` rows were actually created.
6. Generated PDF workflows still do not consistently treat `verifiedPersisted` as the source of truth before reporting success, with monthly MAR PDF explicitly confirmed weak and other generated-document callers needing alignment.
7. Signed/staged workflow readiness is still easy to misread in UI/server-action contracts because some flows return `ok: true` while `operationallyReady` or post-sign readiness is false.
8. Member Health Profile detail is still the top confirmed read-performance hotspot because one page visit fans out into too many cross-domain reads.
9. Shared active-member preload helpers still load broad capped rosters instead of search-first lookup flows, creating scaling cost and silent truncation risk.
10. The Send Enrollment Packet standalone page still preloads a wide 500-row eligible-lead list and is missing a matching composite index for its filter/sort shape.
11. Audit coverage is stale for RLS/security and schema migration safety, so the repo lacks a current saved artifact for two required nightly architecture streams.

## 2. Codex Fix Prompts

### Issue 1. Care plan caregiver public sign still throws a false failure after commit

- Architectural rule violated: ACID durability; workflow state integrity; no false failure after canonical persistence already succeeded.
- Safest fix approach: keep the existing finalize RPC authoritative, but downgrade post-commit readiness failure into a truthful committed-with-action-needed response.

```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Public care plan signing can still return a caregiver-facing failure after the canonical signature and signed artifact already committed, if post-sign readiness work fails afterward.

Scope:
- Domain/workflow: care plan caregiver public signature finalize flow
- Canonical entities/tables: care_plans, care_plan_signature_events, member_files
- Expected canonical write path: public sign -> service layer -> finalize RPC -> post-sign readiness update

Required approach:
1) Inspect the current end-to-end path in lib/services/care-plan-esign-public.ts, especially submitPublicCarePlanSignature.
2) Preserve the finalize RPC as the authoritative persistence boundary.
3) If the signature already committed but markCarePlanPostSignReadyWorkflow or readiness verification fails afterward, return a committed result with actionNeeded/actionNeededMessage instead of throwing a hard failure.
4) Keep alerting and auditability for the follow-up failure.
5) Reuse canonical readiness helpers instead of duplicating readiness logic in the action or UI.
6) Preserve replay safety and do not reintroduce artifact cleanup on ambiguous finalize outcomes.

Validation:
- Run typecheck and report results.
- Explain the before/after response contract for a caregiver sign that commits but has post-sign follow-up failure.
- List changed files and any UI/downstream consumers that depend on this response shape.

Do not overengineer. Keep the patch inside the canonical service boundary.
```

### Issue 2. Intake and care plan nurse sign flows still treat post-commit telemetry failure as sign failure

- Architectural rule violated: explicit failures when persistence fails, but not when post-commit observability fails; system event logging belongs in the service layer and must not change committed truth.
- Safest fix approach: keep finalize RPCs authoritative and make post-commit event/milestone logging best-effort with alert-backed logging.

```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Intake and care plan nurse signature flows can still return an error after the signature already committed because post-commit workflow event or milestone logging throws and bubbles out as if the sign itself failed.

Scope:
- Domain/workflow: intake signature finalize flow and care plan nurse signature finalize flow
- Canonical entities/tables: intake_assessment_signatures, care_plan_nurse_signatures, member_files, system_events or workflow milestone logs
- Expected canonical write path: action/public sign -> service layer -> finalize RPC -> best-effort post-commit telemetry

Required approach:
1) Inspect lib/services/intake-assessment-esign.ts and lib/services/care-plan-nurse-esign.ts.
2) Identify the exact post-commit telemetry/event logging that still runs inline after finalize RPC success.
3) Once finalize RPC succeeds, always return the committed signature truth.
4) Downgrade later event/milestone logging failures to alert-backed logging or explicit console/error reporting inside the service layer.
5) Do not suppress true finalize RPC failures.
6) Keep auditability: failed telemetry should still be visible to operations, but must not masquerade as signature failure.

Validation:
- Run typecheck and report results.
- Explain what is still considered a true sign failure vs a post-commit observability failure.
- List changed files and any operational follow-up implications.

Do not overengineer. This is a truthfulness fix, not a redesign of event logging.
```

### Issue 3. Enrollment packet mapping runner still lacks POF-style health and missing-config visibility

- Architectural rule violated: staged workflows must expose explicit readiness truth; queue-backed follow-up must be operationally observable.
- Safest fix approach: keep the queue-backed model, but bring the enrollment runner route up to the same missing-config, health, and aged-queue standard as the POF runner.

```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Enrollment packet completion is durable, but downstream mapping retry health is still harder to observe than the signed-POF retry runner. If the runner is missing or stale, completed packets can sit in retry-needed state too long before anyone notices.

Scope:
- Domain/workflow: completed enrollment packet -> mapping sync retry runner
- Canonical entities/tables: enrollment_packet_requests, enrollment_packet_follow_up_queue or mapping retry queue, downstream shell/mapping state
- Expected canonical write path: public packet completion -> service layer -> explicit queued follow-up -> internal runner claims work

Required approach:
1) Inspect app/api/internal/enrollment-packet-mapping-sync/route.ts and lib/services/enrollment-packet-mapping-runtime.ts.
2) Compare its operational contract to app/api/internal/pof-post-sign-sync/route.ts.
3) Add the smallest production-safe parity features:
   - missing-config detection and alerting
   - deterministic health mode response
   - aged-queue or stale-work visibility that operations can alert on
4) Preserve the staged model. Do not fake synchronous operational readiness.
5) Keep the existing queue claim boundary authoritative.

Validation:
- Run typecheck and report results.
- Explain how ops can now tell the difference between "packet filed" and "mapping worker healthy and caught up."
- List any required env/config assumptions.

Do not overengineer. This is runner observability hardening around the existing canonical queue boundary.
```

### Issue 4. Billing custom invoice orchestration still is not one fully atomic canonical boundary

- Architectural rule violated: shared RPC standard; ACID atomicity for multi-step financial workflows; one canonical write path per workflow.
- Safest fix approach: move the smallest realistic remaining pre-RPC orchestration into a stronger canonical billing boundary without rewriting the whole billing domain.

```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Billing custom invoice generation still does source reads and invoice numbering assembly in service code before RPC persistence. That leaves the workflow only partially atomic end-to-end.

Scope:
- Domain/workflow: billing custom invoice creation
- Canonical entities/tables: billing_invoices, billing_invoice_lines, billing_coverages, center_billing_settings, member_billing_settings
- Expected canonical write path: billing action -> billing service -> one authoritative billing RPC boundary -> Supabase

Required approach:
1) Inspect the current custom invoice flow end-to-end, starting with the billing action and lib/services/billing-custom-invoices.ts or equivalent current service.
2) Identify which source reads/calculations still happen outside rpc_create_custom_invoice or its current canonical boundary.
3) Move only the minimum necessary orchestration into one stronger canonical service/RPC path so numbering and persisted invoice rows cannot drift apart under concurrent use.
4) Preserve current business rules and invoice outputs unless a change is required to restore atomicity.
5) Do not create a second parallel write path.
6) If a migration or RPC change is required, make it forward-only and explicitly align runtime and schema.

Validation:
- Run typecheck and report results.
- If schema/RPC changes are needed, list them clearly.
- Explain what atomicity gap existed before and how the new boundary closes it.

Do not overengineer. Keep this a focused financial workflow hardening pass.
```

### Issue 5. Lifecycle notifications can still be counted as delivered when zero users were actually notified

- Architectural rule violated: workflow state integrity; system event/log truthfulness; no synthetic success when required side effects fail.
- Safest fix approach: make milestone notification truth depend on actual created notifications, not an empty successful return path.

```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
The notification pipeline can still count some lifecycle milestones as delivered even when zero user_notifications rows were created, because empty-recipient outcomes are treated like success.

Scope:
- Domain/workflow: lifecycle milestone notifications across enrollment, POF, care plan, and MAR action-needed alerts
- Canonical entities/tables: user_notifications, lifecycle milestone/event records
- Expected canonical write path: workflow service -> canonical notification service -> persisted notification rows

Required approach:
1) Inspect lib/services/notifications.ts and lib/services/lifecycle-milestones.ts first.
2) Find where dispatchNotification returning zero recipients/rows is still interpreted as delivered success.
3) Change the canonical notification/milestone contract so notificationCount === 0 is not treated as delivered for action-required lifecycle events.
4) For workflows that truly require staff awareness, either require recipients explicitly or return a follow-up-needed state that operations can see.
5) Keep notification writes inside the service layer. Do not push this logic into UI callers.
6) Preserve non-blocking behavior only where the workflow should still commit even if notification follow-up fails, but keep the truth explicit.

Validation:
- Run typecheck and report results.
- List which milestone flows changed behavior.
- Explain the difference between business success, notification follow-up needed, and real delivery.

Do not overengineer. Make notification truth explicit and auditable.
```

### Issue 6. Generated-document actions still do not consistently honor `verifiedPersisted`

- Architectural rule violated: Supabase source of truth; no synthetic success when downstream artifact persistence is not verified; workflow completion requires required artifacts to be saved.
- Safest fix approach: standardize generated-document callers on the existing `verifiedPersisted` contract instead of inventing new persistence logic.

```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Generated PDF flows still do not consistently treat member_files verification as the real source of truth before reporting success. The latest workflow audit explicitly calls out monthly MAR PDF generation, and other generated-document actions should be aligned to the same canonical contract.

Scope:
- Domain/workflow: generated PDF -> member_files persistence
- Canonical entities/tables: member_files, document_events, storage bucket member-documents
- Expected canonical write path: action -> canonical document generation service -> rpc_upsert_member_file_by_source or canonical member-file service -> verified persisted result

Required approach:
1) Inspect lib/services/member-files.ts and app/(portal)/health/mar/actions-impl.ts first.
2) Find generated-document actions that call saveGeneratedMemberPdfToFiles or equivalent helpers but do not enforce verifiedPersisted before returning success.
3) Start with monthly MAR PDF, then audit and align the POF PDF and care plan generated-document callers if they still bypass the same contract.
4) Preserve existing document generation behavior, but return action-needed or follow-up-needed state instead of plain success when verifiedPersisted is false.
5) Keep the canonical member-file service authoritative. Do not create new ad hoc persistence checks in UI code.

Validation:
- Run typecheck and report results.
- List every action adjusted to honor verifiedPersisted.
- Explain what staff will now see when storage upload succeeded but canonical member_files verification did not.

Do not overengineer. This is a canonical persistence truth pass.
```

### Issue 7. Some staged workflows still return `ok: true` in ways UI can misread as fully ready

- Architectural rule violated: workflow state integrity; staged readiness must be explicit and authoritative; duplicate rule logic in UI is forbidden.
- Safest fix approach: tighten the shared response/readiness contract so staff-facing consumers cannot treat committed-but-not-ready as ready.

```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Some server actions return ok:true even when the workflow is only committed, not operationally ready. That is only safe if every UI consumer consistently honors operationallyReady, postSignStatus, post_sign_readiness_status, or mapping_sync_status. The current workflow audit says this is still easy to misread.

Scope:
- Domain/workflow: staged intake, signed POF, enrollment packet completion, and care plan post-sign readiness contracts
- Canonical entities/tables: intake_assessments, physician_orders, enrollment_packet_requests, care_plans, their readiness/status fields
- Expected canonical write path: UI -> server action -> canonical service -> explicit readiness state

Required approach:
1) Identify the shared response contract used by these staged workflows.
2) Inspect the staff-facing consumers that render completion/success states for these workflows.
3) Remove any UI or action-layer assumption that ok:true means fully ready.
4) Reuse canonical readiness fields and helpers instead of re-deriving readiness locally.
5) Make user-facing messaging impossible to confuse:
   - committed but pending follow-up
   - failed follow-up / action needed
   - fully ready
6) Keep the staged model explicit. Do not pretend everything is synchronous.

Validation:
- Run typecheck and report results.
- List the consumers updated to honor canonical readiness truth.
- Explain what changed for intake, POF, enrollment packet, and care plan status messaging.

Do not overengineer. This is a shared readiness-contract cleanup.
```

### Issue 8. Member Health Profile detail page still has the heaviest read fan-out in the app

- Architectural rule violated: maintainability and performance guardrails; avoid fragmented cross-domain read composition when one canonical read model is needed.
- Safest fix approach: split the detail page into smaller tab-scoped canonical read models instead of loading every adjacent domain on first page open.

```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
The Member Health Profile detail page is still the top confirmed read-performance hotspot. One page visit pulls the base MHP detail plus several cross-domain reads for care plans, billing payor, physician orders, progress-note summary, and directory data.

Scope:
- Domain/workflow: member health profile detail read path
- Canonical entities/tables: member_health_profiles, member_diagnoses, member_medications, member_allergies, member_providers, care_plans, physician_orders, billing-related read models
- Expected canonical read path: page/read model -> shared canonical service or RPC-backed read model -> Supabase

Required approach:
1) Inspect app/(portal)/health/member-health-profiles/[memberId]/page.tsx and the read services it calls.
2) Identify which reads are always loaded on first render but only needed for specific tabs or secondary panels.
3) Split the page into smaller tab-scoped read models so the header/core MHP data loads first and cross-domain reads load only when required.
4) Preserve canonical shared services or RPCs. Do not move business rules into the UI.
5) Avoid introducing a second competing read path for the same derived data.
6) If an RPC/read-model consolidation is the cleanest boundary, keep it migration-driven and explicit.

Validation:
- Run typecheck and report results.
- List which reads now load on initial page open vs deferred/tab-scoped load.
- Explain downstream impact on MCC/care-plan/POF summary visibility.

Do not overengineer. Reduce fan-out without redesigning the whole MHP domain.
```

### Issue 9. Shared active-member preload helpers still broad-load capped rosters

- Architectural rule violated: query performance guardrails; canonical read reuse should not create silent truncation or repeated broad reads.
- Safest fix approach: replace roster preload patterns with one search-first member lookup pattern plus selected-member backfill.

```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Shared active-member lookup helpers still preload capped full rosters, usually up to 200 rows. That creates repeated broad reads across unrelated screens and silently omits members once active census grows past the cap.

Scope:
- Domain/workflow: shared member lookup flows used by documentation, care plans, reports, ancillary, physician orders, dashboards, and similar screens
- Canonical entities/tables: members and any existing member lookup RPC/read models
- Expected canonical read path: page/form -> search-first shared lookup service -> Supabase

Required approach:
1) Inspect lib/services/shared-lookups-supabase.ts and the main callers identified in the query-performance audit.
2) Replace broad preload usage with a search-first lookup pattern.
3) Preserve selected-member backfill so forms with an existing saved member still open correctly without loading the whole roster.
4) Keep one canonical shared lookup helper instead of duplicating search logic page by page.
5) Avoid direct UI Supabase reads and do not add mock fallback member lists.

Validation:
- Run typecheck and report results.
- List the highest-impact callers updated off the broad preload path.
- Explain how the new lookup behaves when census exceeds 200 active members.

Do not overengineer. This is a shared lookup hardening pass.
```

### Issue 10. Send Enrollment Packet page still preloads too many leads and lacks the best matching index

- Architectural rule violated: query performance guardrails; canonical sales lookup should fetch only what the screen needs and align with migration-backed indexes.
- Safest fix approach: narrow the payload first, then add the smallest safe composite index matching the real query shape.

```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
The standalone Send Enrollment Packet page still preloads up to 500 eligible leads and uses a wider lead payload than the screen actually needs. The eligible-lead query also lacks a matching composite index for status/stage filtering plus inquiry_date sorting.

Scope:
- Domain/workflow: send enrollment packet lead lookup
- Canonical entities/tables: leads, enrollment packet request preparation
- Expected canonical read path: page -> sales read model/service -> Supabase

Required approach:
1) Inspect app/(portal)/sales/new-entries/send-enrollment-packet/page.tsx and the underlying lead lookup in lib/services/sales-crm-read-model.ts.
2) Narrow the lookup payload to only the fields the page actually renders/needs.
3) Replace the broad preload with a more search-first or incremental lookup pattern if that can be done safely without breaking current UX.
4) Add the safest forward-only Supabase migration for the matching lead index shape, likely on status, stage, and inquiry_date desc (or a justified partial variant for open eligible stages).
5) Keep the sales service layer authoritative. Do not move query logic into the page component.

Validation:
- Run typecheck and report results.
- Summarize the new query shape and the migration added.
- Explain downstream impact on sales packet-send UX and query cost.

Do not overengineer. Keep the fix maintainable and migration-driven.
```

### Issue 11. Required audit coverage is stale for RLS/security and schema migration safety

- Architectural rule violated: required nightly architecture audits; production-readiness signoff should not proceed on stale audit coverage.
- Safest fix approach: generate fresh saved audit artifacts rather than guessing security or schema findings from unrelated reports.

```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
The repo does not currently contain a fresh saved Supabase RLS & Security Audit or Schema Migration Safety Audit artifact for this run window. That leaves two required architecture audit streams stale.

Scope:
- Domain/workflow: nightly architecture audit coverage
- Canonical entities/tables: discover from current audit scripts and migration/runtime references
- Expected canonical write path: audit runner -> markdown artifact in docs/audits -> founder-readable summary

Required approach:
1) Find the existing scripts, prompts, or manual process used to produce the RLS/security and schema migration safety audits.
2) Generate fresh saved artifacts in docs/audits using the current repo state.
3) Do not invent findings. If an audit cannot run because a script or environment dependency is missing, report that explicitly and save a blocked artifact explaining why.
4) For schema migration safety, compare current runtime table/RPC/storage usage to migrations and call out any drift.
5) For RLS/security, focus on current policies, public-token routes, role boundaries, and any service paths that could bypass canonical permission checks.

Validation:
- Save new audit artifacts or explicit blocked artifacts in docs/audits.
- Summarize concrete findings or blockers.
- Explain whether any new production blockers were found.

Do not overengineer. The goal is fresh audit coverage, not a new framework.
```

## 3. Fix Priority Order

1. Care plan caregiver false failure after commit
2. Intake and care plan nurse post-commit telemetry false failures
3. Billing custom invoice atomic RPC boundary
4. Notification delivery truthfulness
5. Generated-document `verifiedPersisted` enforcement
6. Shared staged-readiness contract cleanup
7. Enrollment packet mapping runner observability parity
8. Member Health Profile detail fan-out reduction
9. Shared active-member lookup search-first refactor
10. Send Enrollment Packet lookup narrowing plus matching index
11. Refresh missing RLS/security and schema migration safety audit coverage

## 4. Founder Summary

The repo is in a better place than the March runs, but the remaining work is concentrated in workflow truthfulness and operational safety, not broad canonicality collapse. The highest-value fixes are the places where Memory Lane can still tell a user or staff member that something failed or completed when the canonical state says otherwise. That is why the first prompts focus on post-commit false failures, notification truth, generated-document persistence truth, and staged readiness messaging.

The next cluster is architecture hardening rather than bug triage. Billing custom invoices still deserve one tighter atomic boundary. Enrollment packet retry processing still needs better operational visibility. On the read side, the biggest remaining scaling work is still MHP detail fan-out, shared active-member roster preloads, and the broad Send Enrollment Packet lead preload. I did not invent new RLS/security or schema migration findings because the current repo does not contain fresh saved audit artifacts for those streams; the last prompt is there to refresh that missing coverage honestly.
