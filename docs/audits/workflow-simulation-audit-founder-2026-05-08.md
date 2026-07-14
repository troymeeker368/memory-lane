# Workflow Simulation Audit Report
_Generated: 2026-05-08 EDT_
_Scope: static code-path audit plus manual verification of canonical service, RPC, notification, and file-persistence paths. Live E2E checks were not run because the available flows create real Supabase rows, storage artifacts, and email side effects._

## 1. Executive Summary

Overall lifecycle health is **Partial**.

The main positive finding is that the audited production paths are still **real Supabase-backed workflows**. I did not find mock runtime persistence, fake fallback records, or local-only storage standing in for the real backend.

The main operational risk is still **truth mismatch after commit**. Memory Lane often saves the right canonical record, but staff-facing success can still mean one of three different things:

1. the core write committed and downstream sync is still queued,
2. the core write committed and file verification still needs follow-up, or
3. the workflow recorded a milestone, but the next lifecycle handoff is still manual.

Compared with the May 7, 2026 audit, one read path did improve: the Member Command Center index now uses the privileged canonical read path in [`app/(portal)/operations/member-command-center/page.tsx`](</D:/Memory Lane App/app/(portal)/operations/member-command-center/page.tsx:29>) and [`lib/services/member-command-center-detail-read-model.ts`](</D:/Memory Lane App/lib/services/member-command-center-detail-read-model.ts:334>). That should reduce false visibility failures on the list page. It does **not** remove the larger lifecycle gaps below.

The highest-risk founder-level truths from this pass are:

1. signed POF notifications can still imply readiness even when downstream clinical sync is queued;
2. Enrollment Packet completion still does not naturally convert the lead into a formally enrolled member;
3. Care Plan completion is still not the real readiness gate for MAR;
4. generated document persistence and notification milestones are still inconsistent outside the Enrollment Packet upload path.

## 2. Lifecycle Handoff Table

| Lifecycle handoff | Status | What is working | Main risk |
|---|---|---|---|
| Lead -> Send Enrollment Packet | Partial | Canonical send path persists packet request/event rows and resolves canonical identity first through [`sendEnrollmentPacketRequest`](</D:/Memory Lane App/lib/services/enrollment-packets-send-runtime.ts:280>). | Packet send still creates a canonical member row early via `ensureCanonicalMemberForLead`, before formal conversion. |
| Send Enrollment Packet -> Enrollment Packet completion / e-sign return | Partial | Public completion finalizes packet data, signatures, uploads, and filed artifacts through the RPC finalize path and completion cascade. | Packet can be durably filed while `completion_follow_up_status` is still `pending` or `action_required` in [`lib/services/enrollment-packets-public-runtime-cascade.ts`](</D:/Memory Lane App/lib/services/enrollment-packets-public-runtime-cascade.ts:243>). |
| Enrollment Packet completion / e-sign return -> Lead activity logging | Partial | Completion tries to write the lead activity through the shared mapping runtime in [`runEnrollmentPacketCompletionCascade`](</D:/Memory Lane App/lib/services/enrollment-packet-completion-cascade.ts:335>). | If lead activity insert fails, the packet stays committed and the activity is queued or left for repair instead of blocking completion. |
| Lead activity logging -> Member creation / enrollment resolution | Weak | Formal conversion exists and is canonical through [`enrollMemberFromLeadAction`](</D:/Memory Lane App/app/sales-lead-actions.ts:410>) and `rpc_convert_lead_to_member`. | The packet completion activity outcome is `"Enrollment Packet Completed"`, but automatic conversion logic listens for `"Enrollment completed"` or `"Member start confirmed"` in [`lib/services/sales-lead-activities.ts`](</D:/Memory Lane App/lib/services/sales-lead-activities.ts:181>). |
| Member creation / enrollment resolution -> Intake Assessment | Partial | Lead conversion is RPC-backed and intake creation is RPC-backed. | Intake can still return committed truth with follow-up-required readiness in [`app/intake-actions.ts`](</D:/Memory Lane App/app/intake-actions.ts:341>). |
| Intake Assessment -> Physician Orders / POF generation | Partial | Draft POF creation is canonical and RPC-backed through [`rpc_create_draft_physician_order_from_intake`](</D:/Memory Lane App/lib/services/physician-orders-supabase.ts:41>) and [`autoCreateDraftPhysicianOrderFromIntake`](</D:/Memory Lane App/lib/services/intake-pof-mhp-cascade.ts:380>). | The draft can commit but immediate readback can still fail, returning a committed follow-up warning in [`app/(portal)/health/assessment/[assessmentId]/actions.ts`](</D:/Memory Lane App/app/(portal)/health/assessment/[assessmentId]/actions.ts:333>). |
| Physician Orders / POF generation -> Provider signature completion | Strong | Request, signature, signed PDF, request replay safety, and member-file linkage are canonical in [`lib/services/pof-esign-public.ts`](</D:/Memory Lane App/lib/services/pof-esign-public.ts:328>). | The remaining risk is not signature persistence; it is downstream readiness after signature. |
| Provider signature completion -> MHP generation / sync | Partial | Signed POF artifact persistence is durable and post-sign follow-up truth is explicit via [`runBestEffortCommittedPofSignatureFollowUp`](</D:/Memory Lane App/lib/services/pof-post-sign-runtime.ts:147>). | Post-sign sync can still be queued in `pof_post_sign_sync_queue`, so signed does not always mean clinically synced. |
| MHP generation / sync -> MCC visibility | Partial | MCC index visibility improved through privileged reads. Identity resolution remains canonical on both MHP and MCC. | MCC and MHP detail paths still fail hard when canonical shell rows are missing in [`lib/services/member-command-center-runtime.ts`](</D:/Memory Lane App/lib/services/member-command-center-runtime.ts:516>) and [`lib/services/member-health-profiles-supabase.ts`](</D:/Memory Lane App/lib/services/member-health-profiles-supabase.ts:622>). |
| MCC visibility -> Care Plan creation and signature workflow | Partial | Care Plan create/review/sign/caregiver-sign remain canonical and persisted. | Action layers still return `ok: true` for committed-but-follow-up-required states in [`app/care-plan-actions.ts`](</D:/Memory Lane App/app/care-plan-actions.ts:268>). |
| Care Plan creation and signature workflow -> MAR generation from POF meds | Weak | MAR generation itself is canonical once triggered. | Care Plan is not the real trigger. Signed POF clinical sync drives MAR readiness. |
| MAR generation from POF meds -> MAR documentation workflow | Strong | Scheduled and PRN MAR documentation use canonical services and RPC-backed writes. | Main remaining risk is upstream readiness confusion, not MAR write-path integrity. |
| MAR documentation workflow -> Monthly MAR summary or PDF generation | Strong | Monthly MAR report assembly reads canonical MAR, member, and medication data. | Main risk is upstream data quality, not fake report generation. |
| Monthly MAR summary or PDF generation -> Member Files persistence | Partial | Generated MAR PDFs are stored through the shared member-files service. | The action now correctly returns `follow-up-needed` when `member_files` verification is incomplete in [`app/(portal)/health/mar/actions-impl.ts`](</D:/Memory Lane App/app/(portal)/health/mar/actions-impl.ts:487>). |
| Member Files persistence -> Completion notifications or alerts | Weak | Failure and action-required alerts are real and Supabase-backed. | Generated file success does not consistently emit its own `document_uploaded` milestone outside the Enrollment Packet upload path. |

## 3. Critical Failures

1. **Signed POF notifications can overstate readiness.**  
   The post-sign service correctly preserves queued truth through [`lib/services/pof-post-sign-runtime.ts`](</D:/Memory Lane App/lib/services/pof-post-sign-runtime.ts:168>) and [`lib/services/physician-order-post-sign-service.ts`](</D:/Memory Lane App/lib/services/physician-order-post-sign-service.ts:171>), but the notification copy still says “Clinical documents are ready for review” in [`lib/services/notification-content.ts`](</D:/Memory Lane App/lib/services/notification-content.ts:106>). That is unsafe when `post_sign_status` is still `queued`.

2. **Enrollment Packet completion still does not hand off cleanly into formal member conversion.**  
   Packet completion records `"Enrollment Packet Completed"` in [`lib/services/enrollment-packet-completion-cascade.ts`](</D:/Memory Lane App/lib/services/enrollment-packet-completion-cascade.ts:326>), but conversion logic treats `"Enrollment completed"` or `"Member start confirmed"` as conversion outcomes in [`lib/services/sales-lead-activities.ts`](</D:/Memory Lane App/lib/services/sales-lead-activities.ts:181>). Staff can therefore believe enrollment is finished while formal member conversion is still a separate step.

3. **Care Plan completion is still not the canonical MAR readiness gate.**  
   MAR readiness comes from signed POF medication sync, not from Care Plan state. If staff use Care Plan completion as the signal that MAR is ready, the system does not enforce that assumption.

4. **Generated document milestones are still uneven across workflows.**  
   Enrollment Packet uploads emit `document_uploaded` milestones in [`lib/services/enrollment-packets-public-runtime-cascade.ts`](</D:/Memory Lane App/lib/services/enrollment-packets-public-runtime-cascade.ts:187>), but generated POF/Care Plan/MAR file persistence relies mainly on member-file verification and parent workflow milestones, not a dedicated file-success milestone.

## 4. Canonicality Risks

- I did not find runtime mock persistence, local JSON persistence, or fake fallback records in the audited lifecycle.
- Enrollment Packet send still creates a canonical member row before formal lead conversion. That is real persistence, but it blurs the operational boundary between lead and member.
- Intake, Care Plan, and lead-activity actions still use committed-success patterns where `ok: true` can coexist with follow-up-required readiness. That is acceptable only if every caller respects readiness fields, not the boolean alone.
- Member identity protection is generally strong in the audited slices. I did not find a new direct lead/member mix-up bug in today’s pass.

## 5. Schema / Runtime Risks

- MHP and MCC detail reads still depend on canonical shell rows already existing. Missing `member_health_profiles`, `member_command_centers`, or `member_attendance_schedules` fail explicitly rather than silently backfilling.
- Intake creation still depends on the RPC in [`0051_intake_assessment_atomic_creation_rpc.sql`](</D:/Memory Lane App/supabase/migrations/0051_intake_assessment_atomic_creation_rpc.sql:1>).
- Draft POF creation still depends on [`0055_intake_draft_pof_atomic_creation.sql`](</D:/Memory Lane App/supabase/migrations/0055_intake_draft_pof_atomic_creation.sql:1>) and later hardening in [`0181_physician_order_save_rpc_atomicity.sql`](</D:/Memory Lane App/supabase/migrations/0181_physician_order_save_rpc_atomicity.sql:1>).
- Signed POF downstream sync still depends on [`0155_signed_pof_post_sign_sync_rpc_consolidation.sql`](</D:/Memory Lane App/supabase/migrations/0155_signed_pof_post_sign_sync_rpc_consolidation.sql:1>).
- Live end-to-end checks were not run in this pass because they would create real operational side effects in Supabase and email delivery.

## 6. Document / Notification / File Persistence Findings

- Enrollment Packet artifact persistence is strong. The completion cascade repairs upload-to-member-file links and ensures a completed packet artifact exists before treating the packet as operationally filed.
- Intake PDF persistence is architecturally strong but readiness-aware, not all-or-nothing. If `member_files` verification is incomplete, the workflow returns committed follow-up truth instead of pretending it is fully done.
- Signed POF artifact persistence is strong and replay-safe. The weak point is downstream messaging after artifact commit.
- Care Plan caregiver signature persistence is strong because the public finalization RPC requires a real final member file id before normal completion.
- MAR monthly PDF persistence has improved operational honesty. It now returns `follow-up-needed` instead of a false success when member-file verification is incomplete.
- Notification delivery plumbing is stronger than the message content. [`recordWorkflowMilestone`](</D:/Memory Lane App/lib/services/lifecycle-milestones.ts:114>) now explicitly flags missing notification delivery for core workflow events, but some positive messages still overstate readiness.

## 7. Fix First

1. Change signed POF notification content and any related banners so queued post-sign sync never reads like “documents ready.”
2. Decide whether Enrollment Packet completion should automatically convert the lead. Then either wire that handoff canonically or make the manual boundary explicit in UI/state.
3. Make MAR readiness language explicit everywhere: signed POF clinical sync is the readiness gate, not Care Plan completion.
4. Add a consistent generated-document success milestone only after verified `member_files` persistence for high-value artifacts such as signed POFs, signed Care Plans, and MAR PDFs.
5. Audit all UI consumers that rely on `ok: true` for Intake, Care Plan, and lead-activity flows, and make sure they also respect readiness / follow-up fields.

## 8. Regression Checklist

1. Send an Enrollment Packet and verify packet/event rows, plus any early canonical member shell created by the send path.
2. Complete the packet from the public link and verify completed packet artifact, uploads, signatures, mapping status, and `completion_follow_up_status`.
3. Confirm packet completion either writes the lead activity immediately or leaves a visible repair path.
4. Confirm whether packet completion is supposed to trigger formal member conversion. If yes, verify it; if no, make the manual boundary obvious to staff.
5. Convert the lead and verify one canonical member linked by `members.source_lead_id` with MCC, attendance, and MHP shells provisioned.
6. Submit Intake Assessment and verify assessment rows, signature state, intake PDF persistence state, and draft POF readiness state.
7. Complete POF provider signature and verify both durable artifact persistence and downstream post-sign sync status.
8. Confirm MHP, MCC, and MAR surfaces show queued/degraded truth when signed-POF follow-up is still pending.
9. Create, review, sign, and caregiver-sign a Care Plan and verify final artifact persistence plus post-sign readiness truth.
10. Generate a monthly MAR PDF and verify `member_files` persistence is either confirmed or explicitly returned as follow-up-needed.
11. Verify not-given MAR doses and ineffective PRN follow-ups emit action-required alerts.
12. Verify positive notifications never claim operational readiness when downstream sync or file verification is still pending.
