# Workflow Simulation Audit Report
Generated: 2026-04-10T04:20:13.0557446-04:00
Repository: D:\Memory Lane App
Mode: Static code audit with manual service-path verification

## 1. Executive Summary

Overall workflow health: `Fragile but improving`

What is working well:
- Core writes are generally going through canonical Supabase-backed services or RPC boundaries instead of UI-local fallbacks.
- The strongest areas are lead conversion, POF signature finalization, care plan caregiver signature filing, MAR documentation, and monthly MAR PDF persistence.
- Typecheck and production build both passed on April 10, 2026.

What would still break real operations:
- Intake can finish and be signed while draft POF creation is failed or still needs verification follow-up.
- POF provider signature can commit successfully while downstream MHP, MCC, and MAR sync is only queued for retry.
- Enrollment packet filing can succeed while downstream mapping, lead activity sync, or operational shell readiness still needs staff follow-up.

Important clarification from manual review:
- The raw script marked parts of the POF path as if `physician_orders` writes were missing. That is not accurate. The canonical write path does exist through [`D:\Memory Lane App\lib\services\physician-orders-supabase.ts`](D:\Memory Lane App\lib\services\physician-orders-supabase.ts) `createDraftPhysicianOrderFromAssessment` and its RPC boundary. The real risk is not missing persistence. The real risk is committed success before downstream operational readiness is restored.

Validation run:
- `npm run typecheck` passed
- `npm run build` passed
- Live E2E was not run in this automation pass

## 2. Lifecycle Handoff Table

| Upstream -> Downstream | Status | What is solid | What is weak | Exact files / functions |
|---|---|---|---|---|
| Lead -> Send Enrollment Packet | Strong | Canonical send path persists request/event activity and checks lead/member linkage before send. | Notification delivery still depends on resolved recipients. | `app/sales-enrollment-actions.ts` `sendEnrollmentPacketAction`; `lib/services/enrollment-packets-send-runtime.ts` `sendEnrollmentPacketRequest`; `lib/services/enrollment-packet-mapping-runtime.ts` `syncEnrollmentPacketLeadActivityOrQueue` |
| Send Enrollment Packet -> Enrollment Packet completion / e-sign return | Partial | Filing is replay-safe and Supabase-backed. Public submit does not rely on fake persistence. | Packet can be filed while downstream readiness still needs follow-up. Completed artifact and mapping health are handled after commit. | `app/sign/enrollment-packet/[token]/actions.ts` `submitPublicEnrollmentPacketAction`; `lib/services/enrollment-packets-public-runtime.ts` `submitPublicEnrollmentPacket`; `lib/services/enrollment-packets-public-runtime-cascade.ts` `runEnrollmentPacketCascadeAndBuildResult` |
| Enrollment Packet completion / e-sign return -> Lead activity logging | Partial | Completion cascade explicitly attempts lead activity sync and queues action-required work when blocked. | Lead activity visibility is not guaranteed before completion returns to the caregiver. | `lib/services/enrollment-packet-completion-cascade.ts` `runEnrollmentPacketCompletionCascade`; `lib/services/enrollment-packet-mapping-runtime.ts` `syncEnrollmentPacketLeadActivityOrQueue` |
| Lead activity logging -> Member creation / enrollment resolution | Strong | Canonical lead resolution and closed-won conversion enforce one member path. | None found in static review. | `app/sales-lead-actions.ts` `enrollMemberFromLeadAction`; `lib/services/canonical-person-ref.ts`; `applyClosedWonLeadConversion` via sales services |
| Member creation / enrollment resolution -> Intake Assessment | Partial | Intake assessment creation uses canonical RPC-backed persistence and explicit canonical lead/member checks. | The intake PDF can still fail to persist to member files after the assessment itself is committed. | `app/intake-actions.ts` `createAssessmentAction`; `lib/services/intake-pof-mhp-cascade.ts` `createIntakeAssessmentWithResponses`; `lib/services/member-files.ts` `saveGeneratedMemberPdfToFiles` |
| Intake Assessment -> Physician Orders / POF generation | Weak | Canonical draft POF creation exists through Supabase RPC and uses the signed intake as input. | Intake can still return committed success while draft POF creation failed or requires manual verification follow-up. This is a real nurse-facing workflow break. | `lib/services/intake-pof-mhp-cascade.ts` `autoCreateDraftPhysicianOrderFromIntake`, `completeIntakeAssessmentPostSignWorkflow`; `lib/services/physician-orders-supabase.ts` `createDraftPhysicianOrderFromAssessment`; `app/(portal)/health/assessment/[assessmentId]/actions.ts` |
| Physician Orders / POF generation -> Provider signature completion | Strong | Public POF signature uses a finalize RPC, stores signature image and signed PDF, rotates tokens, and verifies replay safety. | None significant in static review. | `app/sign/pof/[token]/actions.ts` `submitPublicPofSignatureAction`; `lib/services/pof-esign-public.ts` `submitPublicPofSignature` |
| Provider signature completion -> Member Health Profile (MHP) generation / sync | Weak | The signed POF triggers canonical post-sign sync service code and queues retries instead of silently dropping failures. | Provider signature can be committed while MHP, MCC, and MAR follow-up is still queued. Clinical staff can have a signed POF that is not yet operationally ready. | `lib/services/pof-post-sign-runtime.ts` `runBestEffortCommittedPofSignatureFollowUp`; `lib/services/physician-order-post-sign-service.ts` `processSignedPhysicianOrderPostSignSync` |
| MHP generation / sync -> Member Command Center (MCC) visibility | Partial | MCC depends on canonical member services and downstream mapping, not local client state. | MCC visibility depends on the same post-sign and packet-mapping follow-up queues reaching completion. | `lib/services/member-command-center-supabase.ts` `getMemberCommandCenterDetailSupabase`; `lib/services/enrollment-packet-intake-mapping.ts`; `lib/services/physician-order-post-sign-service.ts` |
| MCC visibility -> Care Plan creation and signature workflow | Strong | Care plan creation, review, nurse sign, caregiver sign, and artifact persistence are all service-backed. | None significant in static review. | `app/care-plan-actions.ts`; `lib/services/care-plans-supabase.ts`; `lib/services/care-plan-esign.ts`; `lib/services/care-plan-esign-public.ts` |
| Care Plan creation / signature workflow -> MAR generation from POF medications | Partial | MAR generation is correctly tied to signed POF post-sign sync, which is the canonical trigger. | Care plan completion itself is not the canonical MAR trigger. If POF post-sign sync is queued, MAR readiness is delayed even if the care plan path looks healthy. | `lib/services/physician-order-post-sign-service.ts`; `lib/services/mar-workflow.ts` `syncPofMedicationsFromSignedOrder`, `generateMarSchedulesForMember` |
| MAR generation from POF meds -> MAR documentation workflow | Strong | Scheduled MAR documentation uses RPC-backed writes and PRN uses canonical workflow services. Not-given doses trigger follow-up notification attempts. | None significant in static review. | `app/(portal)/health/mar/actions-impl.ts`; `lib/services/mar-workflow.ts` `documentScheduledMarAdministration`; `lib/services/mar-prn-workflow.ts` |
| MAR documentation workflow -> Monthly MAR summary or PDF generation | Strong | Report generation is deterministic and sourced from canonical MAR data. | Live output quality still needs human spot checks for partial-record months. | `app/(portal)/health/mar/actions-impl.ts` `generateMonthlyMarReportPdfAction`; `lib/services/mar-monthly-report.ts`; `lib/services/mar-monthly-report-pdf.ts` |
| Monthly MAR summary or PDF generation -> Member Files persistence | Strong | The action only returns verified success when member file persistence is verified. Failed persistence is surfaced as follow-up-needed or error. | None significant in static review. | `app/(portal)/health/mar/actions-impl.ts` `generateMonthlyMarReportPdfAction`; `lib/services/member-files.ts` `saveGeneratedMemberPdfToFiles` |
| Completion notifications or alerts | Partial | Lifecycle milestone service writes `user_notifications` through a dedicated service and raises follow-up alerts when delivery fails or no recipients resolve. | Coverage is strong for key events, but real delivery still depends on active profiles and recipient resolution context. | `lib/services/lifecycle-milestones.ts` `recordWorkflowMilestone`; `lib/services/notifications.ts` `dispatchNotification`; `lib/services/notifications-runtime.ts` `resolveWorkflowRecipients` |

## 3. Critical Failures

### 1. Intake can finish while draft POF is still not operationally ready
- Severity: High
- Why it matters: A nurse can finish intake and believe the clinical handoff is done, while the draft POF either failed to create or needs manual verification before anyone should proceed downstream.
- Exact files/functions:
  - [`D:\Memory Lane App\lib\services\intake-pof-mhp-cascade.ts`](D:\Memory Lane App\lib\services\intake-pof-mhp-cascade.ts) `completeIntakeAssessmentPostSignWorkflow`
  - [`D:\Memory Lane App\lib\services\physician-orders-supabase.ts`](D:\Memory Lane App\lib\services\physician-orders-supabase.ts) `createDraftPhysicianOrderFromAssessment`
  - [`D:\Memory Lane App\app\(portal)\health\assessment\[assessmentId]\page.tsx`](D:\Memory Lane App\app\(portal)\health\assessment\[assessmentId]\page.tsx)
- Likely root cause: The core intake write is atomic, but draft POF creation is intentionally handled as a post-sign follow-up boundary. That protects the write, but it means real clinical readiness can lag behind the success response.
- Recommended fix: Keep the current canonical write path, but tighten the readiness contract so intake success is clearly treated as `committed but not ready` whenever draft POF follow-up is open. Make that state impossible to miss in nurse-facing intake and physician-order views.

### 2. Signed POF can commit while MHP, MCC, and MAR sync is still queued
- Severity: High
- Why it matters: Provider signature completion is a clinical milestone. If staff see “signed” but MHP and MAR are not yet synced, nurses can act on incomplete downstream clinical state.
- Exact files/functions:
  - [`D:\Memory Lane App\lib\services\pof-esign-public.ts`](D:\Memory Lane App\lib\services\pof-esign-public.ts) `submitPublicPofSignature`
  - [`D:\Memory Lane App\lib\services\pof-post-sign-runtime.ts`](D:\Memory Lane App\lib\services\pof-post-sign-runtime.ts) `runBestEffortCommittedPofSignatureFollowUp`
  - [`D:\Memory Lane App\lib\services\physician-order-post-sign-service.ts`](D:\Memory Lane App\lib\services\physician-order-post-sign-service.ts) `processSignedPhysicianOrderPostSignSync`
  - [`D:\Memory Lane App\app\sign\pof\[token]\page.tsx`](D:\Memory Lane App\app\sign\pof\[token]\page.tsx)
- Likely root cause: The signing boundary is durable and replay-safe, but downstream sync is intentionally best-effort with queued retries.
- Recommended fix: Preserve the queued retry model, but standardize every clinical surface on the same operational-readiness flag so “signed” never looks equivalent to “synced.”

### 3. Enrollment packet filing can succeed before downstream operational setup is ready
- Severity: High
- Why it matters: Staff can receive a completed packet while lead activity, enrollment mapping, and operational shell creation still need review. That can create false confidence during onboarding.
- Exact files/functions:
  - [`D:\Memory Lane App\lib\services\enrollment-packets-public-runtime.ts`](D:\Memory Lane App\lib\services\enrollment-packets-public-runtime.ts) `submitPublicEnrollmentPacket`
  - [`D:\Memory Lane App\lib\services\enrollment-packets-public-runtime-cascade.ts`](D:\Memory Lane App\lib\services\enrollment-packets-public-runtime-cascade.ts) `runEnrollmentPacketCascadeAndBuildResult`
  - [`D:\Memory Lane App\lib\services\enrollment-packet-completion-cascade.ts`](D:\Memory Lane App\lib\services\enrollment-packet-completion-cascade.ts) `runEnrollmentPacketCompletionCascade`
  - [`D:\Memory Lane App\app\sign\enrollment-packet\[token]\confirmation\page.tsx`](D:\Memory Lane App\app\sign\enrollment-packet\[token]\confirmation\page.tsx)
- Likely root cause: Filing is committed first, and downstream mapping/recovery work is allowed to continue after that commit.
- Recommended fix: Keep filing durable, but push the same operational-readiness state into all enrollment packet dashboards and sales follow-up queues so filed does not get read as fully operational.

## 4. Canonicality Risks

- No runtime mock persistence or local-storage fallback was found in the audited workflow paths.
- Canonical identity handling is generally strong:
  - Intake creation enforces canonical lead/member linkage before save.
  - Lead conversion resolves canonical lead identity before creating or reusing a member.
  - Member-files persistence resolves canonical member id before upload and row write.
- The biggest canonicality risk is not duplicate write paths. It is split truth between:
  - `committed`
  - `operationally ready`
- That split appears intentionally in three major boundaries:
  - enrollment packet completion
  - intake post-sign workflow
  - POF post-sign sync
- This is safer than fake success, but it still requires strict UI and dashboard discipline so staff do not mistake committed records for downstream-ready operations.

## 5. Schema / Runtime Risks

- No obvious code-to-migration drift was found in the reviewed lifecycle paths.
- The main runtime dependencies are RPC-backed. If any of these functions are missing in the linked Supabase project, the workflow will break hard:
  - intake assessment atomic create RPC
  - intake draft POF create RPC
  - finalize POF signature RPC
  - signed POF post-sign sync RPC
  - scheduled MAR administration RPC
- Manual live verification was not run against the linked Supabase project in this pass, so this audit confirms the code path, not the current live database contents.
- The repo was already dirty before this run in:
  - [`D:\Memory Lane App\lib\services\mar-reconcile.ts`](D:\Memory Lane App\lib\services\mar-reconcile.ts)
  - [`D:\Memory Lane App\lib\services\physician-order-post-sign-service.ts`](D:\Memory Lane App\lib\services\physician-order-post-sign-service.ts)
  - [`D:\Memory Lane App\scripts\quality-gates\run.cjs`](D:\Memory Lane App\scripts\quality-gates\run.cjs)
  This audit did not modify those files.

## 6. Document / Notification / File Persistence Findings

- Enrollment packet:
  - Filing is durable and replay-safe.
  - The confirmation page already tells the caregiver when staff follow-up is still needed.
  - Completed-packet artifact linkage is part of downstream recovery, not guaranteed at the instant of first success.
- Intake:
  - Assessment creation is durable.
  - Intake PDF save to member files is explicitly verified.
  - If file persistence fails, the system surfaces the issue and leaves follow-up work instead of faking success.
- POF:
  - Provider signature image and signed PDF are stored before finalization.
  - Finalization is RPC-backed and replay-safe.
  - The weak point is not document storage. It is post-sign downstream sync readiness.
- Care plan:
  - This is one of the strongest document boundaries in the repo.
  - Caregiver signature does not count as complete unless a final member file id exists.
- MAR monthly PDF:
  - This path is also strong.
  - The action only returns verified success when member-files persistence verifies.
- Notifications and alerts:
  - `recordWorkflowMilestone` writes through the dedicated notification service and explicitly records follow-up-needed states when delivery fails.
  - Recipient resolution has fallback admin behavior for core events and action-required states.
  - Operationally, that is much safer than silent notification failure.

## 7. Fix First

1. Tighten intake post-sign readiness so staff cannot confuse signed intake with ready-for-POF when draft POF follow-up is still open.
2. Standardize POF post-sign readiness across POF detail, MHP, MCC, and nursing dashboard surfaces so “signed” never implies “synced.”
3. Make enrollment packet operational-readiness state more prominent in sales and completed-packet views so filed packets with blocked downstream mapping are unmistakable.
4. Add live workflow checks for:
   - enrollment packet completion
   - signed POF post-sign sync
   - intake-to-draft-POF follow-up
5. After the current in-progress worktree changes settle, rerun this audit with live E2E against the linked Supabase project.

## 8. Regression Checklist

1. Send an enrollment packet from a real lead and verify rows in `enrollment_packet_requests`, `enrollment_packet_events`, and `lead_activities`.
2. Complete the packet from the public link and verify packet filing, upload rows, signature rows, and whether the confirmation page shows a follow-up-required state.
3. Confirm the completed packet artifact is visible in member files and that lead activity appeared without manual repair.
4. Convert the lead to a member and verify a single canonical `members.source_lead_id` relationship.
5. Submit and sign intake assessment, then verify:
   - `intake_assessments`
   - `assessment_responses`
   - `intake_assessment_signatures`
   - intake PDF in `member_files`
6. If draft POF follow-up opens, verify that the intake detail page and follow-up queue both show it clearly.
7. Send and complete a POF provider signature and verify:
   - `pof_requests`
   - `pof_signatures`
   - signed PDF in `member_files`
   - post-sign queue state
8. Confirm the same signed POF updates MHP, MCC visibility, `pof_medications`, and `mar_schedules` for the same member.
9. Document a scheduled MAR dose as `Given`, then a second dose as `Not Given`, and verify action-required notification behavior.
10. Document a PRN administration plus follow-up outcome and verify the PRN path persists without local fallback state.
11. Generate a monthly MAR PDF and verify it is visible in member files and MCC file surfaces.
12. Check the notifications inbox for enrollment, intake, POF, care plan, and MAR milestones plus any action-required items.
