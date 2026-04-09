# Workflow Lifecycle Simulation Audit
Generated: 2026-04-09

## 1. Executive Summary
Overall workflow health: Partial

Memory Lane is no longer relying on mock persistence or fake runtime records for these core handoffs. The strongest improvement is that enrollment packet filing, POF signature finalization, care plan signature finalization, MAR documentation, and monthly MAR PDF generation all now try to commit the canonical Supabase write first and then surface follow-up work instead of silently pretending the entire cascade succeeded.

The main remaining operational risk is different: several high-risk workflows can return a user-visible success state even when the downstream handoff is still incomplete. In practice, that means staff can see "created" or "signed" while the next operational dependency is still queued for retry or manual follow-up.

The two most important weak points are:
- Intake can finish while draft POF creation is still failed or pending follow-up.
- POF signing can finish while MHP, MCC, and MAR downstream sync is only queued for retry.

## 2. Lifecycle Handoff Table
| Upstream | Downstream | Status | Canonical write/read path | What matters |
|---|---|---|---|---|
| Lead | Send Enrollment Packet | Strong | `app/sales-enrollment-actions.ts` -> `lib/services/enrollment-packets-send-runtime.ts` -> `enrollment_packet_requests` / `enrollment_packet_events` / `lead_activities` | Lead-driven send path enforces canonical lead/member linkage before send. |
| Send Enrollment Packet | Enrollment Packet completion / e-sign return | Strong | `app/sign/enrollment-packet/[token]/actions.ts` -> `lib/services/enrollment-packets-public-runtime.ts` -> finalize RPC + member file artifacts | Completion is persisted first and replay-safe, with explicit error handling if finalization fails. |
| Enrollment Packet completion / e-sign return | Lead activity logging | Partial | `lib/services/enrollment-packets-public-runtime-cascade.ts` -> `lib/services/enrollment-packet-completion-cascade.ts` -> `lead_activities` | Completion can succeed while downstream cascade is marked `action_required`, so sales activity may lag. |
| Lead activity logging | Member creation / enrollment resolution | Strong | `app/sales-lead-actions.ts` -> shared lead conversion service -> `members.source_lead_id` + lead stage update | Canonical lead/member identity handling is explicit and conversion is not inferred from loose fields. |
| Member creation / enrollment resolution | Intake Assessment | Partial | `app/intake-actions.ts` -> `lib/services/intake-pof-mhp-cascade.ts` -> `intake_assessments` / `assessment_responses` / signature rows / `member_files` | Intake row creation is durable, but the action can still return success when signature finalization fails. |
| Intake Assessment | Physician Orders / POF generation | Weak | `lib/services/intake-pof-mhp-cascade.ts` -> `lib/services/physician-orders-supabase.ts` -> `rpc_create_draft_physician_order_from_intake` | Draft POF creation is canonical, but intake still resolves successfully when this handoff fails and only queues follow-up. |
| Physician Orders / POF generation | Provider signature completion | Strong | `app/(portal)/health/physician-orders/actions.ts` / `app/sign/pof/[token]/actions.ts` -> `lib/services/pof-esign-public.ts` -> `pof_requests` / `pof_signatures` / `member_files` | Signed PDF, signature image, request status, and file persistence are handled through RPC-backed finalization. |
| Provider signature completion | MHP generation / sync | Partial | `lib/services/pof-post-sign-runtime.ts` -> `lib/services/physician-order-post-sign-service.ts` | Signature can be durably committed while downstream clinical sync is only queued for retry. |
| MHP generation / sync | MCC visibility | Partial | post-sign sync + `lib/services/member-command-center-supabase.ts` | MCC visibility depends on the post-sign sync completing, so it inherits the retry gap above. |
| MCC visibility | Care Plan creation / signature workflow | Strong | `app/care-plan-actions.ts` / `app/sign/care-plan/[token]/actions.ts` -> care plan services + finalization RPC | Care plan creation, review, send, and caregiver sign all use canonical persistence and signed file IDs. |
| Care Plan creation / signature workflow | MAR generation from POF meds | Partial | canonical trigger is signed POF post-sign sync, not care plan | MAR generation itself is Supabase-backed, but this handoff is indirect because care plan is not the real source-of-truth trigger. |
| MAR generation from POF meds | MAR documentation workflow | Strong | `app/(portal)/health/mar/actions-impl.ts` -> `lib/services/mar-workflow.ts` / `lib/services/mar-prn-workflow.ts` -> RPC + MAR tables | Scheduled and PRN documentation both write through canonical RPC-backed paths with idempotency controls. |
| MAR documentation workflow | Monthly MAR summary or PDF generation | Strong | `app/(portal)/health/mar/actions-impl.ts` -> report builders -> canonical MAR read models | Report generation reads Supabase-backed MAR state and does not fake completion when persistence fails. |
| Monthly MAR summary or PDF generation | Member Files persistence | Strong | `app/(portal)/health/mar/actions-impl.ts` -> `lib/services/member-files.ts` -> `member_files` | Monthly PDF save checks `verifiedPersisted` and returns follow-up-needed instead of fake success. |
| Lifecycle milestones | Notifications / alerts | Partial | `lib/services/lifecycle-milestones.ts` -> `lib/services/notifications.ts` -> `user_notifications` | Notification engine is real and service-role backed, but many workflows do not block success on notification delivery. |

## 3. Critical Failures
### 1. Intake can be "successful" without a usable draft POF
- Why it matters: staff may think clinical intake is complete while physician orders were never created, which blocks provider signature and every downstream medication workflow.
- Evidence:
  - `app/intake-actions.ts` returns `ok: true` after post-sign workflow even when the workflow carries an `actionNeededMessage`.
  - `lib/services/intake-pof-mhp-cascade.ts` catches draft POF creation failure, marks `draftPofStatus` as failed, and queues follow-up instead of failing the overall intake result.
  - `lib/services/physician-orders-supabase.ts` depends on RPC `rpc_create_draft_physician_order_from_intake`, so migration or readback issues break this handoff.
- Root cause: the system preserves the intake write but treats POF creation as a recoverable downstream task instead of a completion requirement.

### 2. POF can be "signed" before MHP, MCC, and MAR are operationally ready
- Why it matters: nurses can believe the signed order is fully live even while profile sync, command-center visibility, or MAR schedule generation is still queued for retry.
- Evidence:
  - `app/sign/pof/[token]/actions.ts` returns `ok: true` with readiness metadata from the post-sign result.
  - `lib/services/pof-post-sign-runtime.ts` explicitly runs a "best effort" follow-up after signature finalization.
  - `lib/services/physician-order-post-sign-service.ts` queues retry and raises `action_required` when downstream sync fails.
- Root cause: signature persistence is atomic, but downstream clinical sync is intentionally asynchronous/retry-based.

## 4. Canonicality Risks Found During Simulation
- No runtime mock persistence was found in the audited workflow paths.
- Canonical identity handling is strong in lead send, lead conversion, MAR member resolution, and member-file writes.
- The main canonicality risk is status drift, not fake data: a committed upstream record can exist while the next canonical consumer has not caught up yet.
- MAR schedule reconciliation is wrapped in both `lib/services/mar-workflow.ts` and `lib/services/mar-workflow-read.ts`; both hit the same RPC, but the duplicated wrapper surface increases drift risk over time.

## 5. Schema / Runtime Risks Exposed by Workflow
- Intake-to-POF depends on migration `0055_intake_draft_pof_atomic_creation.sql`.
- POF signature finalization depends on migration `0053_artifact_drift_replay_hardening.sql`.
- Notification writes depend on migration `0060_notification_workflow_engine.sql`.
- MAR reconciliation depends on `0056_shared_rpc_orchestration_hardening.sql` plus later fixes like `0159_fix_mar_reconcile_generated_day_timestamp_cast.sql`.
- Scheduled MAR documentation depends on `0121_document_scheduled_mar_administration_rpc.sql`.
- Member-files RLS looks materially hardened in `0035_sensitive_domain_rls_hardening.sql`; no obvious open-policy regression was found in this pass.

## 6. Document / Notification / File Persistence Findings
- Enrollment packet completion persists through canonical finalize logic first, then runs downstream mapping. If mapping fails, the system records follow-up instead of inventing completion.
- Intake PDF persistence is guarded by `saveGeneratedMemberPdfToFiles`; if verification is incomplete, the workflow opens a follow-up task instead of claiming the file is safely stored.
- POF signing persists both signature image and signed PDF, and the finalized member-file link is part of the committed boundary.
- Care plan caregiver signing requires a committed `final_member_file_id`, which is the right durability check.
- MAR monthly PDF generation correctly returns `follow-up-needed` when member-file verification is incomplete.
- Notification delivery is real and service-role backed through `user_notifications`, but several caller paths treat notification failure as a repair task rather than a hard stop.

## 7. Fix First
1. Tighten intake completion status so staff do not see intake as complete when draft POF creation failed or still needs follow-up.
2. Tighten POF signature completion messaging and UI so "signed" is visually separated from "operationally synced to MHP/MCC/MAR."
3. Add regression coverage for the degraded-but-committed paths:
   - intake saved, signature failed
   - intake signed, draft POF failed
   - POF signed, post-sign sync retry queued
   - enrollment packet filed, downstream mapping/lead activity follow-up required
4. Consolidate MAR reconcile RPC access behind one shared wrapper to reduce read/write drift risk.
5. Fix the audit runner output path bug that wrote to `docs/audits/docs/audits/...` during this run.

## 8. Regression Checklist
- Send an enrollment packet from a real lead and verify request/event rows plus lead activity in Supabase.
- Complete the packet from the public link and verify signatures, uploads, completed packet artifact, and mapping follow-up state.
- Convert the lead and confirm one canonical member exists with `members.source_lead_id`.
- Create and sign an intake assessment and verify the saved assessment, signature row, draft POF result, and intake PDF member file.
- Sign a POF and confirm the signed file exists plus post-sign sync reaches MHP, MCC, and MAR without queued retry.
- Create and sign a care plan, then confirm the caregiver-signed artifact is present in member files.
- Document one scheduled MAR dose as Given, one as Not Given, and one PRN administration with follow-up outcome.
- Generate a monthly MAR PDF and verify `member_files` persistence is marked verified.
- Open the notifications page and confirm enrollment, POF, care plan, and action-required items appear for the right staff.
