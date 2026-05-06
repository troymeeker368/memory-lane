# Workflow Simulation Audit Report
_Generated: 2026-05-06 EDT_
_Scope: static code-path audit only; live E2E checks were not run because the available scripts create real Supabase and email side effects._

## 1. Executive Summary

Overall lifecycle health is **Partial**.

The good news: I did not find mock runtime persistence, local-only storage, or fake fallback records in the audited production workflow paths. The main Memory Lane lifecycle is wired through real service-layer code and real Supabase-backed writes.

The main risk is different: several important workflows can return a committed success while downstream operational readiness is still pending follow-up. That is safer than fake success, but it still creates real staff risk if the UI reads as "done" when nurses or admins should read it as "saved, but not operationally ready yet."

The two most important operational gaps are:

1. **Intake Assessment -> draft POF readiness**
   The canonical draft POF write path exists, but intake can still finish in a follow-up-needed state if draft POF creation or immediate verification fails.

2. **Signed POF -> downstream clinical readiness**
   Provider signature can commit successfully while downstream MHP, MCC, and MAR sync is queued for retry. That means the signed order may be legally signed but not yet operationally safe to rely on downstream.

I did not find a fully broken handoff in the code paths I inspected. The bigger pattern is **partial readiness being easy to misread as full completion**.

## 2. Lifecycle Handoff Table

| Handoff | Status | What I verified | Main risk |
|---|---|---|---|
| Lead -> Send Enrollment Packet | Strong | Canonical send path writes packet request/event records and uses service-layer send runtime. | Low. |
| Send Enrollment Packet -> Enrollment Packet completion / e-sign return | Strong | Public completion flow persists fields, signatures, uploads, and runs completion cascade. | Low. |
| Enrollment Packet completion / e-sign return -> Lead activity logging | Partial | Completion cascade tries strict lead-activity sync and queues follow-up if sync fails. | Sales activity can lag even when packet completion already committed. |
| Lead activity logging -> Member creation / enrollment resolution | Strong | Canonical lead/member resolver path is used for conversion and downstream member identity. | Low. |
| Member creation / enrollment resolution -> Intake Assessment | Strong | Intake action resolves canonical member and lead identity before write. | Low. |
| Intake Assessment -> Physician Orders / POF generation | Partial | Draft POF creation is real and RPC-backed, but post-sign workflow can return follow-up-needed if creation or reload verification fails. | Nurses may think intake is fully ready when draft POF still needs repair. |
| Physician Orders / POF generation -> Provider signature completion | Strong | POF send/sign flow persists request state, events, and artifacts through canonical services. | Low. |
| Provider signature completion -> MHP generation / sync | Partial | Signed POF follow-up explicitly queues retry and creates action-required alerts when downstream sync is incomplete. | MHP, MCC, and MAR can stay stale after provider signature. |
| MHP generation / sync -> MCC visibility | Strong | MCC reads canonical member/MHP/contact/schedule data through shared service paths. | Low once post-sign sync succeeds. |
| MCC visibility -> Care Plan creation / signature workflow | Strong | Care plan create/review/sign/send flows use canonical services and persisted signature artifacts. | Low. |
| Care Plan creation / signature workflow -> MAR generation from POF meds | Weak | MAR is not triggered by care plan completion; the real trigger is signed POF medication sync. | Staff can wrongly treat signed care plan as proof MAR is ready. |
| MAR generation from POF meds -> MAR documentation workflow | Strong | Scheduled and PRN documentation flows write through canonical MAR services/RPC paths. | Low. |
| MAR documentation workflow -> Monthly MAR summary or PDF generation | Strong | Report builder reads canonical MAR/member/POF data and generates deterministic PDF output. | Low. |
| Monthly MAR summary or PDF generation -> Member Files persistence | Strong | PDF save path verifies `member_files` persistence and returns follow-up-needed when verification fails. | Low. |
| Lifecycle milestones -> Notifications / alerts | Partial | Core milestone framework is real and tied to `user_notifications`, but success notifications are stronger in some stages than others. | Action-required alerts are strong; positive completion notifications are inconsistent. |

## 3. Critical Failures

### 1. Intake can be saved before draft POF readiness is fully true

Why it matters:
An intake can look complete to staff even when the draft physician order still needs follow-up. That creates a real nurse workflow gap at the exact handoff where clinical paperwork should start moving.

Evidence:
`createAssessmentAction` returns committed workflow state after post-sign processing in `app/intake-actions.ts`.
`completeIntakeAssessmentPostSignWorkflow` can queue follow-up when draft POF creation or immediate readback verification fails in `lib/services/intake-pof-mhp-cascade.ts`.
The actual draft POF write path is real and RPC-backed in `createDraftPhysicianOrderFromAssessment` in `lib/services/physician-orders-supabase.ts`.

Probable root cause:
The system is protecting atomic truth by keeping the intake write, but downstream draft POF readiness is intentionally allowed to degrade into follow-up-needed instead of rolling everything back.

Recommended fix:
Treat "follow-up-needed" as visibly incomplete in intake UI and downstream task lists. Do not let staff read that state as operationally done.

### 2. Signed POF does not guarantee immediate downstream clinical readiness

Why it matters:
After provider signature, staff may assume the signed order is ready everywhere. In reality, MHP sync, MCC visibility, and MAR generation can still be queued for retry.

Evidence:
`submitPublicPofSignatureAction` returns committed workflow state from `app/sign/pof/[token]/actions.ts`.
`runBestEffortCommittedPofSignatureFollowUp` records post-sign status and returns queued/follow-up metadata in `lib/services/pof-post-sign-runtime.ts`.
`processSignedPhysicianOrderPostSignSync` explicitly queues retry and emits action-required workflow milestones with required recipients in `lib/services/physician-order-post-sign-service.ts`.

Probable root cause:
The system favors durable signature commitment first, then retries downstream sync if later steps fail.

Recommended fix:
Show a blocking downstream-readiness banner anywhere staff depend on MHP, MCC, or MAR immediately after a POF signature.

### 3. Care plan completion is not the canonical trigger for MAR readiness

Why it matters:
If operations staff believe "care plan signed" means "MAR ready," they can move too early and document against incomplete medication schedules.

Evidence:
Signed POF follow-up drives MAR medication sync and schedule generation in `lib/services/pof-post-sign-runtime.ts` and `lib/services/physician-order-post-sign-service.ts`.
The MAR workflow reads from signed POF medication sync paths, not care plan completion paths.

Probable root cause:
This is a workflow expectation mismatch more than a persistence bug.

Recommended fix:
Product language and operational training should treat **signed POF medication sync** as the MAR readiness trigger, not care plan signature completion.

## 4. Canonicality Risks Found During Simulation

- I did **not** find runtime mock persistence, fake fallback records, or local-only storage in the audited lifecycle paths.
- Canonical identity handling is generally strong in the highest-risk writes:
  `app/intake-actions.ts`,
  `lib/services/member-files.ts`,
  `lib/services/physician-orders-supabase.ts`,
  and the enrollment packet runtime/services all resolve canonical member or lead identity before write.
- The main canonicality risk is not split-brain persistence. It is **truth signaling**:
  committed writes can coexist with follow-up-needed downstream state, and the UI has to present that honestly.
- Enrollment packet lead activity is durable enough to queue repair instead of silently losing the write, but that still means activity visibility can lag after packet completion.

## 5. Schema / Runtime Risks Exposed by Workflow

- I did not find obvious missing lifecycle tables in the paths reviewed.
- Intake -> draft POF depends on the intake draft POF RPC path used by `createDraftPhysicianOrderFromAssessment` in `lib/services/physician-orders-supabase.ts`.
  If that RPC or immediate readback fails, the workflow degrades into follow-up-needed.
- Signed POF downstream readiness depends on the retryable post-sign queue in `lib/services/physician-order-post-sign-service.ts`.
  That is safer than silent failure, but it means real operational lag is possible after signature.
- Notification truth depends on the shared milestone pipeline in `lib/services/lifecycle-milestones.ts` and `lib/services/notifications.ts`.
  Core milestone event types are explicitly treated as delivery-truth events, but later-stage success notifications are not equally comprehensive.
- Live E2E scripts exist for enrollment packet and POF signing, but I did not run them in this pass because they create real records and email side effects.

## 6. Document / Notification / File Persistence Findings

- **Enrollment Packet artifacts are strong.**
  `runEnrollmentPacketCompletionCascade` repairs member-file links, ensures a `completed_packet` artifact exists, and records the submitted milestone.
- **Intake PDF persistence is strong but not silent.**
  `completeIntakeAssessmentPostSignWorkflow` saves the generated Intake PDF through `saveGeneratedMemberPdfToFiles`; if verification fails, it queues follow-up instead of pretending success.
- **Signed POF artifact persistence is strong.**
  The public POF signing flow returns signed artifact metadata and then runs downstream readiness follow-up.
- **Care Plan signature artifact persistence is strong.**
  `submitPublicCarePlanSignature` requires a committed final member file reference before treating the caregiver-sign flow as complete.
- **Monthly MAR PDF persistence is one of the strongest paths.**
  `generateMonthlyMarReportPdfAction` saves the PDF to Member Files and returns `follow-up-needed` if `verifiedPersisted` is false.
- **Notifications are mixed.**
  Critical/action-required alerts are well-defended.
  Positive completion notifications exist for core lifecycle milestones, but later operational completions like monthly MAR PDF generation do not appear to emit an explicit user-facing success notification.

## 7. Fix First

1. Make intake follow-up-needed state impossible to confuse with full readiness.
2. Surface signed-POF downstream sync status anywhere nurses/admins rely on MHP, MCC, or MAR immediately after signature.
3. Make MAR readiness language explicit: signed POF medication sync is the trigger, not care plan completion.
4. Decide whether later-stage completions like monthly MAR PDF generation should create explicit success notifications; if yes, wire them through the shared milestone system.
5. Add regression coverage around enrollment packet lead-activity follow-up so activity lag is visible and repairable.

## 8. Regression Checklist

1. Send an enrollment packet from a lead and verify `enrollment_packet_requests` plus event rows in Supabase.
2. Complete the packet from the public link and verify signatures, uploads, completed packet artifact, and member-file linkage.
3. Confirm lead activity either writes immediately or creates a visible follow-up task when sync fails.
4. Convert the lead and verify exactly one canonical member linked by `members.source_lead_id`.
5. Submit intake assessment and verify assessment rows, signature state, intake PDF member file, and post-sign readiness state.
6. Confirm draft POF creation is either verified immediately or clearly marked follow-up-needed.
7. Send and complete provider POF signature and verify request rows, signed artifact persistence, and post-sign sync status.
8. Confirm MHP, MCC, and MAR either refresh from the signed POF or clearly show queued follow-up.
9. Create, review, sign, and caregiver-sign a care plan and verify signature events plus final member-file artifact.
10. Document scheduled and PRN MAR entries and verify given/not-given plus effective/ineffective persistence.
11. Generate monthly MAR PDF and verify it is stored in `member_files` and visible in member file surfaces.
12. Verify which lifecycle steps create success notifications and which only create failure/action-required alerts.
