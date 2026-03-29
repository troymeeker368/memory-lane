# Supabase Query Performance Audit - 2026-03-29

## 1. Executive Summary

This run did not uncover a brand-new top bottleneck. The main performance risks are still concentrated in the enrollment-packet list/history flows, repeated active-member lookup preloads, and the Member Health Profile detail page.

The biggest confirmed problem is that the enrollment-packet operational list and completed-history list still read large `enrollment_packet_requests` batches, pull `select("*")`, and do some filtering in application memory after the database query. That is workable at small volume, but it gets slower and more expensive as packet history grows.

The members page, MAR member-option RPC path, member-files RPC path, sales stage pages, and admin audit trail still look materially better than the older baseline. I did not find a new regression in those areas during this run.

## 2. Missing Indexes

- Confirmed | High | Near-term
  The completed enrollment-packet history query in `lib/services/enrollment-packets-listing.ts:123-140` filters `status = completed`, sorts by `completed_at desc` then `created_at desc`, and can also apply date filtering on `completed_at`. I did not find a matching index for that shape in Supabase migrations. The earlier suggested index is still missing:
  `enrollment_packet_requests (status, completed_at desc, created_at desc)`.

- Likely | Medium | Near-term
  The operational enrollment-packet list in `lib/services/enrollment-packet-management.ts:155-166` sorts by `updated_at desc` across all statuses, but the migrations only show `status + updated_at` support, not a plain `updated_at` path. If this page keeps the current all-status shape, it likely needs either:
  1. a plain `updated_at desc` index, or
  2. a code change that pushes the status filter into SQL so the existing `status, updated_at` index can actually help.

- Likely | Medium | Long-term
  MHP provider and hospital directory lookups still use `ilike` in `lib/services/member-health-profiles-write-supabase.ts:28-57`. The schema has normalized unique indexes on lower-trimmed names, but the current lookup shape is not aligned with those exact-match indexes. If the code keeps `ilike`, it will eventually want dedicated pattern-search support; otherwise the safer fix is to switch these lookups to normalized equality so the existing unique indexes can be used.

## 3. Potential Table Scans

- Confirmed | High | Near-term
  `lib/services/enrollment-packet-management.ts:142-190` still does:
  - `.from("enrollment_packet_requests")`
  - `.select("*")`
  - `.order("updated_at", { ascending: false })`
  - `.limit(500)`
  and only after that filters status and search text in JavaScript.
  This means the database cannot use SQL-side status/search narrowing before returning rows.

- Confirmed | High | Near-term
  `lib/services/enrollment-packets-listing.ts:107-217` still loads up to 500 completed packet rows, then applies operational-readiness and text search filtering in memory. As packet history grows, this becomes a wider read and a larger in-app filter pass than necessary.

- Likely | Medium | Long-term
  `lib/services/member-health-profiles-write-supabase.ts:28-57` uses `ilike` lookups against `provider_directory` and `hospital_preference_directory`. With small directories this is fine. As those directories grow, these lookups become increasingly scan-prone unless they are aligned to the normalized exact-match indexes already defined in `supabase/migrations/0012_legacy_operational_health_alignment.sql:132-145`.

## 4. N+1 Query Patterns

- No confirmed classic list-page N+1 pattern was found in the top member list, sales pipeline list, MAR list, member-files list, or admin audit trail paths reviewed this run.

- Confirmed | Medium | Near-term
  The MAR refresh path in `lib/services/mar-workflow-read.ts:158-177` still identifies stale members, then runs `generateMarSchedulesForMemberRead(...)` once per member inside `Promise.all`. This is not happening on every page load anymore, which is good, but it is still a repeated per-member query pattern that can get expensive when many members need schedule regeneration at once.

## 5. Inefficient Data Fetching

- Confirmed | High | Near-term
  The MHP detail page still builds a heavy snapshot. `lib/services/member-health-profiles-supabase.ts:651-687` loads 11 parallel reads for one member, then `app/(portal)/health/member-health-profiles/[memberId]/page.tsx:242-249` adds 4 more cross-domain reads for care plans, billing payor, physician orders, and progress notes. This is not broken, but it is still a large fan-out for every profile open.

- Confirmed | Medium | Near-term
  Shared active-member dropdown preloads still exist through `getMembers()` -> `listAllActiveMemberLookupSupabase()`:
  - `lib/services/documentation.ts:108-109`
  - `app/(portal)/documentation/activity/page.tsx:28`
  - `app/(portal)/documentation/toilet/page.tsx:23`
  - `app/(portal)/documentation/shower/page.tsx:18`
  - `app/(portal)/documentation/blood-sugar/page.tsx:16`
  - `app/(portal)/health/care-plans/new/page.tsx:16`
  - `app/(portal)/health/care-plans/list/page.tsx:43`
  - `app/(portal)/health/care-plans/due-report/page.tsx:31`
  - `app/(portal)/reports/member-summary/page.tsx:88`
  - `lib/services/health-dashboard.ts:124`
  The lookup is capped at 200 in `lib/services/shared-lookups-supabase.ts:17-30`, so it still creates repeated roster reads and can silently omit active members once census exceeds that cap.

- Confirmed | Medium | Near-term
  The standalone send-enrollment-packet page still preloads up to 500 eligible leads in one read:
  - `app/(portal)/sales/new-entries/send-enrollment-packet/page.tsx:11-14`
  - `lib/services/sales-crm-read-model.ts:336-358`
  This is better than loading all leads, but it is still a large preload for a form and can silently miss eligible leads once volume outgrows the cap.

## 6. Duplicate Query Logic

- Confirmed | Medium | Near-term
  Enrollment-packet row hydration is duplicated between:
  - `lib/services/enrollment-packets-listing.ts`
  - `lib/services/enrollment-packet-management.ts`
  Both modules independently load packet rows, then separately fan out to member names, lead names, and sender names. That duplication increases the chance of fixing performance in one path while leaving the other behind.

- Confirmed | Medium | Near-term
  The same active-member lookup preload pattern is still reused across documentation, care plans, reports, dashboard surfaces, and physician-order member lookup. That keeps the query behavior consistent, but it also means one capped, broad roster read is being repeated across many screens instead of shifting more of those screens to search-first lookup behavior.

## 7. Recommended Index Additions

- Add `create index if not exists idx_enrollment_packet_requests_status_completed_created_desc on public.enrollment_packet_requests (status, completed_at desc, created_at desc);`
  Reason: matches the completed-history query that is still missing direct support.

- If the operational all-status packet page remains as-is, add `create index if not exists idx_enrollment_packet_requests_updated_at_desc on public.enrollment_packet_requests (updated_at desc);`
  Reason: supports the current all-status `updated_at desc` ordering path.

- If MHP directory lookups must remain case-insensitive pattern searches, add pattern-search support on provider and hospital names. If not, prefer changing the query shape to normalized equality and reuse the existing lower-trimmed unique indexes instead of adding more indexes.

## 8. Performance Hardening Plan

1. Fix the enrollment-packet list paths first.
   Push status, readiness, and text search into SQL or an RPC-backed read model, stop using `select("*")`, and add true pagination instead of `limit: 500`.

2. Tighten the completed-history index path.
   Add the missing `status + completed_at + created_at` index so historical packet review does not degrade as records accumulate.

3. Replace preload-first member pickers with search-first lookups where possible.
   Keep the existing shared resolver boundary, but stop preloading the same capped active-member list on every page that only needs a picker.

4. Reduce MHP detail fan-out.
   Keep canonical shared services, but split the page into a lighter default read and only load the heavier cross-domain sections when the user is on the tab that needs them.

5. Clean up duplicated enrollment-packet read logic.
   Centralize the packet row hydration and name-resolution path so the next performance fix lands once, not twice.

## 9. Suggested Codex Prompts

- `Audit and refactor the enrollment packet operational list so status, search, and readiness filtering happen in SQL instead of app memory. Keep Supabase as source of truth, preserve canonical service boundaries, add pagination, and avoid select("*") reads.`

- `Add the safest forward-only Supabase migration to support completed enrollment packet history reads. Target the query shape status = completed, order by completed_at desc then created_at desc, and explain what downstream pages benefit.`

- `Convert repeated active-member preload pickers to search-first lookup behavior without breaking canonical member resolution. Start with documentation, care plans, reports, and the health dashboard.`

- `Reduce Member Health Profile detail over-fetching by splitting heavy cross-domain reads behind tab-aware or staged loading, while keeping one canonical service path and no mock fallbacks.`

- `Deduplicate enrollment packet row hydration and name lookup logic between enrollment-packets-listing.ts and enrollment-packet-management.ts so future performance fixes land in one place.`

## 10. Founder Summary: What changed since the last run

- No major performance shift showed up in the top risk list. The same three areas are still the main concerns:
  - enrollment-packet operational/history lists
  - repeated active-member preload lookups
  - MHP detail payload size

- I did not find a regression in the members page, sales stage pagination, MAR member options RPC, member-files RPC path, or admin audit trail pagination.

- Today’s review gives stronger confirmation that the enrollment-packet operational page is still not doing true database-side filtering or paging. That is still the cleanest place to make the next meaningful performance improvement.

- The health dashboard is still part of the repeated active-member preload pattern, so the capped roster lookup issue is not just a documentation/care-plan concern yet.
