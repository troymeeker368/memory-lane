# Idempotency & Duplicate Submission Audit - 2026-03-29

## 1. Executive Summary

- This refresh focused on the current repo state after the latest safe canonicality pass, with extra attention on member files, MCC billing/attendance callers, provider/hospital directory writes, and the established high-risk workflow families the audit contract requires.
- Strong protections are present in the current tree for lead creation, lead conversion, enrollment packet artifact uploads, billing exports, PRN MAR administration, intake draft creation, and member-file RPC-backed generated-document persistence.
- One low-risk duplicate-write gap existed in the MHP provider/hospital directory helper layer: application-side fuzzy lookup did not cleanly mirror the normalized uniqueness rule in the schema. That has been fixed in this run with normalized identity matching plus duplicate-key recovery.
- I did not find another fresh low-risk idempotency fix still open in the audited scope after this pass.
- The remaining meaningful replay/duplicate concerns are either already known higher-risk workflow issues or behavior choices that need product/architecture decisions rather than a tiny safe patch.

## 2. Duplicate Record Risks

### Protected

- `lib/services/sales-crm-supabase.ts`
  - Lead creation uses `buildIdempotencyHash("sales-lead:create", ...)` and unique-conflict recovery by `idempotency_key`.
- `lib/services/sales-lead-conversion-supabase.ts`
  - Lead conversion uses a stable root idempotency key and deduped system-event keys.
- `lib/services/enrollment-packet-artifacts.ts`
  - Packet upload writes use a fingerprint-based idempotency key and `onConflict: "packet_id,upload_category,upload_fingerprint"`.
- `lib/services/member-files.ts`
  - Generated-document persistence goes through `rpc_upsert_member_file_by_source`.
  - Manual upload persistence reuses the same `documentSource` when the same `uploadToken` is replayed.
- `lib/services/billing-exports.ts`
  - Billing export creation is keyed by idempotency hash and reuses the same export row on duplicate attempts.
- `lib/services/mar-prn-workflow.ts`
  - PRN administration and manual-order creation use explicit idempotency keys.

### Was At Risk, Fixed This Run

- `lib/services/member-health-profiles-write-supabase.ts`
  - Provider and hospital directory writes previously depended on fuzzy pre-write match logic before insert/update.
  - The schema uniqueness rule is normalized (`lower(btrim(...))`), so deterministic replay safety needed to follow that same boundary.
  - The helpers now:
    - normalize identity parts with trim+lower semantics
    - accept only an exact normalized match from fetched candidates
    - recover safely from `23505` unique conflicts by reloading the canonical row and updating it

### Remaining Risks

- `lib/services/member-files.ts`
  - Manual upload replay safety is token-based, not content-fingerprint-based.
  - Reusing the same `uploadToken` is safe.
  - Uploading the same real-world file with a new token intentionally creates a new canonical member-file row.
  - Severity: Medium
  - Why not a low-risk auto-fix:
    - Changing this behavior cleanly would need a product-level dedupe rule for manual uploads and likely a new stable file fingerprint contract.

## 3. Lifecycle Transition Risks

### Protected

- Enrollment packet child-upload persistence, billing exports, and lead conversion continue to use durable, dedupe-aware service or RPC boundaries.
- The MCC billing/attendance action cleanup from this pass removed raw-id filtering drift but did not alter lifecycle transitions.

### Higher-Risk / Not Low-Risk

- Public care-plan caregiver signing still needs careful lifecycle handling around post-commit follow-up and cleanup ordering.
- Enrollment packet downstream readiness remains a staged lifecycle truth issue, not a simple duplicate-row fix.
- Signed POF downstream sync remains queue-backed and operationally dependent on retry-runner health.

These are real concerns, but they are not fresh low-risk duplicate-submission fixes for this pass.

## 4. Public Endpoint Replay Risks

### Protected

- Enrollment packet public upload and submission helpers rely on canonical packet request and upload-fingerprint boundaries.
- POF public signing remains backed by finalize/sign RPC boundaries and consumed-token handling.
- Intake draft-creation and downstream follow-up queue work continue to use stable idempotency keys where the repo currently expects replay safety.

### Still Worth Watching

- Manual member-file upload is not a public token flow, but it is still replayable from the UI if a caller sends a new token for the same document. That remains a product-rule question, not a hidden duplicate bug in the current implementation.

## 5. Side Effect Duplication Risks

### Protected

- Billing export generation and PRN event writes use dedupe keys for observability side effects.
- Lead conversion and sales create paths use stable dedupe keys for system-event style follow-up.

### Remaining Risks

- Some higher-risk workflows still treat notifications or follow-up signals as best-effort after durable business success.
- That can create duplicate or missing side effects in edge cases, but the current fresh evidence in this pass did not reveal a new narrow low-risk duplicate-side-effect fix outside the already-known larger workflow areas.

## 6. Idempotency Hardening Plan

1. Keep the new normalized duplicate-key recovery in provider and hospital directory writes.
2. If manual member-file upload dedupe becomes a product requirement, define one explicit canonical rule first:
   - same upload token only, or
   - content fingerprint, or
   - document source + member + category
3. Keep future replay-safety fixes inside canonical services or RPCs rather than patching UI callers.
4. Continue treating care-plan, enrollment-packet, and signed-POF readiness issues as higher-risk lifecycle work, not as “quick idempotency cleanups.”

## Founder Summary

The good news is that the repo’s main duplicate-safety structure is stronger than the missing artifact history suggested. Most of the important replay-sensitive areas already have real dedupe keys, unique-conflict handling, or RPC-backed write boundaries.

The one clean low-risk idempotency gap I could confirm in the current tree was the provider/hospital directory helper path, and that is now fixed. The remaining replay concerns are not tiny cleanup items. They mostly live in larger staged workflows or in product-definition questions like whether two manual uploads of the same document should collapse into one canonical file row.
