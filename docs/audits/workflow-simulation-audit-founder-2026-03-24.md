# Workflow Simulation Audit Report

## 1. Executive Summary

This lifecycle is more wired than the raw scanner first suggested. The core Supabase-backed write paths for enrollment packets, intake, POF, care plans, MAR, member files, and notifications are present, and several of the "missing write" flags were false positives caused by RPC-backed writes and barrel exports.

The main production risk is not "missing database tables." The main risk is that some downstream handoffs are allowed to fail after the primary workflow step already succeeded. In plain English: the system often saves the main record first, then tries to sync the next stage, create lead activity, or send notifications afterward. When those follow-up steps fail, the code usually raises alerts or queues retry work, but the user-facing workflow can still look complete.

That means the highest-risk operational gaps are:

- Enrollment Packet completion can finish while downstream mapping or sales lead activity still needs follow-up.
- POF signing can finish while MHP or MAR sync is queued for retry.
- Notifications are best-effort in several places, so missing inbox alerts may not block the parent workflow.
- Live end-to-end verification was blocked in this environment by a sandbox `EPERM spawn` error, so this run is strong on code-path validation but not on live runtime confirmation.

## 2. Lifecycle Handoff Table

| Upstream Stage | Downstream Stage | Status | What I Verified | Main Risk |
|---|---|---|---|---|
| Lead | Send Enrollment Packet | Partial | Canonical lead/member checks exist, packet preparation is RPC-backed, packet events and workflow milestones are written. | Lead activity sync and notification delivery are follow-up work, not one atomic transaction. |
| Send Enrollment Packet | Enrollment Packet completion / e-sign return | Partial | Progress save is RPC-backed, signatures/uploads are persisted, completed artifacts are staged into member files, mapping is triggered. | Completion can succeed before downstream mapping and some follow-up persistence fully settle. |
| Enrollment Packet completion / e-sign return | Lead activity logging | Partial | Completion explicitly tries to write lead activity and raises alerts when it cannot. | Sales activity is not guaranteed at the exact same moment packet filing succeeds. |
| Lead activity logging | Member creation / enrollment resolution | Strong | Canonical lead/member resolution is enforced and member conversion is linked through canonical identity. | Main remaining risk is general sales-action error handling outside this specific handoff. |
| Member creation / enrollment resolution | Intake Assessment | Strong | Intake creation, response persistence, signature path, and PDF save-to-files path are all present. | Live runtime was not verified in this sandbox. |
| Intake Assessment | Physician Orders / POF generation | Strong | Intake-to-POF generation is wired through canonical services and POF read paths exist. | Main dependency is deployed RPC/migration health, not missing app wiring. |
| Physician Orders / POF generation | Provider signature completion | Strong | Request send/resend, public signature flow, document events, and milestone logging are present. | Delivery and notification failures are handled after primary writes, not as one atomic step. |
| Provider signature completion | MHP generation / sync | Partial | Signed POF triggers a post-sign cascade that updates MHP and generates MAR schedules. | The cascade can be queued for retry, so signature success does not always mean immediate downstream readiness. |
| MHP generation / sync | MCC visibility | Strong | MCC reads from canonical services and enrollment/MHP mapping paths are present. | If upstream sync is queued, MCC can lag until retry completes. |
| MCC visibility | Care Plan creation / signature workflow | Partial | Care plan core and snapshot writes are RPC-backed, signature events are persisted, caregiver e-sign flow exists. | Caregiver dispatch is follow-up work and can fail after nurse/admin signature already succeeded. |
| Care Plan creation / signature workflow | MAR generation from POF medications | Strong | Signed POF post-sign cascade calls MAR schedule generation; canonical MAR workflow service exists. | The label is slightly misleading because MAR generation is driven by signed POF, not by care plan itself. |
| MAR generation from POF medications | MAR documentation workflow | Strong | Scheduled administration uses a shared RPC into `mar_administrations`; PRN administration and PRN outcome flows are service-backed. | Live runtime could not be executed here, so this is code-backed confidence rather than observed runtime confidence. |
| MAR documentation workflow | Monthly MAR summary or PDF generation | Strong | Monthly MAR data assembly and PDF generation are wired through shared services. | None obvious beyond standard data-quality issues if MAR input is incomplete. |
| Monthly MAR summary or PDF generation | Member Files persistence | Strong | Generated MAR PDF is saved through canonical member-files service with canonical member resolution. | None obvious in code; live storage verification was blocked by sandbox limits. |
| Lifecycle milestones | Notifications / alerts generated | Partial | Workflow milestone pipeline dispatches to `user_notifications` and records failure events/alerts on notification failure. | Notification delivery is intentionally non-blocking, so missing alerts can happen without blocking the parent workflow. |

## 3. Critical Failures

- Enrollment Packet downstream completion is not atomic with downstream sync and sales activity.
  Files: `lib/services/enrollment-packets-public-runtime.ts`, `lib/services/enrollment-packet-mapping-runtime.ts`
  Why it matters: a caregiver can finish the packet, but MCC/MHP/POF staging or lead activity may still require follow-up. That creates operational drift between sales and clinical views.

- POF post-sign downstream sync is retry-queued rather than guaranteed inline.
  Files: `lib/services/physician-orders-supabase.ts`
  Why it matters: a signed physician order may not immediately appear in MHP-driven or MAR-driven downstream views if the post-sign cascade fails and gets queued.

- Notification delivery is best-effort across lifecycle milestones.
  Files: `lib/services/lifecycle-milestones.ts`, `lib/services/notifications.ts`
  Why it matters: admins may miss expected operational alerts even when the underlying workflow succeeded, which is risky in a healthcare operations platform.

- Live workflow tests were blocked by environment, not completed.
  Files: raw live audit artifact in `docs/audits/workflow-simulation-audit-live-2026-03-24.md`
  Why it matters: this audit is strong on code-path validation, but it is not a substitute for an actual live seeded run against the working environment.

## 4. Canonicality Risks

- The raw scanner overstated some failures because it did not follow re-export files or shared RPC boundaries. Enrollment packet, care plan, and MAR writes are often RPC-backed rather than direct `.from("table")` calls.
- Enrollment packet send correctly enforces lead-driven canonical identity and strict lead/member linkage before sending.
- Member file writes use canonical member resolution before storage and row persistence.
- The real canonicality risk is delayed downstream consistency: primary writes are canonical, but some next-step syncs happen after commit and may queue alerts instead of finishing inline.

## 5. Schema / Runtime Risks

- I did not find missing lifecycle tables or obvious missing columns in migrations during the static pass.
- Scheduled MAR documentation depends on `rpc_document_scheduled_mar_administration` from [`supabase/migrations/0121_document_scheduled_mar_administration_rpc.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0121_document_scheduled_mar_administration_rpc.sql).
- Care plan core/snapshot writes depend on shared RPCs declared in [`supabase/migrations/0085_care_plan_diagnosis_relation.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0085_care_plan_diagnosis_relation.sql) and [`supabase/migrations/0054_care_plan_snapshot_atomicity.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0054_care_plan_snapshot_atomicity.sql).
- Enrollment packet progress/save depends on enrollment packet RPC availability; the code fails explicitly if those RPCs are missing, which is good, but it still means deployment/schema drift will break the workflow immediately.
- Live checks failed with sandbox `EPERM spawn`, so I could not confirm whether local runtime setup, env vars, or seed data would expose additional runtime-only problems.

## 6. Document / Notification / File Persistence Findings

- Enrollment Packet completion persists packet events, signature artifacts, uploads, and downstream member-file artifacts. The risk is not "no persistence"; the risk is that some downstream mapping and lead-activity work can still fail after completion.
- Intake, POF, Care Plan, and monthly MAR flows all include explicit document/file persistence paths instead of UI-only success states.
- Member files are guarded by canonical member resolution, which reduces lead/member identity drift in document storage.
- Notifications are generated through the milestone pipeline into `user_notifications`, but notification failure returns a failed milestone result instead of failing the parent workflow.
- The live E2E scripts for enrollment packet and POF signing did not run in this sandbox because `esbuild` could not spawn a child process.

## 7. Fix First

1. Make Enrollment Packet completion visibly "post-processing pending" until downstream mapping and lead activity have either succeeded or been clearly queued in an operational review queue.
2. Surface queued POF post-sign sync state in UI so staff can tell the difference between "signed" and "signed + MHP/MAR fully synced."
3. Decide which notifications are optional versus required. For required alerts, do not let the UI imply the handoff is fully complete when notification dispatch failed.
4. Review catch blocks that return success-like results in operational actions, especially in documentation and sales modules, because they create silent-success risk patterns elsewhere in the platform.

## 8. Regression Checklist

1. Send an enrollment packet from a real lead and confirm the request row, packet events, and sales lead activity all persist.
2. Complete the packet from the public link and confirm packet fields, signatures, uploads, member files, downstream mapping, and lead activity all land for the same canonical member/lead pair.
3. Convert the lead to a member and confirm `members.source_lead_id` stays aligned with the lead record used earlier in the packet flow.
4. Submit intake and confirm assessment rows, responses, signature state, and intake PDF are all saved.
5. Send and sign a POF, then confirm request rows, signature rows, document events, signed artifacts, MHP sync, and MAR schedule generation.
6. Verify MCC reflects the same member state after MHP sync without needing manual data patching.
7. Create, review, sign, and caregiver-sign a care plan; confirm signature events, snapshots, and saved artifacts.
8. Record scheduled MAR, PRN MAR, and PRN outcome documentation; confirm `mar_administrations`-backed reporting reflects each path.
9. Generate a monthly MAR PDF and confirm the PDF is saved to member files and visible from the member-facing file surfaces.
10. Verify notifications and alerts appear for enrollment, POF, care plan, and MAR milestones, including failure/retry states.
