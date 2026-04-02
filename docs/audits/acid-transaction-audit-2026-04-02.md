# Memory Lane ACID Transaction Audit

Date: 2026-04-02

## 1. Executive Summary

- Overall ACID safety rating: 7.4/10
- Overall verdict: Partial, but materially stronger than the 2026-04-01 run
- Top 5 ACID risks:
  1. Public care plan signing can still show the caregiver a failure after the signature already committed if the post-sign readiness update fails in [`lib/services/care-plan-esign-public.ts`](/D:/Memory%20Lane%20App/lib/services/care-plan-esign-public.ts).
  2. Intake and care plan nurse signature flows still let post-commit event logging bubble back as if the signature itself failed in [`lib/services/intake-assessment-esign.ts`](/D:/Memory%20Lane%20App/lib/services/intake-assessment-esign.ts) and [`lib/services/care-plan-nurse-esign.ts`](/D:/Memory%20Lane%20App/lib/services/care-plan-nurse-esign.ts).
  3. Signed POF and completed enrollment packet downstream sync are still durable only if their retry runners are configured and watched in production; enrollment packet runner observability is still behind the POF runner in [`app/api/internal/enrollment-packet-mapping-sync/route.ts`](/D:/Memory%20Lane%20App/app/api/internal/enrollment-packet-mapping-sync/route.ts) and [`app/api/internal/pof-post-sign-sync/route.ts`](/D:/Memory%20Lane%20App/app/api/internal/pof-post-sign-sync/route.ts).
  4. Intake and enrollment packet workflows are still intentionally staged, so "signed" or "filed" is not the same thing as "operationally ready" in [`lib/services/intake-pof-mhp-cascade.ts`](/D:/Memory%20Lane%20App/lib/services/intake-pof-mhp-cascade.ts) and [`lib/services/enrollment-packets-public-runtime.ts`](/D:/Memory%20Lane%20App/lib/services/enrollment-packets-public-runtime.ts).
  5. Operational shell completeness for MCC, attendance, and MHP is still a service-level invariant plus repair/audit path, not a hard schema guarantee, even though the runtime now fails explicitly in [`lib/services/member-command-center-runtime.ts`](/D:/Memory%20Lane%20App/lib/services/member-command-center-runtime.ts).
- Strongest workflows:
  - Lead -> member conversion remains one of the strongest paths because it stays inside the canonical RPC boundary and uses deterministic idempotency roots in [`lib/services/sales-lead-conversion-supabase.ts`](/D:/Memory%20Lane%20App/lib/services/sales-lead-conversion-supabase.ts).
  - POF public signing is materially safer than yesterday because finalize-error cleanup now verifies committed state first before deleting anything in [`lib/services/pof-esign-public.ts`](/D:/Memory%20Lane%20App/lib/services/pof-esign-public.ts) and migration [`supabase/migrations/0053_artifact_drift_replay_hardening.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0053_artifact_drift_replay_hardening.sql).
  - Shared member-file persistence still looks solid after the March fixes; verification-pending handling is still present in [`lib/services/member-files.ts`](/D:/Memory%20Lane%20App/lib/services/member-files.ts).
  - MAR PRN documentation still looks replay-safe because the write path is RPC-backed and idempotent in [`lib/services/mar-prn-workflow.ts`](/D:/Memory%20Lane%20App/lib/services/mar-prn-workflow.ts).
- Short founder summary:
  The biggest April 1 launch-blocking concern is mostly closed. The system no longer appears to be deleting artifacts on ambiguous finalize errors across most of the critical signing/filed workflows. The remaining issues are now mostly "false failure after commit" and "runner health / observability" problems rather than direct data-destruction patterns.

## 2. Atomicity Violations

### Medium: Intake signature still finishes in two durable stages

- Severity: Medium
- Workflow name: intake -> draft POF generation -> intake PDF member-file save
- Exact files/functions/modules:
  - [`lib/services/intake-pof-mhp-cascade.ts`](/D:/Memory%20Lane%20App/lib/services/intake-pof-mhp-cascade.ts) `completeIntakeAssessmentPostSignWorkflow`
  - [`app/intake-actions.ts`](/D:/Memory%20Lane%20App/app/intake-actions.ts)
- What should happen:
  Either the entire intake handoff should finish as one durable boundary, or the product should clearly persist that the signature succeeded while follow-up work is still pending.
- What currently happens:
  The signature commits first. Draft POF creation and intake-PDF member-file save run afterward. When either second-stage step fails, the code now persists explicit follow-up status and action-needed messaging instead of pretending the whole workflow is complete.
- How partial failure could occur:
  A signed intake can still exist without a verified draft POF or without the branded intake PDF saved to member files.
- Recommended fix:
  Keep the current explicit staged statuses. Longer term, move only the smallest realistic first-pass work into a shared transactional boundary and keep the rest as explicit queued follow-up.
- Blocks launch: No

### Medium: POF and enrollment packet downstream cascades are still explicit queue-backed second stages

- Severity: Medium
- Workflow name: POF signed -> MHP/MCC/MAR cascade and enrollment packet filed -> mapping / operational shell cascade
- Exact files/functions/modules:
  - [`lib/services/physician-orders-supabase.ts`](/D:/Memory%20Lane%20App/lib/services/physician-orders-supabase.ts) `processSignedPhysicianOrderPostSignSync`
  - [`app/api/internal/pof-post-sign-sync/route.ts`](/D:/Memory%20Lane%20App/app/api/internal/pof-post-sign-sync/route.ts)
  - [`lib/services/enrollment-packets-public-runtime.ts`](/D:/Memory%20Lane%20App/lib/services/enrollment-packets-public-runtime.ts) `submitPublicEnrollmentPacket`
  - [`lib/services/enrollment-packet-completion-cascade.ts`](/D:/Memory%20Lane%20App/lib/services/enrollment-packet-completion-cascade.ts)
  - Relevant migration: [`supabase/migrations/0174_pof_post_sign_queue_outcome_rpc.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0174_pof_post_sign_queue_outcome_rpc.sql)
- What should happen:
  The first durable commit should either complete the downstream sync or persist an explicit queued/pending state that operations can trust.
- What currently happens:
  The first write is durable, and downstream work is explicitly tracked as synced, queued, failed, or action-needed. That is safer than silent drift, but it is still not one atomic unit.
- How partial failure could occur:
  A signed POF or completed packet can exist before downstream clinical/operational consumers are fully updated.
- Recommended fix:
  Keep the current explicit staged statuses. Improve queue health visibility and tighten first-pass sync where practical, but do not hide the staged model.
- Blocks launch: No

## 3. Consistency Gaps

### Medium: Operational shell completeness is still not structurally enforced by schema

- Severity: Medium
- Affected schema/business rule:
  A converted/enrolled member should have the downstream operational shells needed for Member Command Center, attendance, and MHP.
- Exact files/migrations/services involved:
  - [`lib/services/member-command-center-runtime.ts`](/D:/Memory%20Lane%20App/lib/services/member-command-center-runtime.ts)
  - [`lib/services/enrollment-packet-completion-cascade.ts`](/D:/Memory%20Lane%20App/lib/services/enrollment-packet-completion-cascade.ts)
  - [`lib/services/sales-lead-conversion-supabase.ts`](/D:/Memory%20Lane%20App/lib/services/sales-lead-conversion-supabase.ts)
- What invariant is not enforced:
  The database still does not hard-guarantee that every canonical member has MCC, attendance, and MHP shells before downstream reads happen.
- Why it matters:
  The runtime is now safer because it fails loudly instead of papering over drift. But this is still a service-level promise plus repair path, not a structural database guarantee.
- Recommended DB/service fix:
  Keep the new explicit runtime failure. Add a nightly shell-drift report and keep historical repair separate from read-time behavior. If feasible later, push shell assertions deeper into the canonical conversion/completion write boundaries.
- Blocks launch: No

### Medium: Staged readiness is still mostly service truth, not schema truth

- Severity: Medium
- Affected schema/business rule:
  Signed/filed workflows should not be mistaken for operationally ready workflows.
- Exact files/migrations/services involved:
  - [`lib/services/intake-pof-mhp-cascade.ts`](/D:/Memory%20Lane%20App/lib/services/intake-pof-mhp-cascade.ts)
  - [`lib/services/enrollment-packet-readiness.ts`](/D:/Memory%20Lane%20App/lib/services/enrollment-packet-readiness.ts)
  - [`lib/services/care-plan-post-sign-readiness.ts`](/D:/Memory%20Lane%20App/lib/services/care-plan-post-sign-readiness.ts)
  - [`lib/services/enrollment-packets-public-runtime.ts`](/D:/Memory%20Lane%20App/lib/services/enrollment-packets-public-runtime.ts)
- What invariant is not enforced:
  Schema does not itself stop staff from conceptually treating signed/filed records as "done" before readiness reaches the ready state.
- Why it matters:
  The code now exposes readiness better than before, but the distinction still relies on services and UI honoring the canonical readiness fields.
- Recommended DB/service fix:
  Keep using explicit readiness statuses and add a simple nightly drift query for rows stuck in pending/failed readiness beyond an SLA.
- Blocks launch: No

## 4. Isolation Risks

### Medium: Public enrollment packet submits can still duplicate pre-finalize work before the replay-safe boundary wins

- Severity: Medium
- Workflow name: public token submission and upload flows for enrollment packets
- Concurrency/replay scenario:
  Two submits arrive close together before the final RPC consumes the token and settles the canonical filed state.
- Exact files/functions involved:
  - [`lib/services/enrollment-packet-public-helpers.ts`](/D:/Memory%20Lane%20App/lib/services/enrollment-packet-public-helpers.ts)
  - [`lib/services/enrollment-packets-public-runtime.ts`](/D:/Memory%20Lane%20App/lib/services/enrollment-packets-public-runtime.ts)
- What duplicate/conflicting state could happen:
  The final filed state should still dedupe correctly, but pre-finalize artifact staging can still happen more than once before replay cleanup wins.
- Recommended protection:
  Persist a single canonical submission-attempt root before artifact staging so concurrent requests share one attempt identity instead of racing to create the same pre-finalize uploads.
- Blocks launch: No

### Low: Caregiver retry after a false post-commit error can still cause operational confusion

- Severity: Low
- Workflow name: public care plan caregiver signing
- Concurrency/replay scenario:
  The caregiver signs once, the DB commit succeeds, post-sign readiness update fails, and the caregiver retries because they saw an error.
- Exact files/functions involved:
  - [`lib/services/care-plan-esign-public.ts`](/D:/Memory%20Lane%20App/lib/services/care-plan-esign-public.ts)
- What duplicate/conflicting state could happen:
  Replay safety should prevent a duplicate canonical signature, but the caregiver and staff can still disagree about whether the original signature "worked."
- Recommended protection:
  Return a committed-with-action-needed result after post-commit failures instead of throwing a hard failure to the caregiver.
- Blocks launch: No

## 5. Durability Risks

### High: Public care plan signing still throws after the signature is already committed if follow-up readiness fails

- Severity: High
- Workflow name: care plan finalize/sign workflow
- Exact files/functions involved:
  - [`lib/services/care-plan-esign-public.ts`](/D:/Memory%20Lane%20App/lib/services/care-plan-esign-public.ts) `submitPublicCarePlanSignature`
- What success currently means:
  The caregiver signature RPC committed, the final signed file exists, and the care plan row can already be in its committed signed state.
- What may fail underneath:
  `markCarePlanPostSignReadyWorkflow(...)` or the readiness verification immediately after it can fail, and the code still throws the error back to the caller.
- Why that is unsafe:
  The caregiver can see a failure even though the core signature is already durable. That is not data corruption, but it is still false user-visible truth on a public workflow.
- Recommended correction:
  Mirror the safer POF pattern. Keep the alert, but return a committed result with `actionNeeded: true` and a clear follow-up message instead of throwing.
- Blocks launch: No

### High: Intake and care plan nurse signatures still let post-commit telemetry masquerade as signature failure

- Severity: High
- Workflow name: intake finalize/sign workflow and care plan nurse finalize/sign workflow
- Exact files/functions involved:
  - [`lib/services/intake-assessment-esign.ts`](/D:/Memory%20Lane%20App/lib/services/intake-assessment-esign.ts) `signIntakeAssessment`
  - [`lib/services/care-plan-nurse-esign.ts`](/D:/Memory%20Lane%20App/lib/services/care-plan-nurse-esign.ts) `signCarePlanNurseEsign`
- What success currently means:
  The finalize RPC committed and the signature artifact/member-file references are durable.
- What may fail underneath:
  `recordWorkflowEvent(...)` and related milestone logging still run inline after commit. If those logging calls fail, the outer catch marks the workflow as failed and returns an error.
- Why that is unsafe:
  Staff can be told the signature failed even though it already committed. That encourages confusing retries and hides the real root problem, which is post-commit observability failure rather than signature failure.
- Recommended correction:
  Make the post-commit event/milestone writes best-effort, log/alert on failure, and always return the committed signature state once the finalize RPC succeeded.
- Blocks launch: No

### Medium: Enrollment packet mapping runner observability still lags behind the POF runner

- Severity: Medium
- Workflow name: completed enrollment packet -> downstream mapping / follow-up queue
- Exact files/functions involved:
  - [`app/api/internal/enrollment-packet-mapping-sync/route.ts`](/D:/Memory%20Lane%20App/app/api/internal/enrollment-packet-mapping-sync/route.ts)
  - [`lib/services/enrollment-packet-mapping-runtime.ts`](/D:/Memory%20Lane%20App/lib/services/enrollment-packet-mapping-runtime.ts)
  - Comparison reference: [`app/api/internal/pof-post-sign-sync/route.ts`](/D:/Memory%20Lane%20App/app/api/internal/pof-post-sign-sync/route.ts)
- What success currently means:
  The packet completion is durable and the mapping retry runner is expected to pick up failed/pending downstream sync.
- What may fail underneath:
  If the enrollment mapping runner is never configured, there is no matching missing-config alert or health/aged-queue response at the route boundary like there is for the POF runner.
- Why that is unsafe:
  Completed packets can sit in a retry-needed state longer than they should before anyone realizes the retry worker itself is unavailable.
- Recommended correction:
  Add missing-config alerts, a health mode, and aged-queue alert parity to the enrollment packet mapping runner.
- Blocks launch: No

## 6. ACID Hardening Plan

1. Fix the public care plan post-commit false-failure path so caregiver signatures return committed-with-action-needed instead of throwing after commit.
2. Make intake and care plan nurse post-commit workflow events and milestones best-effort.
3. Add enrollment packet mapping runner observability parity with the POF runner.
4. Keep staged readiness explicit and add a simple nightly report for rows stuck pending/failed beyond SLA.
5. Continue hardening shell completeness by auditing for members missing MCC, attendance, or MHP shells and repairing drift outside read paths.

## 7. Suggested Codex Prompts

### Prompt 1: Stop false caregiver-facing failure after committed care plan sign

`Audit and patch lib/services/care-plan-esign-public.ts so submitPublicCarePlanSignature no longer throws a caregiver-facing error after the signature and final file already committed. Keep the alerting, but return a committed result with actionNeeded/actionNeededMessage when markCarePlanPostSignReadyWorkflow or readiness verification fails after commit. Preserve replay-safe behavior and do not reintroduce artifact cleanup on ambiguous finalize outcomes.`

### Prompt 2: Make intake and care plan nurse post-commit telemetry best-effort

`Patch lib/services/intake-assessment-esign.ts and lib/services/care-plan-nurse-esign.ts so post-commit workflow event/milestone logging cannot make a committed signature look failed. Once the finalize RPC succeeds, return the committed state and downgrade later observability failures to alert-backed console/error logging. Keep the patch small and production-safe.`

### Prompt 3: Add enrollment mapping runner health and missing-config alerts

`Harden app/api/internal/enrollment-packet-mapping-sync/route.ts to match the operational safety of app/api/internal/pof-post-sign-sync/route.ts. Add missing-config system alerts, a health mode, and aged-queue alerting support using lib/services/enrollment-packet-mapping-runtime.ts. Explain what this changes downstream for enrollment packet completion durability.`

### Prompt 4: Add a nightly staged-readiness drift audit

`Create a founder-readable drift audit for Memory Lane staged workflows. Focus on signed intake rows with open draft-POF/member-file follow-up, completed enrollment packets with mapping_sync_status != completed or missing operational shells, and care plans with post_sign_readiness_status != ready. Use canonical Supabase reads only and output a plain-English markdown report in docs/audits/.`

## 8. Fix First Tonight

1. Make public care plan caregiver signing return committed-with-action-needed instead of hard failure after post-sign follow-up errors.
2. Make intake signature and care plan nurse signature telemetry best-effort after finalize commit.
3. Add enrollment packet mapping runner missing-config alerts and health/aged-queue visibility.
4. Add a simple nightly stuck-readiness report for intake, enrollment packets, and care plans.

## 9. Automate Later

1. Nightly audit: signed/filed rows whose readiness has stayed pending/failed beyond SLA.
2. Nightly audit: POF and enrollment packet retry queues older than SLA.
3. Nightly audit: members missing MCC, attendance, or MHP shells after canonical conversion/completion.
4. Timeout/replay regression tests for public token signing and upload flows.
5. A focused ACID regression suite for "commit succeeded but post-commit follow-up/logging failed" cases.

## 10. Founder Summary: What changed since the last run

- The April 1 top blocker looks materially improved. POF, intake, care plan nurse, and enrollment packet finalize paths now verify committed state before cleanup and only delete staged artifacts when the write can be proven not committed. That is the biggest positive change in this run.
- Care plan replay truth improved. Already-signed caregiver links now check post-sign readiness and can surface that follow-up is still incomplete instead of always pretending everything is clean.
- Intake post-sign handling is clearer. Draft POF readback misses and member-file verification misses now stay explicit follow-up work in one shared post-sign workflow instead of blending into a generic failure.
- POF queue durability/observability is stronger. The new queue-outcome RPC in [`supabase/migrations/0174_pof_post_sign_queue_outcome_rpc.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0174_pof_post_sign_queue_outcome_rpc.sql) plus the POF runner health/aged-queue route make signed-POF follow-up easier to monitor.
- Shell drift is less hidden than before. Member Command Center reads now fail explicitly and point to the historical repair flow instead of silently relying on read-time backfill.
- No new confirmed launch-blocking ACID regression was found in the requested workflows during this run.
- The main remaining issues are now false-failure and operations-visibility gaps, not the artifact-deleting finalize cleanup pattern that was highest priority yesterday.
