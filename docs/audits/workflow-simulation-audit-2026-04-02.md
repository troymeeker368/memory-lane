# Workflow Simulation Audit Report
Generated: 2026-04-02
Repository: `D:\Memory Lane App`
Audit mode: static code-path audit plus local readiness check

## 1. Executive Summary

Overall workflow health is **Partial**.

The strongest part of the lifecycle is the enrollment packet completion path. That flow uses canonical Supabase-backed services and explicitly refuses to report the packet as operationally ready when the sender notification, completed-packet artifact, downstream operational shells, or lead activity sync did not finish. That is the best example in the codebase of a real healthcare-safe handoff.

The biggest operational risks are not in the initial writes. They are in the follow-through:

- **Notifications are not trustworthy enough yet.** The notification pipeline can treat "zero recipients" as a successful delivery, and several lifecycle steps never verify that a notification row was actually created.
- **Generated PDFs can look successful before `member_files` is truly verified.** Intake handles this carefully, but monthly MAR PDFs and some other generated documents still return success without checking the `verifiedPersisted` flag.
- **POF signature completion can finish before downstream sync is complete.** A provider can complete signing while MHP, MCC, and MAR follow-up work is only queued for retry.
- **Some server actions use `ok: true` for "committed but not operationally ready" states.** That is acceptable only if every UI consumer honors the returned `operationallyReady` and `actionNeededMessage` fields.

Strongest handoffs in this pass:

- Enrollment packet send
- Enrollment packet completion / e-sign return
- Enrollment packet completion to lead activity
- Lead to member conversion
- MAR documentation canonical write path

Weakest handoffs in this pass:

- Lifecycle milestones to notifications
- Monthly MAR PDF to Member Files persistence
- Provider signature completion to downstream MHP/MAR readiness
- Any UI flow that only checks `ok` and ignores `operationallyReady`

Live signal was limited today. Port `3001` was listening, but `http://localhost:3001` did not return within the timeout window, so I did **not** treat this as a real live end-to-end verification run.

## 2. Lifecycle Handoff Table

| Handoff | Status | What the code is doing now | Why this status |
|---|---|---|---|
| Lead -> Send Enrollment Packet | **Strong** | Canonical lead resolution and packet send runtime are wired through `app/sales-enrollment-actions.ts` and `lib/services/enrollment-packets-send-runtime.ts`. | Good Supabase-backed send path with canonical lead/member checks. |
| Send Enrollment Packet -> Enrollment Packet completion / e-sign return | **Strong** | Public completion runs through `app/sign/enrollment-packet/[token]/actions.ts`, `lib/services/enrollment-packets-public-runtime.ts`, and `lib/services/enrollment-packet-completion-cascade.ts`. | Best safety pattern in the lifecycle. Completion refuses to finalize as operationally ready if critical downstream work is missing. |
| Enrollment Packet completion / e-sign return -> Lead activity logging | **Strong** | `lib/services/enrollment-packet-mapping-runtime.ts` writes lead activity and queues follow-up if direct sync fails. | Strong because failure is surfaced and queued instead of being silently ignored. |
| Lead activity logging -> Member creation / enrollment resolution | **Strong** | `app/sales-lead-actions.ts` calls canonical lead resolution and `applyClosedWonLeadConversion`; identity rules are backed by `lib/services/canonical-person-ref.ts`. | Good canonical identity handling. Duplicate `members.source_lead_id` links fail explicitly. |
| Member creation / enrollment resolution -> Intake Assessment | **Partial** | `app/intake-actions.ts` creates the assessment, signs it, and runs `completeIntakeAssessmentPostSignWorkflow`. | The write path is strong, but the action can return `ok: true` when signature finalization fails and depends on the caller honoring `operationallyReady: false`. |
| Intake Assessment -> Physician Orders / POF generation | **Partial** | `lib/services/intake-pof-mhp-cascade.ts` creates a draft POF and queues follow-up when post-sign work is incomplete. | The workflow is not broken, but it is not fully synchronous or guaranteed at response time. |
| Physician Orders / POF generation -> Provider signature completion | **Partial** | Signing is handled through `app/sign/pof/[token]/actions.ts` and `lib/services/pof-esign-public.ts`. | Provider signature can complete even when downstream post-sign sync is only queued. |
| Provider signature completion -> MHP generation / sync | **Partial** | `lib/services/physician-orders-supabase.ts` runs `processSignedPhysicianOrderPostSignSync`, and `lib/services/pof-post-sign-runtime.ts` downgrades failures to queued retry state. | Canonical sync exists, but clinical downstream readiness is not guaranteed at the moment the signature returns success. |
| MHP generation / sync -> MCC visibility | **Partial** | MCC reads are canonical through `lib/services/member-command-center-supabase.ts`. | Read path is good, but it depends on post-sign sync actually completing. If the queue stalls, MCC can lag behind the signed POF. |
| MCC visibility -> Care Plan creation / signature workflow | **Partial** | Care plan create/review/sign flows are routed through `app/care-plan-actions.ts`, `lib/services/care-plans-supabase.ts`, and caregiver e-sign services. | Core persistence looks solid, but notification delivery is not guaranteed and action responses rely on `operationallyReady` semantics. |
| Care Plan creation / signature workflow -> MAR generation from POF meds | **Weak** | Real MAR generation is driven by signed POF post-sign sync in `lib/services/physician-orders-supabase.ts` and `lib/services/mar-workflow.ts`. | This is not really a care-plan-driven handoff. The canonical trigger is the signed POF, not care plan completion. |
| MAR generation from POF meds -> MAR documentation workflow | **Strong** | Scheduled documentation uses `rpc_document_scheduled_mar_administration` through `lib/services/mar-workflow.ts`; PRN uses `lib/services/mar-prn-workflow.ts`. | Core write path is canonical and Supabase-backed. |
| MAR documentation workflow -> Monthly MAR summary or PDF generation | **Strong** | Report assembly is in `lib/services/mar-monthly-report.ts`; PDF build is in `lib/services/mar-monthly-report-pdf.ts`. | Report generation itself looks deterministic and canonical. |
| Monthly MAR summary or PDF generation -> Member Files persistence | **Weak** | `app/(portal)/health/mar/actions-impl.ts` saves the PDF through `saveGeneratedMemberPdfToFiles`. | The action does not inspect `verifiedPersisted`, so it can report success even when the `member_files` row was not verified. |
| Member Files persistence -> MCC file visibility | **Partial** | Read path is canonical through `lib/services/member-command-center-supabase.ts` and member file helpers. | Strong when the row is truly persisted; weak when callers ignore verification-pending results. |
| Completion notifications or alerts | **Weak** | Notification calls flow through `lib/services/lifecycle-milestones.ts` and `lib/services/notifications.ts`. | Several workflows can record "delivered" milestones without proving that a `user_notifications` row exists. |

## 3. Critical Failures

### 1. Notification delivery can be counted as successful even when nobody was notified

- Why it matters: nurses and admins can miss action-required alerts while the workflow code believes the alert was delivered.
- Exact code:
  - `lib/services/notifications.ts`
  - `lib/services/lifecycle-milestones.ts`
  - callers such as `lib/services/pof-esign.ts`, `lib/services/care-plan-esign.ts`, `lib/services/care-plan-esign-public.ts`, and `lib/services/mar-workflow.ts`
- Root cause:
  - `dispatchNotification` returns an empty array when no recipients resolve unless `requireRecipients` is set.
  - `recordWorkflowMilestone` treats that empty array as `delivered: true`.
  - Many lifecycle callers neither set `requireRecipients` nor inspect the returned `notificationCount`.
- Operational impact:
  - POF send/sign milestones can complete without staff inbox entries.
  - Care plan send/sign milestones can complete without staff inbox entries.
  - MAR "Not Given" action-required alerts can fail to reach staff.

### 2. Monthly MAR PDF persistence can report success before Member Files persistence is verified

- Why it matters: staff can think the monthly MAR report was saved when the file object exists in storage but the canonical `member_files` row is missing or not yet visible.
- Exact code:
  - `lib/services/member-files.ts`
  - `app/(portal)/health/mar/actions-impl.ts`
- Root cause:
  - `saveGeneratedMemberPdfToFiles` explicitly returns a synthetic object with `verifiedPersisted: false` when storage upload succeeded but the row could not be verified.
  - `generateMonthlyMarReportPdfAction` does not inspect that flag.
- Operational impact:
  - Month-end medication documentation can look complete while the report is not actually attached to the member's document record.

### 3. POF signature completion can return success while downstream clinical sync is still queued

- Why it matters: a physician can finish signing, but nurses may not immediately see updated MHP, MCC, or MAR data.
- Exact code:
  - `app/sign/pof/[token]/actions.ts`
  - `lib/services/pof-esign-public.ts`
  - `lib/services/pof-post-sign-runtime.ts`
  - `lib/services/physician-orders-supabase.ts`
- Root cause:
  - The signature is committed first.
  - If downstream sync fails, the code records alerts and returns a queued retry outcome instead of failing the signature itself.
  - The public action still returns `ok: true`; readiness depends on `postSignStatus`.
- Operational impact:
  - Frontline staff may treat a newly signed POF as fully ready even though MAR schedules or MHP data have not caught up yet.

## 4. Canonicality Risks

- `saveGeneratedMemberPdfToFiles` can return a non-persisted placeholder object with `verifiedPersisted: false`. That is safer than silent success only when every caller checks the flag. Intake does; monthly MAR, POF PDF save, and care plan PDF generation do not all enforce it consistently.
- The care-plan-to-MAR handoff is conceptually non-canonical. The codebase correctly treats signed POF as the driver for MAR generation. Any reporting or UI assumption that care plan completion drives MAR would create resolver drift.
- Intake and care plan actions use a deliberate "committed but not operationally ready" contract (`ok: true` plus `operationallyReady: false`). That is valid only if every consuming UI treats `operationallyReady` as the real workflow truth.

## 5. Schema / Runtime Risks

- The lifecycle depends on several shared RPCs being present and current, including intake creation/signature finalization, POF signature finalization, signed-POF post-sign sync, lead conversion, and member-file upsert RPCs. The code usually fails explicitly when they are missing, which is good, but deployment drift would still block live operations.
- Local runtime readiness was not healthy enough for a true live audit today. Port `3001` was occupied, but the app did not respond within the HTTP timeout window.
- I did not find obvious runtime mock persistence in the audited workflow paths.

## 6. Document / Notification / File Persistence Findings

- **Enrollment Packet artifacts:** strongest path in the system. Packet completion asserts agreement before return and throws if artifact linkage, operational shells, lead activity sync, or sender notification are missing.
- **Intake PDF persistence:** better than most document flows. `lib/services/intake-pof-mhp-cascade.ts` checks `verifiedPersisted` and creates follow-up tasks when persistence verification fails.
- **POF signed artifact persistence:** strong. `lib/services/pof-esign-public.ts` and related signature finalization logic require committed file references and raise alerts on post-commit failure.
- **Care Plan signed artifact persistence:** strong. `lib/services/care-plan-esign-public.ts` throws when caregiver signature finalization does not produce a committed member-file reference.
- **Monthly MAR PDF persistence:** weak. The PDF can be built and returned even when Member Files verification still needs follow-up.
- **Notification persistence:** weak outside the enrollment packet follow-up helper. The notification system does not reliably distinguish "zero notifications created" from "delivered."

## 7. Fix First

1. **Make notification delivery truthful.**
   - Change `recordWorkflowMilestone` so `notificationCount === 0` is not treated as delivered success.
   - For action-required lifecycle events, require recipients or explicitly queue operational follow-up.

2. **Make generated PDF actions respect `verifiedPersisted`.**
   - Start with `app/(portal)/health/mar/actions-impl.ts`.
   - Then align `app/(portal)/health/physician-orders/actions.ts` and `app/(portal)/health/care-plans/[carePlanId]/actions.ts`.
   - Return a follow-up-required state instead of plain success when Member Files verification is pending.

3. **Tighten the signed-POF readiness contract.**
   - Keep signature commit atomic.
   - But make the returned state impossible to misread by staff-facing UI when post-sign sync is only queued.
   - If the UI already consumes `operationallyReady`, verify that it blocks MAR/MHP-ready messaging until `postSignStatus === "synced"`.

4. **Preserve the enrollment packet completion pattern and copy it to weaker workflows.**
   - The packet completion agreement check is the best model in this codebase for operational truthfulness.

## 8. Regression Checklist

- Send an enrollment packet from a real lead and verify `enrollment_packet_requests`, `enrollment_packet_events`, and `lead_activities`.
- Complete the public enrollment packet and confirm the workflow refuses to report operational readiness if artifact linkage, lead activity sync, or sender notification fails.
- Convert the lead to a member and verify exactly one `members.source_lead_id` link exists.
- Create and sign an intake assessment and confirm the follow-up task appears if the intake PDF is not verified in `member_files`.
- Generate a draft POF from intake and verify the draft is tied to the canonical member and source assessment.
- Complete provider POF signing and confirm the UI distinguishes `postSignStatus: "synced"` from queued retry states.
- Verify MHP and MCC refresh only after signed-POF post-sign sync actually completes.
- Create, review, and sign a care plan, then complete caregiver e-sign and verify the final signed artifact is committed to Member Files.
- Document a scheduled MAR dose as `Given` and as `Not Given`, then verify both canonical write rows and the action-required alert path.
- Document a PRN administration and PRN outcome (`effective` and `ineffective`) and verify canonical persistence.
- Generate a monthly MAR PDF and verify both the storage object and the canonical `member_files` row exist before calling the workflow complete.
- Check the notifications inbox for enrollment, POF, care plan, and MAR events and verify real `user_notifications` rows were created for the expected staff recipients.
