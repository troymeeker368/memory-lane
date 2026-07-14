# Idempotency & Duplicate Submission Audit

Date: 2026-05-09

## 1. Executive Summary

- Overall idempotency safety score: 7/10
- Highest-risk gaps:
  - Enrollment packet resend can reset a packet row back to `draft` if the caregiver completes it between the staff pre-read and the resend prepare RPC.
  - POF resend and void flows can overwrite a request that was signed after the staff pre-read but before the resend/void write executes.
  - Public enrollment packet first-save progress can emit duplicate `in_progress` timeline rows under concurrent saves.
- Most stable workflows:
  - Lead creation uses DB-backed `idempotency_key` enforcement in [`lib/services/sales-crm-supabase.ts`](D:/Memory%20Lane%20App/lib/services/sales-crm-supabase.ts) and [`supabase/migrations/0165_idempotency_write_roots_and_dedupe_contracts.sql`](D:/Memory%20Lane%20App/supabase/migrations/0165_idempotency_write_roots_and_dedupe_contracts.sql).
  - Lead -> member conversion uses an idempotency root plus one canonical RPC path in [`lib/services/sales-lead-conversion-supabase.ts`](D:/Memory%20Lane%20App/lib/services/sales-lead-conversion-supabase.ts) and [`supabase/migrations/0165_idempotency_write_roots_and_dedupe_contracts.sql`](D:/Memory%20Lane%20App/supabase/migrations/0165_idempotency_write_roots_and_dedupe_contracts.sql).
  - Public enrollment packet completion, public POF signing, caregiver care plan signing, intake assessment signing, scheduled MAR administration, PRN manual order/administer, PRN follow-up, notifications, audit logs, and workflow system events all have meaningful replay protection.

## 2. Duplicate Record Risks

### Critical: Enrollment packet resend can replay against a now-completed packet

- Workflow: Enrollment packet resend
- Affected files:
  - [`lib/services/enrollment-packet-management.ts:239`](D:/Memory%20Lane%20App/lib/services/enrollment-packet-management.ts:239)
  - [`lib/services/enrollment-packets-send-runtime.ts:160`](D:/Memory%20Lane%20App/lib/services/enrollment-packets-send-runtime.ts:160)
  - [`lib/services/enrollment-packets-send-runtime.ts:318`](D:/Memory%20Lane%20App/lib/services/enrollment-packets-send-runtime.ts:318)
  - [`supabase/migrations/0152_enrollment_packet_lifecycle_and_voiding.sql:62`](D:/Memory%20Lane%20App/supabase/migrations/0152_enrollment_packet_lifecycle_and_voiding.sql:62)
- Duplicate scenario:
  - Staff loads an active packet and passes `existingPacketId`.
  - Caregiver completes the same packet before the resend prepare RPC runs.
  - `rpc_prepare_enrollment_packet_request` updates the row by `id` only and blindly resets `status`, `sent_at`, `opened_at`, `completed_at`, and void metadata.
- Data corruption risk:
  - Completed packet can be moved back to `draft`.
  - A new token can replace the completed token.
  - Downstream follow-up/mapping state can be reset.
  - A second public submission can be invited for the same canonical packet row.
- Recommended fix:
  - Add compare-and-set inputs to `rpc_prepare_enrollment_packet_request` so resend only succeeds from allowed current states locked in the RPC.
  - Prefer a dedicated resend RPC that refuses `completed`, `voided`, and `expired` after `FOR UPDATE`.

### High: Enrollment packet resend appends duplicate sender signature rows

- Workflow: Enrollment packet resend / prepare
- Affected files:
  - [`supabase/migrations/0152_enrollment_packet_lifecycle_and_voiding.sql:239`](D:/Memory%20Lane%20App/supabase/migrations/0152_enrollment_packet_lifecycle_and_voiding.sql:239)
  - [`supabase/migrations/0024_enrollment_packet_workflow.sql:68`](D:/Memory%20Lane%20App/supabase/migrations/0024_enrollment_packet_workflow.sql:68)
  - [`lib/services/enrollment-packets-public-runtime-submission.ts:213`](D:/Memory%20Lane%20App/lib/services/enrollment-packets-public-runtime-submission.ts:213)
- Duplicate scenario:
  - Every resend inserts a fresh `sender_staff` signature row for the same packet.
  - There is no uniqueness guard on `(packet_id, signer_role)` or any resend-aware upsert path.
- Duplicate data created:
  - Multiple staff signature rows for one packet.
  - The public runtime resolves "latest wins", so history keeps growing even though only one canonical sender signature should matter.
- Recommended fix:
  - Change sender signature persistence to upsert one canonical `sender_staff` row per packet, or enforce a partial unique index for `signer_role = 'sender_staff'`.

### Medium: Generated member PDFs can duplicate storage objects for the same document source

- Workflow: Generated PDF saves with stable `documentSource`
- Affected files:
  - [`lib/services/member-files.ts:802`](D:/Memory%20Lane%20App/lib/services/member-files.ts:802)
  - [`lib/services/member-files.ts:887`](D:/Memory%20Lane%20App/lib/services/member-files.ts:887)
  - [`app/(portal)/health/physician-orders/actions.ts:362`](D:/Memory%20Lane%20App/app/(portal)/health/physician-orders/actions.ts:362)
  - [`app/(portal)/members/[memberId]/name-badge/actions.ts:64`](D:/Memory%20Lane%20App/app/(portal)/members/[memberId]/name-badge/actions.ts:64)
  - [`app/(portal)/members/[memberId]/diet-card/actions.ts:36`](D:/Memory%20Lane%20App/app/(portal)/members/[memberId]/diet-card/actions.ts:36)
- Duplicate scenario:
  - Re-running the same generator uploads a new blob first.
  - `upsertMemberFileByDocumentSource` then reuses the existing member_files row, but the old storage object is not deleted unless the caller opted into `replaceExistingByDocumentSource`.
- Duplicate data created:
  - Multiple storage artifacts for one logical document.
  - One database row pointing only at the newest blob.
- Recommended fix:
  - For stable operational documents, default callers to `replaceExistingByDocumentSource: true`.
  - When updating an existing `document_source`, delete or archive the prior storage object inside the canonical save path.

## 3. Lifecycle Transition Risks

### Critical: POF resend can regress a request that was signed after the staff read

- Workflow: POF resend
- Affected files:
  - [`lib/services/pof-esign.ts:496`](D:/Memory%20Lane%20App/lib/services/pof-esign.ts:496)
  - [`lib/services/pof-esign.ts:539`](D:/Memory%20Lane%20App/lib/services/pof-esign.ts:539)
  - [`lib/services/pof-request-runtime.ts:189`](D:/Memory%20Lane%20App/lib/services/pof-request-runtime.ts:189)
  - [`supabase/migrations/0080_pof_request_delivery_rpc_insert_alignment.sql:65`](D:/Memory%20Lane%20App/supabase/migrations/0080_pof_request_delivery_rpc_insert_alignment.sql:65)
  - [`supabase/migrations/0098_false_failure_read_path_hardening.sql:17`](D:/Memory%20Lane%20App/supabase/migrations/0098_false_failure_read_path_hardening.sql:17)
- Replay scenario:
  - Staff loads an unsigned request.
  - Provider signs it before resend persistence runs.
  - `rpc_prepare_pof_request_delivery` resets the row to `draft` and clears `signed_at`.
  - The later sent-state finalize writes `sent` without any expected-state guard.
- Risk:
  - Signed truth can be overwritten.
  - Staff can send another active signing link for an already-signed request.
  - Post-sign sync and clinical downstream state can become inconsistent.
- Recommended fix:
  - Extend the prepare RPC with expected-state checks and refuse resend unless the locked row is still in an allowed pre-sign state.
  - Pass `expectedCurrentStatus`, `expectedCurrentDeliveryStatus`, and `requireOpenedAtNull` on resend finalization as well, not only on public-open tracking.

### Critical: POF void can overwrite a request that was signed after the staff read

- Workflow: POF void
- Affected files:
  - [`lib/services/pof-esign.ts:773`](D:/Memory%20Lane%20App/lib/services/pof-esign.ts:773)
  - [`lib/services/pof-request-runtime.ts:189`](D:/Memory%20Lane%20App/lib/services/pof-request-runtime.ts:189)
  - [`supabase/migrations/0098_false_failure_read_path_hardening.sql:67`](D:/Memory%20Lane%20App/supabase/migrations/0098_false_failure_read_path_hardening.sql:67)
- Replay scenario:
  - Staff reads a request as unsigned.
  - Provider signs it before void executes.
  - `voidPofSignatureRequest` still calls `markPofRequestDeliveryState` without any expected-state precondition, so the row can be moved to `declined`.
- Risk:
  - Signed request can appear voided.
  - Timeline/audit history becomes contradictory.
  - Staff may mistakenly retry or resend a request that was already completed.
- Recommended fix:
  - Route void through a dedicated RPC that locks the request and refuses to void when status is already `signed`.
  - At minimum, pass expected current state into `markPofRequestDeliveryState` for void operations.

### Medium: Public enrollment packet first-save can duplicate the `in_progress` transition event

- Workflow: Public enrollment packet progress autosave
- Affected files:
  - [`lib/services/enrollment-packets-public-runtime-submission.ts:113`](D:/Memory%20Lane%20App/lib/services/enrollment-packets-public-runtime-submission.ts:113)
  - [`lib/services/enrollment-packet-public-helpers.ts:333`](D:/Memory%20Lane%20App/lib/services/enrollment-packet-public-helpers.ts:333)
  - [`supabase/migrations/0154_fix_enrollment_packet_progress_rpc_status_ambiguity.sql:59`](D:/Memory%20Lane%20App/supabase/migrations/0154_fix_enrollment_packet_progress_rpc_status_ambiguity.sql:59)
  - [`supabase/migrations/0024_enrollment_packet_workflow.sql:53`](D:/Memory%20Lane%20App/supabase/migrations/0024_enrollment_packet_workflow.sql:53)
- Replay scenario:
  - Two browser saves read the packet before either update commits.
  - Both calculate `requestWasAlreadyInProgress = false`.
  - Both save progress successfully and both append `in_progress` packet events.
- Risk:
  - Timeline duplication rather than state corruption.
  - Operational staff may see false repeated progress starts.
- Recommended fix:
  - Have the progress RPC return whether the status changed to `in_progress`, then emit the event only when the RPC reports a first transition.
  - Alternatively add a dedupe key/unique index for one `in_progress` event per packet.

## 4. Public Endpoint Replay Risks

### Protected: Public enrollment packet final submission is replay-aware

- Evidence:
  - [`lib/services/enrollment-packets-public-runtime.ts:123`](D:/Memory%20Lane%20App/lib/services/enrollment-packets-public-runtime.ts:123) short-circuits consumed or already-completed packets.
  - [`lib/services/enrollment-packets-public-runtime.ts:178`](D:/Memory%20Lane%20App/lib/services/enrollment-packets-public-runtime.ts:178) re-checks completion after preparation to catch replay losers.
  - [`supabase/migrations/0180_enrollment_completion_follow_up_state.sql:81`](D:/Memory%20Lane%20App/supabase/migrations/0180_enrollment_completion_follow_up_state.sql:81) treats the same consumed token hash as replay-safe and returns `was_already_filed = true`.

### Protected: Public POF signing is replay-aware

- Evidence:
  - [`lib/services/pof-esign-public.ts:357`](D:/Memory%20Lane%20App/lib/services/pof-esign-public.ts:357) rejects invalid/expired tokens and returns committed replay results for consumed signed tokens.
  - [`supabase/migrations/0053_artifact_drift_replay_hardening.sql:155`](D:/Memory%20Lane%20App/supabase/migrations/0053_artifact_drift_replay_hardening.sql:155) returns `was_already_signed = true` when the same consumed token hash replays.

### Protected: Public care plan and intake signature endpoints are replay-aware

- Evidence:
  - [`lib/services/care-plan-esign-public.ts:540`](D:/Memory%20Lane%20App/lib/services/care-plan-esign-public.ts:540) returns the committed signed result for a consumed token and does not create a second final artifact.
  - [`supabase/migrations/0053_artifact_drift_replay_hardening.sql:426`](D:/Memory%20Lane%20App/supabase/migrations/0053_artifact_drift_replay_hardening.sql:426) refuses second caregiver finalization unless it is the same consumed token replay.
  - [`lib/services/intake-assessment-esign.ts:408`](D:/Memory%20Lane%20App/lib/services/intake-assessment-esign.ts:408) returns existing signed state before attempting a second write.
  - [`supabase/migrations/0075_fix_intake_signature_finalize_rpc_conflict_ambiguity.sql:77`](D:/Memory%20Lane%20App/supabase/migrations/0075_fix_intake_signature_finalize_rpc_conflict_ambiguity.sql:77) returns `was_already_signed = true` instead of creating a second signature row.

### Protected: Public enrollment packet uploads are replay-aware

- Evidence:
  - [`lib/services/enrollment-packet-artifacts.ts:277`](D:/Memory%20Lane%20App/lib/services/enrollment-packet-artifacts.ts:277) derives a stable upload fingerprint.
  - [`lib/services/enrollment-packet-artifacts.ts:367`](D:/Memory%20Lane%20App/lib/services/enrollment-packet-artifacts.ts:367) upserts `enrollment_packet_uploads` on `(packet_id, upload_category, upload_fingerprint)`.
  - [`supabase/migrations/0165_idempotency_write_roots_and_dedupe_contracts.sql:46`](D:/Memory%20Lane%20App/supabase/migrations/0165_idempotency_write_roots_and_dedupe_contracts.sql:46) enforces the supporting unique index.

## 5. Side Effect Duplication Risks

### High: Enrollment packet resend duplicates packet events even when the packet row is reused

- Workflow: Enrollment packet resend
- Affected files:
  - [`lib/services/enrollment-packets-send-runtime.ts:237`](D:/Memory%20Lane%20App/lib/services/enrollment-packets-send-runtime.ts:237)
  - [`lib/services/enrollment-packets-send-runtime.ts:633`](D:/Memory%20Lane%20App/lib/services/enrollment-packets-send-runtime.ts:633)
  - [`lib/services/enrollment-packet-public-helpers.ts:333`](D:/Memory%20Lane%20App/lib/services/enrollment-packet-public-helpers.ts:333)
- Risk:
  - Every resend appends fresh `prepared` and `sent` timeline rows on the same packet.
  - Some duplicates are operationally expected for real resends, but race-driven or retry-driven duplicates are not distinguished from deliberate actions.
- Recommended fix:
  - Add optional dedupe keys for packet events or include a resend attempt counter/version so retried writes can be recognized and collapsed when appropriate.

### High: POF resend/void races can emit wrong downstream workflow events

- Workflow: POF resend / void
- Affected files:
  - [`lib/services/pof-esign.ts:697`](D:/Memory%20Lane%20App/lib/services/pof-esign.ts:697)
  - [`lib/services/pof-esign.ts:794`](D:/Memory%20Lane%20App/lib/services/pof-esign.ts:794)
- Risk:
  - After a stale-state resend or void, the system can emit `resent`, `pof_request_sent`, or `declined` events against a request that was already signed.
  - This does not just duplicate notifications; it can rewrite the operational story of the request.
- Recommended fix:
  - Fix the underlying compare-and-set state guards first.
  - Then add dedupe keys or state-derived event guards so only the winning transition emits downstream observability events.

### Protected: Notifications, system events, audit logs, lead activities, and PRN follow-up side effects are materially hardened

- Evidence:
  - [`lib/services/notifications.ts:108`](D:/Memory%20Lane%20App/lib/services/notifications.ts:108) builds a stable `eventKey`, and [`supabase/migrations/0060_notification_workflow_engine.sql:27`](D:/Memory%20Lane%20App/supabase/migrations/0060_notification_workflow_engine.sql:27) enforces uniqueness.
  - [`lib/services/system-event-service.ts:43`](D:/Memory%20Lane%20App/lib/services/system-event-service.ts:43) and [`lib/services/audit-log-service.ts:19`](D:/Memory%20Lane%20App/lib/services/audit-log-service.ts:19) honor dedupe keys backed by [`supabase/migrations/0165_idempotency_write_roots_and_dedupe_contracts.sql:32`](D:/Memory%20Lane%20App/supabase/migrations/0165_idempotency_write_roots_and_dedupe_contracts.sql:32).
  - [`lib/services/sales-lead-activities.ts:239`](D:/Memory%20Lane%20App/lib/services/sales-lead-activities.ts:239) uses `idempotency_key`, backed by [`supabase/migrations/0222_lead_activity_idempotency_hardening.sql:3`](D:/Memory%20Lane%20App/supabase/migrations/0222_lead_activity_idempotency_hardening.sql:3).
  - Scheduled MAR and PRN flows return `duplicate_safe` from their RPCs and skip duplicate audit/event writes when a replay is detected.

## 6. Idempotency Hardening Plan

1. Harden enrollment packet resend at the RPC boundary.
   - Add expected-current-status checks to `rpc_prepare_enrollment_packet_request`.
   - Refuse resend once the locked row is `completed`, `voided`, or `expired`.
   - This is the highest-value fix because it protects a public clinical/operational workflow from state regression.

2. Harden POF resend and void with compare-and-set transitions.
   - Extend `rpc_prepare_pof_request_delivery` with expected-state validation.
   - Pass expected state into resend/void finalization calls and fail cleanly when another actor already signed or opened the request.

3. Make enrollment packet sender signatures canonical.
   - Upsert one `sender_staff` signature row per packet instead of appending indefinitely.
   - This removes duplicate signer truth and simplifies replay-safe resend behavior.

4. Stop duplicate `in_progress` enrollment packet timeline events.
   - Return a first-transition flag from `rpc_save_enrollment_packet_progress`, or add a unique/dedupe contract for one `in_progress` event per packet.

5. Clean up generated-document storage duplication.
   - For stable `documentSource` workflows like POF PDFs, name badges, and diet cards, either default `replaceExistingByDocumentSource: true` or delete the old object after a successful replacement.

6. Keep the current protected patterns as the standard.
   - Reuse consumed-token hashes, `duplicate_safe` RPC return values, unique indexes, and dedupe keys for any new public or multi-step workflow.
