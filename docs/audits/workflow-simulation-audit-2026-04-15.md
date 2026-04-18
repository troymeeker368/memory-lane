# Workflow Lifecycle Simulation Audit
Generated: 2026-04-15T17:38:46.1814320-04:00
Repository: `D:\Memory Lane App`

## 1. Executive Summary

Overall workflow health: **Fragile**

What is working:
- The main workflows are Supabase-backed. I did not find mock persistence, local JSON, or fake runtime fallbacks in the audited lifecycle paths.
- Typecheck passed.
- Production build passed.

What is not production-strong enough yet:
- Some handoffs are durable but still not operationally complete when the UI returns success.
- One sales handoff still links enrollment packet completion to lead activity by searching free-text notes for the packet id instead of using a schema-backed link.
- Signed POF completion is durable before MHP, MCC, and MAR downstream sync is fully finished, so staff can have a real signed order that is not yet fully reflected downstream.
- Routine MAR documentation events are logged, but they do not all become inbox notifications.
- Signed POF PDFs are still filed under a generic member-file document source instead of a clearly versioned physician-order source.

Most important founder-level takeaway:
- This lifecycle is not “fake.” The writes are real and Supabase-backed.
- The main risk is **degraded completion truth**: several workflows correctly persist the primary record, but still need follow-up work before nurses or admins should treat the handoff as fully done.

## 2. Lifecycle Handoff Table

| Handoff | Status | What I validated | Main risk |
|---|---|---|---|
| Lead -> Send Enrollment Packet | Strong | Canonical send path writes `enrollment_packet_requests`, packet events, and lead activity through service-layer runtime. | Low current risk. |
| Send Enrollment Packet -> Enrollment Packet completion / e-sign return | Partial | Public completion persists packet fields, signatures, uploads, request status, and completed packet artifacts. | Artifact persistence and upload-linking are still multi-step, so repair logic exists because drift can happen after commit. |
| Enrollment Packet completion -> Lead activity logging | Partial | Lead activity is written through canonical packet completion services. | Packet-to-activity linkage is inferred from `lead_activities.notes` text containing the packet id, not a schema-backed foreign key. |
| Lead activity logging -> Member creation / enrollment resolution | Strong | Member enrollment path uses canonical lead/member resolution and `members.source_lead_id` style linkage. | Low current risk in the audited path. |
| Member creation -> Intake Assessment | Partial | Intake assessment creation is RPC-backed and persists responses/signature state; intake PDF is pushed into member files. | Intake can save successfully while e-sign or member-file verification still requires follow-up. |
| Intake Assessment -> Physician Orders / POF generation | Partial | Draft POF creation is wired through `rpc_create_draft_physician_order_from_intake` and canonical physician-order services. | Intake can return committed success while draft POF creation is failed or still needs follow-up verification. |
| Physician Orders / POF generation -> Provider signature completion | Strong | POF send/open/sign flow persists request state, signature artifacts, document events, and member file output through RPC-backed finalization. | Low current risk in the primary committed path. |
| Provider signature completion -> MHP generation / sync | Partial | Signed POF is durably committed first; downstream sync is then processed through the signed-POF post-sign boundary. | Downstream sync can queue after signature commit, so a signed order is not always operationally ready yet. |
| MHP generation / sync -> MCC visibility | Partial | MCC reads are canonical and member identity is resolved correctly. | MCC freshness depends on post-sign sync actually finishing, so queued post-sign work can delay visibility. |
| MCC visibility -> Care Plan creation / signature workflow | Strong | Care plan create/review/sign/caregiver-sign flows are canonical and persist signed artifacts to member files. | Low current risk in the audited path. |
| Care Plan creation / signature workflow -> MAR generation from POF meds | Partial | MAR generation exists and is canonical. | The true trigger is signed POF post-sign sync, not care-plan completion, so this handoff is operationally adjacent rather than a strict causal step. |
| MAR generation from POF meds -> MAR documentation workflow | Strong | Scheduled MAR and PRN documentation are RPC-backed and idempotency-aware. | Low current risk in the primary write path. |
| MAR documentation workflow -> Monthly MAR summary / PDF generation | Strong | Monthly MAR report generation is canonical and returns explicit persistence truth. | Low current risk. |
| Monthly MAR summary / PDF generation -> Member Files persistence | Strong | MAR report PDFs are saved to `member_files` and explicitly report whether persistence was verified. | Low current risk. |
| Completion notifications / alerts | Partial | Enrollment submitted, POF send/fail/signed, care-plan signed, and action-required alerts do create `user_notifications`. | Routine MAR documentation milestones are logged but do not map to inbox notifications. |

## 3. Critical Failures

### 1. Enrollment packet completion is not cleanly linked to lead activity
- Why it matters:
  Sales staff can lose or misread packet completion history if notes text changes, if packet ids are absent from notes, or if repair logic cannot confidently match the right activity.
- Root cause:
  The system writes the `lead_activities` row, but packet linkage is inferred by searching `lead_activities.notes` for the packet id instead of using a first-class schema field.
- Evidence:
  `lib/services/enrollment-packet-completion-cascade.ts`
  `lib/services/enrollment-packet-mapping-runtime.ts`

### 2. Intake can look complete before draft POF is operationally ready
- Why it matters:
  A nurse/admin can finish Intake, but the draft POF may still be failed, queued, or waiting for verification. That breaks the expected clinical handoff.
- Root cause:
  The intake workflow correctly persists the assessment first, then runs draft POF follow-up. Failures are surfaced through readiness state and follow-up tasks, but the workflow is still not truly complete.
- Evidence:
  `app/intake-actions.ts`
  `lib/services/intake-pof-mhp-cascade.ts`
  `lib/services/physician-orders-supabase.ts`

### 3. Signed POF is durable before downstream MHP/MCC/MAR sync is complete
- Why it matters:
  Staff may see “signed” and assume the member is clinically ready, even though MHP, MCC, or MAR may still be queued for retry.
- Root cause:
  The architecture intentionally commits the signed POF first, then runs downstream sync with retry/alert handling. That is safer than losing the signed order, but it means signed does not always equal ready.
- Evidence:
  `lib/services/pof-esign-public.ts`
  `lib/services/pof-post-sign-runtime.ts`
  `lib/services/physician-order-post-sign-service.ts`

## 4. Canonicality Risks

- No mock persistence or fake runtime backends were found in the audited lifecycle path.
- Enrollment packet completed artifact persistence is canonical in `member_files`, but the related `enrollment_packet_uploads` link is a separate write and can still drift.
- Enrollment packet lead activity uses canonical service code, but the packet-specific linkage is not canonical because it relies on free-text notes matching.
- Signed POF member-file persistence is durable and keyed by `pof_request_id`, but the `document_source` is still the generic string `POF E-Sign Signed`, which is weak for long-term physician-order version traceability.
- MAR routine documentation milestones are real workflow events, but not all of them are canonical inbox notifications.

## 5. Schema / Runtime Risks

- The audited lifecycle depends heavily on migration-backed RPCs. If schema cache is stale or migrations are missing, these workflows fail hard:
  - `rpc_create_intake_assessment_with_responses`
  - `rpc_create_draft_physician_order_from_intake`
  - `rpc_finalize_pof_signature`
  - `rpc_finalize_care_plan_caregiver_signature`
  - `rpc_document_scheduled_mar_administration`
- Enrollment packet lead activity still lacks a schema-backed packet link on `lead_activities`.
- The POF finalize path still uses a generic member-file `document_source` in `supabase/migrations/0053_artifact_drift_replay_hardening.sql`.
- The lifecycle uses explicit follow-up queues and alerts in several places. That is safer than silent failure, but it means dashboard truth depends on those queues being monitored and retried.

## 6. Document / Notification / File Persistence Findings

### Documents and files
- Enrollment packet completion:
  The completed packet artifact is persisted canonically to `member_files` and linked back through `enrollment_packet_uploads`. Repair logic exists because the link row can drift even when the member file is real.
- Intake Assessment:
  Intake PDF persistence is real and Supabase-backed. If the member-file verification step is not confirmed, the workflow returns a follow-up-needed state instead of pretending it is done.
- Signed POF:
  The signed PDF and signature image are persisted through the finalize RPC and attached to `member_files`, but the file classification is still too generic for clean physician-order version history.
- Care Plan:
  Caregiver signature finalization returns a concrete `final_member_file_id` and persists the signed artifact before post-sign readiness is advanced.
- Monthly MAR report:
  Report generation and member-file persistence are explicit. The action returns whether `member_files` persistence was actually verified.

### Notifications
- Clearly inbox-backed:
  `enrollment_packet_submitted`, POF send/fail flows, POF signed aliases, care-plan signed aliases, and `action_required` follow-up alerts.
- Not fully inbox-backed:
  Routine `mar_administration_documented` and `mar_prn_followup_completed` activity is logged, but those event types do not map to `user_notifications`. Only the action-required branches do.

## 7. Fix First

1. Add a schema-backed packet link for enrollment-packet lead activity.
   Smallest clean fix: add a dedicated `enrollment_packet_request_id` on `lead_activities` or a dedicated join table, then stop inferring linkage from notes text.

2. Make intake completion truth stricter in the UI/read model.
   Smallest clean fix: keep the current durable write pattern, but surface “saved but not clinically ready” more explicitly anywhere Intake success is shown.

3. Make signed POF readiness impossible to misread.
   Smallest clean fix: keep the durable-first commit, but label queued post-sign sync as “signed, follow-up required” everywhere the order is shown until MHP/MCC/MAR sync is complete.

4. Add canonical notification support for MAR documentation milestones if staff are expected to see them in the inbox.
   Smallest clean fix: add event aliases/content/recipient routing for the exact MAR milestone events you want surfaced.

5. Replace the generic POF member-file `document_source`.
   Smallest clean fix: store a physician-order-version-aware source key instead of the generic `POF E-Sign Signed`.

## 8. Regression Checklist

1. Send an enrollment packet from a real lead and confirm `enrollment_packet_requests`, packet events, and sender-visible notification rows.
2. Complete the packet from the public link and confirm signatures, uploads, completed packet member-file artifact, and packet-upload linkage.
3. Confirm the packet completion creates a lead activity through a schema-backed link, not by notes-text inference.
4. Convert the lead to a member and confirm one canonical member with the right lead linkage.
5. Submit Intake and confirm `intake_assessments`, responses, signature state, and intake PDF member-file persistence.
6. Confirm Intake is not shown as operationally complete if draft POF creation is failed or verification-pending.
7. Send and sign a POF, then confirm request/signature/document/member-file persistence.
8. Confirm a signed POF is not shown as clinically ready until post-sign MHP/MCC/MAR sync completes.
9. Confirm MAR generation uses signed POF medication data and MAR documentation still works for Given, Not Given, PRN effective, and PRN ineffective.
10. Generate a monthly MAR report and confirm verified `member_files` persistence plus expected inbox alerts.
