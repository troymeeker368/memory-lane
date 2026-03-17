# Workflow Simulation Audit Report
_Generated: 2026-03-17_
_Repository: D:\Memory Lane App_

## 1. Executive Summary
- Overall workflow health: **Partial**
- The core lifecycle is materially stronger than the raw audit script reported. Lead conversion, intake creation, POF finalization, care plan signature filing, MAR documentation, and MAR PDF save paths are all backed by Supabase writes and canonical services.
- The biggest remaining operational risk is still **after provider signature**. The signed POF does try to sync MHP/MCC and MAR immediately, but if that downstream sync fails it moves to a retry queue that only has an internal endpoint in this repo, not an in-repo scheduler or runner. That means a real provider signature can succeed while the nurse still sees stale MHP or MAR data.
- Enrollment packet downstream mapping is no longer the older multi-write direct-service path. It now runs through the shared RPC `convert_enrollment_packet_to_member`, which is a real improvement. The remaining risk is that packet filing and downstream conversion are still two separate phases, so a packet can be fully filed while MHP/MCC/POF staging sync fails afterward.
- Intake assessment creation itself is now atomic through RPC, but the full intake lifecycle is still not atomic end-to-end. The assessment can be created and signed before auto-draft POF creation or intake PDF filing fails.
- Notification coverage is better than last run for enrollment, intake, POF, and care plan milestones, but MAR milestone events still do not map into `user_notifications`.
- Live E2E proof is still blocked locally. Both live scripts failed on 2026-03-17 with `esbuild` `EPERM spawn`, so this report is based on static simulation plus direct code verification.

## 2. Lifecycle Handoff Table
| Upstream -> Downstream | Status | Canonical write verified | Downstream read/resolver verified | Exact files/functions | What matters |
|---|---|---|---|---|---|
| Lead -> Send Enrollment Packet | Strong | `enrollment_packet_requests`, `enrollment_packet_events`, `lead_activities` | Request timelines read through packet services | `lib/services/enrollment-packets.ts` `sendEnrollmentPacketRequest`, `prepareEnrollmentPacketRequestForDelivery`, `addLeadActivity`; `app/sales-enrollment-actions.ts` `sendEnrollmentPacketAction` | Good canonical write path. Delivery failures stay explicit and retryable instead of falsely marking sent. |
| Send Enrollment Packet -> Enrollment Packet completion / e-sign return | Partial | `enrollment_packet_fields`, `enrollment_packet_signatures`, `enrollment_packet_uploads`, `member_files`, packet finalization RPC | Public context and downstream mapping service both read canonical packet rows | `lib/services/enrollment-packets.ts` `submitPublicEnrollmentPacket`, `invokeFinalizeEnrollmentPacketCompletionRpc`; `lib/services/enrollment-packet-artifacts.ts`; `lib/services/enrollment-packet-intake-mapping.ts` `mapEnrollmentPacketToDownstream` | Filing is durable, but downstream conversion can still fail after filing, leaving the packet complete while later systems stay stale. |
| Enrollment Packet completion / e-sign return -> Lead activity logging | Partial | `lead_activities` write exists | Sales activity views read `lead_activities` | `lib/services/enrollment-packets.ts` `addLeadActivity`; `lib/services/sales-crm-supabase.ts` sales activity queries | The write exists, but it is wrapped in a `try/catch` that only logs to console if it fails, so sales visibility can silently drift. |
| Lead activity logging -> Member creation / enrollment resolution | Strong | `members`, `leads`, system event log via RPC-backed conversion | MCC and member surfaces read canonical member rows | `app/sales-lead-actions.ts` `enrollMemberFromLeadAction`; `lib/services/sales-lead-conversion-supabase.ts` `applyLeadStageTransitionWithMemberUpsertSupabase`; `lib/services/canonical-person-ref.ts` | Strong canonical identity path using `members.source_lead_id` and shared resolvers. |
| Member creation / enrollment resolution -> Intake Assessment | Partial | `intake_assessments`, `assessment_responses`, `intake_assessment_signatures`, intake signature artifact | Assessment detail read model resolves canonical rows | `lib/services/intake-pof-mhp-cascade.ts` `createIntakeAssessmentWithResponses`; `lib/services/intake-assessment-esign.ts` `signIntakeAssessment`; `app/intake-actions.ts` `createAssessmentAction` | The assessment create path is now atomic, but the full action still has later failure points for signing, draft POF creation, and PDF filing. |
| Intake Assessment -> Physician Orders / POF generation | Partial | `physician_orders` draft creation is real | POF pages read canonical order rows | `lib/services/intake-pof-mhp-cascade.ts` `autoCreateDraftPhysicianOrderFromIntake`; `lib/services/physician-orders-supabase.ts` `createDraftPhysicianOrderFromAssessment`; `app/intake-actions.ts` | A signed intake can persist before draft POF creation succeeds. Staff gets an error, but the lifecycle is still split across multiple phases. |
| Physician Orders / POF generation -> Provider signature completion | Strong | `pof_requests`, `pof_signatures`, `document_events`, `member_files` | POF timeline and signed download read canonical rows | `lib/services/pof-esign.ts` `sendNewPofSignatureRequest`, `resendPofSignatureRequest`, `submitPublicPofSignature`; `supabase/migrations/0053_artifact_drift_replay_hardening.sql` `rpc_finalize_pof_signature` | Canonical send/finalize path is solid. Runtime delivery still depends on `NEXT_PUBLIC_APP_URL` and email config, but failures are explicit and replay-safe. |
| Provider signature completion -> MHP generation / sync | Partial | Signed POF finalization is durable; sync queue rows are durable when downstream sync fails | MHP page reads canonical profile rows | `lib/services/pof-esign.ts` `submitPublicPofSignature`; `lib/services/physician-orders-supabase.ts` `processSignedPhysicianOrderPostSignSync`, `retryQueuedPhysicianOrderPostSignSync`; `app/api/internal/pof-post-sign-sync/route.ts` | Immediate sync exists, but queued retries depend on an external caller hitting the internal route. No in-repo scheduler means stale clinical state can sit unresolved. |
| MHP generation / sync -> MCC visibility | Strong | MCC, attendance, contacts, and MHP writes are canonical | MCC detail uses shared Supabase resolver | `lib/services/member-command-center-supabase.ts` `getMemberCommandCenterDetailSupabase`, `ensureMemberCommandCenterProfileSupabase`, `ensureMemberAttendanceScheduleSupabase`; `app/(portal)/operations/member-command-center/[memberId]/page.tsx` | Canonical read path is intact. No fake persistence found. |
| MCC visibility -> Care Plan creation / signature workflow | Strong | `care_plans`, versions, review history, signature events, final/signed file references | Care plan summary/detail reads canonical care plan tables | `lib/services/care-plans-supabase.ts` `createCarePlan`, `reviewCarePlan`, `signCarePlanAsNurseAdmin`; `lib/services/care-plan-esign.ts` `sendCarePlanToCaregiverForSignature`, `submitPublicCarePlanSignature` | Care plan create/review/sign flows are stronger than the raw script claimed. Final caregiver filing is RPC-backed and tied to `member_files`. |
| Care Plan creation / signature workflow -> MAR generation from POF medications | Strong | `pof_medications` and `mar_schedules` are generated from POF/MHP sync, not from care plan | MAR board reads canonical MAR snapshot/views | `lib/services/physician-orders-supabase.ts` `signPhysicianOrder`, `processSignedPhysicianOrderPostSignSync`; `lib/services/mar-workflow.ts` `syncPofMedicationsFromSignedOrder`, `generateMarSchedulesForMember`, `getMarWorkflowSnapshot` | The earlier "care plan must trigger MAR" finding was a false positive. MAR is already upstream-driven from signed POF and MHP medication sync. |
| MAR generation from POF medications -> MAR documentation workflow | Strong | `mar_administrations` writes for scheduled, PRN, and PRN outcome paths | MAR board reads canonical MAR views/services | `lib/services/mar-workflow.ts` `documentScheduledMarAdministration`, `documentPrnMarAdministration`, `documentPrnOutcomeAssessment`; `app/(portal)/health/mar/actions-impl.ts` | Real Supabase persistence exists for given, not given, PRN reason, and PRN outcome. |
| MAR documentation workflow -> Monthly MAR summary or PDF generation | Strong | Canonical read-heavy report assembly from MAR tables/views | Monthly report builder reads shared report service output | `lib/services/mar-monthly-report.ts` `assembleMarMonthlyReportData`; `lib/services/mar-monthly-report-pdf.ts` `buildMarMonthlyReportPdfDataUrl`; `app/(portal)/health/mar/actions-impl.ts` | The report path is real and deterministic. This was another raw-script false positive. |
| Monthly MAR summary or PDF generation -> Member Files persistence | Partial | `member_files` write exists when `saveToMemberFiles` is selected | MCC file manager reads canonical `member_files` | `app/(portal)/health/mar/actions-impl.ts` `generateMonthlyMarReportPdfAction`; `lib/services/member-files.ts` `saveGeneratedMemberPdfToFiles`; `lib/services/member-command-center-supabase.ts` `listMemberFilesSupabase` | The save path is good, but persistence is optional in the action, so PDF generation does not always guarantee filing unless staff explicitly chooses it. |
| Completion notifications or alerts | Partial | `user_notifications` writes exist through shared notification dispatcher; system alerts also exist | Notifications inbox reads `user_notifications` | `lib/services/lifecycle-milestones.ts` `recordWorkflowMilestone`; `lib/services/notifications.ts` `dispatchNotification`; milestone emitters in enrollment, intake, POF, care plan, and MAR services | Enrollment, intake, POF, and care plan milestones are mapped. MAR milestone event names are still missing from notification canonicalization, so MAR documentation does not become inbox notifications. |

## 3. Critical Failures
- Severity: **High**
  - Title: POF post-sign retry has no in-repo scheduler
  - Why it matters: A provider can sign successfully, but MHP/MCC/MAR can stay stale if the first downstream sync attempt fails.
  - Exact files/functions: `lib/services/physician-orders-supabase.ts` `processSignedPhysicianOrderPostSignSync`, `retryQueuedPhysicianOrderPostSignSync`; `app/api/internal/pof-post-sign-sync/route.ts`
  - Probable root cause: The retry logic exists, but this repo only exposes an authenticated internal endpoint. There is no in-repo cron, worker, or runner invoking it.
  - Recommended fix: Add a real scheduled caller for `POST /api/internal/pof-post-sign-sync` with `POF_POST_SIGN_SYNC_SECRET`, and alert if queued rows age past an operational threshold.
- Severity: **High**
  - Title: Enrollment packet can be filed before downstream conversion finishes
  - Why it matters: Staff can see a completed packet while MCC, MHP, contact, or POF staging data is still missing or stale.
  - Exact files/functions: `lib/services/enrollment-packets.ts` `submitPublicEnrollmentPacket`; `lib/services/enrollment-packet-intake-mapping.ts` `mapEnrollmentPacketToDownstream`
  - Probable root cause: Packet finalization and downstream conversion are two separate phases. The conversion phase is now atomic internally, but it still runs after filing is already committed.
  - Recommended fix: Add a retryable downstream mapping runner, or move the "filed" business meaning so staff can clearly distinguish "caregiver submitted" from "all downstream sync complete."
- Severity: **High**
  - Title: Intake lifecycle still splits after atomic create
  - Why it matters: An intake can exist and even be signed while the draft POF or intake PDF save fails, which leaves clinical staff with a half-complete onboarding state.
  - Exact files/functions: `lib/services/intake-pof-mhp-cascade.ts` `createIntakeAssessmentWithResponses`; `lib/services/intake-assessment-esign.ts` `signIntakeAssessment`; `app/intake-actions.ts` `createAssessmentAction`
  - Probable root cause: Only the intake create step is atomic. Signature finalization, auto-draft POF, and intake PDF filing run afterward as separate operations.
  - Recommended fix: Decide the actual completion boundary. Either keep the steps separate but make status/reporting explicit, or move the full intake-complete cascade into a transaction/RPC-backed orchestration path.

## 4. Canonicality Risks Found During Simulation
- No runtime mock persistence or local fallback storage was found in the audited lifecycle services.
- Lead/member identity handling is strong in conversion and reporting paths because shared canonical resolvers are being used in `lib/services/canonical-person-ref.ts`.
- A quieter canonicality risk remains in enrollment packet completion. `submitPublicEnrollmentPacket` can succeed for packet filing even if the later downstream mapping phase fails, which means downstream consumers can temporarily disagree about lifecycle completeness.
- Lead activity logging after packet completion is still weaker than it should be because the failure path is swallowed with `console.error` inside `lib/services/enrollment-packets.ts`.
- Monthly MAR PDF filing is canonical when the save option is chosen, but the workflow is not inherently "generate means saved." That is a product decision risk, not a fake persistence bug.

## 5. Schema / Runtime Risks Exposed by Workflow
- The raw script reported several schema misses that are no longer real findings. `assessment_responses`, care plan signature/file columns, `document_events`, enrollment packet mapping tables, and POF signature tables are present in migrations and are being used.
- Important lifecycle hardening depends on these migrations being deployed and schema cache being current:
  - `0051_intake_assessment_atomic_creation_rpc.sql`
  - `0052_intake_assessment_signature_finalize_rpc.sql`
  - `0053_artifact_drift_replay_hardening.sql`
  - `0056_shared_rpc_orchestration_hardening.sql`
  - `0060_notification_workflow_engine.sql`
  - `0061_enrollment_packet_conversion_rpc.sql`
- Runtime dependencies still matter operationally:
  - Enrollment and POF public links depend on `NEXT_PUBLIC_APP_URL` or equivalent app URL config.
  - Enrollment packet, POF, and care plan sends depend on email configuration.
  - POF retry processing depends on `POF_POST_SIGN_SYNC_SECRET` plus an external scheduler calling the internal retry route.
- Live verification remains blocked by local tooling, not by a proven business-rule failure. On 2026-03-17 both live scripts failed with `esbuild` `TransformError`, `errno -4048`, `code EPERM`, `syscall spawn`.

## 6. Document / Notification / File Persistence Findings
- Enrollment packet completion does save the signature artifact, completed packet artifact, uploaded documents, and related `member_files` references before downstream mapping runs. Files are real; the weak point is later sync, not document persistence.
- Intake assessment signature filing is real. The signature finalize RPC persists the intake signature artifact reference, and `createAssessmentAction` separately generates and saves the intake PDF into Member Files.
- Signed POF persistence is real. `rpc_finalize_pof_signature` writes `pof_signatures`, `document_events`, and the signed POF `member_files` row.
- Care plan final signature persistence is real. `submitPublicCarePlanSignature` uses caregiver finalization RPC logic tied to `final_member_file_id`.
- MAR monthly PDF save is real when staff selects `saveToMemberFiles`, through `saveGeneratedMemberPdfToFiles`.
- Notification coverage is mixed:
  - Works: enrollment packet sent/submitted/expired/failed, intake completed, POF sent/signed/failed/expiring, care plan created/reviewed/sent/signed.
  - Missing: MAR documentation milestone event names such as `mar_administration_documented` and `mar_prn_outcome_documented` are emitted, but `lib/services/notifications.ts` does not canonicalize them into inbox notification event types.

## 7. Fix First
1. Wire a real scheduler to `app/api/internal/pof-post-sign-sync/route.ts` so signed POF retries actually clear queued downstream sync failures.
2. Separate "packet filed" from "downstream sync complete" in enrollment packet lifecycle reporting, or add a retry runner for failed mapping runs.
3. Decide whether intake completion means only "assessment saved" or "assessment saved, signed, draft POF created, and PDF filed," then enforce that boundary explicitly.
4. Add MAR event aliases to `lib/services/notifications.ts` so MAR documentation and PRN outcome milestones can reach `user_notifications`.
5. Promote enrollment packet post-completion lead-activity failure from console-only logging to a real alert or retry path.

## 8. Regression Checklist
1. Send an enrollment packet from a real lead and confirm `enrollment_packet_requests`, `enrollment_packet_events`, and a `lead_activities` row all write successfully.
2. Complete the packet from the public link and confirm `enrollment_packet_signatures`, `enrollment_packet_uploads`, completed packet `member_files`, and `enrollment_packet_mapping_runs` all persist.
3. Force a downstream enrollment mapping failure and verify staff can see that the packet is filed but mapping is incomplete.
4. Convert a lead to a member and verify there is exactly one canonical member linked by `members.source_lead_id`.
5. Submit intake assessment creation and verify `intake_assessments` and `assessment_responses` write through the atomic RPC.
6. Complete intake signature and then intentionally fail the draft POF step to confirm the UI and status messaging clearly show the partial lifecycle state.
7. Send and sign a POF, then force one downstream sync failure and verify a queue row is created and later cleared by the retry endpoint.
8. Verify signed POF data reaches MHP and MCC for the same canonical member.
9. Create, review, nurse-sign, send, and caregiver-sign a care plan; confirm signature events and final file persistence.
10. Document MAR as given, not given, PRN given, and PRN effective/ineffective; verify `mar_administrations` rows and downstream report visibility.
11. Generate a monthly MAR PDF with save enabled and confirm the PDF lands in `member_files` and shows up in MCC file surfaces.
12. Verify the notifications inbox includes enrollment, intake, POF, and care plan milestones, and confirm MAR milestones still do not appear until notification mapping is added.
