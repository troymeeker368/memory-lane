# Workflow Simulation Audit Report
_Generated: 2026-04-20_
_Repository: D:/Memory Lane App_

## 1. Executive Summary

Overall workflow health: **Fragile**

The good news is that the major lifecycle steps do use real Supabase-backed service paths. I did not find mock persistence, fake runtime storage, or obvious lead/member split-brain in the audited workflow path. The strongest parts of the lifecycle are lead conversion, enrollment packet send/completion, care plan finalization, MAR documentation, and monthly MAR PDF persistence.

The main risk is not "missing tables" or "demo logic." The main risk is **committed-but-not-ready** behavior in clinically important handoffs. A signed intake can still leave staff needing follow-up before a draft POF is reliably available. A signed POF can still leave downstream MHP, MCC, and MAR readiness queued for retry. That protects the primary write, but it is still operationally risky because staff can read "signed" before the next clinical step is truly ready.

This run was a **static code audit plus direct service-path review**. I did **not** run live browser or end-to-end checks because nothing was listening on required local port `3001` during this automation run.

## 2. Lifecycle Handoff Table

| Handoff | Status | What I verified | Main risk |
|---|---|---|---|
| Lead -> Send Enrollment Packet | **Strong** | [`D:/Memory Lane App/lib/services/enrollment-packets-send-runtime.ts`](D:/Memory Lane App/lib/services/enrollment-packets-send-runtime.ts) writes canonical packet rows/events and records milestone activity. | Needs normal regression coverage only. |
| Send Enrollment Packet -> Enrollment Packet completion / e-sign return | **Strong** | [`D:/Memory Lane App/lib/services/enrollment-packets-public-runtime.ts`](D:/Memory Lane App/lib/services/enrollment-packet-public-runtime.ts) and [`D:/Memory Lane App/lib/services/enrollment-packet-completion-cascade.ts`](D:/Memory Lane App/lib/services/enrollment-packet-completion-cascade.ts) finalize submission, persist artifacts, repair missing links, and emit failure alerts when needed. | Live completion/storage path was not exercised this run. |
| Enrollment Packet completion / e-sign return -> Lead activity logging | **Partial** | Completion cascade calls `ensureEnrollmentPacketLeadActivity()` and `syncEnrollmentPacketLeadActivityOrQueue()`. | Lead activity is protected, but this handoff can degrade into queued follow-up rather than immediate clean completion. |
| Lead activity logging -> Member creation / enrollment resolution | **Strong** | [`D:/Memory Lane App/lib/services/canonical-person-ref.ts`](D:/Memory Lane App/lib/services/canonical-person-ref.ts) enforces canonical member creation/update through `members.source_lead_id` and fails on duplicate linked members. | Low risk from current code review. |
| Member creation / enrollment resolution -> Intake Assessment | **Strong** | [`D:/Memory Lane App/lib/services/intake-pof-mhp-cascade.ts`](D:/Memory Lane App/lib/services/intake-pof-mhp-cascade.ts) uses atomic intake RPC creation and records workflow events. | Downstream signature/follow-up can still degrade after the assessment is created. |
| Intake Assessment -> Physician Orders / POF generation | **Weak** | The canonical path exists: signed intake calls `autoCreateDraftPhysicianOrderFromIntake()` -> `createDraftPhysicianOrderFromAssessment()`. | This step is not operationally strong because signed intake can commit while draft POF creation fails or needs follow-up queue verification. |
| Physician Orders / POF generation -> Provider signature completion | **Strong** | POF send/public sign paths are real and replay-safe through [`D:/Memory Lane App/lib/services/pof-esign.ts`](D:/Memory Lane App/lib/services/pof-esign.ts) and [`D:/Memory Lane App/lib/services/pof-esign-public.ts`](D:/Memory Lane App/lib/services/pof-esign-public.ts). | The signature itself is durable, but downstream clinical sync is a separate readiness concern. |
| Provider signature completion -> Member Health Profile (MHP) generation / sync | **Partial** | [`D:/Memory Lane App/lib/services/physician-order-post-sign-service.ts`](D:/Memory Lane App/lib/services/physician-order-post-sign-service.ts) retries post-sign sync and raises alerts when MHP/MCC/MAR sync is not done. | A signed POF is not the same as clinically ready downstream state. |
| MHP generation / sync -> Member Command Center (MCC) visibility | **Partial** | MCC reads canonical member data from Supabase and POF post-sign sync explicitly targets downstream readiness. | MCC freshness depends on post-sign sync completing, not just provider signature. |
| MCC visibility -> Care Plan creation / signature workflow | **Strong** | Care plan create/review/sign flows run through canonical care-plan services and public caregiver signing. | Main risk is post-commit follow-up after signature, not missing persistence. |
| Care Plan creation / signature workflow -> MAR generation from POF medications | **Partial** | MAR generation is real, but it is driven by signed POF medication sync, not by care plan finalization itself. | This lifecycle sequence is operationally indirect; do not treat care plan completion as the MAR source of truth. |
| MAR generation from POF medications -> MAR documentation workflow | **Strong** | [`D:/Memory Lane App/lib/services/mar-workflow.ts`](D:/Memory Lane App/lib/services/mar-workflow.ts) and RPC-backed documentation paths persist scheduled, PRN, and follow-up outcomes. | Low code-path risk from this review. |
| MAR documentation workflow -> Monthly MAR summary or PDF generation | **Strong** | Monthly report assembly/PDF generation is canonical and read-heavy, with follow-up handling if file persistence cannot be verified. | Live PDF generation was not exercised this run. |
| Monthly MAR summary or PDF generation -> Member Files persistence | **Strong** | [`D:/Memory Lane App/app/(portal)/health/mar/actions-impl.ts`](D:/Memory Lane App/app/(portal)/health/mar/actions-impl.ts) saves PDFs through [`D:/Memory Lane App/lib/services/member-files.ts`](D:/Memory Lane App/lib/services/member-files.ts) and returns follow-up-needed when verification is incomplete. | Current working tree contains in-progress MCC file listing changes, so UI visibility should be rechecked after those changes settle. |
| Completion notifications or alerts | **Partial** | [`D:/Memory Lane App/lib/services/lifecycle-milestones.ts`](D:/Memory Lane App/lib/services/lifecycle-milestones.ts) enforces delivery truth and records alerts when no `user_notifications` rows are created. | Real recipient resolution and inbox delivery were not live-verified in this run. |

## 3. Critical Failures

1. **Signed intake is not the same as ready-for-POF.**
Why it matters: nurses can finish intake and still need manual follow-up before a usable draft POF is reliably available.
Evidence: [`D:/Memory Lane App/lib/services/intake-pof-mhp-cascade.ts`](D:/Memory Lane App/lib/services/intake-pof-mhp-cascade.ts) queues `draft_pof_creation` follow-up when draft creation or committed readback verification fails.
Likely root cause: the intake write is durable first, and the draft POF step is a downstream follow-up boundary instead of one fully verified readiness boundary.

2. **Signed POF is not the same as clinically synced.**
Why it matters: admins may read "provider signed" while MHP, MCC, and MAR are still queued or degraded.
Evidence: [`D:/Memory Lane App/lib/services/physician-order-post-sign-service.ts`](D:/Memory Lane App/lib/services/physician-order-post-sign-service.ts) marks post-sign sync as `queued`, opens action-required notifications, and raises high-severity alerts after repeated failures.
Likely root cause: provider signature transition is durable, but downstream clinical sync is intentionally retried after commit.

## 4. Canonicality Risks

- I did **not** find mock runtime persistence in the audited lifecycle path.
- I did **not** find an obvious lead/member identity mismatch pattern in the audited lifecycle path.
- The static script over-called one area as "broken": intake -> POF does have a canonical service path. The real issue is **post-sign readiness weakness**, not missing code.
- The main canonicality risk is that several workflows use a deliberate **commit first, then finish downstream follow-up** model. That is safer than fake success, but it still requires strong staff-facing readiness signals.

## 5. Schema / Runtime Risks

- I did not find an obvious migration/table drift issue in the audited lifecycle tables from static review.
- I could not validate runtime behavior of storage, signed URLs, notification delivery, or UI state transitions because local app port `3001` was not running.
- This repo is currently dirty in MCC/member-file UI files, so file visibility findings reflect the working tree, not a clean baseline:
  - [`D:/Memory Lane App/app/(portal)/operations/member-command-center/_actions/files.ts`](D:/Memory Lane App/app/(portal)/operations/member-command-center/_actions/files.ts)
  - [`D:/Memory Lane App/components/forms/member-command-center-file-manager.tsx`](D:/Memory Lane App/components/forms/member-command-center-file-manager.tsx)
  - [`D:/Memory Lane App/lib/services/member-command-center-runtime.ts`](D:/Memory Lane App/lib/services/member-command-center-runtime.ts)

## 6. Document / Notification / File Persistence Findings

- Enrollment packet completion is better than the script suggested. The completion cascade actively repairs missing completed-packet artifacts and checks that `member_files` links exist.
- Intake post-sign workflow generates and stores the intake PDF, but it can still return follow-up-required when member-file verification is not clean.
- Caregiver care-plan signing is robust on persistence: it stores the signature image, final signed PDF, and final member file reference, then raises alerts if post-commit readiness work fails.
- Monthly MAR PDF flow is operationally safer than a false-success path. It returns `follow-up-needed` when member-file verification is incomplete instead of pretending the file is fully saved.
- Notification logic is architecturally strong: milestone delivery is treated as false unless `user_notifications` rows are created for core events. What is still missing from this run is live proof that recipient resolution is correct in real data.

## 7. Fix First

1. Tighten the intake -> draft POF boundary so staff cannot mistake a signed intake for a fully ready physician-order workflow.
2. Tighten the signed POF readiness model in staff UI so "signed" never hides queued/degraded MHP, MCC, or MAR sync.
3. Add one real end-to-end regression pass on local port `3001` covering enrollment packet completion, signed intake, provider POF sign, caregiver care-plan sign, and MAR monthly PDF save.
4. Finish and verify the current MCC member-file pagination work so persisted artifacts remain obviously visible to staff in the UI.

## 8. Regression Checklist

1. Send an enrollment packet from a lead and verify canonical rows in `enrollment_packet_requests`, `enrollment_packet_events`, and lead activity.
2. Complete the packet from the public link and verify signatures, uploads, completed-packet artifact, and `member_files` linkage.
3. Confirm the lead resolves to exactly one canonical member through `members.source_lead_id`.
4. Complete intake assessment creation and nurse/admin signing, then verify the intake row, responses, signature, and saved intake PDF.
5. Immediately verify that a draft POF exists after signed intake, not just that a follow-up task was queued.
6. Send and complete provider POF signature, then verify whether post-sign status is truly ready versus queued/degraded.
7. Confirm signed POF data reaches MHP and MCC for the same member before staff rely on the record.
8. Create, review, nurse-sign, and caregiver-sign a care plan; verify final signed PDF and final member file row.
9. Verify MAR schedules come from the signed POF medication set and that given/not-given plus PRN outcome paths write correctly.
10. Generate monthly MAR PDF and verify both file persistence and MCC/member-file visibility.
11. Verify milestone notifications actually create `user_notifications` rows for enrollment, POF, care plan, and failure/follow-up cases.
