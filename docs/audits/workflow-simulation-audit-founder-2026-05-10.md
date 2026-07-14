# Workflow Simulation Audit Report
_Generated: 2026-05-10 EDT_
_Scope: static code-path audit plus manual verification of canonical service, RPC, file-persistence, identity, and notification truth. Live end-to-end submission checks were not run because these flows create real Supabase rows, storage artifacts, and email side effects._

## 1. Executive Summary

Overall lifecycle health is **Partial**.

The audited workflow is still fundamentally **Supabase-backed and real**. I did not find a new runtime mock backend, fake persistence layer, or local-only storage substitute in the lifecycle reviewed here.

The main problem is still **handoff truth after the core write commits**. Several workflows now save the canonical row correctly, but the next operational step can still be queued, follow-up-required, or manual. That means staff can see a successful save before the member is actually ready for nurses, admins, or caregivers to continue safely.

The highest-risk founder-level truths from this pass are:

1. **Enrollment Packet completion still does not naturally finish formal lead-to-member enrollment resolution.**
2. **Signed POF messaging can still sound operationally ready before downstream MHP, MCC, and MAR sync is actually complete.**
3. **Care Plan completion is still not the real MAR readiness gate.**
4. **MHP and MCC detail flows still hard-fail when required canonical shell rows are missing.**
5. **Generated document and completion-notification truth is still inconsistent outside the strongest packet and shared member-files paths.**

## 2. Lifecycle Handoff Table

| Lifecycle handoff | Status | What is working | Main risk |
|---|---|---|---|
| Lead -> Send Enrollment Packet | Strong | `sendEnrollmentPacketRequest` in `lib/services/enrollment-packets-send-runtime.ts` enforces canonical lead/member linkage, persists the packet request and event rows, and logs milestone truth. | This path can create or refresh a canonical `members` row early through `ensureCanonicalMemberForLead`, which helps identity safety but can be mistaken for formal enrollment completion. |
| Send Enrollment Packet -> Enrollment Packet completion / e-sign return | Partial | `submitPublicEnrollmentPacket` in `lib/services/enrollment-packets-public-runtime.ts` persists signatures, uploads, request completion, and completion follow-up truth. | Completion can be durable while mapping, lead-activity sync, or file verification still lands in `filed_pending_mapping`, `queued_degraded`, or `follow_up_required`. |
| Enrollment Packet completion / e-sign return -> Lead activity logging | Partial | `runEnrollmentPacketCompletionCascade` in `lib/services/enrollment-packet-completion-cascade.ts` tries to write `Enrollment Packet Completed` through `syncEnrollmentPacketLeadActivityOrQueue`. | The lead activity is still post-commit follow-up, not part of the same atomic completion boundary. |
| Lead activity logging -> Member creation / enrollment resolution | Weak | Formal conversion exists through `enrollMemberFromLeadAction` in `app/sales-lead-actions.ts` and the closed-won conversion path. | Packet workflows write `Enrollment Packet Completed`, but `lib/services/sales-lead-activities.ts` only treats `Enrollment completed` or `Member start confirmed` as conversion outcomes, so packet completion does not naturally finish formal enrollment. |
| Member creation / enrollment resolution -> Intake Assessment | Partial | `createAssessmentAction` in `app/intake-actions.ts` resolves canonical lead/member identity first, then creates and signs the assessment through the canonical intake service and RPC-backed write path. | Intake can commit while nurse/admin e-sign, draft POF verification, or PDF member-file persistence still needs staff follow-up. |
| Intake Assessment -> Physician Orders / POF generation | Partial | This handoff is not broken. `autoCreateDraftPhysicianOrderFromIntake` in `lib/services/intake-pof-mhp-cascade.ts` calls `createDraftPhysicianOrderFromAssessment` in `lib/services/physician-orders-supabase.ts`, which is still the canonical draft POF write path. | The draft can commit but fail immediate readback verification, which correctly degrades to follow-up-needed instead of full readiness. |
| Physician Orders / POF generation -> Provider signature completion | Strong | POF request creation, provider link flow, replay safety, signed artifact persistence, and request telemetry remain canonical in `lib/services/pof-esign.ts` and `lib/services/pof-esign-public.ts`. | The remaining risk is not signature capture. It is the downstream clinical sync after signature commits. |
| Provider signature completion -> MHP generation / sync | Partial | Signed POF state is durable, and downstream sync is explicit through `processSignedPhysicianOrderPostSignSync` in `lib/services/physician-order-post-sign-service.ts`. | Signed does not always mean clinically synced. The service can still queue follow-up and explicitly says not to treat the order as operationally ready yet. |
| MHP generation / sync -> MCC visibility | Partial | MCC list visibility remains stronger because the index page now uses the privileged canonical read path. | MHP and MCC detail still hard-fail when `member_health_profiles`, `member_command_centers`, or `member_attendance_schedules` shell rows are missing. |
| MCC visibility -> Care Plan creation and signature workflow | Partial | Care Plan create, review, nurse sign, caregiver dispatch, and caregiver sign remain canonical in `lib/services/care-plans-supabase.ts`, `lib/services/care-plan-esign.ts`, and `lib/services/care-plan-esign-public.ts`. | Action layers still return committed-but-follow-up-required truth, so callers must respect readiness fields and not assume `ok: true` means fully operational. |
| Care Plan creation / signature workflow -> MAR generation from POF meds | Weak | MAR generation is canonical once signed POF medication sync has populated the downstream medication state. | Care Plan completion is still not the real readiness gate. MAR depends on signed POF post-sign sync, not on care-plan completion. |
| MAR generation from POF meds -> MAR documentation workflow | Strong | Scheduled and PRN MAR documentation remain canonical in `lib/services/mar-workflow.ts` and `lib/services/mar-prn-workflow.ts`, with RPC-backed scheduled administration writes and explicit not-given / PRN follow-up handling. | Main remaining risk is upstream readiness confusion, not MAR write-path integrity. |
| MAR documentation workflow -> Monthly MAR summary or PDF generation | Strong | `assembleMarMonthlyReportData` in `lib/services/mar-monthly-report.ts` reads canonical MAR, medication, and member data. | Main risk is upstream data quality or missing source data, not fake report generation. |
| Monthly MAR summary or PDF generation -> Member Files persistence | Partial | `generateMonthlyMarReportPdfAction` in `app/(portal)/health/mar/actions-impl.ts` saves through `saveGeneratedMemberPdfToFiles` and returns verification truth. | The PDF can generate successfully while `member_files` verification still comes back `follow-up-needed`. |
| Member Files persistence -> Completion notifications or alerts | Weak | `recordWorkflowMilestone` in `lib/services/lifecycle-milestones.ts` now treats missing `user_notifications` rows as follow-up-needed instead of silent success. | Notification coverage and message quality are still inconsistent. Some workflows say “ready” too early, and generated-document success does not yet emit one consistent completion milestone across the lifecycle. |

## 3. Critical Failures

1. **Enrollment Packet completion still does not naturally complete formal enrollment.**  
   Why it matters: a caregiver can finish the packet and staff can see a completed packet, but the lead may still not be formally resolved into the canonical enrolled-member workflow.  
   Evidence: `runEnrollmentPacketCompletionCascade` in `lib/services/enrollment-packet-completion-cascade.ts` writes `Enrollment Packet Completed`, while `lib/services/sales-lead-activities.ts` only treats `Enrollment completed` or `Member start confirmed` as conversion outcomes.

2. **Signed POF success messaging can overstate readiness.**  
   Why it matters: nurses can read “signed” and assume downstream clinical records are ready, even when MHP, MCC, and MAR sync is still queued.  
   Evidence: `lib/services/notification-content.ts` says `POF signed ... Clinical documents are ready for review`, while `lib/services/physician-order-post-sign-service.ts` explicitly warns that downstream sync may still be incomplete and should not be treated as operationally ready.

3. **Care Plan completion is still not the canonical MAR readiness gate.**  
   Why it matters: staff can infer that MAR should now be ready because the care plan is done, but MAR readiness actually depends on signed POF medication sync.  
   Evidence: MAR generation is driven from signed POF sync in `lib/services/physician-order-post-sign-service.ts` and `lib/services/mar-workflow.ts`, not from care-plan completion in `lib/services/care-plans-supabase.ts`.

4. **MHP and MCC still hard-fail when required shell rows are missing.**  
   Why it matters: one missing canonical shell row can block downstream visibility for nurses or admins instead of guiding them through an explicit recovery workflow.  
   Evidence: `lib/services/member-health-profiles-supabase.ts`, `lib/services/member-health-profiles-helpers.ts`, and `lib/services/member-command-center-supabase.ts` throw explicit missing-shell errors instead of repairing at read time.

## 4. Canonicality Risks

- **No new fake persistence path found.** I did not find a new runtime mock backend, local-only write path, or in-memory substitute in the lifecycle reviewed here.
- **Lead/member identity remains strict, but early shell creation still blurs milestones.** The enrollment-packet send path can create a canonical member anchor before formal enrollment resolution is truly finished.
- **Packet activity outcomes still do not line up with conversion outcomes.** Packet flows write `Enrollment Packet Sent` and `Enrollment Packet Completed`, while formal conversion logic watches different outcome labels.
- **Committed-success patterns still require caller discipline.** Intake, care plan, lead activity, and document workflows can return committed truth with follow-up-needed readiness. Operators and UI must not treat `ok: true` by itself as “fully ready.”
- **MAR readiness is still cross-module truth.** Care Plan completion and signed POF are different milestones, and only the signed POF post-sign sync is the canonical medication-readiness gate.

## 5. Schema / Runtime Risks

- **Canonical shell dependency remains strict.** `member_health_profiles`, `member_command_centers`, and `member_attendance_schedules` must already exist for several downstream reads and mappings.
- **Lead conversion still carries the shell-provisioning contract.** The lifecycle depends on the canonical conversion path creating the downstream shells correctly instead of later reads repairing them.
- **Enrollment Packet downstream mapping now correctly refuses silent fallback.** That is good for safety, but it also means missing shell rows will stop downstream mapping until repaired.
- **Draft POF and MAR still depend on migration-backed RPCs.** If those RPCs drift or are missing, the workflow will fail explicitly rather than silently succeeding.
- **Live side-effecting verification was not run in this pass.** This report is based on static and manual code-path review, not on a fresh real submission through production-like flows.

## 6. Document / Notification / File Persistence Findings

- **Enrollment Packet remains the strongest artifact-completion workflow.** Packet completion persists signatures, uploads, and the completed packet artifact, then records readiness and follow-up truth if mapping or linking is incomplete.
- **Intake PDF persistence is honest but not fully automatic.** Intake can save the PDF through `saveGeneratedMemberPdfToFiles`, but it still queues follow-up if the canonical member-file record cannot be verified immediately.
- **Signed POF file persistence is durable, but success messaging is weaker than persistence truth.** The signed artifact path is real, but completion messaging still risks implying downstream clinical readiness too early.
- **Care Plan caregiver signing enforces final-file truth.** The public care-plan sign flow expects the final signed care-plan member file to exist and fails explicitly if it drifts.
- **Monthly MAR PDF persistence is stronger now.** `generateMonthlyMarReportPdfAction` returns `follow-up-needed` when the PDF was generated but `member_files` verification did not complete.
- **Notification delivery truth is stronger than notification wording.** `recordWorkflowMilestone` now records follow-up-needed or failed delivery states when no `user_notifications` rows are created, but content quality and milestone coverage are still inconsistent across workflows.

## 7. Fix First

1. **Decide whether Enrollment Packet completion should formally finish lead-to-member enrollment resolution.** If yes, wire it through the canonical conversion path. If no, make the manual boundary impossible to miss in workflow status and UI wording.
2. **Fix signed POF success wording immediately.** Queued post-sign sync must never read like MHP, MCC, and MAR are already ready.
3. **Make MAR readiness language explicit everywhere.** Signed POF clinical sync is the gate, not Care Plan completion.
4. **Keep strict shell-row enforcement, but improve repair visibility.** Missing MHP, MCC, or attendance shells should stay explicit failures, but staff need a clearer operational recovery path.
5. **Standardize generated-document completion milestones.** Signed POFs, signed Care Plans, Intake PDFs, and MAR PDFs should all emit one consistent success milestone only after verified `member_files` persistence.

## 8. Regression Checklist

1. Send an Enrollment Packet and verify `enrollment_packet_requests`, packet events, and the canonical lead/member link.
2. Complete the packet from the public link and verify signatures, uploads, completed packet artifact, mapping status, and `completion_follow_up_status`.
3. Confirm whether packet completion is supposed to finish formal enrollment. If yes, verify the member conversion happens automatically. If no, verify the workflow clearly says conversion is still separate.
4. Convert the lead and verify one canonical member linked by `members.source_lead_id`, with downstream MHP, MCC, and attendance shells present.
5. Submit Intake Assessment and verify the assessment rows, signature state, draft POF result, and intake PDF persistence truth.
6. Complete provider POF signature and verify both the signed artifact and the downstream post-sign sync status for MHP, MCC, and MAR.
7. Confirm MHP, MCC, and MAR surfaces show queued or follow-up-required truth when signed-POF sync is not actually finished.
8. Create, review, sign, and caregiver-sign a Care Plan and verify final artifact persistence plus post-sign readiness truth.
9. Generate a monthly MAR PDF and verify `member_files` persistence is either confirmed or explicitly follow-up-needed.
10. Verify notifications never claim operational readiness when downstream sync, conversion, or file verification is still pending.
