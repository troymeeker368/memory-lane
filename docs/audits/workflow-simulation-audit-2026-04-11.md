# Workflow Simulation Audit Report
Generated: 2026-04-11
Repository: D:\Memory Lane App

## 1. Executive Summary
Overall lifecycle health is fragile but improving.

The main Supabase-backed writes are still present across the audited workflow. I did not find production-path mock persistence, fake storage fallbacks, or obvious lead/member identity split-brain in the core paths I checked.

The bigger problem now is not fake persistence. The bigger problem is committed success before downstream readiness is restored.

The two highest-risk handoffs are still:
- Intake Assessment -> draft POF creation
- Provider POF signature -> MHP / MCC / MAR downstream sync

Those are the places where staff can have a real saved or signed record, but the next operational step is still degraded.

This run also confirmed:
- `npm run typecheck` passed
- `npm run build` passed
- live end-to-end simulation was not run in this automation pass

## 2. Lifecycle Handoff Table
| Handoff | Status | What this means in plain English |
|---|---|---|
| Lead -> Send Enrollment Packet | Strong | Canonical lead resolution and the shared send path are intact. |
| Send Enrollment Packet -> Enrollment Packet completion / e-sign return | Partial | Packet completion is durable, but mapping, artifact, or follow-up work can still stay open after completion. |
| Enrollment Packet completion / e-sign return -> Lead activity logging | Partial | Lead activity sync is checked, but completion can still require queued follow-up before staff should treat the handoff as fully clean. |
| Lead activity logging -> Member creation / enrollment resolution | Strong | Lead conversion still uses canonical identity resolution and the expected member link path. |
| Member creation / enrollment resolution -> Intake Assessment | Strong | Intake creation and signature persistence are still real Supabase writes with shared service boundaries. |
| Intake Assessment -> Physician Orders / POF generation | Weak | Intake can finish while draft POF creation failed, readback verification is still open, or intake PDF filing still needs follow-up. |
| Physician Orders / POF generation -> Provider signature completion | Strong | Public provider signature is replay-safe, artifact-backed, and canonical. |
| Provider signature completion -> MHP generation / sync | Weak | A signed POF can be durably committed while downstream clinical sync is still queued or failed for retry. |
| MHP generation / sync -> MCC visibility | Partial | MCC visibility depends on the same signed-POF downstream sync completing cleanly. |
| MCC visibility -> Care Plan creation / signature workflow | Strong | Care plan flows use committed-readiness patterns and do not pretend follow-up work is already done. |
| Care Plan creation / signature workflow -> MAR generation from POF medications | Partial | MAR generation is correctly driven by signed POF medications, not care-plan writes, so this lifecycle handoff is only indirectly connected. |
| MAR generation from POF medications -> MAR documentation workflow | Strong | Scheduled and PRN MAR documentation remain on canonical Supabase and RPC-backed write paths. |
| MAR documentation workflow -> Monthly MAR summary or PDF generation | Strong | Monthly MAR reporting reads from canonical MAR data rather than UI-only state. |
| Monthly MAR summary or PDF generation -> Member Files persistence | Strong | Verified member-file persistence is required before the workflow reports clean success. |
| Member Files persistence -> Completion notifications or alerts | Partial | Alerting is stronger than before, but successful delivery still depends on recipient resolution and runner health. |

## 3. Critical Failures
- Intake can be signed while the draft POF is still not operationally ready. See `app/intake-actions.ts`, `lib/services/intake-pof-mhp-cascade.ts`, and `lib/services/intake-post-sign-readiness.ts`.
- Provider POF signature can commit while MHP, MCC, and MAR sync is still queued. See `app/sign/pof/[token]/actions.ts`, `lib/services/pof-post-sign-runtime.ts`, and `lib/services/physician-order-clinical-sync.ts`.
- Enrollment packet completion can finish while lead activity sync, mapping, sender notification, or completed-packet artifact linkage still needs follow-up. See `lib/services/enrollment-packet-completion-cascade.ts` and `lib/services/enrollment-packet-readiness.ts`.
- Queue runners are now production-critical. If retry runners or notification delivery are degraded, several workflows stay in committed-but-not-ready states.

## 4. Canonicality Risks
- No production-path mock persistence or fake storage fallback was found in the audited lifecycle paths.
- Lead/member identity handling looked materially stronger in the reviewed paths. Canonical resolvers and mismatch guards are explicit in the intake, enrollment, POF, and MHP paths.
- The main remaining canonicality risk is consumer drift. Several actions intentionally return committed success while readiness is still `queued_degraded` or `follow_up_required`.
- If any UI, report, or staff workflow treats `ok: true` as "fully ready," staff can move too early even though the real downstream handoff is still degraded.

## 5. Schema / Runtime Risks
- I did not find a new schema-drift blocker in the audited lifecycle paths.
- These workflows are still migration-sensitive around intake RPCs, enrollment packet completion follow-up, physician-order upsert/sign, member-files RPCs, and notification tables.
- Runtime safety still depends on the internal retry runners for signed-POF sync and enrollment completion follow-up.
- This run did not prove live retry execution, live recipient resolution, or live storage links in a real environment. It proved the code paths and build safety, not live operational health.

## 6. Document / Notification / File Persistence Findings
- Enrollment packet completion now does real artifact and member-file repair work before the workflow is treated as cleanly handed off.
- Intake PDF persistence is explicitly verified. Failed verification becomes follow-up work instead of fake success.
- Public POF signature is replay-safe and artifact-backed.
- Care plan caregiver signature still requires final signed member-file truth before the workflow is truly done.
- Monthly MAR PDF generation refuses verified success when member-files persistence is not confirmed.
- Notification delivery truth is stronger now. Missing `user_notifications` rows for required milestones are treated as real follow-up problems instead of silent success.

## 7. Fix First
1. Make every intake-facing and staff-facing workflow use readiness metadata, not just `ok` responses, as the operational source of truth.
2. Make signed-POF queued sync impossible to miss in top-level staff views for MHP, MCC, and MAR-dependent workflows.
3. Surface enrollment packet operational readiness anywhere staff act on completed packets, not only on the completed packets report.
4. Keep tightening intake follow-up visibility around draft POF creation, readback verification, and intake PDF persistence.
5. Treat retry-runner health and notification delivery as release-gating operational dependencies.

## 8. Regression Checklist
1. Send an enrollment packet and verify request rows, events, and notification delivery.
2. Complete the public packet and verify completed artifact creation, member-file linkage, mapping status, and operational readiness.
3. Convert the lead and verify one canonical `members.source_lead_id` path only.
4. Create and sign intake, then verify assessment rows, signature state, draft POF status, and post-sign readiness.
5. If intake returns follow-up-needed, verify the follow-up queue row and staff-visible alert exist before staff proceed.
6. Sign a POF and verify signed artifact, post-sign queue state, MHP refresh, MCC visibility, and MAR schedule generation.
7. Verify MAR supports given, not-given, PRN effective, and PRN ineffective paths with durable persistence.
8. Generate a monthly MAR PDF and verify member-files persistence is confirmed, not just attempted.
9. Complete a care plan caregiver signature and verify final signed member-file truth before treating the workflow as fully ready.
