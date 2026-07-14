# Workflow Simulation Audit Report
_Generated: 2026-05-09 EDT_
_Scope: static code-path audit plus manual verification of canonical service, RPC, file-persistence, and notification truth. Live E2E submission checks were not run because the available flows create real Supabase rows, storage artifacts, and email side effects._

## 1. Executive Summary

Overall lifecycle health is **Partial**.

The good news is that the audited production paths are still **real Supabase-backed workflows**. I did not find a new runtime mock backend, fake persistence layer, or local-only storage path standing in for Supabase in the lifecycle reviewed here.

The main risk is still **operational truth mismatch after commit**. In several places, the core write is durable, but the next handoff is still queued, follow-up-required, or manual. That means staff can see a successful save before the member is actually ready for the next operational step.

The highest-risk founder-level truths from this pass are:

1. **Enrollment Packet completion still does not naturally convert the lead into a formally enrolled member.**
2. **Signed POF notifications can still sound ready before downstream MHP, MCC, and MAR sync is actually complete.**
3. **Care Plan completion is still not the real MAR readiness gate.**
4. **MHP and MCC detail paths still hard-fail if the canonical shell rows are missing.**
5. **Generated-document success milestones are still inconsistent outside the Enrollment Packet upload flow.**

## 2. Lifecycle Handoff Table

| Lifecycle handoff | Status | What is working | Main risk |
|---|---|---|---|
| Lead -> Send Enrollment Packet | Strong | Canonical lead resolution is enforced and the send path persists packet rows through `sendEnrollmentPacketRequest` in `lib/services/enrollment-packets-send-runtime.ts`. | The send path creates or refreshes a canonical `members` row early through `ensureCanonicalMemberForLead`, which is useful for identity anchoring but can be mistaken for formal enrollment. |
| Send Enrollment Packet -> Enrollment Packet completion / e-sign return | Partial | Public completion is real and durable through `submitPublicEnrollmentPacket` in `lib/services/enrollment-packets-public-runtime.ts`, with completion follow-up truth exposed by `buildPublicEnrollmentPacketSubmitResult` in `lib/services/enrollment-packet-public-helpers.ts`. | Completion can succeed while mapping, file verification, or follow-up is still pending or action-required. |
| Enrollment Packet completion / e-sign return -> Lead activity logging | Partial | Completion tries to write a lead activity through `runEnrollmentPacketCompletionCascade` in `lib/services/enrollment-packet-completion-cascade.ts` and `syncEnrollmentPacketLeadActivityOrQueue` in `lib/services/enrollment-packet-mapping-runtime.ts`. | Lead activity is post-commit follow-up, not part of the completion transaction. If it fails, the packet remains completed and the activity is queued. |
| Lead activity logging -> Member creation / enrollment resolution | Weak | Formal conversion exists through `enrollMemberFromLeadAction` in `app/sales-lead-actions.ts` and the lead-conversion RPC-backed service path. | Packet workflows log `Enrollment Packet Completed`, but conversion logic watches for `Enrollment completed` or `Member start confirmed` in `lib/services/sales-lead-activities.ts`. Packet completion therefore does not naturally trigger formal conversion. |
| Member creation / enrollment resolution -> Intake Assessment | Partial | Intake creation and signature are canonical and Supabase-backed in `app/intake-actions.ts`, `lib/services/intake-assessment-esign.ts`, and the intake creation RPC. | Intake can be durably committed while e-sign, draft POF follow-up, or PDF member-file verification still needs staff follow-up. |
| Intake Assessment -> Physician Orders / POF generation | Partial | This path is not broken. Signed intake can create a draft POF through `autoCreateDraftPhysicianOrderFromIntake` in `lib/services/intake-pof-mhp-cascade.ts` and `rpc_create_draft_physician_order_from_intake` in `lib/services/physician-orders-supabase.ts`. | Immediate readback can fail even after the draft committed, which returns a real follow-up-needed state instead of true readiness. |
| Physician Orders / POF generation -> Provider signature completion | Strong | Request creation, replay safety, signed artifact persistence, and request telemetry remain canonical in `lib/services/pof-esign-public.ts` and related POF services. | The remaining risk is not signature persistence. It is the downstream clinical readiness after the signature commits. |
| Provider signature completion -> Member Health Profile (MHP) generation / sync | Partial | Signed POF artifacts are durable and post-sign sync is explicit via `processSignedPhysicianOrderPostSignSync` and `runBestEffortCommittedPofSignatureFollowUp`. | Signed does not always mean clinically synced. The service can queue follow-up work and return `queued` truth. |
| Member Health Profile (MHP) generation / sync -> Member Command Center (MCC) visibility | Partial | MCC index visibility is stronger now because the list page uses the privileged canonical read path in `app/(portal)/operations/member-command-center/page.tsx`. | MHP and MCC detail still fail hard when required shell rows are missing instead of self-repairing. |
| Member Command Center (MCC) visibility -> Care Plan creation and signature workflow | Partial | Care Plan create, review, nurse sign, caregiver dispatch, and caregiver sign remain canonical and persisted in the shared care-plan services. | Action layers still surface committed-but-follow-up-required truth, so callers must respect readiness fields and not rely on `ok: true` alone. |
| Care Plan creation and signature workflow -> MAR generation from POF medications | Weak | MAR generation itself is canonical once the signed POF sync has populated medication data. | Care Plan completion is not the real readiness gate. Signed POF clinical sync is. Staff can infer readiness from the wrong workflow. |
| MAR generation from POF medications -> MAR documentation workflow | Strong | Scheduled and PRN MAR documentation use canonical services and RPC-backed writes in `lib/services/mar-workflow.ts` and `lib/services/mar-prn-workflow.ts`. | Main remaining risk is upstream readiness confusion, not MAR write-path integrity. |
| MAR documentation workflow -> Monthly MAR summary or PDF generation | Strong | Monthly MAR reporting assembles canonical MAR, member, and medication data through `assembleMarMonthlyReportData` in `lib/services/mar-monthly-report.ts`. | Main risk is upstream data quality, not fake report generation. |
| Monthly MAR summary or PDF generation -> Member Files persistence | Partial | MAR monthly PDF persistence now uses the shared member-files service and returns explicit verification truth in `app/(portal)/health/mar/actions-impl.ts`. | Report generation can succeed while `member_files` verification is still follow-up-needed. |
| Member Files persistence -> Completion notifications or alerts | Weak | Notification failure truth is stronger because `recordWorkflowMilestone` now flags missing `user_notifications` rows and dispatch failures. | Positive success messaging is still inconsistent, and generated-document success does not emit one consistent milestone across all workflows. |

## 3. Critical Failures

1. **Enrollment Packet completion still does not complete formal enrollment.**  
   Why it matters: a caregiver can finish the packet and staff can see a filed packet, but the lead may still not be formally converted into the canonical enrolled member state.  
   Evidence: `runEnrollmentPacketCompletionCascade` logs `Enrollment Packet Completed` in `lib/services/enrollment-packet-completion-cascade.ts`, while conversion logic in `lib/services/sales-lead-activities.ts` keys off `Enrollment completed` or `Member start confirmed`. Formal conversion is still handled separately in `app/sales-lead-actions.ts`.

2. **Signed POF notifications can overstate readiness.**  
   Why it matters: a nurse can see “signed” and assume downstream clinical records are ready, even when MHP, MCC, and MAR sync is still queued.  
   Evidence: `lib/services/notification-content.ts` says `POF signed... Clinical documents are ready for review`, while `lib/services/physician-order-clinical-sync.ts` explicitly says queued sync is not operationally ready and `lib/services/physician-order-post-sign-service.ts` can queue retry work.

3. **Care Plan completion is still not the canonical MAR readiness gate.**  
   Why it matters: staff can assume MAR is ready because the care plan is done, but MAR readiness actually depends on signed POF medication sync.  
   Evidence: the care-plan post-sign services manage care-plan readiness, but MAR generation is driven by the signed POF post-sign cascade in `lib/services/physician-orders-supabase.ts`, `lib/services/pof-post-sign-runtime.ts`, and `lib/services/mar-workflow.ts`.

4. **MHP and MCC still hard-fail on missing shell rows.**  
   Why it matters: one missing canonical shell row can block downstream visibility for staff instead of gracefully indicating exactly what repair is needed.  
   Evidence: `lib/services/member-health-profiles-supabase.ts` throws when `member_health_profiles` is missing, `lib/services/member-command-center-runtime.ts` throws when `member_command_centers` or `member_attendance_schedules` is missing, and `lib/services/enrollment-packet-intake-mapping.ts` refuses to continue mapping if those same shell rows are absent.

## 4. Canonicality Risks Found During Simulation

- **No new fake persistence path found.** I did not find a new runtime mock backend, local-only persistence layer, or fake write path in the lifecycle reviewed here.
- **Early member identity anchoring still blurs the lead/member boundary.** `sendEnrollmentPacketRequest` calls `ensureCanonicalMemberForLead`, which creates a `members` row before formal conversion when needed.
- **Packet activity outcomes still do not align with conversion outcomes.** Packet flows write `Enrollment Packet Sent` and `Enrollment Packet Completed`, while conversion logic watches different outcome labels.
- **Committed-success patterns still require caller discipline.** Intake, care plan, and lead-activity actions can return committed truth with follow-up-needed readiness, so UI and operators must not treat `ok: true` by itself as “fully ready.”
- **MAR readiness is still cross-module truth, not a single-screen truth.** Care Plan completion and signed POF are different milestones, and only the signed POF post-sign sync is the canonical clinical readiness gate for MAR.

## 5. Schema / Runtime Risks Exposed by Workflow

- **Canonical shell dependency remains strict.** `member_command_centers`, `member_attendance_schedules`, and `member_health_profiles` must already exist for several downstream reads and mappings.
- **Lead conversion still depends on the shell-provisioning migration path.** The conversion hardening introduced by `supabase/migrations/0158_lead_conversion_shell_success_guard.sql` remains part of the lifecycle contract.
- **Enrollment Packet downstream mapping now assumes an already-linked canonical member.** The hardening in `supabase/migrations/0194_member_command_center_shell_write_path_hardening.sql` protects the write path, but it also means packet completion is not secretly doing real lead conversion.
- **Draft POF creation still depends on migration-backed RPCs.** The audited path relies on the intake creation and draft POF RPC migrations instead of ad hoc writes.
- **Live workflow verification was not run in this pass.** That means this report is high-signal static validation, not proof from a fresh live submission run.

## 6. Document / Notification / File Persistence Findings

- **Enrollment Packet is still the strongest upload milestone flow, but not the strongest shared file-verification flow.** The completion cascade repairs upload links, ensures the completed packet artifact exists in member files, and emits a `document_uploaded` milestone for uploaded packet documents. Unlike the shared generated-PDF path, it mainly relies on artifact/link repair and follow-up consensus rather than the `verifiedPersisted` readback used by `saveGeneratedMemberPdfToFiles`.
- **Intake PDF persistence is readiness-aware, not all-or-nothing.** `completeIntakeAssessmentPostSignWorkflow` saves the generated PDF to member files, but it queues follow-up if verification is still pending or fails.
- **Signed POF artifact persistence is durable, but success messaging is weaker than file truth.** POF signing records the durable artifact and post-sign state, but it does not have the same dedicated `document_uploaded` milestone coverage that Enrollment Packet has.
- **Care Plan caregiver signature enforces final file persistence.** `submitPublicCarePlanSignature` requires a real `final_member_file_id`, which is strong, but the emitted milestone is about signature completion, not a standard document-upload success event.
- **MAR monthly PDF persistence is now more honest.** `generateMonthlyMarReportPdfAction` returns `follow-up-needed` when the report was generated but `member_files` verification did not complete.
- **The shared generated-PDF pipeline is where `member_files` verification is strongest.** Intake PDF regeneration, manual POF/Care Plan PDF saves, and MAR report saves all rely on `saveGeneratedMemberPdfToFiles`, which read-backs the canonical row and returns `verifiedPersisted` truth instead of synthetic success.
- **Notification delivery truth is stronger than message copy.** `recordWorkflowMilestone` now records follow-up-needed truth when no `user_notifications` rows are created or dispatch fails, but some success copy still overstates readiness.

## 7. Fix First

1. **Decide whether Enrollment Packet completion should formally convert the lead.** If yes, wire that handoff canonically. If no, make the manual boundary impossible to miss in workflow status and UI copy.
2. **Change signed POF success messaging.** Queued post-sign sync must never read like “clinical documents are ready.”
3. **Make MAR readiness language explicit everywhere.** Signed POF clinical sync is the gate, not Care Plan completion.
4. **Standardize generated-document success milestones.** High-value artifacts such as signed POFs, signed Care Plans, Intake PDFs, and MAR PDFs should emit one consistent success milestone only after verified `member_files` persistence.
5. **Keep the strict shell-row contract, but surface repair truth clearly.** Missing MCC, attendance, or MHP shells should remain explicit failures, but staff and admins need a clearer repair path when those rows are absent.

## 8. Regression Checklist

1. Send an Enrollment Packet and verify packet request/event rows plus any early canonical member anchor created for the lead.
2. Complete the packet from the public link and verify signatures, uploads, completed packet artifact, mapping status, and `completion_follow_up_status`.
3. Confirm whether packet completion is supposed to trigger formal lead conversion. If yes, verify it happens. If no, verify the workflow clearly tells staff that conversion is still a separate step.
4. Convert the lead and verify one canonical member linked by `members.source_lead_id` with MCC, attendance, and MHP shells provisioned.
5. Submit Intake Assessment and verify the assessment rows, signed state, draft POF result, and intake PDF persistence status.
6. Complete provider POF signature and verify both the durable signed artifact and the downstream post-sign sync status.
7. Confirm MHP, MCC, and MAR surfaces show queued or degraded truth when signed-POF follow-up is still pending.
8. Create, review, sign, and caregiver-sign a Care Plan and verify final artifact persistence plus readiness truth after commit.
9. Generate a monthly MAR PDF and verify `member_files` persistence is either confirmed or explicitly follow-up-needed.
10. Verify notifications never claim operational readiness when downstream sync, conversion, or file verification is still pending.
