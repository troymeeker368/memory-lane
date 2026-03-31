# Supabase Query Performance Audit - 2026-03-31

## 1. Executive Summary

- The top confirmed scaling risk is still the Member Health Profile detail page. One page open triggers the base MHP detail read plus a large fixed fan-out into diagnoses, medications, allergies, providers, notes, assessments, command-center photo, care plans, billing payor, physician orders, and progress-note summary reads. This is not a classic row-by-row N+1, but it is still expensive on every member page visit.
- The second biggest risk is still the shared active-member preload pattern. Many pages still load the active member roster up front through the same helper, and that helper still defaults to a cap of 200. That creates two problems at once: repeated broad reads across unrelated screens, and silent omission once active census grows past 200.
- The standalone Send Enrollment Packet screen still preloads up to 500 eligible leads and the underlying query still pulls a wide lead payload even though the page only uses a few fields. This remains a near-term cost risk for the sales workflow.
- The MHP provider and hospital directory upsert helpers still use `ilike` reads against tables that already have normalized unique indexes. That query shape is still the wrong match for the existing indexes and can degrade into broader scans as those directories grow.
- No new high-priority regression was confirmed in the member-files list RPC path, admin audit trail pagination path, enrollment-packet operational list indexes, or the current MAR dashboard read model.

## 2. Missing Indexes

- Likely missing index. `lib/services/sales-crm-read-model.ts:336-349` filters `leads` by `status = 'open'`, filters by eligible `stage`, then sorts by `inquiry_date desc`. The repo has separate lead indexes for `status`, `created_at`, `inquiry_date`, partner/referral ids, and trigram name search, but there is no matching composite index for this exact filter-and-sort shape. As the lead table grows, this query will become more expensive than it needs to be.
- No other confirmed missing indexes were found in today’s highest-priority workflows. Existing migrations still cover member lookup search, audit-log pagination, enrollment-packet staff list reads, member-files read RPC support, and the main MAR tables used by the current dashboard paths.

## 3. Potential Table Scans

- Confirmed. `lib/services/member-health-profiles-write-supabase.ts:63-93` and `lib/services/member-health-profiles-write-supabase.ts:447-545` still look up `provider_directory` and `hospital_preference_directory` rows with `ilike(...)`. The schema already defines normalized unique expression indexes in `supabase/migrations/0012_legacy_operational_health_alignment.sql:132-145`. Because the code is not querying by the same normalized equality shape, PostgreSQL is less likely to use those indexes well.
- Confirmed. `lib/services/member-health-profiles-supabase.ts:669-676` still loads the full provider directory or full hospital directory for the MHP medical/legal tabs and sorts the results by `updated_at desc`. That means a whole-directory read every time those tabs open.
- Likely. `lib/services/sales-crm-read-model.ts:336-349` can fall back to a larger scan of open eligible leads because the filter columns and the sort column are not jointly indexed.

## 4. N+1 Query Patterns

- No confirmed classic row-by-row N+1 pattern was found in today’s prioritized list pages and dashboards. The recent hardening work on member-files, audit trail pagination, care-plan list RPCs, and progress-note tracker paging still looks intact.
- The main remaining risk is a fixed query fan-out, not a classic N+1. `app/(portal)/health/member-health-profiles/[memberId]/page.tsx:207-250` loads the core MHP detail and then always adds four more cross-domain reads for care plans, billing payor, physician orders, and progress-note summary. That cost does not multiply by row count on one page, but it does repeat every time staff move member-to-member.

## 5. Inefficient Data Fetching

- Confirmed. `lib/services/shared-lookups-supabase.ts:17-30` still defaults member lookups to 200 rows, and `lib/services/shared-lookups-supabase.ts:55-64` / `lib/services/shared-lookups-supabase.ts:142-143` still expose that capped preload as the shared “all active members” helper. This is then reused by documentation, care-plan, report, ancillary, physician-order, and dashboard screens.
- Confirmed. `lib/services/documentation.ts:108-110` still wraps that shared preload as `getMembers()`, and the same broad read is still used by representative pages such as `app/(portal)/documentation/documentation-dashboard-home.tsx:197-201`, `app/(portal)/health/care-plans/due-report/page.tsx:29-38`, `app/(portal)/health/care-plans/list/page.tsx:41-50`, `app/(portal)/health/care-plans/new/page.tsx:16`, `app/(portal)/reports/member-summary/page.tsx:87-90`, `app/(portal)/ancillary/page.tsx:20`, `lib/services/health-dashboard.ts:115-125`, and `lib/services/physician-orders-read.ts:168-170`.
- Confirmed. `app/(portal)/sales/new-entries/send-enrollment-packet/page.tsx:11-20` still preloads 500 leads before the user searches or chooses anyone. The underlying read in `lib/services/sales-crm-read-model.ts:129-157` and `lib/services/sales-crm-read-model.ts:336-358` still fetches a wide lead row even though the page only uses `id`, `member_name`, `caregiver_email`, and `member_start_date`.
- Confirmed. `lib/services/member-health-profiles-supabase.ts:651-687` still pulls a large MHP snapshot up front, and `app/(portal)/health/member-health-profiles/[memberId]/page.tsx:242-250` still adds more cross-domain reads immediately after that. Even with the earlier tab-aware directory improvement, the page is still heavier than it needs to be.

## 6. Duplicate Query Logic

- Confirmed. The same active-member preload is still duplicated across many workflows under different names instead of being replaced with one search-first pattern. The most visible examples are `getMembers()` in documentation, direct `getMembers()` calls in care-plan pages, and `listPhysicianOrderMemberLookup()` returning the same shared active-member helper.
- Confirmed. Sales still has separate broad lead-lookup shapes for different surfaces. The standout issue is the enrollment-packet standalone page reusing a wide lead read even though it only needs a small option payload.
- No new duplicated cross-service read regression was confirmed in member-files, audit trail, or care-plan list pagination beyond the already-known shared roster preload problem.

## 7. Recommended Index Additions

- Add a composite lead index for the enrollment-packet eligible lead query. Recommended starting point: `create index ... on public.leads (status, stage, inquiry_date desc);`
- If the eligible-lead read stays heavily focused on open pipeline work, a partial variant is even better: index only rows where `status = 'open'` and the stage is one of the enrollment-packet-eligible stages.
- Do not add a new provider-directory or hospital-directory search index first. The immediate problem there is query shape mismatch, not lack of indexing. The cleaner fix is to align the read path to the normalized unique indexes that already exist.

## 8. Performance Hardening Plan

- Replace broad active-member preloads with a search-first member picker. Keep a small selected-member backfill path so forms can still load an existing value without loading the full roster.
- Split Member Health Profile detail into smaller read models. Load the header and core tab data first, then fetch care-plan, billing, physician-order, and progress-note summaries only when the screen actually needs them.
- Narrow the eligible-lead lookup used by Send Enrollment Packet so it only selects the four fields the page renders, then back it with the new composite lead index.
- Change MHP provider and hospital directory matching to use normalized equality against the existing indexed expressions or move the match into one canonical RPC that applies the same normalization in SQL.
- After those fixes, rerun this audit and check whether the top risk has finally moved away from MHP detail fan-out and shared roster preloads.

## 9. Suggested Codex Prompts

- Prompt 1: `Audit every page that calls getMembers() or listAllActiveMemberLookupSupabase(), replace broad active-member preloads with a search-first member lookup pattern, preserve canonical Supabase reads, and keep selected-id backfill support so forms still open correctly.`
- Prompt 2: `Refactor the Member Health Profile detail page so it does not always load care plans, billing payor, physician orders, and progress-note summary on every tab. Keep Supabase canonical reads, but split the page into smaller tab-scoped read models and explain the downstream impact.`
- Prompt 3: `Optimize the Send Enrollment Packet standalone page by replacing the current 500-row wide lead preload with a narrow lookup payload, then add the safest matching Supabase index for the eligible-lead query shape.`
- Prompt 4: `Fix provider_directory and hospital_preference_directory upsert lookups so they use the existing normalized unique indexes instead of ilike scans, without introducing duplicate write paths or schema drift.`

## 10. Founder Summary: What changed since the last run

- No material improvement landed in the main read bottlenecks that were already at the top yesterday. The biggest remaining issues are still MHP detail fan-out, repeated capped active-member preloads, the 500-row eligible-lead preload, and the MHP directory lookup mismatch.
- The commits since the last run were mostly safety and correctness work: idempotency for sales activity replays, enrollment-packet event dedupe, member-file write verification, and MAR PRN sync compatibility. That work is good for workflow safety, but it did not materially change today’s top read-performance risks.
- No new regression was confirmed in the member-files list RPC path, admin audit trail pagination path, enrollment-packet list/history index support, or the current MAR dashboard read path.
- The practical next fix pass should stay focused on search-first roster lookups and breaking up the MHP detail page, because those two changes are still the clearest path to reducing ongoing query cost.
