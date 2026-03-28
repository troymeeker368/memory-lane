# Memory Lane ACID Transaction Audit - 2026-03-28

## 1. Executive Summary

- Overall ACID safety rating: 8.1/10
- Overall verdict: Partial
- Top 5 ACID risks:
  1. Public care plan signing now has a new post-commit durability regression: after the caregiver signature RPC commits, a later readiness update can still throw and trigger artifact cleanup on already-committed files.
  2. Signed POF downstream sync still depends on the post-sign queue runner being configured and monitored in production.
  3. Enrollment packet filing is still a staged workflow: the packet can be durably filed before MCC/MHP/POF downstream mapping finishes.
  4. Intake signing is still staged: draft POF creation and Intake PDF save to Member Files still happen after the signed intake commit.
  5. Care plan create/review/sign still uses explicit post-sign readiness states because snapshot history and caregiver dispatch are not part of the first nurse-sign commit.
- Strongest workflows:
  - Lead -> member conversion is stronger than the last run. It now keeps member shell creation inside the canonical SQL path and refuses to return success if required operational shells are missing.
  - Public POF and enrollment packet token flows still have real replay protection with consumed-token hashes and replay-safe return behavior.
  - Member-file delete remains materially safer than earlier runs because storage cleanup now happens before the DB row is removed.
- Short founder summary:
  - The repo improved again today.
  - The intake false-negative from yesterday is now materially fixed, lead conversion is stronger, and the care plan caregiver status RPC is tighter.
  - The main new problem is a care plan public-signing regression: a caregiver can successfully sign, but a later follow-up update can still turn that into a user-visible failure and clean up files that were already committed.

## 2. Atomicity Violations

### Finding A1
- Severity: High
- Workflow: Care plan caregiver public signature -> final signed file -> post-sign readiness
- Exact files/functions/modules:
  - `D:\Memory Lane App\lib\services\care-plan-esign-public.ts` - `submitPublicCarePlanSignature`
  - `D:\Memory Lane App\lib\services\care-plan-esign-public.ts` - `cleanupFailedCarePlanCaregiverArtifacts`
  - `D:\Memory Lane App\lib\services\care-plan-esign-public.ts` - `markCarePlanPostSignReady`
  - `D:\Memory Lane App\supabase\migrations\0053_artifact_drift_replay_hardening.sql` - `rpc_finalize_care_plan_caregiver_signature`
- What should happen:
  - Once the caregiver finalization RPC commits the signed state and final member file, every later step must be best-effort only.
  - No post-commit failure should delete already-committed signature artifacts or tell the caregiver the signature failed.
- What currently happens:
  - The public flow uploads the signature artifact, uploads the final signed PDF, calls the caregiver finalization RPC, logs events, and then updates `post_sign_readiness_status` to `ready`.
  - That entire sequence is still inside one outer `try/catch`.
- How partial failure could occur:
  - If `markCarePlanPostSignReady` throws after the RPC has already committed, the catch still runs cleanup and deletes the signature/PDF storage objects.
  - The caregiver can see an error even though the signature was already committed in Supabase.
  - Evidence: `care-plan-esign-public.ts:422-557`, `care-plan-esign-public.ts:261-305`, `0053_artifact_drift_replay_hardening.sql:452-554`
- Recommended fix:
  - Narrow cleanup so it only wraps pre-finalization work.
  - After `rpc_finalize_care_plan_caregiver_signature` succeeds, treat readiness and telemetry as post-commit best-effort steps that can alert but must not clean up committed artifacts or throw a false failure to the caregiver.
  - Best clean fix: move the readiness update into the finalization RPC or into a separate idempotent post-commit branch that never performs cleanup.
- Blocks launch: Yes

### Finding A2
- Severity: High
- Workflow: POF signed -> MHP/MCC/MAR cascade
- Exact files/functions/modules:
  - `D:\Memory Lane App\lib\services\pof-esign-public.ts` - `submitPublicPofSignature`
  - `D:\Memory Lane App\lib\services\pof-post-sign-runtime.ts` - `runBestEffortCommittedPofSignatureFollowUp`
  - `D:\Memory Lane App\lib\services\physician-orders-supabase.ts` - `processSignedPhysicianOrderPostSignSync`
  - `D:\Memory Lane App\app\api\internal\pof-post-sign-sync\route.ts`
  - `D:\Memory Lane App\supabase\migrations\0155_signed_pof_post_sign_sync_rpc_consolidation.sql`
- What should happen:
  - A signed POF should either finish downstream clinical sync immediately or remain in an explicitly monitored queued state with a healthy retry worker.
- What currently happens:
  - Signature finalization commits first.
  - The downstream sync now runs through a consolidated RPC boundary, which is better than the last run, but retries still depend on the queue runner endpoint being configured and actually invoked.
- How partial failure could occur:
  - A legally signed physician order can exist while MHP, MCC, or MAR schedules are still stale.
  - Evidence: `pof-esign-public.ts:324-408`, `pof-post-sign-runtime.ts:144-280`, `physician-orders-supabase.ts:563-775`, `route.ts:17-47`, `0155_signed_pof_post_sign_sync_rpc_consolidation.sql:26-103`
- Recommended fix:
  - Treat the queue runner as production-critical infrastructure.
  - Block deploy readiness if `POF_POST_SIGN_SYNC_SECRET` or `CRON_SECRET` is not configured and monitored.
- Blocks launch: Yes, if the real environment does not have the runner configured and watched

### Finding A3
- Severity: Medium
- Workflow: Enrollment packet completion -> filing -> downstream mapping cascade
- Exact files/functions/modules:
  - `D:\Memory Lane App\lib\services\enrollment-packets-public-runtime.ts`
  - `D:\Memory Lane App\lib\services\enrollment-packet-completion-cascade.ts`
  - `D:\Memory Lane App\supabase\migrations\0152_enrollment_packet_lifecycle_and_voiding.sql` - `rpc_finalize_enrollment_packet_submission`
- What should happen:
  - Filing should either complete all downstream operational handoff or return a clearly committed "filed but follow-up required" result.
- What currently happens:
  - The caregiver submission is durably filed first.
  - Downstream mapping then runs as a second-stage cascade and can mark the packet as needing staff follow-up.
- How partial failure could occur:
  - MCC/MHP/POF downstream state can still lag even though the packet is already filed.
  - Evidence: `enrollment-packets-public-runtime.ts:810-1073`, `enrollment-packet-completion-cascade.ts:344-421`, `0152_enrollment_packet_lifecycle_and_voiding.sql:478-616`
- Recommended fix:
  - Keep the current committed success path, but keep staff-facing dashboards anchored to operational readiness, not just `status=filed`.
- Blocks launch: No

### Finding A4
- Severity: Medium
- Workflow: Intake sign -> draft POF -> Intake PDF to Member Files
- Exact files/functions/modules:
  - `D:\Memory Lane App\app\intake-actions.ts`
  - `D:\Memory Lane App\lib\services\physician-orders-supabase.ts` - `createDraftPhysicianOrderFromAssessment`
  - `D:\Memory Lane App\lib\services\intake-post-sign-follow-up.ts`
  - `D:\Memory Lane App\supabase\migrations\0055_intake_draft_pof_atomic_creation.sql`
- What should happen:
  - Signed intake should be treated as operationally complete only after draft POF creation and Member Files persistence finish.
- What currently happens:
  - The intake signature commit lands first.
  - Draft POF creation and Intake PDF save still happen afterward.
  - The false-negative status from yesterday is materially fixed, but the workflow is still intentionally staged.
- How partial failure could occur:
  - Intake can be signed while clinical/document follow-up is still open.
  - Evidence: `intake-actions.ts:320-390`, `physician-orders-supabase.ts:382-430`, `0055_intake_draft_pof_atomic_creation.sql:1-159`
- Recommended fix:
  - Keep the current staged readiness model, but continue treating `post_sign_ready` as the real operational completion signal.
- Blocks launch: No

### Finding A5
- Severity: Medium
- Workflow: Care plan nurse sign -> snapshot history -> caregiver dispatch
- Exact files/functions/modules:
  - `D:\Memory Lane App\lib\services\care-plans-supabase.ts`
  - `D:\Memory Lane App\lib\services\care-plan-nurse-esign.ts`
  - `D:\Memory Lane App\supabase\migrations\0053_artifact_drift_replay_hardening.sql`
  - `D:\Memory Lane App\supabase\migrations\0112_care_plan_post_sign_readiness.sql`
- What should happen:
  - Signed care plans should be read as fully operational only after version snapshot history and caregiver dispatch are durably in place.
- What currently happens:
  - Nurse signature lands first.
  - The system then explicitly sets `signed_pending_snapshot` or `signed_pending_caregiver_dispatch` until later steps finish.
- How partial failure could occur:
  - A nurse-signed care plan can exist while version history or caregiver send still needs repair.
  - Evidence: `care-plan-nurse-esign.ts:267-327`, `care-plans-supabase.ts:337-365`, `care-plans-supabase.ts:488-490`, `care-plans-supabase.ts:674-676`, `0053_artifact_drift_replay_hardening.sql:558-805`
- Recommended fix:
  - Keep the staged model, but continue converging toward one canonical post-sign readiness read model everywhere the platform surfaces care plan completion.
- Blocks launch: No

## 3. Consistency Gaps

### Finding C1
- Severity: High
- Affected schema/business rule:
  - A care plan can become `caregiver_signature_status='signed'` while `post_sign_readiness_status` is still stale and the public action throws a failure.
- Exact files/migrations/services involved:
  - `D:\Memory Lane App\lib\services\care-plan-esign-public.ts`
  - `D:\Memory Lane App\supabase\migrations\0053_artifact_drift_replay_hardening.sql`
  - `D:\Memory Lane App\supabase\migrations\0112_care_plan_post_sign_readiness.sql`
- What invariant is not enforced:
  - "Caregiver signed" and "post-sign readiness is updated without cleanup drift" is not enforced in one durable boundary.
- Why it matters:
  - Staff and caregivers can get contradictory truth: the legal signature is committed, but the workflow still behaves like it failed.
- Recommended DB/service fix:
  - Make the readiness transition part of the caregiver finalization RPC, or make the post-RPC readiness write best-effort and non-destructive.
- Blocks launch: Yes

### Finding C2
- Severity: Medium
- Affected schema/business rule:
  - Signed POF status still does not itself guarantee downstream MHP/MCC/MAR sync is complete.
- Exact files/migrations/services involved:
  - `D:\Memory Lane App\lib\services\physician-orders-supabase.ts`
  - `D:\Memory Lane App\lib\services\pof-post-sign-runtime.ts`
  - `D:\Memory Lane App\app\api\internal\pof-post-sign-sync\route.ts`
  - `D:\Memory Lane App\supabase\migrations\0155_signed_pof_post_sign_sync_rpc_consolidation.sql`
- What invariant is not enforced:
  - "Signed POF" and "downstream clinical profile/MAR sync complete" are still separate truths.
- Why it matters:
  - Downstream clinical screens can lag a legally signed order if the queue runner is unhealthy.
- Recommended DB/service fix:
  - Keep the queue, but make production readiness checks explicitly verify queue health and aged-queue alerting.
- Blocks launch: No, if the runner and alerting are healthy

### Finding C3
- Severity: Medium
- Affected schema/business rule:
  - Enrollment packet `filed/completed` status still does not mean downstream mapping is operationally complete.
- Exact files/migrations/services involved:
  - `D:\Memory Lane App\lib\services\enrollment-packets-public-runtime.ts`
  - `D:\Memory Lane App\lib\services\enrollment-packet-completion-cascade.ts`
  - `D:\Memory Lane App\supabase\migrations\0152_enrollment_packet_lifecycle_and_voiding.sql`
- What invariant is not enforced:
  - "Filed packet" and "operationally ready enrollment handoff" are still distinct.
- Why it matters:
  - Staff could treat filing as the final handoff even while downstream systems still need repair.
- Recommended DB/service fix:
  - Continue surfacing a canonical operational readiness view in packet listing/detail pages so staff do not infer completion from `status` alone.
- Blocks launch: No

## 4. Isolation Risks

### Finding I1
- Severity: Medium
- Workflow name: Care plan caregiver public signing
- Concurrency/replay scenario:
  - The caregiver finalization RPC commits, but a later readiness write fails. Concurrent readers can then observe `signed` while post-sign readiness remains stale, and the public caller receives a failure.
- Exact files/functions involved:
  - `D:\Memory Lane App\lib\services\care-plan-esign-public.ts` - `submitPublicCarePlanSignature`
- What duplicate/conflicting state could happen:
  - Signed care plan status, stale readiness status, and cleaned-up storage artifacts can temporarily diverge.
- Recommended protection:
  - Move readiness advancement into the same SQL finalization boundary or make the later write best-effort-only with no cleanup.
- Blocks launch: Yes

### Finding I2
- Severity: Medium
- Workflow name: Enrollment packet filed -> downstream mapping
- Concurrency/replay scenario:
  - Filing commits first, so staff or downstream readers can act on the packet before the second-stage mapping cascade finishes.
- Exact files/functions involved:
  - `D:\Memory Lane App\lib\services\enrollment-packets-public-runtime.ts`
  - `D:\Memory Lane App\lib\services\enrollment-packet-completion-cascade.ts`
- What duplicate/conflicting state could happen:
  - The packet can be treated as done while MCC/MHP/POF handoff is still running or waiting on repair.
- Recommended protection:
  - Keep using replay-safe filing, but gate downstream staff actions on operational readiness rather than packet filed status alone.
- Blocks launch: No

### Finding I3
- Severity: Low
- Workflow name: Intake sign -> draft POF verification
- Concurrency/replay scenario:
  - A committed draft POF can exist before immediate readback verifies it, so different readers may temporarily see different readiness interpretations.
- Exact files/functions involved:
  - `D:\Memory Lane App\app\intake-actions.ts`
  - `D:\Memory Lane App\lib\services\physician-orders-supabase.ts`
- What duplicate/conflicting state could happen:
  - Staff may see "follow-up required" while the draft already exists.
- Recommended protection:
  - The current `CommittedDraftPhysicianOrderReloadError` handling is the right direction; keep that dedicated "verification follow-up" distinction and avoid collapsing it back into failure.
- Blocks launch: No

## 5. Durability Risks

### Finding D1
- Severity: High
- Workflow name: Public care plan caregiver signature
- Exact files/functions involved:
  - `D:\Memory Lane App\lib\services\care-plan-esign-public.ts` - `submitPublicCarePlanSignature`
  - `D:\Memory Lane App\lib\services\care-plan-esign-public.ts` - `cleanupFailedCarePlanCaregiverArtifacts`
- What success currently means:
  - The caregiver signature RPC has already committed signed state and final member-file metadata.
- What may fail underneath:
  - The later readiness write can still throw, and the catch can still remove storage artifacts after commit.
- Why that is unsafe:
  - This is exactly the kind of false-success/false-failure mix that healthcare workflows should avoid.
- Recommended correction:
  - Make every post-RPC step non-destructive and best-effort.
- Blocks launch: Yes

### Finding D2
- Severity: High
- Workflow name: POF signed -> post-sign queue
- Exact files/functions involved:
  - `D:\Memory Lane App\app\api\internal\pof-post-sign-sync\route.ts`
  - `D:\Memory Lane App\lib\services\physician-order-post-sign-runtime.ts`
  - `D:\Memory Lane App\lib\services\physician-orders-supabase.ts`
- What success currently means:
  - The signed POF is durably committed.
- What may fail underneath:
  - The runner may never pick up queued clinical sync if config or monitoring is missing.
- Why that is unsafe:
  - Downstream MAR/MHP/MCC truth can lag the legal source order.
- Recommended correction:
  - Add deployment-time queue-runner validation and aged-queue alert ownership.
- Blocks launch: Yes, if queue infrastructure is not healthy

### Finding D3
- Severity: Medium
- Workflow name: Enrollment packet filed -> downstream mapping
- Exact files/functions involved:
  - `D:\Memory Lane App\lib\services\enrollment-packets-public-runtime.ts`
  - `D:\Memory Lane App\lib\services\enrollment-packet-completion-cascade.ts`
- What success currently means:
  - The packet is durably filed and the caregiver is placed on the confirmation path.
- What may fail underneath:
  - Mapping to downstream operational systems can still fail and require staff repair.
- Why that is unsafe:
  - Filing alone is not enough for operational truth.
- Recommended correction:
  - Keep the success path, but ensure staff dashboards and alerts treat mapping readiness as the real downstream completion signal.
- Blocks launch: No

## 6. ACID Hardening Plan

1. Fix the new care plan public-signing regression first.
   - Split pre-finalization cleanup from post-finalization follow-up.
   - Never delete artifacts or throw a caregiver-facing failure after the finalization RPC commits.
2. Treat signed POF queue health as release-blocking infra.
   - Verify runner config, retry execution, and aged-queue alerting in production.
3. Keep staff-facing readiness models stronger than raw workflow status.
   - Enrollment packets: do not treat `filed` alone as downstream completion.
   - Intake: keep dedicated "verification follow-up" vs true failure.
   - Care plans: keep `post_sign_readiness_status` authoritative for operational completion.
4. Keep high-risk multi-step workflows converging toward one durable SQL boundary when possible.
   - Especially care plan caregiver signing and any future post-sign readiness writes.

## 7. Suggested Codex Prompts

### Prompt 1
Audit and fix the public care plan caregiver signature flow in `D:\Memory Lane App\lib\services\care-plan-esign-public.ts`.

Problem:
- `submitPublicCarePlanSignature` now calls `markCarePlanPostSignReady` after `rpc_finalize_care_plan_caregiver_signature`.
- That post-commit step is still inside the outer `try/catch`.
- If it throws, the catch runs `cleanupFailedCarePlanCaregiverArtifacts`, which can delete storage objects after the signature RPC already committed.
- This can produce a false caregiver-facing failure and post-commit storage drift.

What to do:
- Refactor the flow so cleanup only applies before finalization commits.
- After the finalization RPC succeeds, treat readiness/event failures as best-effort only.
- If the readiness update is required, move it into the same canonical SQL finalization boundary or make it an idempotent post-commit step that only alerts.
- Preserve replay safety and consumed-token behavior.

Validation:
- Confirm the caregiver never sees a failure after a committed signature.
- Confirm committed artifacts are never cleaned up after finalization succeeds.
- Run `npm run typecheck`.

### Prompt 2
Harden release readiness for the signed POF post-sign sync runner.

Scope:
- `D:\Memory Lane App\app\api\internal\pof-post-sign-sync\route.ts`
- `D:\Memory Lane App\lib\services\physician-order-post-sign-runtime.ts`
- related deployment/runtime checks

Goal:
- Make it impossible to treat production as healthy if the POF post-sign sync runner is not configured or not being monitored.

What to do:
- Add an explicit health/readiness check or startup/runtime guard that surfaces missing runner config clearly.
- Keep aged-queue alerts actionable.
- Avoid changing the committed signed-POF flow itself unless necessary.

Validation:
- Run `npm run typecheck`.
- Show the exact operator-facing error or alert path for missing config.

### Prompt 3
Review care plan post-sign readiness updates and make them deterministic across nurse sign, caregiver send, and caregiver sign flows.

Scope:
- `D:\Memory Lane App\lib\services\care-plans-supabase.ts`
- `D:\Memory Lane App\lib\services\care-plan-nurse-esign.ts`
- `D:\Memory Lane App\lib\services\care-plan-esign.ts`
- `D:\Memory Lane App\lib\services\care-plan-esign-public.ts`

Goal:
- Reduce contradictory states like signed care plans that are still not operationally ready.

What to do:
- Map every readiness transition to one canonical service contract.
- Preserve the staged model where necessary, but remove any non-idempotent or cleanup-prone post-commit behavior.
- Flag any readiness write that should really be inside an RPC boundary.

Validation:
- Run `npm run typecheck`.
- Summarize the exact readiness states and who/what advances each one.

### Prompt 4
Do a focused founder-safe audit of enrollment packet filed status versus downstream operational readiness.

Scope:
- `D:\Memory Lane App\lib\services\enrollment-packets-public-runtime.ts`
- `D:\Memory Lane App\lib\services\enrollment-packet-completion-cascade.ts`
- related listing/detail read models

Goal:
- Make sure staff cannot mistake `filed` for fully-ready MCC/MHP/POF downstream completion.

What to do:
- Identify where UI or reporting might still over-trust packet status.
- Prefer the smallest production-safe fix: better readiness labeling or stronger read-model truth.

Validation:
- Run `npm run typecheck`.
- List any screens that still need readiness wording changes.

## 8. Fix First Tonight

- Remove post-commit cleanup from the public care plan caregiver signature path.
- Verify production POF post-sign runner config and aged-queue alert ownership.
- Keep the intake fix as-is and do not regress the new `signed_pending_draft_pof_readback` handling.

## 9. Automate Later

- Add a focused regression test that proves a care plan caregiver signature cannot surface a failure after finalization succeeds.
- Add an automated deployment check for missing POF post-sign runner secrets/config.
- Add a recurring audit that flags workflows where a post-commit catch still performs destructive cleanup.
- Add a read-model audit that compares raw workflow status versus operational readiness for intake, enrollment packet, POF, and care plan flows.

## 10. Founder Summary: What changed since the last run

- Improved:
  - Intake false-negative drift is materially better now.
  - `D:\Memory Lane App\app\intake-actions.ts` and `D:\Memory Lane App\lib\services\physician-orders-supabase.ts` now distinguish "draft POF create failed" from "draft POF committed but immediate reload failed."
  - That closes yesterday’s biggest intake consistency concern.
- Improved:
  - Lead -> member conversion is stronger now.
  - `0156_lead_conversion_wrapper_shell_assertions.sql` and `0158_lead_conversion_shell_success_guard.sql` make the canonical conversion path refuse success unless required operational shells are present inside the SQL boundary.
- Improved:
  - Signed POF post-sign sync is cleaner than yesterday.
  - `0155_signed_pof_post_sign_sync_rpc_consolidation.sql` collapses the first-pass downstream sync into one shared RPC boundary, which reduces split-step drift inside the immediate sync attempt.
- Improved:
  - Care plan caregiver status handling is tighter now.
  - `0160_care_plan_caregiver_status_rpc_ambiguity_fix.sql` hardens the caregiver status RPC, and `lib/services/care-plan-esign.ts` now asserts sent-state finalization readiness more explicitly before email send.
- New concern:
  - A new care plan public-signing durability risk appeared after the last run.
  - Commit `67ae615` added `markCarePlanPostSignReady` to `lib/services/care-plan-esign-public.ts` after caregiver finalization.
  - Because that write still lives inside the same outer `try/catch`, a failure after the finalization RPC can now trigger artifact cleanup on already-committed files and surface a false failure to the caregiver.
  - This should move to the top of tonight’s fix list.
