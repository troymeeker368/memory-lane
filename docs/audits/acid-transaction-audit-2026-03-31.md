# Memory Lane ACID Transaction Audit - 2026-03-31

## 1. Executive Summary

- Overall ACID safety rating: 8.6/10
- Overall verdict: Partial
- Top 5 ACID risks:
  1. The highest current durability risk is now in the signature finalize flows, not the shared member-file helper. Several flows still delete uploaded artifacts after any finalize-RPC error, even though the database may already have committed the signed state.
  2. Signed POF downstream sync is wired much better than before, but real durability still depends on production runner secrets and cron execution that cannot be confirmed from repo code alone.
  3. Enrollment packet completion is still intentionally staged. A packet can be durably filed before downstream MCC/MHP/POF mapping finishes.
  4. Intake signing is still intentionally staged. The assessment can be durably signed before draft POF creation and Intake PDF filing fully finish.
  5. Care plan caregiver replay handling still has a concurrency truth gap: one replay path reports no follow-up needed without re-reading canonical post-sign readiness.
- Strongest workflows:
  - Lead -> member conversion remains one of the strongest paths. It stays inside canonical RPC boundaries and has DB-backed idempotency on the create-and-convert root.
  - Shared member-file persistence is materially safer than yesterday. The generated/manual upload helpers now preserve likely committed writes and fall back to verification-pending alerts instead of deleting new objects after readback misses.
  - MAR documentation is relatively strong. Scheduled administrations use canonical RPC writes, and PRN order/admin/follow-up paths now use explicit idempotency keys.
- Short founder summary:
  - Yesterday's biggest shared member-file durability blocker appears closed.
  - Tonight's main ACID concern is narrower but serious: signature completion flows can still clean up artifacts too aggressively if the finalize RPC committed but the client lost the response.
  - The codebase is moving in the right direction, but the system still relies on staged follow-up truth and healthy background runners for POF and enrollment downstream work.

## 2. Atomicity Violations

### Finding A1
- Severity: High
- Workflow name: Signature finalize -> artifact persistence across intake, care plan, and POF signing
- Exact files/functions/modules:
  - `D:\Memory Lane App\lib\services\pof-esign-public.ts` - `submitPublicPofSignature`
  - `D:\Memory Lane App\lib\services\care-plan-esign-public.ts` - `submitPublicCarePlanSignature`
  - `D:\Memory Lane App\lib\services\intake-assessment-esign.ts` - `signIntakeAssessment`
  - `D:\Memory Lane App\lib\services\care-plan-nurse-esign.ts` - `signCarePlanNurseEsign`
- What should happen:
  - Once the finalize RPC is attempted, cleanup should only happen after canonical verification proves the signed state did not commit.
- What currently happens:
  - These flows upload signature/PDF artifacts, call the finalize RPC, and then run destructive cleanup inside `catch` blocks for any thrown finalize error.
- How partial failure could occur:
  - If PostgREST/Supabase commits the transaction but the client loses the response or throws on transport/readback, the catch path can delete storage or member-file artifacts that the database now references.
- Recommended fix:
  - Treat the finalize RPC as a possible commit boundary.
  - On finalize error, reload canonical state by request/assessment/care plan before cleanup.
  - If canonical signed state exists, preserve artifacts, alert, and return a committed-follow-up-needed result.
  - Only clean up when canonical state still proves the workflow did not finalize.
- Blocks launch: Yes

### Finding A2
- Severity: Medium
- Workflow name: Enrollment packet completion -> downstream mapping cascade
- Exact files/functions/modules:
  - `D:\Memory Lane App\lib\services\enrollment-packets-public-runtime.ts` - `submitPublicEnrollmentPacket`
  - `D:\Memory Lane App\lib\services\enrollment-packet-completion-cascade.ts` - `runEnrollmentPacketCompletionCascade`
- What should happen:
  - Filing and downstream operational handoff would ideally be one durable boundary, or every downstream surface must honor mapping readiness instead of raw packet status.
- What currently happens:
  - Packet filing commits first, then downstream mapping runs after commit.
- How partial failure could occur:
  - A packet can be durably filed while MCC/MHP/POF mapping is still pending or failed.
- Recommended fix:
  - Keep the staged model, but continue treating `mapping_sync_status` and action-required follow-up as authoritative operational truth everywhere.
- Blocks launch: No

### Finding A3
- Severity: Medium
- Workflow name: Intake signed -> draft POF creation -> Intake PDF to Member Files
- Exact files/functions/modules:
  - `D:\Memory Lane App\app\intake-actions.ts` - `createAssessmentAction`
  - `D:\Memory Lane App\lib\services\physician-orders-supabase.ts` - `createDraftPhysicianOrderFromAssessment`
  - `D:\Memory Lane App\lib\services\member-files.ts` - `saveGeneratedMemberPdfToFiles`
- What should happen:
  - Operational completion should mean the assessment is signed, the draft POF exists, and the intake PDF is filed.
- What currently happens:
  - The signature commit lands first. Draft POF creation and PDF filing are handled as explicit follow-up work if needed.
- How partial failure could occur:
  - Intake can be durably signed while downstream draft-POF or PDF persistence still needs follow-up.
- Recommended fix:
  - Keep the staged model, but keep `postSignReadinessStatus` authoritative for staff decisions.
- Blocks launch: No

## 3. Consistency Gaps

### Finding C1
- Severity: Medium
- Affected schema/business rule:
  - "Already signed" should not mean "no more follow-up needed."
- Exact files/migrations/services involved:
  - `D:\Memory Lane App\lib\services\care-plan-esign-public.ts` - `submitPublicCarePlanSignature`
  - `D:\Memory Lane App\supabase\migrations\0111_care_plan_caregiver_status_compare_and_set.sql`
  - `D:\Memory Lane App\supabase\migrations\0118_care_plan_caregiver_status_terminality_hardening.sql`
- What invariant is not enforced:
  - The `wasAlreadySigned` branch returns `actionNeeded: false` without re-reading canonical `post_sign_readiness_status`.
- Why it matters:
  - A concurrent replay can tell the caregiver or staff that the workflow is fully ready even when post-sign follow-up still failed or is still pending.
- Recommended DB/service fix:
  - Reload the canonical care plan after `wasAlreadySigned` and base `actionNeeded` on persisted post-sign readiness, not on the replay branch alone.
- Blocks launch: No

### Finding C2
- Severity: Medium
- Affected schema/business rule:
  - Signed/filed states are not the same as operational readiness in intake, enrollment packet, and signed-POF flows.
- Exact files/migrations/services involved:
  - `D:\Memory Lane App\app\intake-actions.ts`
  - `D:\Memory Lane App\lib\services\enrollment-packets-public-runtime.ts`
  - `D:\Memory Lane App\lib\services\pof-post-sign-runtime.ts`
- What invariant is not enforced:
  - The database does not structurally force every consumer to use readiness/follow-up truth instead of raw signature/filed status.
- Why it matters:
  - Any screen or export that uses raw "signed" or "filed" state alone can overstate completion.
- Recommended DB/service fix:
  - Keep all read models and downstream actions keyed off readiness/follow-up fields and queue state, not raw signed/filed flags.
- Blocks launch: No

## 4. Isolation Risks

### Finding I1
- Severity: Medium
- Workflow name: Care plan caregiver concurrent replay
- Concurrency/replay scenario:
  - Two caregiver submits hit close together. One request commits first; the second request reaches the `wasAlreadySigned` path.
- Exact files/functions involved:
  - `D:\Memory Lane App\lib\services\care-plan-esign-public.ts` - `submitPublicCarePlanSignature`
- What duplicate/conflicting state could happen:
  - The replayed request can report success with `actionNeeded: false` even if post-sign readiness still requires follow-up.
- Recommended protection:
  - Re-read the canonical care plan after the replay-safe finalize branch and compute action-needed from persisted readiness state.
- Blocks launch: No

### Finding I2
- Severity: High
- Workflow name: Signature finalize retries after ambiguous RPC outcome
- Concurrency/replay scenario:
  - A finalize RPC commits, but the client gets a transport/readback error and retries or runs cleanup as if nothing committed.
- Exact files/functions involved:
  - `D:\Memory Lane App\lib\services\pof-esign-public.ts`
  - `D:\Memory Lane App\lib\services\care-plan-esign-public.ts`
  - `D:\Memory Lane App\lib\services\intake-assessment-esign.ts`
  - `D:\Memory Lane App\lib\services\care-plan-nurse-esign.ts`
- What duplicate/conflicting state could happen:
  - Canonical signed rows can exist while cleanup deletes the artifacts they reference, leaving DB/storage drift.
- Recommended protection:
  - Add a canonical readback/verification step before any cleanup after finalize-RPC errors.
  - If committed state exists, stop cleanup and surface verification-needed follow-up instead.
- Blocks launch: Yes

### Finding I3
- Severity: Medium
- Workflow name: Enrollment packet filed before mapping completion
- Concurrency/replay scenario:
  - Other readers can see `filed` before downstream mapping finishes or before retries heal a failed run.
- Exact files/functions involved:
  - `D:\Memory Lane App\lib\services\enrollment-packets-public-runtime.ts`
  - `D:\Memory Lane App\lib\services\enrollment-packet-completion-cascade.ts`
- What duplicate/conflicting state could happen:
  - Staff can act on packet completion before downstream shells and clinical data are actually ready.
- Recommended protection:
  - Keep `mapping_sync_status`, follow-up queues, and action-required alerts visible and authoritative in staff workflows.
- Blocks launch: No

## 5. Durability Risks

### Finding D1
- Severity: High
- Workflow name: Intake/POF/Care Plan signature artifact durability
- Exact files/functions involved:
  - `D:\Memory Lane App\lib\services\pof-esign-public.ts`
  - `D:\Memory Lane App\lib\services\care-plan-esign-public.ts`
  - `D:\Memory Lane App\lib\services\intake-assessment-esign.ts`
  - `D:\Memory Lane App\lib\services\care-plan-nurse-esign.ts`
- What success currently means:
  - The system attempted a finalize RPC after uploading signature/PDF artifacts.
- What may fail underneath:
  - A thrown finalize error is currently treated as if nothing committed, even though the database may already have saved the signed state.
- Why that is unsafe:
  - Cleanup can delete legally or clinically important artifacts after the canonical signed state is already persisted.
- Recommended correction:
  - Replace destructive finalize-error cleanup with canonical verification first, then non-destructive alert-backed follow-up if commit likely happened.
- Blocks launch: Yes

### Finding D2
- Severity: Medium
- Workflow name: Signed POF -> MHP/MCC/MAR cascade
- Exact files/functions involved:
  - `D:\Memory Lane App\app\api\internal\pof-post-sign-sync\route.ts`
  - `D:\Memory Lane App\lib\services\physician-order-post-sign-runtime.ts`
  - `D:\Memory Lane App\vercel.json`
- What success currently means:
  - The signed POF path is queue-safe and cron-wired in code.
- What may fail underneath:
  - Real durability still depends on `POF_POST_SIGN_SYNC_SECRET` or `CRON_SECRET` being configured in deployment and the route actually running.
- Why that is unsafe:
  - Signed orders can remain queued and not fully sync to MHP/MCC/MAR if production runner config is missing or unhealthy.
- Recommended correction:
  - Keep the current queue model, but verify deployment secrets and monitor aged queue rows as release-critical infrastructure.
- Blocks launch: Likely, if runner config is missing or unhealthy

### Finding D3
- Severity: Medium
- Workflow name: Enrollment packet failed-mapping retries
- Exact files/functions involved:
  - `D:\Memory Lane App\app\api\internal\enrollment-packet-mapping-sync\route.ts`
  - `D:\Memory Lane App\lib\services\enrollment-packet-completion-cascade.ts`
  - `D:\Memory Lane App\vercel.json`
- What success currently means:
  - Initial code wiring exists for scheduled retries.
- What may fail underneath:
  - Actual deployment secrets are unverified from code, and the retry route does not emit the same missing-config alert pattern the POF runner now does.
- Why that is unsafe:
  - Filed packets can sit with failed mapping follow-up longer than necessary if retry infrastructure is misconfigured.
- Recommended correction:
  - Mirror the POF runner’s missing-config alert pattern and verify production secret/cron ownership.
- Blocks launch: No, but it increases operational drift risk

## 6. ACID Hardening Plan

1. Fix finalize-RPC cleanup semantics first across `pof-esign-public`, `care-plan-esign-public`, `intake-assessment-esign`, and `care-plan-nurse-esign`.
2. Patch the care plan `wasAlreadySigned` replay branch to re-read canonical post-sign readiness before returning success.
3. Verify production runner ownership for both internal cron routes:
   - `/api/internal/pof-post-sign-sync`
   - `/api/internal/enrollment-packet-mapping-sync`
4. Keep staged workflows honest by forcing staff-facing read models to prefer readiness/follow-up truth over raw signed/filed truth.
5. Add regression coverage for ambiguous finalize-RPC failures so these flows cannot reintroduce cleanup-after-commit drift.

## 7. Suggested Codex Prompts

### Prompt 1
Audit and harden the signature finalize flows in `D:\Memory Lane App`.

Problem:
- `lib/services/pof-esign-public.ts`, `lib/services/care-plan-esign-public.ts`, `lib/services/intake-assessment-esign.ts`, and `lib/services/care-plan-nurse-esign.ts` all run destructive cleanup after any finalize-RPC error.
- If the database committed and the client only lost the response, cleanup can delete artifacts that canonical signed rows now reference.

What to do:
- Treat each finalize RPC as a possible commit boundary.
- On finalize error, reload canonical signed state before cleanup.
- If committed state exists, preserve artifacts, emit an alert, and return a committed-follow-up-needed result instead of deleting files.
- Only run destructive cleanup when canonical state still proves the finalize did not commit.

Validation:
- Run `npm run typecheck`.
- Add regression coverage for ambiguous finalize-RPC failures across at least POF and one care-plan/intake flow.

### Prompt 2
Fix the care plan caregiver replay truth gap in `D:\Memory Lane App\lib\services\care-plan-esign-public.ts`.

Problem:
- The `wasAlreadySigned` path returns `actionNeeded: false` without re-reading canonical `post_sign_readiness_status`.

What to do:
- Reload the care plan after the replay-safe finalize branch.
- Return `actionNeeded` and `actionNeededMessage` from persisted readiness truth, not from the replay branch alone.

Validation:
- Run `npm run typecheck`.
- Confirm concurrent replay still reports follow-up-required when post-sign readiness is not `ready`.

### Prompt 3
Audit the operational durability of internal retry runners in `D:\Memory Lane App`.

Problem:
- POF and enrollment packet retry routes are cron-wired in `vercel.json`, but real durability still depends on deployment secrets and health visibility.

What to do:
- Review `app/api/internal/pof-post-sign-sync/route.ts`, `app/api/internal/enrollment-packet-mapping-sync/route.ts`, and related services.
- Ensure missing-config behavior raises durable alerts for both routes.
- Document the required env secrets and health ownership clearly.

Validation:
- Show the exact config expectations and where aged/stuck work will alert.

## 8. Fix First Tonight

- Fix finalize-RPC cleanup semantics in the signature flows first.
- Reason:
  - It is the clearest current launch-blocking durability gap.
  - It affects legal/clinical signed artifacts, not just convenience files.
  - The repo already solved the same class of mistake once in shared member-file persistence, so the fix pattern is clear.

## 9. Automate Later

- Add a regression test suite for "RPC committed but client lost response" in POF/care plan/intake signature finalize paths.
- Add a nightly audit that compares signed workflow records to required storage artifacts for POF, care plan, and intake signatures.
- Add a deployment checklist audit that fails if cron routes exist in `vercel.json` but required secrets are undocumented or missing from environment setup guidance.
- Add a read-model audit that flags screens using raw signed/filed states without their matching readiness/follow-up truth.

## 10. Founder Summary: What changed since the last run

- Improved since yesterday:
  - The shared member-file durability blocker from the 2026-03-30 audit appears fixed. `lib/services/member-files.ts` now preserves likely committed writes and falls back to verification-pending alerts instead of deleting new files after immediate readback misses.
  - Manual Command Center uploads benefit from the same safer verification-pending pattern.
  - Signed-POF runner visibility is better in code now: `app/api/internal/pof-post-sign-sync/route.ts` has explicit missing-config handling and `vercel.json` wires the cron route.
- New main concern today:
  - The next most important ACID gap is the signature finalize cleanup pattern. Several sign/finalize flows still assume any finalize-RPC error means "nothing committed," which is too aggressive for production.
- Still open from yesterday:
  - POF post-sign and enrollment packet downstream work still rely on healthy background runner configuration in real deployment.
  - Intake and enrollment remain intentionally staged after the first durable commit.
- Bottom line:
  - Yesterday's shared member-file issue no longer looks like the main blocker.
  - Tonight's best risk-reduction move is to harden the signature finalize flows against ambiguous post-commit errors.
