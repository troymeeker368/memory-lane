# Workflow Lifecycle Simulation Audit
Generated: 2026-04-05
Repository: `D:\Memory Lane App`
Method: workflow simulation script plus direct code inspection
Live checks: not run in this automation pass because a safe live test environment was not validated

## 1. Executive Summary

Memory Lane's core lifecycle is still largely Supabase-backed and canonical. I did not find runtime mock persistence, fake success through local storage, or in-memory fallback persistence in the lead -> enrollment -> intake -> POF -> MHP/MCC -> care plan -> MAR -> member files paths I checked.

The biggest operational risk is no longer "did the first row save?" The biggest risk is "did the downstream workflow finish after the first committed write?" That matters most in three places:

- Signed POF can be durably complete while downstream MHP, MCC, and MAR sync is still queued. The code is honest about that state, but nurses and admins still need the queue runner to stay healthy.
- Enrollment packet send/completion and intake post-sign follow-up are intentionally split into committed write first, repairable follow-up second. That is safer than fake success, but it still means upstream completion can outpace downstream operational readiness.
- Notifications are stronger than they were in earlier audit passes because failed milestone delivery now tries to create durable system alerts, but the workflow still depends on the notification engine, recipient resolution, and follow-up queues staying healthy.

Overall lifecycle health this run: `Partial but production-aware`.

## 2. Lifecycle Handoff Table

| Handoff | Status | What is working | Main risk | Exact files/functions involved | Required fix |
|---|---|---|---|---|---|
| Lead -> Send Enrollment Packet | Strong | Canonical send path persists packet request/event and uses canonical lead/member linkage before sending. | No major handoff break found in the primary write path. | `app/sales-enrollment-actions.ts` -> `sendEnrollmentPacketAction`; `lib/services/enrollment-packets-send-runtime.ts` -> `sendEnrollmentPacketRequest` | Keep current path and protect with regression coverage. |
| Send Enrollment Packet -> Enrollment Packet completion / e-sign return | Strong | Public packet submit persists signatures, uploads, request completion, and completion cascade state. | Post-commit follow-up can still be needed after completion. | `app/sign/enrollment-packet/[token]/actions.ts`; `lib/services/enrollment-packets-public-runtime.ts` -> `submitPublicEnrollmentPacket`; `lib/services/enrollment-packets-public-runtime-follow-up.ts` | Keep completion follow-up state visible in UI and reports. |
| Enrollment Packet completion / e-sign return -> Lead activity logging | Partial | Lead activity sync is real and failure falls into a durable follow-up queue. | Sales timeline can lag packet completion if follow-up queue work is still open. | `lib/services/enrollment-packet-completion-cascade.ts`; `lib/services/enrollment-packet-mapping-runtime.ts` -> `syncEnrollmentPacketLeadActivityOrQueue` | Keep queued follow-up visible until lead activity is confirmed. |
| Lead activity logging -> Member creation / enrollment resolution | Strong | Conversion stays on the canonical lead/member identity path and preserves `source_lead_id`. | No fake persistence found here. | `app/sales-lead-actions.ts` -> `enrollMemberFromLeadAction`; `lib/services/canonical-person-ref.ts` | Keep current path. |
| Member creation / enrollment resolution -> Intake Assessment | Strong | Intake creation is atomic and identity-aware. | Intake PDF persistence and draft POF creation are follow-up work after signing. | `app/intake-actions.ts` -> `createAssessmentAction`; `lib/services/intake-pof-mhp-cascade.ts` -> `createIntakeAssessmentWithResponses` | Keep follow-up tasks visible to staff. |
| Intake Assessment -> Physician Orders / POF generation | Partial | Draft POF creation is real and RPC-backed, not fake. | Intake can be signed while draft POF creation or verification still needs follow-up. | `lib/services/intake-pof-mhp-cascade.ts` -> `completeIntakeAssessmentPostSignWorkflow`; `lib/services/physician-orders-supabase.ts` -> `createDraftPhysicianOrderFromAssessment` | Treat draft POF follow-up as operationally required, not optional. |
| Physician Orders / POF generation -> Provider signature completion | Strong | POF request send/resend/sign path is canonical and stores signed artifacts durably. | No broken persistence path found in the signature write itself. | `app/(portal)/operations/member-command-center/pof-actions.ts`; `app/sign/pof/[token]/actions.ts`; `lib/services/pof-esign-public.ts` -> `submitPublicPofSignature` | Keep current path and regression coverage. |
| Provider signature completion -> MHP generation / sync | Partial | Signed POF is durably finalized and replay-safe. | Downstream MHP/MCC/MAR sync can remain queued behind the post-sign runner. | `lib/services/pof-post-sign-runtime.ts` -> `runBestEffortCommittedPofSignatureFollowUp`; `lib/services/physician-orders-supabase.ts` -> `processSignedPhysicianOrderPostSignSync`; `app/api/internal/pof-post-sign-sync/route.ts` | Verify runner health and escalate aged queue items operationally. |
| MHP generation / sync -> MCC visibility | Strong | MCC and MHP read paths are canonical and member-aware. | No read-path fallback found in the audited code. | `lib/services/member-health-profiles-supabase.ts`; `lib/services/member-command-center-supabase.ts` | Keep current path. |
| MCC visibility -> Care Plan creation / signature workflow | Strong | Care plan create/review/sign flows use canonical services and signed artifact checks. | No major persistence break found. | `app/care-plan-actions.ts`; `lib/services/care-plans-supabase.ts`; `lib/services/care-plan-esign-public.ts` | Keep current path. |
| Care Plan creation / signature workflow -> MAR generation from POF meds | Partial | Signed POF remains the canonical trigger for MAR medication sync and schedule generation. | Care plan completion does not itself guarantee MAR readiness. | `lib/services/physician-orders-supabase.ts` -> `processSignedPhysicianOrderPostSignSync`; `lib/services/mar-workflow.ts` | Keep staff focused on signed-POF clinical sync state, not care plan status alone. |
| MAR generation from POF meds -> MAR documentation workflow | Strong | Scheduled and PRN documentation persist through canonical service/RPC paths. | Notification repair is still follow-up work if milestone delivery fails. | `app/(portal)/health/mar/actions-impl.ts`; `lib/services/mar-workflow.ts`; `lib/services/mar-prn-workflow.ts` | Keep repair-alert path covered by tests. |
| MAR documentation workflow -> Monthly MAR summary or PDF generation | Strong | Monthly report generation is deterministic and read-driven from canonical MAR data. | No major generation gap found in the current path. | `app/(portal)/health/mar/report-actions.ts`; `lib/services/mar-monthly-report.ts`; `lib/services/mar-monthly-report-pdf.ts` | Keep current path. |
| Monthly MAR summary or PDF generation -> Member Files persistence | Strong | Generated MAR PDFs save through canonical member-file persistence and verify storage/readback before reporting success. | None found in the main verified path. | `app/(portal)/health/mar/actions-impl.ts` -> `generateMonthlyMarReportPdfAction`; `lib/services/member-files.ts` -> `saveGeneratedMemberPdfToFiles` | Keep current path. |
| Lifecycle milestones -> Completion notifications or alerts | Partial | Notification engine is real and milestone failures try to create durable follow-up alerts. | Delivery still depends on recipient resolution, notification schema health, and alert fallback succeeding. | `lib/services/lifecycle-milestones.ts` -> `recordWorkflowMilestone`; `lib/services/notifications.ts`; `lib/services/enrollment-packet-mapping-runtime.ts` -> `recordEnrollmentPacketActionRequired`; `lib/services/mar-workflow-core.ts` -> `recordMarFollowUpRepairAlert` | Keep follow-up alerts and queue health visible in operations dashboards. |

## 3. Critical Failures

### 1. Signed POF does not always mean the member is operationally ready

Why it matters:

- A provider can complete the signature successfully.
- The signed PDF and request state are durably saved.
- MHP, MCC, and MAR readiness can still be queued behind the post-sign runner.

Exact code path:

- `app/sign/pof/[token]/actions.ts` returns committed workflow state from `buildCommittedWorkflowActionState`.
- `lib/services/pof-esign-public.ts` -> `submitPublicPofSignature`
- `lib/services/pof-post-sign-runtime.ts` -> `runBestEffortCommittedPofSignatureFollowUp`
- `lib/services/physician-orders-supabase.ts` -> `processSignedPhysicianOrderPostSignSync`
- `app/api/internal/pof-post-sign-sync/route.ts`

Root cause:

- This is an intentional committed-write-first design, not fake persistence.
- The operational weakness is dependency on the queue runner and queue health after signature finalization.

Recommended fix:

- Treat the post-sign queue as a production dependency.
- Monitor it directly and escalate aged queued rows before staff assume the member is clinically ready.

### 2. Enrollment packet and intake workflows can finish upstream before downstream work is operationally complete

Why it matters:

- Packet send and packet completion can commit before lead activity, mapping, and some follow-up work are fully closed.
- Intake signature can commit before draft POF verification or intake PDF member-file verification are fully closed.

Exact code path:

- `lib/services/enrollment-packets-send-runtime.ts`
- `lib/services/enrollment-packet-mapping-runtime.ts` -> `syncEnrollmentPacketLeadActivityOrQueue`
- `lib/services/enrollment-packets-public-runtime-follow-up.ts`
- `lib/services/intake-pof-mhp-cascade.ts` -> `completeIntakeAssessmentPostSignWorkflow`
- `app/(portal)/health/assessment/[assessmentId]/actions.ts`

Root cause:

- Same committed-write-first pattern with explicit follow-up queues and alerts.

Recommended fix:

- Keep follow-up-needed states visible in staff surfaces until the downstream task is truly closed.

## 4. Canonicality Risks Found During Simulation

- No runtime mock persistence, local JSON persistence, localStorage persistence, or in-memory fake persistence was found in the audited lifecycle paths.
- Canonical lead/member identity resolution is present in the major handoffs I checked.
- The main canonicality risk is delayed downstream readiness after a canonical committed write, not split-brain persistence.
- `lib/services/member-files.ts` still carries legacy compatibility handling for older records. That is not fake persistence, but it remains cleanup debt.
- The raw workflow script still produces false positives around `physician_orders` and generic `ok: true` patterns. The real code path is stronger than the script output in those areas.

## 5. Schema / Runtime Risks Exposed by Workflow

- Intake draft POF creation depends on RPC `rpc_create_draft_physician_order_from_intake` and will explicitly direct staff to migration `0055_intake_draft_pof_atomic_creation.sql` if missing. Source: `lib/services/physician-orders-supabase.ts`.
- POF signing depends on queue-backed post-sign sync storage and RPCs. Missing queue/RPC objects would break downstream clinical sync. Source: `lib/services/physician-order-post-sign-runtime.ts`.
- Scheduled MAR documentation depends on RPC-backed write paths and will fail explicitly if the RPC is missing. Source: `lib/services/mar-workflow.ts`.
- Notification delivery depends on `public.user_notifications` and will explicitly point to migration `0060_notification_workflow_engine.sql` if missing. Source: `lib/services/notifications.ts`.
- This automation pass did not validate the live environment, cron wiring, or secrets for `app/api/internal/pof-post-sign-sync/route.ts`, so deployed runner health remains a real unknown.

## 6. Document / Notification / File Persistence Findings

- Enrollment packet completion persists completed packet artifacts and uses committed follow-up state rather than pretending every downstream task is finished immediately.
- Intake PDF persistence is real and verified through `saveGeneratedMemberPdfToFiles`, but the workflow correctly returns follow-up-needed when immediate verification is incomplete.
- POF signature completion stores signed artifacts durably and returns queued-degraded readiness when downstream sync is still pending.
- Care plan caregiver signing is strong: `lib/services/care-plan-esign-public.ts` refuses to treat completion as final if no committed member-file reference exists.
- MAR monthly PDF generation is one of the strongest paths in the audit: `generateMonthlyMarReportPdfAction` saves to `member_files`, verifies persistence, and returns `follow-up-needed` instead of false success when verification is incomplete.
- MAR follow-up alerts are stronger than in older audit memory. If notification delivery fails, `lib/services/mar-workflow.ts` and `lib/services/mar-prn-workflow.ts` try to create a durable repair alert through `recordMarFollowUpRepairAlert` in `lib/services/mar-workflow-core.ts`.

## 7. Fix First

1. Verify and operationalize the signed-POF post-sign sync runner.
   Focus on `app/api/internal/pof-post-sign-sync/route.ts`, queue health, secrets, and aged queue monitoring.

2. Make queued follow-up states impossible to miss in staff workflows.
   This matters most for enrollment packet lead activity sync, intake post-sign follow-up, and signed POF post-sign sync.

3. Add regression coverage around committed-but-not-ready states.
   The risk is no longer silent fake success. The risk is staff treating a committed record as fully ready when the downstream queue still has work open.

4. Keep reducing legacy member-file drift debt.
   The canonical path is much stronger now, but older compatibility handling should keep shrinking over time.

## 8. Regression Checklist

1. Send an enrollment packet from a real lead and verify packet rows, events, and lead-activity follow-up state in Supabase.
2. Complete the packet from the public link and verify signatures, uploads, packet artifacts, and completion follow-up state.
3. Convert the lead and verify one canonical member linked through `members.source_lead_id`.
4. Submit and sign an intake assessment and verify assessment rows, signature rows, intake PDF persistence, and draft POF follow-up state.
5. Send and complete a POF signature and verify signed PDF persistence, queue row status, and final `postSignStatus`.
6. Confirm the signed POF actually updates MHP and MCC and produces usable MAR data for the same member.
7. Create, review, sign, and caregiver-sign a care plan and verify the final signed artifact is persisted.
8. Document a scheduled MAR dose as `Given` and `Not Given`, and confirm both the administration row and any repair alert path are created when notification delivery fails.
9. Document a PRN medication as `Effective` and `Ineffective`, and confirm the ineffective path creates a durable follow-up signal.
10. Generate a monthly MAR PDF and confirm it appears in `member_files` and in Member Command Center file surfaces.
