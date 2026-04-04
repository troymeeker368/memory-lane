# Memory Lane ACID Transaction Audit

Date: 2026-04-04
Audience: Founder / non-developer
Scope: lead -> member conversion, enrollment packet completion, intake -> POF generation, POF signed -> MHP/MCC/MAR cascade, care plan finalize/sign flows, member-file persistence, MAR generation/documentation workflows, and public token submission/upload flows.

## 1. Executive Summary

- Overall ACID safety rating: 7.8 / 10
- Overall verdict: Partial
- Top 5 ACID risks:
  - Public enrollment packet submission still stages uploads and artifacts before the final token-consuming RPC, so near-simultaneous retries can do duplicate pre-finalize work.
  - Signed POF downstream sync is still intentionally staged through a queue, which means "signed" does not always mean MHP/MCC/MAR are operationally ready yet.
  - Intake post-sign remains a staged workflow: a signed intake can still need draft POF follow-up or member-file follow-up.
  - Canonical member shell completeness is still enforced mainly in shared services instead of a stronger schema-backed guarantee.
  - Member-file delete can still leave a database row pointing to a missing storage object if storage deletion succeeds but the DB delete fails afterward.
- Strongest workflows:
  - Lead -> member conversion remains one of the strongest paths because it is RPC-backed, idempotent, and still guarded by shell-success assertions in the canonical conversion path.
  - Public POF signing is strong because committed signatures stay on the success path and post-sign follow-up failures degrade to queued/action-needed truth instead of pretending the sign failed.
  - MAR monthly PDF generation is stronger than before because it explicitly returns follow-up-needed when Member Files verification is not durable yet.
- Short founder summary:
  - The main issue from yesterday appears fixed. Enrollment packet completion no longer looks like the top false-failure bug. The system is safer today, but the remaining risk is now more about staged workflows, queue health, and cleanup drift than about outright false success.

## 2. Atomicity Violations

### Finding A

- Severity: Medium
- Workflow name: Public enrollment packet completion
- Exact files/functions/modules:
  - [lib/services/enrollment-packets-public-runtime.ts](D:/Memory Lane App/lib/services/enrollment-packets-public-runtime.ts)
  - [supabase/migrations/0180_enrollment_completion_follow_up_state.sql](D:/Memory Lane App/supabase/migrations/0180_enrollment_completion_follow_up_state.sql)
- What should happen:
  - The public submission flow should do as little irreversible work as possible before the final token-consuming RPC decides the packet is complete.
- What currently happens:
  - The flow still uploads the caregiver signature artifact, other staged uploads, and the completed packet artifact before calling `rpc_finalize_enrollment_packet_submission`.
- How partial failure could occur:
  - If two submits happen close together, both can do expensive staging work before only one wins finalization. Cleanup exists, but this is still extra race surface and extra cleanup burden on a public flow.
- Recommended fix:
  - Move non-essential work after the finalize RPC where possible, or tighten batch-level dedupe so replay losers do less pre-finalize work.
- Blocks launch: No

### Finding B

- Severity: Medium
- Workflow name: Intake -> draft POF -> intake PDF member-file persistence
- Exact files/functions/modules:
  - [lib/services/intake-pof-mhp-cascade.ts](D:/Memory Lane App/lib/services/intake-pof-mhp-cascade.ts)
  - [app/intake-actions.ts](D:/Memory Lane App/app/intake-actions.ts)
  - [supabase/migrations/0055_intake_draft_pof_atomic_creation.sql](D:/Memory Lane App/supabase/migrations/0055_intake_draft_pof_atomic_creation.sql)
- What should happen:
  - A signed intake should either finish its required downstream handoff or expose a single explicit staged state that every consumer treats as not fully ready yet.
- What currently happens:
  - The signature commits first, then the workflow separately handles draft POF creation and intake PDF persistence, with queued follow-up when immediate verification is missing.
- How partial failure could occur:
  - Intake can be durably signed while the draft POF or member-file artifact still needs follow-up. This is now explicit and safer than before, but it is still not one atomic unit.
- Recommended fix:
  - Keep the staged model, but standardize a single readiness contract that downstream screens can use instead of inferring readiness from signature status alone.
- Blocks launch: No

## 3. Consistency Gaps

### Finding A

- Severity: Medium
- Affected schema/business rule:
  - Every active converted/enrolled member should have required operational shells like MCC and attendance schedule.
- Exact files/migrations/services involved:
  - [lib/services/member-command-center-runtime.ts](D:/Memory Lane App/lib/services/member-command-center-runtime.ts)
  - [lib/services/enrollment-packet-completion-cascade.ts](D:/Memory Lane App/lib/services/enrollment-packet-completion-cascade.ts)
  - [supabase/migrations/0158_lead_conversion_shell_success_guard.sql](D:/Memory Lane App/supabase/migrations/0158_lead_conversion_shell_success_guard.sql)
- What invariant is not enforced:
  - The runtime now fails loudly when shells are missing, but the database still does not fully guarantee those shells exist for every canonical member.
- Why it matters:
  - A member can exist while downstream operational reads still fail until repair happens. That is better than silent backfill, but it is still weaker than a harder canonical invariant.
- Recommended DB/service fix:
  - Add a DB-backed or RPC-backed readiness marker that is only set when required shells exist, and use that marker consistently across downstream consumers.
- Blocks launch: No

### Finding B

- Severity: Medium
- Affected schema/business rule:
  - "Committed" versus "operationally ready" truth is still represented differently across enrollment, intake, and POF workflows.
- Exact files/migrations/services involved:
  - [lib/services/committed-workflow-state.ts](D:/Memory Lane App/lib/services/committed-workflow-state.ts)
  - [lib/services/pof-post-sign-runtime.ts](D:/Memory Lane App/lib/services/pof-post-sign-runtime.ts)
  - [lib/services/intake-pof-mhp-cascade.ts](D:/Memory Lane App/lib/services/intake-pof-mhp-cascade.ts)
  - [supabase/migrations/0180_enrollment_completion_follow_up_state.sql](D:/Memory Lane App/supabase/migrations/0180_enrollment_completion_follow_up_state.sql)
- What invariant is not enforced:
  - The repo is getting better at surfacing staged truth, but there is still no single shared cross-workflow readiness contract.
- Why it matters:
  - Staff can still misread "signed" or "completed" as "everything downstream is ready" when some workflows are still intentionally staged.
- Recommended DB/service fix:
  - Introduce one shared resolver vocabulary for committed versus operationally ready versus follow-up-required, then align workflow surfaces to it.
- Blocks launch: No

## 4. Isolation Risks

### Finding A

- Severity: Medium
- Workflow name: Public enrollment packet submit + upload flow
- Concurrency/replay scenario:
  - Two caregivers or browser retries submit the same packet close together.
- Exact files/functions involved:
  - [lib/services/enrollment-packets-public-runtime.ts](D:/Memory Lane App/lib/services/enrollment-packets-public-runtime.ts)
  - [lib/services/enrollment-packet-public-uploads.ts](D:/Memory Lane App/lib/services/enrollment-packet-public-uploads.ts)
- What duplicate/conflicting state could happen:
  - Duplicate staged uploads and repeated artifact work can occur before only one finalization wins.
- Recommended protection:
  - Reduce pre-finalize work and keep strengthening upload-batch dedupe/cleanup around replay losers.
- Blocks launch: No

### Finding B

- Severity: Medium
- Workflow name: Signed POF -> MHP/MCC/MAR cascade
- Concurrency/replay scenario:
  - The POF sign commits, but the immediate sync path fails or the retry runner lags.
- Exact files/functions involved:
  - [lib/services/physician-orders-supabase.ts](D:/Memory Lane App/lib/services/physician-orders-supabase.ts)
  - [lib/services/pof-post-sign-runtime.ts](D:/Memory Lane App/lib/services/pof-post-sign-runtime.ts)
  - [app/api/internal/pof-post-sign-sync/route.ts](D:/Memory Lane App/app/api/internal/pof-post-sign-sync/route.ts)
- What duplicate/conflicting state could happen:
  - The physician order is signed, but clinical downstream state can still be queued or lagging. If operations assumes signed means fully ready, staff can act on stale MHP/MAR truth.
- Recommended protection:
  - Keep queue claim/retry semantics strict, and treat aged-queue or missing-config alerts as operational incidents, not low-priority warnings.
- Blocks launch: No

## 5. Durability Risks

### Finding A

- Severity: Medium
- Workflow name: Member-file delete
- Exact files/functions involved:
  - [lib/services/member-files.ts](D:/Memory Lane App/lib/services/member-files.ts)
- What success currently means:
  - The service only reports success after storage cleanup and DB row deletion both complete.
- What may fail underneath:
  - Storage can be deleted first, then the DB delete can fail.
- Why that is unsafe:
  - You get the safer "no false success" behavior, but the system can still be left with a DB row pointing to a missing object until repair happens.
- Recommended correction:
  - Add a repair-safe delete contract, such as a tombstone/cleanup queue or an automated drift repair for rows whose storage object is already gone.
- Blocks launch: No

### Finding B

- Severity: Medium
- Workflow name: POF and enrollment downstream retry runners
- Exact files/functions involved:
  - [app/api/internal/pof-post-sign-sync/route.ts](D:/Memory Lane App/app/api/internal/pof-post-sign-sync/route.ts)
  - [app/api/internal/enrollment-packet-mapping-sync/route.ts](D:/Memory Lane App/app/api/internal/enrollment-packet-mapping-sync/route.ts)
- What success currently means:
  - The code now records queued/action-needed truth honestly, instead of pretending everything is ready.
- What may fail underneath:
  - Real production durability still depends on secrets, cron wiring, and runner health that cannot be proven from code alone.
- Why that is unsafe:
  - If those routes stop running in production, clinically important downstream sync can silently age into backlog even though canonical first-stage commits succeeded.
- Recommended correction:
  - Add a founder-visible runner health check and treat stale queue age as a release-safety signal.
- Blocks launch: No from code alone, but Yes if production runner health is not being monitored

## 6. ACID Hardening Plan

1. Reduce public enrollment packet pre-finalize staging so retries do less duplicate work.
2. Add one shared readiness contract across enrollment, intake, POF, and care plan workflows.
3. Add stronger repair-safe handling for member-file delete drift after storage-first cleanup.
4. Keep treating POF and enrollment retry-runner health as first-class operational dependencies.
5. Continue moving high-risk write paths into RPC-backed canonical boundaries like the new physician-order save/sign path.

## 7. Suggested Codex Prompts

### Prompt 1

Audit `lib/services/enrollment-packets-public-runtime.ts` and reduce non-essential work that happens before `rpc_finalize_enrollment_packet_submission`. Keep replay safety intact, preserve canonical Supabase truth, and shrink duplicate staging during near-simultaneous retries. Add regression coverage for two concurrent submit attempts so the loser does minimal pre-finalize work and cleanup remains deterministic.

### Prompt 2

Add a shared operational-readiness contract for staged workflows across enrollment packet completion, intake post-sign follow-up, signed POF downstream sync, and care plan post-sign follow-up. Use existing truth fields where they already exist, avoid fake success, and make server actions return one consistent founder-readable readiness vocabulary.

### Prompt 3

Harden `lib/services/member-files.ts` so delete drift is safer when storage deletion succeeds but DB row deletion fails. Propose the smallest clean change that preserves the current no-false-success behavior while making reconciliation or retry deterministic and auditable.

## 8. Fix First Tonight

Reduce the enrollment packet public submit race surface.

Why this is first:

- Yesterday's false-failure bug looks materially fixed, so the biggest remaining code-side issue in that public flow is now unnecessary pre-finalize work under retry/concurrency.
- It is a bounded fix in one high-traffic public workflow.
- It lowers both race risk and cleanup burden without changing the canonical finalize RPC.

## 9. Automate Later

1. Add a nightly stale-queue report for POF post-sign sync and enrollment packet mapping sync.
2. Add an automated drift scan for member-file rows whose storage object is missing.
3. Add regression tests that simulate replay and double-submit on public enrollment and public signing flows.
4. Add one founder-readable "committed vs ready vs follow-up-required" status audit across intake, enrollment, POF, and care plan workflows.

## 10. Founder Summary: What changed since the last run

What improved since yesterday:

- The prior highest-priority issue appears closed. Public enrollment packet completion now has a committed-state-safe follow-up model. The runtime records post-commit follow-up failure and returns a follow-up-required success result instead of surfacing the whole completion as failed.
- Enrollment packet operational truth is stronger because `0180_enrollment_completion_follow_up_state.sql` adds a DB-backed `completion_follow_up_status` contract instead of relying only on ad hoc runtime wording.
- The physician-order save/sign boundary is stronger than before because `0181_physician_order_save_rpc_atomicity.sql` keeps save/sign behavior inside a more transactional RPC-backed path and returns post-sign queue metadata directly.

What did not regress:

- Lead -> member conversion still looks strong and remains one of the safest canonical write paths in the repo.
- Member-file persistence still keeps verification-pending truth explicit instead of deleting likely committed artifacts after readback misses.
- MAR monthly PDF generation still refuses to overstate durability when Member Files verification is not confirmed.
- The earlier care plan and intake post-commit false-failure fixes still appear intact.

What is now the main problem:

- The audit focus shifts away from yesterday's false-failure bug and back toward staged-workflow hygiene: reducing duplicate pre-finalize work, keeping downstream queue health visible, and making operational readiness truth consistent across modules.

Bottom line:

- The repo is safer today than it was on April 3. The main open work is no longer "stop lying about committed state." It is now "make staged workflows easier to reason about, harder to replay wastefully, and easier to monitor when downstream work lags."
