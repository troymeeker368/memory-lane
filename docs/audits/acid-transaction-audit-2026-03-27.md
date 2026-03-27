# Memory Lane ACID Transaction Audit - 2026-03-27

## 1. Executive Summary

- Overall ACID safety rating: 7.8/10
- Overall verdict: Partial
- Top 5 ACID risks:
  1. Signed POF downstream sync still depends on the post-sign queue runner being configured and monitored in production.
  2. Intake signing is still a staged workflow; draft POF creation and Member Files PDF persistence happen after the first committed signature step.
  3. Intake can still mark `draft_pof_failed` even after the draft POF was already created if the immediate post-commit reload fails.
  4. Care plan create/review/sign still commits before snapshot history and caregiver dispatch are fully durable.
  5. Enrollment packet filing is now safer for the caregiver, but downstream MCC/MHP/POF mapping is still a second-stage repairable handoff after filing.
- Strongest workflows:
  - Lead -> member conversion remains one of the strongest paths. It stays on canonical RPC-backed conversion, locks the lead row, writes member shell rows in the transaction, and then repairs operational shell rows as follow-up hardening.
  - Public POF, care plan, and enrollment packet token flows still show real replay hardening with consumed-token hashes and replay-safe return paths.
  - Member-file delete is materially safer than yesterday: storage cleanup now happens before the database row is removed.
- Short founder summary:
  - The repo is safer than the last run.
  - The biggest improvements are that committed enrollment packet submissions no longer need to look like generic failures, member-file delete no longer leaves the database ahead of storage cleanup, and MAR audit-log failure no longer turns a committed MAR write into a user-visible error.
  - The main remaining risk is not "missing transactions everywhere." It is still the same healthcare-style problem of staged workflows: the legally important write commits first, then operational follow-up has to finish reliably afterward.

## 2. Atomicity Violations

### Finding A1
- Severity: High
- Workflow: Intake -> signed intake -> draft POF -> intake PDF to Member Files
- Exact files/functions/modules:
  - `D:\Memory Lane App\app\intake-actions.ts` - create assessment/sign flow
  - `D:\Memory Lane App\lib\services\physician-orders-supabase.ts` - `autoCreateDraftPhysicianOrderFromIntake`
  - `D:\Memory Lane App\supabase\migrations\0055_intake_draft_pof_atomic_creation.sql`
- What should happen:
  - Intake should be explicitly treated as "signed but not operationally complete" until draft POF creation and Member Files persistence are done.
- What currently happens:
  - The first signed intake commit succeeds, then draft POF creation and generated PDF persistence happen afterward.
  - If either later step fails, the intake remains committed and a follow-up task is queued.
- How partial failure could occur:
  - Staff can finish intake signing while downstream clinical/document work still needs repair.
  - Evidence: `app/intake-actions.ts:319-420`, `0055_intake_draft_pof_atomic_creation.sql:34-156`
- Recommended fix:
  - Keep the staged readiness model, but make the service contract consistently return "committed with follow-up required" instead of inferring completion from signed state alone.
- Blocks launch: No

### Finding A2
- Severity: Medium
- Workflow: Enrollment packet completion -> filing -> downstream mapping cascade
- Exact files/functions/modules:
  - `D:\Memory Lane App\app\sign\enrollment-packet\[token]\actions.ts`
  - `D:\Memory Lane App\lib\services\enrollment-packets-public-runtime.ts`
  - `D:\Memory Lane App\lib\services\enrollment-packet-completion-cascade.ts`
  - `D:\Memory Lane App\supabase\migrations\0053_artifact_drift_replay_hardening.sql`
- What should happen:
  - Filing should either finish all required downstream mapping or return a clearly committed "filed but follow-up required" result.
- What currently happens:
  - The packet is filed first, then mapping runs afterward.
  - If mapping is not operationally ready, the public flow now stays on the success path and redirects to confirmation with `follow-up-required`.
- How partial failure could occur:
  - The packet can be durably filed while MCC/MHP/POF mapping still needs repair.
  - Evidence: `enrollment-packets-public-runtime.ts:810-838,948-1010`, `enrollment-packet-completion-cascade.ts:368-419`, `actions.ts:359-375`
- Recommended fix:
  - Keep the current success-path UX improvement, but continue pushing toward one canonical "operationally ready" read model so staff do not treat `filed` alone as the handoff truth.
- Blocks launch: No

### Finding A3
- Severity: High
- Workflow: POF signed -> MHP/MCC/MAR cascade
- Exact files/functions/modules:
  - `D:\Memory Lane App\lib\services\pof-esign-public.ts`
  - `D:\Memory Lane App\lib\services\pof-post-sign-runtime.ts`
  - `D:\Memory Lane App\lib\services\physician-orders-supabase.ts`
  - `D:\Memory Lane App\app\api\internal\pof-post-sign-sync\route.ts`
- What should happen:
  - A signed POF should either complete clinical sync immediately or remain in an explicitly monitored queued state with a healthy retry worker.
- What currently happens:
  - Signature finalization commits first.
  - Downstream sync to MHP/MCC/MAR is retried through the queue when the cascade does not finish on the first pass.
- How partial failure could occur:
  - A legally signed physician order can exist while MAR and related clinical views are still stale.
  - Evidence: `pof-esign-public.ts:319-380`, `pof-post-sign-runtime.ts:57-68,144-279`, `physician-orders-supabase.ts:525-632`, `route.ts:17-47`
- Recommended fix:
  - Treat the queue runner as production-critical infrastructure and fail deployment readiness if the secret/config/alerting path is missing.
- Blocks launch: Yes, if the real environment does not have the runner configured and watched

### Finding A4
- Severity: Medium
- Workflow: Care plan create/review/sign -> snapshot history -> caregiver dispatch
- Exact files/functions/modules:
  - `D:\Memory Lane App\lib\services\care-plans-supabase.ts`
  - `D:\Memory Lane App\app\care-plan-actions.ts`
- What should happen:
  - A care plan should be treated as operationally complete only after snapshot history and caregiver dispatch finish durably.
- What currently happens:
  - Nurse/admin signature commits first.
  - Snapshot history and caregiver dispatch still happen afterward and can return a committed-but-follow-up-required state.
- How partial failure could occur:
  - A signed care plan can exist while version history or caregiver send still needs repair.
  - Evidence: `care-plans-supabase.ts:488-564,706-756,819-833`, `care-plan-actions.ts:117-127,225-233,300-308`
- Recommended fix:
  - Keep the current committed-state handling, but standardize one post-sign readiness contract across create, review, and sign flows.
- Blocks launch: No

## 3. Consistency Gaps

### Finding C1
- Severity: High
- Affected schema/business rule:
  - Intake can record `draft_pof_failed` even when the draft POF was already durably created.
- Exact files/migrations/services involved:
  - `D:\Memory Lane App\lib\services\physician-orders-supabase.ts`
  - `D:\Memory Lane App\app\intake-actions.ts`
  - `D:\Memory Lane App\supabase\migrations\0055_intake_draft_pof_atomic_creation.sql`
- What invariant is not enforced:
  - "Draft POF exists" and "intake draft_pof_status says created" can drift apart if the post-commit reload fails.
- Why it matters:
  - Staff can see a false failed status, queue unnecessary repair work, and potentially duplicate investigation even though the draft order already exists.
- Recommended DB/service fix:
  - Separate "RPC create failed" from "post-commit reload failed."
  - Do not write `draft_pof_failed` when the RPC already returned a durable `physician_order_id`.
- Blocks launch: No, but this is the cleanest consistency fix to take next

### Finding C2
- Severity: Medium
- Affected schema/business rule:
  - Signed/filed state is still not the same thing as operational readiness across intake, enrollment packet, POF post-sign sync, and care plan.
- Exact files/migrations/services involved:
  - `D:\Memory Lane App\app\intake-actions.ts`
  - `D:\Memory Lane App\lib\services\enrollment-packets-public-runtime.ts`
  - `D:\Memory Lane App\lib\services\pof-post-sign-runtime.ts`
  - `D:\Memory Lane App\lib\services\care-plans-supabase.ts`
  - `D:\Memory Lane App\lib\services\intake-post-sign-readiness.ts`
- What invariant is not enforced:
  - The database enforces important first-stage legal state, but operational completeness still depends on service-level readiness helpers and follow-up queues.
- Why it matters:
  - Staff can read a signed or filed status and assume the downstream workflow is done when it is not.
- Recommended DB/service fix:
  - Continue using readiness columns, but formalize one canonical "operationally ready" read contract per workflow and make all UI/actions read that instead of signed/filed alone.
- Blocks launch: No

### Finding C3
- Severity: Low
- Affected schema/business rule:
  - Enrollment packet rollout documentation is now behind the code.
- Exact files/migrations/services involved:
  - `D:\Memory Lane App\docs\workflow-hardening-rollout.md`
  - `D:\Memory Lane App\supabase\migrations\0053_artifact_drift_replay_hardening.sql`
  - `D:\Memory Lane App\app\sign\enrollment-packet\[token]\actions.ts`
- What invariant is not enforced:
  - The doc still says failed downstream mapping leaves the packet in `partially_completed`, but the current code/files packet first and tracks mapping with `mapping_sync_status`.
- Why it matters:
  - Manual ops validation can use the wrong expected state and mis-triage a real production handoff.
- Recommended DB/service fix:
  - Update the rollout doc and any staff playbooks so `filed + follow-up required` is the canonical current model.
- Blocks launch: No

## 4. Isolation Risks

### Finding I1
- Severity: Medium
- Workflow: Intake and enrollment packet manual follow-up repair work
- Concurrency/replay scenario:
  - A second staff member can reclaim a task after the 10-minute claim window expires while the first person is still working.
- Exact files/functions involved:
  - `D:\Memory Lane App\supabase\migrations\0128_intake_follow_up_retry_claims.sql`
  - `D:\Memory Lane App\lib\services\intake-post-sign-follow-up.ts`
  - `D:\Memory Lane App\lib\services\enrollment-packet-follow-up.ts`
- What duplicate/conflicting state could happen:
  - Two staff members can attempt the same repair path, which raises the chance of duplicated manual remediation or confusing queue state.
- Recommended protection:
  - Keep `FOR UPDATE SKIP LOCKED`, but surface claimant/age in the UI and re-check workflow readiness immediately before any repair write.
- Blocks launch: No

### Finding I2
- Severity: Low
- Workflow: Public token submission/sign flows
- Concurrency/replay scenario:
  - Caregiver/provider retries after a network hiccup or page refresh.
- Exact files/functions involved:
  - `D:\Memory Lane App\supabase\migrations\0053_artifact_drift_replay_hardening.sql`
  - `D:\Memory Lane App\supabase\migrations\0149_enrollment_packet_contact_replay_idempotency.sql`
  - `D:\Memory Lane App\lib\services\pof-esign-public.ts`
  - `D:\Memory Lane App\lib\services\care-plan-esign-public.ts`
  - `D:\Memory Lane App\lib\services\enrollment-packets-public-runtime.ts`
- What duplicate/conflicting state could happen:
  - No new critical replay regression was confirmed in this run.
  - These flows now mostly return replay-safe committed results instead of duplicating writes.
- Recommended protection:
  - Keep daily replay-audit coverage and treat any future regression in consumed-token handling as launch-blocking.
- Blocks launch: No

## 5. Durability Risks

### Finding D1
- Severity: High
- Workflow: POF post-sign sync durability
- Exact files/functions involved:
  - `D:\Memory Lane App\app\api\internal\pof-post-sign-sync\route.ts`
  - `D:\Memory Lane App\lib\services\physician-orders-supabase.ts`
  - `D:\Memory Lane App\lib\services\pof-post-sign-runtime.ts`
- What success currently means:
  - The signed POF is durable, but downstream sync may still be queued.
- What may fail underneath:
  - If the queue runner is not configured or not healthy, MHP/MCC/MAR can remain stale after signature.
- Why that is unsafe:
  - Clinical/operational staff may act on stale downstream data even though the legal signature step succeeded.
- Recommended correction:
  - Make runner configuration and stale-queue alerting part of release readiness, not optional follow-up.
- Blocks launch: Yes in the real environment if the runner is not configured

### Finding D2
- Severity: Medium
- Workflow: Care plan snapshot history and caregiver dispatch
- Exact files/functions involved:
  - `D:\Memory Lane App\lib\services\care-plans-supabase.ts`
  - `D:\Memory Lane App\app\care-plan-actions.ts`
- What success currently means:
  - The care plan and nurse/admin signature can already be committed while later version-history or caregiver-dispatch work still needs repair.
- What may fail underneath:
  - Snapshot persistence or caregiver dispatch can fail after the main record is already saved.
- Why that is unsafe:
  - The core plan is durable, but downstream auditability and caregiver handoff can lag behind.
- Recommended correction:
  - Keep the current committed-state handling and add aging alerts for plans that remain in post-sign follow-up too long.
- Blocks launch: No

### Finding D3
- Severity: Medium
- Workflow: Intake post-sign draft POF reload
- Exact files/functions involved:
  - `D:\Memory Lane App\lib\services\physician-orders-supabase.ts`
  - `D:\Memory Lane App\app\intake-actions.ts`
- What success currently means:
  - The RPC can already create the draft POF durably.
- What may fail underneath:
  - The immediate reload can fail, and the caller then records the intake as failed anyway.
- Why that is unsafe:
  - The system can store a real draft order while publishing the opposite operational truth.
- Recommended correction:
  - Treat this as a post-commit reload problem, not a draft-creation failure, and avoid downgrading the assessment status to `failed`.
- Blocks launch: No

## 6. ACID Hardening Plan

1. Fix the intake false-failure path so a post-commit reload miss cannot set `draft_pof_failed` after the draft already exists.
2. Verify the real deployment has the POF post-sign runner configured, authenticated, and alerting on aged queue rows.
3. Standardize one canonical "operationally ready" state contract per workflow and stop letting signed/filed imply readiness by accident.
4. Add aging/reconciliation checks for care plan post-sign follow-up and enrollment packet mapping follow-up.
5. Update rollout docs and founder/staff playbooks so current staged states match the live code.

## 7. Suggested Codex Prompts

1. `Audit and fix the intake draft POF false-failure path. In D:\\Memory Lane App, inspect app/intake-actions.ts and lib/services/physician-orders-supabase.ts. The RPC can already create a draft physician order, but if the immediate reload fails the code marks draft_pof_status = failed and queues follow-up anyway. Change this so post-commit reload failures do not publish a false failed state when the draft already exists. Preserve Supabase as source of truth, keep the canonical RPC boundary, keep action-needed visibility, and run typecheck when done.`

2. `Harden the POF post-sign runner as production-critical infrastructure. In D:\\Memory Lane App, inspect app/api/internal/pof-post-sign-sync/route.ts and the POF queue/readiness services. Add or tighten any missing health/aging visibility needed so signed POFs cannot sit silently queued without obvious staff/system alerts. Keep the existing queue model and do not introduce mock paths. Run typecheck when done.`

3. `Standardize committed-but-not-ready workflow responses across intake, enrollment packet, and care plan flows. In D:\\Memory Lane App, inspect app/intake-actions.ts, app/sign/enrollment-packet/[token]/actions.ts, app/care-plan-actions.ts, and the shared committed workflow state helpers. Make sure each action returns a consistent success shape when the core write is committed but downstream follow-up is still required. Preserve canonical services and existing readiness states. Run typecheck when done.`

4. `Update D:\\Memory Lane App\\docs\\workflow-hardening-rollout.md so it matches the live enrollment packet model. The current code files the packet first and tracks downstream mapping with mapping_sync_status plus follow-up-required handling, but the doc still describes a partially_completed expectation. Fix the doc to reflect current canonical behavior and validation steps.`

## 8. Fix First Tonight

- Fix the intake post-commit reload false-failure path. This is the smallest clean fix with the best accuracy payoff.
- Confirm `POF_POST_SIGN_SYNC_SECRET` or `CRON_SECRET` is configured in the real deployment and that the route is actually running on schedule.
- Update the rollout doc so ops/staff are checking the right enrollment packet states.

## 9. Automate Later

- Add a daily reconciliation that flags intake assessments with `draft_pof_status = failed` when a draft physician order already exists for the same assessment.
- Add an alert for enrollment packets stuck in `mapping_sync_status in ('pending','failed')` beyond an agreed SLA.
- Add an alert for care plans stuck in post-sign follow-up readiness too long after nurse/admin signature.
- Keep the daily replay audit over POF, care plan, and enrollment packet consumed-token paths.
- Keep a storage-vs-row reconciliation pass for legacy/orphaned member-file artifacts.

## 10. Founder Summary: What changed since the last run

- Improved: Member-file delete is safer now. `lib/services/member-files.ts` deletes storage before deleting the database row, which closes the specific orphan-risk finding from yesterday.
- Improved: MAR audit-log failures are now non-throwing after committed writes. `app/(portal)/health/mar/actions-impl.ts` logs and alerts instead of turning a committed MAR write into a user-visible failure.
- Improved: Enrollment packet public submission no longer needs to look like a generic failure after a committed filing. The public action now redirects to confirmation and marks follow-up-required on the success path, and a completed packet PDF can be downloaded from the confirmation flow.
- Newly confirmed: Intake still has one important false-failure path. If draft POF creation commits but the immediate reload fails, the assessment can still be marked `draft_pof_failed` anyway.
- Unchanged: POF signed -> MHP/MCC/MAR still depends on the queue runner being configured and monitored in the real environment.
