# Workflow Lifecycle Simulation Audit

## 1. Executive Summary

The raw scanner marked this lifecycle as "Broken", but manual verification shows the real status is closer to **Partial**.

The good news:
- Core Supabase-backed writes do exist across enrollment packets, lead conversion, intake, POF send/sign, care plans, MAR documentation, monthly MAR reporting, member files, and notifications.
- I did **not** find mock persistence, localStorage persistence, or fake runtime data paths in the audited production workflow services.
- The highest-risk workflows generally fail loudly when a required RPC or schema object is missing.

The real operational risks are not "nothing is wired." They are:
- **Enrollment packet completion can commit before every downstream handoff is fully settled.** The packet can be filed while mapping or lead-activity follow-up still needs repair.
- **Signed POF can finish with downstream clinical sync queued instead of fully complete.** That means MHP and MAR can lag behind a successfully signed physician order.
- **Notifications are still best-effort in many paths.** Main workflow writes can succeed even if the notification inbox write fails.
- **Live end-to-end verification is still blocked locally** by `esbuild` / `EPERM spawn`, so this run is based on static simulation plus manual code verification, not full browser proof.

## 2. Lifecycle Handoff Table

| Handoff | Status | What is verified | Main risk |
|---|---|---|---|
| Lead -> Send Enrollment Packet | Partial | Canonical lead/member resolution is enforced and packet request preparation plus packet events are persisted. | Sender notification is best-effort and sales lead activity can fall back to queued repair instead of completing inline. |
| Send Enrollment Packet -> Enrollment Packet completion / e-sign return | Partial | Public progress saves packet fields, public submit stores signature/upload artifacts, saves the completed packet, and finalizes canonical packet state. | Packet filing can finish before every downstream mapping dependency is fully settled. |
| Enrollment Packet completion / e-sign return -> Lead activity logging | Partial | Completion cascade does attempt to write lead activity and will queue follow-up if it fails. | Sales activity visibility is not guaranteed inline with packet completion. |
| Lead activity logging -> Member creation / enrollment resolution | Strong | Lead conversion uses canonical lead/member resolution and writes one canonical member path. | Main remaining risk is downstream lag from upstream sales activity repair, not the conversion path itself. |
| Member creation / enrollment resolution -> Intake Assessment | Strong | Intake creation is RPC-backed, signatures are persisted, and intake PDFs are saved to member files. | No major runtime gap found in this handoff. |
| Intake Assessment -> Physician Orders / POF generation | Strong | Draft POF creation is tied to canonical member and intake data through shared services. | No major runtime gap found in this handoff. |
| Physician Orders / POF generation -> Provider signature completion | Strong | POF request delivery is canonical, signed PDF/member file persistence is replay-safe, and request events are recorded. | Notification delivery is still best-effort after the durable write. |
| Provider signature completion -> MHP generation / sync | Partial | Signed POF does trigger post-sign sync logic for MHP and MAR. | The post-sign cascade can be queued for retry, so the physician order may be signed before MHP/MAR are fully current. |
| MHP generation / sync -> MCC downstream visibility | Strong | MCC reads canonical downstream tables and operational shell creation is wired. | Visibility depends on upstream sync actually finishing; if post-sign sync is queued, MCC can lag. |
| MCC downstream visibility -> Care Plan creation / signature workflow | Partial | Care plan core, sections, versions, review history, caregiver send, caregiver signature events, and final signed file persistence are all wired through canonical services/RPCs. | Nurse/admin signing can commit while caregiver dispatch still needs follow-up. |
| Care Plan creation / signature workflow -> MAR generation from POF meds | Partial | MAR generation is wired and happens from signed POF medication sync. | The named handoff is conceptually misleading: the real trigger is signed POF, not care plan completion. |
| MAR generation from POF meds -> MAR documentation workflow | Strong | Scheduled MAR administration is RPC-backed, and PRN administration/follow-up flows are also persisted canonically. | Notification writes for not-given/ineffective follow-up are best-effort. |
| MAR documentation workflow -> Monthly MAR summary or PDF generation | Strong | Monthly report data is assembled from canonical MAR records and built deterministically. | No major runtime gap found in this handoff. |
| Monthly MAR summary or PDF generation -> Member Files persistence | Strong | MAR monthly PDFs are saved to member files and the action returns an error if file persistence fails. | No major runtime gap found in this handoff. |
| Lifecycle milestones -> Notifications / alerts | Partial | Notifications do write to `user_notifications` through the shared workflow milestone pipeline. | Most workflows do not treat notification failure as a hard workflow failure, so inbox visibility can drift behind real workflow state. |

## 3. Critical Failures

### 1. Signed POF is not always a closed-loop completion

Why it matters:
If a physician signs a POF, staff may assume the member is fully updated. In reality, the code allows MHP/MAR downstream sync to be **queued for retry** instead of guaranteed inline completion. Nurses could see a signed order while MAR schedules or health profile updates are still behind.

Why this happens:
The durable POF signature write completes first, then post-sign downstream sync runs as a follow-up step and can return `queued`.

### 2. Enrollment packet completion is still not a fully atomic operational handoff

Why it matters:
The packet can be fully filed, with artifacts saved, while downstream mapping or lead activity follow-up still needs repair. That is safer than silent success, but it still means admissions staff can have a committed upstream record before every downstream screen is ready.

Why this happens:
The completion flow finalizes the packet first, then runs completion cascade work that can raise action-needed follow-up after the core packet is already committed.

### 3. Notification delivery is not a required success condition in most lifecycle paths

Why it matters:
Admins, nurses, and caregivers may miss operational alerts even when the main workflow already succeeded. That weakens real-world handoffs, especially when follow-up work is required.

Why this happens:
`recordWorkflowMilestone` can return `delivered: false`, but many workflow callers log the error and continue rather than blocking or escalating the parent workflow state.

### 4. Live E2E proof is still blocked locally

Why it matters:
This prevents stronger confirmation that the full browser and environment path works exactly as expected on this machine.

Why this happens:
The live scripts still fail before execution with `esbuild` / `EPERM spawn`.

## 4. Canonicality Risks

- No mock persistence or fake runtime storage was found in the audited production workflow services.
- The lifecycle description "`Care Plan -> MAR generation`" is not the real canonical trigger. The real driver is **signed POF -> medication sync -> MAR generation**.
- Enrollment packet lead activity is canonical when it succeeds, but it is not atomic with send/complete; it can degrade to queued repair.
- Notification writes are shared and canonical, but they are not yet treated as required completion in most parent workflows.
- The raw scanner still overstates failure where Memory Lane uses lazy-loaded runtime services and RPC-backed writes. That is an audit tooling limitation, not proof that the workflows are missing.

## 5. Schema / Runtime Risks

- I did not find obvious missing tables for the audited lifecycle. The major objects referenced by these flows are present in migrations.
- The runtime safety of several handoffs depends on specific RPC migrations being present:
  - enrollment packet request/progress/finalization RPCs
  - care plan core/snapshot/finalization RPCs
  - POF finalization RPC
  - scheduled MAR administration RPC
- The code generally fails explicitly if those RPCs are missing, which is good for production safety.
- The biggest runtime verification gap this run is still the local live-check blocker: `esbuild` / `EPERM spawn` under Node `v24.14.0`.

## 6. Document / Notification / File Persistence Findings

- Enrollment packet public completion stores:
  - caregiver signature artifact
  - uploaded packet documents
  - completed packet artifact
  - `member_files` links for those artifacts
- Signed POF stores:
  - provider signature image
  - signed PDF
  - final member file record
- Care plan caregiver signature stores:
  - caregiver signature image
  - final signed care plan PDF
  - final member file record
- Monthly MAR PDF generation saves directly to `member_files` and returns an explicit error if the save fails.
- Notification persistence exists through `user_notifications`, but operationally it is still best-effort unless a workflow adds its own follow-up alert logic.

## 7. Fix First

1. Tighten the signed POF completion contract so staff cannot treat the workflow as fully done when MHP/MAR sync is still queued.
2. Make enrollment packet follow-up state more visible on the main admissions surfaces when lead activity or downstream mapping did not complete inline.
3. Decide which notifications are operationally required and treat `delivered: false` as an incomplete handoff for those workflows.
4. Align the lifecycle documentation and tests so MAR is explicitly modeled as a signed-POF downstream effect, not a care-plan downstream effect.
5. Fix the local live E2E runner environment so weekly audits can include true runtime confirmation instead of static/manual-only confirmation.

## 8. Regression Checklist

- Send an enrollment packet and confirm `enrollment_packet_requests`, packet events, and sales lead activity all appear for the same canonical lead/member pair.
- Complete the packet from the public link and confirm packet fields, signature, uploads, completed packet artifact, and `member_files` records are present.
- Confirm the completion cascade also updates downstream mapping state and sales lead activity, or raises clear follow-up work if not.
- Convert the lead to a member and confirm only one canonical member path exists for that lead.
- Submit intake and confirm assessment rows, signatures, and member-file PDF persistence.
- Send and sign a POF, then confirm the signed PDF and member file exist before checking whether MHP and MAR are already synced or still queued.
- Verify MCC only reflects the same member identity used throughout the signed POF and MHP records.
- Create, review, sign, and caregiver-sign a care plan; confirm version history, review history, signature events, and final file persistence.
- Document a scheduled MAR dose, a PRN administration, and a PRN effectiveness follow-up; confirm canonical MAR administration persistence.
- Generate a monthly MAR PDF and confirm it lands in member files and is visible from MCC file surfaces.
- Verify milestone notifications appear in the inbox for enrollment, POF, care plan, and MAR paths, and separately verify how the UI behaves when notification delivery fails.
