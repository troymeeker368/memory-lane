# Workflow Simulation Audit Report

Generated: 2026-04-06
Scope: static workflow simulation plus manual code review of the real lifecycle service paths
Live checks: not run this pass

## 1. Executive Summary

Overall, the audited lifecycle is **Partial**, not broken.

The good news is that the core production paths are still Supabase-backed, and this pass did **not** find mock persistence, fake runtime storage, or obvious lead/member identity shortcuts inside the audited lead -> enrollment -> member -> intake -> POF -> MHP/MCC -> care plan -> MAR flow.

The biggest real operational risk is still the same one from prior runs: a **POF can be durably signed before downstream MHP, MCC, and MAR readiness is complete**. The code does not hide that risk. It records queue state and returns degraded readiness, but nurses and admins can still be blocked in real operations until the post-sign runner catches up. The next biggest risk is similar but earlier in the lifecycle: **enrollment packet completion and intake signing can commit before all follow-up work is operationally finished**, especially downstream mapping, lead activity sync, and member-file verification.

This means the platform is generally behaving honestly, but some of the most important handoffs still depend on post-commit follow-up instead of being fully operational the moment the user sees "completed."

## 2. Lifecycle Handoff Table

| Lifecycle handoff | Status | What I verified | Why it matters |
|---|---|---|---|
| Lead -> Send Enrollment Packet | Strong | `app/sales-enrollment-actions.ts` calls `sendEnrollmentPacketAction`, which routes into `lib/services/enrollment-packets-send-runtime.ts::sendEnrollmentPacketRequest`, records packet events through `lib/services/enrollment-packet-public-helpers.ts::insertPacketEvent`, and uses `lib/services/enrollment-packet-mapping-runtime.ts::syncEnrollmentPacketLeadActivityOrQueue`. | Packet send is using a canonical Supabase path and does not rely on UI-only success. |
| Send Enrollment Packet -> Enrollment Packet completion / e-sign return | Partial | Public completion runs through `app/sign/enrollment-packet/[token]/actions.ts` into `lib/services/enrollment-packets-public-runtime.ts::submitPublicEnrollmentPacket`, then `lib/services/enrollment-packet-completion-cascade.ts::runEnrollmentPacketCompletionCascade`. That cascade repairs `member_files` links, ensures a completed-packet artifact, runs downstream mapping, and records milestone state. | The packet can be durably completed before mapping is fully operationally ready. The code surfaces readiness, but staff still need to respect that degraded state. |
| Enrollment Packet completion / e-sign return -> Lead activity logging | Partial | `lib/services/enrollment-packet-completion-cascade.ts` calls `ensureEnrollmentPacketLeadActivity`, which routes into `lib/services/enrollment-packet-mapping-runtime.ts::syncEnrollmentPacketLeadActivityOrQueue`. | Lead activity is not silently dropped, but it can still become a queued follow-up instead of an immediate same-transaction outcome. |
| Lead activity logging -> Member creation / enrollment resolution | Strong | `app/sales-lead-actions.ts::enrollMemberFromLeadAction` resolves canonical lead identity before conversion and uses canonical lead/member linkage through `lib/services/canonical-person-ref.ts`, preserving `members.source_lead_id`. | This is the core lead/member identity boundary. It looks canonical and deterministic. |
| Member creation / enrollment resolution -> Intake Assessment | Partial | `app/intake-actions.ts::createAssessmentAction` creates the assessment, then signs it through `lib/services/intake-assessment-esign.ts`, and `lib/services/intake-pof-mhp-cascade.ts` attempts both draft POF creation and intake PDF persistence through `lib/services/member-files.ts::saveGeneratedMemberPdfToFiles`. | Intake writes are canonical, but the action can return "committed but follow-up needed" if signature finalization, PDF verification, or downstream steps fail after the assessment itself is saved. |
| Intake Assessment -> Physician Orders / POF generation | Partial | The raw script called this broken, but direct code review shows `lib/services/intake-pof-mhp-cascade.ts::autoCreateDraftPhysicianOrderFromIntake` calls `lib/services/physician-orders-supabase.ts::createDraftPhysicianOrderFromAssessment`, which uses RPC `rpc_create_draft_physician_order_from_intake` from migration `0055_intake_draft_pof_atomic_creation.sql`. | Draft POF creation is real and canonical. The true risk is post-sign follow-up and immediate readback verification, not missing persistence. |
| Physician Orders / POF generation -> Provider signature completion | Strong | Send and resend paths in `lib/services/pof-esign.ts` persist request state, document events, and workflow telemetry. Public signature completion runs through `app/sign/pof/[token]/actions.ts` into `lib/services/pof-esign-public.ts`, which requires a signed PDF and `member_file_id` before returning success. | This handoff is properly guarded. Email or finalize failures do not appear to be quietly treated as success. |
| Provider signature completion -> MHP generation / sync | Partial | After signature is finalized, `lib/services/pof-post-sign-runtime.ts::runBestEffortCommittedPofSignatureFollowUp` calls `processSignedPhysicianOrderPostSignSync`. If downstream sync fails, the code records alerts and returns `postSignStatus: "queued"` with action-needed messaging instead of claiming the order is operationally ready. | This is the most important operational gap. A signed POF is durable, but MHP, MCC, and MAR can still be waiting on the retry queue. |
| MHP generation / sync -> MCC downstream visibility | Partial | MCC reads remain canonical through `lib/services/member-command-center-runtime.ts::getMemberCommandCenterDetailSupabase` and `resolveMccMemberId`. Historical shell repair has been moved into `lib/services/member-command-center-repair-supabase.ts`, which is safer than hidden runtime backfill. | Normal flows should populate MCC, but historical drift or failed upstream sync still blocks visibility until explicit repair runs. |
| MCC downstream visibility -> Care Plan creation / signature workflow | Strong | `app/care-plan-actions.ts` routes creation, review, nurse sign, and caregiver send through canonical care plan services. Public caregiver sign in `lib/services/care-plan-esign-public.ts` requires a final signed member file and records signature events. | Care plan writes look canonical and auditable. |
| Care Plan creation / signature workflow -> MAR generation from POF meds | Partial | MAR generation is not actually driven by care plan completion. The canonical trigger remains signed POF post-sign sync through `processSignedPhysicianOrderPostSignSync` and `lib/services/mar-workflow.ts::generateMarSchedulesForMember`. | This is more of a workflow dependency caveat than a bug: staff may think care plan completion drives MAR, but the real trigger is signed POF sync. |
| MAR generation from POF meds -> MAR documentation workflow | Strong | Scheduled and PRN documentation route through `app/(portal)/health/mar/actions-impl.ts` into `lib/services/mar-workflow.ts` and `lib/services/mar-prn-workflow.ts`, with canonical writes to MAR tables and repair alerts for follow-up failures. | Medication documentation is one of the stronger audited workflows this pass. |
| MAR documentation workflow -> Monthly MAR summary or PDF generation | Strong | `app/(portal)/health/mar/report-actions.ts` delegates to `app/(portal)/health/mar/actions-impl.ts`, which builds the report from canonical MAR reads and returns report metadata about partial records instead of hiding quality problems. | The monthly report path looks deterministic and honest about data quality. |
| Monthly MAR summary or PDF generation -> Member Files persistence | Strong | Monthly report save uses `lib/services/member-files.ts::saveGeneratedMemberPdfToFiles`. If file verification is not confirmed in Supabase, the action returns `ok: false` / follow-up-needed rather than pretending the file is safely stored. | This is the right production-safe pattern for generated clinical documents. |
| Completion notifications or alerts | Partial | `lib/services/lifecycle-milestones.ts::recordWorkflowMilestone` dispatches to `lib/services/notifications.ts`, which writes `user_notifications`. Notification aliases in `lib/services/notifications-runtime.ts` cover enrollment packet, intake, POF, and care plan events. If no recipients are resolved for required events, the code records follow-up alerts. | Notification plumbing exists and is real. The risk is not "no notification system"; the risk is recipient resolution gaps or follow-up-needed delivery states. |

## 3. Critical Failures

- **POF post-sign operational readiness is still the top real failure point.**
  - Durable signature completion can happen before downstream MHP, MCC, and MAR readiness is complete.
  - Evidence: `lib/services/pof-post-sign-runtime.ts::runBestEffortCommittedPofSignatureFollowUp`, `lib/services/physician-orders-supabase.ts::runCommittedPhysicianOrderPostSignSyncSafely`.
  - Operational impact: a nurse may have a legally signed order, but the downstream clinical views and medication workflow may still be waiting on queue recovery.

- **Enrollment packet and intake completion still cross a post-commit follow-up boundary.**
  - Enrollment packet completion can finish before mapping, lead activity sync, or completed-artifact verification is fully ready.
  - Intake signing can finish before draft POF creation and member-file PDF verification are fully ready.
  - Evidence: `lib/services/enrollment-packet-completion-cascade.ts`, `lib/services/intake-pof-mhp-cascade.ts`.
  - Operational impact: staff can be looking at a committed record that still needs backend follow-up before downstream operations are reliable.

- **Historical shell drift still blocks some downstream visibility.**
  - The repo is intentionally moving away from hidden runtime backfill. The current uncommitted change removes MCC backfill from hot runtime reads and moves it to `lib/services/member-command-center-repair-supabase.ts`.
  - Operational impact: this is safer architecture, but centers with historical drift still need an explicit repair pass before staff can rely on MCC completeness.

## 4. Canonicality Risks

- No mock runtime persistence was found in the audited lifecycle paths.
- No obvious UI-direct business writes were found in the audited handoffs.
- Lead/member identity handling still looks centralized through canonical resolver code, especially around lead conversion and MCC/member-file access.
- The main canonicality risk is **not** fake storage. It is **committed-but-not-operationally-ready** follow-up states:
  - enrollment packet completion follow-up
  - intake post-sign follow-up
  - signed POF post-sign sync queue
- Those follow-up states are surfaced honestly in the audited code, which is good, but they still represent real production dependency points.

## 5. Schema / Runtime Risks

- I did not find a clear schema drift problem in the audited lifecycle tables. The expected migrations for the critical flows are present, including:
  - `0055_intake_draft_pof_atomic_creation.sql`
  - `0037_shared_rpc_standardization_lead_pof.sql`
  - `0039_pof_post_sign_sync_queue.sql`
  - `0174_pof_post_sign_queue_outcome_rpc.sql`
- The raw script still produces false positives around `physician_orders` because it does not fully understand RPC-backed writes.
- I did not run live E2E checks this pass, so email delivery, storage permissions, and real queue execution were **not** validated against a running environment.
- There are still generic `catch -> ok: true` patterns elsewhere in the repo. In the audited lifecycle, the important ones usually attach explicit degraded readiness state instead of fake success, but the pattern still deserves continued review.

## 6. Document / Notification / File Persistence Findings

- **Enrollment Packet completed artifact**
  - Good: `lib/services/enrollment-packet-completion-cascade.ts` explicitly repairs upload links and ensures a `completed_packet` artifact is attached to `member_files`.
  - Risk: completion can still be committed while downstream mapping/follow-up remains pending.

- **Intake Assessment PDF**
  - Good: `lib/services/intake-pof-mhp-cascade.ts` saves the generated PDF with `saveGeneratedMemberPdfToFiles`.
  - Risk: if verification fails, the code queues `member_file_pdf_persistence` follow-up instead of claiming everything is done.

- **Signed POF artifact**
  - Good: `lib/services/pof-esign-public.ts` requires both `signed_pdf_url` and `member_file_id` before returning committed success.
  - Risk: the signed document can exist while downstream clinical sync is still queued.

- **Care Plan signed artifact**
  - Good: `lib/services/care-plan-esign-public.ts` requires `final_member_file_id` and records signature events.
  - Risk: post-sign readiness can still be follow-up-required even after the final file exists.

- **Monthly MAR PDF**
  - Good: `app/(portal)/health/mar/actions-impl.ts` returns follow-up-needed if member-file verification is not confirmed.
  - Risk: none obvious beyond storage verification failures already being surfaced honestly.

- **Notifications**
  - Good: the notification pipeline is real and canonical.
  - Risk: required milestone events can still produce zero recipients, which then creates follow-up alerts instead of inbox rows. That is safer than silent loss, but it still needs monitoring.

## 7. Fix First

1. **Treat the POF post-sign queue as a first-class operational dependency.**
   - If this queue stalls, signed orders stop being clinically usable downstream.

2. **Make follow-up-needed states harder for staff to miss.**
   - Enrollment packet, intake, POF, and care plan all have real "committed but not fully ready" cases.
   - Those states should stay visible until cleared.

3. **Keep historical shell repair explicit and monitored.**
   - The new repair-only MCC shell path is the right direction.
   - Pair it with a reliable repair runbook so historical drift does not quietly block MCC visibility.

4. **Add or maintain live regression checks for the exact risky handoffs.**
   - Packet completion
   - Intake post-sign
   - Signed POF post-sign queue
   - Monthly MAR PDF save to member files

5. **Keep auditing notification recipient resolution.**
   - The system now records follow-up alerts when notifications do not resolve recipients.
   - That is good, but it should remain visible in operations dashboards or admin review.

## 8. Regression Checklist

1. Send an enrollment packet and verify `enrollment_packet_requests` and `enrollment_packet_events` persist in Supabase.
2. Complete the packet from the public link and verify signatures, uploads, completed-packet member file, and downstream mapping status.
3. Confirm packet completion either creates the lead activity immediately or leaves an explicit queued follow-up state.
4. Convert a lead to a member and verify exactly one canonical member remains linked by `members.source_lead_id`.
5. Create and sign an intake assessment and verify the assessment rows, signature rows, and intake PDF member file.
6. Verify intake post-sign either creates a draft POF immediately or records an explicit follow-up task.
7. Send and sign a POF and verify `pof_requests`, `pof_signatures`, document events, and signed member file.
8. After POF signature, verify whether post-sign status is `synced` or `queued` and do not treat `queued` as operationally ready.
9. Confirm MHP and MCC reflect the same member identity after the signed POF sync completes.
10. Create, review, and sign a care plan; verify final signed file persistence and post-sign readiness state.
11. Verify MAR schedules and MAR board data are coming from signed POF medication sync, not from manual fallback state.
12. Document given, not-given, PRN effective, and PRN ineffective paths and verify the expected MAR tables update.
13. Generate a monthly MAR PDF and verify it lands in `member_files`; if verification is pending, confirm the action returns follow-up-needed rather than success.
14. Verify the notifications inbox receives enrollment, intake, POF, care plan, and MAR-related milestone alerts for the correct staff users.
