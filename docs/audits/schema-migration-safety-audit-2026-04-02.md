# Schema Migration Safety Audit (2026-04-02)

Generated: 2026-04-02

## 1 Executive Summary
- I did not find a dedicated current runner for this report. This artifact uses the repo's existing manual audit pattern: compare runtime object usage in `app/`, `lib/`, and `scripts/` against `supabase/migrations/`, then save a dated markdown report in `docs/audits`.
- Current runtime-to-migration alignment is materially better than the old March 11 schema artifact. This run found `108` runtime `.from(...)` objects, `76` real runtime RPC names after excluding the helper sentinel `rpc_failed`, and `1` storage bucket reference. I did not find any missing runtime table/view names, missing runtime RPC names, or missing runtime storage buckets in migrations for the current repo state.
- No local migration-number collision remains in the current repo state. The additive lead lookup index now lives at [supabase/migrations/0177_enrollment_packet_lead_lookup_index.sql:1](/D:/Memory%20Lane%20App/supabase/migrations/0177_enrollment_packet_lead_lookup_index.sql#L1), and the final custom-invoice RPC hardening lives at [supabase/migrations/0178_harden_custom_invoice_rpc_atomicity.sql:1](/D:/Memory%20Lane%20App/supabase/migrations/0178_harden_custom_invoice_rpc_atomicity.sql#L1).
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
- No findings.
- The current local sequence is monotonic through [supabase/migrations/0175_fk_covering_indexes_hardening.sql:1](/D:/Memory%20Lane%20App/supabase/migrations/0175_fk_covering_indexes_hardening.sql#L1), [supabase/migrations/0176_safe_unused_index_cleanup.sql:1](/D:/Memory%20Lane%20App/supabase/migrations/0176_safe_unused_index_cleanup.sql#L1), [supabase/migrations/0177_enrollment_packet_lead_lookup_index.sql:1](/D:/Memory%20Lane%20App/supabase/migrations/0177_enrollment_packet_lead_lookup_index.sql#L1), and [supabase/migrations/0178_harden_custom_invoice_rpc_atomicity.sql:1](/D:/Memory%20Lane%20App/supabase/migrations/0178_harden_custom_invoice_rpc_atomicity.sql#L1).

## 7 Recommended Migration Hardening Plan
1. Keep the `0175` through `0178` sequence stable and avoid any further rename drift after linked-project repair.
2. Re-run linked-project verification after repairing remote migration history so the applied history matches the committed filenames.
3. Apply the final ordered set to the target Supabase environment before treating the repo as production-ready for this run window.

## 8 Suggested Codex Prompts
- `Repair the linked Supabase migration history so the previously applied 0175/0176 changes use the committed ordered filenames, then rerun db:check and confirm the remaining pending migrations apply cleanly.`
- `After linked-project repair, regenerate the schema migration safety audit and confirm runtime table, RPC, and member-documents bucket usage still map cleanly to migrations.`

## 9 Founder Summary
- The good news is that I did not find a new schema/runtime drift problem in the app itself. The current repo's runtime tables, RPCs, and storage bucket all map back to migrations.
- The main remaining migration-safety work is linked-project repair, not repo naming. The local ordered migration set is now clean through `0178`.
- I would treat the linked Supabase migration-history mismatch as the production blocker for this run window until the remote history is repaired and the committed `0175` through `0178` sequence is what the project recognizes.
