# Supabase Query Performance Audit - 2026-03-30

## 1. Executive Summary

The biggest change since the March 29, 2026 audit is that the enrollment-packet list paths are no longer the top performance concern. The packet list code now pushes status, search, and readiness filtering into SQL in `lib/services/enrollment-packet-management.ts:77` and `lib/services/enrollment-packets-listing.ts:125`, and the previously-missing supporting indexes now exist in `supabase/migrations/0168_enrollment_packet_list_performance_indexes.sql:1`.

The main remaining risks are now:

- Confirmed | High | Near-term
  Member Health Profile detail still fans out into too many reads per page open. The page calls `getMemberHealthProfileDetailSupabase(...)` in `app/(portal)/health/member-health-profiles/[memberId]/page.tsx:207`, that service still runs about 10 member-specific reads in `lib/services/member-health-profiles-supabase.ts:633`, and the page immediately adds 4 more cross-domain reads in `app/(portal)/health/member-health-profiles/[memberId]/page.tsx:243`.

- Confirmed | Medium | Near-term
  The same capped active-member preload is still reused across documentation, care plans, reports, ancillary, the health dashboard, and physician orders. The shared helper still defaults to 200 rows in `lib/services/shared-lookups-supabase.ts:17`, and callers still use full-list preloads through `lib/services/documentation.ts:108` and `lib/services/physician-orders-read.ts:168`.

- Confirmed | Medium | Near-term
  The standalone send-enrollment-packet page still preloads up to 500 eligible leads on page load in `app/(portal)/sales/new-entries/send-enrollment-packet/page.tsx:13` through `lib/services/sales-crm-read-model.ts:336`. That is workable today, but it gets slower and can silently omit valid leads as the sales table grows.

I did not find a new regression in the members page pagination path, member-files RPC list path, admin audit trail pagination path, or the follow-up dashboard paging path during this run.

## 2. Missing Indexes

- No confirmed missing-index finding in the current top-risk paths.
  The previous enrollment-packet index gap has been addressed by `supabase/migrations/0168_enrollment_packet_list_performance_indexes.sql:1`, which now adds both:
  - `enrollment_packet_requests (status, completed_at desc, created_at desc)`
  - `enrollment_packet_requests (status, updated_at desc)`

- Likely | Medium | Near-term
  If the standalone send-enrollment-packet page keeps its current preload shape in `lib/services/sales-crm-read-model.ts:336`, it will likely benefit from a composite index on `leads (status, stage, inquiry_date desc)`. Current migrations include `leads (inquiry_date desc)` and `leads (status, created_at desc)`, but not one index that matches the full `status + stage + inquiry_date desc` access pattern.

## 3. Potential Table Scans

- Likely | Medium | Long-term
  `lib/services/member-health-profiles-write-supabase.ts:63` and `lib/services/member-health-profiles-write-supabase.ts:85` still use `ilike` lookups against `provider_directory` and `hospital_preference_directory`. The schema already has normalized unique indexes in `supabase/migrations/0012_legacy_operational_health_alignment.sql:132` and `supabase/migrations/0012_legacy_operational_health_alignment.sql:144`, but the current `ilike` query shape does not align with those exact-match indexes. As those directories grow, this becomes more scan-prone.

- Likely | Medium | Near-term
  `lib/services/sales-crm-read-model.ts:336` reads eligible leads with `status = open`, `stage in (...)`, `order by inquiry_date desc`, and `limit(500)`. Without a matching composite index, Postgres may still need a wider filter-and-sort pass than necessary before returning the 500 rows.

## 4. N+1 Query Patterns

- Confirmed | Medium | Near-term
  `lib/services/mar-workflow-read.ts:171` still regenerates MAR schedules one member at a time with `Promise.all(memberIds.map(...generateMarSchedulesForMemberRead))` whenever the freshness check decides multiple members are stale. This is better than doing it on every normal page read, but it is still a repeated per-member query pattern that can spike when many members need repair at once.

- No other confirmed classic list-page N+1 pattern was found in the member list, member-files list, admin audit trail, or sales follow-up list paths reviewed during this run.

## 5. Inefficient Data Fetching

- Confirmed | High | Near-term
  Member Health Profile detail remains the heaviest read path in scope. `lib/services/member-health-profiles-supabase.ts:633` still loads the member shell plus diagnoses, medications, allergies, providers, equipment, notes, assessments, and MCC data up front, and `app/(portal)/health/member-health-profiles/[memberId]/page.tsx:243` then immediately loads care plans, billing payor, physician orders, and progress-note summary. Even after a useful improvement that makes provider and hospital directory reads tab-aware in `app/(portal)/health/member-health-profiles/[memberId]/page.tsx:207`, the page still pays for roughly 14 reads on a normal open.

- Confirmed | Medium | Near-term
  The repeated active-member preload pattern still exists through `getMembers()` in `lib/services/documentation.ts:108` and `listAllActiveMemberLookupSupabase()` in `lib/services/shared-lookups-supabase.ts:142`. Confirmed callers include:
  - `app/(portal)/documentation/activity/page.tsx:28`
  - `app/(portal)/documentation/blood-sugar/page.tsx:16`
  - `app/(portal)/documentation/shower/page.tsx:18`
  - `app/(portal)/documentation/toilet/page.tsx:23`
  - `app/(portal)/documentation/documentation-dashboard-home.tsx:198`
  - `app/(portal)/health/care-plans/new/page.tsx:16`
  - `app/(portal)/health/care-plans/list/page.tsx:43`
  - `app/(portal)/health/care-plans/due-report/page.tsx:31`
  - `app/(portal)/reports/member-summary/page.tsx:88`
  - `app/(portal)/ancillary/page.tsx:20`
  - `lib/services/health-dashboard.ts:124`
  - `app/(portal)/health/physician-orders/page.tsx:55` through `lib/services/physician-orders-read.ts:168`

  This is not just a performance issue. Because the helper still defaults to 200 rows in `lib/services/shared-lookups-supabase.ts:17`, these screens can silently miss active members once census grows past that cap.

- Confirmed | Medium | Near-term
  The standalone enrollment-packet send page still loads up to 500 eligible leads every time the page opens in `app/(portal)/sales/new-entries/send-enrollment-packet/page.tsx:13`. That is broader than a form picker needs, and it scales poorly compared with a search-first or paged selector.

## 6. Duplicate Query Logic

- Confirmed | Medium | Near-term
  The same active-member preload logic is still duplicated across many surfaces through `getMembers()` and `listPhysicianOrderMemberLookup()`. The duplication is not that the SQL text is copy-pasted everywhere; it is that many screens still choose the same preload-first read pattern instead of a shared search-first read model. That means one broad roster query keeps being paid repeatedly across unrelated modules.

- Improvement since last run
  The older enrollment-packet duplication concern is materially better now. Both list paths now share `buildEnrollmentPacketListPresentation`, `buildEnrollmentPacketSearchClauses`, and `resolveEnrollmentPacketRelatedNames` from `lib/services/enrollment-packet-list-support.ts`, so this is no longer one of the main duplicate-query risks.

## 7. Recommended Index Additions

- No must-add index is blocking the next performance-hardening pass.

- Likely next useful index if the current lead preload stays in place:
  `create index if not exists idx_leads_status_stage_inquiry_date_desc on public.leads (status, stage, inquiry_date desc);`
  Reason: matches the current eligible-leads preload in `lib/services/sales-crm-read-model.ts:336`.

- Do not add new provider/hospital pattern-search indexes yet.
  The safer first fix is to change `lib/services/member-health-profiles-write-supabase.ts:63` and `lib/services/member-health-profiles-write-supabase.ts:85` from `ilike` lookups to normalized equality so the existing unique indexes can finally be used.

## 8. Performance Hardening Plan

1. Reduce MHP detail fan-out first.
   Keep the canonical service boundary, but split the MHP page into a lighter default read and only load diagnoses, medications, providers, care plans, physician orders, billing payor, and progress-note data when the active tab actually needs them.

2. Replace preload-first member pickers with search-first lookup behavior.
   Start with documentation, care plans, health dashboard, reports, ancillary, and physician orders because they all reuse the same capped full-list helper today.

3. Replace the 500-lead enrollment-packet picker with a searchable, paged lead selector.
   This removes both the broad preload and the silent truncation risk.

4. Normalize MHP directory upsert lookups.
   Reuse the existing normalized unique indexes instead of scanning provider and hospital directories with `ilike`.

5. Keep MAR refresh repair work off the hot path.
   If stale-member counts start climbing, move the per-member schedule regeneration into a more explicit repair/batch boundary instead of letting one page read trigger many member-level repairs at once.

## 9. Suggested Codex Prompts

- `Reduce Member Health Profile detail over-fetching without changing write paths. Keep Supabase as source of truth, preserve canonical service boundaries, and move non-visible tab data behind tab-aware loading or a lighter read model.`

- `Convert repeated active-member preload pickers to search-first member lookup behavior across documentation, care plans, ancillary, reports, health dashboard, and physician orders. Preserve canonical member resolution and remove the silent 200-row truncation risk.`

- `Refactor the standalone send-enrollment-packet flow so it no longer preloads 500 leads on page load. Use a search-first or paged picker, keep Supabase canonical, and explain the downstream UI impact in plain English.`

- `Update Member Health Profile provider and hospital directory upsert lookups to use normalized equality instead of ilike so existing unique indexes can be used. Keep duplicate protection and audit behavior intact.`

- `Review MAR freshness repair flow and propose the smallest safe change to avoid one page read triggering many per-member regeneration queries when multiple members are stale.`

## 10. Founder Summary: What changed since the last run

- Compared with the March 29, 2026 audit, the enrollment-packet list situation improved materially.
  The packet list code now does more of its filtering in SQL, and migration `0168_enrollment_packet_list_performance_indexes.sql` added the packet indexes that were still missing yesterday.

- Because of that improvement, the top priority shifted.
  The biggest remaining performance concern is now the Member Health Profile detail page, not the enrollment-packet list pages.

- The MHP page also improved a little.
  Provider and hospital directory reads are now tab-aware in `app/(portal)/health/member-health-profiles/[memberId]/page.tsx:207`, so those full-directory reads are no longer paid on every tab. The page is still heavy overall, but this was a real improvement.

- The repeated active-member preload problem did not improve.
  It is still spread across documentation, care plans, reports, ancillary, the health dashboard, and physician orders, and it still has the same 200-member cap.

- The standalone send-enrollment-packet page is still a growing-risk preload.
  It still loads 500 eligible leads up front, so it remains a likely next bottleneck on the sales side once lead volume grows.

- I did not find a new regression in the members page, member-files RPC path, admin audit trail paging path, or follow-up dashboard paging path during this run.
