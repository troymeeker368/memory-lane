# Workflow Lifecycle Simulation Audit
_Generated: 2026-05-12 EDT_
_Scope: static workflow audit plus manual source review of canonical write paths, downstream resolvers, file persistence, and notification truth. Live side-effecting E2E scripts were not run in this pass because they create real Supabase/storage/notification side effects._
_Validation note: targeted local tests could not be executed in this sandbox because Node test child-process spawning is blocked with `spawn EPERM`._

## 1. Executive Summary

Overall lifecycle health is **Partial**.

This lifecycle is still **real and Supabase-backed**. I did not find a new runtime mock backend, localStorage persistence path, or fake in-memory substitute in the audited workflow.

The main problem is still **handoff truth after the main write succeeds**. Several workflows now save the canonical row correctly, but the next operational step can still be queued, require staff follow-up, or fail because a required shell row is missing. In plain English: the system is better at honestly saying "saved, but not fully ready yet," but a few workflow labels and milestone boundaries still make that easy to misunderstand.

The highest-risk founder-level findings from this run are:

1. **Enrollment Packet completion still does not naturally finish formal enrollment resolution.**
2. **Signed POF notification wording still reads more complete than the downstream clinical sync really is.**
3. **MHP and MCC downstream reads still fail hard when required shell rows are missing.**
4. **Care Plan completion is still not the real MAR readiness gate.**
5. **Document persistence truth is more honest than before, but Intake, POF PDF, and MAR PDF can still land in follow-up-needed state instead of verified Member Files completion.**

## 2. Lifecycle Handoff Table

| Lifecycle handoff | Status | Canonical write | Downstream read/resolver | What is working | Main risk |
|---|---|---|---|---|---|
| Lead -> Send Enrollment Packet | Strong | `enrollment_packet_requests`, `enrollment_packet_events`, `lead_activities` | `listEnrollmentPacketRequestsForLead`, `listEnrollmentPacketRequestsForMember` | `sendEnrollmentPacketRequest` in `lib/services/enrollment-packets-send-runtime.ts` persists the packet request/event and enforces canonical lead/member linkage. | This path still depends on canonical member linkage early, which is safer for identity but can blur the difference between "member shell exists" and "formal enrollment is finished." |
| Send Enrollment Packet -> Enrollment Packet completion / e-sign return | Partial | `enrollment_packet_fields`, `enrollment_packet_signatures`, `enrollment_packet_uploads`, `enrollment_packet_requests`, `member_files`, `enrollment_packet_mapping_runs` | `buildPublicEnrollmentPacketSubmitResult` | `submitPublicEnrollmentPacket` in `lib/services/enrollment-packets-public-runtime.ts` persists signatures, uploads, completion state, and packet artifacts. | Completion can still end in `filed_pending_mapping`, `queued_degraded`, or `follow_up_required`, so a finished packet is not always operationally ready. |
| Enrollment Packet completion / e-sign return -> Lead activity logging | Partial | `lead_activities` | `getSalesRecentActivitySnapshotSupabase` | `runEnrollmentPacketCompletionCascade` in `lib/services/enrollment-packet-completion-cascade.ts` calls `syncEnrollmentPacketLeadActivityOrQueue`. | Lead activity is still a post-commit follow-up concern, not part of the same atomic completion boundary as caregiver submission. |
| Lead activity logging -> Member creation / enrollment resolution | Weak | `members`, `leads` | canonical member resolution plus MCC/MHP read surfaces | Formal conversion still exists through `enrollMemberFromLeadAction` and the canonical resolver stack. | Packet completion records outcome `Enrollment Packet Completed`, but conversion logic in `lib/services/sales-lead-activities.ts` only treats `Enrollment completed` and `Member start confirmed` as real conversion outcomes. The labels still do not line up naturally. |
| Member creation / enrollment resolution -> Intake Assessment | Partial | `intake_assessments`, `assessment_responses`, `intake_assessment_signatures`, `member_files` | `getAssessmentDetail` | `createAssessmentAction` in `app/intake-actions.ts` resolves canonical identity first and uses the RPC-backed intake write path in `lib/services/intake-pof-mhp-cascade.ts`. | Intake creation is real, but post-sign completion can still need follow-up for e-sign, draft POF verification, or Member Files verification. |
| Intake Assessment -> Physician Orders / POF generation | Partial | `physician_orders` | `getPhysicianOrdersForMember`, `getPhysicianOrderById` | `autoCreateDraftPhysicianOrderFromIntake` still calls `createDraftPhysicianOrderFromAssessment` in `lib/services/physician-orders-supabase.ts`, so the canonical draft POF write path exists. | This handoff is not broken, but it is not always fully ready: immediate readback can fail, and the service can return follow-up-needed truth even after the draft POF commit. |
| Physician Orders / POF generation -> Provider signature completion | Strong | `pof_requests`, `pof_signatures`, `document_events`, `member_files`, `physician_orders` | `getPofRequestTimeline`, `listPofTimelineForPhysicianOrder` | `lib/services/pof-esign.ts` and `lib/services/pof-esign-public.ts` still handle request creation, replay safety, signing, and signed artifact persistence canonically. | Remaining risk is not signature capture itself. It is downstream sync after signature commits. |
| Provider signature completion -> MHP generation / sync | Partial | `physician_orders`, `member_health_profiles` | `getMemberHealthProfileDetailSupabase` | Signed POF state is durable, and the post-sign path explicitly tracks follow-up through `runBestEffortCommittedPofSignatureFollowUp` and `processSignedPhysicianOrderPostSignSync`. | Signed does not always mean clinically synced. The code explicitly says not to treat the order as operationally ready when MHP/MCC/MAR sync is queued or incomplete. |
| MHP generation / sync -> MCC downstream visibility | Partial | `member_health_profiles`, `member_command_centers`, `member_attendance_schedules`, `member_contacts` | `getMemberCommandCenterDetailSupabase` | MCC visibility is still canonical and Supabase-backed. | Detail reads still hard-fail if `member_health_profiles`, `member_command_centers`, or `member_attendance_schedules` shell rows are missing. |
| MCC downstream visibility -> Care Plan creation / signature workflow | Partial | `care_plans`, `care_plan_sections`, `care_plan_versions`, `care_plan_review_history`, `care_plan_signature_events`, `member_files` | `getLatestCarePlanForMember`, `getMemberCarePlanSummary` | Care Plan create, review, nurse sign, caregiver dispatch, and caregiver public sign remain canonical service-layer flows. | These paths now return more honest follow-up-needed truth, but callers must respect readiness state instead of treating any persisted row as fully complete. |
| Care Plan creation / signature workflow -> MAR generation from POF meds | Weak | `pof_medications`, `mar_schedules` | `getMarWorkflowSnapshot` | MAR generation is still canonical once signed POF post-sign sync populates medication state. | Care Plan completion is not the trigger. Signed POF post-sign sync is the real medication-readiness boundary. |
| MAR generation from POF meds -> MAR documentation workflow | Strong | `mar_administrations`, `med_administration_logs` | `getMarWorkflowSnapshot` | Scheduled and PRN MAR documentation remain canonical in `lib/services/mar-workflow.ts` and `lib/services/mar-prn-workflow.ts`. | The main risk here is upstream readiness confusion, not fake MAR writes. |
| MAR documentation workflow -> Monthly MAR summary or PDF generation | Strong | read-heavy handoff | `assembleMarMonthlyReportData` | Monthly MAR reporting still reads canonical medication/admin/member data and builds deterministic PDF output. | Main risk is upstream data quality, not report generation architecture. |
| Monthly MAR summary or PDF generation -> Member Files persistence | Partial | `member_files` | `listMemberFilesSupabase` | The MAR monthly PDF path saves through `saveGeneratedMemberPdfToFiles`. | Generated PDF does not always mean verified Member Files persistence; the action now returns follow-up-needed when verification is incomplete. |
| Completion notifications or alerts | Partial | `user_notifications` | `listUserNotificationsForUser` | `recordWorkflowMilestone` in `lib/services/lifecycle-milestones.ts` now treats zero inserted notifications as explicit follow-up-needed truth. | Notification delivery truth is stronger than notification wording, especially for signed POF readiness. |

## 3. Critical Failures

1. **Enrollment Packet completion still does not naturally complete formal enrollment.**  
   Why it matters: a caregiver can finish the packet, and staff can see a completed packet, but the lead can still remain short of the platform's formal enrollment milestone.  
   Evidence: `lib/services/enrollment-packet-completion-cascade.ts` records outcome `Enrollment Packet Completed`, while `lib/services/sales-lead-activities.ts` only treats `Enrollment completed` and `Member start confirmed` as conversion outcomes.

2. **Signed POF notification wording still overstates readiness.**  
   Why it matters: nurses can read the signed notification and assume clinical downstream work is done when the code still treats MHP, MCC, and MAR sync as queued or incomplete.  
   Evidence: `lib/services/notification-content.ts` says "Clinical documents are ready for review," while `lib/services/physician-order-clinical-sync.ts` and `lib/services/physician-order-post-sign-service.ts` explicitly say not to treat the order as operationally ready yet.

3. **Missing shell rows still break MHP/MCC downstream visibility.**  
   Why it matters: one missing canonical shell row can block nurse/admin workflows instead of stepping into an explicit repair path automatically.  
   Evidence: `lib/services/member-health-profiles-supabase.ts`, `lib/services/member-command-center-supabase.ts`, and `lib/services/enrollment-packet-intake-mapping.ts` throw hard errors when required shell rows are absent.

4. **Care Plan completion is still not the canonical MAR readiness gate.**  
   Why it matters: staff can wrongly assume that a completed care plan means medications are ready on MAR.  
   Evidence: MAR generation is still driven from signed POF post-sign sync in `lib/services/pof-post-sign-runtime.ts` and `lib/services/physician-order-post-sign-service.ts`, not from care-plan completion services.

## 4. Canonicality Risks

- **No new fake persistence path found.** I did not find a new runtime mock backend, in-memory persistence path, or local-only substitute in this lifecycle.
- **Formal milestone language is still inconsistent.** Packet completion and conversion still use different outcome labels, which is a canonical workflow truth problem, not just a wording problem.
- **Early member-shell creation still blurs lifecycle meaning.** Sending an Enrollment Packet can require canonical member linkage before formal enrollment resolution is truly complete.
- **Several flows now return honest degraded truth instead of fake success.** That is safer, but only if the UI and staff treat `follow_up_required` and `queued_degraded` as real workflow states.
- **MAR readiness is still cross-module truth.** Care Plan completion and signed POF are different milestones, and only signed POF post-sign sync is the real medication-readiness boundary.

## 5. Schema / Runtime Risks

- **Shell-row dependency remains strict.** `member_health_profiles`, `member_command_centers`, and `member_attendance_schedules` must already exist for several downstream reads and enrollment-packet mapping updates.
- **Signed POF downstream sync still depends on queue/runner health.** The post-sign workflow is honest about this, but if queue health is degraded, a signed order can remain queued or follow-up-needed instead of operationally ready.
- **Intake and document-generation flows now surface verification gaps directly.** That is safer than silent drift, but it still means missing queueing or readback verification will show up as incomplete readiness to staff.
- **This pass was not a live E2E run.** The conclusions above are from static and manual source review. The repo already contains live scripts for Enrollment Packet and POF signing, but running them would create real Supabase/storage/notification side effects.
- **Targeted local tests could not run in this sandbox.** Node test execution failed with `spawn EPERM`, so this report should not be read as test-validated in the current environment.

## 6. Document / Notification / File Persistence Findings

- **Enrollment Packet remains the strongest document-completion workflow.** Packet completion persists signatures, uploads, and completed packet artifacts, then records whether downstream mapping is truly finished or still pending.
- **Intake PDF persistence is honest but not always seamless.** `completeIntakeAssessmentPostSignWorkflow` in `lib/services/intake-pof-mhp-cascade.ts` can queue follow-up when the PDF upload completes but canonical Member Files verification does not.
- **POF PDF persistence now tells the truth when verification is incomplete.** `generatePhysicianOrderPdfAction` in `app/(portal)/health/physician-orders/actions.ts` returns `status: "follow-up-needed"` when the PDF exists but `member_files` verification did not complete.
- **Care Plan caregiver signing still protects final artifact truth.** `lib/services/care-plan-esign-public.ts` throws if finalization does not produce a committed final Member Files reference.
- **MAR monthly PDF persistence is stronger than before.** `app/(portal)/health/mar/actions-impl.ts` returns `status: "follow-up-needed"` instead of synthetic success when the PDF exists but verified Member Files persistence is missing.
- **Notification delivery truth is better than notification wording.** `lib/services/lifecycle-milestones.ts` records follow-up-needed when no `user_notifications` rows were created, but the signed POF notification copy still overstates readiness.

## 7. Fix First

1. **Decide whether Enrollment Packet completion should formally finish enrollment.**  
   If yes, route it through the same canonical conversion milestone logic. If no, make the manual boundary obvious in UI wording and workflow status.

2. **Fix signed POF notification wording immediately.**  
   Signed must never read like MHP, MCC, and MAR are already ready when the code still treats downstream sync as queued or incomplete.

3. **Make shell-row repair an explicit operational workflow.**  
   Keep strict failure behavior, but provide a clear admin-facing repair path whenever MHP, MCC, or attendance shell rows are missing.

4. **Standardize verified Member Files truth across Intake, POF PDF, MAR PDF, and similar generated-document flows.**  
   A generated document should only read complete when `member_files` verification is actually done.

5. **Run the live Enrollment Packet and POF signing E2E scripts in a safe environment after the above fixes.**  
   Those are the highest-value live checks because they have the biggest operational blast radius for nurses, admins, and caregivers.

## 8. Regression Checklist

1. Send an Enrollment Packet and verify `enrollment_packet_requests`, packet events, and canonical lead/member linkage.
2. Complete the packet from the public link and verify signatures, uploads, completed packet artifact, mapping status, and completion follow-up status.
3. Confirm whether packet completion is supposed to finish formal enrollment. If yes, verify conversion happens automatically. If no, verify the workflow clearly says conversion is still separate.
4. Convert the lead and verify one canonical member linked by `members.source_lead_id`, with MHP, MCC, and attendance shell rows present.
5. Submit Intake Assessment and verify assessment rows, signature state, draft POF creation result, and intake PDF persistence truth.
6. Complete provider POF signature and verify the signed artifact plus downstream post-sign sync status for MHP, MCC, and MAR.
7. Confirm signed POF notifications do not claim operational readiness while post-sign sync is still queued or degraded.
8. Create, review, sign, and caregiver-sign a Care Plan and verify final artifact persistence plus post-sign readiness truth.
9. Generate a monthly MAR PDF and verify `member_files` persistence is either confirmed or explicitly follow-up-needed.
10. Verify notifications never claim operational readiness when enrollment conversion, downstream sync, or file verification is still pending.
