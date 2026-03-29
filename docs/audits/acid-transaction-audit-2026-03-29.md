# Memory Lane ACID Transaction Audit - 2026-03-29

## 1. Executive Summary

- Overall ACID safety rating: 8.4/10
- Overall verdict: Partial
- Top 5 ACID risks:
  1. Public care plan caregiver signing still has a launch-blocking post-commit rollback bug. After the caregiver finalization RPC commits, a later readiness update can still throw and trigger cleanup on already-committed artifacts.
  2. Signed POF downstream sync is safer than before, but it still depends on the retry runner actually being configured and monitored in production.
  3. Enrollment packet filing is still intentionally staged. The packet can be durably filed before downstream MCC/MHP/POF mapping finishes.
  4. Intake signing is still intentionally staged. Draft POF creation and Member Files PDF persistence happen after the signed intake commit.
  5. New PRN sync coverage is better, but active PRN order sync currently runs from MAR refresh logic, not from the signed-POF commit boundary itself.
- Strongest workflows:
  - Lead -> member conversion is materially stronger. The wrapper is back to `SECURITY DEFINER`, enforces caller identity, and refuses success if required operational shells are missing.
  - Enrollment packet replay safety improved. Upload fingerprints, stricter packet lifecycle constraints, and follow-up queue profile FKs reduce duplicate or orphan drift.
  - MAR PRN documentation is stronger. PRN admin/order creation now uses DB-backed idempotency keys and deduped observability events.
  - Member-file delete remains safer because storage cleanup runs before the DB row is removed.
- Short founder summary:
  - The repo is safer than the last remembered run, mostly because the March 28 hardening work is now clearly present in schema and services.
  - The biggest remaining real risk is still public care plan caregiver signing.
  - Lead conversion is strong, enrollment packet replay safety is better, and MAR/PRN write-path idempotency improved.

## 2. Atomicity Violations

### Finding A1
- Severity: High
- Workflow name: Care plan caregiver public signature -> final member file -> post-sign readiness
- Exact files/functions/modules:
  - `D:\Memory Lane App\lib\services\care-plan-esign-public.ts` - `submitPublicCarePlanSignature`
  - `D:\Memory Lane App\lib\services\care-plan-esign-public.ts` - `cleanupFailedCarePlanCaregiverArtifacts`
  - `D:\Memory Lane App\lib\services\care-plan-esign-public.ts` - `markCarePlanPostSignReady`
  - `D:\Memory Lane App\supabase\migrations\0053_artifact_drift_replay_hardening.sql` - `rpc_finalize_care_plan_caregiver_signature`
- What should happen:
  - Once the caregiver finalization RPC commits, every later step must be best-effort only.
  - No later failure should delete committed artifacts or tell the caregiver the signature failed.
- What currently happens:
  - The public flow uploads artifacts, calls the finalization RPC, logs events, and then separately updates `post_sign_readiness_status`.
  - That full sequence still sits inside one outer `try/catch`.
- How partial failure could occur:
  - If `markCarePlanPostSignReady` throws after the RPC already committed, the catch still calls cleanup and can delete the signed PDF/signature objects while Supabase already says the care plan is signed.
- Recommended fix:
  - Restrict cleanup to pre-finalization steps only.
  - After the finalization RPC succeeds, treat readiness/event writes as post-commit best-effort only, or move readiness advancement into the same RPC.
- Blocks launch: Yes

### Finding A2
- Severity: Medium
- Workflow name: Enrollment packet completion -> filed packet -> downstream mapping cascade
- Exact files/functions/modules:
  - `D:\Memory Lane App\lib\services\enrollment-packets-public-runtime.ts` - `submitPublicEnrollmentPacket`
  - `D:\Memory Lane App\lib\services\enrollment-packet-completion-cascade.ts` - `runEnrollmentPacketCompletionCascade`
- What should happen:
  - Filing and downstream handoff would ideally be one durable boundary, or the UI must clearly say "filed but still needs follow-up."
- What currently happens:
  - The packet is durably finalized first, then the downstream mapping cascade runs afterward.
- How partial failure could occur:
  - The packet can be legally filed while downstream MCC/MHP/POF sync is still pending or failed.
- Recommended fix:
  - Keep the staged model, but ensure every staff-facing view uses operational readiness, not just `status=filed/completed`.
- Blocks launch: No

### Finding A3
- Severity: Medium
- Workflow name: Intake signed -> draft POF creation -> Intake PDF to Member Files
- Exact files/functions/modules:
  - `D:\Memory Lane App\app\intake-actions.ts`
  - `D:\Memory Lane App\lib\services\intake-pof-mhp-cascade.ts`
  - `D:\Memory Lane App\lib\services\physician-orders-supabase.ts`
  - `D:\Memory Lane App\lib\services\intake-post-sign-follow-up.ts`
- What should happen:
  - Operational completion should mean the intake is signed, the draft POF exists, and the PDF is durably filed.
- What currently happens:
  - The intake commit lands first.
  - Draft POF creation and member-file persistence run afterward and raise follow-up tasks if they fail.
- How partial failure could occur:
  - Intake can be signed while clinical onboarding or document persistence still needs repair.
- Recommended fix:
  - Keep the staged follow-up model, but continue treating post-sign readiness as the real completion signal.
- Blocks launch: No

## 3. Consistency Gaps

### Finding C1
- Severity: High
- Affected schema/business rule:
  - A care plan can be durably `signed` while `post_sign_readiness_status` is still stale and the public caller sees a failure.
- Exact files/migrations/services involved:
  - `D:\Memory Lane App\lib\services\care-plan-esign-public.ts`
  - `D:\Memory Lane App\supabase\migrations\0053_artifact_drift_replay_hardening.sql`
  - `D:\Memory Lane App\supabase\migrations\0112_care_plan_post_sign_readiness.sql`
- What invariant is not enforced:
  - "Caregiver signature committed" and "care plan operational readiness advanced safely" are not part of one durable boundary.
- Why it matters:
  - Staff and caregivers can observe contradictory truth.
- Recommended DB/service fix:
  - Put readiness advancement inside the finalization RPC, or make the later write non-destructive and non-user-blocking.
- Blocks launch: Yes

### Finding C2
- Severity: Medium
- Affected schema/business rule:
  - Signed POF status still does not itself guarantee downstream MHP/MCC/MAR sync is complete.
- Exact files/migrations/services involved:
  - `D:\Memory Lane App\lib\services\physician-orders-supabase.ts`
  - `D:\Memory Lane App\lib\services\pof-post-sign-runtime.ts`
  - `D:\Memory Lane App\lib\services\physician-order-post-sign-runtime.ts`
  - `D:\Memory Lane App\supabase\migrations\0155_signed_pof_post_sign_sync_rpc_consolidation.sql`
- What invariant is not enforced:
  - "Signed POF" and "downstream clinical sync complete" are still separate truths.
- Why it matters:
  - A legally signed order can exist while MAR/MHP/MCC truth still lags.
- Recommended DB/service fix:
  - Keep the queue-backed model, but make runner health and aged-queue alerting part of release readiness.
- Blocks launch: No, if the runner is healthy

### Finding C3
- Severity: Low
- Affected schema/business rule:
  - PRN order availability now updates when MAR data refreshes, not in the same signed-POF commit boundary.
- Exact files/migrations/services involved:
  - `D:\Memory Lane App\lib\services\mar-workflow-read.ts` - `refreshMarWorkflowData`
  - `D:\Memory Lane App\lib\services\mar-prn-workflow.ts` - `syncActivePrnMedicationOrders`
  - `D:\Memory Lane App\supabase\migrations\0167_prn_sync_from_checked_pof_standing_orders.sql`
- What invariant is not enforced:
  - "Signed POF standing orders are immediately reflected in PRN medication orders" is not guaranteed at sign time.
- Why it matters:
  - PRN options can lag until MAR refresh runs.
- Recommended DB/service fix:
  - Long term, decide whether PRN sync belongs inside the signed-POF post-sign boundary or if read-time sync is acceptable and well-communicated.
- Blocks launch: No

## 4. Isolation Risks

### Finding I1
- Severity: High
- Workflow name: Care plan caregiver public signing
- Concurrency/replay scenario:
  - The signature RPC commits, then a later readiness write fails, and the outer catch treats the whole request like a failure.
- Exact files/functions involved:
  - `D:\Memory Lane App\lib\services\care-plan-esign-public.ts` - `submitPublicCarePlanSignature`
- What duplicate/conflicting state could happen:
  - Signed care plan row, stale readiness status, and cleaned-up storage artifacts can diverge.
- Recommended protection:
  - Move readiness advancement into the canonical SQL boundary or make it best-effort only after commit.
- Blocks launch: Yes

### Finding I2
- Severity: Medium
- Workflow name: Enrollment packet filed -> downstream mapping
- Concurrency/replay scenario:
  - Other readers can observe `filed/completed` before downstream mapping finishes.
- Exact files/functions involved:
  - `D:\Memory Lane App\lib\services\enrollment-packets-public-runtime.ts`
  - `D:\Memory Lane App\lib\services\enrollment-packet-completion-cascade.ts`
- What duplicate/conflicting state could happen:
  - Staff can see the packet as done while operational handoff is still pending.
- Recommended protection:
  - Keep operational readiness separate and authoritative everywhere staff make downstream decisions.
- Blocks launch: No

### Finding I3
- Severity: Low
- Workflow name: Intake signed -> immediate draft POF verification
- Concurrency/replay scenario:
  - A draft POF may be committed before the immediate reload verifies it.
- Exact files/functions involved:
  - `D:\Memory Lane App\app\intake-actions.ts`
  - `D:\Memory Lane App\lib\services\physician-orders-supabase.ts`
- What duplicate/conflicting state could happen:
  - Staff may briefly see "verification follow-up needed" while the draft already exists.
- Recommended protection:
  - Keep the dedicated committed-readback-miss path and do not collapse it back into a hard failure.
- Blocks launch: No

## 5. Durability Risks

### Finding D1
- Severity: High
- Workflow name: Public care plan caregiver signing
- Exact files/functions involved:
  - `D:\Memory Lane App\lib\services\care-plan-esign-public.ts`
- What success currently means:
  - The finalization RPC may already have committed the signed care plan and member-file metadata.
- What may fail underneath:
  - The later readiness write can still throw, and cleanup can still remove storage objects after commit.
- Why that is unsafe:
  - This creates false failure plus artifact drift after legal signature completion.
- Recommended correction:
  - Never run destructive cleanup after finalization succeeds.
- Blocks launch: Yes

### Finding D2
- Severity: High
- Workflow name: Signed POF -> queued downstream sync
- Exact files/functions involved:
  - `D:\Memory Lane App\lib\services\pof-post-sign-runtime.ts`
  - `D:\Memory Lane App\lib\services\physician-orders-supabase.ts`
  - `D:\Memory Lane App\lib\services\physician-order-post-sign-runtime.ts`
- What success currently means:
  - The POF signature is durable.
- What may fail underneath:
  - Downstream sync can remain queued indefinitely if the retry runner is unhealthy.
- Why that is unsafe:
  - Clinical read models can lag the source-of-truth order.
- Recommended correction:
  - Treat runner config, invocation, and aged-queue alert ownership as production-critical.
- Blocks launch: Yes, if the queue runner is not healthy

### Finding D3
- Severity: Medium
- Workflow name: Generated/member-file persistence during document workflows
- Exact files/functions involved:
  - `D:\Memory Lane App\lib\services\member-files.ts`
  - `D:\Memory Lane App\lib\services\enrollment-packet-artifacts.ts`
- What success currently means:
  - Storage upload happens first, then the DB row/link is written.
- What may fail underneath:
  - If the DB write fails and cleanup also fails, storage orphan drift is still possible.
- Why that is unsafe:
  - It does not create false success, but it can leave storage and DB slightly out of sync until cleanup or repair.
- Recommended correction:
  - Keep the current alert-backed cleanup, and consider a recurring orphan-storage reconciliation check.
- Blocks launch: No

## 6. ACID Hardening Plan

1. Fix the care plan public-signing rollback bug first.
2. Treat signed POF retry-runner health as release-blocking infrastructure.
3. Keep packet/intake/care-plan readiness labels stronger than raw workflow status.
4. Decide whether PRN sync should stay refresh-driven or move into the signed-POF post-sign boundary.
5. Add recurring orphan-storage reconciliation for member-file and packet artifact storage.

## 7. Suggested Codex Prompts

### Prompt 1
Audit and fix `D:\Memory Lane App\lib\services\care-plan-esign-public.ts`.

Problem:
- `submitPublicCarePlanSignature` still calls `markCarePlanPostSignReady` after `rpc_finalize_care_plan_caregiver_signature`.
- That later write is still inside the outer catch path.
- If it fails, the code can clean up already-committed artifacts and surface a false caregiver-facing failure.

What to do:
- Make cleanup pre-finalization only.
- After finalization succeeds, treat readiness and telemetry as best-effort only, or move readiness into the finalization RPC.
- Preserve replay safety and consumed-token behavior.

Validation:
- Run `npm run typecheck`.
- Confirm a committed caregiver signature can never return a failure or delete committed artifacts.

### Prompt 2
Harden production readiness for signed POF post-sign sync.

Scope:
- `D:\Memory Lane App\lib\services\pof-post-sign-runtime.ts`
- `D:\Memory Lane App\lib\services\physician-orders-supabase.ts`
- `D:\Memory Lane App\lib\services\physician-order-post-sign-runtime.ts`
- any deployment/runtime health checks tied to the retry runner

Goal:
- Make it obvious when production is unhealthy because the POF retry runner is missing or stuck.

Validation:
- Run `npm run typecheck`.
- Show the exact operator-facing signal for missing runner config or aged queued sync work.

### Prompt 3
Review whether PRN sync from signed POF standing orders should stay read-triggered or become part of the signed-POF post-sign boundary.

Scope:
- `D:\Memory Lane App\lib\services\mar-prn-workflow.ts`
- `D:\Memory Lane App\lib\services\mar-workflow-read.ts`
- `D:\Memory Lane App\supabase\migrations\0167_prn_sync_from_checked_pof_standing_orders.sql`
- `D:\Memory Lane App\supabase\migrations\0155_signed_pof_post_sign_sync_rpc_consolidation.sql`

Goal:
- Decide whether MAR PRN truth should update only on MAR refresh or immediately after a signed POF.

Validation:
- Run `npm run typecheck`.
- Explain the tradeoff in plain English and recommend the smallest production-safe option.

## 8. Fix First Tonight

- Remove post-commit cleanup from public care plan caregiver signing.
- Verify the signed POF retry runner is configured, invoked, and watched in production.
- Keep the new lead conversion and idempotency hardening intact.

## 9. Automate Later

- Add a regression test proving a committed care plan caregiver signature can never surface a failure afterward.
- Add a deployment check for missing POF retry-runner config.
- Add a recurring orphan-storage reconciliation audit for member files and packet artifacts.
- Add a recurring audit that flags any workflow where post-commit catch blocks still do destructive cleanup.

## 10. Founder Summary: What changed since the last run

- Improved:
  - Lead conversion is stronger now. `0161_restore_lead_conversion_wrapper_security.sql` restored `SECURITY DEFINER`, narrowed caller roles, and still keeps shell-presence assertions from the earlier hardening.
- Improved:
  - Enrollment packet lifecycle and replay safety are stronger. `0162_enrollment_packet_status_coupled_constraints.sql`, `0164_enrollment_packet_follow_up_queue_actor_profile_fks.sql`, `0165_idempotency_write_roots_and_dedupe_contracts.sql`, and the current artifact code now enforce stricter packet status truth, follow-up actor integrity, deduped upload fingerprints, and deduped observability writes.
- Improved:
  - MAR/PRN write-path safety is stronger. `lib/services/mar-prn-workflow.ts` now uses idempotency keys for PRN administration/order creation, and `lib/services/mar-workflow-read.ts` refreshes active PRN orders when MAR data refreshes.
- Improved:
  - Member-file persistence remains stronger after the face-sheet/member-files work. Generated documents still upload storage first, but cleanup and alerting are clearer, and member-file delete still stops before deleting the DB row if storage cleanup fails.
- Unchanged high-risk concern:
  - Public care plan caregiver signing is still the main launch blocker. The rollback-after-commit bug from the last run is still present in the current tree.
- Still needs operational verification:
  - Signed POF queue-backed downstream sync is safer in code, but the real production safety still depends on the retry runner being live and monitored.
