# Memory Lane ACID Transaction Audit

Date: 2026-04-01

## 1. Executive Summary

- Overall ACID safety rating: 6.5/10
- Overall verdict: Partial
- Top 5 ACID risks:
  1. Signature-finalization flows still delete uploaded artifacts after ambiguous RPC failures, which can turn a committed database success into storage drift.
  2. Intake and enrollment packet workflows still rely on a second stage after the first durable commit, so "signed" or "filed" does not always mean operationally ready.
  3. Care plan caregiver replay can still tell staff that nothing needs attention even when post-sign readiness never finished.
  4. POF downstream MHP/MCC/MAR sync and enrollment packet mapping still depend on retry runners being configured, reachable, and watched in production.
  5. Intake and care plan nurse signing still couple post-commit telemetry to the user-visible result, so a logging failure can look like the whole signature failed even after the signature is already committed.
- Strongest workflows:
  - Lead -> member conversion is still one of the stronger paths because it stays inside shared RPC boundaries and uses deterministic idempotency roots in [`lib/services/sales-lead-conversion-supabase.ts`](/D:/Memory%20Lane%20App/lib/services/sales-lead-conversion-supabase.ts).
  - Shared member-file persistence is materially safer than it was last week because verification-pending handling now avoids deleting likely committed files on immediate readback misses in [`lib/services/member-files.ts`](/D:/Memory%20Lane%20App/lib/services/member-files.ts).
  - Enrollment packet public submission still has the best guardrail coverage on the public side: replay-safe token handling plus token/IP throttling in [`lib/services/enrollment-packet-public-helpers.ts`](/D:/Memory%20Lane%20App/lib/services/enrollment-packet-public-helpers.ts).
- Short founder summary:
  The system is safer than it was a week ago, but the main remaining risk is still "we probably committed the record, then our error handling deleted or misreported the artifact anyway." Lead conversion looks solid. The priority tonight is fixing destructive cleanup after ambiguous signature finalization errors.

## 2. Atomicity Violations

### Critical: Destructive cleanup still runs after ambiguous finalize-RPC failures

- Workflow name: public POF signing, public care plan caregiver signing, intake nurse/admin signing, care plan nurse signing, and enrollment packet completion
- Exact files/functions/modules:
  - [`lib/services/pof-esign-public.ts`](/D:/Memory%20Lane%20App/lib/services/pof-esign-public.ts) `submitPublicPofSignature`
  - [`lib/services/care-plan-esign-public.ts`](/D:/Memory%20Lane%20App/lib/services/care-plan-esign-public.ts) `submitPublicCarePlanSignature`
  - [`lib/services/intake-assessment-esign.ts`](/D:/Memory%20Lane%20App/lib/services/intake-assessment-esign.ts) `signIntakeAssessment`
  - [`lib/services/care-plan-nurse-esign.ts`](/D:/Memory%20Lane%20App/lib/services/care-plan-nurse-esign.ts) `signCarePlanNurseEsign`
  - [`lib/services/enrollment-packets-public-runtime.ts`](/D:/Memory%20Lane%20App/lib/services/enrollment-packets-public-runtime.ts) `submitPublicEnrollmentPacket`
  - Relevant migrations: [`supabase/migrations/0052_intake_assessment_signature_finalize_rpc.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0052_intake_assessment_signature_finalize_rpc.sql), [`supabase/migrations/0053_artifact_drift_replay_hardening.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0053_artifact_drift_replay_hardening.sql)
- What should happen:
  If the RPC might already have committed, the app should reload canonical state first and only delete artifacts when it can prove the commit did not happen.
- What currently happens:
  These flows upload signature/PDF artifacts before the final RPC. If the RPC throws, the catch path immediately deletes the staged artifacts. The same pattern exists in enrollment packet completion, which cleans staged uploads on any caught completion error.
- How partial failure could occur:
  If Supabase commits the RPC but the client sees a timeout, transport error, or late response parse failure, the cleanup code can delete files that the committed row now references. That creates database/storage drift and can also turn a valid signed record into a broken download.
- Recommended fix:
  Replace destructive "cleanup on any RPC error" with a committed-state verification pass. Reload the canonical request/assessment/care plan/packet row and its linked file identifiers first. Only delete artifacts when the row still proves the finalize step did not commit. Reuse the verification-pending pattern already used in [`lib/services/member-files.ts`](/D:/Memory%20Lane%20App/lib/services/member-files.ts).
- Blocks launch: Yes

### Medium: Intake and enrollment packet still complete in two stages by design

- Workflow name: intake -> draft POF/member-file handoff and enrollment packet completion -> downstream mapping
- Exact files/functions/modules:
  - [`app/intake-actions.ts`](/D:/Memory%20Lane%20App/app/intake-actions.ts)
  - [`lib/services/intake-pof-mhp-cascade.ts`](/D:/Memory%20Lane%20App/lib/services/intake-pof-mhp-cascade.ts)
  - [`lib/services/enrollment-packets-public-runtime.ts`](/D:/Memory%20Lane%20App/lib/services/enrollment-packets-public-runtime.ts)
  - [`lib/services/enrollment-packet-completion-cascade.ts`](/D:/Memory%20Lane%20App/lib/services/enrollment-packet-completion-cascade.ts)
- What should happen:
  The business should treat "complete" and "operationally ready" as either one atomic boundary or two clearly different persisted states.
- What currently happens:
  The code now does the safer version of this: it commits the first stage, then explicitly marks readiness as pending/failed when the second stage does not finish.
- How partial failure could occur:
  A signed intake can exist without a usable draft POF or member-file PDF. A filed enrollment packet can exist without completed MCC/MHP/attendance setup.
- Recommended fix:
  Keep the explicit staged statuses, but make sure staff-facing pages never collapse them into "done." Longer term, move more of the first-pass downstream setup into shared transactional RPC boundaries where that is realistic.
- Blocks launch: No, because the states are now explicit and auditable

## 3. Consistency Gaps

### High: Care plan replay still under-reports unfinished post-sign follow-up

- Affected schema/business rule:
  "Already signed" should still reflect real post-sign readiness.
- Exact files/migrations/services involved:
  - [`lib/services/care-plan-esign-public.ts`](/D:/Memory%20Lane%20App/lib/services/care-plan-esign-public.ts)
  - [`lib/services/care-plan-model.ts`](/D:/Memory%20Lane%20App/lib/services/care-plan-model.ts)
  - [`lib/services/care-plans-read-model.ts`](/D:/Memory%20Lane%20App/lib/services/care-plans-read-model.ts)
- What invariant is not enforced:
  On the replay-safe `wasAlreadySigned` path, the public care plan signer gets `actionNeeded: false` immediately, without checking whether `post_sign_readiness_status` is still blocked.
- Why it matters:
  If the original signature committed but readiness follow-up failed, a caregiver reopening the same link can see a clean completion result while staff still has unresolved downstream work. That hides real operational state.
- Recommended DB/service fix:
  Mirror the POF pattern. Add a `loadPublicCarePlanPostSignOutcome` helper that derives the result from persisted readiness state, then use it on both normal and replay paths.
- Blocks launch: No, but it is a real correctness gap

### Medium: Enrollment packet operational readiness is still mostly service-derived, not schema-enforced

- Affected schema/business rule:
  A packet should only be "operationally ready" when downstream mapping, shell creation, and completed artifact persistence all exist.
- Exact files/migrations/services involved:
  - [`lib/services/enrollment-packet-completion-cascade.ts`](/D:/Memory%20Lane%20App/lib/services/enrollment-packet-completion-cascade.ts)
  - [`lib/services/enrollment-packet-public-helpers.ts`](/D:/Memory%20Lane%20App/lib/services/enrollment-packet-public-helpers.ts)
  - [`app/sign/enrollment-packet/[token]/actions.ts`](/D:/Memory%20Lane%20App/app/sign/enrollment-packet/%5Btoken%5D/actions.ts)
- What invariant is not enforced:
  The database does not itself guarantee that a "completed/filed" packet also has finished MHP/MCC/attendance shells and synced lead activity.
- Why it matters:
  The app compensates with readiness statuses, but the truth still depends on service code running correctly and on downstream jobs finishing.
- Recommended DB/service fix:
  Keep the current explicit readiness status, but add nightly drift checks that query for completed packets missing completed artifacts, mapping completion, or operational shells, and alert on any mismatch.
- Blocks launch: No

## 4. Isolation Risks

### High: Timeout/retry scenarios can still race with destructive cleanup

- Workflow name: all finalize-and-upload signature flows
- Concurrency/replay scenario:
  A user submits once, the RPC actually commits, the browser sees an error, and the user retries or refreshes while cleanup from the first attempt has already started deleting staged files.
- Exact files/functions involved:
  - [`lib/services/pof-esign-public.ts`](/D:/Memory%20Lane%20App/lib/services/pof-esign-public.ts)
  - [`lib/services/care-plan-esign-public.ts`](/D:/Memory%20Lane%20App/lib/services/care-plan-esign-public.ts)
  - [`lib/services/intake-assessment-esign.ts`](/D:/Memory%20Lane%20App/lib/services/intake-assessment-esign.ts)
  - [`lib/services/care-plan-nurse-esign.ts`](/D:/Memory%20Lane%20App/lib/services/care-plan-nurse-esign.ts)
  - [`lib/services/enrollment-packets-public-runtime.ts`](/D:/Memory%20Lane%20App/lib/services/enrollment-packets-public-runtime.ts)
- What duplicate/conflicting state could happen:
  The database can say "signed/filed," while storage cleanup from the failed request removes the files that should prove it.
- Recommended protection:
  Make the finalize catch path replay-aware: verify committed state first, then skip cleanup and return a committed/replay result when the database already advanced.
- Blocks launch: Yes

### Medium: Public enrollment packet guard throttling is safer than most public flows, but still not transactional with submit execution

- Workflow name: public enrollment packet submission and uploads
- Concurrency/replay scenario:
  Two submits can pass the recent-event guard window at nearly the same time before the final RPC consumes the token.
- Exact files/functions involved:
  - [`lib/services/enrollment-packet-public-helpers.ts`](/D:/Memory%20Lane%20App/lib/services/enrollment-packet-public-helpers.ts)
  - [`lib/services/enrollment-packets-public-runtime.ts`](/D:/Memory%20Lane%20App/lib/services/enrollment-packets-public-runtime.ts)
- What duplicate/conflicting state could happen:
  The final RPC should still prevent a second durable completion, but the pre-finalize artifact work can be duplicated and then cleaned up.
- Recommended protection:
  Keep the current guards, but move toward a single submission attempt root persisted before artifact staging, so retries and concurrent submits share one canonical attempt record.
- Blocks launch: No

## 5. Durability Risks

### Critical: Finalize-path cleanup can destroy the files that prove a committed signature or filing

- Workflow name: POF, care plan caregiver, care plan nurse, intake signature, enrollment packet completion
- Exact files/functions involved:
  - [`lib/services/pof-esign-public.ts`](/D:/Memory%20Lane%20App/lib/services/pof-esign-public.ts)
  - [`lib/services/care-plan-esign-public.ts`](/D:/Memory%20Lane%20App/lib/services/care-plan-esign-public.ts)
  - [`lib/services/care-plan-nurse-esign.ts`](/D:/Memory%20Lane%20App/lib/services/care-plan-nurse-esign.ts)
  - [`lib/services/intake-assessment-esign.ts`](/D:/Memory%20Lane%20App/lib/services/intake-assessment-esign.ts)
  - [`lib/services/enrollment-packets-public-runtime.ts`](/D:/Memory%20Lane%20App/lib/services/enrollment-packets-public-runtime.ts)
- What success currently means:
  The RPC is intended to be the durable commit boundary.
- What may fail underneath:
  A transport or response error after the database commits can still land in cleanup code that deletes the just-uploaded artifacts.
- Why that is unsafe:
  This is the clearest remaining "false failure plus real data drift" pattern in the codebase.
- Recommended correction:
  Stop deleting artifacts until committed-state verification says the finalize RPC definitely did not commit.
- Blocks launch: Yes

### High: POF and enrollment packet downstream durability still depends on real retry-runner health

- Workflow name: signed POF -> MHP/MCC/MAR cascade and enrollment packet filed -> mapping cascade
- Exact files/functions involved:
  - [`app/api/internal/pof-post-sign-sync/route.ts`](/D:/Memory%20Lane%20App/app/api/internal/pof-post-sign-sync/route.ts)
  - [`lib/services/pof-post-sign-runtime.ts`](/D:/Memory%20Lane%20App/lib/services/pof-post-sign-runtime.ts)
  - [`lib/services/physician-orders-supabase.ts`](/D:/Memory%20Lane%20App/lib/services/physician-orders-supabase.ts)
  - [`app/api/internal/enrollment-packet-mapping-sync/route.ts`](/D:/Memory%20Lane%20App/app/api/internal/enrollment-packet-mapping-sync/route.ts)
  - [`vercel.json`](/D:/Memory%20Lane%20App/vercel.json)
- What success currently means:
  The first write commits and the system either finishes the sync immediately or queues it for retry.
- What may fail underneath:
  If cron auth, secrets, or route execution break in production, packets/orders can sit in retry-needed states indefinitely.
- Why that is unsafe:
  The data is at least explicit about being queued, but real operational completion still depends on infrastructure health outside the transaction itself.
- Recommended correction:
  Keep the existing queues, but raise missing-config alerts for enrollment mapping the same way POF already does, and add active dashboard/alerting for aged queued rows.
- Blocks launch: No, but it remains a real production-ops dependency

### High: Intake and care plan nurse signing still let telemetry failures surface as if the signature itself failed

- Workflow name: intake nurse/admin signing and care plan nurse signing
- Exact files/functions involved:
  - [`lib/services/intake-assessment-esign.ts`](/D:/Memory%20Lane%20App/lib/services/intake-assessment-esign.ts)
  - [`lib/services/care-plan-nurse-esign.ts`](/D:/Memory%20Lane%20App/lib/services/care-plan-nurse-esign.ts)
- What success currently means:
  The signature row is committed by RPC.
- What may fail underneath:
  Post-commit event/milestone logging is still awaited in the same user-visible path. If logging fails, callers can see an error even though the signature itself is already durable.
- Why that is unsafe:
  Staff can retry a workflow that already committed, creating confusion and support noise. Replay safety helps, but the user-facing truth is still wrong.
- Recommended correction:
  Make post-commit workflow event/milestone writes best-effort, with alert-backed logging on failure instead of throwing back to the caller.
- Blocks launch: No, but it should be fixed soon

## 6. ACID Hardening Plan

1. Fix the destructive finalize-error cleanup pattern across all signature and enrollment finalize flows.
2. Make intake and care plan nurse post-commit telemetry best-effort instead of user-blocking.
3. Make care plan replay return persisted post-sign readiness, not just caregiver signature status.
4. Add enrollment mapping runner missing-config alerts and aged-queue alerting parity with the POF runner.
5. Keep moving first-pass downstream setup into canonical RPC boundaries where practical, but preserve explicit staged readiness where full atomicity is not realistic.

## 7. Suggested Codex Prompts

### Prompt 1: Fix destructive cleanup after ambiguous finalize errors

`Audit and fix the finalize-error cleanup pattern in Memory Lane signature flows. Target lib/services/pof-esign-public.ts, lib/services/care-plan-esign-public.ts, lib/services/intake-assessment-esign.ts, lib/services/care-plan-nurse-esign.ts, and lib/services/enrollment-packets-public-runtime.ts. Preserve current replay-safe behavior, but stop deleting staged storage/member-file artifacts on any finalize RPC error unless the code first proves the finalize RPC did not commit. Reuse the verification-pending style from lib/services/member-files.ts where possible. Return a small, production-safe patch and call out any remaining ambiguous cases.`

### Prompt 2: Make post-commit telemetry best-effort

`Patch Memory Lane so intake signature and care plan nurse signature do not surface user-visible failure after the RPC already committed. Target lib/services/intake-assessment-esign.ts and lib/services/care-plan-nurse-esign.ts. Keep workflow/audit logging, but move it to best-effort handling with system alerts instead of throwing back to the caller after commit. Explain downstream effect on support and retries.`

### Prompt 3: Fix care plan replay truth

`Fix the public care plan caregiver replay path so already-signed links still return the real post-sign readiness outcome. Target lib/services/care-plan-esign-public.ts and any shared read model/helpers needed. Mirror the POF post-sign outcome pattern: if the signature was already committed, return actionNeeded/actionNeededMessage based on persisted readiness state instead of always returning false/null. Keep the patch small and production-safe.`

### Prompt 4: Harden queued downstream runners

`Harden Memory Lane queued downstream follow-up observability for signed POF sync and enrollment packet mapping. Review app/api/internal/pof-post-sign-sync/route.ts, app/api/internal/enrollment-packet-mapping-sync/route.ts, lib/services/pof-post-sign-runtime.ts, and related queue readers. Add missing-config alerts for enrollment mapping, improve aged-queue visibility, and summarize what still depends on real Vercel cron/secrets.`

## 8. Fix First Tonight

1. Stop deleting artifacts on ambiguous finalize RPC errors.
2. Make intake and care plan nurse post-commit telemetry best-effort.
3. Fix care plan replay so it reflects real readiness.
4. Add enrollment mapping missing-config alerts.

## 9. Automate Later

1. Nightly drift audit: signed/filed records whose referenced storage objects are missing.
2. Nightly queued-work audit: POF post-sign queue and enrollment mapping queue rows older than SLA.
3. Replay regression tests for public token flows after timeout/transport failure.
4. A focused ACID regression suite for signature finalization paths and staged readiness paths.

## 10. Founder Summary: What changed since the last run

- One new committed change landed after the March 31 morning audit: commit `7e140e0` "Add search-first member and lead pickers to cut broad preloads." It does not touch the core ACID-sensitive workflows in this audit.
- The current working tree has local attendance, billing, lookup, and MHP lookup changes, including untracked migrations [`supabase/migrations/0172_mhp_directory_normalized_lookup_rpcs.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0172_mhp_directory_normalized_lookup_rpcs.sql) and [`supabase/migrations/0173_billing_invoice_snapshot_itemization.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0173_billing_invoice_snapshot_itemization.sql). None of those local changes changed tonight's top ACID finding.
- The March 31 top concern is still the real top concern today: finalize-path cleanup can still delete artifacts after an ambiguous post-commit error in several signature/filed workflows.
- The prior member-file durability blocker still looks closed. I did not find a new regression in shared member-file persistence.
- Lead conversion still looks strong and did not pick up a new confirmed ACID regression in this run.
