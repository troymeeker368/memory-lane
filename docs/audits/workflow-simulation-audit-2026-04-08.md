# Workflow Simulation Audit Report
_Generated: 2026-04-08T04:15:44_
_Repository: D:/Memory Lane App_

## 1. Executive Summary
- overall workflow health: **Fragile**
- top 5 lifecycle blockers:
  - Intake Assessment -> Physician Orders / POF generation (Broken): Missing expected function wiring in one or more stages. Expected canonical writes not evidenced: physician_orders.
  - Provider signature completion -> MHP generation / sync (Strong): Missing expected function wiring in one or more stages. Expected canonical writes not evidenced: physician_orders.
  - Enrollment Packet completion / e-sign return -> Lead activity logging (Strong): Missing expected function wiring in one or more stages.
  - Care Plan creation / signature workflow -> MAR generation from POF meds (Strong): Missing expected function wiring in one or more stages.
  - Send Enrollment Packet -> Enrollment Packet completion / e-sign return (Strong): Expected document/file persistence checks are missing.
- top 5 strongest handoffs:
  - Lead -> Send Enrollment Packet (Strong, score 1.0)
  - Lead activity logging -> Member creation / enrollment resolution (Strong, score 1.0)
  - MCC downstream visibility -> Care Plan creation / signature workflow (Strong, score 1.0)
  - MAR generation from POF meds -> MAR documentation workflow (Strong, score 1.0)
  - MAR documentation workflow -> Monthly report / PDF generation (Strong, score 1.0)

## 2. Lifecycle Handoff Table
| upstream stage | downstream stage | expected canonical write | expected resolver/read path | current status | exact files/functions involved | risk summary | required fix |
|---|---|---|---|---|---|---|---|
| Lead | Send Enrollment Packet | enrollment_packet_requests, enrollment_packet_events, lead_activities | lib/services/enrollment-packets-listing.ts | Strong | app/(portal)/sales/new-entries/send-enrollment-packet/page.tsx<br>app/sales-enrollment-actions.ts :: sendEnrollmentPacketAction<br>components/sales/send-enrollment-packet-action.tsx :: sendEnrollmentPacketAction<br>lib/services/enrollment-packet-mapping-runtime.ts :: syncEnrollmentPacketLeadActivityOrQueue<br>lib/services/enrollment-packet-public-helpers.ts :: insertPacketEvent<br>lib/services/enrollment-packets-listing.ts :: listEnrollmentPacketRequestsForLead, listEnrollmentPacketRequestsForMember<br>lib/services/enrollment-packets-send-runtime.ts :: sendEnrollmentPacketRequest | No major handoff risks detected from static simulation. | Keep current wiring and add regression coverage to prevent drift. |
| Send Enrollment Packet | Enrollment Packet completion / e-sign return | enrollment_packet_fields, enrollment_packet_signatures, enrollment_packet_uploads, enrollment_packet_requests, member_files, enrollment_packet_mapping_runs | lib/services/enrollment-packet-public-helpers.ts | Strong | app/sign/enrollment-packet/[token]/actions.ts :: savePublicEnrollmentPacketProgressAction, submitPublicEnrollmentPacketAction<br>app/sign/enrollment-packet/[token]/page.tsx<br>components/enrollment-packets/enrollment-packet-public-form.tsx<br>lib/services/enrollment-packet-completion-cascade.ts :: runEnrollmentPacketCompletionCascade<br>lib/services/enrollment-packet-public-helpers.ts :: buildPublicEnrollmentPacketSubmitResult<br>lib/services/enrollment-packets-public-runtime.ts :: savePublicEnrollmentPacketProgress, submitPublicEnrollmentPacket, getPublicEnrollmentPacketContext<br>supabase/migrations/0061_enrollment_packet_conversion_rpc.sql<br>supabase/migrations/0152_enrollment_packet_lifecycle_and_voiding.sql | Expected document/file persistence checks are missing. | Keep current wiring and add regression coverage to prevent drift. |
| Enrollment Packet completion / e-sign return | Lead activity logging | lead_activities | lib/services/sales-crm-supabase.ts | Strong | app/(portal)/sales/activities/page.tsx<br>app/sales-lead-actions.ts :: createSalesLeadActivityAction<br>lib/services/enrollment-packet-completion-cascade.ts :: runEnrollmentPacketCompletionCascade<br>lib/services/enrollment-packet-mapping-runtime.ts :: syncEnrollmentPacketLeadActivityOrQueue | Missing expected function wiring in one or more stages. | Keep current wiring and add regression coverage to prevent drift. |
| Lead activity logging | Member creation / enrollment resolution | members, leads | lib/services/member-command-center-supabase.ts | Strong | app/(portal)/sales/leads/[leadId]/page.tsx<br>app/sales-lead-actions.ts :: enrollMemberFromLeadAction<br>lib/services/canonical-person-ref.ts :: resolveCanonicalPersonRef, resolveCanonicalMemberRef, resolveCanonicalLeadRef<br>lib/services/member-command-center-supabase.ts :: getMemberCommandCenterIndexSupabase | No major handoff risks detected from static simulation. | Keep current wiring and add regression coverage to prevent drift. |
| Member creation / enrollment resolution | Intake Assessment | intake_assessments, assessment_responses, intake_assessment_signatures, member_files | lib/services/relations.ts | Strong | app/(portal)/health/assessment/page.tsx<br>app/intake-actions.ts :: createAssessmentAction<br>components/forms/assessment-form-boundary.tsx<br>lib/services/intake-assessment-esign.ts :: signIntakeAssessment<br>lib/services/intake-pof-mhp-cascade.ts :: createIntakeAssessmentWithResponses<br>lib/services/member-files.ts :: saveGeneratedMemberPdfToFiles<br>lib/services/relations.ts :: getAssessmentDetail<br>supabase/migrations/0051_intake_assessment_atomic_creation_rpc.sql | Expected document/file persistence checks are missing. | Keep current wiring and add regression coverage to prevent drift. |
| Intake Assessment | Physician Orders / POF generation | physician_orders | lib/services/physician-orders-supabase.ts | Broken | app/(portal)/health/physician-orders/actions.ts :: savePhysicianOrderFormAction, saveAndDispatchPofSignatureRequestFromEditorAction<br>app/(portal)/health/physician-orders/new/page.tsx<br>lib/services/intake-pof-mhp-cascade.ts :: autoCreateDraftPhysicianOrderFromIntake<br>lib/services/physician-orders-supabase.ts :: createDraftPhysicianOrderFromAssessment, savePhysicianOrderForm<br>lib/services/physician-orders-supabase.ts :: getPhysicianOrderById | Missing expected function wiring in one or more stages. Expected canonical writes not evidenced: physician_orders. | Route this handoff through canonical services and persist to: physician_orders. |
| Physician Orders / POF generation | Provider signature completion | pof_requests, pof_signatures, document_events, member_files, physician_orders | lib/services/pof-esign.ts | Strong | app/(portal)/operations/member-command-center/pof-actions.ts :: sendPofSignatureRequestAction, resendPofSignatureRequestAction<br>app/sign/pof/[token]/actions.ts :: submitPublicPofSignatureAction<br>app/sign/pof/[token]/page.tsx<br>components/physician-orders/pof-esign-workflow-card.tsx<br>lib/services/pof-esign.ts :: getPofRequestTimeline, listPofTimelineForPhysicianOrder<br>lib/services/pof-esign.ts :: sendNewPofSignatureRequest<br>supabase/migrations/0053_artifact_drift_replay_hardening.sql | Missing expected function wiring in one or more stages. | Keep current wiring and add regression coverage to prevent drift. |
| Provider signature completion | MHP generation / sync | physician_orders, member_health_profiles | lib/services/member-health-profiles-supabase.ts | Strong | app/(portal)/health/member-health-profiles/[memberId]/page.tsx<br>app/sign/pof/[token]/actions.ts :: submitPublicPofSignatureAction<br>lib/services/member-health-profiles-supabase.ts :: getMemberHealthProfileDetailSupabase<br>lib/services/physician-orders-supabase.ts :: signPhysicianOrder, syncMemberHealthProfileFromSignedPhysicianOrder | Missing expected function wiring in one or more stages. Expected canonical writes not evidenced: physician_orders. | Route this handoff through canonical services and persist to: physician_orders. |
| MHP generation / sync | MCC downstream visibility | member_health_profiles, member_command_centers, member_attendance_schedules, member_contacts | lib/services/member-command-center-supabase.ts | Strong | app/(portal)/operations/member-command-center/[memberId]/page.tsx<br>app/(portal)/operations/member-command-center/summary-actions.ts :: saveMemberCommandCenterSummaryAction, saveMemberCommandCenterAttendanceAction<br>lib/services/enrollment-packet-intake-mapping.ts :: mapEnrollmentPacketToDownstream<br>lib/services/member-command-center-supabase.ts :: getMemberCommandCenterDetailSupabase | Missing expected function wiring in one or more stages. | Keep current wiring and add regression coverage to prevent drift. |
| MCC downstream visibility | Care Plan creation / signature workflow | care_plans, care_plan_sections, care_plan_versions, care_plan_review_history, care_plan_signature_events, member_files | lib/services/care-plans-read.ts | Strong | app/(portal)/health/care-plans/new/page.tsx<br>app/care-plan-actions.ts :: createCarePlanAction, reviewCarePlanAction, signCarePlanAction, sendCarePlanToCaregiverAction<br>app/sign/care-plan/[token]/actions.ts :: submitPublicCarePlanSignatureAction<br>app/sign/care-plan/[token]/page.tsx<br>lib/services/care-plan-esign-public.ts :: submitPublicCarePlanSignature<br>lib/services/care-plan-esign.ts :: sendCarePlanToCaregiverForSignature<br>lib/services/care-plans-read.ts :: getLatestCarePlanForMember, getMemberCarePlanSummary<br>lib/services/care-plans-supabase.ts :: createCarePlan, reviewCarePlan, signCarePlanAsNurseAdmin | No major handoff risks detected from static simulation. | Keep current wiring and add regression coverage to prevent drift. |
| Care Plan creation / signature workflow | MAR generation from POF meds | pof_medications, mar_schedules | lib/services/mar-workflow.ts | Strong | app/(portal)/health/mar/page.tsx<br>app/sign/pof/[token]/actions.ts :: submitPublicPofSignatureAction<br>lib/services/mar-workflow.ts :: syncPofMedicationsFromSignedOrder, generateMarSchedulesForMember<br>lib/services/physician-orders-supabase.ts :: processSignedPhysicianOrderPostSignSync, signPhysicianOrder<br>lib/services/pof-post-sign-runtime.ts :: runBestEffortCommittedPofSignatureFollowUp | Missing expected function wiring in one or more stages. | Keep current wiring and add regression coverage to prevent drift. |
| MAR generation from POF meds | MAR documentation workflow | mar_administrations, med_administration_logs | lib/services/mar-workflow-read.ts | Strong | app/(portal)/health/mar/actions-impl.ts :: recordScheduledMarAdministrationAction, recordPrnMarAdministrationAction, recordPrnOutcomeAction<br>app/(portal)/health/mar/page.tsx<br>components/forms/mar-workflow-board.tsx<br>lib/services/mar-prn-workflow.ts :: documentPrnMedicationAdministration, documentPrnFollowupAssessment<br>lib/services/mar-workflow-read.ts :: getMarWorkflowSnapshot<br>lib/services/mar-workflow.ts :: documentScheduledMarAdministration, documentPrnMarAdministration, documentPrnOutcomeAssessment<br>supabase/migrations/0121_document_scheduled_mar_administration_rpc.sql | No major handoff risks detected from static simulation. | Keep current wiring and add regression coverage to prevent drift. |
| MAR documentation workflow | Monthly report / PDF generation | (read-heavy handoff) | lib/services/mar-monthly-report.ts | Strong | app/(portal)/health/mar/report-actions.ts :: generateMonthlyMarReportPdfAction<br>components/forms/mar-monthly-report-panel.tsx<br>lib/services/mar-monthly-report-pdf.ts :: buildMarMonthlyReportPdfDataUrl<br>lib/services/mar-monthly-report.ts :: assembleMarMonthlyReportData | No major handoff risks detected from static simulation. | Keep current wiring and add regression coverage to prevent drift. |
| Monthly report / PDF generation | Member Files persistence | member_files | lib/services/member-command-center-supabase.ts | Strong | app/(portal)/health/mar/report-actions.ts :: generateMonthlyMarReportPdfAction<br>app/(portal)/operations/member-command-center/file-actions.ts :: addMemberFileAction<br>components/forms/member-command-center-file-manager.tsx<br>lib/services/member-command-center-supabase.ts :: listMemberFilesSupabase<br>lib/services/member-files.ts :: saveGeneratedMemberPdfToFiles, saveCommandCenterMemberFileUpload | No major handoff risks detected from static simulation. | Keep current wiring and add regression coverage to prevent drift. |
| Lifecycle milestones | Notifications / alerts generated | user_notifications | lib/services/notifications.ts | Strong | app/(portal)/notifications/actions.ts :: markNotificationReadAction, markAllNotificationsReadAction<br>app/(portal)/notifications/page.tsx<br>lib/services/lifecycle-milestones.ts :: recordWorkflowMilestone<br>lib/services/mar-workflow.ts :: documentScheduledMarAdministration<br>lib/services/notifications.ts :: createUserNotification, listUserNotificationsForUser<br>lib/services/notifications.ts :: listUserNotificationsForUser | Missing expected function wiring in one or more stages. Expected notifications are missing in lifecycle code paths. | Create user notifications at successful lifecycle milestones only after durable persistence. |

## 3. Critical Failures
- severity: **High**
  - title: Intake Assessment -> Physician Orders / POF generation
  - why it matters: Intake should produce draft POF tied to source assessment and canonical member.
  - files/functions/modules: app/(portal)/health/physician-orders/actions.ts :: savePhysicianOrderFormAction, saveAndDispatchPofSignatureRequestFromEditorAction; app/(portal)/health/physician-orders/new/page.tsx; lib/services/intake-pof-mhp-cascade.ts :: autoCreateDraftPhysicianOrderFromIntake; lib/services/physician-orders-supabase.ts :: createDraftPhysicianOrderFromAssessment, savePhysicianOrderForm; lib/services/physician-orders-supabase.ts :: getPhysicianOrderById
  - probable root cause: Missing expected function wiring in one or more stages. Expected canonical writes not evidenced: physician_orders.
  - recommended fix: Route this handoff through canonical services and persist to: physician_orders.

## 4. Canonicality Risks Found During Simulation
- fake persistence:
  - none detected in scanned runtime files
- fallback records:
  - none detected
- missing writes:
  - Intake Assessment -> Physician Orders / POF generation: physician_orders
  - Provider signature completion -> MHP generation / sync: physician_orders
- stale derived state:
  - none detected
- non-canonical downstream reads:
  - none detected

## 5. Schema / Runtime Risks Exposed by Workflow
- missing tables: none
- missing columns: none
- nullable mismatches: potential manual review needed where fallback defaults are used (see MAR and e-sign fallback warnings).
- migration drift affecting lifecycle: none

## 6. Document / Notification / File Persistence Findings
- Send Enrollment Packet -> Enrollment Packet completion / e-sign return
  - what should generate: notifications/files documented in lifecycle config for this handoff
  - what actually generates: see positive function evidence in section 2
  - what fails to save or notify: Persist completed packet artifact
- Member creation / enrollment resolution -> Intake Assessment
  - what should generate: notifications/files documented in lifecycle config for this handoff
  - what actually generates: see positive function evidence in section 2
  - what fails to save or notify: Save intake PDF to member files
- Lifecycle milestones -> Notifications / alerts generated
  - what should generate: notifications/files documented in lifecycle config for this handoff
  - what actually generates: see positive function evidence in section 2
  - what fails to save or notify: Enrollment milestones should notify

## 7. Fix First
1. Intake Assessment -> Physician Orders / POF generation: Route this handoff through canonical services and persist to: physician_orders.
2. Provider signature completion -> MHP generation / sync: Route this handoff through canonical services and persist to: physician_orders.
3. Enrollment Packet completion / e-sign return -> Lead activity logging: Keep current wiring and add regression coverage to prevent drift.
4. Care Plan creation / signature workflow -> MAR generation from POF meds: Keep current wiring and add regression coverage to prevent drift.
5. Send Enrollment Packet -> Enrollment Packet completion / e-sign return: Keep current wiring and add regression coverage to prevent drift.

## 8. Regression Checklist
1. Send enrollment packet from a lead and verify request status/event rows in Supabase.
2. Complete packet from public link and verify signatures/uploads, lead activity rows, and completed packet artifacts in member_files.
3. Confirm lead converted to a single canonical member linked with members.source_lead_id.
4. Submit intake assessment and verify intake_assessments, assessment_responses, signatures, and intake PDF member file.
5. Dispatch and complete POF provider signature and verify pof_requests/pof_signatures/document_events/member_files rows.
6. Verify signed POF updates MHP fields and refreshes MCC visibility for the same member.
7. Create/review/sign care plan and complete caregiver public sign flow; verify signature events and saved signed artifact.
8. Verify MAR board sources meds from signed POF and supports given/not-given plus PRN effective/ineffective paths.
9. Generate monthly MAR PDF and verify persistence in member_files with member command center visibility.
10. Verify notifications inbox includes milestone alerts across enrollment, POF, care plan, and MAR workflows.

### Additional Silent-Success Risk Signals
- app/care-plan-actions.ts:256 catch block returns ok:true
- app/care-plan-actions.ts:341 catch block returns ok:true
- app/documentation-actions-impl.ts:131 catch block returns ok:true
- app/documentation-actions-impl.ts:199 catch block returns ok:true
- app/documentation-actions-impl.ts:240 catch block returns ok:true
- app/documentation-actions-impl.ts:262 catch block returns ok:true
- app/documentation-actions-impl.ts:294 catch block returns ok:true
- app/documentation-create-core.ts:160 catch block returns ok:true
- app/documentation-create-core.ts:286 catch block returns ok:true
- app/documentation-create-core.ts:355 catch block returns ok:true
- app/documentation-create-core.ts:432 catch block returns ok:true
- app/documentation-create-core.ts:516 catch block returns ok:true
- app/intake-actions.ts:292 catch block returns ok:true
- app/sales-lead-actions.ts:389 catch block returns ok:true
- app/sales-lead-actions.ts:535 catch block returns ok:true
- app/sales-lead-actions.ts:592 catch block returns ok:true
- app/sales-partner-actions.ts:47 catch block returns ok:true
- app/sales-partner-actions.ts:90 catch block returns ok:true
- app/sales-partner-actions.ts:135 catch block returns ok:true
- app/time-actions.ts:41 catch block returns ok:true
