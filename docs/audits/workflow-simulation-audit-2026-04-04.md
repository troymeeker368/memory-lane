# Workflow Lifecycle Simulation Audit
Generated: 2026-04-04
Repository: `D:\Memory Lane App`
Method: workflow simulation script plus direct code inspection
Live checks: not run in this automation pass because a confirmed live app/Supabase test environment was not validated

## 1. Executive Summary

Memory Lane's lifecycle is no longer driven by fake success in the core paths I checked. The strongest areas now use real Supabase-backed writes, canonical identity resolution, and explicit follow-up states when downstream work is not finished.

The main risk is no longer "did the row save at all?" The main risk is "did the downstream clinical workflow finish after the first write committed?" That matters most in three places:

- Signed POF can be durably completed while downstream MHP, MCC, and MAR sync is still queued. That means a legally signed order may still not be operationally ready for staff.
- MAR exception alerts can disappear if notification delivery fails after the medication documentation write succeeds. Nurses could miss a needed follow-up for a `Not Given` dose or an ineffective PRN medication.
- Enrollment packet and intake follow-up are intentionally post-commit in some places. That is safer than fake success, but it still means admins can have a completed upstream step while a downstream operational task is still pending repair.

Good news:

- I did not find runtime mock persistence, localStorage persistence, or fake in-memory substitutes in the audited lifecycle paths.
- Intake, POF signing, care plan signing, and MAR monthly PDF generation all contain explicit "committed but not operationally ready" handling instead of pretending the workflow fully finished.
- Some `ok: true` returns flagged by the raw script are not true silent-success bugs. In several places they are paired with committed workflow state and `actionNeededMessage`, which means the record is saved but the follow-up is still incomplete.

## 2. Lifecycle Handoff Table

| Handoff | Status | What is working | Main risk | Key files/functions |
|---|---|---|---|---|
| Lead -> Send Enrollment Packet | Strong | Canonical lead resolution happens before send; packet send persists through the canonical packet send service. | None identified in the primary send write path. | `app/sales-enrollment-actions.ts` -> `sendEnrollmentPacketAction`; `lib/services/enrollment-packets-send-runtime.ts` -> `sendEnrollmentPacketRequest` |
| Send Enrollment Packet -> Enrollment Packet completion / e-sign return | Strong | Public packet submit path persists signatures/uploads and completes through the public runtime and completion cascade. | Completion is durable, but some downstream readiness checks happen after commit. | `app/sign/enrollment-packet/[token]/actions.ts`; `lib/services/enrollment-packets-public-runtime.ts` -> `submitPublicEnrollmentPacket`; `lib/services/enrollment-packet-completion-cascade.ts` |
| Enrollment Packet completion / e-sign return -> Lead activity logging | Partial | Lead activity sync exists and follow-up warnings are created if it fails. | Lead activity is not in the same commit boundary as packet completion, so sales timeline can lag behind a real completed packet. | `lib/services/enrollment-packet-completion-cascade.ts`; `lib/services/enrollment-packet-mapping-runtime.ts` -> `syncEnrollmentPacketLeadActivityOrQueue` |
| Lead activity logging -> Member creation / enrollment resolution | Strong | Lead conversion uses canonical lead/member resolution and preserves `source_lead_id`. | I did not find fake persistence here. | `app/sales-lead-actions.ts` -> `enrollMemberFromLeadAction`; `lib/services/canonical-person-ref.ts`; lead conversion services |
| Member creation / enrollment resolution -> Intake Assessment | Strong | Intake creation hard-fails on identity mismatch and uses atomic assessment creation. | Intake PDF persistence and draft POF creation happen after signature, not in the first create step. | `app/intake-actions.ts` -> `createAssessmentAction`; `lib/services/intake-pof-mhp-cascade.ts` -> `createIntakeAssessmentWithResponses` |
| Intake Assessment -> Physician Orders / POF generation | Partial | Draft POF creation is real and RPC-backed, not fake. | Draft POF creation runs in the post-sign workflow; if it fails, intake is already signed and staff must clear follow-up tasks before assuming clinical readiness. | `lib/services/intake-pof-mhp-cascade.ts` -> `completeIntakeAssessmentPostSignWorkflow`; `lib/services/physician-orders-supabase.ts` -> `createDraftPhysicianOrderFromAssessment` |
| Physician Orders / POF generation -> Provider signature completion | Strong | POF send/resend/sign paths are canonical and finalize signed artifacts durably. | Delivery and state-finalization are still separate concerns, but explicit failure handling is present. | `app/(portal)/health/physician-orders/actions.ts`; `app/sign/pof/[token]/actions.ts`; `lib/services/pof-esign.ts`; `lib/services/pof-esign-public.ts` |
| Provider signature completion -> MHP generation / sync | Partial | Signed POF finalization is durable and replay-safe. | Downstream sync can fall into the post-sign queue, leaving the order signed but not operationally ready. | `lib/services/pof-esign-public.ts` -> `submitPublicPofSignature`; `lib/services/pof-post-sign-runtime.ts` -> `runBestEffortCommittedPofSignatureFollowUp`; `lib/services/physician-orders-supabase.ts` |
| MHP generation / sync -> MCC visibility | Strong | MCC and MHP read paths are canonical and member-aware. | No major read-path fallback found. | `lib/services/member-health-profiles-read.ts`; `lib/services/member-command-center-runtime.ts`; `lib/services/member-command-center-supabase.ts` |
| MCC visibility -> Care Plan creation / signature workflow | Strong | Care plan create/review/sign flows are canonical and artifact-aware. | No major fake-success issue found in the core care plan persistence path. | `app/care-plan-actions.ts`; `lib/services/care-plans-supabase.ts`; `lib/services/care-plan-esign-public.ts` |
| Care Plan creation / signature workflow -> MAR generation from POF medications | Partial | Signed POF is the real trigger for medication sync and MAR generation. | Care plan completion itself does not guarantee MAR readiness; MAR still depends on POF post-sign sync health. | `lib/services/physician-orders-supabase.ts` -> `processSignedPhysicianOrderPostSignSync`; `lib/services/mar-workflow.ts` |
| MAR generation from POF meds -> MAR documentation workflow | Strong | MAR documentation writes go through canonical service/RPC paths. | Exception notifications are weaker than the medication write itself. | `app/(portal)/health/mar/actions-impl.ts`; `lib/services/mar-workflow.ts`; `lib/services/mar-prn-workflow.ts` |
| MAR documentation workflow -> Monthly MAR summary or PDF generation | Strong | Monthly report generation is canonical and deterministic. | No major persistence gap in report generation itself. | `app/(portal)/health/mar/actions-impl.ts` -> `generateMonthlyMarReportPdfAction`; `lib/services/mar-monthly-report.ts`; `lib/services/mar-monthly-report-pdf.ts` |
| Monthly MAR summary or PDF generation -> Member Files persistence | Strong | MAR monthly PDFs are saved through canonical member-file persistence and verified after save. | If member-file verification fails, the action returns a follow-up-needed state instead of pretending success. | `app/(portal)/health/mar/actions-impl.ts`; `lib/services/member-files.ts` -> `saveGeneratedMemberPdfToFiles` |
| Lifecycle milestones -> Completion notifications or alerts | Partial | There is a real notification engine and workflow milestone recorder. | Some important clinical alert paths still degrade to console logging or follow-up alerts instead of guaranteed user inbox delivery. | `lib/services/lifecycle-milestones.ts`; `lib/services/notifications.ts`; `lib/services/mar-workflow.ts`; `lib/services/mar-prn-workflow.ts` |

## 3. Critical Failures

### 1. Signed POF does not always mean the member is clinically ready downstream

Why this matters:

- A provider can sign the order successfully.
- Staff may assume MHP, MCC, and MAR are ready.
- In reality, those downstream steps can still be queued and waiting on the post-sign sync runner.

What I found:

- `lib/services/pof-esign-public.ts` finalizes the signature through `rpc_finalize_pof_signature`.
- After the signature is durable, `lib/services/pof-post-sign-runtime.ts` runs best-effort follow-up.
- If follow-up fails, the code returns `postSignStatus: "queued"` and an explicit action-needed message instead of claiming readiness.
- The queue runner depends on `app/api/internal/pof-post-sign-sync/route.ts` and environment secrets like `POF_POST_SIGN_SYNC_SECRET` or `CRON_SECRET`.

Why this is a real operational break:

- Nurses and admins can have a signed order that still has not refreshed MHP, MCC, or MAR.
- That is not a legal-signature problem. It is an operational-readiness problem.

### 2. MAR exception notifications can fail without a durable repair record

Why this matters:

- A nurse documenting `Not Given` medication or an ineffective PRN dose should trigger a strong follow-up signal.
- If that alert is lost, the medication write exists but the escalation path can disappear.

What I found:

- `lib/services/mar-workflow.ts` records the MAR administration durably first.
- For `Not Given`, it then tries to emit an `action_required` milestone.
- If that milestone call fails, the code only logs `console.error` and does not create a system alert or repair task.
- `lib/services/mar-prn-workflow.ts` does the same for ineffective PRN follow-up.

Why this is a real operational break:

- The medication administration record is saved.
- The nurse-facing follow-up signal is not guaranteed.
- That creates a real safety gap.

## 4. Canonicality Risks

- I did not find mock persistence or fake in-memory persistence in the audited runtime lifecycle paths.
- The main canonicality risk is post-commit workflow lag, not split-brain persistence.
- `lib/services/intake-pof-mhp-cascade.ts` lets intake signature commit and then handles draft POF creation plus intake PDF persistence as follow-up work.
- `lib/services/enrollment-packets-send-runtime.ts` lets packet send commit before lead activity sync finishes.
- `lib/services/enrollment-packets-public-runtime.ts` lets packet completion commit before every downstream readiness check is fully closed.
- `lib/services/member-files.ts` is mostly canonical now, but still carries legacy inline-file compatibility support. That is not fake persistence, but it is lingering drift debt.
- Some raw script hits on `return { ok: true }` were noisy. In `app/care-plan-actions.ts`, `app/intake-actions.ts`, and related paths, the return payload is paired with `buildCommittedWorkflowActionState`, which marks the workflow as committed but not operationally ready when follow-up is still needed.

## 5. Schema / Runtime Risks

- Intake-to-POF draft creation depends on the RPC path guarded in `lib/services/physician-orders-supabase.ts`. If that RPC is missing, the service explicitly tells staff to apply migration `0055_intake_draft_pof_atomic_creation.sql`.
- POF signing finalization depends on `rpc_finalize_pof_signature` and explicitly points to migration `0053_artifact_drift_replay_hardening.sql` if missing.
- Scheduled MAR documentation depends on the RPC guarded in `lib/services/mar-workflow.ts`. If missing, the service explicitly points to migration `0121_document_scheduled_mar_administration_rpc.sql`.
- Notification delivery depends on `public.user_notifications`. `lib/services/notifications.ts` explicitly points to migration `0060_notification_workflow_engine.sql` if that schema object is missing.
- POF downstream clinical sync depends on `pof_post_sign_sync_queue` plus the internal runner route in `app/api/internal/pof-post-sign-sync/route.ts`. If the route is deployed without the required secret, signed orders can stay queued.

## 6. Document / Notification / File Persistence Findings

- Enrollment packet completion persists completed packet artifacts and uploads through the public packet runtime before returning completion.
- Intake PDF persistence is real, but it is follow-up work after signature. If save verification fails, the code queues a repair task instead of pretending success.
- POF signature finalization stores the signed PDF and member file before returning the signed result.
- Care plan caregiver signing is strong. `lib/services/care-plan-esign-public.ts` refuses to treat the workflow as complete if the final signed artifact is missing.
- MAR monthly PDF generation is one of the strongest persistence paths in this audit. `app/(portal)/health/mar/actions-impl.ts` saves to `member_files`, verifies persistence, and returns `follow-up-needed` instead of false success if verification fails.
- Notification coverage is mixed:
- Enrollment, intake, POF, care plan, and MAR all call the workflow milestone system.
- The workflow milestone system is good at creating follow-up alerts when no `user_notifications` rows are produced for core events.
- The weak spot is the MAR exception path, where failed alert emission only logs to the server console.

## 7. Fix First

1. Harden MAR exception alert delivery.
   Change `lib/services/mar-workflow.ts` and `lib/services/mar-prn-workflow.ts` so failed `action_required` notification writes also create a durable system alert or repair queue entry.

2. Verify the signed-POF post-sign sync runner in the real environment.
   Check `app/api/internal/pof-post-sign-sync/route.ts`, the queue table, and the required secrets. A signed order should not sit in queued follow-up without an operational escalation path.

3. Keep intake follow-up visible until draft POF and intake PDF persistence are verified.
   The current pattern is safer than fake success, but the operational UI should make these follow-up states hard to miss.

4. Continue retiring legacy inline member-file debt.
   `lib/services/member-files.ts` should keep moving older artifacts toward one consistent storage-backed story.

5. Add regression coverage for post-commit handoff boundaries.
   The riskiest bugs now are not "insert failed silently." They are "record committed, downstream step still queued."

## 8. Regression Checklist

1. Send an enrollment packet from a real lead and verify packet rows, events, and any required sales activity follow-up state in Supabase.
2. Complete the packet from the public link and verify signatures, uploads, completed packet artifact persistence, and downstream follow-up status.
3. Convert the lead and verify one canonical member is linked through `source_lead_id`.
4. Submit and sign an intake assessment and verify the assessment rows, signature rows, intake PDF member file, and draft POF follow-up state.
5. Send and complete a POF signature and verify the signed PDF, member file row, queue row, and final `postSignStatus`.
6. Confirm that a signed POF actually updates MHP and MCC and produces usable MAR data for the same member.
7. Create, review, sign, and caregiver-sign a care plan and verify the final signed artifact is persisted.
8. Document a scheduled MAR dose as `Given` and as `Not Given`, and confirm both the administration row and any required escalation records are created.
9. Document a PRN medication as `Effective` and `Ineffective`, and confirm the ineffective path creates a durable follow-up signal.
10. Generate a monthly MAR PDF and confirm it appears in `member_files` and in the command center file surfaces.
