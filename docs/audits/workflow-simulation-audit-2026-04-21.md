# Workflow Simulation Audit Report
_Generated: 2026-04-21T04:16:16 America/New_York_
_Repository: D:/Memory Lane App_

This run was a static code-path audit plus direct service review. Live browser/E2E validation was not run because nothing was listening on required local port `3001`.

## 1. Executive Summary

Overall lifecycle health is **Fragile**.

The good news is that the main workflows are still using real Supabase-backed service paths. I did not find mock persistence, in-memory substitutes, or obvious lead/member split-brain in the audited runtime path. Enrollment packet send/completion, lead conversion, care plan signature persistence, MAR documentation, and monthly MAR PDF saving are structurally strong.

The main operational risk is not fake storage. The main risk is **committed but not truly ready** behavior in clinically important handoffs:

- A signed intake can still leave staff needing follow-up before a draft POF is verified and ready to use.
- A signed POF can still leave MHP, MCC, and MAR sync queued for retry.
- Notification delivery is architecturally guarded, but this run did not live-verify real recipient resolution or inbox delivery.

Those are real workflow risks for nurses, admins, and caregivers because the source record may be durable while the next operational step is still not safe to trust.

## 2. Lifecycle Handoff Table

| Handoff | Status | What I verified | Main operational risk |
|---|---|---|---|
| Lead -> Send Enrollment Packet | **Strong** | [`lib/services/enrollment-packets-send-runtime.ts`](D:/Memory Lane App/lib/services/enrollment-packets-send-runtime.ts) persists packet requests/events and [`lib/services/enrollment-packet-mapping-runtime.ts`](D:/Memory Lane App/lib/services/enrollment-packet-mapping-runtime.ts) links lead activity. | Normal regression coverage only. |
| Send Enrollment Packet -> Enrollment Packet completion / e-sign return | **Strong** | [`lib/services/enrollment-packets-public-runtime.ts`](D:/Memory Lane App/lib/services/enrollment-packets-public-runtime.ts) finalizes the public flow, records failure milestones, and hands off to committed post-finalize work. | Live storage/object verification was not exercised in this run. |
| Enrollment Packet completion / e-sign return -> Lead activity logging | **Partial** | [`syncEnrollmentPacketLeadActivityOrQueue`](D:/Memory Lane App/lib/services/enrollment-packet-mapping-runtime.ts) writes lead activity when possible and queues follow-up if the insert fails after the packet already committed. | Sales staff can end up depending on a queued repair instead of immediate visible activity history. |
| Lead activity logging -> Member creation / enrollment resolution | **Strong** | [`resolveCanonicalPersonRef`](D:/Memory Lane App/lib/services/canonical-person-ref.ts), [`resolveCanonicalMemberRef`](D:/Memory Lane App/lib/services/canonical-person-ref.ts), and [`resolveCanonicalLeadRef`](D:/Memory Lane App/lib/services/canonical-person-ref.ts) enforce canonical lead/member linkage. | Low current code-path risk. |
| Member creation / enrollment resolution -> Intake Assessment | **Strong** | [`createIntakeAssessmentWithResponses`](D:/Memory Lane App/lib/services/intake-pof-mhp-cascade.ts) uses atomic creation and [`saveGeneratedMemberPdfToFiles`](D:/Memory Lane App/lib/services/member-files.ts) is the canonical file path. | Intake persistence is strong, but post-sign readiness still matters. |
| Intake Assessment -> Physician Orders / POF generation | **Weak** | [`completeIntakeAssessmentPostSignWorkflow`](D:/Memory Lane App/lib/services/intake-pof-mhp-cascade.ts) calls [`autoCreateDraftPhysicianOrderFromIntake`](D:/Memory Lane App/lib/services/intake-pof-mhp-cascade.ts) -> [`createDraftPhysicianOrderFromAssessment`](D:/Memory Lane App/lib/services/physician-orders-supabase.ts). | Intake can be signed while draft POF creation fails or while committed readback verification still needs follow-up. |
| Physician Orders / POF generation -> Provider signature completion | **Strong** | [`lib/services/pof-esign.ts`](D:/Memory Lane App/lib/services/pof-esign.ts) persists request/delivery/signature workflow and protects sent-state finalization. | Main risk is downstream clinical sync after signing, not the signature request itself. |
| Provider signature completion -> MHP generation / sync | **Partial** | [`processSignedPhysicianOrderPostSignSync`](D:/Memory Lane App/lib/services/physician-order-post-sign-service.ts) and [`syncMemberHealthProfileFromSignedPhysicianOrder`](D:/Memory Lane App/lib/services/physician-order-post-sign-service.ts) handle downstream sync after the signed POF commits. | A signed POF can still be queued for retry, which means the order is durable but not clinically ready downstream. |
| MHP generation / sync -> MCC downstream visibility | **Partial** | MCC reads are canonical through [`lib/services/member-command-center-supabase.ts`](D:/Memory Lane App/lib/services/member-command-center-supabase.ts), and POF post-sign sync explicitly targets downstream readiness. | MCC freshness depends on the post-sign sync completing, not just on provider signature success. |
| MCC downstream visibility -> Care Plan creation / signature workflow | **Strong** | [`lib/services/care-plans-supabase.ts`](D:/Memory Lane App/lib/services/care-plans-supabase.ts), [`lib/services/care-plan-esign.ts`](D:/Memory Lane App/lib/services/care-plan-esign.ts), and [`lib/services/care-plan-esign-public.ts`](D:/Memory Lane App/lib/services/care-plan-esign-public.ts) provide canonical create/review/sign flows. | Low current persistence risk. |
| Care Plan creation / signature workflow -> MAR generation from POF meds | **Partial** | [`processSignedPhysicianOrderPostSignSync`](D:/Memory Lane App/lib/services/physician-order-post-sign-service.ts), [`syncPofMedicationsFromSignedOrder`](D:/Memory Lane App/lib/services/mar-workflow.ts), and [`generateMarSchedulesForMember`](D:/Memory Lane App/lib/services/mar-workflow.ts) show that MAR is driven by signed POF sync, not care plan completion itself. | Staff should not treat care plan completion as the MAR source of truth. |
| MAR generation from POF meds -> MAR documentation workflow | **Strong** | [`documentScheduledMarAdministration`](D:/Memory Lane App/lib/services/mar-workflow.ts), [`documentPrnMedicationAdministration`](D:/Memory Lane App/lib/services/mar-prn-workflow.ts), and [`documentPrnFollowupAssessment`](D:/Memory Lane App/lib/services/mar-prn-workflow.ts) persist canonical medication documentation. | Low current code-path risk. |
| MAR documentation workflow -> Monthly MAR summary or PDF generation | **Strong** | [`assembleMarMonthlyReportData`](D:/Memory Lane App/lib/services/mar-monthly-report.ts) and [`buildMarMonthlyReportPdfDataUrl`](D:/Memory Lane App/lib/services/mar-monthly-report-pdf.ts) use canonical data assembly and deterministic PDF generation. | Live PDF generation was not exercised in this run. |
| Monthly MAR summary or PDF generation -> Member Files persistence | **Strong** | [`generateMonthlyMarReportPdfAction`](D:/Memory Lane App/app/(portal)/health/mar/actions-impl.ts) saves through [`saveGeneratedMemberPdfToFiles`](D:/Memory Lane App/lib/services/member-files.ts) and returns `follow-up-needed` if Supabase verification is incomplete. | The current MCC/member-file UI work should be retested so staff still see saved files clearly. |
| Completion notifications or alerts | **Partial** | [`recordWorkflowMilestone`](D:/Memory Lane App/lib/services/lifecycle-milestones.ts) only treats delivery as true when `user_notifications` rows are actually created, and records follow-up/alerts otherwise. | I did not live-verify real recipient resolution or inbox delivery. |

## 3. Critical Failures

1. **Signed intake is not the same as ready-for-POF.**
Why it matters: a nurse can finish the intake workflow and still not have a verified draft POF ready for follow-up work.
Evidence: [`completeIntakeAssessmentPostSignWorkflow`](D:/Memory Lane App/lib/services/intake-pof-mhp-cascade.ts) returns committed follow-up states and queues `draft_pof_creation` when draft creation fails or immediate readback verification misses.
Probable root cause: the intake write is durable first, but draft POF readiness is a downstream follow-up boundary rather than one fully verified readiness boundary.

2. **Signed POF is not the same as clinically synced.**
Why it matters: admins can see "signed" while downstream MHP, MCC, and MAR work is still queued or degraded.
Evidence: [`processSignedPhysicianOrderPostSignSync`](D:/Memory Lane App/lib/services/physician-order-post-sign-service.ts) records retry queue state, emits `action_required`, and raises high-severity alerts after repeated failures.
Probable root cause: provider signature persistence is durable, but downstream clinical sync intentionally happens after the signed transition commits.

3. **Enrollment packet completion can still require repair before sales-side visibility is reliable.**
Why it matters: packet completion may be real while lead activity history lags behind, which can confuse sales/admin follow-up.
Evidence: [`syncEnrollmentPacketLeadActivityOrQueue`](D:/Memory Lane App/lib/services/enrollment-packet-mapping-runtime.ts) catches post-commit lead-activity failure and queues a repair task instead of failing the already-committed packet.
Probable root cause: downstream cross-module visibility is protected by retry/repair rather than a single fully synchronous handoff.

## 4. Canonicality Risks

- I did **not** find runtime mock persistence, fake local storage, or in-memory substitutes in the audited lifecycle path.
- I did **not** find an obvious lead/member identity mismatch pattern in the audited lifecycle path.
- The main canonicality risk is the repeated **commit first, then verify downstream readiness** model. That is safer than fake success, but it still creates operational ambiguity if the UI does not clearly show follow-up-required status.
- Some `ok: true` action returns in lifecycle-adjacent code are not fake success, but **committed-with-follow-up** returns. That distinction is good architecture, but the UI must surface it clearly so staff do not misread it as fully done.

## 5. Schema / Runtime Risks

- I did not find obvious missing lifecycle tables or missing lifecycle columns from migrations in this pass.
- [`createDraftPhysicianOrderFromAssessment`](D:/Memory Lane App/lib/services/physician-orders-supabase.ts) explicitly throws if the intake draft POF RPC/migration is missing. That is the correct failure mode, but it means schema/runtime alignment for that RPC remains critical.
- Live checks were not run because port `3001` was not listening during this automation run.
- The repo is currently dirty in MCC/member-file files, so file-surface visibility should be treated as current-working-tree behavior, not a clean baseline:
  - [`app/(portal)/operations/member-command-center/_actions/files.ts`](D:/Memory Lane App/app/(portal)/operations/member-command-center/_actions/files.ts)
  - [`components/forms/member-command-center-file-manager.tsx`](D:/Memory Lane App/components/forms/member-command-center-file-manager.tsx)
  - [`lib/services/member-command-center-runtime.ts`](D:/Memory Lane App/lib/services/member-command-center-runtime.ts)

## 6. Document / Notification / File Persistence Findings

- Intake PDF persistence is architecturally strong. [`completeIntakeAssessmentPostSignWorkflow`](D:/Memory Lane App/lib/services/intake-pof-mhp-cascade.ts) saves through [`saveGeneratedMemberPdfToFiles`](D:/Memory Lane App/lib/services/member-files.ts) and explicitly returns follow-up-needed if Supabase verification is incomplete.
- Caregiver care-plan signing is strong on persistence. [`submitPublicCarePlanSignature`](D:/Memory Lane App/lib/services/care-plan-esign-public.ts) requires a committed `final_member_file_id`, records workflow events, and returns a committed follow-up state instead of pretending nothing went wrong when post-commit work fails.
- Monthly MAR PDF persistence is also strong. [`generateMonthlyMarReportPdfAction`](D:/Memory Lane App/app/(portal)/health/mar/actions-impl.ts) returns `follow-up-needed` if the PDF upload succeeded but member-file verification is not yet trustworthy.
- Enrollment packet completion is stronger than the raw script implied. The public runtime records failure milestones and alerts on finalize problems instead of silently dropping the workflow.
- Notification delivery is designed safely. [`recordWorkflowMilestone`](D:/Memory Lane App/lib/services/lifecycle-milestones.ts) only treats delivery as true when `user_notifications` rows are created. The gap in this run is not architecture; it is lack of live recipient verification.

## 7. Fix First

1. Tighten the signed-intake readiness boundary so staff cannot confuse "intake saved" with "draft POF verified and ready."
2. Tighten the signed-POF readiness boundary in staff-facing UI so "provider signed" never hides queued or failed MHP/MCC/MAR sync.
3. Add one real live regression pass on local port `3001` for enrollment packet completion, signed intake, POF signing, caregiver care-plan signing, and monthly MAR PDF saving.
4. Finish and retest the current MCC/member-file visibility changes so persisted artifacts remain clearly visible to staff.
5. Add targeted regression coverage for queued follow-up states and notification recipient resolution.

## 8. Regression Checklist

1. Send an enrollment packet from a lead and verify rows in `enrollment_packet_requests`, `enrollment_packet_events`, and lead activity.
2. Complete the packet from the public link and verify signatures, uploads, completed artifact persistence, and `member_files` linkage.
3. Confirm the lead resolves to exactly one canonical member through `members.source_lead_id`.
4. Create and sign an intake assessment, then verify the intake row, responses, signature row, and saved intake PDF.
5. Immediately verify that a draft POF exists after signed intake and is not merely queued for follow-up.
6. Send and complete provider POF signature, then verify whether post-sign status is truly synced versus queued.
7. Confirm signed POF data reaches MHP and MCC for the same member before staff rely on the record.
8. Create, review, nurse-sign, and caregiver-sign a care plan; verify final signed PDF and final `member_files` row.
9. Verify MAR schedules come from the signed POF medication set and that given/not-given plus PRN outcome paths persist correctly.
10. Generate the monthly MAR PDF and verify both file persistence and MCC/member-file visibility.
11. Verify milestone notifications actually create `user_notifications` rows for enrollment, POF, care plan, and follow-up-required cases.
