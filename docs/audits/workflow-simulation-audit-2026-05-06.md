# Workflow Simulation Audit Report
_Generated: 2026-05-06 EDT_
_Scope: static code-path audit only; live E2E checks were not run because the available scripts create real Supabase and email side effects._

## 1. Executive Summary

Overall lifecycle health is **Partial**.

The good news: I did not find mock runtime persistence, local-only storage, or fake fallback records in the audited production workflow paths. The main workflow is routed through real service-layer code and real Supabase-backed writes.

The main risk is different: several important workflows can return a committed success while downstream operational readiness is still pending follow-up. That is safer than fake success, but it still creates real staff risk if the UI reads as "done" when nurses or admins should read it as "saved, but not operationally ready yet."

The most important operational failures are:

1. **Intake Assessment -> draft POF readiness**
   Intake can commit successfully even when draft POF creation or immediate verification still needs follow-up.

2. **Signed POF -> downstream clinical readiness**
   Provider signature can commit while downstream MHP, MCC, and MAR sync is queued for retry.

3. **Care Plan completion is easy to overread**
   Care plan signature is not the canonical trigger for MAR readiness. Signed POF medication sync is.

4. **Notifications are stronger for failure than success**
   Action-required and failure alerts are well-defended. Positive success notifications are less consistent in later lifecycle stages.

## 2. Lifecycle Handoff Table

| Upstream stage | Downstream stage | Expected canonical write | Expected resolver/read path | Current status | Exact files/functions involved | Risk summary | Required fix |
|---|---|---|---|---|---|---|---|
| Lead | Send Enrollment Packet | `enrollment_packet_requests`, `enrollment_packet_events`, `lead_activities` | `lib/services/enrollment-packets-listing.ts` | Strong | `app/sales-enrollment-actions.ts` -> `sendEnrollmentPacketAction`; `lib/services/enrollment-packets-send-runtime.ts` -> `sendEnrollmentPacketRequest`; `lib/services/enrollment-packet-public-helpers.ts` -> `insertPacketEvent`; `lib/services/enrollment-packet-mapping-runtime.ts` -> `syncEnrollmentPacketLeadActivityOrQueue` | Canonical send path is real and Supabase-backed. | Keep regression coverage on send + event creation. |
| Send Enrollment Packet | Enrollment Packet completion / e-sign return | `enrollment_packet_fields`, `enrollment_packet_signatures`, `enrollment_packet_uploads`, `enrollment_packet_requests`, `member_files`, `enrollment_packet_mapping_runs` | `lib/services/enrollment-packet-public-helpers.ts` | Strong | `app/sign/enrollment-packet/[token]/actions.ts` -> `submitPublicEnrollmentPacketAction`; `lib/services/enrollment-packets-public-runtime.ts` -> `submitPublicEnrollmentPacket`; `lib/services/enrollment-packet-completion-cascade.ts` -> `runEnrollmentPacketCompletionCascade` | Public completion flow persists real packet data and filed artifacts. | Keep live regression coverage for packet completion. |
| Enrollment Packet completion / e-sign return | Lead activity logging | `lead_activities` | `lib/services/sales-crm-supabase.ts` | Partial | `lib/services/enrollment-packet-completion-cascade.ts` -> `ensureEnrollmentPacketLeadActivity`; `lib/services/enrollment-packet-mapping-runtime.ts` -> `syncEnrollmentPacketLeadActivityOrQueue` | Completion can commit while lead activity is queued for follow-up if the strict insert fails. | Surface queued follow-up clearly in sales workflows. |
| Lead activity logging | Member creation / enrollment resolution | `members`, `leads` | `lib/services/member-command-center-supabase.ts` | Strong | `app/sales-lead-actions.ts` -> `enrollMemberFromLeadAction`; `lib/services/canonical-person-ref.ts`; `applyClosedWonLeadConversion` path in sales services | Canonical lead/member translation is explicit and source lead linkage is preserved. | Keep one conversion path and protect `source_lead_id`. |
| Member creation / enrollment resolution | Intake Assessment | `intake_assessments`, `assessment_responses`, `intake_assessment_signatures`, `member_files` | `lib/services/relations.ts` -> `getAssessmentDetail` | Strong | `app/intake-actions.ts` -> `createAssessmentAction`; `lib/services/intake-pof-mhp-cascade.ts` -> `createIntakeAssessmentWithResponses`; `lib/services/intake-assessment-esign.ts` -> `signIntakeAssessment`; `lib/services/member-files.ts` -> `saveGeneratedMemberPdfToFiles` | Intake write path is canonical and identity checks are explicit. | Keep regression coverage on signature + member file save. |
| Intake Assessment | Physician Orders / POF generation | `physician_orders` | `lib/services/physician-orders-supabase.ts` | Partial | `app/intake-actions.ts` -> `createAssessmentAction`; `lib/services/intake-pof-mhp-cascade.ts` -> `completeIntakeAssessmentPostSignWorkflow`, `autoCreateDraftPhysicianOrderFromIntake`; `lib/services/physician-orders-supabase.ts` -> `createDraftPhysicianOrderFromAssessment` | Draft POF write is real, but intake can still return follow-up-needed if draft creation fails or committed readback verification misses. | Make follow-up-needed visibly incomplete, not "done". |
| Physician Orders / POF generation | Provider signature completion | `pof_requests`, `pof_signatures`, `document_events`, `member_files`, `physician_orders` | `lib/services/pof-esign.ts` | Strong | `app/(portal)/operations/member-command-center/pof-actions.ts` -> `sendPofSignatureRequestAction`; `app/sign/pof/[token]/actions.ts` -> `submitPublicPofSignatureAction`; `lib/services/pof-esign-public.ts` -> `submitPublicPofSignature` | Request, signature, signed artifact, and document events are persisted through canonical services. | Keep replay/idempotency coverage around public sign. |
| Provider signature completion | MHP generation / sync | `physician_orders`, `member_health_profiles` | `lib/services/member-health-profiles-supabase.ts` | Partial | `lib/services/pof-post-sign-runtime.ts` -> `runBestEffortCommittedPofSignatureFollowUp`; `lib/services/physician-order-post-sign-service.ts` -> `processSignedPhysicianOrderPostSignSync`; `lib/services/physician-orders-supabase.ts` -> `signPhysicianOrder` | Signed POF can commit while downstream MHP/MCC/MAR sync is queued for retry. | Show downstream-readiness status anywhere staff rely on signed POF. |
| MHP generation / sync | MCC downstream visibility | `member_health_profiles`, `member_command_centers`, `member_attendance_schedules`, `member_contacts` | `lib/services/member-command-center-supabase.ts` | Strong | `lib/services/member-command-center-supabase.ts` -> `getMemberCommandCenterDetailSupabase`; `lib/services/enrollment-packet-intake-mapping.ts` -> `mapEnrollmentPacketToDownstream` | MCC reads canonical downstream entities once sync has completed. | Keep dependency on canonical member identity. |
| MCC downstream visibility | Care Plan creation / signature workflow | `care_plans`, `care_plan_sections`, `care_plan_versions`, `care_plan_review_history`, `care_plan_signature_events`, `member_files` | `lib/services/care-plans-read.ts` | Strong | `app/care-plan-actions.ts`; `app/sign/care-plan/[token]/actions.ts`; `lib/services/care-plans-supabase.ts`; `lib/services/care-plan-esign-public.ts` -> `submitPublicCarePlanSignature` | Care plan create/review/sign/send paths are canonical and final signed artifact is required. | Keep post-sign verification coverage. |
| Care Plan creation / signature workflow | MAR generation from POF meds | `pof_medications`, `mar_schedules` | `lib/services/mar-workflow.ts` | Weak | `lib/services/pof-post-sign-runtime.ts`; `lib/services/physician-order-post-sign-service.ts`; `lib/services/mar-workflow.ts` -> `syncPofMedicationsFromSignedOrder`, `generateMarSchedulesForMember` | MAR readiness does not come from care plan completion. The real trigger is signed POF post-sign sync. | Make product language and staff workflow explicit about the real trigger. |
| MAR generation from POF meds | MAR documentation workflow | `mar_administrations`, `med_administration_logs` | `lib/services/mar-workflow-read.ts` | Strong | `app/(portal)/health/mar/actions-impl.ts`; `lib/services/mar-workflow.ts`; `lib/services/mar-prn-workflow.ts` | Scheduled and PRN documentation write through canonical MAR services and audit flow. | Keep idempotency coverage on repeated submissions. |
| MAR documentation workflow | Monthly MAR summary or PDF generation | read-heavy handoff | `lib/services/mar-monthly-report.ts` | Strong | `app/(portal)/health/mar/report-actions.ts` -> `generateMonthlyMarReportPdfAction`; `lib/documents/mar/mar-monthly-report-pdf.ts`; `lib/services/mar-monthly-report.ts` | Report builder reads canonical MAR/member/POF data and generates deterministic output. | Keep data quality warnings visible. |
| Monthly MAR summary or PDF generation | Member Files persistence | `member_files` | `lib/services/member-command-center-supabase.ts` -> `listMemberFilesSupabase` | Strong | `app/(portal)/health/mar/actions-impl.ts` -> `generateMonthlyMarReportPdfAction`; `lib/services/member-files.ts` -> `saveGeneratedMemberPdfToFiles` | Member-file persistence is verified and returns follow-up-needed if verification fails. | Keep verification truth surfaced to staff. |
| Lifecycle milestones | Notifications / alerts generated | `user_notifications` | `lib/services/notifications.ts` -> `listUserNotificationsForUser` | Partial | `lib/services/lifecycle-milestones.ts` -> `recordWorkflowMilestone`; milestone callers in enrollment, POF, care plan, and MAR services | Failure/action-required notifications are strong. Success notifications are not equally comprehensive in later stages. | Decide which late-stage successes should notify and route them through the milestone pipeline. |

## 3. Critical Failures

### 1. Intake can be saved before draft POF readiness is fully true

- Severity: **High**
- Why it matters: A nurse can see a completed intake while the draft physician order still needs repair or verification.
- Exact files/functions/modules: `app/intake-actions.ts` -> `createAssessmentAction`; `lib/services/intake-pof-mhp-cascade.ts` -> `completeIntakeAssessmentPostSignWorkflow`, `autoCreateDraftPhysicianOrderFromIntake`; `lib/services/physician-orders-supabase.ts` -> `createDraftPhysicianOrderFromAssessment`
- Probable root cause: The system correctly commits the intake first, then allows draft POF follow-up to degrade into queued work instead of rolling back the intake.
- Recommended fix: Treat `follow-up-needed` as visibly incomplete in intake UI, task lists, and downstream readiness labels.

### 2. Signed POF does not guarantee immediate downstream clinical readiness

- Severity: **High**
- Why it matters: Admins or nurses may assume the signed order is ready everywhere even while MHP, MCC, and MAR sync are still queued.
- Exact files/functions/modules: `app/sign/pof/[token]/actions.ts` -> `submitPublicPofSignatureAction`; `lib/services/pof-esign-public.ts` -> `submitPublicPofSignature`; `lib/services/pof-post-sign-runtime.ts` -> `runBestEffortCommittedPofSignatureFollowUp`; `lib/services/physician-order-post-sign-service.ts` -> `processSignedPhysicianOrderPostSignSync`
- Probable root cause: The system favors durable signature commitment first, then retries downstream sync if later steps fail.
- Recommended fix: Show a blocking downstream-readiness banner anywhere staff depend on MHP, MCC, or MAR immediately after POF signature.

### 3. Care plan signature is easy to confuse with MAR readiness

- Severity: **Medium**
- Why it matters: Staff can move into medication documentation too early if they use care plan completion as the signal that MAR is ready.
- Exact files/functions/modules: `lib/services/pof-post-sign-runtime.ts`; `lib/services/physician-order-post-sign-service.ts`; `lib/services/mar-workflow.ts`
- Probable root cause: This is a workflow-truth mismatch, not a missing write.
- Recommended fix: Make signed POF medication sync the explicit MAR readiness indicator in UI copy and staff training.

### 4. Lead activity can lag behind packet completion

- Severity: **Medium**
- Why it matters: Sales staff can miss that a caregiver finished the packet if the strict lead activity insert fails after the packet already committed.
- Exact files/functions/modules: `lib/services/enrollment-packet-completion-cascade.ts` -> `ensureEnrollmentPacketLeadActivity`; `lib/services/enrollment-packet-mapping-runtime.ts` -> `syncEnrollmentPacketLeadActivityOrQueue`
- Probable root cause: Completion is committed first, then strict lead activity sync can degrade into queued follow-up.
- Recommended fix: Make lead-activity follow-up tasks visible in the sales pipeline and dashboard.

## 4. Canonicality Risks Found During Simulation

- **Fake persistence:** I did not find mock runtime persistence, local-only storage, or synthetic records in the audited lifecycle paths.
- **Fallback records:** I did not find fake fallback rows standing in for missing Supabase writes.
- **Missing writes:** I did not find a fully fake handoff. The higher risk is committed upstream writes with queued downstream work.
- **Stale derived state:** Signed POF can leave MHP, MCC, and MAR stale until post-sign sync completes.
- **Non-canonical downstream reads:** I did not find obvious UI-level duplicate business rules in the audited paths. The downstream reads mostly go through shared services.
- **Identity mismatch risk:** Canonical member/lead resolution is generally strong in intake, conversion, member files, and POF flows. I did not find a clear lead/member split-brain path in the audited lifecycle.

## 5. Schema / Runtime Risks Exposed by Workflow

- I did not find an obvious missing-table problem in the lifecycle paths reviewed.
- Intake creation depends on the RPC from `supabase/migrations/0051_intake_assessment_atomic_creation_rpc.sql`. If that RPC is missing or stale, intake creation fails explicitly rather than silently falling back.
- Caregiver care plan finalization depends on the RPC from `supabase/migrations/0053_artifact_drift_replay_hardening.sql`. The code fails explicitly if the RPC is missing.
- Enrollment packet completion depends on downstream mapping and lead-activity follow-up services. When those fail, the system usually queues follow-up instead of silently pretending the lifecycle is fully ready.
- Signed POF downstream readiness depends on the retryable queue and alert path in `lib/services/physician-order-post-sign-service.ts`. That is safer than silent failure, but real operational lag is possible after signature.
- Live E2E scripts exist for enrollment packet and POF signing, but I did not run them in this pass because they create real records and email side effects.

## 6. Document / Notification / File Persistence Findings

- **Enrollment Packet artifacts are strong.**
  `runEnrollmentPacketCompletionCascade` repairs member-file links, ensures a `completed_packet` artifact exists, and records the submitted milestone.

- **Intake PDF persistence is strong but can still need follow-up.**
  `completeIntakeAssessmentPostSignWorkflow` saves the Intake PDF through `saveGeneratedMemberPdfToFiles`; if verification fails, it queues follow-up instead of pretending success.

- **Signed POF artifact persistence is strong.**
  The public POF signing flow persists the signed artifact before returning the post-sign follow-up result.

- **Care Plan signature artifact persistence is strong.**
  `submitPublicCarePlanSignature` requires a committed final member file reference before treating the caregiver-sign flow as complete.

- **Monthly MAR PDF persistence is one of the strongest paths.**
  `generateMonthlyMarReportPdfAction` verifies `member_files` persistence and returns `follow-up-needed` if persistence cannot be confirmed.

- **Notifications are mixed.**
  Action-required and failure notifications are well-defended through `recordWorkflowMilestone`.
  Positive success notifications are strongest for core event types like `enrollment_packet_submitted`, `intake_completed`, `pof_sent`, `pof_signed`, and `care_plan_signed`. Later-stage successes, like a saved monthly MAR PDF, do not appear to emit an equivalent user-facing success notification.

## 7. Fix First

1. Make intake `follow-up-needed` state impossible to confuse with full readiness.
2. Surface signed-POF downstream sync status anywhere nurses/admins rely on MHP, MCC, or MAR immediately after signature.
3. Make MAR readiness language explicit: signed POF medication sync is the trigger, not care plan completion.
4. Make enrollment-packet lead-activity follow-up visible in sales workflow surfaces so packet completion cannot be missed.
5. Decide which later-stage successes should generate explicit user notifications and wire only those through the shared milestone pipeline.

## 8. Regression Checklist

1. Send an enrollment packet from a lead and verify `enrollment_packet_requests` plus event rows in Supabase.
2. Complete the packet from the public link and verify signatures, uploads, completed packet artifact, member-file linkage, and downstream mapping status.
3. Confirm lead activity either writes immediately or creates a visible follow-up task when sync fails.
4. Convert the lead and verify exactly one canonical member linked by `members.source_lead_id`.
5. Submit intake assessment and verify assessment rows, signature state, intake PDF member file, and post-sign readiness state.
6. Confirm draft POF creation is either verified immediately or clearly marked `follow-up-needed`.
7. Send and complete provider POF signature and verify request rows, signed artifact persistence, and post-sign sync status.
8. Confirm MHP, MCC, and MAR either refresh from the signed POF or clearly show queued follow-up.
9. Create, review, sign, and caregiver-sign a care plan and verify signature events plus final member-file artifact.
10. Document scheduled and PRN MAR entries and verify given/not-given plus effective/ineffective persistence.
11. Generate monthly MAR PDF and verify it is stored in `member_files` and visible in member file surfaces.
12. Verify which lifecycle steps create success notifications and which only create failure/action-required alerts.
