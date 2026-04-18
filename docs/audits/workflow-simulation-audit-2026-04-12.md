# Workflow Simulation Audit Report
Generated: 2026-04-12
Repository: D:\Memory Lane App
Mode: Static workflow trace + manual code-path verification

## 1. Executive Summary

Overall workflow health: `Fragile but mostly canonical`

What is solid:
- The main lifecycle writes are Supabase-backed and usually go through canonical service or RPC boundaries.
- I did not find runtime mock persistence, local JSON persistence, or in-memory fallback being used in the audited production paths.
- `cmd /c npm run typecheck` passed on April 12, 2026.
- `cmd /c npm run build` passed on April 12, 2026.

What would still break real operations:
- Intake can finish and show a committed success while draft POF creation is still failed or still waiting for follow-up verification.
- Provider signature can complete while downstream MHP, MCC, medication sync, and MAR schedule generation are still queued and not operationally ready.
- Enrollment packet completion can be committed while sales lead activity and some downstream enrollment mapping are still catching up.
- Routine MAR milestone notifications do not create inbox notifications even though `recordWorkflowMilestone` is called.

Most important plain-English takeaway:
- The biggest problem is not fake persistence.
- The biggest problem is split truth between:
  - `record committed in Supabase`
  - `workflow operationally ready for staff to trust`
- That split appears in the enrollment packet, intake, POF post-sign, care plan post-sign, and monthly MAR PDF paths.

Live verification status:
- Live E2E was not run in this automation pass.
- I did not run live workflow scripts against Supabase because they can create real operational records unless the environment is confirmed as a safe audit target.

## 2. Lifecycle Handoff Table

| Lifecycle handoff | Status | What I verified | Main risk |
|---|---|---|---|
| Lead -> Send Enrollment Packet | Strong | `sendEnrollmentPacketAction` -> `sendEnrollmentPacketRequest` persists packet request/event state and uses canonical lead/member resolution. | Lead activity sync happens after packet truth is committed, so sales history can lag. |
| Send Enrollment Packet -> Enrollment Packet completion / e-sign return | Partial | Public packet submit is Supabase-backed, replay-safe, and completion cascade repairs artifacts and mapping. | Completion can be committed before all downstream readiness checks are green. |
| Enrollment Packet completion -> Lead activity logging | Weak | Completion cascade does try to write lead activity through `syncEnrollmentPacketLeadActivityOrQueue`. | Packet/activity linkage is inferred from free-text `lead_activities.notes`, not a canonical packet foreign key. |
| Lead activity logging -> Member creation / enrollment resolution | Strong | Lead conversion uses canonical lead resolution and RPC-backed lead-to-member conversion. | The later enrollment resolution is strong, but it is not the first place a member shell can exist. |
| Member creation / enrollment resolution -> Intake Assessment | Partial | Intake create path uses canonical identity checks, RPC-backed writes, and explicit follow-up states. | Intake can still succeed while signature or post-sign downstream work is incomplete. |
| Intake Assessment -> Physician Orders / POF generation | Partial | Draft POF creation exists and is RPC-backed through `createDraftPhysicianOrderFromAssessment`. | Intake can return `ok: true` while draft POF creation is failed or pending follow-up. |
| Physician Orders / POF generation -> Provider signature completion | Strong | POF send/sign flows persist request rows, signatures, document events, and signed artifact state. | None major in static review. |
| Provider signature completion -> MHP generation / sync | Weak | Signed POF finalization is durable and replay-safe. Post-sign sync is queued and retried. | A signed POF can exist while MHP and downstream clinical state are still stale. |
| MHP generation / sync -> MCC visibility | Partial | MCC reads canonical downstream tables and does not use UI-only fallbacks. | MCC visibility depends on post-sign sync and existing canonical shell rows. |
| MCC visibility -> Care Plan creation / signature workflow | Strong | Care plan create/review/sign flows are service-backed and signature artifacts are persisted. | Readiness finalization can still lag after final artifact creation. |
| Care Plan creation / signature workflow -> MAR generation from POF medications | Partial | MAR generation is correctly tied to signed POF sync, not care plan UI state. | If signed POF sync is queued, MAR readiness is also delayed. |
| MAR generation from POF meds -> MAR documentation workflow | Strong | Scheduled MAR uses RPC-backed writes; PRN uses canonical workflow services. | Routine MAR notifications are not aligned with the notification engine. |
| MAR documentation workflow -> Monthly MAR summary or PDF generation | Strong | Monthly MAR report reads canonical MAR data and builds deterministic PDFs. | Human review is still needed for partial-record months. |
| Monthly MAR summary or PDF generation -> Member Files persistence | Partial | Monthly MAR PDF save uses canonical member-file persistence and surfaces follow-up-needed states. | Storage/PDF success can happen before canonical member-file verification is confirmed. |
| Completion notifications or alerts | Partial | The notification service is centralized and raises follow-up alerts for core failures. | Several lifecycle events still do not create inbox rows even when milestone code is called. |

## 3. Critical Failures

### 1. Intake can look complete before draft POF is actually ready
- Why it matters:
  Nurses can finish intake and think the clinical handoff is done when the draft POF either failed or still needs follow-up.
- Exact path:
  `app/intake-actions.ts` -> `lib/services/intake-pof-mhp-cascade.ts` -> `lib/services/physician-orders-supabase.ts`
- What is happening:
  The intake assessment is committed first. Signature and post-sign POF/file work happen after that.
- Operational impact:
  Staff can move forward on incomplete downstream clinical paperwork.

### 2. Signed POF is not the same thing as downstream clinical readiness
- Why it matters:
  A provider can finish signing, the signed PDF can be saved, and staff can still have stale MHP, stale MCC visibility, or missing MAR schedules.
- Exact path:
  `app/sign/pof/[token]/actions.ts` -> `lib/services/pof-esign-public.ts` -> `lib/services/physician-order-post-sign-service.ts`
- What is happening:
  Final signature is durable first. MHP/MCC/MAR sync is a separate queued follow-up.
- Operational impact:
  Nurses may trust a signed POF before the rest of the clinical system is ready.

### 3. Enrollment packet activity is not canonically linked to the packet itself
- Why it matters:
  Sales timelines are part of the real operational story. If packet completion activity is matched through free-text notes, the readback can drift.
- Exact path:
  `lib/services/enrollment-packet-mapping-runtime.ts` writes `lead_activities`, but `lib/services/enrollment-packet-completion-cascade.ts` checks linkage by searching packet IDs inside `notes`.
- What is happening:
  The lead activity row is real, but the packet-specific linkage is not schema-backed.
- Operational impact:
  A lead can show a sent or completed packet in enrollment views while sales activity history is missing or misread.

### 4. Routine MAR milestones do not create inbox notifications
- Why it matters:
  The system calls `recordWorkflowMilestone`, but normal MAR activity does not map to a supported notification event type.
- Exact path:
  `lib/services/mar-workflow.ts` and `lib/services/mar-prn-workflow.ts` emit MAR milestone event types that `lib/services/notifications-runtime.ts` does not recognize.
- What is happening:
  `dispatchNotification` returns no `user_notifications` rows for those routine MAR events.
- Operational impact:
  The notification system gives a false sense of coverage for MAR activity unless it is an exception path like `Not Given` or PRN ineffective.

## 4. Canonicality Risks

- Enrollment packet lead activity is only partially canonical.
  The lead ID is canonical, but packet linkage depends on note text instead of a packet reference column.

- Member creation happens in more than one lifecycle moment.
  `ensureCanonicalMemberForLead` can create an inactive canonical member shell during enrollment packet send, before `enrollMemberFromLeadAction` performs formal conversion.

- Intake can run against that early member shell.
  That means `memberId` can mean “canonical shell linked to the lead” instead of “fully enrollment-resolved member.”

- Manual/generated POF PDFs are not order-specific in `member_files`.
  The manual POF PDF save path uses a generic document source of `Physician Order Form`, so multiple generated POF PDFs for the same member collapse into one slot.

- I did not find fake persistence.
  The fallback patterns I found are real Supabase-backed follow-up queues, alerts, and readiness states, not mock records.

## 5. Schema / Runtime Risks

- The code path is heavily RPC-dependent.
  If the linked Supabase project is missing any of these functions, real workflows will break:
  - intake assessment create RPC
  - intake draft POF create RPC
  - finalize POF signature RPC
  - signed POF post-sign sync RPC
  - scheduled MAR administration RPC
  - member file upsert RPC

- Signed POF downstream sync depends on preexisting MHP and MCC shell rows.
  The read paths intentionally throw if those canonical shell rows are missing instead of silently backfilling.

- The static audit script overcalled one issue.
  It flagged missing `physician_orders` writes, but manual review confirmed the draft POF write path does exist and is RPC-backed.

- The bigger runtime risk is readiness drift.
  Several workflows correctly persist the committed record but allow downstream operational readiness to lag.

- Current repo validation signal:
  - `typecheck`: passed on April 12, 2026
  - `build`: passed on April 12, 2026
  - live Supabase execution: not run in this pass

## 6. Document / Notification / File Persistence Findings

- Enrollment Packet
  - Completion cascade does repair and verify completed packet artifacts.
  - The completed packet file can be created after the packet itself is already committed.
  - Notification/follow-up behavior exists for enrollment failures and action-required states.

- Intake Assessment
  - Intake PDF persistence goes through `saveGeneratedMemberPdfToFiles`.
  - If persistence cannot be verified, the code surfaces follow-up-needed state instead of claiming clean completion.

- Physician Orders / POF
  - Public POF signing persists signature state, signed PDF, and member-file linkage before downstream sync finishes.
  - Manual/generated POF PDFs are not uniquely keyed per order version.
  - The manual POF PDF save path does not emit a document-uploaded notification.

- Care Plan
  - Caregiver-signed final file is durable and tied to `member_files`.
  - Post-sign readiness can still fail after the final signed artifact exists.

- MAR Documentation
  - MAR administration persistence itself looks strong.
  - Exception notifications work better than routine notifications.
  - `Not Given` and PRN ineffective paths can create action-required alerts.
  - Routine MAR milestones do not create inbox notifications because the event types are unmapped.

- Monthly MAR PDF
  - Monthly MAR PDF generation is strong from a reporting perspective.
  - Canonical member-file verification is still a separate truth step.
  - There is no notification milestone for successful monthly MAR PDF filing.

## 7. Fix First

1. Tighten workflow truth for intake so `ok: true` cannot be mistaken for “POF ready” when draft POF follow-up is still open.
2. Standardize a single downstream readiness signal for signed POF across POF detail, MHP, MCC, and MAR surfaces.
3. Replace enrollment packet lead-activity packet matching-by-notes with a canonical packet reference.
4. Add notification event aliases or supported event types for routine MAR milestone events.
5. Decide whether early canonical member shell creation before formal enrollment resolution is intended long-term behavior. If yes, label it clearly in downstream workflows. If no, tighten the lifecycle boundary.
6. Make manual/generated POF PDF file identity order-specific so multiple POF versions do not collapse into one `member_files` slot.
7. Add live audit coverage for:
   - enrollment packet completion
   - intake-to-draft-POF follow-up
   - signed POF post-sign sync
   - MAR notification delivery

## 8. Regression Checklist

1. Send an enrollment packet from a real lead and verify `enrollment_packet_requests`, `enrollment_packet_events`, and `lead_activities`.
2. Complete the packet from the public link and verify signatures, uploads, completed-packet artifact creation, and downstream follow-up state if mapping is not ready.
3. Confirm the lead’s sales timeline shows the packet activity without relying on text-matching drift.
4. Convert the lead to a member and verify a single canonical `members.source_lead_id` link.
5. Create and sign intake assessment, then verify:
   - `intake_assessments`
   - `assessment_responses`
   - `intake_assessment_signatures`
   - intake PDF in `member_files`
6. Verify that a failed or pending draft POF follow-up is obvious in intake and POF views.
7. Send and complete a POF provider signature and verify:
   - `pof_requests`
   - `pof_signatures`
   - signed PDF in `member_files`
   - post-sign queue state
   - downstream MHP/MCC/MAR readiness
8. Verify MCC and MHP read correctly for the same member after signed POF sync completes.
9. Document scheduled MAR as `Given` and `Not Given`, then verify both persistence and notification behavior.
10. Document PRN administration and PRN outcome, then verify persistence plus exception alert behavior.
11. Generate a monthly MAR PDF and verify canonical `member_files` visibility, not just PDF bytes/storage success.
12. Check the notifications inbox for enrollment, intake, POF, care plan, and MAR exceptions, and confirm which routine events still do not appear.
