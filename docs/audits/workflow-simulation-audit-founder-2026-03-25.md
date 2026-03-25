# Workflow Simulation Audit Report

## 1. Executive Summary

This lifecycle is not broadly broken, but it is not fully closed-loop yet either.

The raw scanner again overstated several failures. Manual verification showed that the core Supabase-backed write paths do exist for enrollment packets, intake, POF, care plans, MAR, member files, and notifications. The bigger production risk is downstream reliability after the main step succeeds.

In plain English:

- Enrollment Packet send and completion do write canonical records, but follow-up work like downstream mapping, lead activity sync, and milestone notifications can still fail after the packet itself is already sent or filed.
- POF signing does trigger MHP and MAR downstream sync, but that cascade can be queued for retry instead of completing inline.
- Notifications are intentionally non-blocking. That means an operational alert can fail even when the parent workflow looks complete to staff.
- Live workflow checks still could not run in this environment because `esbuild` hit `EPERM spawn` before the E2E flows started.

Overall health: `Partial`

The highest-risk operational gaps for a real center are:

1. Enrollment Packet completion can leave sales and clinical follow-up out of sync.
2. Signed POF does not always mean MHP and MAR are immediately ready.
3. Missing notifications do not block the parent workflow, so staff can miss important handoff signals.

## 2. Lifecycle Handoff Table

| Handoff | Status | What I Verified | Main Operational Risk | Key Files |
|---|---|---|---|---|
| Lead -> Send Enrollment Packet | Partial | Canonical lead/member checks exist; packet prep is RPC-backed; packet events and sent-state writes are present. | Lead activity sync and milestone delivery can still fail after send succeeds. | `app/sales-enrollment-actions.ts`, `lib/services/enrollment-packets-send-runtime.ts` |
| Send Enrollment Packet -> Enrollment Packet completion / e-sign return | Partial | Progress save, signatures, uploads, completed packet artifact, and finalization RPC are present. | Packet can be filed before downstream mapping fully settles. | `lib/services/enrollment-packets-public-runtime.ts` |
| Enrollment Packet completion / e-sign return -> Lead activity logging | Partial | Completion explicitly attempts lead activity sync and raises alerts/action-required follow-up when it fails. | Sales view can lag the filed packet unless follow-up succeeds. | `lib/services/enrollment-packets-public-runtime.ts`, `lib/services/sales-lead-activities.ts` |
| Lead activity logging -> Member creation / enrollment resolution | Strong | Canonical lead/member identity resolution is enforced; linked member checks are present. | Low code-path risk; main residual risk is runtime data quality. | `lib/services/sales-lead-activities.ts`, `lib/services/canonical-person-ref.ts` |
| Member creation / enrollment resolution -> Intake Assessment | Strong | Intake creation, response persistence, signature path, and member-file PDF save path are wired. | Live runtime not executed here. | `app/intake-actions.ts`, `lib/services/intake-pof-mhp-cascade.ts` |
| Intake Assessment -> Physician Orders / POF generation | Strong | Draft POF generation and canonical read paths are present. | Depends on deployed RPC/migration health more than app wiring. | `lib/services/intake-pof-mhp-cascade.ts`, `lib/services/physician-orders-supabase.ts` |
| Physician Orders / POF generation -> Provider signature completion | Strong | Request send/resend, public signature flow, events, and signed artifact handling are present. | Delivery and milestone follow-up are not one atomic step. | `lib/services/pof-esign.ts` |
| Provider signature completion -> MHP generation / sync | Partial | Signed POF runs a post-sign cascade that updates MHP and MAR schedule generation. | Cascade can be queued for retry, so "signed" does not always mean downstream ready. | `lib/services/physician-orders-supabase.ts` |
| MHP generation / sync -> MCC visibility | Strong | MCC reads through canonical services and downstream enrollment/MHP mapping hooks are present. | MCC can lag if upstream sync is still queued. | `lib/services/member-command-center-supabase.ts`, `lib/services/enrollment-packet-intake-mapping.ts` |
| MCC visibility -> Care Plan creation / signature workflow | Partial | Care plan core write, signing, version snapshot, review history, and caregiver e-sign path are present. | Caregiver dispatch is still a follow-up step after nurse/admin signature. | `lib/services/care-plans-supabase.ts`, `lib/services/care-plan-esign.ts` |
| Care Plan creation / signature workflow -> MAR generation from POF medications | Strong | MAR generation is actually driven from signed POF, and that wiring is present. | The handoff depends on the POF post-sign cascade completing. | `lib/services/physician-orders-supabase.ts`, `lib/services/mar-workflow.ts` |
| MAR generation from POF medications -> MAR documentation workflow | Strong | Scheduled documentation is RPC-backed into `mar_administrations`; PRN documentation and follow-up flows are service-backed. | Confidence is code-backed, not live-run-backed, because sandbox blocked E2E. | `lib/services/mar-workflow.ts`, `lib/services/mar-prn-workflow.ts`, `supabase/migrations/0121_document_scheduled_mar_administration_rpc.sql` |
| MAR documentation workflow -> Monthly MAR summary or PDF generation | Strong | Monthly report assembly and PDF generation are wired through shared services. | Low code-path risk; depends on underlying MAR data completeness. | `lib/services/mar-monthly-report.ts`, `lib/services/mar-monthly-report-pdf.ts` |
| Monthly MAR summary or PDF generation -> Member Files persistence | Strong | Generated MAR PDFs are saved through canonical member-file service with canonical member resolution. | Live storage verification was blocked by sandbox limitations. | `app/(portal)/health/mar/actions-impl.ts`, `lib/services/member-files.ts` |
| Completion notifications or alerts | Partial | Milestone pipeline dispatches to `user_notifications` and records failure alerts when notification dispatch fails. | Notification delivery is non-blocking, so staff can miss expected alerts even when the parent workflow succeeded. | `lib/services/lifecycle-milestones.ts`, `lib/services/notifications.ts` |

## 3. Critical Failures

### 1. Enrollment Packet downstream completion is still not truly all-or-nothing

- Why it matters: A caregiver can finish and file the packet, but sales lead activity and downstream clinical mapping can still need follow-up afterward.
- Root cause: Filing happens first, then downstream mapping and lead activity sync run afterward with alerts/action-required fallbacks if they fail.
- Exact files:
  - `lib/services/enrollment-packets-public-runtime.ts`
  - `lib/services/enrollment-packet-mapping-runtime.ts`
- Founder impact: staff may think enrollment is fully handed off when sales and clinical follow-up are not actually aligned yet.

### 2. Signed POF does not guarantee immediate MHP and MAR readiness

- Why it matters: A provider can sign, but the next clinical views may still lag if the post-sign sync cascade fails and gets queued.
- Root cause: `runPostSignSyncCascade` is retried through a queue instead of being fully guaranteed inline.
- Exact files:
  - `lib/services/physician-orders-supabase.ts`
- Founder impact: nurses may see a signed order but not yet see fully refreshed MHP/MAR downstream state.

### 3. Notifications are best-effort, not completion-gating

- Why it matters: An important alert can fail silently from the end-user point of view while the main workflow still appears complete.
- Root cause: `recordWorkflowMilestone` catches notification failures, logs/alerts them, and returns `delivered: false` without failing the parent workflow.
- Exact files:
  - `lib/services/lifecycle-milestones.ts`
  - `lib/services/notifications.ts`
- Founder impact: admins and nurses can miss handoff signals unless they also review system alerts or follow-up queues.

### 4. Live workflow validation is still blocked by environment, not completed

- Why it matters: this audit is strong on code-path review but weaker on actual runtime confidence.
- Root cause: both live scripts failed before executing the flows because `esbuild` hit `EPERM spawn`.
- Exact commands:
  - `npm run e2e:enrollment-packet:live`
  - `npm run e2e:pof-sign:live`
- Founder impact: there may still be runtime-only issues that static verification cannot see.

## 4. Canonicality Risks

- I did not find mock persistence, fake runtime fallbacks, or local-storage persistence in the audited lifecycle paths.
- Enrollment Packet send is properly lead-driven and enforces canonical member linkage before sending.
- Member-file persistence uses canonical member resolution before saving generated PDFs.
- The main canonicality risk is not fake data. It is delayed consistency after a valid canonical write already happened.
- The audit runner still misses some real writes because several critical paths go through shared RPCs, barrel exports, or lazy-loaded service modules.

## 5. Schema / Runtime Risks

- I did not find obvious missing lifecycle tables or missing required columns in the audited paths.
- MAR scheduled documentation depends on `rpc_document_scheduled_mar_administration` from `supabase/migrations/0121_document_scheduled_mar_administration_rpc.sql`.
- Care plan snapshot/history persistence depends on shared RPC-backed paths in the care-plan migrations already referenced by the service layer.
- Enrollment packet send/completion also depends on RPC-backed paths. The code fails explicitly when those RPCs are missing, which is good for safety, but it still means schema drift will break the workflow immediately.
- Live runtime verification remains blocked by the `EPERM spawn` sandbox issue, so deployment/runtime-only issues could still exist outside this code review.

## 6. Document / Notification / File Persistence Findings

- Enrollment Packet completion does persist signature artifacts, uploads, and the completed packet artifact into member-file-backed paths.
- Intake, POF, Care Plan, and monthly MAR flows all have explicit file/document persistence logic rather than UI-only success states.
- Monthly MAR PDF generation is correctly followed by canonical save-to-member-files logic, and that save returns an explicit error if file persistence fails.
- Notification delivery is the weakest persistence surface in this lifecycle. The system does attempt to record failure events and alerts, but notification dispatch itself does not gate workflow completion.
- The biggest document/file risk is not missing save code. It is downstream handoff timing after the primary file-producing step already succeeded.

## 7. Fix First

1. Make Enrollment Packet completion visibly `post-processing pending` until downstream mapping and lead activity are either complete or clearly queued for review.
2. Surface POF post-sign sync state in the UI so staff can tell the difference between `signed` and `signed plus MHP/MAR fully synced`.
3. Decide which milestone notifications are required versus optional. For required ones, do not let the workflow look fully complete if notification dispatch failed.
4. Keep the current strong canonical write paths, but tighten staff-facing workflow status so downstream incomplete states are obvious.
5. Unblock live E2E execution in this environment, because this audit has reached the point where the main gap is runtime confirmation rather than missing static wiring.

## 8. Regression Checklist

1. Send an enrollment packet from a real lead and verify the request row, packet events, sent state, and lead activity all persist.
2. Complete the packet from the public link and verify fields, signatures, uploads, completed packet artifact, lead activity, and downstream mapping status for the same canonical lead/member pair.
3. Convert the lead to a member and confirm `members.source_lead_id` stays aligned with the earlier packet flow.
4. Submit intake and verify assessment rows, response rows, signature state, and intake PDF member-file persistence.
5. Send and sign a POF, then verify request rows, signature rows, events, signed artifacts, MHP sync, and MAR schedule generation.
6. Confirm MCC reflects the same member state after MHP sync without manual patching.
7. Create, review, sign, and caregiver-sign a care plan; verify version snapshot, review history, signature events, and saved artifacts.
8. Record scheduled MAR, PRN MAR, and PRN outcome documentation; verify the related `mar_administrations` and PRN follow-up reporting are correct.
9. Generate a monthly MAR PDF and verify it persists to member files and is visible from member-facing file surfaces.
10. Verify notifications and alerts appear for enrollment, POF, care plan, and MAR lifecycle milestones, including failure and retry states.
