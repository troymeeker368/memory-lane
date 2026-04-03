# Fix Prompt Generator - 2026-04-03

## 1. Issues Detected

### Coverage Notes
- Reviewed latest available artifacts for each requested stream:
- `docs/audits/supabase-rls-security-audit-2026-04-02.md`
- `docs/audits/production-readiness-audit-2026-04-02.md`
- `docs/audits/daily-canonicality-sweep-raw-2026-03-27.json`
- `docs/audits/schema-migration-safety-audit-2026-04-02.md`
- `docs/audits/shared-resolver-drift-check-2026-03-29.md`
- `docs/audits/rpc-architecture-audit-2026-03-24.md`
- `docs/audits/acid-transaction-audit-2026-04-03.md`
- `docs/audits/idempotency-duplicate-submission-audit-2026-03-29.md`
- `docs/audits/workflow-simulation-audit-2026-04-03.md`
- `docs/audits/query-performance-audit-2026-03-31.md`
- The latest daily canonicality sweep did not surface a fresh direct runtime bug. It found no missing runtime tables, RPCs, storage buckets, mock-runtime imports, or banned production fallback patterns.
- The latest shared resolver drift audit says its focused drift bugs were fixed in that run and did not leave a fresh low-risk resolver prompt open.
- The latest idempotency audit says the main low-risk duplicate-write gap was already fixed. Remaining replay concerns are larger workflow-design items, not a narrow patch.

### Open Issues Selected
1. `public.user_permissions` is still missing repo-defined RLS and policies.
2. Public enrollment packet completion can still report failure after the finalize RPC already committed.
3. Billing custom invoice generation still has non-fully-atomic orchestration before the canonical RPC boundary.
4. Core lifecycle milestones can still treat zero-recipient notification outcomes as delivered.
5. Monthly MAR PDF filing can still return `ok: true` when canonical `member_files` verification is only follow-up-needed.
6. Signed POF can be durably committed while downstream MHP/MAR sync is only queued, and staff-facing readiness still needs stricter truth enforcement.
7. Member Health Profile detail remains the heaviest confirmed read fan-out in the app.
8. Shared member lookup and enrollment-packet lead lookup still use broad preload patterns that will not scale cleanly.
9. Schema migration safety is clean in the repo, but linked-project migration history repair is still the blocker before production signoff.

## 2. Codex Fix Prompts

### Issue 1. Add database-enforced RLS to `user_permissions`

- Violated architectural rule: preserve role restrictions and data integrity; Supabase must be the canonical permission boundary, not only app-layer guards.
- Safest fix approach: add a forward-only migration enabling RLS on `public.user_permissions` with explicit admin and service-role policies, while preserving the current canonical user-management service path.

```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
The canonical staff permission override table `public.user_permissions` is used by the live user-management flow but still has no repo-defined RLS enablement or policies. That leaves the table relying too much on app-layer admin checks instead of a database-enforced boundary.

Scope:
- Domain/workflow: user management / staff permission overrides
- Canonical entities/tables: public.user_permissions, related role tables if they are already active runtime dependencies
- Expected canonical write path: admin UI -> server action/service -> Supabase admin path for writes, policy-protected reads

Required approach:
1) Inspect `supabase/migrations/0002_rbac_roles_permissions.sql` and `lib/services/user-management.ts` first.
2) Add a forward-only migration that:
   - enables RLS on `public.user_permissions`
   - allows read/write only for the intended admin role boundary
   - preserves `service_role` maintenance access
3) Keep the current canonical user-management service write path intact. Do not move permission logic into UI components.
4) If `public.roles` or `public.role_permissions` are already real runtime dependencies, audit whether they need the same hardening in this migration wave. If not, leave them unchanged and document why.
5) Avoid broad authenticated policies. Keep the policy contract explicit and auditable.

Validation:
- Run typecheck and report results.
- List the migration added and any service or page files touched.
- Explain how admin-only reads/writes are enforced after the change.
- Call out any blocker if live-project grant verification cannot be done locally.

Do not overengineer. This is a database-boundary hardening fix.
```

### Issue 2. Make enrollment packet completion committed-state-safe after finalize

- Violated architectural rule: ACID durability; no synthetic failure after canonical persistence already succeeded; workflow truth must distinguish committed from follow-up-needed.
- Safest fix approach: apply the same committed-state-safe pattern already used in care plan and intake signature flows so post-commit milestone/alert failures cannot masquerade as finalize failure.

```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Public enrollment packet completion can still return a caregiver-facing failure after `rpc_finalize_enrollment_packet_submission` already committed, if later milestone, alert, or agreement-gap follow-up writes throw.

Scope:
- Domain/workflow: enrollment packet public completion
- Canonical entities/tables: enrollment_packet_requests, enrollment_packet_events, enrollment_packet_follow_up_queue, member_files
- Expected canonical write path: public action -> service layer -> finalize RPC -> best-effort post-commit follow-up

Required approach:
1) Inspect `lib/services/enrollment-packets-public-runtime.ts` and `app/sign/enrollment-packet/[token]/actions.ts` first.
2) Identify exactly which post-commit milestone/alert writes still run after finalize success and can still throw.
3) Keep `rpc_finalize_enrollment_packet_submission` as the authoritative persistence boundary.
4) Once finalize has committed, never return the packet as failed because of later follow-up work.
5) Convert those later writes to a committed-with-follow-up-required pattern:
   - return a truthful committed result
   - expose explicit follow-up/action-needed state
   - keep alerting/audit visibility for the degraded follow-up
6) Do not suppress true finalize RPC failures.
7) Add focused regression coverage for “finalize committed, milestone write failed”.

Validation:
- Run typecheck and report results.
- Explain the before/after response contract for the public completion action.
- List changed files and downstream UI/status consumers affected.

Do not overengineer. Reuse the existing committed-state-safe pattern already established in similar finalize flows.
```

### Issue 3. Tighten the billing custom-invoice atomic boundary

- Violated architectural rule: shared RPC standard; one canonical write path per workflow; financial multi-step writes must be atomic.
- Safest fix approach: move only the remaining pre-RPC orchestration that can create numbering/persistence drift into the canonical billing RPC/service boundary.

```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Billing custom invoice generation still assembles source reads and invoice numbering in service code before RPC persistence. That means the workflow is not fully atomic end-to-end.

Scope:
- Domain/workflow: custom invoice creation
- Canonical entities/tables: billing_invoices, billing_invoice_lines, billing_coverages, center_billing_settings, member_billing_settings
- Expected canonical write path: billing action -> billing service -> one authoritative billing RPC boundary -> Supabase

Required approach:
1) Inspect the current custom invoice flow end-to-end, starting with the billing action and the current custom-invoice service/RPC files.
2) Identify the exact orchestration that still happens before the canonical RPC boundary and can drift under concurrent use.
3) Move only the minimum necessary logic into one stronger canonical service/RPC path so invoice numbering and persisted rows cannot diverge.
4) Preserve current invoice behavior unless a change is required to restore atomicity.
5) Do not create a second write path and do not push business rules into UI code.
6) If an RPC or migration change is required, make it forward-only and keep schema/runtime alignment explicit.

Validation:
- Run typecheck and report results.
- If a migration or RPC change is added, list it clearly.
- Explain the atomicity gap before and how the new boundary closes it.

Do not overengineer. Keep this a focused financial workflow hardening pass.
```

### Issue 4. Make lifecycle notification delivery truth explicit

- Violated architectural rule: no synthetic success when required side effects did not happen; workflow handoffs must stay auditable and truthful.
- Safest fix approach: expand the “delivery required” contract for core lifecycle milestones so zero created `user_notifications` rows is not silently treated as delivered.

```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Ordinary lifecycle milestones such as enrollment packet submitted, intake completed, POF sent/signed, and care plan signed can still resolve zero recipients and be treated as delivered. That hides missed staff handoffs.

Scope:
- Domain/workflow: lifecycle milestone notifications
- Canonical entities/tables: user_notifications, lifecycle milestone/event records
- Expected canonical write path: workflow service -> notification service -> persisted user_notifications rows

Required approach:
1) Inspect `lib/services/lifecycle-milestones.ts`, `lib/services/notifications.ts`, and `lib/services/notifications-runtime.ts` first.
2) Find where `notificationCount === 0` is still acceptable for core completion milestones.
3) Tighten the canonical contract so the following at minimum are not treated as delivered when no notifications were created:
   - `enrollment_packet_submitted`
   - `intake_completed`
   - `pof_sent`
   - `pof_signed`
   - `care_plan_signed`
4) Preserve the current best-effort pattern only where it is intentionally non-blocking, but make the truth explicit with follow-up-needed state.
5) Keep notification logic inside shared services. Do not patch screens one by one.

Validation:
- Run typecheck and report results.
- List which milestone flows changed behavior.
- Explain the difference between business success, notification follow-up needed, and real delivery.

Do not overengineer. This is a notification-truth and operational-handoff fix.
```

### Issue 5. Enforce `verifiedPersisted` truth for monthly MAR PDF filing

- Violated architectural rule: required artifacts must be durably persisted before success is claimed; Supabase/member-files is the source of truth.
- Safest fix approach: align monthly MAR PDF filing to the same canonical “committed but follow-up-needed” contract already used in stronger document flows.

```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Monthly MAR PDF generation can still return `ok: true` even when the storage upload finished but canonical `member_files` verification is still `follow-up-needed`. That can overstate success to staff.

Scope:
- Domain/workflow: MAR monthly PDF generation -> member file persistence
- Canonical entities/tables: member_files, document_events, member-documents bucket
- Expected canonical write path: action -> document/member-file service -> verified persisted result

Required approach:
1) Inspect `app/(portal)/health/mar/actions-impl.ts` and `lib/services/member-files.ts` first.
2) Identify the monthly MAR PDF action path that still returns `ok: true` when `verifiedPersisted` is false.
3) Keep the canonical member-file service authoritative.
4) Change the action/result contract so staff cannot confuse:
   - PDF generated
   - storage uploaded
   - canonical member_files row verified
5) Return explicit follow-up-needed state instead of plain success when verification is incomplete.
6) Do not duplicate persistence checks in UI code.

Validation:
- Run typecheck and report results.
- Explain the new response contract for MAR PDF generation.
- List any other generated-document callers that were aligned in the same pass.

Do not overengineer. This is a persistence-truth cleanup.
```

### Issue 6. Make signed POF readiness impossible to misread

- Violated architectural rule: staged workflows must expose explicit readiness truth; downstream clinical sync status must not be mistaken for full operational completion.
- Safest fix approach: keep the queue-backed post-sign sync model, but ensure every staff-facing consumer honors canonical post-sign readiness and runner health.

```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
A physician order can be durably signed while downstream MHP and MAR sync is only queued. The architecture is intentionally staged, but staff-facing surfaces can still misread signed status as fully operationally ready.

Scope:
- Domain/workflow: signed POF -> MHP/MCC/MAR downstream sync
- Canonical entities/tables: physician_orders, pof_post_sign_sync_queue, member_health_profiles, MAR downstream state
- Expected canonical write path: public/provider sign -> finalize RPC -> queue-backed post-sign sync -> explicit readiness state

Required approach:
1) Inspect `app/sign/pof/[token]/actions.ts`, `lib/services/pof-esign-public.ts`, `lib/services/pof-post-sign-runtime.ts`, and `app/api/internal/pof-post-sign-sync/route.ts`.
2) Keep the current queue-backed architecture. Do not fake synchronous all-at-once completion.
3) Audit all staff-facing readers/actions that consume signed POF status and ensure `postSignStatus: "queued"` is treated as not operationally ready.
4) Tighten messaging and shared helpers so “signed” and “fully synced downstream” cannot be confused.
5) Verify the internal sync runner exposes clear missing-config/degraded-health truth if it is not healthy.

Validation:
- Run typecheck and report results.
- List the staff-facing consumers updated to honor canonical post-sign readiness.
- Explain how operations can now distinguish signed, queued, and synced states.

Do not overengineer. Preserve the staged workflow and make its truth explicit.
```

### Issue 7. Reduce Member Health Profile detail read fan-out

- Violated architectural rule: shared canonical reads should not become heavy repeated fan-out hot paths; maintainability and performance matter in production paths.
- Safest fix approach: keep canonical services, but split the page into smaller tab-scoped read models so first paint does not always drag in every adjacent domain.

```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
The Member Health Profile detail page is still the top confirmed read-performance hotspot. One page visit loads the base MHP detail and then adds multiple cross-domain reads for care plans, billing payor, physician orders, progress-note summary, and directory data.

Scope:
- Domain/workflow: member health profile detail read path
- Canonical entities/tables: member_health_profiles and the cross-domain summary reads it currently triggers
- Expected canonical read path: page/read model -> shared service or RPC-backed read model -> Supabase

Required approach:
1) Inspect `app/(portal)/health/member-health-profiles/[memberId]/page.tsx` and the read services it calls.
2) Identify which reads are always loaded on first render but are really tab-scoped or secondary-panel data.
3) Split the page into smaller read models so core MHP data loads first and cross-domain summaries load only when needed.
4) Preserve shared canonical services or RPCs. Do not move business logic into the page component.
5) If one consolidated RPC/read model is the cleanest boundary, keep it migration-driven and explicit.

Validation:
- Run typecheck and report results.
- List what now loads on initial page open versus deferred/tab-scoped load.
- Explain downstream impact on care plan, POF, billing, and progress-note visibility.

Do not overengineer. Reduce hot-path fan-out without redesigning the entire MHP domain.
```

### Issue 8. Replace broad preload lookups with search-first paths

- Violated architectural rule: shared resolver/read reuse should not create silent truncation or repeated broad queries; fixes should stay in canonical shared services and migrations.
- Safest fix approach: replace broad active-member and eligible-lead preloads with search-first canonical lookup helpers, and add the smallest matching lead index.

```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Shared member lookup helpers still preload capped active-member rosters, and the standalone Send Enrollment Packet page still preloads a wide 500-row eligible-lead list. That creates scaling cost and silent omission risk.

Scope:
- Domain/workflow: shared member lookups and enrollment-packet lead lookup
- Canonical entities/tables: members, leads
- Expected canonical read path: page/form -> shared lookup service -> Supabase

Required approach:
1) Inspect `lib/services/shared-lookups-supabase.ts`, `lib/services/documentation.ts`, `lib/services/physician-orders-read.ts`, `app/(portal)/sales/new-entries/send-enrollment-packet/page.tsx`, and `lib/services/sales-crm-read-model.ts`.
2) Replace broad active-member preload usage with one search-first shared member lookup pattern.
3) Preserve selected-id backfill so existing saved forms still open correctly.
4) Narrow the enrollment-packet eligible-lead payload to the fields the page actually renders.
5) Add the safest forward-only Supabase index matching the real lead query shape, likely around `(status, stage, inquiry_date desc)` or a justified partial equivalent.
6) Keep the lookup logic in shared services. Do not duplicate Supabase query logic across pages.

Validation:
- Run typecheck and report results.
- List the highest-impact callers moved off broad preloads.
- Summarize the new lead query shape and the migration added.

Do not overengineer. This is a search-first shared lookup hardening pass.
```

### Issue 9. Repair linked-project migration history before release signoff

- Violated architectural rule: migration-driven schema must stay aligned between repo and target project; production readiness cannot rely on local-only migration order being correct.
- Safest fix approach: repair remote migration history and verify the committed `0175` through `0178` sequence is what the target Supabase project recognizes.

```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
The local repo's schema migration safety audit is clean, but production signoff is still blocked because linked-project migration history may not match the committed `0175` through `0178` migration sequence.

Scope:
- Domain/workflow: Supabase migration history / deployment safety
- Canonical entities/tables: all runtime tables, RPCs, and the member-documents bucket depend on the project recognizing the committed migration order
- Expected canonical write path: committed forward-only migrations -> linked Supabase project -> runtime schema

Required approach:
1) Inspect the current Supabase migration state and any existing repair workflow first.
2) Repair the linked project so the remote migration history matches the committed ordered filenames for `0175` through `0178`.
3) Do not rename or reshuffle committed migrations again unless the repair workflow requires it and the change is fully explained.
4) After repair, rerun the migration safety checks and confirm pending migrations apply cleanly.
5) If the workspace cannot verify the linked project directly, report the exact blocker and the exact commands/status needed next.

Validation:
- Summarize the remote-vs-local migration history mismatch before the fix.
- Confirm whether the linked project now recognizes the committed sequence through `0178`.
- Report any remaining blocker before calling the repo production-ready.

Do not overengineer. This is a deployment-safety repair, not an application refactor.
```

## 3. Fix Priority Order

1. Add RLS and explicit policies to `public.user_permissions`.
2. Fix enrollment packet post-commit false-failure behavior.
3. Tighten billing custom-invoice atomicity.
4. Make lifecycle notification delivery truth explicit.
5. Enforce `verifiedPersisted` truth for monthly MAR PDF filing.
6. Make signed POF readiness impossible to misread.
7. Repair linked-project migration history through `0178`.
8. Reduce Member Health Profile detail read fan-out.
9. Replace broad member/lead preloads with search-first lookups and a matching lead index.

## 4. Founder Summary

The repo looks materially healthier than the earlier March runs, and several issue classes are now effectively clear: the daily canonicality sweep did not find missing runtime schema objects or mock-runtime splits, and the latest focused resolver-drift and idempotency audits say their small safe fixes already landed. The remaining work is concentrated in three areas: one real security boundary gap, a few workflow-truth problems where committed state can still be overstated or understated, and a smaller set of scaling hot spots that are now the main read-performance cost.

The highest-priority new issue is the fresh RLS/security finding: `user_permissions` still needs a database-enforced policy boundary. After that, the most important fixes are about truthful operational state. Enrollment packet completion still needs the same committed-state-safe pattern already applied to other finalize flows. Notifications and monthly MAR PDF filing still have places where staff can be told something is complete enough when the downstream handoff is not fully true yet. Billing custom invoices remain the main unresolved atomicity debt. On the performance side, the biggest wins are still MHP detail fan-out and replacing broad preload lookups with search-first shared services.
