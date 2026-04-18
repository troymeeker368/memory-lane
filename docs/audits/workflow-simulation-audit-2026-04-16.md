# Workflow Lifecycle Simulation Audit
Generated: 2026-04-16T04:16:00-04:00
Repository: `D:\Memory Lane App`

## 1. Executive Summary

Overall workflow health: **Fragile**

What is working:
- The audited lifecycle is still genuinely Supabase-backed. I did not find runtime mock persistence, local JSON persistence, or fake in-memory completion paths in the lead -> enrollment -> intake -> POF -> care plan -> MAR flow.
- The main write paths remain service-layer or RPC-backed in the highest-risk stages:
  - lead conversion through `app/sales-lead-actions.ts` -> `applyClosedWonLeadConversion(...)`
  - intake -> draft POF through `lib/services/intake-pof-mhp-cascade.ts` -> `lib/services/physician-orders-supabase.ts`
  - POF sign finalization through the shared POF/canonical physician-order services
  - care plan caregiver finalization through `lib/services/care-plan-esign-public.ts`
  - MAR documentation through shared MAR services and RPC-backed writes
- Compared with the 2026-04-15 audit, the codebase still shows the same core risks, but the current read-model/readiness work does make the degraded states more explicit in several places. That is helpful, but it does not remove the underlying handoff truth issues.

What is still not production-strong enough:
- Enrollment packet completion still relies on free-text `lead_activities.notes` matching the packet id instead of a schema-backed packet link. This is the cleanest confirmed canonicality gap in the sales handoff.
- Intake can be durably saved while draft POF verification or intake PDF file verification still needs follow-up. That is safer than fake success, but staff can still misread completion if the UI surfaces only the happy path.
- Signed POF is durable before downstream MHP/MCC/MAR sync is fully finished. The system preserves the signed order correctly, but "signed" still does not always mean "operationally ready."
- Routine MAR documentation milestones are logged, but they still do not map into canonical inbox notifications. Only the action-required branches reliably create inbox work.
- Signed POF member-file persistence is real, but the file lineage is still classified under the generic document source `POF E-Sign Signed`, which is weak for long-term physician-order version traceability.

Most important founder takeaway:
- This workflow is not faking success with non-Supabase persistence.
- The main risk is **handoff truth**: several stages correctly commit the primary record, but downstream work or traceability is still incomplete when a human could reasonably assume the workflow is fully done.

Live E2E note:
- I did not run a live end-to-end write pass against Supabase in this audit because there is no confirmed safe audit dataset/thread for writing real enrollment, intake, and signature records.

## 2. Lifecycle Handoff Table

| Handoff | Status | What I validated | Main risk | Evidence |
|---|---|---|---|---|
| Lead -> Send Enrollment Packet | Strong | Shared send flow persists packet request/event state and lead activity through canonical services. | Low current risk. | `app/sales-enrollment-actions.ts`, `lib/services/enrollment-packets-send-runtime.ts`, `lib/services/enrollment-packet-mapping-runtime.ts` |
| Send Enrollment Packet -> Enrollment Packet completion / e-sign return | Partial | Public completion writes packet fields, signatures, uploads, request status, and completed packet artifacts; follow-up handling exists when post-commit repair is needed. | Completion is durable, but artifact/link repair still exists because post-commit linkage can drift. | `app/sign/enrollment-packet/[token]/actions.ts`, `lib/services/enrollment-packets-public-runtime.ts`, `lib/services/enrollment-packets-public-runtime-follow-up.ts`, `lib/services/enrollment-packet-completion-cascade.ts:183-220` |
| Enrollment Packet completion / e-sign return -> Lead activity logging | Weak | Lead activity is still checked by searching `lead_activities.notes` for the packet id. | Sales history can drift or mis-link because packet lineage is inferred from free text instead of a schema-backed key. | `lib/services/enrollment-packet-completion-cascade.ts:93-107`, `lib/services/enrollment-packet-completion-cascade.ts:145-180`, `lib/services/enrollment-packet-mapping-runtime.ts` |
| Lead activity logging -> Member creation / enrollment resolution | Strong | Lead conversion still resolves canonical lead/member identity and preserves `members.source_lead_id` discipline. | Low current risk in the canonical conversion path. | `app/sales-lead-actions.ts:406-457`, `lib/services/canonical-person-ref.ts`, `supabase/migrations/0034_lead_transition_member_upsert_transaction.sql`, `supabase/migrations/0049_workflow_hardening_constraints.sql` |
| Member creation / enrollment resolution -> Intake Assessment | Partial | Intake writes are real and member-file persistence is explicit. | Intake can be committed while downstream verification still needs follow-up. | `app/(portal)/health/assessment/[assessmentId]/actions.ts`, `lib/services/intake-assessment-esign.ts`, `lib/services/intake-pof-mhp-cascade.ts:457-520`, `lib/services/member-files.ts:701-760` |
| Intake Assessment -> Physician Orders / POF generation | Partial | Draft POF creation is canonical and RPC-backed; this is not a fake write path. | Draft POF can be committed but immediate readback/verification can still require queued follow-up before staff should treat the handoff as ready. | `lib/services/physician-orders-supabase.ts:41-45`, `lib/services/physician-orders-supabase.ts:415-500`, `lib/services/intake-pof-mhp-cascade.ts:401-454`, `supabase/migrations/0055_intake_draft_pof_atomic_creation.sql` |
| Physician Orders / POF generation -> Provider signature completion | Strong | Request/send/sign flows are canonical and produce signed artifacts plus request/signature records. | Low current risk in the primary committed path. | `app/sign/pof/[token]/actions.ts`, `lib/services/pof-esign.ts`, `lib/services/pof-esign-public.ts`, `supabase/migrations/0053_artifact_drift_replay_hardening.sql` |
| Provider signature completion -> MHP generation / sync | Partial | Signed POF is durably committed and then pushed through the post-sign clinical sync boundary. | Signed orders can still be queued/degraded before MHP/MCC/MAR downstream sync finishes. | `lib/services/physician-orders-supabase.ts`, `lib/services/physician-order-post-sign-service.ts`, `lib/services/physician-order-clinical-sync.ts:91-115`, `lib/services/pof-post-sign-runtime.ts` |
| MHP generation / sync -> MCC visibility | Partial | MCC and MHP reads remain canonical and member-id-based. | MCC freshness still depends on post-sign sync completing, so signed order truth can outrun dashboard truth. | `lib/services/member-health-profiles-supabase.ts`, `lib/services/member-command-center-supabase.ts`, `supabase/migrations/0205_fix_signed_pof_sync_member_id_ambiguity.sql`, `supabase/migrations/0206_fix_mhp_sync_member_id_ambiguity.sql` |
| MCC visibility -> Care Plan creation and signature workflow | Strong | Care plan create/review/send/sign paths are canonical and final signed artifacts are persisted with a final member-file id. | Low current risk. | `app/care-plan-actions.ts`, `lib/services/care-plans-supabase.ts`, `lib/services/care-plan-esign.ts`, `lib/services/care-plan-esign-public.ts:228-255`, `lib/services/care-plan-esign-public.ts:753-792` |
| Care Plan creation and signature workflow -> MAR generation from POF medications | Partial | MAR generation is canonical, but it is driven by signed POF medication sync rather than care-plan completion. | The lifecycle sequence is operationally adjacent, not a strict causal handoff. Staff should not assume care-plan completion is what generated MAR. | `lib/services/mar-workflow.ts`, `lib/services/physician-orders-supabase.ts`, `lib/services/physician-order-post-sign-service.ts` |
| MAR generation from POF medications -> MAR documentation workflow | Strong | Scheduled MAR and PRN flows are service-backed, RPC-backed, and idempotency-aware. | Low current risk in the main write path. | `app/(portal)/health/mar/actions-impl.ts`, `lib/services/mar-workflow.ts`, `lib/services/mar-prn-workflow.ts`, `supabase/migrations/0121_document_scheduled_mar_administration_rpc.sql` |
| MAR documentation workflow -> Monthly MAR summary or PDF generation | Strong | Monthly MAR report build/persist path returns explicit persistence truth and audits whether `member_files` verification completed. | Low current risk. | `app/(portal)/health/mar/actions-impl.ts:428-500`, `lib/services/mar-monthly-report.ts`, `lib/services/member-files.ts:701-760` |
| Monthly MAR summary or PDF generation -> Member Files persistence | Strong | Generated MAR PDFs are stored under `member_files` with verified persistence tracking. | Low current risk. | `app/(portal)/health/mar/actions-impl.ts:449-500`, `lib/services/member-files.ts` |
| Completion notifications or alerts | Partial | Core workflow milestones are notification-backed and action-required branches create inbox work. | Routine MAR documentation milestones still do not map to canonical inbox notifications. | `lib/services/lifecycle-milestones.ts:25-31`, `lib/services/lifecycle-milestones.ts:114-130`, `lib/services/notifications-runtime.ts:70-102`, `lib/services/notification-content.ts:75-180`, `lib/services/mar-workflow.ts:237-307`, `lib/services/mar-prn-workflow.ts:672-710` |

## 3. Critical Failures

### 1. Enrollment packet completion is still not packet-linked in a schema-backed way
- Severity: High
- Why it matters:
  Sales staff can see enrollment completion history drift or disappear if the packet id is missing from notes text, edited out, or matched incorrectly.
- Exact files/functions:
  - `lib/services/enrollment-packet-completion-cascade.ts:93-107`
  - `lib/services/enrollment-packet-completion-cascade.ts:145-180`
  - `lib/services/enrollment-packet-mapping-runtime.ts`
- Root cause:
  The system still proves lead activity completion by searching `lead_activities.notes` for the packet id, instead of storing a first-class packet reference on the activity itself.
- Recommended fix:
  Add a schema-backed enrollment-packet reference to `lead_activities` or a dedicated join table, then stop inferring linkage from notes text.

### 2. Intake can be durably saved before the draft POF handoff is truly ready
- Severity: High
- Why it matters:
  A nurse/admin can see a successful Intake outcome even though the draft POF still needs readback verification or queued follow-up. That creates a real operational risk in clinical onboarding.
- Exact files/functions:
  - `lib/services/intake-pof-mhp-cascade.ts:401-454`
  - `lib/services/intake-pof-mhp-cascade.ts:457-520`
  - `lib/services/physician-orders-supabase.ts:415-500`
  - `lib/services/intake-post-sign-readiness.ts`
- Root cause:
  The architecture correctly commits Intake first and then verifies downstream draft POF/file follow-up. That preserves durability, but it still allows "committed" to outrun "operationally ready."
- Recommended fix:
  Keep the durable-first write path, but make every read model/UI that surfaces Intake success treat queued/follow-up-required states as not ready.

### 3. Signed POF still does not mean MHP/MCC/MAR is operationally ready
- Severity: High
- Why it matters:
  Staff can read "signed" as "clinically ready" while downstream sync is still queued, retrying, or failed. That can affect nursing workflow and dashboard trust.
- Exact files/functions:
  - `lib/services/physician-order-clinical-sync.ts:91-115`
  - `lib/services/physician-order-post-sign-service.ts`
  - `lib/services/pof-post-sign-runtime.ts`
  - `lib/services/physician-orders-read.ts`
- Root cause:
  The signed order is committed first, then downstream MHP/MCC/MAR sync runs as follow-up work. This is safer than losing the signed order, but it still creates a readiness gap.
- Recommended fix:
  Preserve the durable-first commit, but make "signed, follow-up required" the default staff-facing truth until post-sign sync is confirmed complete.

### 4. Routine MAR documentation is still not inbox-visible unless it becomes action-required
- Severity: Medium
- Why it matters:
  Routine med-pass documentation is logged, but staff using the notification inbox do not get the same visibility unless the event becomes a high-priority exception.
- Exact files/functions:
  - `lib/services/mar-workflow.ts:237-307`
  - `lib/services/mar-prn-workflow.ts:672-710`
  - `lib/services/notifications-runtime.ts:70-102`
  - `lib/services/notification-content.ts:75-180`
- Root cause:
  The notification alias/content system only canonicalizes core lifecycle milestones plus `action_required`, `*_failed`, and `workflow_error`. `mar_administration_documented` and `mar_prn_followup_completed` are not in that canonical inbox mapping.
- Recommended fix:
  Decide whether routine MAR documentation should create inbox rows. If yes, add canonical event aliases/content/recipient routing for those specific MAR milestone types.

## 4. Canonicality Risks

- No fake persistence was found in the audited lifecycle path. The main records are still written through Supabase-backed actions/services/RPCs.
- Enrollment packet completion still has a non-canonical sales linkage risk because packet completion is reconciled back to lead activity through notes text, not a schema-backed packet reference.
- Signed POF file persistence is canonical in `member_files`, but its `document_source` is still the generic `POF E-Sign Signed`, which weakens version-level traceability for future audits and repairs.
- Several workflows now preserve committed-but-not-ready truth correctly, but the system still depends on follow-up queues and readiness labels to prevent humans from over-trusting early success states.
- The care-plan -> MAR sequence is still conceptually loose in the founder-facing lifecycle. The actual causal generator for MAR remains signed POF medication sync, not care-plan signature.

## 5. Schema / Runtime Risks

- `lead_activities` still lacks a first-class enrollment-packet linkage for the audited completion handoff. That remains the cleanest schema/runtime mismatch affecting real workflow traceability.
- Intake -> draft POF still depends on migration-backed RPC availability and schema cache health:
  - `rpc_create_draft_physician_order_from_intake`
  - `rpc_upsert_physician_order`
- Signed POF downstream readiness depends on queue-backed follow-up infrastructure staying healthy:
  - `pof_post_sign_sync_queue`
  - post-sign retry claim/finalize RPCs
- Enrollment packet completion follow-up depends on queue-backed repair visibility:
  - `enrollment_packet_follow_up_queue`
  - milestone/notification repair paths
- Signed POF member-file classification still comes from migration-defined SQL using `document_source = 'POF E-Sign Signed'` in `supabase/migrations/0053_artifact_drift_replay_hardening.sql:207-245`.
- None of these are mock/fallback problems. They are schema truth, queue health, and traceability problems.

## 6. Document / Notification / File Persistence Findings

### Documents and files
- Enrollment packet completion:
  Completed packet artifacts are persisted canonically and checked against `member_files.enrollment_packet_request_id`. That is a real improvement over fake success, but the system still needs repair logic because artifact linkage can drift after the primary commit.
- Intake Assessment:
  Intake PDF persistence is real and goes through `saveGeneratedMemberPdfToFiles(...)`. If verification fails, the workflow returns a follow-up-needed state instead of pretending the member file is complete.
- Signed POF:
  Signed POF PDFs are persisted to `member_files`, but the stored source key is still generic (`POF E-Sign Signed`) rather than a physician-order-version-aware source string.
- Care Plan:
  Caregiver signature finalization requires and returns a real `final_member_file_id`, which is the right durability boundary for the signed artifact.
- Monthly MAR PDF:
  Monthly MAR generation explicitly saves to `member_files` and returns whether persistence was verified. If verification is not confirmed, it returns `follow-up-needed` instead of `ok`.

### Notifications and alerts
- Clearly inbox-backed today:
  Enrollment packet submitted, Intake completed, POF sent/signed/failed, care-plan signed, and explicit `action_required` follow-up alerts.
- Logged but not fully inbox-backed:
  `mar_administration_documented` and `mar_prn_followup_completed` are recorded as workflow events, but they do not have canonical inbox notification mappings unless the branch escalates into `action_required`.

## 7. Fix First

1. Add a schema-backed enrollment-packet link to lead activity.
   Smallest clean fix: add `enrollment_packet_request_id` to `lead_activities` or a dedicated join table, then remove notes-text packet matching from the completion cascade.

2. Make Intake readiness impossible to over-read.
   Smallest clean fix: anywhere Intake is shown as complete, use the canonical readiness state and show queued/follow-up-required as not operationally ready.

3. Make signed POF readiness impossible to over-read.
   Smallest clean fix: keep the durable-first commit, but show a signed order as "queued/degraded" until MHP/MCC/MAR sync is fully complete.

4. Replace the generic signed-POF `document_source`.
   Smallest clean fix: use a physician-order-version-aware document source so member files, replays, and audits can distinguish one signed order artifact from another.

5. Decide whether routine MAR milestones belong in the inbox.
   If staff are expected to work from the inbox, add canonical notification mappings for the exact MAR events you want surfaced.

## 8. Regression Checklist

1. Send an enrollment packet from a real lead and confirm `enrollment_packet_requests`, packet events, sender notification rows, and lead activity all persist.
2. Complete the packet from the public link and confirm packet fields, signatures, uploads, completed packet artifact, and `member_files.enrollment_packet_request_id` linkage.
3. Confirm packet completion can be traced back to lead activity through a schema-backed packet link, not notes-text inference.
4. Convert the lead to a member and confirm one canonical member exists with correct `members.source_lead_id` linkage and required downstream shells.
5. Complete Intake and confirm `intake_assessments`, responses, signature state, draft POF creation, and intake PDF member-file persistence.
6. Confirm Intake is not shown as ready when draft POF verification or intake PDF verification is still queued/follow-up-required.
7. Send and sign a POF, then confirm request/signature rows, signed PDF persistence, queue state, and downstream MHP/MCC/MAR sync outcome.
8. Confirm a signed POF is not shown as clinically ready until post-sign sync has completed.
9. Confirm MAR generation uses signed POF medication data and MAR documentation still works for Given, Not Given, PRN effective, and PRN ineffective branches.
10. Generate a monthly MAR report and confirm `member_files` persistence truth plus expected notification behavior for the workflow milestones you consider operationally important.
