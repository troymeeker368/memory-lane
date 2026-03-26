# Workflow Simulation Audit Report
_Generated: 2026-03-26T04:15:52_
_Repository: D:/Memory Lane App_

## 1. Executive Summary
- overall workflow health: **Broken**
- top 5 lifecycle blockers:
  - Lead -> Send Enrollment Packet (Broken): Missing expected function wiring in one or more stages. Expected canonical writes not evidenced: enrollment_packet_requests, enrollment_packet_events, lead_activities. Identity resolver protections are incomplete. Expected notifications are missing in lifecycle code paths.
  - Enrollment Packet completion / e-sign return -> Lead activity logging (Broken): Missing expected function wiring in one or more stages. Expected canonical writes not evidenced: lead_activities. Identity resolver protections are incomplete.
  - MAR generation from POF meds -> MAR documentation workflow (Broken): Missing expected function wiring in one or more stages. Expected canonical writes not evidenced: mar_administrations.
  - Send Enrollment Packet -> Enrollment Packet completion / e-sign return (Weak): Missing expected function wiring in one or more stages. Expected canonical writes not evidenced: enrollment_packet_fields, enrollment_packet_signatures. Identity resolver protections are incomplete. Expected notifications are missing in lifecycle code paths. Expected document/file persistence checks are missing.
  - MCC downstream visibility -> Care Plan creation / signature workflow (Partial): Missing expected function wiring in one or more stages. Expected canonical writes not evidenced: care_plan_sections, care_plan_versions, care_plan_review_history. Identity resolver protections are incomplete.
- top 5 strongest handoffs:
  - Lead activity logging -> Member creation / enrollment resolution (Strong, score 1.0)
  - Member creation / enrollment resolution -> Intake Assessment (Strong, score 1.0)
  - MHP generation / sync -> MCC downstream visibility (Strong, score 1.0)
  - MAR documentation workflow -> Monthly report / PDF generation (Strong, score 1.0)
  - Provider signature completion -> MHP generation / sync (Strong, score 0.97)
- live simulation checks:
  - Enrollment Packet Live E2E: FAIL
  - POF Signing Live E2E: FAIL

## 2. Lifecycle Handoff Table
| upstream stage | downstream stage | expected canonical write | expected resolver/read path | current status | exact files/functions involved | risk summary | required fix |
|---|---|---|---|---|---|---|---|
| Lead | Send Enrollment Packet | enrollment_packet_requests, enrollment_packet_events, lead_activities | lib/services/enrollment-packets.ts | Broken | app/(portal)/sales/new-entries/send-enrollment-packet/page.tsx<br>app/sales-enrollment-actions.ts :: sendEnrollmentPacketAction<br>components/sales/send-enrollment-packet-action.tsx :: sendEnrollmentPacketAction<br>lib/services/enrollment-packets.ts :: listEnrollmentPacketRequestsForLead, listEnrollmentPacketRequestsForMember | Missing expected function wiring in one or more stages. Expected canonical writes not evidenced: enrollment_packet_requests, enrollment_packet_events, lead_activities. Identity resolver protections are incomplete. Expected notifications are missing in lifecycle code paths. | Route this handoff through canonical services and persist to: enrollment_packet_requests, enrollment_packet_events, lead_activities. |
| Send Enrollment Packet | Enrollment Packet completion / e-sign return | enrollment_packet_fields, enrollment_packet_signatures, enrollment_packet_uploads, enrollment_packet_requests, member_files, enrollment_packet_mapping_runs | lib/services/enrollment-packet-intake-mapping.ts | Weak | app/sign/enrollment-packet/[token]/actions.ts :: savePublicEnrollmentPacketProgressAction, submitPublicEnrollmentPacketAction<br>app/sign/enrollment-packet/[token]/page.tsx<br>components/enrollment-packets/enrollment-packet-public-form.tsx<br>lib/services/enrollment-packet-intake-mapping.ts :: mapEnrollmentPacketToDownstream<br>supabase/migrations/0061_enrollment_packet_conversion_rpc.sql | Missing expected function wiring in one or more stages. Expected canonical writes not evidenced: enrollment_packet_fields, enrollment_packet_signatures. Identity resolver protections are incomplete. Expected notifications are missing in lifecycle code paths. Expected document/file persistence checks are missing. | Route this handoff through canonical services and persist to: enrollment_packet_fields, enrollment_packet_signatures. |
| Enrollment Packet completion / e-sign return | Lead activity logging | lead_activities | lib/services/sales-crm-supabase.ts | Broken | app/(portal)/sales/activities/page.tsx<br>app/sales-lead-actions.ts :: createSalesLeadActivityAction | Missing expected function wiring in one or more stages. Expected canonical writes not evidenced: lead_activities. Identity resolver protections are incomplete. | Route this handoff through canonical services and persist to: lead_activities. |
| Lead activity logging | Member creation / enrollment resolution | members, leads | lib/services/member-command-center-supabase.ts | Strong | app/(portal)/sales/leads/[leadId]/page.tsx<br>app/sales-lead-actions.ts :: enrollMemberFromLeadAction<br>lib/services/canonical-person-ref.ts :: resolveCanonicalPersonRef, resolveCanonicalMemberRef, resolveCanonicalLeadRef<br>lib/services/member-command-center-supabase.ts :: getMemberCommandCenterIndexSupabase | No major handoff risks detected from static simulation. | Keep current wiring and add regression coverage to prevent drift. |
| Member creation / enrollment resolution | Intake Assessment | intake_assessments, assessment_responses, intake_assessment_signatures, member_files | lib/services/relations.ts | Strong | app/(portal)/health/assessment/page.tsx<br>app/intake-actions.ts :: createAssessmentAction<br>components/forms/assessment-form-boundary.tsx<br>lib/services/intake-assessment-esign.ts :: signIntakeAssessment<br>lib/services/intake-pof-mhp-cascade.ts :: createIntakeAssessmentWithResponses<br>lib/services/member-files.ts :: saveGeneratedMemberPdfToFiles<br>lib/services/relations.ts :: getAssessmentDetail<br>supabase/migrations/0051_intake_assessment_atomic_creation_rpc.sql | No major handoff risks detected from static simulation. | Keep current wiring and add regression coverage to prevent drift. |
| Intake Assessment | Physician Orders / POF generation | physician_orders | lib/services/physician-orders-supabase.ts | Strong | app/(portal)/health/physician-orders/actions.ts :: savePhysicianOrderFormAction, saveAndDispatchPofSignatureRequestFromEditorAction<br>app/(portal)/health/physician-orders/new/page.tsx<br>lib/services/intake-pof-mhp-cascade.ts :: autoCreateDraftPhysicianOrderFromIntake<br>lib/services/physician-orders-supabase.ts :: createDraftPhysicianOrderFromAssessment, savePhysicianOrderForm<br>lib/services/physician-orders-supabase.ts :: getPhysicianOrderById | Missing expected function wiring in one or more stages. | Keep current wiring and add regression coverage to prevent drift. |
| Physician Orders / POF generation | Provider signature completion | pof_requests, pof_signatures, document_events, member_files, physician_orders | lib/services/pof-esign.ts | Strong | app/(portal)/operations/member-command-center/pof-actions.ts :: sendPofSignatureRequestAction, resendPofSignatureRequestAction<br>app/sign/pof/[token]/actions.ts :: submitPublicPofSignatureAction<br>app/sign/pof/[token]/page.tsx<br>components/physician-orders/pof-esign-workflow-card.tsx<br>lib/services/pof-esign.ts :: getPofRequestTimeline, listPofTimelineForPhysicianOrder<br>lib/services/pof-esign.ts :: sendNewPofSignatureRequest<br>supabase/migrations/0053_artifact_drift_replay_hardening.sql | Missing expected function wiring in one or more stages. | Keep current wiring and add regression coverage to prevent drift. |
| Provider signature completion | MHP generation / sync | physician_orders, member_health_profiles | lib/services/member-health-profiles-supabase.ts | Strong | app/(portal)/health/member-health-profiles/[memberId]/page.tsx<br>app/sign/pof/[token]/actions.ts :: submitPublicPofSignatureAction<br>lib/services/member-health-profiles-supabase.ts :: getMemberHealthProfileDetailSupabase<br>lib/services/physician-orders-supabase.ts :: signPhysicianOrder, syncMemberHealthProfileFromSignedPhysicianOrder | Missing expected function wiring in one or more stages. | Keep current wiring and add regression coverage to prevent drift. |
| MHP generation / sync | MCC downstream visibility | member_health_profiles, member_command_centers, member_attendance_schedules, member_contacts | lib/services/member-command-center-supabase.ts | Strong | app/(portal)/operations/member-command-center/[memberId]/page.tsx<br>app/(portal)/operations/member-command-center/summary-actions.ts :: saveMemberCommandCenterSummaryAction, saveMemberCommandCenterAttendanceAction<br>lib/services/enrollment-packet-intake-mapping.ts :: mapEnrollmentPacketToDownstream<br>lib/services/member-command-center-supabase.ts :: getMemberCommandCenterDetailSupabase<br>lib/services/member-command-center-supabase.ts :: getMemberCommandCenterDetailSupabase, ensureMemberCommandCenterProfileSupabase, ensureMemberAttendanceScheduleSupabase | No major handoff risks detected from static simulation. | Keep current wiring and add regression coverage to prevent drift. |
| MCC downstream visibility | Care Plan creation / signature workflow | care_plans, care_plan_sections, care_plan_versions, care_plan_review_history, care_plan_signature_events, member_files | lib/services/care-plans-supabase.ts | Partial | app/(portal)/health/care-plans/new/page.tsx<br>app/care-plan-actions.ts :: createCarePlanAction, reviewCarePlanAction, signCarePlanAction, sendCarePlanToCaregiverAction<br>app/sign/care-plan/[token]/actions.ts :: submitPublicCarePlanSignatureAction<br>app/sign/care-plan/[token]/page.tsx<br>lib/services/care-plan-esign.ts :: sendCarePlanToCaregiverForSignature<br>lib/services/care-plans-supabase.ts :: createCarePlan, reviewCarePlan, signCarePlanAsNurseAdmin<br>supabase/migrations/0053_artifact_drift_replay_hardening.sql | Missing expected function wiring in one or more stages. Expected canonical writes not evidenced: care_plan_sections, care_plan_versions, care_plan_review_history. Identity resolver protections are incomplete. | Route this handoff through canonical services and persist to: care_plan_sections, care_plan_versions, care_plan_review_history. |
| Care Plan creation / signature workflow | MAR generation from POF meds | pof_medications, mar_schedules | lib/services/mar-workflow.ts | Strong | app/(portal)/health/mar/page.tsx<br>app/sign/pof/[token]/actions.ts :: submitPublicPofSignatureAction<br>lib/services/mar-workflow.ts :: syncPofMedicationsFromSignedOrder, generateMarSchedulesForMember<br>lib/services/physician-orders-supabase.ts :: signPhysicianOrder | Missing expected function wiring in one or more stages. | Keep current wiring and add regression coverage to prevent drift. |
| MAR generation from POF meds | MAR documentation workflow | mar_administrations | lib/services/mar-workflow.ts | Broken | app/(portal)/health/mar/administration-actions.ts :: recordScheduledMarAdministrationAction, recordPrnMarAdministrationAction, recordPrnOutcomeAction<br>app/(portal)/health/mar/page.tsx<br>components/forms/mar-workflow-board.tsx<br>lib/services/mar-workflow.ts :: documentScheduledMarAdministration, documentPrnMarAdministration, documentPrnOutcomeAssessment | Missing expected function wiring in one or more stages. Expected canonical writes not evidenced: mar_administrations. | Route this handoff through canonical services and persist to: mar_administrations. |
| MAR documentation workflow | Monthly report / PDF generation | (read-heavy handoff) | lib/services/mar-monthly-report.ts | Strong | app/(portal)/health/mar/report-actions.ts :: generateMonthlyMarReportPdfAction<br>components/forms/mar-monthly-report-panel.tsx<br>lib/services/mar-monthly-report-pdf.ts :: buildMarMonthlyReportPdfDataUrl<br>lib/services/mar-monthly-report.ts :: assembleMarMonthlyReportData | No major handoff risks detected from static simulation. | Keep current wiring and add regression coverage to prevent drift. |
| Monthly report / PDF generation | Member Files persistence | member_files | lib/services/member-command-center-supabase.ts | Strong | app/(portal)/health/mar/report-actions.ts :: generateMonthlyMarReportPdfAction<br>app/(portal)/operations/member-command-center/file-actions.ts :: addMemberFileAction<br>components/forms/member-command-center-file-manager.tsx<br>lib/services/member-command-center-supabase.ts :: listMemberFilesSupabase<br>lib/services/member-files.ts :: saveGeneratedMemberPdfToFiles, saveCommandCenterMemberFileUpload | Identity resolver protections are incomplete. | Enforce canonical lead/member resolver checks and fail fast on mismatches. |
| Lifecycle milestones | Notifications / alerts generated | user_notifications | lib/services/notifications.ts | Strong | app/(portal)/notifications/actions.ts :: markNotificationReadAction, markAllNotificationsReadAction<br>app/(portal)/notifications/page.tsx<br>lib/services/lifecycle-milestones.ts :: recordWorkflowMilestone<br>lib/services/mar-workflow.ts :: documentScheduledMarAdministration<br>lib/services/notifications.ts :: createUserNotification, listUserNotificationsForUser<br>lib/services/notifications.ts :: listUserNotificationsForUser | Missing expected function wiring in one or more stages. Expected notifications are missing in lifecycle code paths. | Create user notifications at successful lifecycle milestones only after durable persistence. |

## 3. Critical Failures
- severity: **High**
  - title: Lead -> Send Enrollment Packet
  - why it matters: Send from canonical lead/member identity and persist packet request + event.
  - files/functions/modules: app/(portal)/sales/new-entries/send-enrollment-packet/page.tsx; app/sales-enrollment-actions.ts :: sendEnrollmentPacketAction; components/sales/send-enrollment-packet-action.tsx :: sendEnrollmentPacketAction; lib/services/enrollment-packets.ts :: listEnrollmentPacketRequestsForLead, listEnrollmentPacketRequestsForMember
  - probable root cause: Missing expected function wiring in one or more stages. Expected canonical writes not evidenced: enrollment_packet_requests, enrollment_packet_events, lead_activities. Identity resolver protections are incomplete. Expected notifications are missing in lifecycle code paths.
  - recommended fix: Route this handoff through canonical services and persist to: enrollment_packet_requests, enrollment_packet_events, lead_activities.
- severity: **High**
  - title: Enrollment Packet completion / e-sign return -> Lead activity logging
  - why it matters: Enrollment packet milestones should write lead activities visible in sales workflows.
  - files/functions/modules: app/(portal)/sales/activities/page.tsx; app/sales-lead-actions.ts :: createSalesLeadActivityAction
  - probable root cause: Missing expected function wiring in one or more stages. Expected canonical writes not evidenced: lead_activities. Identity resolver protections are incomplete.
  - recommended fix: Route this handoff through canonical services and persist to: lead_activities.
- severity: **High**
  - title: MAR generation from POF meds -> MAR documentation workflow
  - why it matters: Given/not-given and PRN documentation should persist in canonical MAR administration records.
  - files/functions/modules: app/(portal)/health/mar/administration-actions.ts :: recordScheduledMarAdministrationAction, recordPrnMarAdministrationAction, recordPrnOutcomeAction; app/(portal)/health/mar/page.tsx; components/forms/mar-workflow-board.tsx; lib/services/mar-workflow.ts :: documentScheduledMarAdministration, documentPrnMarAdministration, documentPrnOutcomeAssessment
  - probable root cause: Missing expected function wiring in one or more stages. Expected canonical writes not evidenced: mar_administrations.
  - recommended fix: Route this handoff through canonical services and persist to: mar_administrations.
- severity: **Medium**
  - title: Send Enrollment Packet -> Enrollment Packet completion / e-sign return
  - why it matters: Public sign flow should persist signatures/uploads and finalize request status.
  - files/functions/modules: app/sign/enrollment-packet/[token]/actions.ts :: savePublicEnrollmentPacketProgressAction, submitPublicEnrollmentPacketAction; app/sign/enrollment-packet/[token]/page.tsx; components/enrollment-packets/enrollment-packet-public-form.tsx; lib/services/enrollment-packet-intake-mapping.ts :: mapEnrollmentPacketToDownstream; supabase/migrations/0061_enrollment_packet_conversion_rpc.sql
  - probable root cause: Missing expected function wiring in one or more stages. Expected canonical writes not evidenced: enrollment_packet_fields, enrollment_packet_signatures. Identity resolver protections are incomplete. Expected notifications are missing in lifecycle code paths. Expected document/file persistence checks are missing.
  - recommended fix: Route this handoff through canonical services and persist to: enrollment_packet_fields, enrollment_packet_signatures.

## 4. Canonicality Risks Found During Simulation
- fake persistence:
  - none detected in scanned runtime files
- fallback records:
  - none detected
- missing writes:
  - Lead -> Send Enrollment Packet: enrollment_packet_requests, enrollment_packet_events, lead_activities
  - Send Enrollment Packet -> Enrollment Packet completion / e-sign return: enrollment_packet_fields, enrollment_packet_signatures
  - Enrollment Packet completion / e-sign return -> Lead activity logging: lead_activities
  - MCC downstream visibility -> Care Plan creation / signature workflow: care_plan_sections, care_plan_versions, care_plan_review_history
  - MAR generation from POF meds -> MAR documentation workflow: mar_administrations
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
- Lead -> Send Enrollment Packet
  - what should generate: notifications/files documented in lifecycle config for this handoff
  - what actually generates: see positive function evidence in section 2
  - what fails to save or notify: Create sender notification through the workflow milestone pipeline
- Send Enrollment Packet -> Enrollment Packet completion / e-sign return
  - what should generate: notifications/files documented in lifecycle config for this handoff
  - what actually generates: see positive function evidence in section 2
  - what fails to save or notify: Completion should notify sender through the workflow milestone pipeline, Persist completed packet artifact
- Lifecycle milestones -> Notifications / alerts generated
  - what should generate: notifications/files documented in lifecycle config for this handoff
  - what actually generates: see positive function evidence in section 2
  - what fails to save or notify: Enrollment milestones should notify

## 7. Fix First
1. Lead -> Send Enrollment Packet: Route this handoff through canonical services and persist to: enrollment_packet_requests, enrollment_packet_events, lead_activities.
2. Enrollment Packet completion / e-sign return -> Lead activity logging: Route this handoff through canonical services and persist to: lead_activities.
3. MAR generation from POF meds -> MAR documentation workflow: Route this handoff through canonical services and persist to: mar_administrations.
4. Send Enrollment Packet -> Enrollment Packet completion / e-sign return: Route this handoff through canonical services and persist to: enrollment_packet_fields, enrollment_packet_signatures.
5. MCC downstream visibility -> Care Plan creation / signature workflow: Route this handoff through canonical services and persist to: care_plan_sections, care_plan_versions, care_plan_review_history.

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
- app/documentation-actions-impl.ts:130 catch block returns ok:true
- app/documentation-actions-impl.ts:219 catch block returns ok:true
- app/documentation-actions-impl.ts:345 catch block returns ok:true
- app/documentation-actions-impl.ts:426 catch block returns ok:true
- app/documentation-actions-impl.ts:477 catch block returns ok:true
- app/documentation-actions-impl.ts:547 catch block returns ok:true
- app/documentation-actions-impl.ts:614 catch block returns ok:true
- app/documentation-actions-impl.ts:655 catch block returns ok:true
- app/documentation-actions-impl.ts:677 catch block returns ok:true
- app/documentation-actions-impl.ts:709 catch block returns ok:true
- app/documentation-create-actions-impl.ts:119 catch block returns ok:true
- app/documentation-create-actions-impl.ts:208 catch block returns ok:true
- app/documentation-create-actions-impl.ts:334 catch block returns ok:true
- app/documentation-create-actions-impl.ts:415 catch block returns ok:true
- app/documentation-create-actions-impl.ts:466 catch block returns ok:true
- app/sales-lead-actions.ts:374 catch block returns ok:true
- app/sales-lead-actions.ts:520 catch block returns ok:true
- app/sales-lead-actions.ts:577 catch block returns ok:true
- app/sales-partner-actions.ts:47 catch block returns ok:true
- app/sales-partner-actions.ts:90 catch block returns ok:true

### Live Simulation Details
- Enrollment Packet Live E2E: FAIL (`npm run e2e:enrollment-packet:live`)
  - stderr tail: `  at Object.<anonymous> (D:\Memory Lane App\node_modules\esbuild\lib\main.js:2225:3)
    at Module._compile (node:internal/modules/cjs/loader:1812:14)
    at Object..js (node:internal/modules/cjs/loader:1943:10)
    at Module.load (node:internal/modules/cjs/loader:1533:32)
    at Module._load (node:internal/modules/cjs/loader:1335:12)
    at wrapModuleLoad (node:internal/modules/cjs/loader:255:19) {
  name: 'TransformError',
  errno: -4048,
  code: 'EPERM',
  syscall: 'spawn'
}

Node.js v24.14.0`
- POF Signing Live E2E: FAIL (`npm run e2e:pof-sign:live`)
  - stderr tail: `  at Object.<anonymous> (D:\Memory Lane App\node_modules\esbuild\lib\main.js:2225:3)
    at Module._compile (node:internal/modules/cjs/loader:1812:14)
    at Object..js (node:internal/modules/cjs/loader:1943:10)
    at Module.load (node:internal/modules/cjs/loader:1533:32)
    at Module._load (node:internal/modules/cjs/loader:1335:12)
    at wrapModuleLoad (node:internal/modules/cjs/loader:255:19) {
  name: 'TransformError',
  errno: -4048,
  code: 'EPERM',
  syscall: 'spawn'
}

Node.js v24.14.0`
