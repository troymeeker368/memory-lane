# Workflow Simulation Audit Report
Generated: 2026-03-21
Repository: D:\Memory Lane App
Method: static code audit of real UI -> action/route -> service -> Supabase paths
Live checks: not run, because the available live scripts would mutate the configured Supabase environment

## 1. Executive Summary

Overall workflow health: Partial

Founder summary:
- The core platform lifecycle is mostly wired to real Supabase tables and real service boundaries.
- The biggest operational weakness is still enrollment packet completion. A packet can be filed and look done before every downstream contact, payor, MCC, and MHP handoff is durably finished.
- Intake, POF signing, care plans, MAR documentation, and monthly MAR file persistence are materially stronger than earlier audits, but two workflow truths are still softer than they should be:
  - enrollment packet submission hides downstream sync state from the caller
  - notifications are best-effort and do not block success when `user_notifications` creation fails

Top operational blockers:
1. Enrollment packet filing can return success before downstream mapping is fully durable.
2. Enrollment packet contact and payor writes still happen outside the main conversion RPC.
3. Signed intake can complete before draft POF creation and intake PDF persistence are durably repaired.
4. Signed POF completion can legally finish while MHP and MAR downstream sync is only queued.
5. Workflow notifications are observable but not guaranteed delivery.

Strongest handoffs:
- Lead -> Send Enrollment Packet
- Lead activity logging -> Member creation / enrollment resolution
- Physician Orders / POF generation -> Provider signature completion
- MAR generation -> MAR documentation workflow
- Monthly MAR summary / PDF generation -> Member Files persistence

## 2. Lifecycle Handoff Table

| Handoff | Status | What the code is doing now | Exact files / functions | Risk summary | Required fix |
|---|---|---|---|---|---|
| Lead -> Send Enrollment Packet | Strong | Packet request, packet event, delivery state, workflow event, workflow milestone, and lead activity are all routed through shared services and Supabase-backed persistence. | `lib/services/enrollment-packets.ts` -> `sendEnrollmentPacketRequest`, `insertPacketEvent`, `addLeadActivity`; `app/sales-enrollment-actions.ts` -> `sendEnrollmentPacketAction` | Main write path is canonical. Residual risk is that lead activity is appended after delivery succeeds, so a late failure would affect sales visibility more than caregiver delivery. | Keep current path. Add regression coverage around post-send lead activity failure handling. |
| Send Enrollment Packet -> Enrollment Packet completion / e-sign return | Weak | The public flow saves packet fields, signatures, uploads, member files, and final filing state, but downstream mapping starts only after filing succeeds. | `app/sign/enrollment-packet/[token]/actions.ts` -> `submitPublicEnrollmentPacketAction`; `lib/services/enrollment-packets.ts` -> `savePublicEnrollmentPacketProgress`, `submitPublicEnrollmentPacket`; `supabase/migrations/0076_rpc_returns_table_ambiguity_hardening.sql` -> `rpc_finalize_enrollment_packet_submission` | The packet can be filed before downstream operational data is fully ready. Staff can treat a filed packet as done when MCC/MHP/contact/payor handoff is still pending or failed. | Return real downstream state to the caller and stop treating filed-only as operationally ready. |
| Enrollment Packet completion / e-sign return -> Lead activity logging | Partial | Lead activity is attempted after packet filing. If that write fails, the service records an alert and action-required follow-up instead of rolling back filing. | `lib/services/enrollment-packets.ts` -> `submitPublicEnrollmentPacket`, `addLeadActivity`, `recordEnrollmentPacketActionRequired` | Sales follow-up can drift from the actual filed packet state. This is repairable, but still manual. | Keep the alert path, but add a durable retry or repair queue for missed lead activities. |
| Lead activity logging -> Member creation / enrollment resolution | Strong | Member conversion is grounded in canonical lead/member identity resolution and shared member identity services. | `app/sales-lead-actions.ts` -> `enrollMemberFromLeadAction`; `lib/services/canonical-person-ref.ts` -> `resolveCanonicalPersonRef`, `resolveCanonicalMemberRef`, `resolveCanonicalLeadRef` | No new lead/member split-brain risk was found in this handoff. | Keep current path. Maintain regression coverage around `source_lead_id` linkage. |
| Member creation / enrollment resolution -> Intake Assessment | Partial | Intake creation and nurse/admin signature are canonical, but draft POF creation and intake PDF persistence happen afterward in separate follow-up steps. | `app/intake-actions.ts` -> `createAssessmentAction`; `lib/services/intake-pof-mhp-cascade.ts` -> `createIntakeAssessmentWithResponses`, `autoCreateDraftPhysicianOrderFromIntake`; `lib/services/member-files.ts` -> `saveGeneratedMemberPdfToFiles` | A legally signed intake can exist while its draft POF or member-file PDF still needs repair. The action returns an explicit error, but the recovery path is still operationally manual. | Add durable retry ownership for draft POF creation and intake PDF persistence failures. |
| Intake Assessment -> Physician Orders / POF generation | Partial | Intake explicitly attempts draft POF creation after signature and records failed draft status when the follow-up does not finish. | `app/intake-actions.ts` -> `createAssessmentAction`; `lib/services/intake-pof-mhp-cascade.ts` -> `autoCreateDraftPhysicianOrderFromIntake`; `lib/services/physician-orders-supabase.ts` -> `createDraftPhysicianOrderFromAssessment` | Better than silent failure, but still not fully durable because the intake step can finish before the next clinical artifact is available. | Keep the explicit failure state, then move to a durable retry queue or action-required workflow. |
| Physician Orders / POF generation -> Provider signature completion | Strong | Public provider signing uses replay-safe RPC finalization, persists signed artifacts to `member_files`, records signature rows and document events, and rejects request/member mismatches. | `lib/services/pof-esign.ts` -> `submitPublicPofSignature`; `supabase/migrations/0053_artifact_drift_replay_hardening.sql` -> `rpc_finalize_pof_signature` | This is one of the strongest clinical handoffs in the repo right now. | Keep current path and keep replay/idempotency coverage in place. |
| Provider signature completion -> Member Health Profile (MHP) generation / sync | Partial | Signed POF completion triggers post-sign sync through shared services, but the downstream sync may be queued for retry after the legal signature is already complete. | `lib/services/pof-esign.ts` -> `runBestEffortCommittedPofSignatureFollowUp`; `lib/services/physician-orders-supabase.ts` -> `processSignedPhysicianOrderPostSignSync`, `syncMemberHealthProfileFromSignedPhysicianOrder` | Nurses can have a valid signed POF while MHP and MAR downstream surfaces are still catching up. The queue is good, but the immediate caller is not told that truth. | Return post-sign sync status from the public signing boundary and surface queued follow-up clearly in staff UX. |
| MHP generation / sync -> Member Command Center (MCC) visibility | Strong | MCC detail and supporting profile/schedule/contact rows are read through shared MCC services, and the recent schema-fallback branch was removed in a separate production-readiness pass. | `lib/services/enrollment-packet-intake-mapping.ts` -> `mapEnrollmentPacketToDownstream`; `lib/services/member-command-center-supabase.ts` -> `getMemberCommandCenterDetailSupabase`, `ensureMemberCommandCenterProfileSupabase`, `ensureMemberAttendanceScheduleSupabase` | Once downstream sync completes, the read side is now closer to canonical and fail-fast behavior. | Keep current path and continue rejecting reduced-schema fallback reads. |
| Member Command Center (MCC) visibility -> Care Plan creation / signature workflow | Strong | Care plans are created, reviewed, signed, and caregiver-e-signed through shared care-plan services with signature events and member-file persistence. | `app/care-plan-actions.ts`; `app/sign/care-plan/[token]/actions.ts`; `lib/services/care-plans-supabase.ts` -> `createCarePlan`, `reviewCarePlan`, `signCarePlanAsNurseAdmin`; `lib/services/care-plan-esign.ts` -> `sendCarePlanToCaregiverForSignature`, `submitPublicCarePlanSignature` | No new fake persistence or fallback path was found in this handoff. | Keep current path. |
| Care Plan creation / signature workflow -> MAR generation from POF medications | Partial | MAR generation is wired correctly, but it is driven by signed POF medication sync, not by care plan completion itself. | `lib/services/mar-workflow.ts` -> `syncPofMedicationsFromSignedOrder`, `generateMarSchedulesForMember`; `lib/services/physician-orders-supabase.ts` -> `runPostSignSyncCascade` | Operationally the MAR path works, but this lifecycle stage is not a true direct handoff from care plans. The real trigger is signed POF. | Preserve POF as the canonical MAR trigger and do not imply care-plan completion alone generates MAR schedules. |
| MAR generation from POF medications -> MAR documentation workflow | Strong | MAR administration actions resolve canonical member identity, persist to `mar_administrations`, and emit workflow milestones for scheduled and PRN documentation. | `app/(portal)/health/mar/administration-actions.ts`; `lib/services/mar-workflow.ts` -> `documentScheduledMarAdministration`, `documentPrnMarAdministration`, `documentPrnOutcomeAssessment` | The administration write path is canonical and materially stronger after the PRN idempotency hardening work. | Keep current path. |
| MAR documentation workflow -> Monthly MAR summary or PDF generation | Strong | Monthly MAR reporting is a read-heavy shared service path that builds deterministic report output from canonical MAR data. | `app/(portal)/health/mar/actions-impl.ts` -> `generateMonthlyMarReportPdfAction`; `lib/services/mar-monthly-report.ts` -> `assembleMarMonthlyReportData`; `lib/services/mar-monthly-report-pdf.ts` -> `buildMarMonthlyReportPdfDataUrl` | No fallback reporting path was found in the scoped lifecycle. | Keep current path. |
| Monthly MAR summary or PDF generation -> Member Files persistence | Strong | Generated MAR PDFs are saved through the canonical member-file service, which resolves canonical member identity and upserts by document source. | `app/(portal)/health/mar/actions-impl.ts` -> `generateMonthlyMarReportPdfAction`; `lib/services/member-files.ts` -> `saveGeneratedMemberPdfToFiles`, `upsertMemberFileByDocumentSource` | This handoff is durable by design and avoids duplicate file rows when document source is reused. | Keep current path. |
| Completion notifications or alerts | Partial | Workflow milestones dispatch notifications through `user_notifications`, but notification failure only logs a `notification_dispatch_failed` event and does not block workflow success. | `lib/services/lifecycle-milestones.ts` -> `recordWorkflowMilestone`; `lib/services/notifications.ts` -> `dispatchNotification`, `createUserNotification`, `listUserNotificationsForUser` | Alerts are observable, but not guaranteed delivery. That is acceptable for non-blocking awareness, but not enough if a workflow depends on inbox delivery for operational completion. | Keep notifications best-effort unless a workflow truly requires guaranteed delivery, and clearly separate notification success from workflow completion. |

## 3. Critical Failures

### 1. Enrollment packet completion still has a split success boundary

Why it matters:
- A caregiver can complete the packet and staff can see it as filed even though downstream contact, payor, MCC, or MHP data is still not fully durable.
- This is the most important workflow-truth issue in the lifecycle because it can mislead admins into moving operational work forward too early.

Exact files / functions:
- `lib/services/enrollment-packets.ts` -> `submitPublicEnrollmentPacket`
- `lib/services/enrollment-packet-intake-mapping.ts` -> `mapEnrollmentPacketToDownstream`
- `supabase/migrations/0076_rpc_returns_table_ambiguity_hardening.sql`

Probable root cause:
- Packet finalization and downstream mapping are not one canonical transactional boundary.
- The mapping RPC is called with `p_contacts: []`, then contact and payor writes happen afterward in app code.

Recommended fix:
- Move contact and payor writes into the same canonical RPC boundary that owns packet-to-member downstream mapping, or use a second canonical RPC that alone is allowed to mark mapping truly completed.

### 2. Public enrollment packet submit action still hides the real downstream state

Why it matters:
- The public submit action returns plain success even though the true operational state is `filed + downstream sync pending/failed`.
- That makes the UI and callers less trustworthy than the database event stream.

Exact files / functions:
- `app/sign/enrollment-packet/[token]/actions.ts` -> `submitPublicEnrollmentPacketAction`
- `lib/services/enrollment-packets.ts` -> `submitPublicEnrollmentPacket`

Probable root cause:
- The action discards the richer service result and returns `{ ok: true }`.

Recommended fix:
- Return `packetId`, `status`, `mappingSyncStatus`, and any action-needed message from the action so staff can tell whether the packet is merely filed or truly downstream-ready.

## 4. Canonicality Risks

- Enrollment packet downstream mapping is still split between RPC-owned writes and app-owned contact/payor writes in `lib/services/enrollment-packet-intake-mapping.ts`. That is the main remaining non-canonical handoff.
- Intake follow-up is explicit but not fully canonical end-to-end. `createAssessmentAction` signs first, then separately attempts draft POF creation and intake PDF persistence.
- POF post-sign sync is on the right shared-service path, but the public success boundary is still stronger legally than operationally because MHP and MAR updates can be queued after signature completion.
- The care plan -> MAR sequence is conceptually adjacent, not causal. MAR is correctly sourced from signed POF medications, so the system should keep treating POF as the canonical trigger.
- Notifications are not a source of workflow truth. They are an awareness side effect layered on top of canonical writes.

## 5. Schema / Runtime Risks

- No missing lifecycle tables or missing migration references were found in the scoped workflow paths reviewed this run.
- Enrollment packet retry processing depends on an internal runner endpoint that requires `ENROLLMENT_PACKET_MAPPING_SYNC_SECRET` or `CRON_SECRET` in deployment: `app/api/internal/enrollment-packet-mapping-sync/route.ts`.
- POF post-sign retry processing depends on an internal runner endpoint that requires `POF_POST_SIGN_SYNC_SECRET` or `CRON_SECRET` in deployment: `app/api/internal/pof-post-sign-sync/route.ts`.
- Notification delivery depends on `user_notifications` schema being present and writable. If notification persistence fails, workflows still succeed and only observability captures the miss.
- Live end-to-end mutation checks were intentionally not run because the configured scripts target the active Supabase environment. That means this report is strong static evidence, but not a same-day live workflow execution proof.

## 6. Document / Notification / File Persistence Findings

Documents and file persistence:
- Enrollment packet signature artifacts, uploads, and completed packet files are persisted into `member_files` during packet completion through `submitPublicEnrollmentPacket`.
- Intake PDFs are saved to `member_files` through `saveGeneratedMemberPdfToFiles`, but that happens after intake signature and still needs a more durable repair workflow on failure.
- Signed POF PDFs are strongly persisted through `rpc_finalize_pof_signature`, including `pof_signatures`, `document_events`, and `member_files`.
- Care plan signature flows continue to persist signature events and member-file artifacts through shared care-plan services.
- Monthly MAR PDFs are strongly persisted to `member_files` and upserted by canonical document source.

Notifications and alerts:
- Enrollment, POF, care plan, and MAR services all call `recordWorkflowMilestone`, which is the right architectural boundary for notifications.
- If notification creation fails, `recordWorkflowMilestone` writes a `notification_dispatch_failed` workflow event instead of rolling back the core workflow.
- That means alerting is operationally visible, but not guaranteed inbox delivery.

## 7. Fix First

1. Make enrollment packet downstream mapping truly atomic.
2. Stop returning plain success from `submitPublicEnrollmentPacketAction`; return the real downstream sync state.
3. Add durable retry ownership for signed intake follow-up failures: draft POF creation and intake PDF member-file persistence.
4. Expose signed-POF post-sign sync state to the caller and the staff UI so legal signature completion is not confused with downstream clinical sync completion.
5. Keep notifications best-effort, but do not let any workflow rely on inbox delivery as proof of completion.

## 8. Regression Checklist

1. Send an enrollment packet from a lead and verify `enrollment_packet_requests`, `enrollment_packet_events`, delivery state, and `lead_activities` rows all persist.
2. Complete the packet from the public link and verify:
   - `enrollment_packet_fields`
   - `enrollment_packet_signatures`
   - `enrollment_packet_uploads`
   - completed packet artifact in `member_files`
   - returned action payload includes downstream sync truth
3. Force an enrollment downstream mapping failure and verify the packet is not presented as operationally ready without a visible action-required state.
4. Convert a lead to a member and verify `members.source_lead_id` remains the canonical link.
5. Create and sign an intake assessment and verify `intake_assessments`, `assessment_responses`, `intake_assessment_signatures`, draft POF status, and intake PDF persistence behavior.
6. Complete a provider POF signature and verify:
   - `pof_requests`
   - `pof_signatures`
   - `document_events`
   - `member_files`
   - post-sign sync status for MHP and MAR
7. Confirm signed POF updates MHP and MCC for the same member, including retry visibility when downstream sync is queued.
8. Create, review, sign, and caregiver-sign a care plan; verify signature events and final artifacts in `member_files`.
9. Verify MAR schedules are generated from signed POF medications, not from care-plan state.
10. Record scheduled and PRN MAR documentation, including effective and ineffective PRN outcome flows, and verify `mar_administrations`.
11. Generate the monthly MAR PDF and verify it is visible in Member Files for the same canonical member.
12. Simulate a notification creation failure and verify the workflow still completes but a `notification_dispatch_failed` observability event is recorded.
