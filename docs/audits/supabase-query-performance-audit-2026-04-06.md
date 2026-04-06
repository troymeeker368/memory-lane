# Supabase Query Performance Audit

Date: 2026-04-06
Automation: Supabase Query Performance Audit

## 1. Executive Summary

This run is materially better than the 2026-04-05 audit.

The biggest items from the last run are now closed:

- Documentation tracker reads are paginated instead of loading the full tracker table in [`/D:/Memory Lane App/lib/services/documentation.ts`](/D:/Memory%20Lane%20App/lib/services/documentation.ts).
- The documentation tracker due-date index now exists in [`/D:/Memory Lane App/supabase/migrations/0196_documentation_tracker_due_date_index.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0196_documentation_tracker_due_date_index.sql).
- The sales follow-up dashboard now uses the shared sales summary RPC instead of doing separate lead bucket counts in app code. See [`/D:/Memory Lane App/lib/services/sales-crm-read-model.ts`](/D:/Memory%20Lane%20App/lib/services/sales-crm-read-model.ts) and [`/D:/Memory Lane App/supabase/migrations/0200_sales_dashboard_follow_up_summary_rpc.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0200_sales_dashboard_follow_up_summary_rpc.sql).
- The enrollment packet eligible-lead email search index now exists in [`/D:/Memory Lane App/supabase/migrations/0197_enrollment_packet_eligible_lead_email_trgm_index.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0197_enrollment_packet_eligible_lead_email_trgm_index.sql).
- The MAR sync candidate index now exists in [`/D:/Memory Lane App/supabase/migrations/0199_mar_sync_candidate_index.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0199_mar_sync_candidate_index.sql).

The remaining query risk has shifted into narrower but still important areas:

1. `confirmed` High: billing and report date-range reads still filter on `billing_invoices.invoice_date` without a matching index, which can become expensive as invoice history grows.
2. `confirmed` High: POF read paths still do read-time expiration repair one row at a time, which turns list/detail reads into repeated write work.
3. `confirmed` Medium: MHP detail reads still load the full provider and hospital preference directories when those tabs are requested.
4. `confirmed` Medium: operational reliability snapshot reads still do many separate exact-count queries across the same workflow tables.
5. `confirmed` Medium: sales form lookups still prefetch large lead/partner/referral lists on every form load, even when the user may only need one selected record or a small search result.

## 2. Missing Indexes

1. `confirmed` `billing_invoices(invoice_date desc)`
Why it matters:
- Revenue and on-demand billing reports filter by `invoice_date` ranges and sometimes order by `invoice_date desc`.
- The repo shows `member_month`, `invoice_source_month`, and FK indexes, but not a direct `invoice_date` index.
Evidence:
- Query paths: [`/D:/Memory Lane App/lib/services/admin-reporting-foundation.ts#L141`](/D:/Memory%20Lane%20App/lib/services/admin-reporting-foundation.ts#L141), [`/D:/Memory Lane App/lib/services/admin-reporting-foundation.ts#L310`](/D:/Memory%20Lane%20App/lib/services/admin-reporting-foundation.ts#L310)
- Existing invoice indexes: [`/D:/Memory Lane App/supabase/migrations/0013_care_plans_and_billing_execution.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0013_care_plans_and_billing_execution.sql), [`/D:/Memory Lane App/supabase/migrations/0124_data_access_optimization_indexes.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0124_data_access_optimization_indexes.sql)

2. `confirmed` Trigram index for `profiles.full_name`
Why it matters:
- Enrollment packet list search resolves sender matches by running `ilike` against `profiles.full_name`.
- The repo does not show a matching `full_name` search index on `profiles`.
Evidence:
- Query path: [`/D:/Memory Lane App/lib/services/enrollment-packet-list-support.ts#L107`](/D:/Memory%20Lane%20App/lib/services/enrollment-packet-list-support.ts#L107)
- Existing profile indexes: [`/D:/Memory Lane App/supabase/migrations/0002_rbac_roles_permissions.sql#L55`](/D:/Memory%20Lane%20App/supabase/migrations/0002_rbac_roles_permissions.sql#L55), [`/D:/Memory Lane App/supabase/migrations/0175_fk_covering_indexes_hardening.sql#L469`](/D:/Memory%20Lane%20App/supabase/migrations/0175_fk_covering_indexes_hardening.sql#L469)

No confirmed missing index remains for last run's documentation tracker due-date path, lead email search, MAR sync candidate scan, or care plan latest-row lookup.

## 3. Potential Table Scans

1. `confirmed` High: billing invoice date-range reports can degrade into broader scans
Why it could become slow:
- Both revenue summary and on-demand billing reports filter on `invoice_date`.
- Without a matching `invoice_date` index, growing invoice history can force Postgres to inspect far more rows than the screen needs.
Evidence:
- [`/D:/Memory Lane App/lib/services/admin-reporting-foundation.ts#L141`](/D:/Memory%20Lane%20App/lib/services/admin-reporting-foundation.ts#L141)
- [`/D:/Memory Lane App/lib/services/admin-reporting-foundation.ts#L310`](/D:/Memory%20Lane%20App/lib/services/admin-reporting-foundation.ts#L310)
Estimated scaling risk:
- Near-term

2. `confirmed` Medium: enrollment packet sender-name search can fall back to a profile name scan
Why it could become slow:
- Sender-name matching uses `profiles.full_name ilike(...)`.
- The repo does not show a `profiles.full_name` search index.
Evidence:
- [`/D:/Memory Lane App/lib/services/enrollment-packet-list-support.ts#L107`](/D:/Memory%20Lane%20App/lib/services/enrollment-packet-list-support.ts#L107)
Estimated scaling risk:
- Near-term

## 4. N+1 Query Patterns

1. `confirmed` High: POF read paths still do one expiration update plus one document-event insert per expired row
Why it could become slow:
- `refreshExpiredRequests` loops over expired rows and calls `markRequestExpired` for each one.
- That means a single list or timeline read can fan out into repeated writes when historical POF requests have aged out.
- This is both a performance risk and a read-path side effect risk.
Evidence:
- Expiration loop: [`/D:/Memory Lane App/lib/services/pof-read.ts#L159`](/D:/Memory%20Lane%20App/lib/services/pof-read.ts#L159)
- Per-row update + insert: [`/D:/Memory Lane App/lib/services/pof-read.ts#L135`](/D:/Memory%20Lane%20App/lib/services/pof-read.ts#L135)
- Read paths that trigger it: [`/D:/Memory Lane App/lib/services/pof-read.ts#L180`](/D:/Memory%20Lane%20App/lib/services/pof-read.ts#L180), [`/D:/Memory Lane App/lib/services/pof-read.ts#L227`](/D:/Memory%20Lane%20App/lib/services/pof-read.ts#L227), [`/D:/Memory Lane App/lib/services/pof-read.ts#L267`](/D:/Memory%20Lane%20App/lib/services/pof-read.ts#L267)
Estimated scaling risk:
- Near-term

No other classic one-query-per-row Supabase read loop was confirmed in member lists, MAR monthly report assembly, care plan dashboards, or member files during this run.

## 5. Inefficient Data Fetching

1. `confirmed` Medium: MHP detail still loads full reference directories into memory
Why it could become slow:
- When provider or hospital directory data is requested, the code reads the whole `provider_directory` or `hospital_preference_directory` table and sorts it in app memory.
- That is acceptable while those tables stay small, but it does not scale cleanly as directory usage grows.
Evidence:
- [`/D:/Memory Lane App/lib/services/member-health-profiles-supabase.ts#L520`](/D:/Memory%20Lane%20App/lib/services/member-health-profiles-supabase.ts#L520)
- [`/D:/Memory Lane App/lib/services/member-health-profiles-supabase.ts#L523`](/D:/Memory%20Lane%20App/lib/services/member-health-profiles-supabase.ts#L523)
Estimated scaling risk:
- Long-term

2. `confirmed` Medium: sales form lookups still prefetch large lookup lists on initial load
Why it could become slow:
- The form loader pulls up to 120 leads, 250 partners, and 250 referral sources on each load, even before the user starts searching.
- This is avoidable payload width on common sales entry pages.
Evidence:
- [`/D:/Memory Lane App/lib/services/sales-crm-read-model.ts#L533`](/D:/Memory%20Lane%20App/lib/services/sales-crm-read-model.ts#L533)
- [`/D:/Memory Lane App/lib/services/sales-crm-read-model.ts#L543`](/D:/Memory%20Lane%20App/lib/services/sales-crm-read-model.ts#L543)
Estimated scaling risk:
- Near-term

3. `confirmed` Low: on-demand report paths still do count-then-fetch as two separate queries
Why it could become slow:
- Billing, transportation, and leads on-demand reports first run an exact count, then run the full select.
- The row-limit safeguard is good, but it still doubles the round trips for larger report windows.
Evidence:
- [`/D:/Memory Lane App/lib/services/admin-reporting-foundation.ts#L310`](/D:/Memory%20Lane%20App/lib/services/admin-reporting-foundation.ts#L310)
- [`/D:/Memory Lane App/lib/services/admin-reporting-foundation.ts#L352`](/D:/Memory%20Lane%20App/lib/services/admin-reporting-foundation.ts#L352)
- [`/D:/Memory Lane App/lib/services/admin-reporting-foundation.ts#L392`](/D:/Memory%20Lane%20App/lib/services/admin-reporting-foundation.ts#L392)
Estimated scaling risk:
- Long-term

## 6. Duplicate Query Logic

1. `confirmed` Medium: operational reliability snapshot duplicates workflow counting across many separate queries
Where:
- Summary counts: [`/D:/Memory Lane App/lib/services/operational-reliability.ts#L291`](/D:/Memory%20Lane%20App/lib/services/operational-reliability.ts#L291)
- Snapshot composition: [`/D:/Memory Lane App/lib/services/operational-reliability.ts#L363`](/D:/Memory%20Lane%20App/lib/services/operational-reliability.ts#L363)
Why it matters:
- The snapshot screen is still built from many separate exact-count and list reads across the same workflow domains.
- That keeps performance tuning scattered instead of pushing one canonical read model for this dashboard.

2. `confirmed` Low: member care plan summary paths still re-read the same member’s care plans in multiple shapes
Where:
- Overview count + latest row: [`/D:/Memory Lane App/lib/services/care-plans-read-model.ts#L545`](/D:/Memory%20Lane%20App/lib/services/care-plans-read-model.ts#L545)
- Snapshot full list + latest row: [`/D:/Memory Lane App/lib/services/care-plans-read-model.ts#L563`](/D:/Memory%20Lane%20App/lib/services/care-plans-read-model.ts#L563)
Why it matters:
- These are not dangerous today, but they do duplicate per-member care plan reads and make future optimization harder than it needs to be.

## 7. Recommended Index Additions

Add these first:

1. `create index if not exists idx_billing_invoices_invoice_date_desc on public.billing_invoices (invoice_date desc);`
Use for:
- admin revenue summary date-range reads
- on-demand billing revenue exports

2. `create index if not exists idx_profiles_full_name_trgm on public.profiles using gin (full_name gin_trgm_ops);`
Use for:
- enrollment packet sender-name search

Optional:

3. `create index if not exists idx_billing_invoices_invoice_date_status on public.billing_invoices (invoice_date desc, invoice_status);`
Use only if invoice date reports continue filtering out draft/void rows heavily after the first index is added.

## 8. Performance Hardening Plan

Phase 1: report and POF read-path hardening
- Add the `billing_invoices(invoice_date desc)` index.
- Move POF expiration repair out of read methods and into a canonical background or RPC-backed maintenance path.
- Keep POF list and timeline reads read-only after that change.

Phase 2: reduce avoidable payloads
- Stop loading the full provider and hospital preference directories on MHP detail when a narrower lookup path is enough.
- Convert sales form lookups to smaller initial payloads plus explicit search or selected-record fetches.

Phase 3: consolidate dashboard reads
- Replace the current operational reliability multi-query summary with one canonical RPC or read model.
- If care plan member summary reads become hot, collapse the overview/snapshot/latest-row paths into one reusable read boundary.

Phase 4: low-risk cleanup
- Review count-then-fetch on-demand reports and switch to a single RPC or a cheaper guard if the current two-step pattern becomes noticeable.
- Add the `profiles.full_name` trigram index if enrollment packet sender-name search is staying on the current search strategy.

## 9. Suggested Codex Prompts

1. `Add the smallest safe Supabase migration to index billing_invoices by invoice_date for admin reporting. Then verify the current revenue summary and on-demand billing report queries are aligned to that index without changing business behavior.`

2. `Refactor pof-read.ts so read paths no longer update expired requests one row at a time during list/detail reads. Preserve canonical POF expiry behavior, but move the repair into one safe write boundary such as an RPC or explicit maintenance path.`

3. `Harden member health profile detail performance. Stop loading the full provider_directory and hospital_preference_directory tables when only a small lookup surface is needed. Keep Supabase as source of truth and avoid duplicating directory logic.`

4. `Reduce over-fetching in sales form lookups. Replace the current preload of recent leads plus large partner/referral lists with smaller initial payloads and explicit selected-record/search fetches. Preserve current forms and canonical service boundaries.`

5. `Design one canonical read model for the operational reliability dashboard so summary counts and stuck-workflow lists stop using many separate Supabase queries. Keep the output the same and prefer a small RPC-backed aggregation if it meaningfully reduces repeated reads.`

## 10. Founder Summary: What changed since the last run

This run is better than the 2026-04-05 audit.

What improved:

- The documentation tracker problem is largely closed. The tracker is now paginated in [`/D:/Memory Lane App/lib/services/documentation.ts#L158`](/D:/Memory%20Lane%20App/lib/services/documentation.ts#L158), and the due-date index exists in [`/D:/Memory Lane App/supabase/migrations/0196_documentation_tracker_due_date_index.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0196_documentation_tracker_due_date_index.sql).
- The sales follow-up dashboard no longer does the older repeated lead bucket count pattern. It now leans on the shared sales summary RPC in [`/D:/Memory Lane App/lib/services/sales-crm-read-model.ts#L733`](/D:/Memory%20Lane%20App/lib/services/sales-crm-read-model.ts#L733) and [`/D:/Memory Lane App/lib/services/sales-workflows.ts#L140`](/D:/Memory%20Lane%20App/lib/services/sales-workflows.ts#L140).
- The lead email search gap from the last run is closed by [`/D:/Memory Lane App/supabase/migrations/0197_enrollment_packet_eligible_lead_email_trgm_index.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0197_enrollment_packet_eligible_lead_email_trgm_index.sql).
- The MAR sync scan concern from the last run is partly addressed by [`/D:/Memory Lane App/supabase/migrations/0199_mar_sync_candidate_index.sql`](/D:/Memory%20Lane%20App/supabase/migrations/0199_mar_sync_candidate_index.sql).
- Member files are in a better place too: the command center list path now uses the shared `rpc_list_member_files` read boundary in [`/D:/Memory Lane App/lib/services/member-command-center-runtime.ts#L280`](/D:/Memory%20Lane%20App/lib/services/member-command-center-runtime.ts#L280).

What is still open:

- Billing/report date queries still need direct `invoice_date` index support.
- POF reads still do write work while rendering lists and timelines.
- Some lookup and detail pages still fetch more reference data than they need.
- Operational reliability still spreads one dashboard across many separate Supabase reads.

If you want the highest-value next fix now, start with the billing invoice date index and the POF read-path cleanup. Those are the clearest remaining items with real scaling impact.
