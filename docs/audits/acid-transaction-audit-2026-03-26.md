# Memory Lane ACID Transaction Audit - 2026-03-26

## 1. Executive Summary

- Overall ACID safety rating: 7.2/10
- Overall verdict: Partial
- Top 5 ACID risks:
  1. Intake signing still commits before draft POF creation and Member Files persistence fully complete.
  2. Enrollment packet filing still commits before downstream MCC/MHP/POF mapping is fully complete, and the public action can still surface this as a failure after the packet is already filed.
  3. Signed POF completion still depends on a second-stage queue/runner before MHP/MCC/MAR are fully current.
  4. Care plan create/review/sign still commits before snapshot history and caregiver dispatch fully finish.
  5. Member-file delete still removes the database row before storage cleanup, which can leave orphaned files.
- Strongest workflows:
  - Lead to member conversion is still one of the strongest workflows. It stays on canonical RPC-backed conversion plus follow-up member-shell repair, and non-critical audit logging is already treated as best-effort.
  - Public POF and care plan token flows have compare-and-set style state guards, which is a real improvement against replay and double-open/double-sign races.
  - Enrollment packet lineage is stronger than the last run. Packet child tables and linked member files now have enforced packet/member lineage in schema.
- Short founder summary:
  - The repo is materially safer than the earlier ACID audits, especially around lineage and replay handling.
  - The remaining problems are mostly not "missing transactions everywhere." The bigger issue now is staged workflows: the first legally important write succeeds, then second-stage operational work happens after that.
  - That is safer than fake success, but it still means some screens can say "error" even after the core record already committed.

## 2. Atomicity Violations

### Finding A1
- Severity: High
- Workflow: Intake -> signed intake -> draft POF -> intake PDF to Member Files
- Exact files/functions/modules:
  - `D:\Memory Lane App\app\intake-actions.ts` - `createAssessmentAction`
  - `D:\Memory Lane App\supabase\migrations\0052_intake_assessment_signature_finalize_rpc.sql`
  - `D:\Memory Lane App\supabase\migrations\0055_intake_draft_pof_atomic_creation.sql`
  - `D:\Memory Lane App\supabase\migrations\0128_intake_follow_up_retry_claims.sql`
- What should happen:
  - Intake create/sign should either leave the whole intake operationally complete, or clearly remain in a durable staged state without pretending the workflow fully finished.
- What currently happens:
  - Intake creation succeeds, then signing succeeds, then draft POF creation is attempted, then PDF persistence to Member Files is attempted as later steps.
  - If draft POF creation fails, the intake stays signed and a follow-up task is queued.
  - If Member Files persistence fails, the intake still exists and a follow-up task is queued.
- How partial failure could occur:
  - A caregiver/nurse can finish the signature step while draft POF or Member Files work still fails later.
  - Evidence: `app/intake-actions.ts:276-402`
- Recommended fix:
  - Keep the current explicit staged-readiness model, but stop treating "signed" as the final operational milestone.
  - Introduce a single service result that always returns committed intake state plus readiness state, instead of mixing committed success with later throw-like error paths.
- Blocks launch: No, but this still needs hardening.

### Finding A2
- Severity: High
- Workflow: Enrollment packet completion -> filing -> downstream mapping cascade
- Exact files/functions/modules:
  - `D:\Memory Lane App\lib\services\enrollment-packets-public-runtime.ts` - `submitPublicEnrollmentPacket`
  - `D:\Memory Lane App\lib\services\enrollment-packet-completion-cascade.ts` - `runEnrollmentPacketCompletionCascade`
  - `D:\Memory Lane App\supabase\migrations\0053_artifact_drift_replay_hardening.sql`
  - `D:\Memory Lane App\supabase\migrations\0149_enrollment_packet_contact_replay_idempotency.sql`
  - `D:\Memory Lane App\supabase\migrations\0151_refresh_enrollment_packet_conversion_rpc_contact_replay_fix.sql`
- What should happen:
  - Filing should either include all required downstream mapping work, or the caller should get a committed "filed but not operationally ready" result instead of a generic failure.
- What currently happens:
  - Upload artifacts are created, filing RPC commits, then downstream mapping runs afterward.
  - If mapping cannot reload fields or fails later, the packet stays filed but not operationally ready.
  - The public action still returns `ok: false` because the service throws when readiness is not complete.
- How partial failure could occur:
  - A caregiver can successfully file the packet, but the screen still shows an error and does not redirect to confirmation.
  - Evidence: `lib/services/enrollment-packets-public-runtime.ts:755-980`, `app/sign/enrollment-packet/[token]/actions.ts:318-366`
- Recommended fix:
  - Treat "filed but follow-up required" as a first-class committed response shape.
  - Preserve the existing readiness status and follow-up queue, but stop routing that state through a thrown error after the filing RPC already committed.
- Blocks launch: No, but it is a high-value fix because it reduces false retries and founder confusion.

### Finding A3
- Severity: Medium
- Workflow: POF signed -> MHP/MCC/MAR cascade
- Exact files/functions/modules:
  - `D:\Memory Lane App\lib\services\pof-esign-public.ts` - `submitPublicPofSignature`
  - `D:\Memory Lane App\lib\services\pof-post-sign-runtime.ts` - `runBestEffortCommittedPofSignatureFollowUp`
  - `D:\Memory Lane App\app\api\internal\pof-post-sign-sync\route.ts`
  - `D:\Memory Lane App\supabase\migrations\0043_delivery_state_and_pof_post_sign_sync_rpc.sql`
  - `D:\Memory Lane App\supabase\migrations\0097_pof_post_sign_retry_claim_rpc.sql`
- What should happen:
  - Signed POF should either synchronously finish required clinical sync, or clearly remain in a durable queued state that operations can monitor.
- What currently happens:
  - The POF signature finalization RPC commits first, then best-effort post-sign sync runs after commit.
  - If sync fails, the public result comes back as `queued` with action needed.
- How partial failure could occur:
  - The physician order is legally signed, but MHP/MCC/MAR are not yet current.
  - Evidence: `lib/services/pof-esign-public.ts:323-408`, `lib/services/pof-post-sign-runtime.ts:57-69,144-280`
- Recommended fix:
  - Keep the queue, but treat the queue runner as production-critical infrastructure with explicit health checks and stale-queue alerts.
  - Make the operations UI show "signed, sync pending" more aggressively wherever staff might assume MAR is already current.
- Blocks launch: No in code. Yes if the queue runner is not actually configured and monitored.

### Finding A4
- Severity: Medium
- Workflow: Care plan create/review/sign -> snapshot history -> caregiver dispatch
- Exact files/functions/modules:
  - `D:\Memory Lane App\lib\services\care-plans-supabase.ts` - `createCarePlan`, `reviewCarePlan`
  - `D:\Memory Lane App\lib\services\care-plan-esign-public.ts` - `submitPublicCarePlanSignature`
  - `D:\Memory Lane App\supabase\migrations\0111_care_plan_caregiver_status_compare_and_set.sql`
  - `D:\Memory Lane App\supabase\migrations\0112_care_plan_post_sign_readiness.sql`
- What should happen:
  - Care plan signing should not look fully complete until version history and caregiver dispatch are durably finished.
- What currently happens:
  - Nurse/admin signature persists first, then post-sign readiness moves through snapshot and caregiver dispatch stages.
  - Failures after signature are captured as action-required follow-up rather than rolled back.
- How partial failure could occur:
  - A care plan can be signed while version history or caregiver dispatch still needs repair.
  - Evidence: `lib/services/care-plans-supabase.ts:512-564,674-758`
- Recommended fix:
  - Continue using explicit post-sign readiness, but standardize response handling so the caller gets committed state plus readiness state instead of mixed "saved but failed later" language.
- Blocks launch: No.

## 3. Consistency Gaps

### Finding C1
- Severity: Medium
- Affected schema/business rule:
  - "Operationally complete" is still mostly a service-layer truth rather than a single terminal database truth across intake, enrollment packet, POF post-sign sync, and care plan follow-up.
- Exact files/migrations/services involved:
  - `D:\Memory Lane App\app\intake-actions.ts`
  - `D:\Memory Lane App\lib\services\enrollment-packets-public-runtime.ts`
  - `D:\Memory Lane App\lib\services\care-plans-supabase.ts`
  - `D:\Memory Lane App\lib\services\pof-post-sign-runtime.ts`
- What invariant is not enforced:
  - The database knows a record is signed/filed, but "safe for downstream operations" still depends on readiness helpers and follow-up queues rather than one immutable terminal state rule.
- Why it matters:
  - Staff can read a legally committed state and assume the downstream work is complete when it may still be pending.
- Recommended DB/service fix:
  - Keep current readiness columns, but define one canonical "operational completion" contract per workflow and make UI/actions always read that instead of inferring from signed/filed alone.
- Blocks launch: No.

### Finding C2
- Severity: Low
- Affected schema/business rule:
  - No new enrollment packet lineage gap is confirmed; yesterday's concern is now materially improved.
- Exact files/migrations/services involved:
  - `D:\Memory Lane App\supabase\migrations\0140_enrollment_packet_lineage_enforcement.sql`
  - `D:\Memory Lane App\supabase\migrations\0141_member_files_enrollment_packet_lineage_trigger.sql`
  - `D:\Memory Lane App\docs\audits\enrollment-packet-lineage-drift-audit.sql`
- What invariant is not enforced:
  - The earlier packet/member mismatch gap is now largely closed for packet child tables and linked member files.
- Why it matters:
  - This is a positive change since the last run, and it removes one of the bigger consistency concerns from prior audits.
- Recommended DB/service fix:
  - Keep the drift audit in the recurring audit suite and treat any future mismatch as a release blocker.
- Blocks launch: No.

## 4. Isolation Risks

### Finding I1
- Severity: Medium
- Workflow: Enrollment packet and intake follow-up retry work
- Concurrency/replay scenario:
  - Two staff members can attempt to pick up the same remediation task if the claim expires and the first user is still working.
- Exact files/functions involved:
  - `D:\Memory Lane App\supabase\migrations\0128_intake_follow_up_retry_claims.sql`
  - `D:\Memory Lane App\lib\services\intake-post-sign-follow-up.ts`
  - `D:\Memory Lane App\lib\services\enrollment-packet-follow-up.ts`
- What duplicate/conflicting state could happen:
  - Duplicate manual remediation attempts are still possible after the 10-minute claim window, even though the queue now uses `FOR UPDATE SKIP LOCKED`.
- Recommended protection:
  - Keep the claim RPCs, but shorten operator ambiguity by showing active claimant and age in the UI and by rechecking workflow readiness immediately before any retry write.
- Blocks launch: No.

### Finding I2
- Severity: Low
- Workflow: Public retry pressure after committed-but-not-ready states
- Concurrency/replay scenario:
  - A caregiver sees an error after a committed enrollment filing and retries the same public flow.
- Exact files/functions involved:
  - `D:\Memory Lane App\lib\services\enrollment-packets-public-runtime.ts`
  - `D:\Memory Lane App\app\sign\enrollment-packet\[token]\actions.ts`
  - `D:\Memory Lane App\supabase\migrations\0149_enrollment_packet_contact_replay_idempotency.sql`
  - `D:\Memory Lane App\supabase\migrations\0151_refresh_enrollment_packet_conversion_rpc_contact_replay_fix.sql`
- What duplicate/conflicting state could happen:
  - The core packet is replay-safe, but the higher-level UX still encourages a retry after commit because it surfaces a failure state.
- Recommended protection:
  - Return a committed "follow-up required" result instead of `ok: false` after filing has already succeeded.
- Blocks launch: No.

## 5. Durability Risks

### Finding D1
- Severity: High
- Workflow: Member-file delete and storage cleanup
- Exact files/functions involved:
  - `D:\Memory Lane App\lib\services\member-files.ts` - `deleteMemberFileRecordAndStorage`
- What success currently means:
  - The database row is deleted first, then storage cleanup is attempted.
- What may fail underneath:
  - Storage deletion can fail after the row is already gone.
- Why that is unsafe:
  - This leaves orphaned storage without a canonical DB row to reconcile from the normal UI path.
  - Evidence: `lib/services/member-files.ts:350-398`
- Recommended correction:
  - Replace hard delete-first behavior with a two-step delete model: mark pending delete, remove storage, then finalize row delete; or keep a tombstone/reconciliation table for failed storage cleanup.
- Blocks launch: No, but this is the cleanest durability fix to take next.

### Finding D2
- Severity: Medium
- Workflow: MAR scheduled/PRN documentation and monthly MAR report generation
- Exact files/functions involved:
  - `D:\Memory Lane App\app\(portal)\health\mar\actions-impl.ts` - local `insertAudit`, `recordScheduledMarAdministrationAction`, `recordPrnMarAdministrationAction`, `generateMonthlyMarReportPdfAction`
  - `D:\Memory Lane App\lib\services\mar-workflow.ts`
- What success currently means:
  - The RPC-backed MAR write can already be committed before the later audit insert happens.
- What may fail underneath:
  - The local MAR action helper does not swallow audit-log failures. If audit insert fails after the write, the action returns an error to the UI.
- Why that is unsafe:
  - Staff can retry a MAR action because the screen said it failed, even though the underlying administration or report save already committed.
  - Evidence: `app/(portal)/health/mar/actions-impl.ts:119-130,146-189,370-440`
- Recommended correction:
  - Reuse the non-throwing audit helper pattern from `app/action-helpers.ts` so audit failure raises an alert but does not convert a committed MAR write into user-visible failure.
- Blocks launch: No.

### Finding D3
- Severity: Medium
- Workflow: POF post-sign sync durability
- Exact files/functions involved:
  - `D:\Memory Lane App\app\api\internal\pof-post-sign-sync\route.ts`
  - `D:\Memory Lane App\lib\services\physician-order-post-sign-runtime.ts`
- What success currently means:
  - Signature can commit while queued clinical sync still depends on the internal runner.
- What may fail underneath:
  - If `POF_POST_SIGN_SYNC_SECRET` or `CRON_SECRET` is not configured, the runner returns 503 and queued sync rows can sit indefinitely.
- Why that is unsafe:
  - Signed orders can remain legally signed but operationally stale in MHP/MAR until someone manually notices.
- Recommended correction:
  - Treat queue-runner configuration and stale-queue alerting as release-safety checks, not optional ops work.
- Blocks launch: Yes if the runner is not configured in the real environment. No code-level blocker was confirmed in repo alone.

## 6. ACID Hardening Plan

1. Stop post-commit false failures in public enrollment packet and MAR actions.
2. Fix member-file delete durability so storage cleanup cannot silently drift after DB delete.
3. Standardize "committed but follow-up required" result shapes across intake, enrollment, care plan, and POF post-sign flows.
4. Add a visible operations surface for staged-readiness queues and stale POF post-sign sync rows.
5. Keep strengthening DB-enforced terminal readiness rules where the workflow truly must not be treated as complete until downstream artifacts exist.

## 7. Suggested Codex Prompts

### Prompt 1
Implement a production-safe fix for enrollment packet public submission so a packet that has already been filed does not return a generic failure just because downstream mapping is still pending or failed. Keep the existing RPC-backed filing and follow-up queue behavior, but return a committed result shape with explicit readiness/action-needed fields instead of throwing after commit. Verify replay safety and preserve Supabase as source of truth.

### Prompt 2
Harden member-file deletion so database row deletion and storage cleanup cannot drift. Replace the current delete-row-then-delete-storage flow with a durable two-stage delete or reconciliation-safe tombstone pattern. Keep the implementation simple, auditable, and compatible with existing Supabase member-files architecture.

### Prompt 3
Refactor MAR action audit handling so audit-log insert failure does not turn a committed MAR administration or monthly report save into a user-visible failure. Use the existing non-throwing audit helper style already used elsewhere in the app, emit an operational alert on audit failure, and keep the MAR write path deterministic.

## 8. Fix First Tonight

- Change enrollment packet public submit to return committed follow-up-needed state instead of `ok: false` after filing.
- Make MAR audit logging non-throwing after committed writes.
- Add an explicit nightly/interval check that fails loudly if the POF post-sign runner is not configured or if queued rows age past the alert threshold.

## 9. Automate Later

- Add an orphaned member-file storage reconciliation audit for deletes and cleanup failures.
- Add a recurring staged-readiness backlog report for intake, enrollment packet, care plan, and POF post-sign queues.
- Add regression tests for "committed but follow-up required" action responses so UI does not regress back to fake failure states.
- Add a release gate that checks stale `pof_post_sign_sync_queue` rows and missing runner secrets in non-local environments.

## 10. Founder Summary: What Changed Since the Last Run

- Improved since the last run:
  - Enrollment packet lineage is stronger now. `0140_enrollment_packet_lineage_enforcement.sql` and `0141_member_files_enrollment_packet_lineage_trigger.sql` close the previously open packet/member lineage concern for packet child tables and linked member files.
  - Enrollment packet replay safety is also better. `0149_enrollment_packet_contact_replay_idempotency.sql` and `0151_refresh_enrollment_packet_conversion_rpc_contact_replay_fix.sql` reduce duplicate-contact drift on packet replay.
  - Lead conversion still looks stable. I did not find a new confirmed ACID regression in the lead -> member conversion path today.
- Still not fully solved:
  - Intake, enrollment packet, care plan, and POF post-sign workflows still rely on staged second-phase completion after the first durable commit.
  - Member-file delete durability is still weak because DB delete happens before storage cleanup.
  - MAR action audit handling can still report failure after a committed write.
- Bottom line:
  - The repo is safer than yesterday on lineage and replay safety.
  - The top remaining work is now about making committed states easier to trust operationally, and making post-commit follow-up failures stop looking like full transaction failures.
