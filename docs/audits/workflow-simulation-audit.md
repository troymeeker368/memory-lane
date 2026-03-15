# Workflow Simulation Audit Report
_Generated: 2026-03-15_
_Repository: D:\Memory Lane App_

## 1. Executive Summary
- Overall workflow health: **Partial**
- What is working well:
  - Lead to member conversion uses canonical lead/member resolution and a single enrollment path.
  - Intake assessment save/sign flows persist to Supabase and save artifacts to Member Files.
  - POF signature completion persists signed records and files through a shared RPC finalization path.
  - MAR documentation and monthly MAR PDF generation persist through canonical services.
- What would still break real operations:
  - Signed POF post-sign sync can queue without any in-repo retry runner, leaving MHP and MAR stale after a provider signs.
  - Enrollment packet downstream mapping is still a multi-table partial-write risk.
  - Intake signature and auto-created draft POF are still not atomic.
  - Notifications are inconsistent. Some milestones create inbox notifications, but several important send/sign/documentation milestones still do not.
  - Live E2E checks did not run successfully on 2026-03-15 because local `esbuild` failed with `EPERM`, so this report is based on static simulation plus direct code verification.

## 2. Lifecycle Handoff Table
| Lifecycle handoff | Status | What I verified |
|---|---|---|
| Lead -> Send Enrollment Packet | Partial | Canonical request, event, and lead activity writes exist. Sender inbox notification is still missing on send. |
| Send Enrollment Packet -> Enrollment Packet completion / e-sign return | Partial | Completion writes packet fields, signatures, uploads, request status, artifacts, and a completion notification. Downstream mapping is still non-transactional. |
| Enrollment Packet completion / e-sign return -> Lead activity logging | Strong | Completion flow explicitly writes lead activity after packet filing. |
| Lead activity logging -> Member creation / enrollment resolution | Strong | Canonical lead/member resolution is enforced before conversion. |
| Member creation / enrollment resolution -> Intake Assessment | Strong | Intake assessment, responses, signature, and PDF persistence are Supabase-backed. |
| Intake Assessment -> Physician Orders / POF generation | Partial | Signed intake can persist before auto-created draft POF succeeds. |
| Physician Orders / POF generation -> Provider signature completion | Partial | Request send/resend and final signed persistence are canonical, but email delivery remains an infrastructure dependency. |
| Provider signature completion -> MHP generation / sync | Weak | Immediate sync exists, but queued retries have no in-repo runner, so downstream clinical state can stay stale. |
| MHP generation / sync -> MCC visibility | Strong | MHP and MCC reads stay on canonical Supabase services. |
| MCC visibility -> Care Plan creation / signature workflow | Partial | Care plan create/review/nurse sign/caregiver sign persist canonically, but milestone notifications are incomplete. |
| Care Plan creation / signature workflow -> MAR generation from POF meds | Strong | MAR is already driven from the signed POF/MHP medication path. The earlier static flag here was a false positive. |
| MAR generation from POF meds -> MAR documentation workflow | Strong | Scheduled and PRN administrations persist to canonical MAR tables. |
| MAR documentation workflow -> Monthly MAR summary or PDF generation | Strong | Monthly summary/PDF generation reads canonical MAR data through shared report services. |
| Monthly MAR summary or PDF generation -> Member Files persistence | Strong | Generated MAR PDFs are saved to Member Files and exposed downstream. |
| Completion notifications or alerts | Weak | Enrollment completion and POF signed notifications exist, but enrollment send, POF send/resend, care plan milestones, and MAR milestones are still incomplete. |

## 3. Critical Failures
- Severity: **High**
  - Title: POF post-sign retry queue has no in-repo runner
  - Why it matters: A provider can sign successfully, but nurses may still see stale MHP or MAR data if the post-sign cascade fails once.
  - Files/functions: `lib/services/physician-orders-supabase.ts` -> `processSignedPhysicianOrderPostSignSync`, `retryQueuedPhysicianOrderPostSignSync`
  - Probable root cause: The queue and retry function exist, but nothing in `app`, `lib`, or `scripts` calls the retry function.
  - Recommended fix: Add a scheduled runner that calls `retryQueuedPhysicianOrderPostSignSync` and alerts on repeated queue failures.
- Severity: **High**
  - Title: Enrollment packet mapping can partially update downstream records
  - Why it matters: A caregiver can complete a packet and still leave MCC, MHP, contacts, Member Files, or POF staging only partly updated.
  - Files/functions: `lib/services/enrollment-packet-intake-mapping.ts` -> `mapEnrollmentPacketToDownstream`
  - Probable root cause: Multi-table writes are executed sequentially with no RPC transaction or rollback path.
  - Recommended fix: Move the downstream mapping/finalization into a transaction-backed RPC or add explicit compensating rollback.
- Severity: **High**
  - Title: Intake can be signed without a draft POF being created
  - Why it matters: Nurses can finish intake and still have no POF draft ready for the next step.
  - Files/functions: `app/actions.ts` -> `createAssessmentAction`; `lib/services/intake-pof-mhp-cascade.ts` -> `autoCreateDraftPhysicianOrderFromIntake`
  - Probable root cause: Intake save/sign happens first, then draft POF creation runs afterward without a shared transaction boundary.
  - Recommended fix: Make intake sign and draft POF creation one atomic workflow or create an explicit failed follow-up state with repair tooling.

## 4. Canonicality Risks
- No fake runtime persistence was found in the audited lifecycle paths.
- The raw static audit reported missing `pof_signatures` and `member_files` writes on POF signing, but direct code review shows those writes are real through `rpc_finalize_pof_signature` in `lib/services/pof-esign.ts` and migration `0037_shared_rpc_standardization_lead_pof.sql`.
- The raw static audit also undercounted care plan file persistence. Direct code review shows nurse signature artifacts and caregiver final signed PDFs are both persisted to Member Files.
- Delivery failures return explicit retryable errors with durable request rows and request URLs. This is not fake success, but it does create a manual operations dependency when email infrastructure is broken.
- `app/(portal)/health/physician-orders/new/page.tsx` still reads `members` directly in the UI for member selection. This is not a write-path bug, but it weakens the canonical service boundary.

## 5. Schema / Runtime Risks
- Required lifecycle tables exist in migrations. I did not find a missing-table blocker in the audited workflow.
- Several schema warnings in the raw script are audit-config drift, not production schema drift:
  - `assessment_responses` uses `field_key`, not `question_key`.
  - `care_plan_sections` uses `section_type`, not `section_key`.
  - `care_plan_review_history` uses `review_date`, not `reviewed_at`.
  - `care_plan_signature_events` and `document_events` use `created_at`, not `occurred_at`.
  - `enrollment_packet_events` uses `timestamp`, not `occurred_at`.
  - MAR tracks PRN outcome with `prn_outcome` plus `v_mar_prn_effective` / `v_mar_prn_ineffective` views, not a `prn_effective` column.
- The workflow simulation skill configuration should be updated so future runs stop reporting these false positives.
- Live E2E validation is still blocked locally by `esbuild` spawn `EPERM`, so runtime proof remains incomplete for this run.

## 6. Document / Notification / File Persistence Findings
- Enrollment packet completion:
  - Completed packet artifacts are persisted to Member Files.
  - Completion also writes an inbox notification to the sender.
- POF signature completion:
  - Signed PDF, `pof_signatures`, `document_events`, and linked Member Files persistence are present through shared RPC finalization.
- Care plan workflow:
  - Nurse e-signature artifact is persisted to Member Files.
  - Caregiver final signed PDF is persisted to Member Files.
  - Care plan send/sign events are logged, but caregiver-sign completion still does not create a user inbox notification.
- MAR workflow:
  - MAR administration writes are canonical.
  - Monthly MAR PDF persistence to Member Files is present.
  - MAR documentation does not currently create inbox notifications or milestone alerts.
- Notification coverage today is real but incomplete:
  - Present: enrollment packet completion, POF signed.
  - Missing or incomplete: enrollment packet send, POF send/resend, care plan send/sign, MAR milestones.

## 7. Fix First
1. Add a real scheduled runner for `retryQueuedPhysicianOrderPostSignSync` so signed POF cascades cannot stay stuck.
2. Move enrollment packet downstream mapping into an atomic RPC or add compensating rollback for partial writes.
3. Make intake sign plus auto-created draft POF one atomic workflow or a queued repairable workflow with explicit failed state.
4. Standardize lifecycle notifications through `recordWorkflowMilestone` so important send/sign/documentation milestones create inbox alerts only after durable persistence.
5. Update the workflow simulation audit config to match current schema names and current workflow ownership.

## 8. Regression Checklist
1. Send an enrollment packet and confirm `enrollment_packet_requests`, `enrollment_packet_events`, and `lead_activities` rows are written.
2. Complete the packet from the public link and confirm signatures, uploads, completed artifact filing, and sender notification.
3. Convert the lead and confirm one canonical member linked by `members.source_lead_id`.
4. Submit intake and confirm `intake_assessments`, `assessment_responses`, signature state, and intake PDF Member File.
5. Force a POF post-sign sync failure, confirm a queued row is written, then run the retry path and confirm MHP/MAR catch up.
6. Dispatch and complete POF signing and confirm `pof_requests`, `pof_signatures`, `document_events`, and signed POF Member File.
7. Confirm signed POF changes appear in MHP and MCC for the same member.
8. Create, nurse-sign, send, and caregiver-sign a care plan; confirm both signature artifacts are saved.
9. Confirm MAR board schedules and documentation still work from the canonical medication source and monthly PDF still files to Member Files.
10. Confirm inbox notifications exist for every lifecycle milestone you intend staff to rely on operationally.
