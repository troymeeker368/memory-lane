# Workflow Simulation Audit Report
_Generated: 2026-05-11 EDT_
_Scope: static code-path audit plus manual verification of canonical service, identity, file persistence, resolver, and notification truth. Live side-effecting checks were not run in this pass because the available E2E scripts create real Supabase rows, storage artifacts, and notification/email side effects._

## 1. Executive Summary

Overall lifecycle health is **Partial**.

The good news is that this lifecycle is still **real and Supabase-backed**. I did not find a new runtime mock backend, fake persistence layer, or local-only storage substitute in the audited path.

The main risk is still **handoff truth after the core write succeeds**. Several workflows now save the canonical row correctly, but the next operational step can still be queued, degraded, or staff-follow-up-required. That means a nurse, admin, or caregiver can see a successful save before the member is actually ready for the next real workflow step.

The highest-risk founder-level truths from this run are:

1. **Enrollment Packet completion still does not naturally finish formal lead-to-member enrollment resolution.**
2. **Signed POF notification wording can still sound more complete than the downstream clinical sync really is.**
3. **MHP and MCC detail flows still depend on pre-provisioned canonical shell rows and hard-fail when those rows are missing.**
4. **Care Plan completion is still not the real MAR readiness gate.**
5. **Document persistence truth is better than before, but Intake, POF, and MAR still rely on follow-up-needed results when `member_files` verification does not complete immediately.**

## 2. Lifecycle Handoff Table

| Lifecycle handoff | Status | Expected canonical write | Expected downstream resolver/read | What is working | Main risk |
|---|---|---|---|---|---|
| Lead -> Send Enrollment Packet | Strong | `enrollment_packet_requests`, `enrollment_packet_events`, `lead_activities` | `listEnrollmentPacketRequestsForLead`, `listEnrollmentPacketRequestsForMember` | `sendEnrollmentPacketRequest` in `lib/services/enrollment-packets-send-runtime.ts` enforces canonical lead/member linkage, persists the packet request and packet event, and records workflow milestones. | This path still calls `ensureCanonicalMemberForLead`, so an early canonical member shell can exist before formal enrollment resolution is truly complete. |
| Send Enrollment Packet -> Enrollment Packet completion / e-sign return | Partial | `enrollment_packet_fields`, `enrollment_packet_signatures`, `enrollment_packet_uploads`, `enrollment_packet_requests`, `member_files`, `enrollment_packet_mapping_runs` | `buildPublicEnrollmentPacketSubmitResult` | `submitPublicEnrollmentPacket` in `lib/services/enrollment-packets-public-runtime.ts` persists signatures, uploads, request completion, and completed packet artifacts. | Completion can still land in `filed_pending_mapping`, `queued_degraded`, or `follow_up_required`, so completed does not always mean operationally ready. |
| Enrollment Packet completion / e-sign return -> Lead activity logging | Partial | `lead_activities` | `getSalesRecentActivitySnapshotSupabase` | `runEnrollmentPacketCompletionCascade` calls `syncEnrollmentPacketLeadActivityOrQueue` to write packet-completion activity into the sales timeline. | The lead activity is still a post-commit follow-up concern, not part of the same atomic completion boundary as the caregiver submission itself. |
| Lead activity logging -> Member creation / enrollment resolution | Weak | `members`, `leads` | MCC index/member resolution paths | Formal lead conversion still exists through `enrollMemberFromLeadAction` and canonical lead/member resolvers. | Packet completion writes `Enrollment Packet Completed`, but conversion logic still only treats `Enrollment completed` and `Member start confirmed` as formal conversion outcomes. The workflow labels still do not line up naturally. |
| Member creation / enrollment resolution -> Intake Assessment | Partial | `intake_assessments`, `assessment_responses`, `intake_assessment_signatures`, `member_files` | `getAssessmentDetail` | `createAssessmentAction` resolves canonical identity first, then the intake service and RPC-backed write path create the assessment and response rows. | Intake completion can still require follow-up for draft POF creation, e-sign downstream work, or intake PDF member-file verification. |
| Intake Assessment -> Physician Orders / POF generation | Partial | `physician_orders` | `getPhysicianOrdersForMember`, `getPhysicianOrderById` | `autoCreateDraftPhysicianOrderFromIntake` in `lib/services/intake-pof-mhp-cascade.ts` still calls `createDraftPhysicianOrderFromAssessment` in `lib/services/physician-orders-supabase.ts`, so the canonical draft POF write path exists. | The draft can commit but still return follow-up-needed truth when immediate readback verification or downstream steps fail. This handoff is not fake, but it is not fully operationally ready on every successful save. |
| Physician Orders / POF generation -> Provider signature completion | Strong | `pof_requests`, `pof_signatures`, `document_events`, `member_files`, `physician_orders` | `getPofRequestTimeline`, `listPofTimelineForPhysicianOrder` | POF request creation, public sign flow, replay safety, signed artifact persistence, and timeline reads remain canonical in `lib/services/pof-esign.ts` and `lib/services/pof-esign-public.ts`. | The remaining risk is not signature capture. It is downstream clinical sync after signature commits. |
| Provider signature completion -> MHP generation / sync | Partial | `physician_orders`, `member_health_profiles` | `getMemberHealthProfileDetailSupabase` | Signed POF state is durable, and downstream follow-up is explicit through `processSignedPhysicianOrderPostSignSync`. | Signed does not always mean clinically synced. The service explicitly warns that MHP, MCC, and MAR sync may still be queued or incomplete. |
| MHP generation / sync -> MCC downstream visibility | Partial | `member_health_profiles`, `member_command_centers`, `member_attendance_schedules`, `member_contacts` | `getMemberCommandCenterDetailSupabase` | MCC visibility remains canonical, and the privileged read path on the index surface is stronger than older fallback behavior. | Detail workflows still hard-fail if `member_health_profiles`, `member_command_centers`, or `member_attendance_schedules` shell rows are missing. |
| MCC downstream visibility -> Care Plan creation / signature workflow | Partial | `care_plans`, `care_plan_sections`, `care_plan_versions`, `care_plan_review_history`, `care_plan_signature_events`, `member_files` | `getLatestCarePlanForMember`, `getMemberCarePlanSummary` | Care Plan create, review, nurse sign, caregiver dispatch, and caregiver public sign remain canonical service-layer flows. | These paths now return more honest follow-up-required truth, but callers still must respect readiness fields instead of treating any `ok: true` as full readiness. |
| Care Plan creation / signature workflow -> MAR generation from POF meds | Weak | `pof_medications`, `mar_schedules` | `getMarWorkflowSnapshot` | MAR generation remains canonical once the signed POF post-sign sync populates medication state. | Care Plan completion is still not the MAR readiness gate. Signed POF post-sign sync is the real trigger. |
| MAR generation from POF meds -> MAR documentation workflow | Strong | `mar_administrations`, `med_administration_logs` | `getMarWorkflowSnapshot` | Scheduled and PRN MAR documentation remain canonical in `lib/services/mar-workflow.ts` and `lib/services/mar-prn-workflow.ts`, including not-given and PRN outcome flows. | Main remaining risk is upstream readiness confusion, not fake MAR write behavior. |
| MAR documentation workflow -> Monthly MAR summary or PDF generation | Strong | Read-heavy handoff | `assembleMarMonthlyReportData` | Monthly MAR reporting still reads canonical MAR, medication, and member data and builds deterministic PDF output. | Main risk is upstream data quality, not report generation architecture. |
| Monthly MAR summary or PDF generation -> Member Files persistence | Partial | `member_files` | `listMemberFilesSupabase` | The MAR monthly PDF path saves through `saveGeneratedMemberPdfToFiles` and now returns follow-up-needed if `member_files` verification does not complete. | Generated PDF does not always mean verified member-file persistence yet. Staff can still need follow-up. |
| Completion notifications or alerts | Partial | `user_notifications` | `listUserNotificationsForUser` | `recordWorkflowMilestone` now treats zero inserted `user_notifications` rows as explicit follow-up-needed truth instead of silent success. | Notification delivery truth is stronger than notification wording. The POF signed message still reads more ready than the downstream sync status really is, and milestone coverage is not yet perfectly uniform across document completions. |

## 3. Critical Failures

1. **Enrollment Packet completion still does not naturally complete formal enrollment.**  
   Why it matters: a caregiver can finish the packet and staff can see a completed packet, but the lead may still not move through the canonical formal enrollment milestone automatically.  
   Evidence: `lib/services/enrollment-packet-completion-cascade.ts` records outcome `Enrollment Packet Completed`, while `lib/services/sales-lead-activities.ts` only treats `Enrollment completed` and `Member start confirmed` as formal conversion outcomes.

2. **Signed POF wording can overstate operational readiness.**  
   Why it matters: nurses can read a signed notification and assume downstream clinical records are ready even when MHP, MCC, and MAR sync is still queued.  
   Evidence: `lib/services/notification-content.ts` says "Clinical documents are ready for review," while `lib/services/physician-order-clinical-sync.ts` and `lib/services/physician-order-post-sign-service.ts` explicitly say not to treat the order as operationally ready yet when downstream sync is queued or incomplete.

3. **MHP and MCC still hard-fail when canonical shell rows are missing.**  
   Why it matters: one missing shell row can block downstream nurse/admin visibility instead of stepping into an explicit repair workflow automatically.  
   Evidence: `lib/services/member-health-profiles-helpers.ts` and `lib/services/enrollment-packet-intake-mapping.ts` throw missing-shell errors instead of repairing at read time.

4. **Care Plan completion is still not the canonical MAR readiness gate.**  
   Why it matters: staff can assume that a completed care plan means MAR is ready, but the actual medication readiness boundary is still signed POF post-sign sync.  
   Evidence: MAR generation is driven from signed POF follow-up services, not from care-plan completion services.

## 4. Canonicality Risks

- **No new fake persistence path found.** I did not find a new runtime mock backend, in-memory runtime persistence path, or local-only file substitute in this lifecycle.
- **Early canonical member creation still blurs milestones.** Sending an Enrollment Packet still requires canonical member linkage, which is safer for identity but can blur the difference between "member shell exists" and "formal enrollment is complete."
- **Packet-completion activity and conversion activity still speak different languages.** The packet-completion outcome label is still different from the outcome labels that drive formal enrollment state.
- **Committed-success patterns still require UI discipline.** Several actions now honestly return follow-up-needed states instead of fake success, but the UI and operators must respect those readiness fields.
- **MAR readiness remains cross-module truth.** Care Plan completion and signed POF are separate milestones, and only signed POF post-sign sync is the medication-readiness gate.

## 5. Schema / Runtime Risks

- **Canonical shell dependency remains strict.** `member_health_profiles`, `member_command_centers`, and `member_attendance_schedules` must already exist for several downstream reads and packet-mapping updates.
- **Signed POF downstream sync depends on runtime runner health.** `lib/services/internal-runner-health.ts` explicitly warns that queued POF post-sign sync is not release-safe if the internal runner is not configured.
- **Signed POF follow-up still depends on queue/RPC health.** `lib/services/pof-post-sign-runtime.ts` and the post-sign service keep the workflow honest, but runtime misconfiguration can still leave a signed order in queued degraded state.
- **Intake, MAR, and document flows now prefer explicit follow-up over silent drift.** That is safer, but it means missing verification or queueing infrastructure still surfaces as incomplete readiness rather than transparent automation.
- **This pass did not run live E2E scripts.** The conclusions above are based on static and manual source review, not on a fresh real submission against a live Supabase environment.

## 6. Document / Notification / File Persistence Findings

- **Enrollment Packet remains the strongest document-completion workflow.** Packet completion persists signatures, uploads, and completed packet artifacts, then records whether downstream mapping is actually finished or still pending.
- **Intake PDF persistence is honest but still not fully seamless.** `lib/services/intake-pof-mhp-cascade.ts` queues follow-up when the PDF uploads but canonical `member_files` verification does not complete immediately.
- **POF PDF persistence now returns explicit follow-up-needed truth.** `app/(portal)/health/physician-orders/actions.ts` returns `status: "follow-up-needed"` when the POF PDF was generated and uploaded but `member_files` verification did not complete.
- **Care Plan caregiver signing still protects final artifact truth.** `lib/services/care-plan-esign-public.ts` throws if finalization does not produce a committed final member-file reference and records a milestone only after final file truth is present.
- **MAR monthly PDF persistence is stronger than before.** `app/(portal)/health/mar/actions-impl.ts` returns `status: "follow-up-needed"` instead of synthetic success when the PDF exists but `member_files` verification is not yet confirmed.
- **Notification delivery truth is stronger than notification wording.** `lib/services/lifecycle-milestones.ts` now records follow-up-needed truth when no `user_notifications` rows were created, but some content still overstates readiness, especially for signed POFs.

## 7. Fix First

1. **Decide whether Enrollment Packet completion should formally finish enrollment.** If yes, route it through the same canonical conversion milestone logic. If no, make the manual boundary impossible to miss in UI wording and workflow status.
2. **Fix the signed POF notification copy immediately.** Signed must never read like MHP, MCC, and MAR are already ready when the code still treats downstream sync as queued or incomplete.
3. **Make shell-row repair operationally visible.** Keep strict failure behavior, but add a clear admin-facing repair path whenever MHP, MCC, or attendance shell rows are missing.
4. **Standardize verified member-file completion truth across Intake, POF, MAR, and similar generated-document workflows.** A generated PDF should only read complete when `member_files` verification is actually done.
5. **After those fixes, run the live Enrollment Packet and POF signing E2E scripts in a safe environment.** That is the next strongest validation step because those flows have the biggest downstream operational blast radius.

## 8. Regression Checklist

1. Send an Enrollment Packet and verify `enrollment_packet_requests`, packet events, and canonical lead/member linkage.
2. Complete the packet from the public link and verify signatures, uploads, completed packet artifact, mapping status, and completion follow-up status.
3. Confirm whether packet completion is supposed to finish formal enrollment. If yes, verify the member conversion happens automatically. If no, verify the workflow clearly says conversion is still separate.
4. Convert the lead and verify one canonical member linked by `members.source_lead_id`, with MHP, MCC, and attendance shell rows present.
5. Submit Intake Assessment and verify assessment rows, signature state, draft POF creation result, and intake PDF persistence truth.
6. Complete provider POF signature and verify the signed artifact plus downstream post-sign sync status for MHP, MCC, and MAR.
7. Confirm signed POF notifications do not claim operational readiness while post-sign sync is still queued or degraded.
8. Create, review, sign, and caregiver-sign a Care Plan and verify final artifact persistence plus post-sign readiness truth.
9. Generate a monthly MAR PDF and verify `member_files` persistence is either confirmed or explicitly follow-up-needed.
10. Verify notifications never claim operational readiness when enrollment conversion, downstream sync, or file verification is still pending.
