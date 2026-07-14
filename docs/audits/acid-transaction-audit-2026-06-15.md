# Memory Lane ACID Transaction Audit

Date: 2026-06-15
Scope: lead -> member conversion, enrollment packet completion, intake -> POF generation, POF signed -> MHP/MCC/MAR cascade, care plan finalize/sign, member-file persistence, MAR generation, and public token flows.

## 1. Executive Summary

- Overall ACID safety rating: 5/10
- Overall verdict: Fragile
- Top 5 ACID risks:
  - Public POF replay losers can overwrite and then delete already-committed signed artifacts.
  - Public care plan replay losers can overwrite and then delete already-committed signed artifacts.
  - Lead conversion still trusts `p_existing_member_id` too much and can rewire the wrong member to a lead.
  - Enrollment packet completion is still split across a committed finalize RPC and later artifact/mapping/notification work.
  - Care plan final signed files still use one shared `document_source` value that can collide across tracks for the same member.
- Strongest workflows:
  - Intake -> draft POF creation is one of the strongest paths right now. It uses row locks plus a unique DB guard to prevent duplicate draft/sent orders.
  - Generated member PDF replacement is materially safer than before. The code now reuses the canonical row and only deletes old storage after persistence is verified.
  - Enrollment packet public completion is safer than the last audit because follow-up truth now fails closed if the completion follow-up status itself cannot be persisted.
- Short founder summary:
  - Memory Lane has real hardening in place, but three launch-blocking risks are still open: public POF replay cleanup, public care plan replay cleanup, and lead conversion trusting the wrong existing member.

## 2. Atomicity Violations

- Severity: Critical
  - Workflow: Public POF signature completion
  - Exact files/functions/modules: `lib/services/pof-esign-public.ts` `submitPublicPofSignature`, `lib/services/member-files-repository.ts` `uploadMemberDocumentObject`
  - What should happen: Only the winning submit should create or retain the final signed PDF and signature artifact.
  - What currently happens: The code uploads to canonical storage paths before `rpc_finalize_pof_signature` decides the winner, and replay losers still call cleanup on those same canonical paths.
  - How partial failure could occur: A double-submit can overwrite committed files and then delete them, leaving the database pointing at missing storage.
  - Recommended fix: Upload to unique temporary paths, finalize first, then promote or relink only for the winner. Never delete canonical artifacts on `was_already_signed`.
  - Blocks launch: Yes

- Severity: Critical
  - Workflow: Public care plan caregiver signature completion
  - Exact files/functions/modules: `lib/services/care-plan-esign-public.ts` `submitPublicCarePlanSignature`, `lib/services/member-files-repository.ts` `uploadMemberDocumentObject`
  - What should happen: Only the winning caregiver-sign request should own the final signed PDF and signature artifact.
  - What currently happens: The code uploads to canonical storage paths before `rpc_finalize_care_plan_caregiver_signature` settles the request, and replay losers still clean up those same paths.
  - How partial failure could occur: A replay loser can overwrite the committed file and then delete it, causing storage drift after the workflow already succeeded.
  - Recommended fix: Same pattern as POF. Use temp object keys, promote only after finalize wins, and skip cleanup of canonical artifacts on replay.
  - Blocks launch: Yes

- Severity: High
  - Workflow: Enrollment packet completion
  - Exact files/functions/modules: `supabase/migrations/0180_enrollment_completion_follow_up_state.sql` `rpc_finalize_enrollment_packet_submission`, `lib/services/enrollment-packets-public-runtime.ts`, `lib/services/enrollment-packets-public-runtime-post-commit.ts`, `lib/services/enrollment-packets-public-runtime-cascade.ts`
  - What should happen: Completed packet status, artifacts, downstream mapping, lead activity, and notifications should either all land together or the workflow should clearly stay incomplete.
  - What currently happens: The finalize RPC commits `status='completed'` first. Artifact persistence and downstream mapping happen afterward.
  - How partial failure could occur: The packet can be legally completed while artifact linkage, downstream mapping, or follow-up delivery still fails later.
  - Recommended fix: Keep the current explicit follow-up truth, but move more of the post-commit work behind either one RPC boundary or a first-class staged state machine with a dedicated retry worker.
  - Blocks launch: No, because the workflow now fails closed on follow-up-state persistence and returns explicit `action_required` truth.

## 3. Consistency Gaps

- Severity: Critical
  - Affected schema/business rule: Canonical lead/member identity during lead conversion
  - Exact files/migrations/services involved: `lib/services/sales-lead-conversion-supabase.ts`, `supabase/migrations/0158_lead_conversion_shell_success_guard.sql`
  - What invariant is not enforced: `p_existing_member_id` is not verified to already belong to the same lead or to a safe canonical merge target.
  - Why it matters: One bad ID can overwrite member demographics, force `source_lead_id` to a different lead, and corrupt downstream shell ownership.
  - Recommended DB/service fix: In the RPC, reject any `p_existing_member_id` whose `source_lead_id` is non-null and not equal to `p_lead_id`. If re-linking is allowed, require an explicit, audited merge workflow instead of the normal conversion path.
  - Blocks launch: Yes

- Severity: High
  - Affected schema/business rule: Care plan final signed file uniqueness
  - Exact files/migrations/services involved: `supabase/migrations/0053_artifact_drift_replay_hardening.sql`, `supabase/migrations/0091_member_files_document_source_unique.sql`, `supabase/migrations/0049_workflow_hardening_constraints.sql`
  - What invariant is not enforced: The app allows multiple care-plan tracks per member, but all final signed care plans still reuse `document_source = 'Care Plan Final Signed'`.
  - Why it matters: A member with more than one care-plan track can hit a unique-index collision while saving a second final signed care plan.
  - Recommended DB/service fix: Make `document_source` care-plan-specific, for example `care_plan_final_signed:<care_plan_id>`, backfill old rows, and keep one canonical row per care plan instead of one per member.
  - Blocks launch: Likely if multiple tracks are used in practice; otherwise high but latent.

## 4. Isolation Risks

- Severity: Critical
  - Workflow name: Public POF signing
  - Concurrency/replay scenario: Provider double-clicks, browser retries, or two tabs submit the same token nearly at once.
  - Exact files/functions involved: `lib/services/pof-esign-public.ts` lines around the pre-RPC uploads and `if (finalized.was_already_signed)`, plus `lib/services/member-files-repository.ts` `uploadMemberDocumentObject` with `upsert: true`
  - What duplicate/conflicting state could happen: Two requests race on the same storage object paths; the loser can overwrite or delete the winner’s committed files.
  - Recommended protection: Use per-attempt temporary storage keys and only promote on the winning finalize path. Keep replay losers read-only once the request is known committed.
  - Blocks launch: Yes

- Severity: Critical
  - Workflow name: Public care plan caregiver signing
  - Concurrency/replay scenario: Caregiver double-submits or retries after a slow network response.
  - Exact files/functions involved: `lib/services/care-plan-esign-public.ts` lines around the pre-RPC uploads and `if (finalized.wasAlreadySigned)`, plus `lib/services/member-files-repository.ts`
  - What duplicate/conflicting state could happen: The losing request can overwrite or delete the already-committed signed PDF and signature image.
  - Recommended protection: Same replay-safe storage strategy as POF.
  - Blocks launch: Yes

- Severity: Medium
  - Workflow name: Lead conversion to an existing member
  - Concurrency/replay scenario: Two admins convert or relink the same lead while passing different `existingMemberId` values.
  - Exact files/functions involved: `lib/services/sales-lead-conversion-supabase.ts` `applyLeadStageTransitionWithMemberUpsertSupabase`, `supabase/migrations/0158_lead_conversion_shell_success_guard.sql`
  - What duplicate/conflicting state could happen: The lead can be rebound to the wrong member shell, and later flows will treat that corrupted identity as canonical.
  - Recommended protection: Add strict ownership checks in the RPC and reject the request unless the existing member is already canonically tied to that lead or an explicit merge path authorizes it.
  - Blocks launch: Yes

## 5. Durability Risks

- Severity: High
  - Workflow name: Enrollment packet completion
  - Exact files/functions involved: `lib/services/enrollment-packets-public-runtime-cascade.ts`, `lib/services/enrollment-packets-public-runtime-follow-up.ts`, `lib/services/enrollment-packet-mapping-runtime.ts`
  - What success currently means: The caregiver submission is committed, and the system then tries to finish artifacts, mapping, lead activity, and notifications.
  - What may fail underneath: Artifact linkage, downstream mapping, lead activity sync, or notification delivery can still fail after the packet is already completed.
  - Why that is unsafe: Staff can have a completed packet that still needs manual downstream repair.
  - Recommended correction: Keep the new fail-closed follow-up truth, and add a dedicated retry/repair runner for every post-commit step that is still required before operational readiness.
  - Blocks launch: No, but staff should treat `completion_follow_up_status` as the real handoff truth.

- Severity: Medium
  - Workflow name: Signed POF -> MHP/MCC/MAR cascade
  - Exact files/functions involved: `supabase/migrations/0155_signed_pof_post_sign_sync_rpc_consolidation.sql`, `lib/services/physician-order-post-sign-service.ts`, `lib/services/physician-order-clinical-sync.ts`, `lib/services/physician-orders-supabase.ts`
  - What success currently means: Legal provider signature is durable first; downstream clinical sync may finish immediately or get queued.
  - What may fail underneath: MHP/MCC sync or MAR reconciliation can still fail and move the workflow into queued or follow-up-required status.
  - Why that is unsafe: A signed order is not automatically operationally ready.
  - Recommended correction: Keep the queue, but tighten repair visibility and add automated stale-queue escalation. This is a managed staged workflow, not a hidden failure anymore.
  - Blocks launch: No

- Severity: Medium
  - Workflow name: Care plan nurse-sign finalize/sign workflow
  - Exact files/functions involved: `lib/services/care-plans-supabase.ts`, `lib/services/care-plan-nurse-esign.ts`
  - What success currently means: Nurse signature can commit before version snapshot persistence and caregiver dispatch fully finish.
  - What may fail underneath: Snapshot persistence or caregiver dispatch can fail after the care plan is already signed.
  - Why that is unsafe: The legal signature can exist while follow-up work still needs repair.
  - Recommended correction: Keep staged readiness states, but consider a single RPC boundary for snapshot persistence or a stronger post-sign repair worker if this workflow keeps producing follow-up load.
  - Blocks launch: No

## 6. ACID Hardening Plan

1. Patch the two public signing blockers first.
2. Add strict ownership validation to lead conversion for `p_existing_member_id`.
3. Make care-plan final signed `document_source` unique per care plan instead of shared per member.
4. Keep enrollment packet completion staged, but make every required post-commit step retryable and auditable from one queue/dashboard.
5. Expand regression tests for double-submit, replay-loser cleanup, and committed-but-not-ready states.

## 7. Suggested Codex Prompts

1. `Audit and patch lib/services/pof-esign-public.ts so replay losers never upload to or delete canonical signed artifact paths. Use temporary storage keys, preserve committed artifacts, and add regression tests for double-submit and retry races.`

2. `Audit and patch lib/services/care-plan-esign-public.ts so caregiver replay losers cannot overwrite or delete committed signed care plan artifacts. Keep the current RPC boundary, move uploads to temporary keys, and add regression tests.`

3. `Harden lead conversion by updating supabase/migrations/0158_lead_conversion_shell_success_guard.sql (or a new forward-only migration) so p_existing_member_id is rejected unless it is already canonically linked to the same lead or an explicit merge workflow authorizes it. Then align lib/services/sales-lead-conversion-supabase.ts tests and callers.`

4. `Fix the care-plan final signed member-file collision by making document_source unique per care_plan_id, adding a forward-only migration/backfill, and updating public/private care-plan finalize flows to reuse the care-plan-specific source.`

5. `Add ACID regression coverage for public token double-submit across POF, care plan, and enrollment packet flows, focusing on storage overwrite/delete drift after committed success.`

## 8. Fix First Tonight

- Stop replay-loser cleanup from deleting canonical public POF signed artifacts.
- Stop replay-loser cleanup from deleting canonical public care plan signed artifacts.
- Add `p_existing_member_id` ownership validation in lead conversion.
- If time remains, fix the care-plan `document_source` collision before more care-plan signing volume lands.

## 9. Automate Later

- Daily regression tests that simulate double-submit on all public token workflows.
- A storage-vs-row drift audit for signed POFs, signed care plans, and completed enrollment packets.
- A daily queue health job for signed POF post-sign sync and enrollment packet mapping retry queues.
- A nightly query that finds leads whose `source_lead_id` or member shell ownership changed in unexpected ways.
- A migration lint that rejects shared `document_source` literals for workflows that can have more than one canonical artifact per member.

## 10. Founder Summary: What changed since the last run

- Better since last run:
  - Enrollment packet completion follow-up truth now fails closed if the follow-up state itself cannot be saved. That closes a false-success path.
  - Enrollment packet downstream mapping and MCC/MHP write paths now hard-fail when canonical member shells are missing instead of silently creating shells at runtime.
  - Signed POF downstream sync now has an explicit member-id ambiguity fix and clearer status assertions.
  - Enrollment-packet lead activity syncing now carries an explicit packet foreign key and stricter idempotency handling.
  - Generated member PDFs now replace the canonical file row and only delete superseded storage after persistence is verified.

- Still open since last run:
  - Public POF replay loser artifact overwrite/delete bug.
  - Public care plan replay loser artifact overwrite/delete bug.
  - Lead conversion trusting arbitrary `p_existing_member_id`.
  - Enrollment packet completion still split across finalize RPC and later post-commit work.
  - Care-plan final signed `document_source` collision risk.

- Bottom line:
  - The codebase is safer than the May 12 audit on staged follow-up truth and shell canonicality, but the most dangerous public-signing replay blockers are still not closed.
