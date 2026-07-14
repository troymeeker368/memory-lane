# Workflow Simulation Audit Report
_Generated: 2026-05-07 EDT_
_Scope: static code-path audit plus manual verification of canonical service paths. Live E2E checks were not run because the available scripts create real Supabase and email side effects._

## 1. Executive Summary

Overall lifecycle health is **Partial**.

The good news is that I did **not** find mock runtime persistence, local-only storage, or fake fallback records in the audited production lifecycle. The important write paths are mostly real and Supabase-backed.

The main operational risk is different: several workflows can be **durably committed** while downstream readiness is still queued, degraded, or awaiting manual follow-up. That is better than fake success, but it is still dangerous if staff read “saved” as “ready for nurses/admins/caregivers.”

The three highest-risk truths from this pass are:

1. A signed POF can still leave MHP, MCC, and MAR sync queued, but the success notification currently says the clinical documents are ready.
2. Enrollment Packet completion does not naturally hand off into member conversion. The system logs packet completion, but formal conversion still depends on a separate action path.
3. Care Plan completion is not the canonical trigger for MAR readiness. Signed POF clinical sync is.

Current workspace changes improve read visibility in one area: the Member Command Center index now uses the privileged canonical read path, which should reduce false “missing member” visibility on the list page. That improves visibility, but it does not remove the lifecycle gaps above.

## 2. Lifecycle Handoff Table

| Lifecycle handoff | Status | What is working | Main risk |
|---|---|---|---|
| Lead -> Send Enrollment Packet | Partial | Canonical send path persists packet request/event rows and resolves canonical identity first. | Packet send can create an inactive canonical member row before formal lead conversion, so the write root starts earlier than many staff would expect. |
| Send Enrollment Packet -> Enrollment Packet completion / e-sign return | Partial | Public completion flow durably finalizes packet data, signatures, uploads, and filed artifacts. | Packet can be completed/filed while completion follow-up is still pending or action-required. |
| Enrollment Packet completion / e-sign return -> Lead activity logging | Partial | Completion tries to write the lead activity through the shared mapping runtime. | If the lead activity insert fails, the packet stays committed and the activity is queued for repair instead of blocking completion. |
| Lead activity logging -> Member creation / enrollment resolution | Weak | Formal member conversion exists and is canonical. | Packet-completion activity does not itself trigger conversion; conversion still relies on a separate enrollment action path. |
| Member creation / enrollment resolution -> Intake Assessment | Partial | Lead conversion is RPC-backed and migration-guarded to provision core shells. | Intake can still be committed with signature follow-up needed, so “assessment created” is not always “intake operationally complete.” |
| Intake Assessment -> Physician Orders / POF generation | Partial | Draft POF creation is RPC-backed and tied to the signed intake. | Draft POF can commit but fail immediate readback verification, leaving follow-up-needed truth instead of ready truth. |
| Physician Orders / POF generation -> Provider signature completion | Strong | Request, signature, signed PDF, member-file link, and replay-safe finalization are all canonical. | Main remaining risk is downstream readiness after signature, not the signature commit itself. |
| Provider signature completion -> Member Health Profile (MHP) generation / sync | Partial | Signed POF artifact persistence is durable and identity-safe. | Downstream MHP/MCC/MAR sync can still be queued after signature. |
| MHP generation / sync -> Member Command Center (MCC) visibility | Partial | MHP and MCC reads re-resolve canonical member identity. | MCC/MHP reads hard-fail if shell rows are missing; “POF signed” and “MCC visible” are not the same truth boundary. |
| MCC visibility -> Care Plan creation and signature workflow | Partial | Care Plan create/review/sign/caregiver-sign all go through canonical services and persisted artifacts. | Action results can still be committed-but-follow-up-required, so downstream consumers must not trust `ok: true` alone. |
| Care Plan creation and signature workflow -> MAR generation from POF medications | Weak | MAR generation itself is canonical once triggered. | Care Plan is not the real trigger. Signed POF clinical sync drives MAR readiness. |
| MAR generation from POF medications -> MAR documentation workflow | Strong | Scheduled and PRN MAR documentation use canonical services/RPCs with real persistence and follow-up alerts for not-given/ineffective paths. | Main risk is staff misunderstanding upstream readiness, not the documentation write path. |
| MAR documentation workflow -> Monthly MAR summary or PDF generation | Strong | Monthly MAR report assembly reads canonical MAR/member/medication data. | This handoff is read-heavy, so the main risk is upstream data quality, not fake reporting logic. |
| Monthly MAR summary or PDF generation -> Member Files persistence | Partial | Generated PDFs are stored through the shared member-files service. | Storage upload can succeed while member-file verification is still pending, returning follow-up-needed instead of verified. |
| Member Files persistence -> Completion notifications or alerts | Weak | Failure/action-required alerts are better defended than before. | Confirmed file persistence does not consistently drive its own success notification, so inbox truth can lag behind file truth. |
| Completion notifications or alerts overall | Partial | Shared milestone pipeline, recipient resolution, and system alerts are real and Supabase-backed. | Some positive notifications still overstate readiness, especially after signed POF when downstream sync is still queued. |

## 3. Critical Failures

1. **Signed POF notifications can overstate clinical readiness.**
The signed POF path correctly preserves committed truth and can return queued/degraded readiness from [`runBestEffortCommittedPofSignatureFollowUp`](</D:/Memory Lane App/lib/services/pof-post-sign-runtime.ts:147>) and [`processSignedPhysicianOrderPostSignSync`](</D:/Memory Lane App/lib/services/physician-order-post-sign-service.ts:86>). But the success notification content still says “Clinical documents are ready for review” in [`notification-content.ts`](</D:/Memory Lane App/lib/services/notification-content.ts:106>). That is unsafe if [`pof-post-sign-runtime.ts`](</D:/Memory Lane App/lib/services/pof-post-sign-runtime.ts:168>) already recorded `post_sign_status = queued`.

2. **Enrollment Packet completion does not hand off cleanly into member conversion.**
The packet completion flow writes a lead activity with the outcome “Enrollment Packet Completed” in [`enrollment-packet-completion-cascade.ts`](</D:/Memory Lane App/lib/services/enrollment-packet-completion-cascade.ts:416>). The lead-conversion logic the sales side uses expects outcomes like “Enrollment completed” or “Member start confirmed,” per the audit trace from [`sales-lead-actions.ts`](</D:/Memory Lane App/app/sales-lead-actions.ts:406>). In practice, caregiver completion and formal member conversion are still two separate operations. That is a real operations gap for admins.

3. **Care Plan completion is not a real MAR readiness gate.**
MAR generation is driven by signed POF clinical sync through [`mar-workflow.ts`](</D:/Memory Lane App/lib/services/mar-workflow.ts:87>) and [`physician-order-post-sign-service.ts`](</D:/Memory Lane App/lib/services/physician-order-post-sign-service.ts:86>), not by Care Plan state. If staff use Care Plan completion as the signal that MAR is ready, the system does not enforce that assumption.

## 4. Canonicality Risks Found During Simulation

- I did not find mock runtime persistence, local JSON persistence, or synthetic fallback records in the audited production paths.
- Enrollment Packet send can create a canonical inactive member row before formal conversion through the canonical identity helpers. That is not fake persistence, but it does blur the lifecycle boundary between “lead” and “member” earlier than expected.
- Several action layers intentionally return `ok: true` for **committed but not operationally ready** outcomes. That pattern is acceptable only if all consumers use readiness fields rather than boolean success alone. The main examples are Intake, POF post-sign follow-up, and Care Plan post-commit follow-up.
- File persistence truth and notification truth are still not fully aligned. Member-file verification can be follow-up-needed even when the surrounding workflow emitted a positive lifecycle notification.

## 5. Schema / Runtime Risks Exposed by Workflow

- MHP and MCC reads are strict about canonical shell rows. Missing `member_health_profiles`, `member_command_centers`, or `member_attendance_schedules` do not silently backfill at read time; they fail explicitly.
- Intake creation depends on the RPC from [`0051_intake_assessment_atomic_creation_rpc.sql`](</D:/Memory Lane App/supabase/migrations/0051_intake_assessment_atomic_creation_rpc.sql>).
- Caregiver Care Plan finalization and POF signing both depend on the hardening work in [`0053_artifact_drift_replay_hardening.sql`](</D:/Memory Lane App/supabase/migrations/0053_artifact_drift_replay_hardening.sql>).
- Lead conversion shell integrity depends on [`0158_lead_conversion_shell_success_guard.sql`](</D:/Memory Lane App/supabase/migrations/0158_lead_conversion_shell_success_guard.sql>).
- Live end-to-end scripts were not run in this pass because they create real rows, storage artifacts, and email side effects. So this report is strong on code-path truth, but not a substitute for a controlled live regression run.

## 6. Document / Notification / File Persistence Findings

- Enrollment Packet artifact persistence is strong. The completion cascade repairs packet/file links and ensures a completed packet artifact exists before treating the packet as filed.
- Intake PDF persistence is strong on architecture, but not atomic on readiness. [`saveGeneratedMemberPdfToFiles`](</D:/Memory Lane App/lib/services/member-files.ts:767>) can leave verification pending, and Intake correctly downgrades to follow-up-needed instead of pretending full completion.
- Signed POF artifact persistence is strong. The public sign flow finalizes the request, signature, signed PDF, and member-file linkage before returning the post-sign outcome.
- Care Plan signed artifact persistence is strong. The caregiver-sign flow requires a committed final member file id before returning a normal signed result.
- Monthly MAR PDF persistence is only partial. [`generateMonthlyMarReportPdfAction`](</D:/Memory Lane App/app/(portal)/health/mar/actions-impl.ts:428>) correctly returns `follow-up-needed` when `member_files` verification is incomplete.
- Notification quality is mixed. Failure/action-required alerts are generally stronger than positive success notifications. The clearest remaining problem is the signed POF success message overstating readiness while downstream sync may still be queued.
- File persistence itself does not consistently emit a separate `document_uploaded` milestone in the audited POF/Care Plan/MAR document paths. That means the inbox often reflects the parent workflow milestone, not confirmed file persistence.

## 7. Fix First

1. Change signed POF notification content and any related success surfaces so they respect queued/degraded post-sign readiness instead of always implying “documents ready.”
2. Decide the real intended trigger for member conversion after Enrollment Packet completion, then either automate that handoff or make the manual boundary explicit in workflow state and staff UI.
3. Make MAR readiness language and gating explicit everywhere: signed POF clinical sync is the trigger, not Care Plan completion.
4. Audit consumers of `ok: true` in Intake, POF, and Care Plan flows and ensure readiness fields drive user-facing state, banners, and next-step logic.
5. Add a consistent document-persistence milestone only after verified `member_files` persistence for high-value generated artifacts.

## 8. Regression Checklist

1. Send an Enrollment Packet from a lead and verify canonical packet/event rows plus any early canonical member shell created by the send path.
2. Complete the packet from the public link and verify filed packet data, signatures, uploads, completed packet artifact, and any completion follow-up state.
3. Confirm packet completion either writes the lead activity immediately or creates a visible queued repair path when that insert fails.
4. Verify whether packet completion is supposed to trigger member conversion. If yes, confirm it really does; if no, confirm the manual boundary is explicit to staff.
5. Convert the lead and verify one canonical member linked by `members.source_lead_id` with required shells provisioned.
6. Submit Intake Assessment and verify assessment rows, signature state, intake PDF persistence state, and draft POF readiness state.
7. Send and complete provider POF signature, then verify both the signed artifact commit and the downstream post-sign sync status.
8. Confirm MHP, MCC, and MAR surfaces show queued/degraded truth when signed POF follow-up is still pending.
9. Create/review/sign/caregiver-sign a Care Plan and verify final artifact persistence plus post-sign readiness truth.
10. Generate a monthly MAR PDF and verify `member_files` persistence is either confirmed or explicitly returned as follow-up-needed.
11. Verify not-given MAR doses and ineffective PRN follow-ups emit action-required alerts.
12. Verify positive notifications never claim operational readiness when downstream sync or file verification is still pending.
