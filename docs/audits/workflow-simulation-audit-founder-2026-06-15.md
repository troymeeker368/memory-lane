# Workflow Lifecycle Simulation Audit
_Generated: 2026-06-15 EDT_
_Scope: static workflow audit plus manual source review of canonical write paths, downstream resolvers, file persistence, and notification truth._
_Validation note: live side-effecting E2E scripts were not run in this pass because the current shell session does not expose `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, or `SUPABASE_SERVICE_ROLE_KEY`, and the live scripts would create real Supabase/storage/notification side effects._

## 1. Executive Summary

Overall lifecycle health is **Partial**.

The lifecycle is still **real and Supabase-backed**. This pass did not find a new runtime mock backend, localStorage persistence path, or fake in-memory substitute inside the audited lead-to-MAR flow.

The main operational risk is still **truth after the primary write**. Memory Lane is increasingly honest about saying "the main record was saved, but downstream work still needs follow-up," which is better than fake success. The remaining danger is that some workflow labels, notifications, and stage boundaries can still make staff think a downstream handoff is complete when it is only committed and queued.

The most important findings for real operations are:

1. **Enrollment Packet completion still does not naturally finish formal enrollment resolution.**
2. **Signed POF notifications still read more complete than the downstream clinical sync really is.**
3. **MHP and MCC views still hard-fail when required shell rows are missing.**
4. **Care Plan completion is still not the real MAR readiness gate.**
5. **Generated document flows are more honest now, but Intake, POF, and MAR PDFs can still land in follow-up-needed state instead of verified Member Files completion.**

## 2. Lifecycle Handoff Table

| Lifecycle handoff | Status | Canonical write | Downstream read/resolver | What is working | Main risk |
|---|---|---|---|---|---|
| Lead -> Send Enrollment Packet | Strong | `enrollment_packet_requests`, `enrollment_packet_events`, `lead_activities` | `listEnrollmentPacketRequestsForLead`, `listEnrollmentPacketRequestsForMember` | `sendEnrollmentPacketRequest` in `lib/services/enrollment-packets-send-runtime.ts` persists the packet request, packet events, and sender milestone using canonical lead/member linkage. | This path still expects the canonical member linkage to exist early, which is safer for identity but can blur the difference between "member shell exists" and "formal enrollment is complete." |
| Send Enrollment Packet -> Enrollment Packet completion / e-sign return | Partial | `enrollment_packet_fields`, `enrollment_packet_signatures`, `enrollment_packet_uploads`, `enrollment_packet_requests`, `member_files`, `enrollment_packet_mapping_runs` | `buildPublicEnrollmentPacketSubmitResult` | `submitPublicEnrollmentPacket` and `runEnrollmentPacketCompletionCascade` persist the public packet, create the completed packet artifact, and trigger downstream mapping. | Completion can still end in mapping failure or follow-up-needed state, so a signed packet is not always operationally ready yet. |
| Enrollment Packet completion / e-sign return -> Lead activity logging | Partial | `lead_activities` | `getSalesRecentActivitySnapshotSupabase` | `runEnrollmentPacketCompletionCascade` calls `syncEnrollmentPacketLeadActivityOrQueue`, so the activity still goes through the canonical lead activity service. | Lead activity is still a post-commit follow-up concern rather than part of the same durable completion boundary as the caregiver submission. |
| Lead activity logging -> Member creation / enrollment resolution | Weak | `members`, `leads` | canonical member resolution plus MCC/MHP read surfaces | Formal lead conversion still exists through `enrollMemberFromLeadAction` and the RPC-backed conversion service. | Packet completion records outcome `Enrollment Packet Completed`, but conversion logic in `lib/services/sales-lead-activities.ts` only treats `Enrollment completed` and `Member start confirmed` as real conversion outcomes. The labels still do not line up naturally. |
| Member creation / enrollment resolution -> Intake Assessment | Partial | `intake_assessments`, `assessment_responses`, `intake_assessment_signatures`, `member_files` | `getAssessmentDetail` | `createAssessmentAction` resolves canonical identity first and writes intake data through the RPC-backed intake service. | Intake creation is real, but the workflow can still finish in follow-up-needed state for nurse/admin signature finalization, draft POF creation, or Member Files verification. |
| Intake Assessment -> Physician Orders / POF generation | Partial | `physician_orders` | `getPhysicianOrdersForMember`, `getPhysicianOrderById` | `autoCreateDraftPhysicianOrderFromIntake` still calls `createDraftPhysicianOrderFromAssessment`, and that function writes through the `rpc_create_draft_physician_order_from_intake` path. | The draft POF write is real, but immediate readback can fail after commit and force a follow-up task. This handoff is not broken, but it is not fully self-healing yet. |
| Physician Orders / POF generation -> Provider signature completion | Strong | `pof_requests`, `pof_signatures`, `document_events`, `member_files`, `physician_orders` | `getPofRequestTimeline`, `listPofTimelineForPhysicianOrder` | The request-send flow persists request state, document events, and notification milestones. Public signature finalization uses `rpc_finalize_pof_signature`, which stores the signature, signed PDF, and member file linkage. | The remaining risk is not signature capture itself. It is downstream sync after signature commits. |
| Provider signature completion -> MHP generation / sync | Partial | `physician_orders`, `member_health_profiles` | `getMemberHealthProfileDetailSupabase` | Signed POF state is durable, and `runBestEffortCommittedPofSignatureFollowUp` plus `processSignedPhysicianOrderPostSignSync` track whether MHP/MCC/MAR sync is actually done. | Signed does not always mean clinically synced. The code explicitly says not to treat the order as operationally ready when post-sign sync is queued or failed. |
| MHP generation / sync -> MCC downstream visibility | Partial | `member_health_profiles`, `member_command_centers`, `member_attendance_schedules`, `member_contacts` | `getMemberCommandCenterDetailSupabase` | MCC remains canonical and Supabase-backed. Enrollment-packet mapping still attempts to populate downstream operational shells. | Detail reads still hard-fail if the required MHP, MCC, or attendance shell rows do not exist. That is safe, but it is still a real operational blocker. |
| MCC downstream visibility -> Care Plan creation / signature workflow | Partial | `care_plans`, `care_plan_sections`, `care_plan_versions`, `care_plan_review_history`, `care_plan_signature_events`, `member_files` | `getLatestCarePlanForMember`, `getMemberCarePlanSummary` | Care Plan create, review, nurse sign, caregiver dispatch, and caregiver public sign remain canonical service-layer flows. | These flows now surface committed-but-follow-up-needed truth, so callers must respect readiness state instead of treating any persisted row as fully complete. |
| Care Plan creation / signature workflow -> MAR generation from POF meds | Weak | `pof_medications`, `mar_schedules` | `getMarWorkflowSnapshot` | MAR generation is still canonical once signed POF post-sign sync populates medication state. | Care Plan completion is not the trigger. Signed POF post-sign sync is the real medication-readiness boundary, so this handoff still invites staff confusion. |
| MAR generation from POF meds -> MAR documentation workflow | Strong | `mar_administrations`, `med_administration_logs` | `getMarWorkflowSnapshot` | Scheduled and PRN MAR documentation remain canonical in `lib/services/mar-workflow.ts` and `lib/services/mar-prn-workflow.ts`, with notification/alert follow-up for not-given and PRN paths. | The main risk here is upstream readiness confusion, not fake MAR writes. |
| MAR documentation workflow -> Monthly MAR summary or PDF generation | Strong | read-heavy handoff | `assembleMarMonthlyReportData` | Monthly MAR reporting still reads canonical medication and administration data and builds deterministic PDF output. | Main risk is upstream data quality, not report generation architecture. |
| Monthly MAR summary or PDF generation -> Member Files persistence | Partial | `member_files` | `listMemberFilesSupabase` | The MAR monthly PDF path saves through `saveGeneratedMemberPdfToFiles` and returns verified vs follow-up-needed truth. | Generated PDF does not always mean verified Member Files persistence. |
| Completion notifications or alerts | Partial | `user_notifications` | `listUserNotificationsForUser` | `recordWorkflowMilestone` now treats zero inserted notifications as explicit follow-up-needed truth instead of silent success. | Notification delivery truth is stronger than notification wording, especially for signed POF readiness. |

## 3. Critical Failures

1. **Enrollment Packet completion still does not naturally finish formal enrollment.**  
   Why it matters: a caregiver can finish the packet and staff can see a completed packet, but the lead can still remain short of the platform's formal enrollment milestone.  
   Evidence: `lib/services/enrollment-packet-completion-cascade.ts` records outcome `Enrollment Packet Completed`, while `lib/services/sales-lead-activities.ts` only treats `Enrollment completed` and `Member start confirmed` as conversion outcomes.

2. **Signed POF notification wording still overstates readiness.**  
   Why it matters: nurses can read the signed notification and assume clinical downstream work is done when the code still treats MHP, MCC, and MAR sync as queued or incomplete.  
   Evidence: `lib/services/notification-content.ts` says "Clinical documents are ready for review," while `lib/services/physician-order-clinical-sync.ts` and `lib/services/physician-order-post-sign-service.ts` explicitly say not to treat the order as operationally ready yet.

3. **Missing shell rows still break MHP/MCC downstream visibility.**  
   Why it matters: one missing canonical shell row can block nurse/admin workflows instead of stepping into an explicit repair path automatically.  
   Evidence: `ensureMemberHealthProfileSupabase` throws when `member_health_profiles` is missing, and MCC required-shell reads throw for missing `member_command_centers` or `member_attendance_schedules`.

4. **Care Plan completion is still not the canonical MAR readiness gate.**  
   Why it matters: staff can wrongly assume that a completed care plan means medications are ready on MAR.  
   Evidence: MAR generation is still driven from signed POF post-sign sync in the POF post-sign services, not from care-plan completion services.

## 4. Canonicality Risks Found During Simulation

- **No new fake persistence path found.** This pass did not find a new runtime mock backend, localStorage persistence path, or in-memory substitute in the audited workflow.
- **Formal milestone language is still inconsistent.** Packet completion and lead conversion still use different outcome labels, which is a canonical workflow truth problem, not just a wording problem.
- **Several flows now return honest degraded truth instead of fake success.** That is safer, but only if the UI and staff treat `follow_up_required`, `queued_degraded`, and similar states as real operational states.
- **MAR readiness is still cross-module truth.** Care Plan completion and signed POF are different milestones, and only signed POF post-sign sync is the real medication-readiness boundary.
- **Notification delivery truth is stricter than some notification copy.** The lifecycle milestone layer is more honest than some user-facing messages.

## 5. Schema / Runtime Risks Exposed by Workflow

- **No obvious new schema drift was found in the audited lifecycle tables.** The major tables and RPC-backed flows referenced in this audit still appear migration-backed.
- **Shell-row dependency remains strict.** `member_health_profiles`, `member_command_centers`, and `member_attendance_schedules` must already exist for some downstream reads and mapping updates.
- **Signed POF downstream sync still depends on queue/runner health.** The post-sign workflow is honest about this, but if queue health is degraded, a signed order can remain queued or follow-up-needed instead of operationally ready.
- **Generated-document workflows still depend on readback verification.** Intake, POF PDF, care plan final artifacts, and MAR PDFs can commit the main artifact work but still require follow-up when verified `member_files` persistence cannot be confirmed.
- **Live E2E was not run on June 15, 2026.** The live scripts would create real Supabase/storage/notification side effects, and the current shell session did not expose the required Supabase env vars.

## 6. Document / Notification / File Persistence Findings

- **Enrollment Packet remains the strongest document-completion workflow.** Packet completion persists signatures, uploads, and completed packet artifacts, then records whether downstream mapping is actually finished.
- **Intake PDF persistence is honest but not always seamless.** `completeIntakeAssessmentPostSignWorkflow` can queue follow-up when the PDF upload succeeds but canonical Member Files verification does not.
- **POF signed artifact persistence is durable, but downstream sync can still lag.** Public POF signature finalization writes the signed PDF and member file through the finalize RPC before post-sign sync runs.
- **Care Plan signing still protects final artifact truth.** The caregiver public sign flow requires the final artifact/member file reference to exist before it treats the workflow as complete.
- **MAR monthly PDF persistence now returns explicit truth.** The action reports `follow-up-needed` instead of synthetic success when the PDF exists but verified Member Files persistence is missing.
- **Notification delivery truth is better than notification wording.** `recordWorkflowMilestone` now records follow-up-needed when no `user_notifications` rows were created, but the signed POF success copy still sounds too final.

## 7. Fix First

1. **Decide whether Enrollment Packet completion should formally finish enrollment.**  
   If yes, route it through the same canonical conversion milestone logic. If no, make the manual boundary obvious in workflow status and UI wording.

2. **Fix signed POF notification wording immediately.**  
   Signed must never read like MHP, MCC, and MAR are already ready when the code still treats downstream sync as queued or incomplete.

3. **Add an explicit repair workflow for missing shell rows.**  
   Keep strict failure behavior, but give admins a clear repair path when MHP, MCC, or attendance shells are missing.

4. **Standardize verified Member Files truth across Intake, POF PDF, MAR PDF, and similar document flows.**  
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
