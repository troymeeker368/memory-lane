# Memory Lane ACID Transaction Audit - 2026-03-30

## 1. Executive Summary

- Overall ACID safety rating: 8.2/10
- Overall verdict: Partial
- Top 5 ACID risks:
  1. Shared generated member-file persistence now looks like the highest-priority durability risk. A post-write readback miss in `lib/services/member-files.ts` can delete the new storage object after the database row was already updated or created.
  2. Signed POF downstream sync still depends on the retry runner actually being configured and monitored in production.
  3. Enrollment packet completion is still intentionally staged. The packet can be durably filed before downstream MCC/MHP/POF mapping finishes.
  4. Intake signing is still intentionally staged. Draft POF creation and Member Files PDF persistence happen after the signed intake commit.
  5. Command Center member-file upload still has a false-failure path if the row reload misses after a likely committed write.
- Strongest workflows:
  - Lead -> member conversion remains one of the strongest workflows. It stays inside the canonical RPC boundary and now has DB-backed idempotency protection for create-and-convert.
  - Public enrollment packet replay protection remains strong. Token consumption, upload fingerprint dedupe, and explicit mapping-readiness states are still in place.
  - Public care plan caregiver signing is materially safer than yesterday. The confirmed post-commit cleanup bug from the last run appears fixed.
- Short founder summary:
  - The biggest improvement since yesterday is that the care plan caregiver-sign false-failure regression appears fixed.
  - The biggest new concern is broader than one workflow: the shared generated-PDF member-file helper can now create DB/storage drift across intake, MAR, care plan, face sheet, diet card, and other document flows.
  - The repo is still using explicit staged completion for enrollment packet, intake, and signed-POF follow-up. That is acceptable only if every staff-facing surface respects the follow-up/readiness states.

## 2. Atomicity Violations

### Finding A1
- Severity: High
- Workflow name: Generated PDF -> Member Files persistence across multiple workflows
- Exact files/functions/modules:
  - `D:\Memory Lane App\lib\services\member-files.ts` - `saveGeneratedMemberPdfToFiles`
  - `D:\Memory Lane App\app\intake-actions.ts`
  - `D:\Memory Lane App\app\(portal)\health\mar\actions-impl.ts`
  - `D:\Memory Lane App\app\(portal)\health\care-plans\[carePlanId]\actions.ts`
  - `D:\Memory Lane App\app\(portal)\members\[memberId]\face-sheet\actions.ts`
- What should happen:
  - Once a member-file row is durably updated or created, later readback trouble must not delete the newly written storage object.
  - Replacement-by-document-source should stay a single canonical file, not risk a second create path.
- What currently happens:
  - In the replacement path, the helper uploads the new PDF, upserts the `member_files` row, then does an immediate reload.
  - If that reload throws, the catch deletes the uploaded storage object and rethrows.
  - In the create path, the helper also uploads first, writes the row, reloads, and deletes the object on readback failure.
- How partial failure could occur:
  - The DB row may already be committed and point to the new storage path.
  - The later readback failure then deletes the file, leaving Supabase metadata pointing at a missing object.
  - In the replacement branch, if `updated` ends up falsy after the write, the code can fall through into the create branch and risk duplicate file rows.
- Recommended fix:
  - Split pre-commit and post-commit failure handling.
  - After `upsertMemberFileByDocumentSource` succeeds, never delete the new storage object just because the verification read missed.
  - Return a committed-but-needs-verification result or queue a follow-up task instead.
  - Make the replace-existing path exit deterministically after a successful upsert so it cannot fall through to the create path.
- Blocks launch: Yes

### Finding A2
- Severity: Medium
- Workflow name: Enrollment packet completion -> filed packet -> downstream mapping cascade
- Exact files/functions/modules:
  - `D:\Memory Lane App\lib\services\enrollment-packets-public-runtime.ts` - `submitPublicEnrollmentPacket`
  - `D:\Memory Lane App\lib\services\enrollment-packet-completion-cascade.ts` - `runEnrollmentPacketCompletionCascade`
- What should happen:
  - Filing and downstream handoff would ideally be one durable operational boundary, or every downstream workflow must explicitly treat the packet as "filed but not ready."
- What currently happens:
  - The packet is durably finalized first.
  - The downstream mapping cascade runs after that commit.
  - If mapping fails, the code does persist failed mapping state and raises action-required alerts instead of pretending success.
- How partial failure could occur:
  - The packet can be legally filed while MCC/MHP/POF sync is still pending or failed.
- Recommended fix:
  - Keep the staged model, but keep `mapping_sync_status` and operational readiness authoritative everywhere staff make downstream decisions.
- Blocks launch: No

### Finding A3
- Severity: Medium
- Workflow name: Intake signed -> draft POF creation -> Intake PDF to Member Files
- Exact files/functions/modules:
  - `D:\Memory Lane App\app\intake-actions.ts`
  - `D:\Memory Lane App\lib\services\physician-orders-supabase.ts`
  - `D:\Memory Lane App\lib\services\intake-post-sign-follow-up.ts`
  - `D:\Memory Lane App\lib\services\intake-post-sign-readiness.ts`
- What should happen:
  - Operational completion should mean the intake is signed, the draft POF exists, and the intake PDF is durably filed.
- What currently happens:
  - The intake signature commit lands first.
  - Draft POF creation and PDF filing happen afterward.
  - The flow now correctly distinguishes a committed draft-POF readback miss from a true create failure.
- How partial failure could occur:
  - Intake can be signed while the draft POF or member-file PDF still needs follow-up.
- Recommended fix:
  - Keep the staged model, but continue treating `post_sign_readiness_status` as the operational completion signal, not raw signature state.
- Blocks launch: No

## 3. Consistency Gaps

### Finding C1
- Severity: High
- Affected schema/business rule:
  - `member_files.storage_object_path` and the actual storage object can diverge after a post-write readback failure.
- Exact files/migrations/services involved:
  - `D:\Memory Lane App\lib\services\member-files.ts`
  - `D:\Memory Lane App\supabase\migrations\0091_member_files_document_source_unique.sql`
- What invariant is not enforced:
  - "If the database says the file exists at this storage path, that object still exists."
- Why it matters:
  - Intake PDFs, care plan PDFs, MAR documents, and other generated records can look persisted in Supabase while the actual file was deleted by cleanup logic.
- Recommended DB/service fix:
  - Treat readback verification as post-commit verification, not part of destructive rollback logic.
  - Add an explicit action-needed or verification queue path when the row cannot be reloaded after a likely committed write.
- Blocks launch: Yes

### Finding C2
- Severity: Medium
- Affected schema/business rule:
  - Signed POF status still does not itself guarantee downstream MHP/MCC/MAR sync is complete.
- Exact files/migrations/services involved:
  - `D:\Memory Lane App\lib\services\pof-esign-public.ts`
  - `D:\Memory Lane App\lib\services\pof-post-sign-runtime.ts`
  - `D:\Memory Lane App\app\api\internal\pof-post-sign-sync\route.ts`
  - `D:\Memory Lane App\supabase\migrations\0097_pof_post_sign_retry_claim_rpc.sql`
  - `D:\Memory Lane App\supabase\migrations\0155_signed_pof_post_sign_sync_rpc_consolidation.sql`
- What invariant is not enforced:
  - "Signed POF" and "downstream clinical sync complete" are still separate truths.
- Why it matters:
  - A legally signed order can exist while MHP, MCC, or MAR still lags behind if the retry runner is unhealthy.
- Recommended DB/service fix:
  - Keep the queue-backed model, but treat runner health, queue age monitoring, and configuration checks as release-critical.
- Blocks launch: No, if the runner is healthy

### Finding C3
- Severity: Medium
- Affected schema/business rule:
  - Command Center manual upload can still tell staff the upload failed even after storage and row write likely succeeded.
- Exact files/migrations/services involved:
  - `D:\Memory Lane App\lib\services\member-files.ts` - `saveCommandCenterMemberFileUpload`
- What invariant is not enforced:
  - "If the system returns failure, the upload definitely did not persist."
- Why it matters:
  - Staff can retry a document upload after a false failure and create confusion around what actually saved.
- Recommended DB/service fix:
  - Treat reload-miss after upsert as committed-but-unverified and alert/queue follow-up instead of surfacing a hard failure.
- Blocks launch: No

## 4. Isolation Risks

### Finding I1
- Severity: High
- Workflow name: Shared generated member-file saves
- Concurrency/replay scenario:
  - Two near-simultaneous document generations for the same `document_source` or replacement target can race around upload, upsert, readback, and cleanup.
- Exact files/functions involved:
  - `D:\Memory Lane App\lib\services\member-files.ts` - `saveGeneratedMemberPdfToFiles`
- What duplicate/conflicting state could happen:
  - One request may commit the DB row while the other request's cleanup deletes the uploaded object.
  - The replacement branch can also fall through into the create branch if verification data is missing, increasing duplicate-risk behavior.
- Recommended protection:
  - Make the helper treat successful upsert as the commit boundary.
  - Stop destructive cleanup after that point.
  - Return a committed-verification-pending status instead of falling through or rolling back storage.
- Blocks launch: Yes

### Finding I2
- Severity: Medium
- Workflow name: Signed POF queue processing
- Concurrency/replay scenario:
  - Multiple runner invocations could claim the same work if queue claiming were weak.
- Exact files/functions involved:
  - `D:\Memory Lane App\app\api\internal\pof-post-sign-sync\route.ts`
  - `D:\Memory Lane App\supabase\migrations\0097_pof_post_sign_retry_claim_rpc.sql`
- What duplicate/conflicting state could happen:
  - The current queue claim RPC uses `FOR UPDATE SKIP LOCKED`, which is good and lowers the double-processing risk.
  - The remaining isolation risk is less about row locking and more about no active runner being there to process aged queued work.
- Recommended protection:
  - Keep the existing queue claim lock model.
  - Add environment-level ownership for runner health and aged-queue alarms.
- Blocks launch: No, if monitored

### Finding I3
- Severity: Medium
- Workflow name: Enrollment packet filed -> downstream mapping
- Concurrency/replay scenario:
  - Other readers can observe `filed` before the mapping cascade finishes.
- Exact files/functions involved:
  - `D:\Memory Lane App\lib\services\enrollment-packets-public-runtime.ts`
  - `D:\Memory Lane App\lib\services\enrollment-packet-public-helpers.ts`
- What duplicate/conflicting state could happen:
  - Staff can treat the packet as fully done while operational sync is still pending.
- Recommended protection:
  - Keep operational readiness and `mapping_sync_status` visible and authoritative in every staff-facing workflow.
- Blocks launch: No

## 5. Durability Risks

### Finding D1
- Severity: High
- Workflow name: Generated PDF persistence into Member Files
- Exact files/functions involved:
  - `D:\Memory Lane App\lib\services\member-files.ts`
- What success currently means:
  - The new PDF object was uploaded and the `member_files` row was likely written.
- What may fail underneath:
  - The immediate verification read can still fail.
  - The catch then deletes the storage object even though the database may already reference it.
- Why that is unsafe:
  - This can create silent DB/storage drift across multiple operational document workflows.
- Recommended correction:
  - Treat verification failure as action-needed, not destructive rollback.
- Blocks launch: Yes

### Finding D2
- Severity: High
- Workflow name: Signed POF -> queued downstream sync
- Exact files/functions involved:
  - `D:\Memory Lane App\lib\services\pof-post-sign-runtime.ts`
  - `D:\Memory Lane App\app\api\internal\pof-post-sign-sync\route.ts`
- What success currently means:
  - The POF signature is durable and the first sync attempt was made or queued.
- What may fail underneath:
  - If the retry runner is not configured, queued work can sit indefinitely.
- Why that is unsafe:
  - Clinical read models can lag the canonical signed order.
- Recommended correction:
  - Treat runner configuration and monitoring as production-critical, not optional background plumbing.
- Blocks launch: Yes, if the queue runner is not healthy

### Finding D3
- Severity: Medium
- Workflow name: Command Center manual member-file upload
- Exact files/functions involved:
  - `D:\Memory Lane App\lib\services\member-files.ts` - `saveCommandCenterMemberFileUpload`
- What success currently means:
  - Storage upload and member-file upsert likely succeeded.
- What may fail underneath:
  - The row reload can miss and throw a hard failure.
- Why that is unsafe:
  - Staff can be told the upload failed even after a likely committed write.
- Recommended correction:
  - Return committed-but-unverified plus an alert or follow-up task rather than a hard failure.
- Blocks launch: No

## 6. ACID Hardening Plan

1. Fix `saveGeneratedMemberPdfToFiles` first.
2. Reuse that same committed-but-verification-pending pattern in `saveCommandCenterMemberFileUpload`.
3. Confirm the POF post-sign retry runner is configured in the real environment and add aged-queue monitoring if it is not already there.
4. Keep staged workflows honest by making every staff-facing screen prefer readiness/follow-up truth over raw signed/filed truth.
5. Add a recurring reconciliation check for `member_files.storage_object_path` vs actual storage objects so drift can be repaired early.

## 7. Suggested Codex Prompts

### Prompt 1
Audit and fix `D:\Memory Lane App\lib\services\member-files.ts`.

Problem:
- `saveGeneratedMemberPdfToFiles` uploads a new PDF, writes `member_files`, then does an immediate verification read.
- If that read fails, the catch deletes the storage object even though the DB row may already be committed.
- The replace-existing path can also fall through into the create path after a successful upsert if verification data is missing.

What to do:
- Treat successful `upsertMemberFileByDocumentSource` as the commit boundary.
- Never delete the new storage object after that point just because the verification read missed.
- Return a committed-but-verification-pending result or queue a follow-up task instead.
- Make the replace-existing path exit deterministically after a successful upsert.

Validation:
- Run `npm run typecheck`.
- Confirm intake, MAR, care plan, face sheet, and other generated-PDF flows cannot delete committed files after a post-write readback miss.

### Prompt 2
Audit and harden `D:\Memory Lane App\lib\services\member-files.ts` manual upload handling.

Problem:
- `saveCommandCenterMemberFileUpload` uploads storage, upserts the row, then throws a hard failure if the row reload misses.
- That can surface false failure after a likely committed write.

What to do:
- Rework the function so post-write reload failure becomes action-needed or alert-backed verification follow-up, not a user-facing hard failure.
- Preserve current authorization and cleanup behavior for true pre-commit failures.

Validation:
- Run `npm run typecheck`.
- Confirm staff cannot be told an upload failed after storage plus DB write already succeeded.

### Prompt 3
Audit the real deployment readiness of signed-POF post-sign sync.

Problem:
- The code path is queue-safe, but durability still depends on `/api/internal/pof-post-sign-sync` actually being configured and invoked in production.

What to do:
- Verify the environment has `POF_POST_SIGN_SYNC_SECRET` or `CRON_SECRET`.
- Verify the runner is scheduled and alerts on aged queued rows.
- If any of that is missing, add the smallest production-safe monitoring and operational documentation needed.

Validation:
- Show how queued POF post-sign rows are claimed, retried, and alerted when stuck.

## 8. Fix First Tonight

- Fix `saveGeneratedMemberPdfToFiles` first.
- Reason:
  - It is a shared helper used by multiple workflows, not just one screen.
  - It can create false failure and real DB/storage drift after a likely committed write.
  - A single fix here improves intake, care plan, MAR, face sheet, diet card, physician orders, incident artifacts, and other generated-document flows at once.

## 9. Automate Later

- Add a nightly reconciliation audit for `member_files.storage_object_path` vs real storage objects.
- Add an automated alert for aged `pof_post_sign_sync_queue` rows that stay queued or processing too long.
- Add a recurring check for action-needed workflows stuck in staged states for too long:
  - enrollment packet mapping pending/failed
  - intake post-sign follow-up
  - care plan post-sign readiness

## 10. Founder Summary: What changed since the last run

- Improved since yesterday:
  - The care plan caregiver-sign regression from the 2026-03-29 run appears fixed. The current code now limits destructive cleanup to the pre-finalization path and treats post-commit readiness failure as alert-backed follow-up instead of deleting committed artifacts.
- New concern found today:
  - The highest-priority current risk is now in the shared member-file helper, not care plan signing. `saveGeneratedMemberPdfToFiles` can delete a newly uploaded storage object after a likely committed DB write if the immediate verification read fails.
- Still open from yesterday:
  - Signed POF downstream sync still depends on the retry runner being configured and monitored in the real environment.
  - Enrollment packet and intake remain intentionally staged after the first durable commit. That is okay only if staff-facing surfaces continue to respect readiness/follow-up truth.
- Bottom line:
  - Yesterday's biggest launch-blocking care-plan bug appears closed.
  - Tonight's best risk-reduction move is to harden shared member-file persistence.
