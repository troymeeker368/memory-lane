# Workflow Simulation Audit Report
_Generated: 2026-04-24 04:21 EDT_
_Repository: D:/Memory Lane App_

## 1. Executive Summary

Overall lifecycle health is **Partial**.

The good news is that the core Memory Lane workflow is mostly using real canonical service paths and real Supabase persistence. I did **not** find mock runtime persistence, localStorage-backed workflow state, or fake fallback records in the production lifecycle paths I audited.

The main operational risk is not "nothing saves." The bigger problem is that several workflows can truthfully say the primary write committed while downstream readiness is still incomplete. In plain English: staff can sometimes get a successful result even though the next operational step still needs repair or retry before nurses and admins should trust the workflow as fully ready.

The highest-risk gap is **Intake Assessment -> Physician Orders / POF generation**. The canonical draft POF write path exists, but the intake action can still finish in a follow-up-needed state if draft POF creation or immediate verification fails. The next-highest gap is **Provider signature completion -> MHP/MCC/MAR downstream sync**, because a signed POF can be committed while downstream sync is queued for retry.

## 2. Lifecycle Handoff Table

| Handoff | Status | Why |
|---|---|---|
| Lead -> Send Enrollment Packet | Strong | Canonical lead resolution happens before send, and the send path writes real enrollment packet records through the service layer. |
| Send Enrollment Packet -> Enrollment Packet completion / e-sign return | Strong | Public completion persists packet fields, signatures, uploads, and completion state through canonical runtime services. |
| Enrollment Packet completion / e-sign return -> Lead activity logging | Strong | Completion cascade syncs lead activity or queues follow-up instead of silently dropping the handoff. |
| Lead activity logging -> Member creation / enrollment resolution | Strong | Lead conversion preserves canonical lead/member identity and writes the member through the canonical conversion path. |
| Member creation / enrollment resolution -> Intake Assessment | Strong | Intake creation resolves canonical member/lead identity, writes the assessment, signs it, and runs post-sign follow-up. |
| Intake Assessment -> Physician Orders / POF generation | Partial | Draft POF creation is real and Supabase-backed, but the intake action can still return success with follow-up-needed when draft POF creation or readback verification is incomplete. |
| Physician Orders / POF generation -> Provider signature completion | Strong | POF send/sign flow is canonical, persisted, replay-safe, and tied to real signature/member-file artifacts. |
| Provider signature completion -> Member Health Profile (MHP) generation / sync | Partial | Signed POF commits correctly, but downstream MHP/MCC/MAR sync can queue for retry, which means clinical downstream state may lag after signature. |
| Member Health Profile (MHP) generation / sync -> Member Command Center (MCC) visibility | Strong | MCC reads canonical member/MHP/schedule/contact records and fails clearly when canonical shells are missing. |
| Member Command Center (MCC) visibility -> Care Plan creation / signature workflow | Strong | Care plan create/review/sign/send flows use canonical services and persisted readiness state. |
| Care Plan creation / signature workflow -> MAR generation from POF medications | Partial | Care plan completion does not itself generate MAR schedules; MAR is driven by signed POF medication sync, so this is not a direct lifecycle trigger. |
| MAR generation from POF medications -> MAR documentation workflow | Strong | MAR services write scheduled and PRN administrations through canonical Supabase/RPC paths and read them back through the MAR snapshot service. |
| MAR documentation workflow -> Monthly MAR summary or PDF generation | Strong | Monthly report generation reads real MAR/member/POF data and builds the PDF from canonical reporting services. |
| Monthly MAR summary or PDF generation -> Member Files persistence | Strong | Generated PDFs are uploaded and upserted into `member_files`, then explicitly verified before being treated as fully persisted. |
| Member Files persistence -> Completion notifications or alerts | Partial | Failure alerts are well-defended, but successful monthly MAR completion does not appear to emit a deliberate user-facing notification. |

## 3. Critical Failures

1. **Intake can finish before draft POF readiness is fully proven.**
   `createAssessmentAction` in [app/intake-actions.ts](/D:/Memory%20Lane%20App/app/intake-actions.ts:151) returns `ok: true` even when post-sign follow-up still needs repair, because the assessment write already committed. The downstream draft POF logic in [lib/services/intake-pof-mhp-cascade.ts](/D:/Memory%20Lane%20App/lib/services/intake-pof-mhp-cascade.ts:401) correctly records follow-up-needed states, but staff can still read this as "finished" if the UI is not very explicit.

2. **Signed POF does not guarantee immediate downstream clinical readiness.**
   The public signature action in [app/sign/pof/[token]/actions.ts](/D:/Memory%20Lane%20App/app/sign/pof/%5Btoken%5D/actions.ts:14) returns `ok: true` with readiness metadata, and the post-sign service in [lib/services/physician-order-post-sign-service.ts](/D:/Memory%20Lane%20App/lib/services/physician-order-post-sign-service.ts:86) can legitimately queue downstream sync for retry. That means MHP, MCC, and MAR may still be stale right after provider signature.

3. **Care plan completion is not the trigger for MAR readiness.**
   The care plan side is durable, but MAR schedules come from signed POF medication sync, not from care-plan completion. If operations staff think “care plan signed” means “MAR ready,” they can move too early.

## 4. Canonicality Risks

- No mock runtime persistence or fake fallback storage was found in the audited lifecycle code paths.
- Canonical identity handling is mostly strong:
  [app/sales-enrollment-actions.ts](/D:/Memory%20Lane%20App/app/sales-enrollment-actions.ts:55),
  [app/sales-lead-actions.ts](/D:/Memory%20Lane%20App/app/sales-lead-actions.ts:440),
  [app/intake-actions.ts](/D:/Memory%20Lane%20App/app/intake-actions.ts:151), and
  [lib/services/member-files.ts](/D:/Memory%20Lane%20App/lib/services/member-files.ts:768)
  all resolve canonical lead/member identity before writing.
- The main canonicality risk is **workflow truth signaling**: some actions return committed success plus a degraded readiness state. That is safer than fake success, but the UI must treat those states as incomplete operations, not green-check completions.
- Care plan -> MAR is a workflow expectation mismatch, not a storage bug. The canonical MAR trigger is signed POF medication sync.

## 5. Schema / Runtime Risks

- I did not confirm missing lifecycle tables or obvious schema drift in the audited paths.
- Intake draft POF creation depends on the RPC-backed write boundary in [lib/services/physician-orders-supabase.ts](/D:/Memory%20Lane%20App/lib/services/physician-orders-supabase.ts:415). If the RPC or immediate reload fails, the app correctly degrades into follow-up-needed instead of silently inventing success.
- Signed POF downstream sync depends on the post-sign queue and retry workflow in [lib/services/physician-order-post-sign-service.ts](/D:/Memory%20Lane%20App/lib/services/physician-order-post-sign-service.ts:157). That is production-safer than inline best effort only, but it means real operational lag is possible after signature.
- The notification system depends on `user_notifications` schema and recipient resolution in [lib/services/notifications.ts](/D:/Memory%20Lane%20App/lib/services/notifications.ts:183) and [lib/services/lifecycle-milestones.ts](/D:/Memory%20Lane%20App/lib/services/lifecycle-milestones.ts:114). Delivery failures are surfaced, but not every success path checks delivery strongly enough to change the UI outcome.
- Tooling issue: the audit runner previously miswrote reports under `docs/audits/docs/audits/...` instead of the required `docs/audits` root.

## 6. Document / Notification / File Persistence Findings

- Enrollment packet completion uses a guarded cascade in [lib/services/enrollment-packets-public-runtime-cascade.ts](/D:/Memory%20Lane%20App/lib/services/enrollment-packets-public-runtime-cascade.ts:26) and [lib/services/enrollment-packet-mapping-runtime.ts](/D:/Memory%20Lane%20App/lib/services/enrollment-packet-mapping-runtime.ts:423). If mapping, lead activity sync, or file linkage fails, it records action-required follow-up instead of pretending the packet is fully ready downstream.
- Intake post-sign PDF persistence is explicit in [lib/services/intake-pof-mhp-cascade.ts](/D:/Memory%20Lane%20App/lib/services/intake-pof-mhp-cascade.ts:457). If Member Files verification fails, the workflow returns follow-up-needed and queues repair work.
- Caregiver care-plan signature persistence is real and artifact-backed in [lib/services/care-plan-esign-public.ts](/D:/Memory%20Lane%20App/lib/services/care-plan-esign-public.ts:744). If post-commit follow-up fails after signature finalization, the code returns a committed-but-follow-up-needed result instead of hiding the issue.
- Monthly MAR PDF persistence is one of the strongest paths. [app/(portal)/health/mar/actions-impl.ts](/D:/Memory%20Lane%20App/app/(portal)/health/mar/actions-impl.ts:428) only treats the flow as fully successful when [lib/services/member-files.ts](/D:/Memory%20Lane%20App/lib/services/member-files.ts:768) verifies the `member_files` record after upload.
- Notification delivery has a solid foundation in [lib/services/lifecycle-milestones.ts](/D:/Memory%20Lane%20App/lib/services/lifecycle-milestones.ts:114): if required notifications do not produce `user_notifications` rows, the system records follow-up-needed. The remaining gap is consistency: some milestone calls are logged and ignored on failure unless the event is explicitly action-required.

## 7. Fix First

1. Make intake post-sign readiness impossible to miss in the UI. Staff should not read `ok: true` as “fully done” when draft POF creation or verification still needs repair.
2. Tighten the signed-POF completion UX so queued downstream sync is visually treated as incomplete for MHP/MCC/MAR readiness.
3. Clarify in product language that MAR readiness comes from signed POF medication sync, not from care-plan completion.
4. Add an explicit success notification for monthly MAR PDF completion if staff are expected to rely on alerts/notifications at that stage.
5. Fix the audit runner output path so weekly workflow reports consistently land in `docs/audits`.

## 8. Regression Checklist

1. Send an enrollment packet from a lead and verify `enrollment_packet_requests` and events in Supabase.
2. Complete the packet from the public link and verify signatures/uploads plus downstream lead activity or queued follow-up.
3. Convert the lead and verify one canonical member linked through `members.source_lead_id`.
4. Submit intake assessment and verify `intake_assessments`, responses, signature, and the intake PDF in `member_files`.
5. Verify intake post-sign state clearly distinguishes “fully ready” from “follow-up needed.”
6. Send and complete POF provider signature and verify signed artifact persistence plus post-sign sync status.
7. Confirm signed POF either updates MHP/MCC/MAR immediately or visibly lands in queued follow-up state.
8. Create, review, sign, and caregiver-sign a care plan and verify signature events and final artifact persistence.
9. Document scheduled and PRN MAR entries and confirm `given`, `not given`, `effective`, and `ineffective` paths persist correctly.
10. Generate a monthly MAR PDF and verify the file is both stored and reloaded from `member_files`.
11. Verify alerts/notifications appear when lifecycle milestones fail or require action, and verify whether success notifications are intentionally present or absent.

