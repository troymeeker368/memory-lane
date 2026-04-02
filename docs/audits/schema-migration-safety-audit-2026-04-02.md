# Schema Migration Safety Audit (2026-04-02)

Generated: 2026-04-02

## 1 Executive Summary
- I did not find a dedicated current runner for this report. This artifact uses the repo's existing manual audit pattern: compare runtime object usage in `app/`, `lib/`, and `scripts/` against `supabase/migrations/`, then save a dated markdown report in `docs/audits`.
- Current runtime-to-migration alignment is materially better than the old March 11 schema artifact. This run found `108` runtime `.from(...)` objects, `76` real runtime RPC names after excluding the helper sentinel `rpc_failed`, and `1` storage bucket reference. I did not find any missing runtime table/view names, missing runtime RPC names, or missing runtime storage buckets in migrations for the current repo state.
- Confirmed migration-safety blocker: the repo currently contains two different `0177_*.sql` files, which breaks the contract that migrations use one monotonic ordered prefix per step. Evidence: [supabase/migrations/0177_enrollment_packet_lead_lookup_index.sql:1](/D:/Memory%20Lane%20App/supabase/migrations/0177_enrollment_packet_lead_lookup_index.sql#L1) and [supabase/migrations/0177_harden_custom_invoice_rpc_atomicity.sql:1](/D:/Memory%20Lane%20App/supabase/migrations/0177_harden_custom_invoice_rpc_atomicity.sql#L1).
- Repo-only blocker: I audited local files only. I did not verify whether the target Supabase project has all of these local migrations applied yet.

## 2 Destructive Migration Risks
- No findings.
- The newest local cleanup migration, [supabase/migrations/0176_safe_unused_index_cleanup.sql:6](/D:/Memory%20Lane%20App/supabase/migrations/0176_safe_unused_index_cleanup.sql#L6), [supabase/migrations/0176_safe_unused_index_cleanup.sql:10](/D:/Memory%20Lane%20App/supabase/migrations/0176_safe_unused_index_cleanup.sql#L10), and [supabase/migrations/0176_safe_unused_index_cleanup.sql:14](/D:/Memory%20Lane%20App/supabase/migrations/0176_safe_unused_index_cleanup.sql#L14) only drops indexes, not tables or columns. Based on the comments in that file and the existing stronger replacements, I did not confirm a data-loss risk from `0176` itself.

## 3 Schema Drift Findings
- No findings.
- Repo evidence from this run:
  - runtime table/view references missing from migrations: `0`
  - runtime RPC names missing from migrations: `0`
  - runtime storage buckets missing from migrations: `0`
- Storage bucket alignment remains present through [supabase/migrations/0019_pof_esign_workflow.sql:108](/D:/Memory%20Lane%20App/supabase/migrations/0019_pof_esign_workflow.sql#L108) and [supabase/migrations/0019_pof_esign_workflow.sql:109](/D:/Memory%20Lane%20App/supabase/migrations/0019_pof_esign_workflow.sql#L109), which create the private `member-documents` bucket used by current member-file and signing artifact paths.

## 4 Missing Constraints
- No findings.
- I did not find a new runtime object in this run that depends on a missing foreign key, unique contract, or storage bucket definition in migrations.

## 5 Unsafe Column Changes
- No findings.
- The latest local migrations I reviewed for this run do not introduce destructive column drops, type rewrites, or nullability tightening on live workflow tables.

## 6 Migration Order Risks
- High - duplicate ordered prefix `0177` is currently present in two different migration files.
  Exact schema risk: [supabase/migrations/0177_enrollment_packet_lead_lookup_index.sql:1](/D:/Memory%20Lane%20App/supabase/migrations/0177_enrollment_packet_lead_lookup_index.sql#L1) and [supabase/migrations/0177_harden_custom_invoice_rpc_atomicity.sql:1](/D:/Memory%20Lane%20App/supabase/migrations/0177_harden_custom_invoice_rpc_atomicity.sql#L1) both claim the same migration number.
  Potential production impact: ordered migration review, cherry-pick safety, manual apply workflows, and founder auditability all become weaker when two unrelated changes share the same ordinal step. This is especially risky here because the same local run also contains a follow-on custom-invoice RPC change in [supabase/migrations/0178_harden_custom_invoice_rpc_atomicity.sql:1](/D:/Memory%20Lane%20App/supabase/migrations/0178_harden_custom_invoice_rpc_atomicity.sql#L1), so the intended sequence is harder to reason about than it should be.
  Recommended fix: renumber the local untracked `0177`/`0178` files into a unique monotonic sequence before merge or any `supabase db push`.

## 7 Recommended Migration Hardening Plan
1. Renumber the untracked local migrations so each file has one unique ascending prefix.
2. Re-run this schema audit after renumbering to keep the saved artifact aligned with the final migration sequence that will actually ship.
3. Apply the renumbered set to the target Supabase environment before treating the repo as production-ready for this run window.

## 8 Suggested Codex Prompts
- `Renumber the current untracked 0177/0178 Supabase migrations into a unique forward-only sequence, keep their contents unchanged, and update any tests or documentation that reference the old filenames.`
- `After renumbering the local Supabase migrations, regenerate the schema migration safety audit and confirm runtime table, RPC, and member-documents bucket usage still map cleanly to migrations.`

## 9 Founder Summary
- The good news is that I did not find a new schema/runtime drift problem in the app itself. The current repo's runtime tables, RPCs, and storage bucket all map back to migrations.
- The main migration-safety blocker is process, not missing schema: two different local migration files are both numbered `0177`. That breaks the repo's own ordered-migration contract and makes rollout history harder to trust.
- I would treat that numbering collision as a production blocker for this run window until the local migration sequence is cleaned up and the final ordered set is what gets applied to Supabase.
