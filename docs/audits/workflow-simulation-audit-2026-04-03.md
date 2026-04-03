# Workflow Simulation Audit Report

Generated: 2026-04-03
Mode: Static code audit
Scope: Lead -> Enrollment Packet -> Intake -> POF -> MHP/MCC -> Care Plan -> MAR -> Member Files -> Notifications

## 1. Executive Summary

Overall workflow health: `Partial`

What is solid:
- The main operational backbone is now Supabase-backed across the audited lifecycle. I did not find mock persistence, `localStorage`, or fake runtime fallback in these production workflow paths.
- The highest-risk write paths are mostly going through canonical service/RPC boundaries instead of direct UI writes.
- Several workflows now correctly distinguish "committed" from "operationally ready", which is a real safety improvement over silent fake-success patterns.

What still puts real operations at risk:
- A signed POF can be committed while downstream MHP and MAR sync is only queued for retry, so staff can have a signed order that is not yet fully live downstream.
- Normal lifecycle notifications can resolve zero recipients and still be treated as delivered, unless the event is `action_required`, `*_failed`, or `workflow_error`.
- Enrollment packet completion can succeed while lead activity sync fails and is only queued for follow-up, so sales staff may not immediately see the completion.
- Monthly MAR PDF generation can return `ok: true` even when the canonical `member_files` row is still only `follow-up-needed`.

Bottom line in plain English:
- The system mostly writes the right records to Supabase now.
- The biggest remaining problem is not fake persistence.
- The biggest remaining problem is "the core record committed, but the next operational handoff still needs follow-up."

## 2. Lifecycle Handoff Table

| Handoff | Status | Canonical write / read path | What I verified | Main risk |
|---|---|---|---|---|
| Lead -> Send Enrollment Packet | Strong | [`app/sales-enrollment-actions.ts`](/D:/Memory%20Lane%20App/app/sales-enrollment-actions.ts), [`lib/services/enrollment-packets-send-runtime.ts`](/D:/Memory%20Lane%20App/lib/services/enrollment-packets-send-runtime.ts), [`lib/services/enrollment-packets-listing.ts`](/D:/Memory%20Lane%20App/lib/services/enrollment-packets-listing.ts) | Send action routes through canonical runtime service and listing reads back from Supabase-backed packet tables. | Low risk from code path reviewed. |
| Send Enrollment Packet -> Enrollment Packet completion / e-sign return | Strong | [`app/sign/enrollment-packet/[token]/actions.ts`](/D:/Memory%20Lane%20App/app/sign/enrollment-packet/[token]/actions.ts), [`lib/services/enrollment-packets-public-runtime.ts`](/D:/Memory%20Lane%20App/lib/services/enrollment-packets-public-runtime.ts), [`lib/services/enrollment-packet-completion-cascade.ts`](/D:/Memory%20Lane%20App/lib/services/enrollment-packet-completion-cascade.ts) | Public completion persists fields, signatures, uploads, request status, mapping state, and completed-packet artifact checks. | Low risk from the audited path. |
| Enrollment Packet completion / e-sign return -> Lead activity logging | Partial | [`lib/services/enrollment-packet-completion-cascade.ts`](/D:/Memory%20Lane%20App/lib/services/enrollment-packet-completion-cascade.ts), [`lib/services/enrollment-packet-mapping-runtime.ts`](/D:/Memory%20Lane%20App/lib/services/enrollment-packet-mapping-runtime.ts), [`lib/services/sales-crm-supabase.ts`](/D:/Memory%20Lane%20App/lib/services/sales-crm-supabase.ts) | Completion cascade calls `syncEnrollmentPacketLeadActivityOrQueue(...)`. | If lead activity insert fails, the packet still completes and the sales follow-up is only queued, not guaranteed immediately visible. |
| Lead activity logging -> Member creation / enrollment resolution | Strong | [`app/sales-lead-actions.ts`](/D:/Memory%20Lane%20App/app/sales-lead-actions.ts), [`lib/services/sales-lead-conversion-supabase.ts`](/D:/Memory%20Lane%20App/lib/services/sales-lead-conversion-supabase.ts), [`lib/services/canonical-person-ref.ts`](/D:/Memory%20Lane%20App/lib/services/canonical-person-ref.ts) | Lead conversion uses canonical lead/member resolution and preserves `members.source_lead_id`. | Main risk is duplicate canonical links, but the resolver now fails explicitly if multiple members point at one lead. |
| Member creation / enrollment resolution -> Intake Assessment | Partial | [`app/intake-actions.ts`](/D:/Memory%20Lane%20App/app/intake-actions.ts), [`lib/services/intake-pof-mhp-cascade.ts`](/D:/Memory%20Lane%20App/lib/services/intake-pof-mhp-cascade.ts), [`lib/services/intake-assessment-esign.ts`](/D:/Memory%20Lane%20App/lib/services/intake-assessment-esign.ts) | Intake creation is canonical, signature finalization is RPC-backed, and identity must resolve to both canonical member and lead. | Intake can commit while PDF member-file persistence is only `follow-up-needed`, so the clinical record exists but document filing may still need staff follow-up. |
| Intake Assessment -> Physician Orders / POF generation | Partial | [`lib/services/intake-pof-mhp-cascade.ts`](/D:/Memory%20Lane%20App/lib/services/intake-pof-mhp-cascade.ts), [`lib/services/physician-orders-supabase.ts`](/D:/Memory%20Lane%20App/lib/services/physician-orders-supabase.ts), [`supabase/migrations/0055_intake_draft_pof_atomic_creation.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0055_intake_draft_pof_atomic_creation.sql) | There is a real RPC-backed draft POF creation path from signed intake. The earlier auto-report marked this broken, but the code now clearly uses `rpc_create_draft_physician_order_from_intake`. | If immediate readback cannot verify the committed draft, the system downgrades to follow-up-needed instead of full readiness. Safe, but not fully operational. |
| Physician Orders / POF generation -> Provider signature completion | Strong | [`app/(portal)/health/physician-orders/actions.ts`](/D:/Memory%20Lane%20App/app/(portal)/health/physician-orders/actions.ts), [`lib/services/pof-esign.ts`](/D:/Memory%20Lane%20App/lib/services/pof-esign.ts), [`lib/services/pof-esign-public.ts`](/D:/Memory%20Lane%20App/lib/services/pof-esign-public.ts) | Send/resend and public signature completion are tied to canonical request rows, signed PDF artifacts, and replay-safe finalization. | Low risk in the audited path. |
| Provider signature completion -> MHP generation / sync | Partial | [`app/sign/pof/[token]/actions.ts`](/D:/Memory%20Lane%20App/app/sign/pof/[token]/actions.ts), [`lib/services/pof-post-sign-runtime.ts`](/D:/Memory%20Lane%20App/lib/services/pof-post-sign-runtime.ts), [`lib/services/physician-orders-supabase.ts`](/D:/Memory%20Lane%20App/lib/services/physician-orders-supabase.ts) | Signed POF calls `processSignedPhysicianOrderPostSignSync(...)` and explicitly returns `operationallyReady: false` when downstream sync is queued. | This is the highest operational risk: a provider signature can be committed while MHP and MAR are not yet fully updated. |
| MHP generation / sync -> MCC downstream visibility | Strong | [`lib/services/member-health-profiles-supabase.ts`](/D:/Memory%20Lane%20App/lib/services/member-health-profiles-supabase.ts), [`lib/services/member-command-center-supabase.ts`](/D:/Memory%20Lane%20App/lib/services/member-command-center-supabase.ts) | MCC reads through canonical member services and explicitly resolves canonical member identity. | Visibility depends on the upstream sync actually finishing; the read side itself looks sound. |
| MCC visibility -> Care Plan creation / signature workflow | Strong | [`app/care-plan-actions.ts`](/D:/Memory%20Lane%20App/app/care-plan-actions.ts), [`lib/services/care-plans-supabase.ts`](/D:/Memory%20Lane%20App/lib/services/care-plans-supabase.ts), [`lib/services/care-plan-esign.ts`](/D:/Memory%20Lane%20App/lib/services/care-plan-esign.ts), [`lib/services/care-plan-esign-public.ts`](/D:/Memory%20Lane%20App/lib/services/care-plan-esign-public.ts) | Care plan creation, review, nurse sign, caregiver sign, and final signed artifact filing are all using canonical services and RPC-backed finalization. | Low risk in the core persistence path. |
| Care Plan creation / signature workflow -> MAR generation from POF meds | Weak | [`lib/services/mar-workflow.ts`](/D:/Memory%20Lane%20App/lib/services/mar-workflow.ts), [`lib/services/physician-orders-supabase.ts`](/D:/Memory%20Lane%20App/lib/services/physician-orders-supabase.ts), [`lib/services/pof-post-sign-runtime.ts`](/D:/Memory%20Lane%20App/lib/services/pof-post-sign-runtime.ts) | The code itself says signed POF, not care plan completion, is the canonical trigger for MAR medication/schedule sync. | The lifecycle sequence is easy to misunderstand. Care plan completion does not guarantee MAR readiness. Signed POF sync does. |
| MAR generation from POF meds -> MAR documentation workflow | Strong | [`app/(portal)/health/mar/actions-impl.ts`](/D:/Memory%20Lane%20App/app/(portal)/health/mar/actions-impl.ts), [`lib/services/mar-workflow.ts`](/D:/Memory%20Lane%20App/lib/services/mar-workflow.ts), [`lib/services/mar-prn-workflow.ts`](/D:/Memory%20Lane%20App/lib/services/mar-prn-workflow.ts), [`supabase/migrations/0121_document_scheduled_mar_administration_rpc.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0121_document_scheduled_mar_administration_rpc.sql) | Scheduled and PRN documentation are RPC-backed, duplicate-safe, and do not use fake local fallback. | Low risk from the audited path. |
| MAR documentation workflow -> Monthly MAR summary or PDF generation | Strong | [`app/(portal)/health/mar/report-actions.ts`](/D:/Memory%20Lane%20App/app/(portal)/health/mar/report-actions.ts), [`app/(portal)/health/mar/actions-impl.ts`](/D:/Memory%20Lane%20App/app/(portal)/health/mar/actions-impl.ts), [`lib/services/mar-monthly-report.ts`](/D:/Memory%20Lane%20App/lib/services/mar-monthly-report.ts), [`lib/services/mar-monthly-report-pdf.ts`](/D:/Memory%20Lane%20App/lib/services/mar-monthly-report-pdf.ts) | Report assembly and PDF generation are read-heavy but deterministic and Supabase-backed. | Main risk is in the filing step after generation, not in building the report itself. |
| Monthly MAR summary or PDF generation -> Member Files persistence | Partial | [`app/(portal)/health/mar/actions-impl.ts`](/D:/Memory%20Lane%20App/app/(portal)/health/mar/actions-impl.ts), [`lib/services/member-files.ts`](/D:/Memory%20Lane%20App/lib/services/member-files.ts), [`lib/services/member-command-center-supabase.ts`](/D:/Memory%20Lane%20App/lib/services/member-command-center-supabase.ts) | The code now does a real `member_files` persistence attempt and exposes `memberFilesStatus`. | The action still returns `ok: true` when `verifiedPersisted` is false, so a UI can overstate success unless it explicitly checks `memberFilesStatus`. |
| Completion notifications / alerts | Partial | [`lib/services/lifecycle-milestones.ts`](/D:/Memory%20Lane%20App/lib/services/lifecycle-milestones.ts), [`lib/services/notifications.ts`](/D:/Memory%20Lane%20App/lib/services/notifications.ts), [`lib/services/notifications-runtime.ts`](/D:/Memory%20Lane%20App/lib/services/notifications-runtime.ts) | Action-required and failure events create follow-up alerts when no recipients are resolved. | Ordinary completion milestones like `intake_completed`, `pof_sent`, `pof_signed`, and `care_plan_signed` can still resolve zero recipients and be treated as delivered. |

## 3. Critical Failures

### 1. Signed POF can complete while downstream clinical sync is only queued

Severity: High

Why it matters:
- A nurse or admin can see that the provider signed the order.
- But the MHP and MAR downstream state may still not be ready.
- In real operations, that creates a dangerous "signed but not fully live" gap.

Exact files/functions:
- [`app/sign/pof/[token]/actions.ts`](/D:/Memory%20Lane%20App/app/sign/pof/[token]/actions.ts)
- [`lib/services/pof-esign-public.ts`](/D:/Memory%20Lane%20App/lib/services/pof-esign-public.ts)
- [`lib/services/pof-post-sign-runtime.ts`](/D:/Memory%20Lane%20App/lib/services/pof-post-sign-runtime.ts)
- [`lib/services/physician-orders-supabase.ts`](/D:/Memory%20Lane%20App/lib/services/physician-orders-supabase.ts)
- [`app/api/internal/pof-post-sign-sync/route.ts`](/D:/Memory%20Lane%20App/app/api/internal/pof-post-sign-sync/route.ts)

Probable root cause:
- The architecture intentionally commits the signature first, then runs downstream sync.
- If downstream sync fails, it queues retry instead of rolling back the signature.

Why this is still acceptable architecture-wise:
- It is safer than faking a rollback after a committed external signature.
- The issue is not the queue itself.
- The issue is whether staff can clearly see that the order is not fully operational yet.

Recommended fix:
- Keep the queue.
- Make every staff-facing surface treat `postSignStatus: "queued"` as not operationally ready.
- Verify the internal post-sign sync runner is actually configured and monitored.

### 2. Normal milestone notifications can disappear without hard failure

Severity: High

Why it matters:
- Staff may never be notified that a packet was submitted, intake was signed, or a care plan was completed.
- That creates missed handoffs even when the database write succeeded.

Exact files/functions:
- [`lib/services/lifecycle-milestones.ts`](/D:/Memory%20Lane%20App/lib/services/lifecycle-milestones.ts)
- [`lib/services/notifications.ts`](/D:/Memory%20Lane%20App/lib/services/notifications.ts)
- [`lib/services/notifications-runtime.ts`](/D:/Memory%20Lane%20App/lib/services/notifications-runtime.ts)

Probable root cause:
- `recordWorkflowMilestone(...)` only treats notification delivery as required truth for `action_required`, `*_failed`, and `workflow_error`.
- For ordinary lifecycle completions, zero resolved recipients still ends up looking successful enough.

Recommended fix:
- Expand explicit-delivery truth to the core operational milestones, at minimum:
- `enrollment_packet_submitted`
- `intake_completed`
- `pof_sent`
- `pof_signed`
- `care_plan_signed`

### 3. Enrollment packet completion can succeed before sales activity is visible

Severity: Medium-High

Why it matters:
- Caregiver completion may be real, but the sales team may not see it immediately on the lead timeline.
- That creates avoidable follow-up mistakes.

Exact files/functions:
- [`lib/services/enrollment-packet-completion-cascade.ts`](/D:/Memory%20Lane%20App/lib/services/enrollment-packet-completion-cascade.ts)
- [`lib/services/enrollment-packet-mapping-runtime.ts`](/D:/Memory%20Lane%20App/lib/services/enrollment-packet-mapping-runtime.ts)

Probable root cause:
- Lead activity sync is treated as a post-commit step and can degrade to queued follow-up.

Recommended fix:
- Keep the queue fallback.
- Surface `leadActivitySynced: false` as explicit staff follow-up, not just a background technical detail.

## 4. Canonicality Risks

- I did not find runtime mock persistence in the audited lifecycle code.
- Canonical lead/member identity resolution is materially better now. The lead conversion and downstream intake paths are using shared canonical resolvers rather than guessing IDs locally.
- The biggest remaining canonicality risk is not identity mismatch. It is operational state mismatch:
- A workflow can be committed in Supabase while the next dependent handoff is still queued or marked follow-up-needed.
- The weakest conceptual handoff is Care Plan -> MAR. The code correctly treats signed POF as the true canonical trigger, but the business sequence can still encourage the wrong assumption.

## 5. Schema / Runtime Risks

- Live verification did not run because the local app was not reachable on `http://localhost:3001`.
- Intake -> draft POF depends on [`supabase/migrations/0055_intake_draft_pof_atomic_creation.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0055_intake_draft_pof_atomic_creation.sql). The code now fails explicitly if that RPC is missing.
- POF signing finalization depends on [`supabase/migrations/0053_artifact_drift_replay_hardening.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0053_artifact_drift_replay_hardening.sql).
- Scheduled MAR documentation depends on [`supabase/migrations/0121_document_scheduled_mar_administration_rpc.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0121_document_scheduled_mar_administration_rpc.sql).
- Notification persistence depends on the `user_notifications` schema path enforced in [`lib/services/notifications.ts`](/D:/Memory%20Lane%20App/lib/services/notifications.ts).
- Signed POF retry processing depends on the internal runner endpoint in [`app/api/internal/pof-post-sign-sync/route.ts`](/D:/Memory%20Lane%20App/app/api/internal/pof-post-sign-sync/route.ts). If its secret or cron configuration is missing, queued clinical sync rows can stall.

## 6. Document / Notification / File Persistence Findings

- Intake Assessment PDF:
- Good: the workflow saves through [`lib/services/member-files.ts`](/D:/Memory%20Lane%20App/lib/services/member-files.ts) and explicitly queues follow-up when `verifiedPersisted` is false.
- Risk: the assessment can be clinically committed while the file-record verification still needs follow-up.

- Signed POF artifact:
- Good: public POF signature flow requires canonical signed PDF/member file finalization and uses replay-safe verification before treating the request as done.
- Risk: post-sign clinical sync can still be queued after the signed artifact is already committed.

- Care Plan signed artifact:
- Good: caregiver signature finalization requires a real `finalMemberFileId`; if post-commit readiness work fails, the result returns `actionNeeded` instead of pretending everything is complete.
- Risk: staff still need a clear UI indicator that "signed" is not always the same as "fully ready."

- Monthly MAR PDF:
- Good: there is now a real member-files persistence attempt and a `memberFilesStatus` result.
- Risk: the action still returns `ok: true` when the storage upload finished but canonical `member_files` verification did not.

- Notifications:
- Good: `action_required` and failure events raise follow-up alerts when no recipient rows are created.
- Risk: ordinary completion milestones can still quietly notify nobody.

## 7. Fix First

1. Tighten notification truth rules in [`lib/services/lifecycle-milestones.ts`](/D:/Memory%20Lane%20App/lib/services/lifecycle-milestones.ts) so zero-recipient delivery is not treated as acceptable for core lifecycle completions.
2. Verify and monitor the POF post-sign sync runner in [`app/api/internal/pof-post-sign-sync/route.ts`](/D:/Memory%20Lane%20App/app/api/internal/pof-post-sign-sync/route.ts). This is the most important downstream handoff for clinical readiness.
3. Surface queued lead-activity sync after packet completion as explicit operational follow-up on the lead/member screens.
4. Make monthly MAR PDF filing use the same "committed but not operationally ready" pattern already used in intake, POF, and care plan workflows.
5. Add one regression that covers the highest-risk chain end-to-end: signed intake -> draft POF -> provider signature -> queued or synced MHP/MAR state -> staff-facing readiness indicator.

## 8. Regression Checklist

1. Send an enrollment packet from a real lead and verify `enrollment_packet_requests` and `enrollment_packet_events` rows exist.
2. Complete the packet from the public link and verify fields, signatures, uploads, completed artifact filing, and mapping rows.
3. Confirm packet completion writes visible lead activity, or clearly raises a queued follow-up if it cannot.
4. Convert the lead to a member and verify one canonical member is linked through `members.source_lead_id`.
5. Create and sign intake assessment and verify assessment rows, signature rows, and explicit post-sign readiness state.
6. Verify signed intake auto-creates a draft POF or explicitly marks draft-POF follow-up needed.
7. Send and sign the POF and verify the signed artifact exists before treating the order as operationally ready.
8. Verify `postSignStatus` becomes `synced` before trusting MHP or MAR downstream state.
9. Verify MCC reads the same member’s updated clinical/profile state after sync.
10. Create, review, and sign a care plan, then complete caregiver signature and verify `finalMemberFileId` exists.
11. Verify MAR schedules were generated from signed POF medications, not from care-plan completion alone.
12. Document a scheduled dose as Given and Not Given, then document PRN administration and PRN effectiveness/ineffectiveness.
13. Generate the monthly MAR PDF and verify both the storage artifact and canonical `member_files` row.
14. Verify notification inbox rows were actually created for the milestones staff depend on, not just for failures.
