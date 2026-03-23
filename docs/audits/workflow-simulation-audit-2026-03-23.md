# Workflow Simulation Audit Report

Generated: 2026-03-23
Scope: static audit runner plus direct code-path review of the live lifecycle services
Evidence level: code review only; live E2E was not run because no confirmed local app/Supabase test session was prepared for this run

## 1. Executive Summary

Overall workflow health: Partial

The good news is the core clinical and enrollment workflows are much stronger than the raw static audit suggested. Enrollment packets, intake, POF signing, care plan signing, MAR documentation, and member-file persistence are all wired to real Supabase tables and mostly use transaction-backed RPCs where the write is high risk.

The real weakness is not fake persistence. The weakness is post-commit follow-up. Several important handoffs still happen after the main write succeeds:

- enrollment packet send/complete can commit while `lead_activities` needs a queued follow-up
- signed POF can commit while MHP/MAR sync is only `queued`
- milestone notifications are best-effort and do not block workflow success

That means staff can get a true signed or filed record in Supabase, but the next operational screen or inbox alert may lag behind. For nurses, admins, and caregivers, that is safer than fake success, but it is still not fully production-tight.

## 2. Lifecycle Handoff Table

| Upstream Stage | Downstream Stage | Status | What is working | Main risk | Exact files / functions |
|---|---|---|---|---|---|
| Lead | Send Enrollment Packet | Partial | Canonical lead/member resolution is enforced, request prep is RPC-backed, packet events are written, delivery state is finalized, and a lead activity sync is attempted. | Lead activity and notifications are post-commit follow-up, not atomic with the send. | `app/sales-enrollment-actions.ts` -> `sendEnrollmentPacketAction`; `lib/services/enrollment-packets-send-runtime.ts` -> `sendEnrollmentPacketRequest`; `lib/services/enrollment-packet-mapping-runtime.ts` -> `syncEnrollmentPacketLeadActivityOrQueue` |
| Send Enrollment Packet | Enrollment Packet completion / e-sign return | Partial | Public progress save uses RPC, submission persists uploads/signature/completed packet artifacts, and filing is finalized through `rpc_finalize_enrollment_packet_submission`. | Downstream mapping happens after filing, so packet status can be real while downstream readiness is still pending or failed. | `app/sign/enrollment-packet/[token]/actions.ts` -> `submitPublicEnrollmentPacketAction`; `lib/services/enrollment-packets-public-runtime.ts` -> `savePublicEnrollmentPacketProgress`, `submitPublicEnrollmentPacket`; `lib/services/enrollment-packet-public-helpers.ts` -> `buildPublicEnrollmentPacketSubmitResult` |
| Enrollment Packet completion / e-sign return | Lead activity logging | Partial | Completion explicitly attempts to write a lead activity and queues follow-up if that insert fails. | Sales activity can drift from the real packet state because the lead activity write is not part of the same committed unit. | `lib/services/enrollment-packets-public-runtime.ts` -> completion branch after filing; `lib/services/enrollment-packet-mapping-runtime.ts` -> `syncEnrollmentPacketLeadActivityOrQueue`, `addLeadActivityStrict` |
| Lead activity logging | Member creation / enrollment resolution | Strong | Lead conversion resolves canonical lead identity, preserves `members.source_lead_id`, and revalidates downstream member surfaces. | I did not find a duplicate lead/member write path in this handoff. | `app/sales-lead-actions.ts` -> `enrollMemberFromLeadAction`; `lib/services/canonical-person-ref.ts` |
| Member creation / enrollment resolution | Intake Assessment | Strong | Intake creation resolves canonical member + lead, writes responses through `rpc_create_intake_assessment_with_responses`, signs through service code, and persists the intake PDF to member files. | Draft POF creation and PDF save are follow-up work after the intake exists, but failures return explicit errors instead of synthetic success. | `app/intake-actions.ts` -> `createAssessmentAction`; `lib/services/intake-pof-mhp-cascade.ts` -> `createIntakeAssessmentWithResponses`; `lib/services/intake-assessment-esign.ts` -> `signIntakeAssessment`; `lib/services/member-files.ts` -> `saveGeneratedMemberPdfToFiles` |
| Intake Assessment | Physician Orders / POF generation | Partial | Intake sign-off explicitly triggers draft POF creation using canonical services. | Intake can be saved and signed while draft POF creation fails and gets queued for follow-up. | `app/intake-actions.ts` -> `createAssessmentAction`; `lib/services/intake-pof-mhp-cascade.ts` -> `autoCreateDraftPhysicianOrderFromIntake` |
| Physician Orders / POF generation | Provider signature completion | Strong | Provider signing persists signature image, signed PDF, member file, request state, and replay-safe token rotation through `rpc_finalize_pof_signature`. | Notification delivery remains best-effort. | `app/(portal)/health/physician-orders/actions.ts` -> `saveAndDispatchPofSignatureRequestFromEditorAction`; `app/sign/pof/[token]/actions.ts` -> `submitPublicPofSignatureAction`; `lib/services/pof-esign-public.ts` -> `submitPublicPofSignature` |
| Provider signature completion | Member Health Profile generation / sync | Partial | Signed POF triggers post-sign sync logic for MHP and MAR. | The code explicitly allows a real signature success with downstream sync only `queued`, so MHP/MCC/MAR may lag after the provider signs. | `lib/services/pof-post-sign-runtime.ts` -> `runBestEffortCommittedPofSignatureFollowUp`; `lib/services/physician-orders-supabase.ts` -> `processSignedPhysicianOrderPostSignSync`, `syncMemberHealthProfileFromSignedPhysicianOrder` |
| Member Health Profile generation / sync | MCC visibility | Strong | MCC reads from canonical member/MHP/MCC services and uses shared resolver paths. | I did not find a fake or local fallback path here. | `lib/services/member-health-profiles-supabase.ts`; `lib/services/member-command-center-supabase.ts` |
| MCC visibility | Care Plan creation / signature workflow | Strong | Care plan core writes and snapshot/version history use RPCs, nurse/admin sign-off is service-backed, caregiver send uses RPC-backed status transitions, and caregiver signing finalizes the signed artifact into member files. | Notification delivery is still best-effort. | `app/care-plan-actions.ts`; `lib/services/care-plans-supabase.ts` -> `createCarePlan`, `reviewCarePlan`, `signCarePlanAsNurseAdmin`; `lib/services/care-plan-esign.ts`; `lib/services/care-plan-esign-public.ts` |
| Care Plan creation / signature workflow | MAR generation from POF meds | Weak | MAR generation itself is real and Supabase-backed. | This is not a true care-plan-driven handoff in the current architecture. MAR is driven by signed POF medication data, not by care plan completion. | `lib/services/physician-orders-supabase.ts` -> post-sign cascade; `lib/services/mar-workflow.ts` -> `generateMarSchedulesForMember` |
| MAR generation from POF meds | MAR documentation workflow | Strong | MAR documentation writes to `mar_administrations`, enforces scheduled vs PRN rules, and creates alerts for not-given doses. | Notification failures do not block documentation success. | `app/(portal)/health/mar/administration-actions.ts`; `lib/services/mar-workflow.ts` -> `documentScheduledMarAdministration`, `documentPrnMarAdministration`, `documentPrnOutcomeAssessment` |
| MAR documentation workflow | Monthly MAR summary or PDF generation | Strong | Monthly report data is assembled from canonical MAR services and PDF generation is deterministic. | None found beyond normal notification best-effort behavior. | `app/(portal)/health/mar/actions-impl.ts` -> `generateMonthlyMarReportPdfAction`; `lib/services/mar-monthly-report.ts`; `lib/services/mar-monthly-report-pdf.ts` |
| Monthly MAR summary or PDF generation | Member Files persistence | Strong | MAR PDF save uses `saveGeneratedMemberPdfToFiles`, and the action returns an error if member-file persistence fails. | None material in this handoff. | `app/(portal)/health/mar/actions-impl.ts`; `lib/services/member-files.ts` |
| Lifecycle milestones | Notifications / alerts generated | Partial | A shared notification pipeline exists, event types are mapped, and critical action-required flows can queue follow-up work. | Many milestone callers ignore notification delivery failure, so inbox alerts can be missing while the underlying workflow still succeeds. | `lib/services/lifecycle-milestones.ts`; `lib/services/notifications.ts`; enrollment/POF/care-plan/MAR callsites |

## 3. Critical Failures

1. Notification delivery is not operationally guaranteed.
Why it matters: staff can miss the inbox alert even when the underlying workflow changed state correctly.
Root cause: `recordWorkflowMilestone` catches notification failures and returns `{ delivered: false }`, but many callsites only log that result or ignore it.
Exact files:
- `lib/services/lifecycle-milestones.ts`
- `lib/services/enrollment-packets-send-runtime.ts`
- `lib/services/pof-post-sign-runtime.ts`
- `lib/services/care-plan-esign.ts`
- `lib/services/care-plan-esign-public.ts`
- `lib/services/mar-workflow.ts`

2. Enrollment packet send and completion do not atomically update the sales lead timeline.
Why it matters: admins can see a sent or filed packet in the enrollment flow while the sales activity log still looks incomplete.
Root cause: `lead_activities` is written by a follow-up helper after the packet write succeeds, and failures are queued rather than rolled back.
Exact files:
- `lib/services/enrollment-packets-send-runtime.ts`
- `lib/services/enrollment-packets-public-runtime.ts`
- `lib/services/enrollment-packet-mapping-runtime.ts`

3. Signed POF can finish while downstream clinical sync is only queued.
Why it matters: a nurse may treat the provider signature as fully complete, but MHP and MAR can still be behind.
Root cause: post-sign sync is intentionally best-effort after the signed artifact is committed.
Exact files:
- `lib/services/pof-esign-public.ts`
- `lib/services/pof-post-sign-runtime.ts`
- `lib/services/physician-orders-supabase.ts`

4. The reported Care Plan -> MAR sequence is not a real write dependency.
Why it matters: it can hide the actual operational rule, which is that MAR readiness depends on signed POF medication sync, not care plan completion.
Root cause: business-process ordering and data dependency are being conflated.
Exact files:
- `lib/services/physician-orders-supabase.ts`
- `lib/services/mar-workflow.ts`

## 4. Canonicality Risks Found During Simulation

- I did not find production-path mock persistence, localStorage persistence, or fake in-memory write fallbacks in the lifecycle paths I reviewed.
- Lead/member identity handling is mostly strong in the current runtime. Enrollment packet send, member-file persistence, lead conversion, and intake all use canonical resolvers or canonical member enforcement.
- The main canonicality weakness is delayed follow-up work. The canonical record is often correct, but the next canonical consumer may not be updated yet.
- The workflow audit skill config is stale and still points at older enrollment packet service paths. That inflated some false “broken” findings in the raw static report. This is an audit-tool accuracy issue, not a runtime persistence issue.

## 5. Schema / Runtime Risks Exposed by Workflow

- The key RPC-backed workflow functions are present in migrations:
  - `rpc_prepare_enrollment_packet_request`
  - `rpc_save_enrollment_packet_progress`
  - `rpc_finalize_enrollment_packet_submission`
  - `rpc_upsert_care_plan_core`
  - `rpc_record_care_plan_snapshot`
  - `rpc_prepare_care_plan_caregiver_request`
  - `rpc_transition_care_plan_caregiver_status`
  - `rpc_finalize_care_plan_caregiver_signature`
  - `rpc_finalize_pof_signature`
- Runtime safety still depends on those migrations being deployed and PostgREST schema cache being current. Several services explicitly throw migration-specific errors if the RPC is missing.
- Notification schema drift would be easy to miss operationally because notification failure usually does not block the main workflow.
- The audit runner/reference file should be updated to current runtime services, otherwise weekly audit noise will keep overstating enrollment packet and care plan breakage.

## 6. Document / Notification / File Persistence Findings

Document and file persistence that looks strong:

- Enrollment packet completion saves a signature artifact, uploaded documents, and the completed packet artifact before final filing logic runs.
- Intake saves the generated assessment PDF to `member_files` and returns an explicit error if that save fails.
- POF signing saves the provider signature image, final signed PDF, and member file through `rpc_finalize_pof_signature`.
- Care plan caregiver signing generates the final PDF, uploads storage artifacts, and finalizes the signed member file through `rpc_finalize_care_plan_caregiver_signature`.
- Monthly MAR PDF generation returns an error if `saveGeneratedMemberPdfToFiles` fails, so it does not pretend the report was saved when it was not.

Notification and alert weaknesses:

- Enrollment, POF, care plan, and MAR all emit milestone events, but many of those calls are wrapped in `try/catch` blocks that only log failures.
- The stronger pattern is the action-required helper path, which both notifies and queues follow-up when delivery fails. That pattern is not used everywhere.

## 7. Fix First

1. Move enrollment packet -> `lead_activities` into a transaction-backed or RPC-backed canonical write path.
Reason: this is the clearest real-world drift between true enrollment state and what staff see next.

2. Decide whether signed POF should remain “success with queued sync” or become “not fully complete until MHP/MAR sync finishes.”
Reason: this directly affects nursing trust in the POF-to-MAR handoff.

3. Harden critical notifications so delivery failure is visible to staff, not only logged.
Reason: missing alerts are operational failures even when the underlying record is real.

4. Update the workflow audit skill reference file to current service entrypoints.
Reason: it will reduce false alarms and make future weekly audits more trustworthy.

5. Rewrite the lifecycle documentation so MAR is described as downstream of signed POF, not downstream of care plan.
Reason: it matches the actual source of truth and avoids misleading handoff assumptions.

## 8. Regression Checklist

1. Send an enrollment packet from a lead and verify rows in `enrollment_packet_requests`, `enrollment_packet_events`, and `lead_activities`.
2. Complete the packet from the public link and verify `enrollment_packet_fields`, `enrollment_packet_signatures`, uploaded member files, and completed packet artifact persistence.
3. Force a lead-activity insert failure and verify the follow-up queue/alert is created instead of silently losing the activity.
4. Convert the lead to a member and verify a single canonical `members.source_lead_id` link is preserved.
5. Create and sign an intake assessment and verify the assessment rows, signature rows, intake PDF member file, and explicit error behavior if draft POF creation fails.
6. Send and sign a POF and verify the signed PDF member file plus the returned `postSignStatus`. Confirm staff can tell the difference between `synced` and `queued`.
7. Verify a signed POF updates MHP and creates MAR schedules for the same member.
8. Create, review, sign, send, and caregiver-sign a care plan. Confirm version history, review history, signature events, and final signed member file all persist.
9. Document MAR doses for given, not-given, PRN effective, and PRN ineffective paths. Confirm alert generation for not-given doses.
10. Generate the monthly MAR PDF and verify it saves to `member_files` and appears in member-facing file surfaces.
11. Break notification recipient resolution or notification writes in a test environment and confirm which workflows still succeed without inbox alerts.
