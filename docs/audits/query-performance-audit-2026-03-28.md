# Supabase Query Performance Audit

Date: 2026-03-28

## 1. Executive Summary

This run is better than the 2026-03-27 run.

- Confirmed improvement: the dedicated sales stage pages and the follow-up dashboard now use real pagination instead of whole-bucket reads. See `app/(portal)/sales/pipeline/inquiry/page.tsx:19`, `app/(portal)/sales/pipeline/tour/page.tsx:19`, `app/(portal)/sales/pipeline/eip/page.tsx:20`, `app/(portal)/sales/pipeline/nurture/page.tsx:19`, `app/(portal)/sales/pipeline/referrals-only/page.tsx:18`, `app/(portal)/sales/pipeline/closed-won/page.tsx:19`, `app/(portal)/sales/pipeline/closed-lost/page.tsx:19`, `app/(portal)/sales/pipeline/follow-up-dashboard/page.tsx:33`, and `lib/services/sales-crm-read-model.ts:517`.
- Main confirmed risk now: the enrollment packet operational and completed-history pages still fetch large batches and then apply some filtering in app memory. That is both a performance issue and a correctness risk once the newest 500 rows no longer contain all matches. See `lib/services/enrollment-packet-management.ts:155`, `lib/services/enrollment-packet-management.ts:168`, `lib/services/enrollment-packets-listing.ts:124`, `lib/services/enrollment-packets-listing.ts:197`, `app/(portal)/sales/pipeline/enrollment-packets/page.tsx:32`, and `app/(portal)/sales/new-entries/completed-enrollment-packets/page.tsx:56`.
- Main confirmed risk now: shared active-member dropdown loading is still repeated across documentation, care plans, reports, health dashboard, ancillary, and physician orders through `getMembers()` and `listAllActiveMemberLookupSupabase()`. It is capped at 200 now, which is safer for raw query size, but it also means these screens can silently omit active members once the census exceeds 200. See `lib/services/documentation.ts:108`, `lib/services/shared-lookups-supabase.ts:17`, `lib/services/shared-lookups-supabase.ts:142`, and the call sites listed in section 5.
- Main confirmed risk now: Member Health Profile detail is still one of the heaviest single-member reads in the app. The detail service still loads many member collections at once, and the page adds care plan, billing payor, physician order, and progress-note reads on top. See `lib/services/member-health-profiles-supabase.ts:651` and `app/(portal)/health/member-health-profiles/[memberId]/page.tsx:242`.
- No confirmed regression was found this run in the member list, MAR member options RPC, member-files RPC path, notifications unread count, admin audit trail pagination, or the repaired physician-orders list path.

## 2. Missing Indexes

- High, likely: if the operational enrollment-packet list keeps ordering all packets by `updated_at`, add a plain `updated_at desc` index on `enrollment_packet_requests`. The current page query in `lib/services/enrollment-packet-management.ts:155` orders by `updated_at` without always applying a SQL-side status filter, while current migration support only adds `status + updated_at`, `voided_at`, and `opened_at` indexes in `supabase/migrations/0152_enrollment_packet_lifecycle_and_voiding.sql:51`.
- High, likely: add an index for completed-history reads on `enrollment_packet_requests (status, completed_at desc, created_at desc)`. The completed packet history query in `lib/services/enrollment-packets-listing.ts:124` filters on `status = completed` and orders by `completed_at desc, created_at desc`, but current migrations do not add a matching `completed_at` index.
- Medium, likely: a future `leads (status, stage, inquiry_date desc)` index is still worth considering if stage pages become hot. The query shape in `lib/services/sales-crm-read-model.ts:521` filters by `status` and often `stage`, then sorts by `inquiry_date`, while current indexes only cover `status + created_at`, `status + next_follow_up_date`, and standalone `inquiry_date`. See `supabase/migrations/0048_query_performance_support_indexes.sql:32` and `supabase/migrations/0117_query_performance_indexes_partials.sql:6`.
- Medium, likely: a standalone `physician_orders (updated_at desc)` index is still a secondary optimization candidate for the now-paginated physician orders list in `lib/services/physician-orders-read.ts:181`. Current schema support remains member-centric in `supabase/migrations/0006_intake_pof_mhp_supabase.sql:128`.

## 3. Potential Table Scans

- High, confirmed: `listOperationalEnrollmentPackets()` still reads up to 500 rows from `enrollment_packet_requests`, orders by `updated_at`, selects `*`, and then filters status and free-text search in app memory. See `lib/services/enrollment-packet-management.ts:153` to `lib/services/enrollment-packet-management.ts:190`. As this table grows, the page will keep doing more work than needed and can miss older matching rows because the SQL `limit` happens before the in-memory filter.
- High, confirmed: `listCompletedEnrollmentPacketRequests()` still applies operational-readiness and search filtering after the SQL `limit(500)`. See `lib/services/enrollment-packets-listing.ts:110` to `lib/services/enrollment-packets-listing.ts:217`. That means the page can become both slower and less complete as historical packet volume grows.
- Medium, confirmed: MHP provider and hospital directory write helpers still use case-insensitive lookup queries instead of matching the normalized unique indexes that already exist in schema. See `lib/services/member-health-profiles-write-supabase.ts:28`, `lib/services/member-health-profiles-write-supabase.ts:49`, and the existing indexes in `supabase/migrations/0012_legacy_operational_health_alignment.sql:132`.

## 4. N+1 Query Patterns

No confirmed classic N+1 query pattern was found in the highest-priority paths this run.

- The remaining problems are mostly unbounded list reads, repeated shared lookups, and broad page payloads.
- Residual caution: enrollment packet pages and MHP detail are still expensive, but the issue is query shape and payload width rather than one query per row.

## 5. Inefficient Data Fetching

- High, confirmed: repeated active-member dropdown preloads still happen across ancillary, documentation, care plans, reports, physician orders, and dashboard flows through `getMembers()` and `listAllActiveMemberLookupSupabase()`. Examples: `app/(portal)/ancillary/page.tsx:20`, `app/(portal)/documentation/activity/page.tsx:28`, `app/(portal)/documentation/toilet/page.tsx:23`, `app/(portal)/documentation/shower/page.tsx:18`, `app/(portal)/documentation/blood-sugar/page.tsx:16`, `app/(portal)/documentation/documentation-dashboard-home.tsx:198`, `app/(portal)/health/care-plans/list/page.tsx:43`, `app/(portal)/health/care-plans/due-report/page.tsx:31`, `app/(portal)/health/care-plans/new/page.tsx:16`, `app/(portal)/reports/member-summary/page.tsx:96`, `lib/services/health-dashboard.ts:124`, and `lib/services/physician-orders-read.ts:168`.
- High, confirmed: those repeated member preloads are capped at 200 rows by default in `lib/services/shared-lookups-supabase.ts:17`. That reduces query size, but it also means these dropdowns become incomplete once the center grows beyond 200 active members.
- High, confirmed: Member Health Profile detail still loads many collections in one batch in `lib/services/member-health-profiles-supabase.ts:651`, and the page still adds four more cross-domain reads in `app/(portal)/health/member-health-profiles/[memberId]/page.tsx:242`. The provider and hospital directory reads are now tab-limited, which is good, but the overall detail payload is still large.
- High, confirmed: the operational enrollment-packet list still uses `select("*")` in `lib/services/enrollment-packet-management.ts:157`, even though the page only renders a subset of fields. That increases payload size on top of the in-memory filtering problem.
- High, confirmed: the completed enrollment-packet history read also still uses `select("*")` in `lib/services/enrollment-packets-listing.ts:126`, then applies readiness and search filters after the limited fetch.
- Medium, confirmed: sales form lookups still preload large option sets on page load. `lib/services/sales-crm-read-model.ts:365` to `lib/services/sales-crm-read-model.ts:381` still load up to 120 leads, 250 partners, and 250 referral sources. Current callers include `app/(portal)/sales/new-entries/new-inquiry/page.tsx:15`, `app/(portal)/sales/leads/[leadId]/edit/page.tsx:14`, `app/(portal)/sales/new-entries/log-partner-activities/page.tsx:21`, and `app/(portal)/sales/new-entries/log-lead-activity/page.tsx:21`.
- Medium, confirmed: the standalone send-enrollment-packet page still loads up to 500 eligible leads in one read. See `app/(portal)/sales/new-entries/send-enrollment-packet/page.tsx:11` and `lib/services/sales-crm-read-model.ts:334`. This is bounded, but it is still a preload-heavy pattern.

## 6. Duplicate Query Logic

- High, confirmed: enrollment packet operational listing and completed-history listing both independently load `enrollment_packet_requests`, then separately hydrate member names, lead names, and sender names with the same multi-step lookup pattern. See `lib/services/enrollment-packet-management.ts:75` and `lib/services/enrollment-packets-listing.ts:146`. This makes it easier for pagination or search fixes to land in one packet list and not the other.
- Medium, confirmed: the large active-member preload pattern is still duplicated at the page level across documentation, care plans, reports, health dashboard, ancillary, and physician orders, even though the same lookup service is reused. The SQL is centralized, but the eager-load behavior is duplicated broadly across screens.
- Medium, confirmed: sales entry pages still share the same preload-heavy lead/partner/referral lookup pattern through `getSalesFormLookupsSupabase()`. That is canonical service reuse, but it is still duplicated eager-read behavior that should probably become a search-first interaction instead of a preload-first interaction.

## 7. Recommended Index Additions

The most practical new index work now is around enrollment packet list screens.

```sql
create index if not exists idx_enrollment_packet_requests_updated_at_desc
  on public.enrollment_packet_requests (updated_at desc);
```

Why: supports the current operational packet list if it keeps an all-status `order by updated_at desc` path.

```sql
create index if not exists idx_enrollment_packet_requests_status_completed_at_desc
  on public.enrollment_packet_requests (status, completed_at desc, created_at desc);
```

Why: supports the completed packet history page, which already filters on `status = 'completed'` and sorts by `completed_at`.

Lower-priority follow-up indexes if those pages stay hot:

```sql
create index if not exists idx_leads_status_stage_inquiry_date_desc
  on public.leads (status, stage, inquiry_date desc);

create index if not exists idx_physician_orders_updated_at_desc
  on public.physician_orders (updated_at desc);
```

Why: these align to current list ordering patterns, but they are no longer the top bottleneck after the latest pagination fixes.

## 8. Performance Hardening Plan

1. Build one canonical paginated read model for enrollment packet operational/history pages. Push status, readiness, search, and paging into SQL or RPC before considering bigger UI changes.
2. Replace repeated active-member preloads with a search-first member lookup pattern for forms and filters. Keep a full preload only where the complete list is truly required.
3. Slim MHP detail further by splitting more sections into tab-aware or section-aware reads. The page no longer needs full provider and hospital directories on every tab, but it still pulls a broad baseline payload plus four extra cross-domain reads.
4. Align provider and hospital directory writes to the normalized uniqueness rules already in schema. Prefer deterministic equality or true upsert semantics over `ilike` lookups.
5. Replace preload-heavy sales lookups with targeted search or conditional loading. The smallest safe win is usually to stop loading leads/partners/referral sources until the user interacts with that field.
6. Re-run this audit after the enrollment packet read-model pass and the shared member lookup cleanup. Those are now the highest-leverage performance fixes.

## 9. Suggested Codex Prompts

Prompt 1:

```text
Fix enrollment packet list query performance in Memory Lane.

Current problem:
- lib/services/enrollment-packet-management.ts
- lib/services/enrollment-packets-listing.ts
- app/(portal)/sales/pipeline/enrollment-packets/page.tsx
- app/(portal)/sales/new-entries/completed-enrollment-packets/page.tsx
still fetch up to 500 enrollment_packet_requests rows and then apply some status/search/readiness filtering in app memory.

What to do:
1. Keep Supabase as source of truth.
2. Preserve one canonical service/read-model path for packet list pages.
3. Push filtering, pagination, and sorting into SQL or RPC.
4. Avoid returning more columns than the page actually needs.
5. Call out any needed migration or index additions explicitly.
6. Run typecheck and summarize downstream behavior changes.
```

Prompt 2:

```text
Replace repeated active-member dropdown preloads with a search-first member lookup flow in Memory Lane.

Current problem:
- getMembers() still fans out across documentation, care plans, reports, dashboards, ancillary, and physician orders.
- The shared lookup now defaults to 200 rows, which helps query size but can silently omit active members once census grows past 200.

What to do:
1. Keep Supabase as source of truth.
2. Preserve one canonical member lookup service layer.
3. Introduce a search-first lookup for forms and filters.
4. Keep page/table read models separate from lookup read models.
5. Avoid a large refactor and keep the UI practical.
6. Run typecheck and summarize which pages changed.
```

Prompt 3:

```text
Slim the Member Health Profile detail read path in Memory Lane.

Current problem:
- getMemberHealthProfileDetailSupabase still loads many member collections in one batch.
- The MHP detail page still adds care plans, billing payor, physician orders, and progress-note summary reads on top.

What to do:
1. Keep Supabase canonical.
2. Split more of the heavy MHP detail payload by tab or section.
3. Preserve shared resolver/service boundaries.
4. Do not add mock fallbacks.
5. Keep the fix small and production-safe.
6. Run typecheck and describe what became lighter.
```

Prompt 4:

```text
Fix provider_directory and hospital_preference_directory upsert query shape in Memory Lane.

Current problem:
- MHP write helpers still use ilike lookups before insert/update.
- The schema already has normalized unique indexes for provider name + practice name and hospital name.

What to do:
1. Keep Supabase as source of truth.
2. Align the lookup/upsert path to the existing normalized uniqueness rules.
3. Prefer deterministic equality or upsert semantics over fuzzy lookup for saves.
4. Do not create duplicate directory rows.
5. Run typecheck and call out any schema dependency if a migration is needed.
```

## 10. Founder Summary: What Changed Since the Last Run

- Improved: the sales pipeline stage pages and the follow-up dashboard now paginate correctly. Yesterday’s top sales-bucket read problem is no longer the main issue.
- Improved: I did not find a regression in the repaired physician-orders list, member-files RPC path, MAR member options RPC path, notifications count path, or admin audit trail pagination.
- Still open: repeated active-member dropdown preloads remain across many screens, and the current 200-member cap means those dropdowns can become incomplete as census grows.
- Still open: Member Health Profile detail remains one of the heaviest single-member pages, and the provider/hospital directory write helpers still use fuzzy lookups instead of the normalized uniqueness path already defined in schema.
- New main risk focus: enrollment packet operational and completed-history list pages now stand out more clearly. They still fetch large batches, use `select("*")`, and do some filtering in app memory after the SQL limit.
- Secondary risk focus: sales form lookups and the standalone send-enrollment-packet flow still preload fairly large lead, partner, and referral datasets up front.
