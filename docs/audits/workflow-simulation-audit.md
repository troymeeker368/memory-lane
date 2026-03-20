# Workflow Simulation Audit Report
_Generated: 2026-03-20T13:11:37_
_Repository: D:/Memory Lane App_

## 1. Executive Summary
- overall workflow health: **Strong**
- top 5 lifecycle blockers:
  - Lead -> Send Enrollment Packet (Strong): No major handoff risks detected from static simulation.
  - Send Enrollment Packet -> Enrollment Packet completion / e-sign return (Strong): No major handoff risks detected from static simulation.
  - Enrollment Packet completion / e-sign return -> Lead activity logging (Strong): No major handoff risks detected from static simulation.
  - Lead activity logging -> Member creation / enrollment resolution (Strong): No major handoff risks detected from static simulation.
  - Member creation / enrollment resolution -> Intake Assessment (Strong): No major handoff risks detected from static simulation.
- top 5 strongest handoffs:
  - Lead -> Send Enrollment Packet (Strong, score 1.0)
  - Send Enrollment Packet -> Enrollment Packet completion / e-sign return (Strong, score 1.0)
  - Enrollment Packet completion / e-sign return -> Lead activity logging (Strong, score 1.0)
  - Lead activity logging -> Member creation / enrollment resolution (Strong, score 1.0)
  - Member creation / enrollment resolution -> Intake Assessment (Strong, score 1.0)

## 2. Lifecycle Handoff Table
| upstream stage | downstream stage | expected canonical write | expected resolver/read path | current status | exact files/functions involved | risk summary | required fix |
|---|---|---|---|---|---|---|---|
| Lead | Send Enrollment Packet | enrollment_packet_requests, enrollment_packet_events, lead_activities | lib/services/enrollment-packets.ts | Strong | app/(portal)/sales/new-entries/send-enrollment-packet/page.tsx<br>app/sales-enrollment-actions.ts :: sendEnrollmentPacketAction<br>components/sales/send-enrollment-packet-action.tsx :: sendEnrollmentPacketAction<br>lib/services/enrollment-packets.ts :: listEnrollmentPacketRequestsForLead, listEnrollmentPacketRequestsForMember<br>lib/services/enrollment-packets.ts :: sendEnrollmentPacketRequest | No major handoff risks detected from static simulation. | Keep current wiring and add regression coverage to prevent drift. |
| Send Enrollment Packet | Enrollment Packet completion / e-sign return | enrollment_packet_fields, enrollment_packet_signatures, enrollment_packet_uploads, enrollment_packet_requests, member_files, enrollment_packet_mapping_runs | lib/services/enrollment-packet-intake-mapping.ts | Strong | app/sign/enrollment-packet/[token]/actions.ts :: savePublicEnrollmentPacketProgressAction, submitPublicEnrollmentPacketAction<br>app/sign/enrollment-packet/[token]/page.tsx<br>components/enrollment-packets/enrollment-packet-public-form.tsx<br>lib/services/enrollment-packet-intake-mapping.ts :: mapEnrollmentPacketToDownstream<br>lib/services/enrollment-packets.ts :: savePublicEnrollmentPacketProgress, submitPublicEnrollmentPacket, getPublicEnrollmentPacketContext<br>supabase/migrations/0061_enrollment_packet_conversion_rpc.sql | No major handoff risks detected from static simulation. | Keep current wiring and add regression coverage to prevent drift. |
| Enrollment Packet completion / e-sign return | Lead activity logging | lead_activities | lib/services/sales-crm-supabase.ts | Strong | app/(portal)/sales/activities/page.tsx<br>app/sales-lead-actions.ts :: createSalesLeadActivityAction<br>lib/services/enrollment-packets.ts :: submitPublicEnrollmentPacket<br>lib/services/sales-crm-supabase.ts :: getSalesRecentActivitySnapshotSupabase | No major handoff risks detected from static simulation. | Keep current wiring and add regression coverage to prevent drift. |
| Lead activity logging | Member creation / enrollment resolution | members, leads | lib/services/member-command-center-supabase.ts | Strong | app/(portal)/sales/leads/[leadId]/page.tsx<br>app/sales-lead-actions.ts :: enrollMemberFromLeadAction<br>lib/services/canonical-person-ref.ts :: resolveCanonicalPersonRef, resolveCanonicalMemberRef, resolveCanonicalLeadRef<br>lib/services/member-command-center-supabase.ts :: getMemberCommandCenterIndexSupabase | No major handoff risks detected from static simulation. | Keep current wiring and add regression coverage to prevent drift. |
| Member creation / enrollment resolution | Intake Assessment | intake_assessments, assessment_responses, intake_assessment_signatures, member_files | lib/services/relations.ts | Strong | app/(portal)/health/assessment/page.tsx<br>app/intake-actions.ts :: createAssessmentAction<br>components/forms/assessment-form-boundary.tsx<br>lib/services/intake-assessment-esign.ts :: signIntakeAssessment<br>lib/services/intake-pof-mhp-cascade.ts :: createIntakeAssessmentWithResponses<br>lib/services/member-files.ts :: saveGeneratedMemberPdfToFiles<br>lib/services/relations.ts :: getAssessmentDetail<br>supabase/migrations/0051_intake_assessment_atomic_creation_rpc.sql | No major handoff risks detected from static simulation. | Keep current wiring and add regression coverage to prevent drift. |
| Intake Assessment | Physician Orders / POF generation | physician_orders | lib/services/physician-orders-supabase.ts | Strong | app/(portal)/health/physician-orders/actions.ts :: savePhysicianOrderFormAction, saveAndDispatchPofSignatureRequestFromEditorAction<br>app/(portal)/health/physician-orders/new/page.tsx<br>lib/services/intake-pof-mhp-cascade.ts :: autoCreateDraftPhysicianOrderFromIntake<br>lib/services/physician-orders-supabase.ts :: createDraftPhysicianOrderFromAssessment, savePhysicianOrderForm<br>lib/services/physician-orders-supabase.ts :: getPhysicianOrdersForMember, getPhysicianOrderById | No major handoff risks detected from static simulation. | Keep current wiring and add regression coverage to prevent drift. |
| Physician Orders / POF generation | Provider signature completion | pof_requests, pof_signatures, document_events, member_files, physician_orders | lib/services/pof-esign.ts | Strong | app/(portal)/operations/member-command-center/pof-actions.ts :: sendPofSignatureRequestAction, resendPofSignatureRequestAction<br>app/sign/pof/[token]/actions.ts :: submitPublicPofSignatureAction<br>app/sign/pof/[token]/page.tsx<br>components/physician-orders/pof-esign-workflow-card.tsx<br>lib/services/pof-esign.ts :: getPofRequestTimeline, listPofTimelineForPhysicianOrder<br>lib/services/pof-esign.ts :: sendNewPofSignatureRequest, getPublicPofSigningContext, submitPublicPofSignature<br>supabase/migrations/0053_artifact_drift_replay_hardening.sql | No major handoff risks detected from static simulation. | Keep current wiring and add regression coverage to prevent drift. |
| Provider signature completion | MHP generation / sync | physician_orders, member_health_profiles | lib/services/member-health-profiles-supabase.ts | Strong | app/(portal)/health/member-health-profiles/[memberId]/page.tsx<br>app/sign/pof/[token]/actions.ts :: submitPublicPofSignatureAction<br>lib/services/member-health-profiles-supabase.ts :: getMemberHealthProfileDetailSupabase<br>lib/services/physician-orders-supabase.ts :: signPhysicianOrder, syncMemberHealthProfileFromSignedPhysicianOrder<br>lib/services/pof-esign.ts :: submitPublicPofSignature | No major handoff risks detected from static simulation. | Keep current wiring and add regression coverage to prevent drift. |
| MHP generation / sync | MCC downstream visibility | member_health_profiles, member_command_centers, member_attendance_schedules, member_contacts | lib/services/member-command-center-supabase.ts | Strong | app/(portal)/operations/member-command-center/[memberId]/page.tsx<br>app/(portal)/operations/member-command-center/summary-actions.ts :: saveMemberCommandCenterSummaryAction, saveMemberCommandCenterAttendanceAction<br>lib/services/enrollment-packet-intake-mapping.ts :: mapEnrollmentPacketToDownstream<br>lib/services/member-command-center-supabase.ts :: getMemberCommandCenterDetailSupabase<br>lib/services/member-command-center-supabase.ts :: getMemberCommandCenterDetailSupabase, ensureMemberCommandCenterProfileSupabase, ensureMemberAttendanceScheduleSupabase | No major handoff risks detected from static simulation. | Keep current wiring and add regression coverage to prevent drift. |
| MCC downstream visibility | Care Plan creation / signature workflow | care_plans, care_plan_sections, care_plan_versions, care_plan_review_history, care_plan_signature_events, member_files | lib/services/care-plans-supabase.ts | Strong | app/(portal)/health/care-plans/new/page.tsx<br>app/care-plan-actions.ts :: createCarePlanAction, reviewCarePlanAction, signCarePlanAction, sendCarePlanToCaregiverAction<br>app/sign/care-plan/[token]/actions.ts :: submitPublicCarePlanSignatureAction<br>app/sign/care-plan/[token]/page.tsx<br>lib/services/care-plan-esign.ts :: sendCarePlanToCaregiverForSignature, submitPublicCarePlanSignature<br>lib/services/care-plans-supabase.ts :: createCarePlan, reviewCarePlan, signCarePlanAsNurseAdmin, getLatestCarePlanForMember<br>lib/services/care-plans-supabase.ts :: getLatestCarePlanForMember, getMemberCarePlanSummary<br>supabase/migrations/0053_artifact_drift_replay_hardening.sql | No major handoff risks detected from static simulation. | Keep current wiring and add regression coverage to prevent drift. |
| Care Plan creation / signature workflow | MAR generation from POF meds | pof_medications, mar_schedules | lib/services/mar-workflow.ts | Strong | app/(portal)/health/mar/page.tsx<br>app/sign/pof/[token]/actions.ts :: submitPublicPofSignatureAction<br>lib/services/mar-workflow.ts :: getMarWorkflowSnapshot<br>lib/services/mar-workflow.ts :: syncPofMedicationsFromSignedOrder, generateMarSchedulesForMember, getMarWorkflowSnapshot<br>lib/services/physician-orders-supabase.ts :: signPhysicianOrder | No major handoff risks detected from static simulation. | Keep current wiring and add regression coverage to prevent drift. |
| MAR generation from POF meds | MAR documentation workflow | mar_administrations | lib/services/mar-workflow.ts | Strong | app/(portal)/health/mar/administration-actions.ts :: recordScheduledMarAdministrationAction, recordPrnMarAdministrationAction, recordPrnOutcomeAction<br>app/(portal)/health/mar/page.tsx<br>components/forms/mar-workflow-board.tsx<br>lib/services/mar-workflow.ts :: documentScheduledMarAdministration, documentPrnMarAdministration, documentPrnOutcomeAssessment, getMarWorkflowSnapshot<br>lib/services/mar-workflow.ts :: getMarWorkflowSnapshot | No major handoff risks detected from static simulation. | Keep current wiring and add regression coverage to prevent drift. |
| MAR documentation workflow | Monthly report / PDF generation | (read-heavy handoff) | lib/services/mar-monthly-report.ts | Strong | app/(portal)/health/mar/report-actions.ts :: generateMonthlyMarReportPdfAction<br>components/forms/mar-monthly-report-panel.tsx<br>lib/services/mar-monthly-report-pdf.ts :: buildMarMonthlyReportPdfDataUrl<br>lib/services/mar-monthly-report.ts :: assembleMarMonthlyReportData | No major handoff risks detected from static simulation. | Keep current wiring and add regression coverage to prevent drift. |
| Monthly report / PDF generation | Member Files persistence | member_files | lib/services/member-command-center-supabase.ts | Strong | app/(portal)/health/mar/report-actions.ts :: generateMonthlyMarReportPdfAction<br>app/(portal)/operations/member-command-center/file-actions.ts :: addMemberFileAction<br>components/forms/member-command-center-file-manager.tsx<br>lib/services/member-command-center-supabase.ts :: listMemberFilesSupabase<br>lib/services/member-files.ts :: saveGeneratedMemberPdfToFiles, saveCommandCenterMemberFileUpload | No major handoff risks detected from static simulation. | Keep current wiring and add regression coverage to prevent drift. |
| Lifecycle milestones | Notifications / alerts generated | user_notifications | lib/services/notifications.ts | Strong | app/(portal)/notifications/actions.ts :: markNotificationReadAction, markAllNotificationsReadAction<br>app/(portal)/notifications/page.tsx<br>lib/services/care-plan-esign.ts :: submitPublicCarePlanSignature<br>lib/services/enrollment-packets.ts :: submitPublicEnrollmentPacket<br>lib/services/lifecycle-milestones.ts :: recordWorkflowMilestone<br>lib/services/mar-workflow.ts :: documentScheduledMarAdministration<br>lib/services/notifications.ts :: createUserNotification, listUserNotificationsForUser<br>lib/services/notifications.ts :: listUserNotificationsForUser | No major handoff risks detected from static simulation. | Keep current wiring and add regression coverage to prevent drift. |

## 3. Critical Failures
- No critical failures were detected in this run.

## 4. Canonicality Risks Found During Simulation
- fake persistence:
  - none detected in scanned runtime files
- fallback records:
  - none detected
- missing writes:
  - none detected
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
- No missing notification/document persistence signals detected in configured checks.

## 7. Fix First
1. Lead -> Send Enrollment Packet: Keep current wiring and add regression coverage to prevent drift.
2. Send Enrollment Packet -> Enrollment Packet completion / e-sign return: Keep current wiring and add regression coverage to prevent drift.
3. Enrollment Packet completion / e-sign return -> Lead activity logging: Keep current wiring and add regression coverage to prevent drift.
4. Lead activity logging -> Member creation / enrollment resolution: Keep current wiring and add regression coverage to prevent drift.
5. Member creation / enrollment resolution -> Intake Assessment: Keep current wiring and add regression coverage to prevent drift.

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
- app/documentation-actions-impl.ts:141 catch block returns ok:true
- app/documentation-actions-impl.ts:225 catch block returns ok:true
- app/documentation-actions-impl.ts:345 catch block returns ok:true
- app/documentation-actions-impl.ts:426 catch block returns ok:true
- app/documentation-actions-impl.ts:474 catch block returns ok:true
- app/documentation-actions-impl.ts:544 catch block returns ok:true
- app/documentation-actions-impl.ts:611 catch block returns ok:true
- app/documentation-actions-impl.ts:652 catch block returns ok:true
- app/documentation-actions-impl.ts:674 catch block returns ok:true
- app/documentation-actions-impl.ts:706 catch block returns ok:true
- app/sales-lead-actions.ts:375 catch block returns ok:true
- app/sales-lead-actions.ts:521 catch block returns ok:true
- app/sales-lead-actions.ts:578 catch block returns ok:true
- app/sales-partner-actions.ts:48 catch block returns ok:true
- app/sales-partner-actions.ts:91 catch block returns ok:true
- app/sales-partner-actions.ts:136 catch block returns ok:true
- app/time-actions.ts:41 catch block returns ok:true
- app/(portal)/members/[memberId]/name-badge/actions.ts:413 catch block returns ok:true
- app/(portal)/documentation/incidents/actions.ts:168 catch block returns ok:true
