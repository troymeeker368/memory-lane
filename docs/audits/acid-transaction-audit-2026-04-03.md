# Memory Lane ACID Transaction Audit

Date: 2026-04-03
Audience: Founder / non-developer
Scope: lead -> member conversion, enrollment packet completion, intake -> POF generation, POF signed -> MHP/MCC/MAR cascade, care plan finalize/sign flows, member-file persistence, MAR generation/documentation workflows, and public token submission/upload flows.

## 1. Executive Summary

Memory Lane is materially safer today than it was yesterday.

Several April 2 concerns are no longer reproducible in the current code:

- Public care plan signing no longer turns a committed signature into a caregiver-facing failure just because post-sign readiness work fails.
- Intake signature and care plan nurse signature no longer report a failed signing result just because non-critical event logging fails after the signature already committed.
- The enrollment packet mapping runner now has missing-config and degraded-health visibility closer to the POF retry runner.

The strongest workflows remain:

- Lead -> member conversion, because it still runs through a shared RPC-backed canonical path with idempotency protection.
- POF public signing, because the signed state commits first and the downstream sync path now reports follow-up needs instead of pretending the sign itself failed.

The highest live ACID risk tonight is now public enrollment packet completion. The packet can commit successfully, but a later milestone or alert write can still throw and make the caregiver-facing action look failed even though the packet is already complete. That is a durability and false-failure problem, not just a UI issue.

## 2. Atomicity Violations

### A. Enrollment packet completion is still split across a committed finalize step and uncaught post-commit work

What happens:

- The canonical finalize RPC commits the packet completion.
- After that, the runtime still writes follow-up milestones and agreement-gap alerts.
- Those later writes are outside the finalize protection boundary.
- If one of them fails, the public action can still return a failure even though the packet is already completed in Supabase.

Why this matters:

- The user sees "failed" while operations data may already show "completed".
- Caregivers may retry unnecessarily.
- Staff may waste time investigating a problem that is really post-commit follow-up drift.

Evidence:

- `lib/services/enrollment-packets-public-runtime.ts`
- `app/sign/enrollment-packet/[token]/actions.ts`

### B. Intake -> POF -> member-file follow-up is still a staged workflow, not one atomic unit

What happens:

- Intake signature commits first.
- Draft POF creation and related follow-up run afterward through explicit readiness/follow-up handling.

Why this matters:

- This is not hidden anymore, which is good.
- But the workflow is still operationally multi-stage, so "signed intake" does not automatically mean "fully ready downstream".

Evidence:

- `app/intake-actions.ts`
- `lib/services/intake-pof-mhp-cascade.ts`

### C. Signed POF -> MHP/MCC/MAR remains partly atomic and partly staged

What happens:

- The first signed-POF sync boundary is better than it was before.
- But queue-based retry and downstream readiness still exist outside the first commit.

Why this matters:

- The system is honest about it, but it is still not a single all-or-nothing convergence point.

Evidence:

- `lib/services/physician-orders-supabase.ts`
- `lib/services/pof-post-sign-runtime.ts`
- `app/api/internal/pof-post-sign-sync/route.ts`

## 3. Consistency Gaps

### A. Canonical member shell completeness is still enforced mostly in services, not as a hard database guarantee

What changed:

- Missing MCC and attendance shells are less hidden now because runtime code fails explicitly instead of silently backfilling.

What remains:

- Enrollment and downstream workflows still depend on shared service checks to confirm all required member shells exist.
- That is safer than silent fallback, but still weaker than a stronger schema-level invariant.

Evidence:

- `lib/services/enrollment-packet-completion-cascade.ts`
- `lib/services/member-command-center-runtime.ts`

### B. Staged readiness is still easy to misunderstand as full completion

Examples:

- A completed enrollment packet may still need mapping follow-up.
- A signed intake may still need draft POF and member-file follow-up.
- A signed POF may still need downstream retry health.

Why this matters:

- The code is increasingly explicit about this.
- But operationally, teams can still confuse "first durable commit" with "all downstream work is now done".

## 4. Isolation Risks

### A. Enrollment packet public submission still stages uploads before the final token-consuming RPC

What happens:

- Signature assets, uploads, and packet artifacts are staged before the final completion RPC.
- There is replay-aware cleanup and dedupe protection, which is better than before.
- But close-together retries can still do duplicate pre-finalize work before one request wins the finalization race.

Why this matters:

- This is mostly a race-cost and cleanup problem now, not the worst data-integrity risk in the repo.
- It still adds unnecessary concurrency surface to a public submission flow.

Evidence:

- `lib/services/enrollment-packets-public-runtime.ts`

### B. Queue-backed downstream workflows still depend on claim/retry discipline

Affected areas:

- Enrollment packet mapping follow-up
- Signed POF downstream sync
- Intake follow-up work

Why this matters:

- The system is much more observable than before.
- But isolation still depends on queue claim semantics, cron health, and idempotent consumers behaving correctly in production.

## 5. Durability Risks

### A. Highest priority: enrollment packet post-commit milestone or alert failure can still mask a committed packet

This is tonight's clearest live durability issue.

If the finalize RPC commits but a later milestone or alert write throws:

- Supabase may already contain the committed packet state.
- The caregiver-facing action may still report failure.
- Staff can get a misleading picture of what actually persisted.

This is the same family of bug that was already fixed in care plan, intake, and nurse-sign flows. Enrollment packet completion needs the same committed-state-safe follow-up pattern.

### B. Downstream sync durability still depends on real production runner health

This is especially true for:

- Signed POF retry processing
- Enrollment packet mapping retry processing

What improved:

- Missing-config and degraded-health reporting are stronger now.

What still cannot be proven from code alone:

- Whether production secrets, cron schedules, and runtime execution are actually healthy right now.

### C. MAR durability is better, but still depends on shared follow-up discipline

I did not find a new top-severity MAR durability regression tonight.

What remains true:

- MAR generation and documentation safety still depends on canonical upstream inputs from signed POF and member health profile flows.
- If upstream readiness drifts, MAR truth can still lag even when the MAR code path itself is behaving.

Evidence:

- `lib/services/mar-workflow.ts`
- `lib/services/mar-prn-workflow.ts`

## 6. ACID Hardening Plan

### Fix now

1. Apply the same committed-state-safe post-commit pattern to enrollment packet completion that was already applied to care plan, intake, and care plan nurse signing.
2. Move enrollment packet milestone and alert writes behind a best-effort wrapper that cannot turn a committed finalize result into a false failure.
3. Return a "completed with follow-up required" style result when post-commit side effects fail, instead of throwing.

### Fix next

1. Reduce pre-finalize staging work in public enrollment packet submission where possible.
2. Keep tightening queue claim, health, and aged-item observability for POF and enrollment follow-up runners.
3. Decide which member-shell invariants should move from service-level enforcement into stronger schema-backed guarantees.

### Keep watching

1. Intake and enrollment packet staged readiness semantics.
2. Signed POF downstream retry health in real deployment.
3. Any new workflow that writes both database rows and files/storage artifacts.

## 7. Suggested Codex Prompts

### Prompt 1: Fix the highest-priority enrollment packet false-failure bug

Audit and fix `lib/services/enrollment-packets-public-runtime.ts` so public enrollment packet completion never returns failure after `rpc_finalize_enrollment_packet_submission` has already committed. Follow the same committed-state-safe pattern already used in the fixed care-plan and intake signature flows. Post-commit milestone writes, alerts, and agreement-gap logging must become best-effort and return a follow-up-required result instead of throwing. Verify the public action in `app/sign/enrollment-packet/[token]/actions.ts` keeps committed packets on the success path. Add regression coverage for a committed finalize plus failing post-commit milestone/alert write.

### Prompt 2: Tighten enrollment packet race surface

Review `lib/services/enrollment-packets-public-runtime.ts` for work that happens before the final token-consuming RPC. Reduce non-essential pre-finalize staging where possible, preserve replay safety, and document what must remain staged by design. The goal is to shrink duplicate work during near-simultaneous retries without changing the canonical Supabase finalize boundary.

### Prompt 3: Harden member shell consistency

Audit the required member shell invariants used by enrollment completion, command center reads, and downstream clinical workflows. Identify which invariants should stay in shared services and which should become stronger schema-backed guarantees. Focus on `lib/services/enrollment-packet-completion-cascade.ts`, `lib/services/member-command-center-runtime.ts`, and the related Supabase migrations. Recommend the smallest production-safe hardening step first.

## 8. Fix First Tonight

Fix the public enrollment packet post-commit false-failure path.

Reason:

- It is the clearest live ACID risk I found tonight.
- It affects a public caregiver-facing submission flow.
- The pattern is already known and already fixed in similar signature/finalize flows, so the fix should be relatively contained and low-risk.

## 9. Automate Later

1. Add a shared helper for "finalize committed, follow-up failed" handling so each public signing/completion flow does not reinvent it.
2. Add regression tests that force post-commit milestone, alert, and event-log failures across enrollment, intake, care plan, and POF flows.
3. Add a founder-readable health summary endpoint or audit output that clearly distinguishes:
   - committed
   - committed with follow-up required
   - not committed
4. Keep expanding aged-queue and missing-config alerts for every internal retry runner.

## 10. Founder Summary: What changed since the last run

What got better since yesterday:

- The care plan caregiver signing false-failure concern from the April 2 audit appears fixed.
- Intake signature and care plan nurse signature no longer treat post-commit event logging failures as if the signature itself failed.
- Enrollment packet mapping runner observability is stronger and now looks much closer to the POF retry runner.

What did not regress:

- Lead -> member conversion still looks strong and remains one of the safer write paths in the system.
- POF public signing still keeps the signed state and downstream follow-up truth separated in a safer way than before.
- I did not find a new top-severity regression in member-file persistence tonight.

What is now the main problem:

- The top live issue has moved to public enrollment packet completion. The packet can commit, but uncaught post-commit milestone or alert work can still make the caregiver-facing result look failed.

Bottom line:

Yesterday's highest concerns were partially fixed. That is real progress. Tonight, the cleanest next move is to apply the same post-commit safety pattern to enrollment packet completion so a committed packet can never be reported as a failure just because follow-up bookkeeping had a problem.
