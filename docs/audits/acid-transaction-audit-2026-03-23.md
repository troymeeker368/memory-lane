# Memory Lane ACID Transaction Audit

Date: 2026-03-23

## 1. Executive Summary

- Overall ACID safety rating: 7.8/10
- Overall verdict: Partial
- Top 5 ACID risks:
  - Signed intake still commits before draft POF creation and intake PDF persistence finish.
  - Enrollment packet filing is still a staged workflow, so filing can complete before downstream mapping and lead-activity follow-up finish.
  - Enrollment packet retry runs still have no claim step, so overlapping runners can repeat the same retry work.
  - Scheduled MAR documentation still relies on app-side read-then-insert instead of one replay-safe RPC path.
  - Member-file delete is safer than before, but storage cleanup can still fail after the DB row is removed.
- Strongest workflows:
  - Lead -> member conversion now runs through shared RPC with optional post-commit logging instead of required logging.
  - POF public open/sign flow remains materially hardened with compare-and-set open protection, replay-safe token handling, and claim-based post-sign retry processing.
  - Care plan caregiver public-link transitions are materially improved by the new compare-and-set and terminal-status hardening.
  - Enrollment packet downstream mapping is much safer than last run because contact/payor writes now live inside the shared conversion RPC and readiness status is exposed back to the UI.
- Short founder summary:
  - I did not reconfirm yesterday's care-plan launch blocker. The biggest remaining issues tonight are mostly staged-workflow risks and retry-orchestration gaps, not silent corruption paths.

## 2. Atomicity Violations

### Finding A1
- Severity: Medium
- Workflow name: Intake signed -> draft POF + intake PDF persistence
- Exact files/functions/modules:
  - `app/intake-actions.ts` -> `createAssessmentAction`
  - `app/(portal)/health/assessment/[assessmentId]/actions.ts` -> `retryAssessmentDraftPofAction`, `generateAssessmentPdfAction`
  - `lib/services/intake-post-sign-follow-up.ts`
  - `supabase/migrations/0106_enrollment_atomicity_and_intake_follow_up_queue.sql`
  - `supabase/migrations/0055_intake_draft_pof_atomic_creation.sql`
- What should happen:
  - Once staff sees a signed intake as clinically complete, the required downstream draft POF and intake PDF persistence should also be durably complete, or the workflow should expose a canonical pending-follow-up state.
- What currently happens:
  - Signature finalization commits first.
  - Draft POF creation and intake PDF save happen afterward in app code.
  - If either follow-up step fails, the system queues a repair task and returns an explicit error.
- How partial failure could occur:
  - A signed intake can exist without its draft POF or without its PDF in Member Files until staff resolves the queued follow-up task.
- Recommended fix:
  - Keep the current queue, but add one canonical post-sign completion state for intake, such as `signed_pending_follow_up` vs `signed_ready_for_downstream`, and make downstream screens use that state.
- Blocks launch: No

### Finding A2
- Severity: Medium
- Workflow name: Enrollment packet completion -> downstream mapping
- Exact files/functions/modules:
  - `lib/services/enrollment-packets-public-runtime.ts` -> `submitPublicEnrollmentPacket`
  - `lib/services/enrollment-packet-mapping-runtime.ts` -> `runEnrollmentPacketDownstreamMapping`
  - `lib/services/enrollment-packet-follow-up.ts`
  - `supabase/migrations/0106_enrollment_atomicity_and_intake_follow_up_queue.sql`
  - `supabase/migrations/0110_enrollment_packet_follow_up_queue.sql`
- What should happen:
  - Operational consumers should only treat a filed packet as ready when downstream mapping and required follow-up writes are durably complete.
- What currently happens:
  - Filing commits first.
  - Downstream mapping and lead-activity sync happen afterward.
  - The workflow now exposes `mappingSyncStatus`, `operationalReadinessStatus`, and action-needed messaging instead of pretending it is fully done.
- How partial failure could occur:
  - A packet can be safely filed while downstream mapping is still pending or failed.
- Recommended fix:
  - Keep the staged design, but make every downstream consumer block on `operationalReadinessStatus === operationally_ready` instead of treating `filed` as the whole truth.
- Blocks launch: No

## 3. Consistency Gaps

### Finding C1
- Severity: Medium
- Affected schema/business rule:
  - Public enrollment packet structured answers should fail explicitly if the submitted JSON payload is malformed.
- Exact files/migrations/services involved:
  - `app/sign/enrollment-packet/[token]/actions.ts` -> `parseIntakePayload`
  - `lib/services/enrollment-packets-public-runtime.ts` -> `savePublicEnrollmentPacketProgress`
- What invariant is not enforced:
  - Invalid structured intake payloads are silently normalized to an empty payload instead of being rejected.
- Why it matters:
  - A client bug or malformed submission can quietly drop caregiver-entered structured answers instead of surfacing an explicit failure.
- Recommended DB/service fix:
  - Reject malformed JSON at the action layer and log a guard failure, rather than converting it to `{}`.
- Blocks launch: No

### Finding C2
- Severity: Low
- Affected schema/business rule:
  - Scheduled MAR documentation should have one canonical replay-safe write path.
- Exact files/migrations/services involved:
  - `lib/services/mar-workflow.ts` -> `documentScheduledMarAdministration`
  - `supabase/migrations/0028_pof_seeded_mar_workflow.sql`
- What invariant is not enforced:
  - The canonical duplicate guard exists in the DB unique index on `mar_schedule_id`, but the app still does a separate read-before-insert flow instead of one RPC.
- Why it matters:
  - Data corruption is prevented, but the workflow still relies on a race-prone app pattern and turns duplicate clicks into error handling instead of replay-safe reuse.
- Recommended DB/service fix:
  - Add a small RPC or `upsert`-style write path that returns the existing administration row when the dose is already documented.
- Blocks launch: No

## 4. Isolation Risks

### Finding I1
- Severity: Medium
- Workflow name: Enrollment packet mapping retry runner
- Concurrency/replay scenario:
  - Two manual or cron-triggered retry calls run at the same time against the same failed packet.
- Exact files/functions involved:
  - `app/api/internal/enrollment-packet-mapping-sync/route.ts`
  - `lib/services/enrollment-packet-mapping-runtime.ts` -> `retryFailedEnrollmentPacketMappings`
  - `supabase/migrations/0106_enrollment_atomicity_and_intake_follow_up_queue.sql` -> `convert_enrollment_packet_to_member`
- What duplicate/conflicting state could happen:
  - The shared conversion RPC row lock prevents most duplicate downstream writes, but overlapping runners can still do redundant retry work and duplicate success/failure telemetry around the same packet.
- Recommended protection:
  - Add an enrollment-packet retry claim RPC, matching the POF post-sign claim pattern already used in `rpc_claim_pof_post_sign_sync_queue`.
- Blocks launch: No

### Finding I2
- Severity: Low
- Workflow name: Scheduled MAR dose documentation
- Concurrency/replay scenario:
  - Two staff members document the same scheduled dose at nearly the same time.
- Exact files/functions involved:
  - `lib/services/mar-workflow.ts` -> `documentScheduledMarAdministration`
  - `supabase/migrations/0028_pof_seeded_mar_workflow.sql`
- What duplicate/conflicting state could happen:
  - The unique index stops double writes, but one caller still loses with an exception instead of the workflow being replay-safe by design.
- Recommended protection:
  - Move the scheduled-dose write into a canonical RPC that treats "already documented" as a safe replay outcome.
- Blocks launch: No

## 5. Durability Risks

### Finding D1
- Severity: Low
- Workflow name: Member-file delete
- Exact files/functions involved:
  - `lib/services/member-files.ts` -> `deleteMemberFileRecordAndStorage`
- What success currently means:
  - The DB row is deleted first, then storage cleanup runs second.
- What may fail underneath:
  - Storage deletion can still fail after the row is already gone.
- Why that is unsafe:
  - This no longer creates broken DB references, but it can leave orphaned files in storage that require cleanup.
- Recommended correction:
  - Add a small reconciliation job that scans for orphaned storage objects and clears them nightly.
- Blocks launch: No

### Finding D2
- Severity: Medium
- Workflow name: Signed intake follow-up durability
- Exact files/functions involved:
  - `app/intake-actions.ts` -> `createAssessmentAction`
  - `lib/services/intake-post-sign-follow-up.ts`
  - `app/(portal)/health/assessment/[assessmentId]/actions.ts`
- What success currently means:
  - Intake signature success means the signature is durable, but not necessarily that all required downstream onboarding artifacts are durable.
- What may fail underneath:
  - Draft POF creation and intake PDF persistence can still fail and move into follow-up queue state.
- Why that is unsafe:
  - Staff can have a real signed intake while clinical onboarding still requires repair work.
- Recommended correction:
  - Add a canonical readiness field so the rest of the platform distinguishes "signed" from "signed and downstream-complete."
- Blocks launch: No

## 6. ACID Hardening Plan

1. Add a canonical readiness state for signed intake workflows so downstream modules stop using signature alone as the completion truth.
2. Add a claim RPC for enrollment packet retry processing to remove redundant concurrent retry work.
3. Convert scheduled MAR dose documentation into a replay-safe RPC path that returns existing committed rows instead of relying on a unique-index exception.
4. Reject malformed public enrollment packet `intakePayload` JSON instead of silently defaulting to an empty payload.
5. Add nightly orphan-storage cleanup for member documents.

## 7. Suggested Codex Prompts

### Prompt 1
Implement a production-safe hardening pass for Memory Lane intake post-sign completion. Add one canonical readiness field or resolver so a signed intake is not treated as operationally complete until both draft POF creation and intake PDF persistence are complete or explicitly resolved from the follow-up queue. Reuse existing intake follow-up queue patterns. Do not add mock data or parallel write paths. Show changed files, schema impact, and manual retest steps.

### Prompt 2
Implement a claim-based retry path for failed enrollment packet downstream mapping in Memory Lane. Mirror the POF post-sign retry claim pattern so overlapping cron/manual runner calls do not process the same failed packet at the same time. Use Supabase RPC for the claim step, keep enrollment packet requests as the source of truth, and preserve current readiness/mapping status behavior. Include migration, service updates, and manual retest steps.

### Prompt 3
Implement a replay-safe canonical write path for scheduled MAR administration in Memory Lane. Replace the current read-then-insert flow with a small Supabase RPC that either creates the administration once or returns the already-committed row for the same `mar_schedule_id`. Preserve the current uniqueness guarantees, audit/event behavior, and user-facing responses. Include migration, service/action updates, and manual retest steps.

### Prompt 4
Harden the public enrollment packet submit action so malformed `intakePayload` JSON fails explicitly instead of silently defaulting to an empty payload. Keep the public link guard behavior, log a clear guard failure, and make sure staff do not lose structured caregiver answers silently. Show the smallest clean fix and manual retest steps.

## 8. Fix First Tonight

- Reject malformed public enrollment packet `intakePayload` JSON.
- Add a claim step for enrollment packet mapping retries.
- Add one canonical intake readiness state for "signed but follow-up still required."

## 9. Automate Later

- Nightly orphaned member-document storage sweep.
- Concurrency regression test for overlapping enrollment packet mapping retry calls.
- Regression test that a signed intake with queued follow-up is not shown as downstream-complete.
- Regression test that scheduled MAR duplicate submission returns a replay-safe result instead of surfacing a raw uniqueness failure.

## 10. Founder Summary: What changed since the last run

- Yesterday's top launch blocker is materially improved: care-plan caregiver public-link transitions now have compare-and-set and terminal-status hardening in the live code (`0111` and `0118` plus current `care-plan-esign` services). I did not reconfirm the old stale-read rollback risk tonight.
- POF hardening from prior runs is still holding: public open compare-and-set, replay-safe token handling, and claim-based post-sign retry processing are all still present.
- Enrollment packet mapping remains materially safer than the earlier baseline: contact/payor writes stay inside the shared conversion RPC, readiness status still reaches the UI, and the follow-up queue exists for repair work.
- The biggest remaining issues are now staged completion and retry orchestration, not the older false-success and duplicate-write patterns.
- Current findings reflect a dirty working tree, including local modifications in `lib/services/care-plan-esign.ts`, so this audit is against the actual in-progress local code rather than a perfectly clean branch.
