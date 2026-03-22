# Workflow Simulation Audit Report
_Generated: 2026-03-22T04:00:00-04:00_
_Repository: D:\Memory Lane App_

## 1. Executive Summary

Overall workflow health: **Partial**

What is working:
- The core lifecycle is real Supabase-backed code, not mock/demo logic.
- Intake, POF signing, MAR documentation, monthly MAR report generation, and member-file persistence are generally wired through canonical services.
- The enrollment packet and POF public flows both use replay-safe/RPC-backed finalization instead of trusting UI-only success.

What is not production-strong enough yet:
- Some important handoffs are still **best-effort after the main workflow already committed**, especially sales lead activity logging and notifications.
- Signed POF completion can return success while downstream MHP/MCC/MAR sync is only **queued for retry**, so staff can see a signed document before medication operations are actually ready.
- The nightly workflow audit config is behind the codebase split into runtime modules, so the automated audit currently reports some false "broken" enrollment-path failures.

Bottom line for a founder:
- Nurses and admins are unlikely to lose the main clinical records.
- The bigger risk is **operational drift after success**: inbox alerts, lead activity logs, and some downstream syncs can lag or fail after the main document/workflow already saved.

## 2. Lifecycle Handoff Table

| Handoff | Status | What I verified | Main risk |
|---|---|---|---|
| Lead -> Send Enrollment Packet | Partial | [`app/sales-enrollment-actions.ts`](D:\Memory Lane App\app\sales-enrollment-actions.ts) calls [`sendEnrollmentPacketRequest`](D:\Memory Lane App\lib\services\enrollment-packets-send-runtime.ts), which resolves canonical lead/member identity, prepares the request via RPC, writes packet events, sends the email, records a workflow milestone, and attempts a lead activity row. | Lead activity and notifications are not atomic with the send. |
| Send Enrollment Packet -> Enrollment Packet completion / e-sign return | Strong | [`app/sign/enrollment-packet/[token]/actions.ts`](D:\Memory Lane App\app\sign\enrollment-packet\[token]\actions.ts) calls [`submitPublicEnrollmentPacket`](D:\Memory Lane App\lib\services\enrollment-packets-public-runtime.ts), which saves progress, uploads artifacts, files the completed packet, writes signatures/uploads, and returns operational readiness status. | Downstream mapping can still fail after filing. |
| Enrollment Packet completion / e-sign return -> Lead activity logging | Partial | Completion tries to write `lead_activities` after filing in [`lib/services/enrollment-packets-public-runtime.ts`](D:\Memory Lane App\lib\services\enrollment-packets-public-runtime.ts). | If that insert fails, the packet still succeeds and sales activity history drifts. |
| Lead activity logging -> Member creation / enrollment resolution | Strong | [`app/sales-lead-actions.ts`](D:\Memory Lane App\app\sales-lead-actions.ts) uses canonical lead resolution and conversion logic; [`lib/services/canonical-person-ref.ts`](D:\Memory Lane App\lib\services\canonical-person-ref.ts) enforces one canonical member via `source_lead_id`. | Low current risk from static review. |
| Member creation / enrollment resolution -> Intake Assessment | Strong | [`app/intake-actions.ts`](D:\Memory Lane App\app\intake-actions.ts) creates the assessment, requires nurse/admin signature, auto-creates draft POF, and saves the intake PDF to member files before returning success. | Failures are explicit, not silently treated as done. |
| Intake Assessment -> Physician Orders / POF generation | Strong | [`autoCreateDraftPhysicianOrderFromIntake`](D:\Memory Lane App\lib\services\intake-pof-mhp-cascade.ts) and [`createDraftPhysicianOrderFromAssessment`](D:\Memory Lane App\lib\services\physician-orders-supabase.ts) create canonical draft POF records tied to intake/member identity. | If draft creation fails, the intake flow returns an error and follow-up task. |
| Physician Orders / POF generation -> Provider signature completion | Strong | [`lib/services/pof-esign-public.ts`](D:\Memory Lane App\lib\services\pof-esign-public.ts) stores signature image + signed PDF, finalizes through RPC, writes member files, and handles replay safety. | Low for core persistence. |
| Provider signature completion -> MHP generation / sync | Partial | Signed POF calls [`processSignedPhysicianOrderPostSignSync`](D:\Memory Lane App\lib\services\physician-orders-supabase.ts), which runs MHP sync and MAR generation, but can downgrade to queued retry instead of immediate completion. | Staff can have a signed POF before MHP/MAR are fully ready. |
| MHP generation / sync -> MCC visibility | Strong | MCC reads canonical member/MHP/attendance/contact data through [`lib/services/member-command-center-supabase.ts`](D:\Memory Lane App\lib\services\member-command-center-supabase.ts). | Main dependency is upstream sync finishing. |
| MCC downstream visibility -> Care Plan creation / signature workflow | Partial | [`lib/services/care-plans-supabase.ts`](D:\Memory Lane App\lib\services\care-plans-supabase.ts) uses RPC-backed care-plan core and snapshot writes; public caregiver signing finalizes through RPC in [`lib/services/care-plan-esign-public.ts`](D:\Memory Lane App\lib\services\care-plan-esign-public.ts). | Root care plan can exist before version-history snapshot or caregiver dispatch fully completes. |
| Care Plan creation / signature workflow -> MAR generation from POF meds | Partial | The real trigger is the **signed POF**, not care plan creation. MAR schedule generation happens in the POF post-sign cascade. | Lifecycle wording and actual trigger differ; operationally, staff should treat signed POF as the MAR source-of-truth trigger. |
| MAR generation from POF meds -> MAR documentation workflow | Strong | [`lib/services/mar-workflow.ts`](D:\Memory Lane App\lib\services\mar-workflow.ts) and [`lib/services/mar-prn-workflow.ts`](D:\Memory Lane App\lib\services\mar-prn-workflow.ts) persist scheduled, PRN, and PRN-outcome documentation in canonical MAR tables with duplicate-safe handling. | Low current risk from static review. |
| MAR documentation workflow -> Monthly MAR summary/PDF generation | Strong | [`app/(portal)/health/mar/actions-impl.ts`](D:\Memory Lane App\app\(portal)\health\mar\actions-impl.ts) builds monthly reports from canonical MAR data and returns explicit errors when generation fails. | Low current risk from static review. |
| Monthly MAR summary/PDF generation -> Member Files persistence | Strong | [`saveGeneratedMemberPdfToFiles`](D:\Memory Lane App\lib\services\member-files.ts) resolves canonical member identity, uploads to storage, and upserts `member_files` through RPC-backed write logic. | Low current risk from static review. |
| Lifecycle milestones -> Notifications / alerts | Partial | [`recordWorkflowMilestone`](D:\Memory Lane App\lib\services\lifecycle-milestones.ts) dispatches inbox notifications through [`lib/services/notifications.ts`](D:\Memory Lane App\lib\services\notifications.ts). | Notification failures are swallowed and logged instead of failing the caller. |

## 3. Critical Failures

### 1. Lead activity logging is still best-effort after enrollment packet send/complete
- Evidence:
  - [`lib/services/enrollment-packet-mapping-runtime.ts`](D:\Memory Lane App\lib\services\enrollment-packet-mapping-runtime.ts) `addLeadActivity` starts at line 88.
  - Send path calls it around line 622 in [`lib/services/enrollment-packets-send-runtime.ts`](D:\Memory Lane App\lib\services\enrollment-packets-send-runtime.ts).
  - Completion path calls it around line 866 in [`lib/services/enrollment-packets-public-runtime.ts`](D:\Memory Lane App\lib\services\enrollment-packets-public-runtime.ts).
- Why it matters:
  - Sales staff can miss "packet sent" or "packet completed" activity history even when the packet itself really went through.
- Root cause:
  - The lead activity write is not part of the same atomic commit as the enrollment packet lifecycle.
- Operational impact:
  - Sales follow-up, handoff visibility, and reporting can drift from real enrollment state.

### 2. Notifications are non-blocking, so real workflow completion can happen without an inbox alert
- Evidence:
  - [`lib/services/lifecycle-milestones.ts`](D:\Memory Lane App\lib\services\lifecycle-milestones.ts):13-29 catches notification failures and converts them into a `notification_dispatch_failed` system event.
- Why it matters:
  - Nurses/admins may not receive the alert that tells them a workflow now needs action, even though the upstream workflow already succeeded.
- Root cause:
  - Notification dispatch is treated as best-effort infrastructure instead of a required completion gate.
- Operational impact:
  - Missed follow-up on enrollment mapping failures, missing documents, or queued downstream sync work.

### 3. Signed POF does not guarantee immediate downstream readiness
- Evidence:
  - [`lib/services/physician-orders-supabase.ts`](D:\Memory Lane App\lib\services\physician-orders-supabase.ts):512-614 queues retry when post-sign sync fails.
  - [`lib/services/pof-esign-public.ts`](D:\Memory Lane App\lib\services\pof-esign-public.ts):388-401 returns `postSignStatus`, `actionNeeded`, and `actionNeededMessage`.
  - [`components/physician-orders/pof-public-sign-form.tsx`](D:\Memory Lane App\components\physician-orders\pof-public-sign-form.tsx):130-157 does surface that queued state in the UI.
- Why it matters:
  - A provider can finish signing while MHP refresh and MAR schedule generation are still pending retry.
- Root cause:
  - The signed artifact is committed first, and downstream clinical sync is allowed to continue asynchronously.
- Operational impact:
  - Staff may assume medication workflows are ready when the system is still catching up.

## 4. Canonicality Risks

- No production mock persistence was found in the scanned lifecycle runtime paths.
- Canonical member identity is enforced in several critical places, especially:
  - [`lib/services/canonical-person-ref.ts`](D:\Memory Lane App\lib\services\canonical-person-ref.ts)
  - [`lib/services/member-files.ts`](D:\Memory Lane App\lib\services\member-files.ts):623-734
  - [`lib/services/enrollment-packets-send-runtime.ts`](D:\Memory Lane App\lib\services\enrollment-packets-send-runtime.ts):206-250
- The main canonicality risk is not fake data. It is **post-commit drift**:
  - lead activity missing after true enrollment progress
  - notification missing after true workflow progress
  - downstream sync queued after true POF signature completion

## 5. Schema / Runtime Risks

- Static repo scan did **not** find missing lifecycle tables or missing lifecycle columns in migrations.
- The main runtime risk exposed by this run is **audit-config drift**, not schema drift:
  - The workflow audit config still points at older enrollment packet/care-plan file locations, so it marks some live handoffs as broken even though the runtime logic moved into split modules.
- This matters because the required nightly audits may create noise and hide the real issues that deserve attention first.

## 6. Document / Notification / File Persistence Findings

### Documents and member files
- Enrollment packet completion stores:
  - uploaded packet files
  - caregiver signature artifact
  - completed packet artifact
  - member file links
  - evidence: [`lib/services/enrollment-packets-public-runtime.ts`](D:\Memory Lane App\lib\services\enrollment-packets-public-runtime.ts)
- Signed POF stores:
  - provider signature image
  - signed PDF
  - member file record
  - evidence: [`lib/services/pof-esign-public.ts`](D:\Memory Lane App\lib\services\pof-esign-public.ts)
- Care plan caregiver signing stores:
  - caregiver signature image
  - final signed PDF
  - final member file record
  - evidence: [`lib/services/care-plan-esign-public.ts`](D:\Memory Lane App\lib\services\care-plan-esign-public.ts)
- Monthly MAR report persists into member files through:
  - [`app/(portal)/health/mar/actions-impl.ts`](D:\Memory Lane App\app\(portal)\health\mar\actions-impl.ts):345-424
  - [`lib/services/member-files.ts`](D:\Memory Lane App\lib\services\member-files.ts):623-734

### Notifications and alerts
- Notification routing is present and Supabase-backed.
- The risk is reliability, not absence:
  - if dispatch fails, the workflow continues and only a workflow/system event records the failure.

## 7. Fix First

1. Make enrollment packet lead-activity logging repairable and visible from the canonical workflow status.
   - Best practical fix: persist a dedicated "lead activity sync status" or queued follow-up record instead of relying on a best-effort insert after commit.

2. Tighten notification durability for action-required events.
   - Best practical fix: for high-severity action-required milestones, create a durable follow-up record and fail loudly when recipient resolution/schema is missing.

3. Make queued POF post-sign sync impossible to ignore in staff workflows.
   - Best practical fix: show queued/failed post-sign status in MCC/MAR entry points, not only on the public signing confirmation.

4. Update the workflow audit config to current runtime file paths.
   - Best practical fix: refresh the workflow simulation skill config so nightly audits stop calling healthy runtime paths "broken."

## 8. Regression Checklist

1. Send an enrollment packet and verify:
   - `enrollment_packet_requests`
   - `enrollment_packet_events`
   - `lead_activities`
   - `user_notifications`

2. Complete the packet from the public link and verify:
   - `enrollment_packet_fields`
   - `enrollment_packet_signatures`
   - `enrollment_packet_uploads`
   - `member_files`
   - completed packet operational readiness is shown correctly

3. Convert the lead to member and verify there is exactly one canonical `members.source_lead_id` link.

4. Submit intake and verify:
   - assessment rows
   - signature rows
   - draft POF exists
   - intake PDF exists in member files

5. Complete provider POF signature and verify:
   - signed PDF row/file exists
   - post-sign status is either synced or visibly queued
   - MHP and MAR readiness are consistent with that status

6. Create/review/sign a care plan and verify:
   - care plan root record
   - snapshot/version history
   - caregiver send state
   - final signed artifact in member files

7. Record scheduled and PRN MAR activity and verify:
   - duplicate-safe behavior
   - PRN outcome persistence
   - milestone/alert behavior

8. Generate monthly MAR PDF and verify the saved artifact appears in member files and MCC file surfaces.

9. Confirm the notifications inbox shows milestone/action-required alerts for:
   - enrollment packet send/failure/follow-up
   - POF follow-up
   - care plan follow-up
   - document/action-required events
