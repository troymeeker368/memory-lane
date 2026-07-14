# Idempotency & Duplicate Submission Audit

Date: 2026-05-10

## 1. Executive Summary

- Overall idempotency safety score: 6/10
- Top duplicate/replay risks:
  - Enrollment packet resend can still reset a completed packet back to `draft`, rotate the token, and append another `sender_staff` signature.
  - POF resend and void can still overwrite a request that was signed after the staff pre-read.
  - Public POF and public care plan replay losers can delete the winner's committed signed artifacts because both attempts use the same canonical storage paths.
  - Generated member PDFs can still orphan duplicate storage blobs when callers reuse a stable `documentSource` without `replaceExistingByDocumentSource`.
- Most stable workflows:
  - Lead creation and lead -> member conversion are DB-idempotent through canonical idempotency keys and one RPC-backed root.
  - Public enrollment packet completion and enrollment upload dedupe are materially replay-safe.
  - Intake finalization, care plan caregiver DB finalization, scheduled MAR, PRN order/administer/follow-up, notifications, audit logs, system events, lead activities, and billing exports all have meaningful dedupe protection.

## 2. Duplicate Record Risks

### Critical: Enrollment packet resend can create duplicate sender signature truth on the same packet

- Workflow: Enrollment packet resend
- Affected files:
  - `lib/services/enrollment-packet-management.ts:239`
  - `lib/services/enrollment-packets-send-runtime.ts:478`
  - `supabase/migrations/0152_enrollment_packet_lifecycle_and_voiding.sql:239`
  - `supabase/migrations/0024_enrollment_packet_workflow.sql:68`
- Duplicate scenario:
  - Staff resends the same packet, or two resend attempts race on the same packet id.
  - The resend path reuses `existingPacketId`, and the prepare RPC always inserts a new `enrollment_packet_signatures` row with `signer_role = 'sender_staff'`.
- Duplicate data created:
  - Multiple `sender_staff` signatures for one canonical packet.
  - Ambiguous staff signature history even though only one current sender signature should matter.
- Recommended protection strategy:
  - Upsert one canonical `sender_staff` row per packet, or add a partial unique index for `signer_role = 'sender_staff'`.

### Medium: Generated member PDFs can still orphan duplicate storage artifacts

- Workflow: Stable generated document saves
- Affected files:
  - `lib/services/member-files.ts:802`
  - `lib/services/member-files.ts:887`
  - `app/(portal)/health/physician-orders/actions.ts:362`
  - `app/(portal)/members/[memberId]/diet-card/actions.ts:36`
  - `app/(portal)/members/[memberId]/name-badge/actions.ts:66`
- Duplicate scenario:
  - The same generator runs twice for the same member and `documentSource`.
  - The non-replace path uploads a new blob first, then the unique `(member_id, document_source)` contract reuses the old row.
- Duplicate data created:
  - Multiple storage blobs for one logical POF form / diet card / name badge.
  - One `member_files` row linked only to the latest blob, leaving prior blobs orphaned.
- Recommended protection strategy:
  - Default these stable generators to `replaceExistingByDocumentSource: true`.
  - On replacement, delete or archive the superseded storage object inside the canonical save path.

## 3. Lifecycle Transition Risks

### Critical: Enrollment packet resend can still regress a completed packet

- Workflow: Enrollment packet resend
- Affected files:
  - `lib/services/enrollment-packet-management.ts:248`
  - `lib/services/enrollment-packets-send-runtime.ts:432`
  - `supabase/migrations/0152_enrollment_packet_lifecycle_and_voiding.sql:165`
- Replay scenario:
  - Staff clicks resend while the caregiver completes the same packet between the app-layer read and the resend RPC.
  - `rpc_prepare_enrollment_packet_request` then blindly resets the existing row to `draft`, clears `completed_at`, rotates the token, and wipes delivery state.
- Risk:
  - Completed truth can be overwritten.
  - A second public submission can be invited for the same canonical packet row.
- Recommended state validation improvement:
  - Add compare-and-set parameters to the prepare RPC and reject reuse once the locked row is `completed`, `voided`, or `expired`.

### Critical: POF resend can still regress a newly signed request

- Workflow: POF resend
- Affected files:
  - `lib/services/pof-esign.ts:496`
  - `lib/services/pof-esign.ts:540`
  - `lib/services/pof-esign.ts:665`
  - `supabase/migrations/0080_pof_request_delivery_rpc_insert_alignment.sql:65`
  - `lib/services/pof-request-runtime.ts:189`
- Replay scenario:
  - Staff opens resend while the provider signs before resend persistence finishes.
  - The prepare RPC rewrites the request to `draft`, clears `sent_at` / `opened_at` / `signed_at`, and rotates the token.
  - The sent-state finalize then runs without `expectedCurrentStatus` or `expectedCurrentDeliveryStatus`.
- Risk:
  - Signed truth can be overwritten.
  - Staff can emit a new live signing link for an already-signed request.
- Recommended state validation improvement:
  - Extend `rpc_prepare_pof_request_delivery` with expected-state guards.
  - Require compare-and-set expectations during resend finalization, not just public open tracking.

### Critical: POF void can still overwrite a request after provider signature

- Workflow: POF void
- Affected files:
  - `lib/services/pof-esign.ts:773`
  - `lib/services/pof-esign.ts:782`
  - `lib/services/pof-request-runtime.ts:189`
  - `supabase/migrations/0098_false_failure_read_path_hardening.sql:67`
- Replay scenario:
  - Staff clicks void on an unsigned request, provider signs before the write lands, then the void still executes.
- Risk:
  - The request can move to `declined` after it was already signed.
  - Request history can become operationally contradictory.
- Recommended state validation improvement:
  - Route void through a dedicated locking RPC or require `expectedCurrentStatus` on the staff void path.

### Medium: Public enrollment packet first-save can still duplicate the `in_progress` transition event

- Workflow: Public enrollment packet progress autosave
- Affected files:
  - `lib/services/enrollment-packets-public-runtime-submission.ts:113`
  - `lib/services/enrollment-packets-public-runtime-submission.ts:153`
  - `supabase/migrations/0154_fix_enrollment_packet_progress_rpc_status_ambiguity.sql:57`
- Replay scenario:
  - Two first-save requests both read the packet before either save commits.
  - Both decide `requestWasAlreadyInProgress = false`, both RPC calls succeed, and both insert `in_progress` events afterward.
- Risk:
  - Timeline duplication and false repeated progress-start history.
- Recommended state validation improvement:
  - Move the first-transition decision into the RPC or add a dedupe contract for one `in_progress` event per packet.

## 4. Public Endpoint Replay Risks

### Critical: Public POF signing is replay-safe at the DB row level but not artifact-safe under concurrent replay

- Workflow: Public POF signing
- Affected files:
  - `lib/services/pof-esign-public.ts:84`
  - `lib/services/pof-esign-public.ts:376`
  - `lib/services/pof-esign-public.ts:472`
  - `supabase/migrations/0053_artifact_drift_replay_hardening.sql:155`
- Replay scenario:
  - The same public token is submitted twice at nearly the same time.
  - Both attempts upload to the same `provider-signature.png` and `signed.pdf` storage paths.
  - The replay loser receives `was_already_signed = true` and then runs cleanup against those exact canonical paths.
- Risk:
  - The winner's committed signature image and signed PDF can be deleted even though the request row is correctly replay-safe.
- Recommended replay protection:
  - Upload to per-attempt temporary paths, then promote only the winning finalize.
  - Never delete canonical artifact paths from a replay-safe `was_already_signed` branch.

### Critical: Public care plan signing has the same replay-loser artifact deletion bug

- Workflow: Care plan caregiver signature
- Affected files:
  - `lib/services/care-plan-esign-public.ts:270`
  - `lib/services/care-plan-esign-public.ts:567`
  - `lib/services/care-plan-esign-public.ts:615`
  - `supabase/migrations/0053_artifact_drift_replay_hardening.sql:426`
- Replay scenario:
  - A caregiver double-submits or refreshes while the first finalize is still completing.
  - Both attempts upload to the same `caregiver-signature.png` and `final-signed.pdf` paths.
  - The replay loser deletes those same paths after the RPC returns `wasAlreadySigned`.
- Risk:
  - `care_plans.final_member_file_id` and the linked member-file row can point at missing storage.
- Recommended replay protection:
  - Use per-attempt temporary artifact paths and only keep/delete attempt-scoped objects.
  - Treat `wasAlreadySigned` as a no-cleanup replay success, not a failure cleanup path.

### Protected: Public enrollment packet completion and raw upload dedupe are materially replay-safe

- Evidence:
  - `supabase/migrations/0152_enrollment_packet_lifecycle_and_voiding.sql:524` returns the committed row when the same consumed token replays.
  - `lib/services/enrollment-packet-artifacts.ts:277` and `supabase/migrations/0165_idempotency_write_roots_and_dedupe_contracts.sql:46` enforce upload dedupe via `upload_fingerprint`.

## 5. Side Effect Duplication Risks

### High: Enrollment packet resend can still send duplicate emails and duplicate prepared/sent events

- Workflow: Enrollment packet resend
- Affected files:
  - `lib/services/enrollment-packets-send-runtime.ts:237`
  - `lib/services/enrollment-packets-send-runtime.ts:518`
  - `lib/services/enrollment-packets-send-runtime.ts:633`
- Risk:
  - Two resend attempts can both rotate the token, both send emails, and both append resend-side events on the same packet.
  - Earlier emails can contain a token immediately replaced by the later resend.
- Recommended protection strategy:
  - Add resend attempt/version or idempotency keys to the staff resend path.
  - Use compare-and-set gating so only one resend wins.

### High: POF resend and void can emit duplicate or wrong downstream events

- Workflow: POF resend / void
- Affected files:
  - `lib/services/pof-esign.ts:582`
  - `lib/services/pof-esign.ts:697`
  - `lib/services/pof-esign.ts:782`
  - `lib/services/pof-request-runtime.ts:152`
- Risk:
  - Retry-driven resend can send multiple provider emails and append extra `resent` / `pof_request_sent` events.
  - A stale void can also append a `declined` event after the request was already signed.
- Recommended protection strategy:
  - Fix compare-and-set guards first.
  - Then add resend/void event dedupe so retries do not rewrite the operational story.

### High: Staff intake and care-plan nurse signature flows can overwrite canonical signature artifacts before the replay-safe lock

- Workflow: Intake assessment nurse/admin sign and care plan nurse/admin sign
- Affected files:
  - `lib/services/clinical-esign-artifacts.ts:72`
  - `lib/services/intake-assessment-esign.ts:408`
  - `lib/services/care-plan-nurse-esign.ts:386`
  - `supabase/migrations/0091_member_files_document_source_unique.sql:53`
- Risk:
  - Concurrent staff submissions can overwrite the stable member-file row and storage object for the canonical signature artifact before the finalize RPC notices the record is already signed.
  - The DB signature row stays single-row, but the saved artifact and uploader metadata can reflect the losing submission.
- Recommended protection strategy:
  - Move the idempotency/terminal-state check ahead of artifact capture, or upload to attempt-scoped temporary objects and only promote the winner after finalization.

### Protected: Notifications, audit logs, system events, lead activities, MAR, PRN, and billing exports are materially hardened

- Evidence:
  - `lib/services/notifications.ts:97` plus `supabase/migrations/0060_notification_workflow_engine.sql:27` protect `event_key`.
  - `lib/services/audit-log-service.ts:17`, `lib/services/system-event-service.ts:35`, and `supabase/migrations/0165_idempotency_write_roots_and_dedupe_contracts.sql:32` protect dedupe-keyed observability writes.
  - `lib/services/sales-lead-activities.ts:239` plus `supabase/migrations/0222_lead_activity_idempotency_hardening.sql:3` protect lead activities.
  - `lib/services/mar-workflow.ts:234`, `lib/services/mar-prn-workflow.ts:421`, `lib/services/mar-prn-workflow.ts:597`, and `lib/services/mar-prn-workflow.ts:672` only emit side effects when `duplicate_safe = false`.
  - `lib/services/billing-exports.ts:79` and `lib/services/billing-exports.ts:252` use a root `idempotency_key` and deduped workflow events.

## 6. Idempotency Hardening Plan

1. Harden enrollment packet resend at the RPC boundary.
   - Add compare-and-set inputs to `rpc_prepare_enrollment_packet_request`.
   - Refuse resend once the locked row is `completed`, `voided`, or `expired`.

2. Harden POF resend and void with expected-current-state enforcement.
   - Extend `rpc_prepare_pof_request_delivery` with terminal-state guards.
   - Require compare-and-set inputs for resend finalization and staff void.

3. Fix public signature artifact cleanup races.
   - Change POF and care plan public signature flows to use attempt-scoped temporary upload paths.
   - Only the winning finalize should promote or retain the canonical artifact path.

4. Make resend-side signatures and events canonical.
   - Upsert one `sender_staff` signature row per enrollment packet.
   - Add resend event dedupe/versioning for enrollment packets and POFs.

5. Close the remaining member-file artifact duplication gap.
   - Default stable generated-document callers to `replaceExistingByDocumentSource: true`.
   - Delete or archive superseded storage objects after a successful replacement.

6. Move staff signature artifact capture behind replay-safe gating.
   - For intake and care-plan nurse signatures, check final signed state before writing the canonical artifact, or use temp upload paths until the finalize RPC wins.
