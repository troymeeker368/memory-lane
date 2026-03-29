# Shared Resolver Drift Check - 2026-03-29

## Executive Summary

- This refresh focused on the live canonicality gaps still present in member-file and MCC billing/attendance flows, plus the provider and hospital directory write helpers that sit beside the Member Health Profile write boundary.
- One confirmed resolver-boundary drift existed in member files: uploads resolved canonical member identity, but download/delete still compared the optional `memberId` as a raw string. That has been fixed in `lib/services/member-files.ts`.
- One confirmed MCC action-layer drift existed in attendance billing: the action called canonical billing-setting/template readers and then re-filtered the returned rows against the raw `memberId`. That has been fixed in `app/(portal)/operations/member-command-center/actions-impl.ts`.
- One confirmed canonical write-boundary gap existed in the MHP directory helpers: provider and hospital directory saves depended on fuzzy pre-write matching instead of a deterministic normalized identity check with conflict recovery. That has been fixed in `lib/services/member-health-profiles-write-supabase.ts`.
- I did not find another fresh low-risk shared-resolver drift item still open in this focused scope after those fixes landed.

## Scope Reviewed

- `lib/services/member-files.ts`
- `app/(portal)/operations/member-command-center/actions-impl.ts`
- `lib/services/member-command-center-supabase.ts`
- `lib/services/member-command-center-read.ts`
- `lib/services/member-health-profiles-write-supabase.ts`
- `lib/services/billing-effective.ts`
- `lib/services/billing-payor-contacts.ts`

## Confirmed Drift Fixed This Run

### 1. Member-file reads/deletes were not using the same canonical member boundary as writes

- Files:
  - `lib/services/member-files.ts`
- Previous behavior:
  - `saveCommandCenterMemberFileUpload` and `saveGeneratedMemberPdfToFiles` resolved canonical member identity first.
  - `deleteCommandCenterMemberFile` and `getMemberFileDownloadUrl` compared `existing.member_id` to the raw optional `memberId` string.
- Why this was drift:
  - The write side and the read/delete side were not enforcing the same canonical member identity contract.
  - A caller arriving through a non-canonical but resolvable member id could pass the write path and still fail later read/delete mismatch checks.
- Fix applied:
  - `deleteCommandCenterMemberFile` now resolves the optional `memberId` through `resolveCanonicalMemberId` before enforcing the mismatch check.
  - `getMemberFileDownloadUrl` now does the same.

### 2. MCC attendance billing action was discarding already-canonical rows

- Files:
  - `app/(portal)/operations/member-command-center/actions-impl.ts`
  - `lib/services/member-command-center-supabase.ts`
- Previous behavior:
  - `listMemberBillingSettingsSupabase(memberId)` and `listBillingScheduleTemplatesSupabase(memberId)` already resolve the canonical member id inside the service boundary.
  - The action then filtered those result sets again with `row.member_id === memberId`.
- Why this was drift:
  - The service layer had already answered the canonical membership question.
  - The action layer was reintroducing raw-id assumptions and could hide valid rows if the caller did not arrive with the canonical id string.
- Fix applied:
  - Removed the redundant raw-member filters and kept the action aligned to the service-layer resolver boundary.

### 3. MHP provider/hospital directory writes were not using a deterministic normalized identity boundary

- Files:
  - `lib/services/member-health-profiles-write-supabase.ts`
  - schema evidence: `supabase/migrations/0012_legacy_operational_health_alignment.sql`
- Previous behavior:
  - The helpers tried to find a match up front with `ilike(...).maybeSingle()`, then updated or inserted.
  - That shape depended on fuzzy pre-write matching even though the schema uniqueness rule is defined on normalized expressions (`lower(btrim(...))`).
- Why this was drift:
  - The runtime write boundary was not aligned to the actual uniqueness rule the database enforces.
  - Concurrent or casing/trim variants could still surface as an ambiguous application-level write path.
- Fix applied:
  - Added normalized identity helpers that compare provider/hospital rows by the same trim+lower semantics the index expects.
  - Replaced `maybeSingle()` with candidate fetch + exact normalized match filtering.
  - Added duplicate-key recovery so a normalized unique conflict resolves back to the canonical row instead of creating a competing path.

## Current Protected Paths

- `listMemberBillingSettingsSupabase` and `listBillingScheduleTemplatesSupabase` still resolve canonical member ids inside the service layer.
- `listBillingPayorContactsForMembers` resolves canonical member ids before grouping payor-contact rows.
- `resolveActiveEffectiveMemberRowForDate` and `resolveBillingPayorContactRows` still rely on callers to pass a canonical member id, but in the current audited call sites they are fed canonical member ids from member rows or canonical services. I did not find a fresh low-risk bug there in this pass.

## Remaining Resolver Gaps Deferred

- Broader care-plan post-sign readiness standardization is still a real resolver/contract issue, but it is not a low-risk local cleanup.
- Enrollment-packet read-model consolidation remains an open cross-service cleanup area, but the remaining items are larger than a narrow resolver-drift pass.
- The member clinical child-mutation RPC family is still more fragmented than the long-term target, but that is not a small safe fix.

## Validation

- `cmd /c npm run typecheck`: passed
- `cmd /c npm run build`: passed

## Founder Summary

The resolver drift in this focused scope was real but manageable. The main pattern was the same in two places: the canonical service layer was already doing the right thing, and a downstream caller or sibling path was reintroducing raw-id or fuzzy matching assumptions. We tightened those boundaries so the same canonical member/directory identity now holds across write, read, and follow-up paths.

After these fixes, I did not find another fresh low-risk resolver drift item still open in the audited member-file, MCC billing/attendance, and MHP directory-write scope.
