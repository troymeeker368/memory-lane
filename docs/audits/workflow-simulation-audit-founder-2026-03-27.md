# Workflow Simulation Audit Report
_Generated: 2026-03-27 04:21 EDT_

## 1. Executive Summary
- Overall workflow health: **Partial**
- The good news: the main lifecycle is still Supabase-backed end to end. I found real canonical writes for enrollment packets, intake, POF, MHP, MCC, care plans, MAR documentation, monthly MAR PDFs, member files, and notifications.
- The main risk is not “missing database tables” or mock persistence. The real risk is that some workflows can report success before all downstream handoffs are fully settled.
- The three most important operational gaps are:
  - Enrollment packet completion can finish while downstream mapping and lead activity follow-up are still pending.
  - Signed POF can be accepted while MHP and MAR sync are queued for retry instead of guaranteed inline completion.
  - Notifications and alerts are still best-effort. Failures are logged and alerted, but they do not consistently block the parent workflow.
- Live browser verification did not run successfully on March 27, 2026. Both live scripts failed with `spawn EPERM` from `esbuild`, so this report is based on static audit plus manual code verification.

## 2. Lifecycle Handoff Table
| Handoff | Status | Why |
|---|---|---|
| Lead -> Send Enrollment Packet | Partial | Canonical send path exists through shared runtime + RPC preparation, but lead activity and milestone notification follow-up can still degrade after send succeeds. |
| Send Enrollment Packet -> Enrollment Packet completion / e-sign return | Partial | Completion persists signatures, uploads, final packet artifact, and request finalization, but downstream mapping can remain pending or failed after completion. |
| Enrollment Packet completion -> Lead activity logging | Partial | Lead activity sync is present, but failure can queue follow-up work after the packet is already completed. |
| Lead activity logging -> Member creation / enrollment resolution | Strong | Lead conversion uses canonical lead/member resolution and preserves `members.source_lead_id`. |
| Member creation -> Intake Assessment | Strong | Intake assessment creation is transaction-backed and persists assessment rows, responses, signatures, and member-file PDF output. |
| Intake Assessment -> Physician Orders / POF generation | Strong | Intake-to-POF draft creation is backed by shared service/RPC flow and stays attached to canonical member identity. |
| Physician Orders / POF generation -> Provider signature completion | Strong | POF send/sign flow persists requests, signatures, events, and signed artifacts with explicit delivery-state handling. |
| Provider signature completion -> MHP generation / sync | Partial | Signed POF triggers MHP sync, but the post-sign cascade can fall back to queued retry instead of guaranteed same-request completion. |
| MHP generation / sync -> MCC visibility | Strong | MCC uses shared services and canonical member resolution to read MHP and operational shell data. |
| MCC visibility -> Care Plan creation / signature workflow | Partial | Care plan root/signature persistence is real, but version snapshot and caregiver dispatch can still fail after nurse signature and require repair. |
| Care Plan creation / signature workflow -> MAR generation from POF meds | Partial | The code path is real, but the canonical trigger is signed POF, not care plan signature. The lifecycle description is still misleading here. |
| MAR generation from POF meds -> MAR documentation workflow | Strong | Scheduled and PRN documentation both use shared RPC-backed persistence. The raw scanner missed some of this because PRN writes live in a separate service. |
| MAR documentation workflow -> Monthly MAR summary / PDF generation | Strong | Monthly report assembly and PDF generation read canonical MAR data. |
| Monthly MAR summary / PDF generation -> Member Files persistence | Strong | Monthly MAR PDF save explicitly writes to `member_files` and returns an error if file persistence fails. |
| Completion notifications / alerts | Partial | `user_notifications` writes are real and deduped, but notification dispatch failure is logged instead of blocking the parent workflow. |

## 3. Critical Failures
1. Enrollment packet completion is allowed to return `completed` while downstream readiness is still pending.
Why it matters: staff can treat a packet as operationally done before MCC/MHP/lead activity handoffs are fully settled.
Evidence: `lib/services/enrollment-packets-public-runtime.ts`, `lib/services/enrollment-packet-public-helpers.ts`, `lib/services/enrollment-packet-follow-up.ts`.

2. Signed POF can complete with downstream clinical sync queued for retry.
Why it matters: nurses can see a signed order before MHP and MAR are fully aligned.
Evidence: `lib/services/physician-orders-supabase.ts`, `lib/services/pof-post-sign-runtime.ts`.

3. Notification delivery is still best-effort.
Why it matters: important alerts can be missed even when the underlying workflow already moved forward.
Evidence: `lib/services/lifecycle-milestones.ts`, `lib/services/notifications.ts`.

## 4. Canonicality Risks
- I did **not** find runtime mock persistence or fake fallback storage in the audited lifecycle files.
- I did find scanner false negatives caused by newer lazy-loaded service boundaries. This affects the raw tool score, not the underlying production path.
- Enrollment packet and POF workflows still rely on “success plus queued follow-up” in a few places. That is safer than silent failure, but still not the same as fully closed-loop completion.
- The lifecycle narrative still implies `Care Plan -> MAR`, but the real system trigger is `Signed POF -> MAR`.

## 5. Schema / Runtime Risks
- Static schema check did not find missing lifecycle tables or missing expected columns in Supabase migrations.
- Current workspace is dirty in enrollment-packet files, so today’s audit reflects in-progress local code, not a clean committed baseline.
- Live E2E remained blocked by local runtime limits: `npm.ps1` execution policy initially blocked the command, and `npm.cmd` still failed with `spawn EPERM` from `esbuild`.

## 6. Document / Notification / File Persistence Findings
- Enrollment packet completion now saves signature artifacts, uploaded documents, and completed-packet artifacts into `member_files`, then finalizes packet state through RPC-backed completion.
- Signed POF path persists request/signature/document events and drives post-sign sync state explicitly, but downstream sync can still move into retry queue.
- Care plan signature events are persisted, and failed snapshot/dispatch steps create explicit action-required follow-up instead of pretending the workflow is clean.
- MAR monthly PDF generation explicitly saves into `member_files`; if file persistence fails, the action returns an error instead of fake success.
- Notifications persist through `user_notifications`, but delivery problems are downgraded into failure logs/system alerts rather than parent-workflow failure.

## 7. Fix First
1. Tighten enrollment packet completion so operational readiness does not look “done” until mapping and lead activity are both settled or clearly blocked in the UI.
2. Tighten the POF post-sign cascade so MHP + MAR sync is either inline-success or an obvious blocked clinical state, not a soft queue that staff can overlook.
3. Decide which milestone alerts are operationally mandatory, then require recipient resolution and hard-fail those specific workflows when notification delivery is essential.
4. Update the lifecycle audit/config and founder-facing documentation so MAR is described as flowing from signed POF, not from care plan.

## 8. Regression Checklist
1. Send an enrollment packet and verify request, event, sent-state, lead activity, and notification rows.
2. Complete the packet and verify signatures, uploads, completed packet artifact, mapping run status, and any queued follow-up task.
3. Convert the lead and verify exactly one canonical member linked by `source_lead_id`.
4. Submit intake and verify assessment rows, response rows, signature rows, and intake PDF file persistence.
5. Complete POF provider signature and verify whether post-sign status is `synced` or `queued`, then confirm MHP and MAR consequences.
6. Create and review a care plan, then verify version snapshot, review history, caregiver dispatch, and signature-event persistence.
7. Document scheduled MAR, PRN administration, and PRN effectiveness follow-up, then generate and save the monthly MAR PDF.
8. Check notifications inbox plus system alerts for every action-required branch above.
