# Workflow Simulation Audit Report
_Generated: 2026-03-14T11:07:26_
_Repository: D:/Memory Lane App_

## 1. Executive Summary
- overall workflow health: **Partial**
- top 5 lifecycle blockers:
  - Care Plan creation / signature workflow -> MAR generation from POF meds (Partial): Cross-module handoff appears to require hidden/manual intervention.
  - Lifecycle milestones -> Notifications / alerts generated (Partial): Expected notifications are missing in lifecycle code paths. Manual fallback language present: not configured. Set NEXT_PUBLIC_APP_URL, not configured. Set RESEND_API_KEY, saved as Prepared, Copy and send this secure link manually, saved as Draft.
  - Lead -> Send Enrollment Packet (Partial): Manual fallback language present: saved as Prepared, not configured. Set NEXT_PUBLIC_APP_URL, not configured. Set RESEND_API_KEY.
  - Send Enrollment Packet -> Enrollment Packet completion / e-sign return (Partial): Manual fallback language present: saved as Prepared, not configured. Set NEXT_PUBLIC_APP_URL, not configured. Set RESEND_API_KEY.
  - Enrollment Packet completion / e-sign return -> Lead activity logging (Partial): Manual fallback language present: saved as Prepared, not configured. Set NEXT_PUBLIC_APP_URL, not configured. Set RESEND_API_KEY.
- top 5 strongest handoffs:
  - Lead -> Send Enrollment Packet (Partial, score 1.0)
  - Send Enrollment Packet -> Enrollment Packet completion / e-sign return (Partial, score 1.0)
  - Enrollment Packet completion / e-sign return -> Lead activity logging (Partial, score 1.0)
  - Lead activity logging -> Member creation / enrollment resolution (Strong, score 1.0)
  - Member creation / enrollment resolution -> Intake Assessment (Strong, score 1.0)

## 2. Lifecycle Handoff Table
| upstream stage | downstream stage | expected canonical write | expected resolver/read path | current status | exact files/functions involved | risk summary | required fix |
|---|---|---|---|---|---|---|---|
| Lead | Send Enrollment Packet | enrollment_packet_requests, enrollment_packet_events, lead_activities | lib/services/enrollment-packets.ts | Partial | app/(portal)/sales/new-entries/send-enrollment-packet/page.tsx<br>app/sales-actions.ts :: sendEnrollmentPacketAction<br>components/sales/send-enrollment-packet-action.tsx :: sendEnrollmentPacketAction<br>lib/services/enrollment-packets.ts :: listEnrollmentPacketRequestsForLead, listEnrollmentPacketRequestsForMember<br>lib/services/enrollment-packets.ts :: sendEnrollmentPacketRequest | Manual fallback language present: saved as Prepared, not configured. Set NEXT_PUBLIC_APP_URL, not configured. Set RESEND_API_KEY. | Replace manual fallback with explicit failed state plus retry path; avoid synthetic success. |
| Send Enrollment Packet | Enrollment Packet completion / e-sign return | enrollment_packet_fields, enrollment_packet_signatures, enrollment_packet_uploads, enrollment_packet_requests, member_files, enrollment_packet_mapping_runs | lib/services/enrollment-packet-intake-mapping.ts | Partial | app/sign/enrollment-packet/[token]/actions.ts :: savePublicEnrollmentPacketProgressAction, submitPublicEnrollmentPacketAction<br>app/sign/enrollment-packet/[token]/page.tsx<br>components/enrollment-packets/enrollment-packet-public-form.tsx<br>lib/services/enrollment-packet-intake-mapping.ts :: mapEnrollmentPacketToDownstream<br>lib/services/enrollment-packets.ts :: savePublicEnrollmentPacketProgress, submitPublicEnrollmentPacket, getPublicEnrollmentPacketContext | Manual fallback language present: saved as Prepared, not configured. Set NEXT_PUBLIC_APP_URL, not configured. Set RESEND_API_KEY. | Replace manual fallback with explicit failed state plus retry path; avoid synthetic success. |
| Enrollment Packet completion / e-sign return | Lead activity logging | lead_activities | lib/services/sales-workflows.ts | Partial | app/(portal)/sales/activities/page.tsx<br>app/sales-actions.ts :: createSalesLeadActivityAction<br>lib/services/enrollment-packets.ts :: submitPublicEnrollmentPacket<br>lib/services/sales-workflows.ts :: getSalesWorkflows | Manual fallback language present: saved as Prepared, not configured. Set NEXT_PUBLIC_APP_URL, not configured. Set RESEND_API_KEY. | Replace manual fallback with explicit failed state plus retry path; avoid synthetic success. |
| Lead activity logging | Member creation / enrollment resolution | members, leads | lib/services/member-command-center-supabase.ts | Strong | app/(portal)/sales/leads/[leadId]/page.tsx<br>app/sales-actions.ts :: enrollMemberFromLeadAction<br>lib/services/canonical-person-ref.ts :: resolveCanonicalPersonRef, resolveCanonicalMemberRef, resolveCanonicalLeadRef<br>lib/services/member-command-center-supabase.ts :: getMemberCommandCenterIndexSupabase | No major handoff risks detected from static simulation. | Keep current wiring and add regression coverage to prevent drift. |
| Member creation / enrollment resolution | Intake Assessment | intake_assessments, assessment_responses, intake_assessment_signatures, member_files | lib/services/relations.ts | Strong | app/(portal)/health/assessment/page.tsx<br>app/actions.ts :: createAssessmentAction<br>components/forms/assessment-form-boundary.tsx<br>lib/services/intake-assessment-esign.ts :: signIntakeAssessment<br>lib/services/intake-pof-mhp-cascade.ts :: createIntakeAssessmentWithResponses<br>lib/services/member-files.ts :: saveGeneratedMemberPdfToFiles<br>lib/services/relations.ts :: getAssessmentDetail | No major handoff risks detected from static simulation. | Keep current wiring and add regression coverage to prevent drift. |
| Intake Assessment | Physician Orders / POF generation | physician_orders | lib/services/physician-orders-supabase.ts | Strong | app/(portal)/health/physician-orders/actions.ts :: savePhysicianOrderFormAction, saveAndDispatchPofSignatureRequestFromEditorAction<br>app/(portal)/health/physician-orders/new/page.tsx<br>lib/services/intake-pof-mhp-cascade.ts :: autoCreateDraftPhysicianOrderFromIntake<br>lib/services/physician-orders-supabase.ts :: createDraftPhysicianOrderFromAssessment, savePhysicianOrderForm<br>lib/services/physician-orders-supabase.ts :: getPhysicianOrdersForMember, getPhysicianOrderById | UI layer contains direct table reads in scoped handoff files. | Keep current wiring and add regression coverage to prevent drift. |
| Physician Orders / POF generation | Provider signature completion | pof_requests, pof_signatures, document_events, member_files, physician_orders | lib/services/pof-esign.ts | Partial | app/(portal)/operations/member-command-center/pof-actions.ts :: sendPofSignatureRequestAction, resendPofSignatureRequestAction<br>app/sign/pof/[token]/actions.ts :: submitPublicPofSignatureAction<br>app/sign/pof/[token]/page.tsx<br>components/physician-orders/pof-esign-workflow-card.tsx<br>lib/services/pof-esign.ts :: getPofRequestTimeline, listPofTimelineForPhysicianOrder<br>lib/services/pof-esign.ts :: sendNewPofSignatureRequest, getPublicPofSigningContext, submitPublicPofSignature | Manual fallback language present: Copy and send this secure link manually, saved as Draft, not configured. Set NEXT_PUBLIC_APP_URL. | Replace manual fallback with explicit failed state plus retry path; avoid synthetic success. |
| Provider signature completion | MHP generation / sync | physician_orders, member_health_profiles | lib/services/member-health-profiles-supabase.ts | Partial | app/(portal)/health/member-health-profiles/[memberId]/page.tsx<br>app/sign/pof/[token]/actions.ts :: submitPublicPofSignatureAction<br>lib/services/member-health-profiles-supabase.ts :: getMemberHealthProfileDetailSupabase<br>lib/services/physician-orders-supabase.ts :: signPhysicianOrder, syncMemberHealthProfileFromSignedPhysicianOrder<br>lib/services/pof-esign.ts :: submitPublicPofSignature | Manual fallback language present: Copy and send this secure link manually, saved as Draft, not configured. Set NEXT_PUBLIC_APP_URL. | Replace manual fallback with explicit failed state plus retry path; avoid synthetic success. |
| MHP generation / sync | MCC downstream visibility | member_health_profiles, member_command_centers, member_attendance_schedules, member_contacts | lib/services/member-command-center-supabase.ts | Strong | app/(portal)/operations/member-command-center/[memberId]/page.tsx<br>app/(portal)/operations/member-command-center/actions.ts :: saveMemberCommandCenterSummaryAction, saveMemberCommandCenterAttendanceAction<br>lib/services/enrollment-packet-intake-mapping.ts :: mapEnrollmentPacketToDownstream<br>lib/services/member-command-center-supabase.ts :: getMemberCommandCenterDetailSupabase<br>lib/services/member-command-center-supabase.ts :: getMemberCommandCenterDetailSupabase, ensureMemberCommandCenterProfileSupabase, ensureMemberAttendanceScheduleSupabase | No major handoff risks detected from static simulation. | Keep current wiring and add regression coverage to prevent drift. |
| MCC downstream visibility | Care Plan creation / signature workflow | care_plans, care_plan_sections, care_plan_versions, care_plan_review_history, care_plan_signature_events, member_files | lib/services/care-plans-supabase.ts | Partial | app/(portal)/health/care-plans/new/page.tsx<br>app/care-plan-actions.ts :: createCarePlanAction, reviewCarePlanAction, signCarePlanAction, sendCarePlanToCaregiverAction<br>app/sign/care-plan/[token]/actions.ts :: submitPublicCarePlanSignatureAction<br>app/sign/care-plan/[token]/page.tsx<br>lib/services/care-plan-esign.ts :: sendCarePlanToCaregiverForSignature, submitPublicCarePlanSignature<br>lib/services/care-plans-supabase.ts :: createCarePlan, reviewCarePlan, signCarePlanAsNurseAdmin, getLatestCarePlanForMember<br>lib/services/care-plans-supabase.ts :: getLatestCarePlanForMember, getMemberCarePlanSummary | Manual fallback language present: not configured. Set NEXT_PUBLIC_APP_URL, not configured. Set RESEND_API_KEY. | Replace manual fallback with explicit failed state plus retry path; avoid synthetic success. |
| Care Plan creation / signature workflow | MAR generation from POF meds | pof_medications, mar_schedules | lib/services/mar-workflow.ts | Partial | app/(portal)/health/mar/actions.ts :: recordScheduledMarAdministrationAction<br>app/(portal)/health/mar/page.tsx<br>lib/services/mar-workflow.ts :: getMarWorkflowSnapshot<br>lib/services/mar-workflow.ts :: syncPofMedicationsFromSignedOrder, generateMarSchedulesForMember, getMarWorkflowSnapshot<br>lib/services/physician-orders-supabase.ts :: signPhysicianOrder | Cross-module handoff appears to require hidden/manual intervention. | Add explicit downstream sync call and persistence guard so next stage is system-driven. |
| MAR generation from POF meds | MAR documentation workflow | mar_administrations | lib/services/mar-workflow.ts | Strong | app/(portal)/health/mar/actions.ts :: recordScheduledMarAdministrationAction, recordPrnMarAdministrationAction, recordPrnOutcomeAction<br>app/(portal)/health/mar/page.tsx<br>components/forms/mar-workflow-board.tsx<br>lib/services/mar-workflow.ts :: documentScheduledMarAdministration, documentPrnMarAdministration, documentPrnOutcomeAssessment, getMarWorkflowSnapshot<br>lib/services/mar-workflow.ts :: getMarWorkflowSnapshot | No major handoff risks detected from static simulation. | Keep current wiring and add regression coverage to prevent drift. |
| MAR documentation workflow | Monthly report / PDF generation | (read-heavy handoff) | lib/services/mar-monthly-report.ts | Strong | app/(portal)/health/mar/actions.ts :: generateMonthlyMarReportPdfAction<br>components/forms/mar-monthly-report-panel.tsx<br>lib/services/mar-monthly-report-pdf.ts :: buildMarMonthlyReportPdfDataUrl<br>lib/services/mar-monthly-report.ts :: assembleMarMonthlyReportData | No major handoff risks detected from static simulation. | Keep current wiring and add regression coverage to prevent drift. |
| Monthly report / PDF generation | Member Files persistence | member_files | lib/services/member-command-center-supabase.ts | Strong | app/(portal)/health/mar/actions.ts :: generateMonthlyMarReportPdfAction<br>app/(portal)/operations/member-command-center/actions.ts :: addMemberFileAction<br>components/forms/member-command-center-file-manager.tsx<br>lib/services/member-command-center-supabase.ts :: listMemberFilesSupabase<br>lib/services/member-command-center-supabase.ts :: listMemberFilesSupabase, addMemberFileSupabase<br>lib/services/member-files.ts :: saveGeneratedMemberPdfToFiles | No major handoff risks detected from static simulation. | Keep current wiring and add regression coverage to prevent drift. |
| Lifecycle milestones | Notifications / alerts generated | user_notifications | lib/services/notifications.ts | Partial | app/(portal)/notifications/actions.ts :: markNotificationReadAction, markAllNotificationsReadAction<br>app/(portal)/notifications/page.tsx<br>lib/services/care-plan-esign.ts :: submitPublicCarePlanSignature<br>lib/services/enrollment-packets.ts :: submitPublicEnrollmentPacket<br>lib/services/mar-workflow.ts :: documentScheduledMarAdministration<br>lib/services/notifications.ts :: createUserNotification, listUserNotificationsForUser<br>lib/services/notifications.ts :: listUserNotificationsForUser<br>lib/services/pof-esign.ts :: submitPublicPofSignature | Expected notifications are missing in lifecycle code paths. Manual fallback language present: not configured. Set NEXT_PUBLIC_APP_URL, not configured. Set RESEND_API_KEY, saved as Prepared, Copy and send this secure link manually, saved as Draft. | Create user notifications at successful lifecycle milestones only after durable persistence. |

## 3. Critical Failures
- No critical failures were detected in this run.

## 4. Canonicality Risks Found During Simulation
- fake persistence:
  - none detected in scanned runtime files
- fallback records:
  - Lead -> Send Enrollment Packet: saved as Prepared, not configured. Set NEXT_PUBLIC_APP_URL, not configured. Set RESEND_API_KEY
  - Send Enrollment Packet -> Enrollment Packet completion / e-sign return: saved as Prepared, not configured. Set NEXT_PUBLIC_APP_URL, not configured. Set RESEND_API_KEY
  - Enrollment Packet completion / e-sign return -> Lead activity logging: saved as Prepared, not configured. Set NEXT_PUBLIC_APP_URL, not configured. Set RESEND_API_KEY
  - Physician Orders / POF generation -> Provider signature completion: Copy and send this secure link manually, saved as Draft, not configured. Set NEXT_PUBLIC_APP_URL
  - Provider signature completion -> MHP generation / sync: Copy and send this secure link manually, saved as Draft, not configured. Set NEXT_PUBLIC_APP_URL
  - MCC downstream visibility -> Care Plan creation / signature workflow: not configured. Set NEXT_PUBLIC_APP_URL, not configured. Set RESEND_API_KEY
  - Lifecycle milestones -> Notifications / alerts generated: not configured. Set NEXT_PUBLIC_APP_URL, not configured. Set RESEND_API_KEY, saved as Prepared, Copy and send this secure link manually, saved as Draft
- missing writes:
  - none detected
- stale derived state:
  - Care Plan creation / signature workflow -> MAR generation from POF meds: Detect hidden manual step between care plan and MAR workflow
- non-canonical downstream reads:
  - Intake Assessment -> Physician Orders / POF generation: app/(portal)/health/physician-orders/new/page.tsx

## 5. Schema / Runtime Risks Exposed by Workflow
- missing tables: none
- missing columns: assessment_responses.question_key, care_plan_review_history.reviewed_at, care_plan_sections.section_key, care_plan_signature_events.occurred_at, document_events.occurred_at, enrollment_packet_events.occurred_at, mar_administrations.prn_effective
- nullable mismatches: potential manual review needed where fallback defaults are used (see MAR and e-sign fallback warnings).
- migration drift affecting lifecycle: none

## 6. Document / Notification / File Persistence Findings
- Lifecycle milestones -> Notifications / alerts generated
  - what should generate: notifications/files documented in lifecycle config for this handoff
  - what actually generates: see positive function evidence in section 2
  - what fails to save or notify: POF milestones should notify, Care plan milestones should notify, MAR milestones should notify

## 7. Fix First
1. Care Plan creation / signature workflow -> MAR generation from POF meds: Add explicit downstream sync call and persistence guard so next stage is system-driven.
2. Lifecycle milestones -> Notifications / alerts generated: Create user notifications at successful lifecycle milestones only after durable persistence.
3. Lead -> Send Enrollment Packet: Replace manual fallback with explicit failed state plus retry path; avoid synthetic success.
4. Send Enrollment Packet -> Enrollment Packet completion / e-sign return: Replace manual fallback with explicit failed state plus retry path; avoid synthetic success.
5. Enrollment Packet completion / e-sign return -> Lead activity logging: Replace manual fallback with explicit failed state plus retry path; avoid synthetic success.

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
- app/care-plan-actions.ts:96 catch block returns ok:true
- app/(portal)/operations/member-command-center/actions.ts:1200 catch block returns ok:true
