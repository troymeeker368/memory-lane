# Workflow Simulation Audit Report
_Generated: 2026-04-22 04:25 America/New_York_
_Scope: static workflow simulation + direct service/read-model review_
_Validation run: `cmd /c npm run typecheck` ✅, `cmd /c npm run build` ✅_

## 1. Executive Summary

Overall lifecycle health is **Partial**.

The important good news is that the main Memory Lane lifecycle is still running through real Supabase-backed service paths. I did not find mock persistence, in-memory runtime storage, or an obvious lead/member identity split in the audited lifecycle code.

The main risk is not fake writes. The main risk is **operational ambiguity after a real write succeeds**:

- Intake can be saved and signed, but draft POF creation may still be in a follow-up-required state.
- A POF can be signed, but MHP, MCC, and MAR downstream sync can still be queued for retry.
- Enrollment packet completion can be committed while sales-side lead activity is queued for repair instead of immediately visible.
- The current dirty branch introduces a **real MCC member-files read-model risk**: the initial file list and the paged "Load Older Files" path are not using one canonical visibility query, which can make file visibility look inconsistent for restricted viewers.

This means the platform is not showing obvious fake success, but some workflows still require staff to trust the **readiness state** rather than the first success message.

Live E2E scripts were **not run** in this automation pass. The repo has live scripts for enrollment packet and POF signing, but they create real Supabase records and notifications. I did not run them automatically in a recurring audit thread without an explicit go-ahead.

## 2. Lifecycle Handoff Table

| Lifecycle handoff | Status | What is working | Main risk |
|---|---|---|---|
| Lead -> Send Enrollment Packet | Strong | `app/sales-enrollment-actions.ts` -> `lib/services/enrollment-packets-send-runtime.ts::sendEnrollmentPacketRequest` writes request/event records and uses canonical lead/member context. | Notification delivery for `enrollment_packet_sent` is weaker than other milestone types if recipient resolution comes back empty. |
| Send Enrollment Packet -> Enrollment Packet completion / e-sign return | Strong | `lib/services/enrollment-packets-public-runtime.ts` and `lib/services/enrollment-packet-completion-cascade.ts` persist signatures, uploads, request completion, and completed packet artifacts. | Live artifact verification was not exercised this run. |
| Enrollment Packet completion / e-sign return -> Lead activity logging | Partial | `lib/services/enrollment-packet-mapping-runtime.ts::syncEnrollmentPacketLeadActivityOrQueue` uses canonical lead activity writes. | If lead activity insert fails after packet completion commits, the system queues follow-up instead of making the activity immediately visible to staff. |
| Lead activity logging -> Member creation / enrollment resolution | Strong | `app/sales-lead-actions.ts` and `lib/services/canonical-person-ref.ts` preserve `source_lead_id` and fail closed on identity mismatch. | Low current risk from static review. |
| Member creation / enrollment resolution -> Intake Assessment | Strong | `app/intake-actions.ts::createAssessmentAction` and `lib/services/intake-pof-mhp-cascade.ts::createIntakeAssessmentWithResponses` write intake records and save the intake PDF through `lib/services/member-files.ts`. | The write path is strong, but readiness after signing still matters. |
| Intake Assessment -> Physician Orders / POF generation | Partial | `completeIntakeAssessmentPostSignWorkflow` and `autoCreateDraftPhysicianOrderFromIntake` do create the draft POF through the canonical service path. | This is not broken, but it can land in follow-up-required state if POF creation or verification fails after the intake already committed. |
| Physician Orders / POF generation -> Provider signature completion | Strong | `lib/services/pof-esign.ts` persists request/send/replay-safe signature workflow and signed artifact state. | Main downstream risk is after signing, not the request itself. |
| Provider signature completion -> Member Health Profile (MHP) generation / sync | Partial | `lib/services/physician-orders-supabase.ts` and `lib/services/physician-order-post-sign-service.ts` do run canonical post-sign sync. | Signed POF does not always mean clinically synced; downstream MHP/MCC/MAR work can still be queued. |
| MHP generation / sync -> Member Command Center (MCC) visibility | Partial | MCC still reads through canonical Supabase-backed read models. | In the current dirty branch, member-file visibility and paging are not aligned under one canonical filtered query, so staff can see inconsistent file results. |
| MCC downstream visibility -> Care Plan creation / signature workflow | Strong | `app/care-plan-actions.ts`, `lib/services/care-plans-supabase.ts`, and `lib/services/care-plan-esign-public.ts` keep create/review/sign flows on canonical Supabase records and `member_files`. | Low current persistence risk from static review. |
| Care Plan creation / signature workflow -> MAR generation from POF meds | Strong | MAR generation still comes from signed POF sync through `lib/services/mar-workflow.ts`, which is the correct canonical boundary. | Staff must not treat care plan completion as the MAR source of truth. |
| MAR generation from POF meds -> MAR documentation workflow | Strong | `lib/services/mar-workflow.ts` and `lib/services/mar-prn-workflow.ts` persist scheduled and PRN medication documentation canonically. | Low current risk from static review. |
| MAR documentation workflow -> Monthly MAR summary or PDF generation | Strong | `lib/services/mar-monthly-report.ts` and `lib/services/mar-monthly-report-pdf.ts` assemble deterministic canonical output. | Live PDF generation was not exercised this run. |
| Monthly MAR summary or PDF generation -> Member Files persistence | Partial | `app/(portal)/health/mar/actions-impl.ts` persists PDFs through `saveGeneratedMemberPdfToFiles`, which verifies persistence instead of pretending success. | The file save path is strong, but current MCC file paging/visibility changes can make saved artifacts look inconsistently visible to some staff. |
| Completion notifications or alerts | Partial | `lib/services/lifecycle-milestones.ts::recordWorkflowMilestone` dispatches to `lib/services/notifications.ts`, which writes `user_notifications`. | I did not live-verify real recipient resolution or inbox delivery. `enrollment_packet_sent` also lacks the stronger zero-recipient escalation used by core milestone types. |

## 3. Critical Failures

1. **MCC file visibility is not using one canonical filtered query in the dirty branch.**
Why it matters: staff can save a file correctly but still see an incomplete or inconsistent list in Member Command Center, especially when role-based filtering is involved.
Exact files:
- `lib/services/member-command-center-runtime.ts`
- `lib/services/member-command-center-detail-read-model.ts`
- `app/(portal)/operations/member-command-center/_actions/files.ts`
- `components/forms/member-command-center-file-manager.tsx`
Probable root cause: the first render loads files from one path, then filters them in memory, while "Load Older Files" uses a different paged query with permission-aware filtering.

2. **Some lifecycle steps still return committed-with-follow-up rather than fully ready.**
Why it matters: nurses and admins can misread "saved" as "operationally complete" if the UI does not surface follow-up-required state clearly.
Exact files:
- `app/intake-actions.ts`
- `lib/services/intake-pof-mhp-cascade.ts`
- `lib/services/physician-orders-supabase.ts`
- `lib/services/physician-order-post-sign-service.ts`
Probable root cause: the architecture correctly commits the source record first, then protects downstream sync with queue/follow-up handling. The risk is presentation clarity, not missing persistence.

3. **Enrollment completion can commit before sales-side visibility is repaired.**
Why it matters: admins or sales staff may not immediately see the completed enrollment packet reflected in lead activity history.
Exact files:
- `lib/services/enrollment-packet-completion-cascade.ts`
- `lib/services/enrollment-packet-mapping-runtime.ts`
Probable root cause: lead activity sync is protected with queued follow-up instead of making the already-committed packet fail.

## 4. Canonicality Risks

- I did **not** find mock runtime persistence, local JSON persistence, or in-memory substitutes in the audited lifecycle path.
- I did **not** find an obvious lead/member identity mismatch in the audited lifecycle path. The lead/member resolution path is still anchored in canonical shared resolvers.
- The biggest canonicality risk is not multiple write paths. It is **staff misreading committed-but-follow-up-required states as fully complete**.
- The current MCC member-files branch introduces a **read canonicality risk**: the initial list and the paged list are not clearly using one shared permission-filtered file query.

## 5. Schema / Runtime Risks

- `typecheck` passed.
- `build` passed.
- I did not find a clear missing lifecycle table or missing lifecycle column in the reviewed paths.
- Intake and physician-order paths still depend on migration-backed RPCs. That is correct, but it means any schema drift in those RPCs remains high impact.
- Live workflow scripts exist for:
  - `scripts/e2e-enrollment-packet-live.ts`
  - `scripts/e2e-pof-signing-live.ts`
  These mutate real Supabase-backed records, so this automation pass did not run them automatically.
- The working tree is dirty in MCC/member-files/care-plan areas, so today’s MCC file-surface finding should be treated as **current-branch behavior**, not repository baseline.

## 6. Document / Notification / File Persistence Findings

- Enrollment packet completion appears to persist the completed packet artifact through `lib/services/enrollment-packet-completion-cascade.ts`, including `member_files` linkage.
- Intake PDF persistence is strong. `app/intake-actions.ts` and the assessment post-sign actions route PDF saves through `lib/services/member-files.ts`, and they use follow-up-required state if verification is incomplete.
- Signed care plan persistence is strong. `lib/services/care-plan-esign-public.ts::submitPublicCarePlanSignature` requires a committed final member file and replay-safe finalization.
- Signed POF persistence is strong. `lib/services/pof-esign.ts` and `lib/services/pof-post-sign-runtime.ts` keep the signed PDF/member file path on canonical tables and storage-backed artifacts.
- Monthly MAR PDF persistence is strong. `app/(portal)/health/mar/actions-impl.ts` saves through `saveGeneratedMemberPdfToFiles` and treats verification as the truth boundary.
- Notification writes are real, not fake. `recordWorkflowMilestone` only counts delivery as true when `user_notifications` rows are actually created.
- The main remaining gap is **live recipient verification**, especially for milestone types that are not in the stricter zero-recipient escalation set.

## 7. Fix First

1. Align MCC member-file initial load and paged load under **one canonical permission-filtered query** so staff see a stable file list.
2. Audit every intake/POF/MHP/MAR UI surface that receives `followUpNeeded`, `actionNeededMessage`, or readiness status and make sure it does not flatten those into a simple success state.
3. Add stricter notification follow-up coverage for `enrollment_packet_sent`, so zero-recipient delivery cannot look clean.
4. Run a deliberate live audit pass only when it is acceptable to create real Supabase records, then verify:
   - enrollment packet completion
   - lead activity visibility
   - signed POF -> MHP/MCC/MAR sync
   - care plan signed artifact visibility
   - monthly MAR PDF visibility in MCC files
5. Keep RPC/migration validation tight on intake and physician-order workflows, because those are still the highest-impact schema boundaries.

## 8. Regression Checklist

1. Send an enrollment packet and verify `enrollment_packet_requests`, `enrollment_packet_events`, and lead activity rows all exist.
2. Complete an enrollment packet from the public link and verify signatures, uploads, completed packet artifacts, and `member_files` linkage.
3. Confirm the lead resolves to exactly one canonical member through `members.source_lead_id`.
4. Create and sign an intake assessment and verify the intake row, responses, signature row, and saved intake PDF.
5. Verify that draft POF creation after intake shows the correct readiness state when it succeeds and when it lands in follow-up-required state.
6. Send and complete provider POF signature and verify whether downstream post-sign sync is `synced` or `queued`, not just whether the signature succeeded.
7. Confirm MHP and MCC reflect the signed POF for the same member before staff rely on the record.
8. Create, review, nurse-sign, and caregiver-sign a care plan and verify the final signed artifact is present in `member_files`.
9. Document MAR given/not-given and PRN effective/ineffective outcomes and verify canonical persistence.
10. Generate the monthly MAR PDF and verify both `member_files` persistence and MCC file visibility for the same user roles who need it.
11. Verify milestone notifications create `user_notifications` rows for enrollment, POF, care plan, and follow-up-required cases.
