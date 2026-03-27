# Supabase Query Performance Audit

Date: 2026-03-27

## 1. Executive Summary

This run is better than the 2026-03-26 run.

- Confirmed improvement: the physician orders list is no longer doing the old "fetch first, filter later" pattern. `lib/services/physician-orders-read.ts:107` now builds SQL-side search clauses, `lib/services/physician-orders-read.ts:172` now uses a paginated list read, and `app/(portal)/health/physician-orders/page.tsx:63` calls that paginated path.
- Confirmed improvement: yesterday's physician-orders list bottleneck is no longer the main performance risk.
- Main remaining risk: several sales pipeline pages still call `getLeadList()` without pagination, which means those pages read whole stage buckets into memory as volume grows. See `lib/services/sales-crm-read-model.ts:468`, `app/(portal)/sales/pipeline/inquiry/page.tsx:10`, `app/(portal)/sales/pipeline/tour/page.tsx:10`, `app/(portal)/sales/pipeline/eip/page.tsx:11`, `app/(portal)/sales/pipeline/nurture/page.tsx:10`, `app/(portal)/sales/pipeline/referrals-only/page.tsx:9`, `app/(portal)/sales/pipeline/closed-won/page.tsx:10`, `app/(portal)/sales/pipeline/closed-lost/page.tsx:10`, and `app/(portal)/sales/pipeline/follow-up-dashboard/page.tsx:28`.
- Main remaining risk: shared member dropdown loading still preloads the active roster on many pages through `lib/services/documentation.ts:108` and `lib/services/shared-lookups-supabase.ts:142`. The cap is safer than the old unbounded reads, but the same eager read still happens across many screens.
- Main remaining risk: Member Health Profile detail is still one of the heaviest single-member reads in the app. `lib/services/member-health-profiles-supabase.ts:633` still loads many member collections in one batch, and `app/(portal)/health/member-health-profiles/[memberId]/page.tsx:241` adds care plan, billing, physician order, and progress-note reads on top.
- No confirmed regression was found in the member list, member files, MAR member options, reports home RPC, or sales summary RPC paths that improved in earlier runs.

## 2. Missing Indexes

No new critical missing-index gap was confirmed in the highest-volume paths this run, but one likely index gap is now more visible.

- High, likely: if the dedicated sales stage pages stay in their current shape, add an index for `leads (status, stage, inquiry_date desc)`. The current list read in `lib/services/sales-crm-read-model.ts:485` filters by `status` and often `stage`, then sorts by `inquiry_date`, but current migrations only cover `status + created_at`, `status + next_follow_up_date`, and a standalone `inquiry_date` path. See `supabase/migrations/0048_query_performance_support_indexes.sql:32`, `supabase/migrations/0048_query_performance_support_indexes.sql:35`, and `supabase/migrations/0117_query_performance_indexes_partials.sql:6`.
- Medium, likely: a standalone `physician_orders (updated_at desc)` index is now a secondary optimization candidate because the repaired paginated list still orders the whole table by `updated_at` in `lib/services/physician-orders-read.ts:184`, while current physician-order indexes are still member-centric in `supabase/migrations/0006_intake_pof_mhp_supabase.sql:128`.
- No confirmed missing-index gap was found in MAR, member files, audit logs, or system-event reads this run. Earlier performance hardening still appears to be carrying those paths.

## 3. Potential Table Scans

- High, confirmed: the sales stage pages still use an unpaginated lead list read. `lib/services/sales-crm-read-model.ts:485` only turns on `.range(...)` when pagination is explicitly requested, and the stage pages listed above do not pass `pageSize`. That means these pages will read entire stage buckets and rely on app memory to render them.
- High, confirmed: the follow-up dashboard still reads all open leads, then deduplicates, sorts, and groups them in the page. See `app/(portal)/sales/pipeline/follow-up-dashboard/page.tsx:28`, `app/(portal)/sales/pipeline/follow-up-dashboard/page.tsx:35`, and `app/(portal)/sales/pipeline/follow-up-dashboard/page.tsx:41`. The existing `status + next_follow_up_date` index helps, but the page still scales with the full open-lead set rather than a bounded page.
- Medium, confirmed: the MHP directory upsert helpers still use `ilike(...) + order(updated_at desc) + limit(1)` for provider and hospital lookups in `lib/services/member-health-profiles-write-supabase.ts:375` and `lib/services/member-health-profiles-write-supabase.ts:424`. The schema already has normalized unique indexes in `supabase/migrations/0012_legacy_operational_health_alignment.sql:132` and `supabase/migrations/0012_legacy_operational_health_alignment.sql:144`, so the current fuzzy lookup shape is broader than it needs to be and is likely to scan as those directories grow.

## 4. N+1 Query Patterns

No confirmed classic N+1 query pattern was found in the main priority paths this run.

- The biggest remaining debt is still broad batched over-fetching, not one-query-per-row loops.
- Residual caution: MHP detail and the follow-up dashboard are still heavy, but the problem is payload size and unpaginated list reads rather than a true N+1 fan-out.

## 5. Inefficient Data Fetching

- High, confirmed: dedicated sales pipeline pages still fetch whole result sets instead of paged result sets. This includes inquiry, tour, EIP, nurture, referrals-only, closed-won, and closed-lost. The shared list helper supports pagination, but these callers do not use it.
- High, confirmed: the follow-up dashboard still loads every open lead, then re-sorts and slices it in app memory. That is practical today, but it is exactly the kind of page that becomes noticeably slow as lead volume grows.
- High, confirmed: Member Health Profile detail still loads many member collections in one `Promise.all(...)` batch in `lib/services/member-health-profiles-supabase.ts:663`, then adds care plans, billing payor, physician orders, and progress-note summary in `app/(portal)/health/member-health-profiles/[memberId]/page.tsx:241`. This remains one of the largest per-page payloads in the app.
- Medium, confirmed: shared `getMembers()` still preloads the active member dropdown on many screens through `lib/services/documentation.ts:108`. Examples include ancillary `app/(portal)/ancillary/page.tsx:20`, documentation activity `app/(portal)/documentation/activity/page.tsx:28`, toilet `app/(portal)/documentation/toilet/page.tsx:23`, shower `app/(portal)/documentation/shower/page.tsx:18`, blood sugar `app/(portal)/documentation/blood-sugar/page.tsx:16`, documentation dashboard `app/(portal)/documentation/documentation-dashboard-home.tsx:198`, care plan list `app/(portal)/health/care-plans/list/page.tsx:45`, care plan due report `app/(portal)/health/care-plans/due-report/page.tsx:31`, physician orders `app/(portal)/health/physician-orders/page.tsx:60`, member summary `app/(portal)/reports/member-summary/page.tsx:96`, and health dashboard `lib/services/health-dashboard.ts:124`.
- Medium, confirmed: the member preload is capped now, not unbounded. `lib/services/shared-lookups-supabase.ts:17` keeps the default limit at 200. That is safer than the old behavior, but it is still repeated eager work on page load.
- Medium, confirmed: sales form lookups still preload large option lists on page load. `lib/services/sales-crm-read-model.ts:151` caps leads at 120, partners at 250, and referral sources at 250, and `lib/services/sales-crm-read-model.ts:331` to `lib/services/sales-crm-read-model.ts:347` loads those lists eagerly. Current callers include `app/(portal)/sales/new-entries/new-inquiry/page.tsx:15`, `app/(portal)/sales/leads/[leadId]/edit/page.tsx:14`, `app/(portal)/sales/new-entries/log-partner-activities/page.tsx:21`, `app/(portal)/sales/new-entries/log-lead-activity/page.tsx:21`, and `app/(portal)/sales/new-entries/new-referral-source/page.tsx:8`.
- Medium, confirmed: the standalone enrollment-packet send page still requests up to 500 open leads in one read at `app/(portal)/sales/new-entries/send-enrollment-packet/page.tsx:13`. That is bounded, but it is still a "load many options now" pattern that will get more expensive as open leads grow.

## 6. Duplicate Query Logic

- High, confirmed: the sales pipeline still has two competing list patterns. `app/(portal)/sales/pipeline/leads-table/page.tsx:40` uses the paginated lead list correctly, while the dedicated stage pages listed above still use the same service without pagination. That duplication makes it easy for performance fixes to land in one place and be missed in another.
- Medium, confirmed: the shared active-member preload pattern is still duplicated across documentation, care plans, physician orders, dashboards, ancillary, and reports through `getMembers()` in `lib/services/documentation.ts:108`.
- Medium, likely: the repo now has both a search-first member lookup path in `lib/services/shared-lookups-supabase.ts:67` and an eager preload path in `lib/services/shared-lookups-supabase.ts:142`. Callers are still inconsistent about which one they use, so new pages can easily drift back toward unnecessary roster reads.

## 7. Recommended Index Additions

The most practical index addition now is in sales, not physician orders.

```sql
create index if not exists idx_leads_status_stage_inquiry_date_desc
  on public.leads (status, stage, inquiry_date desc);
```

Why: supports the current dedicated stage pages that filter by `status` and `stage`, then sort by `inquiry_date`.

If physician-order history starts growing quickly, this is the next index worth considering:

```sql
create index if not exists idx_physician_orders_updated_at_desc
  on public.physician_orders (updated_at desc);
```

Why: supports the repaired paginated physician-order list, which now orders by `updated_at` across the table.

## 8. Performance Hardening Plan

1. Move the dedicated sales stage pages and the follow-up dashboard onto one canonical paginated read model. The simplest version is to keep `getLeadList()` but require `pageSize` for those pages instead of reading all rows.
2. Replace repeated `getMembers()` preloads with a search-first member lookup flow for forms and filters. Keep the capped preload only where the full option set is truly necessary.
3. Slim Member Health Profile detail further by splitting more sections into tab-aware or section-aware loads. Provider and hospital directories are already tab-limited, but diagnoses, medications, allergies, providers, equipment, notes, assessments, and cross-domain widgets are still bundled too broadly.
4. Rework provider and hospital directory write helpers to use normalized equality or true upsert semantics aligned to the existing unique indexes, instead of fuzzy `ilike` lookups.
5. Shrink sales form lookups so pages do not preload large partner/referral directories unless the user is actively searching or editing a known record.
6. Re-run this audit after the sales pagination pass and the shared member-lookup cleanup. Those two fixes would remove most of the remaining near-term read pressure.

## 9. Suggested Codex Prompts

Prompt 1:

```text
Fix sales pipeline pagination in Memory Lane.

Current problem:
- app/(portal)/sales/pipeline/inquiry/page.tsx
- app/(portal)/sales/pipeline/tour/page.tsx
- app/(portal)/sales/pipeline/eip/page.tsx
- app/(portal)/sales/pipeline/nurture/page.tsx
- app/(portal)/sales/pipeline/referrals-only/page.tsx
- app/(portal)/sales/pipeline/closed-won/page.tsx
- app/(portal)/sales/pipeline/closed-lost/page.tsx
- app/(portal)/sales/pipeline/follow-up-dashboard/page.tsx
still call getLeadList() without pagination, so they read whole lead buckets into memory.

What to do:
1. Keep Supabase as source of truth.
2. Preserve one canonical lead-list service path.
3. Add real pagination or a dedicated RPC/read model for these pages.
4. Keep current filters and sorting behavior practical for staff.
5. Only add an index if the final query shape still needs it.
6. Run typecheck and summarize downstream behavior changes.
```

Prompt 2:

```text
Replace repeated active-member dropdown preloads with a canonical search-first member lookup flow in Memory Lane.

Current problem:
- getMembers() still preloads active member options across documentation, care plans, physician orders, dashboards, ancillary, and reports.
- The current default cap is safer than before, but the same eager read still happens on many pages.

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
- getMemberHealthProfileDetailSupabase still loads many collections in one batch.
- The MHP detail page then adds care plans, billing payor, physician orders, and progress-note reads on top.

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
- MHP write helpers still use ilike + order(updated_at desc) + limit(1).
- The schema already has normalized unique indexes, so the current lookup path is broader than necessary.

What to do:
1. Keep Supabase as source of truth.
2. Align the lookup/upsert path to the existing normalized uniqueness rules.
3. Prefer deterministic equality or upsert semantics over fuzzy lookup for saves.
4. Do not create duplicate directory rows.
5. Run typecheck and call out any schema dependency if a migration is needed.
```

## 10. Founder Summary: What Changed Since the Last Run

- Improved: the physician orders list is materially better than yesterday. It now paginates and pushes search into SQL, so yesterday's biggest physician-order read risk is no longer the top issue.
- Still improved: the member list, sales summary RPC, reports home RPC, MAR monthly member options RPC, and member-files RPC paths all remain in their better state. I did not find a performance regression in those areas this run.
- Still open: shared member dropdown preloads are still happening on many pages. The cap is safer than the older full-roster behavior, but the app is still doing repeated eager member reads.
- Still open: Member Health Profile detail remains one of the heaviest single-member pages because it still pulls a lot of related data together.
- New main risk focus: sales stage pages and the follow-up dashboard now stand out more clearly than physician orders. They still fetch whole lead buckets instead of paging through them.
- Secondary risk focus: sales form lookups still preload fairly large partner/referral lists, and the standalone enrollment-packet send page still loads up to 500 open leads at once.
