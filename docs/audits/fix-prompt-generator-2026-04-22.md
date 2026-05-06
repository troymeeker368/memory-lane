# Fix Prompt Generator Report
Generated: 2026-04-22

## 1. Issues Detected

1. `Authorization + RLS drift`
Architectural rule violated:
- preserve role restrictions and data integrity
- Supabase-first authorization must match app-side authorization
Why live:
- broad authenticated read policies still cover intake, physician-order, MHP, member-detail, and billing tables
- Intake index is broader than detail/actions
- care-plan and intake writes still do not consistently require explicit edit permission
Safest fix:
- tighten DB policies and app write gates together in canonical service paths

2. `MCC clinical file metadata leak`
Architectural rule violated:
- server-only canonical reads must not expose unauthorized metadata
Why live:
- paged member-file reads still return all file metadata before clinical filtering
Safest fix:
- filter at the authoritative service or RPC boundary before returning rows

3. `MCC file-list canonicality drift`
Architectural rule violated:
- one canonical resolver/read-model path per workflow
Why live:
- April 22 workflow audit found initial file load and paged older-file load are not clearly using one shared permission-filtered query
Safest fix:
- align first render and pagination to one canonical visibility query

4. `Enrollment packet public-link guard gap`
Architectural rule violated:
- public-link workflows must be replay-safe and idempotent
Why live:
- expired parent tokens can still mint completed-download child tokens
- submit throttling is count-first/write-later instead of atomic
Safest fix:
- reject expired parent tokens before issuing descendants and move throttling into an atomic DB/RPC guard

5. `Signed intake readiness is overstated`
Architectural rule violated:
- workflow state integrity and explicit downstream persistence verification
Why live:
- signed intake can commit while draft POF creation/readback is still follow-up-needed
Safest fix:
- only report ready-for-POF when the draft POF is durably visible through the canonical read path

6. `Signed POF readiness is overstated`
Architectural rule violated:
- clear handoffs and shared readiness truth
Why live:
- signed POF can still have queued/degraded downstream MHP, MCC, and MAR sync
Safest fix:
- keep provider-signed, queued, degraded, and ready as distinct canonical states

7. `Enrollment completion visibility gap for sales`
Architectural rule violated:
- downstream truth should be durably tracked, not inferred from repair queues
Why live:
- packet completion can commit while lead activity is still queued for repair
Safest fix:
- preserve completion truth, but expose sales-visible vs repair-pending as explicit canonical readback states

8. `Custom invoice orchestration is not fully atomic`
Architectural rule violated:
- shared RPC standard and ACID atomicity
Why live:
- source reads and invoice numbering still happen in TypeScript before RPC persistence
Safest fix:
- move workflow-critical pre-persist logic into the billing transactional boundary

9. `Founder/staff read paths still have scale risk`
Architectural rule violated:
- one canonical read boundary per screen
Why live:
- sales dashboard RPC still does broad aggregation
- billing dashboard still re-reads overlapping facts
- billing module index duplicates batch reads
- audit/sales directory indexes are still missing
- completed enrollment-packet reporting still over-reads
Safest fix:
- add missing indexes, remove duplicate batch reads, and slim the heaviest canonical read paths without introducing parallel query families

10. `Linked Supabase migration history still needs verification`
Architectural rule violated:
- migration-driven schema must match the real linked project
Why live:
- repo-local alignment is clean, but linked-project applied-state repair/verification is still the blocker
Safest fix:
- repair linked migration history and rerun schema-safety verification

## 2. Codex Fix Prompts

### Prompt 1
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Database read policies and app-side write permissions are still broader than the intended clinical and billing access model.

Inspect first:
- docs/audits/supabase-rls-security-audit-2026-04-21.md
- app/(portal)/health/assessment/page.tsx
- app/(portal)/health/assessment/[assessmentId]/page.tsx
- app/intake-actions.ts
- lib/services/care-plan-authorization.ts
- lib/permissions/core.ts
- the migrations that created the remaining broad read policies

Required approach:
1) Replace the remaining broad authenticated read policies on intake, physician-order, MHP, member-detail, and billing tables with explicit permission-aware predicates.
2) Make the Intake Assessment index use the same clinical boundary as detail/actions.
3) Require explicit canEdit-level permission for care-plan create/sign and intake create/sign before any privileged write runs.
4) Preserve canonical server/service write paths. Do not patch this in UI-only code.
5) If sites, lookup_lists, or punches_linked_time_punch_review are still live runtime tables, either enable RLS there too or explicitly document why they stay excluded.

Validation:
- Run typecheck/build and report results.
- List changed policies, grants, and app-side permission checks.
- Add focused regression coverage for one unauthorized read and one blocked privileged write.
```

### Prompt 2
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Member Command Center still leaks clinical file metadata to broader operations viewers because the paged file path returns all file rows before clinical filtering.

Inspect first:
- docs/audits/supabase-rls-security-audit-2026-04-21.md
- app/(portal)/operations/member-command-center/_actions/files.ts
- lib/services/member-command-center-runtime.ts
- components/forms/member-command-center-file-manager.tsx
- lib/services/member-files.ts

Required approach:
1) Keep the current paged server-only file listing path.
2) Move filtering to the authoritative service or RPC boundary so unauthorized viewers never receive hidden clinical file metadata in the response payload.
3) Preserve authorized download behavior and the current pagination contract.
4) If a narrower SQL/RPC read path is safer than filtering after a service-role read, use that instead.

Validation:
- Run typecheck/build and report results.
- Verify operations viewers cannot see clinical file names/categories/uploader metadata.
- Verify authorized clinical users still see the same paged file list.
```

### Prompt 3
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Member Command Center file visibility is inconsistent because first render and older-file pagination are not clearly using the same canonical permission-filtered query.

Inspect first:
- docs/audits/workflow-simulation-audit-2026-04-22.md
- lib/services/member-command-center-runtime.ts
- lib/services/member-command-center-detail-read-model.ts
- app/(portal)/operations/member-command-center/_actions/files.ts
- components/forms/member-command-center-file-manager.tsx

Required approach:
1) Identify exactly how initial load gets files today and how the older-file action gets files.
2) Move both paths onto one shared canonical visibility helper or query boundary.
3) Preserve page size, ordering, and role-aware visibility semantics.
4) Do not solve this only in the component.

Validation:
- Run typecheck/build and report results.
- Verify the same user role sees the same allowed files on first load and after loading older files.
- Verify unauthorized clinical files stay hidden on both paths.
```

### Prompt 4
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Completed enrollment packets can still mint new download tokens from expired parent tokens, and public submit throttling is still advisory instead of atomic.

Inspect first:
- docs/audits/supabase-rls-security-audit-2026-04-21.md
- lib/services/enrollment-packets-public-runtime-context.ts
- app/sign/enrollment-packet/[token]/confirmation/page.tsx
- lib/services/enrollment-packets-public-runtime-artifacts.ts
- lib/services/enrollment-packet-public-helpers.ts

Required approach:
1) Reject expired parent tokens before issuing any completed-download child token.
2) Preserve valid completed-download behavior for unexpired completed packets.
3) Move submission throttling into an atomic DB/RPC boundary so concurrent requests cannot slip through count-then-write logic.
4) Preserve the current canonical public enrollment-packet service path.

Validation:
- Run typecheck/build and report results.
- Add regression coverage for expired parent-token reuse and concurrent submit throttling.
```

### Prompt 5
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Signed intake still does not guarantee a provably ready draft POF.

Inspect first:
- docs/audits/workflow-simulation-audit-2026-04-22.md
- app/intake-actions.ts
- lib/services/intake-pof-mhp-cascade.ts
- lib/services/physician-orders-supabase.ts
- lib/services/physician-orders-read.ts

Required approach:
1) Keep intake and physician-order services/RPCs authoritative.
2) Find where staff-facing truth is upgraded before draft POF readback is canonical and durable.
3) Only report ready-for-POF when the draft order is durably visible through the canonical read path.
4) Preserve honest queued/degraded/follow-up-needed states.

Validation:
- Run typecheck/build and report results.
- Add regression coverage for ready vs follow-up-needed intake outcomes.
```

### Prompt 6
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Signed POF still does not guarantee downstream MHP, MCC, and MAR readiness.

Inspect first:
- docs/audits/workflow-simulation-audit-2026-04-22.md
- lib/services/pof-esign.ts
- lib/services/pof-esign-public.ts
- lib/services/physician-order-post-sign-service.ts
- lib/services/pof-post-sign-runtime.ts
- the staff-facing readiness/status consumers for physician orders, MHP, MCC, and MAR

Required approach:
1) Keep the current signature-finalization and post-sign sync boundary authoritative.
2) Tighten the canonical readiness model so staff-facing surfaces distinguish provider-signed, downstream-sync-queued, degraded/action-needed, and clinically-ready.
3) Update only the minimum downstream consumers needed to read the same readiness truth.
4) Do not hide queued/degraded states behind a generic signed badge.

Validation:
- Run typecheck/build and report results.
- Add regression coverage for signed-but-queued and signed-and-ready states.
```

### Prompt 7
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Enrollment packet completion is durable, but sales/admin users can still miss immediate lead-activity visibility because that sync can fall to queued repair after commit.

Inspect first:
- docs/audits/workflow-simulation-audit-2026-04-22.md
- lib/services/enrollment-packet-completion-cascade.ts
- lib/services/enrollment-packet-mapping-runtime.ts
- lib/services/enrollment-packets-listing.ts
- the sales/admin completion-status consumers

Required approach:
1) Preserve the current durable packet completion path and repair queue.
2) Identify where staff-facing status implies immediate sales visibility even when lead activity is still pending repair.
3) Tighten the canonical readback contract so screens can distinguish completed, sales-visible, and repair-pending states.
4) Do not create a second lead-activity write path.

Validation:
- Run typecheck/build and report results.
- Add regression coverage for immediate lead-activity visibility vs queued repair.
```

### Prompt 8
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Billing custom-invoice orchestration is still not fully atomic end to end because source reads and invoice numbering are assembled in service code before RPC persistence.

Inspect first:
- docs/audits/production-readiness-audit-2026-04-02.md
- lib/services/billing-custom-invoices.ts
- lib/services/billing-workflows.ts
- lib/services/billing-rpc.ts
- supabase/migrations/0178_harden_custom_invoice_rpc_atomicity.sql

Required approach:
1) Identify which pre-RPC steps still affect durable outcome.
2) Move only the workflow-critical pieces into the transactional RPC/service boundary.
3) Preserve existing invoice behavior and downstream billing/reporting expectations.
4) Do not add a second custom-invoice write path.

Validation:
- Run typecheck/build and report results.
- Add regression coverage for retry safety and invoice-numbering truth.
```

### Prompt 9
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
The highest-cost founder and staff reads still need hardening, and getBillingModuleIndex() now duplicates a batch-list read already performed by the dashboard summary.

Inspect first:
- docs/audits/supabase-query-performance-audit-2026-04-22.md
- docs/audits/rpc-architecture-audit-2026-03-24.md
- lib/services/sales-workflows.ts
- lib/services/billing-preview-helpers.ts
- lib/services/billing-read-supabase.ts
- lib/services/admin-audit-trail.ts
- lib/services/sales-crm-read-model.ts
- lib/services/enrollment-packet-list-support.ts
- lib/services/enrollment-packets-listing.ts
- lib/services/member-command-center-runtime.ts
- lib/services/member-health-profiles-read.ts
- lib/services/health-dashboard.ts

Required approach:
1) Keep one canonical read-model boundary per screen.
2) Add forward-only migrations for audit_logs(created_at desc), community_partner_organizations(organization_name), and referral_sources(organization_name).
3) Slim the sales dashboard summary RPC without changing founder-facing numbers.
4) Refactor the billing dashboard summary so it does not re-read overlapping raw billing facts.
5) Remove the extra getBillingBatches() read from getBillingModuleIndex().
6) Move completed enrollment-packet reporting toward true pagination.
7) Preserve recent MCC file-page improvements and avoid creating parallel query families.

Validation:
- Run typecheck/build and report results.
- Report added indexes and slimmed queries.
```

### Prompt 10
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
The repo-local migration sequence is clean, but schema safety is not closed until the linked Supabase project confirms the same ordered migration history and applied state.

Inspect first:
- docs/audits/schema-migration-safety-audit-2026-04-02.md
- supabase/migrations/0175_fk_covering_indexes_hardening.sql
- supabase/migrations/0176_safe_unused_index_cleanup.sql
- supabase/migrations/0177_enrollment_packet_lead_lookup_index.sql
- supabase/migrations/0178_harden_custom_invoice_rpc_atomicity.sql

Required approach:
1) Verify the linked project migration history and identify any filename/order mismatch.
2) Repair linked-project migration history so the project recognizes the committed ordered filenames.
3) Re-run schema-safety verification and confirm runtime tables, RPCs, and storage buckets still align.
4) Do not introduce new schema objects in code as part of this repair.

Validation:
- Report the exact mismatch and repair performed.
- Call out any environment blocker explicitly if linked-project access is unavailable.
```

## 3. Fix Priority Order
1. Prompt 1
2. Prompt 2
3. Prompt 3
4. Prompt 4
5. Prompt 5
6. Prompt 6
7. Prompt 7
8. Prompt 8
9. Prompt 9
10. Prompt 10

## 4. Founder Summary
- The newest reports still cluster around permission boundaries, public-link safety, workflow handoff truth, and a smaller set of heavy read paths.
- The April 22 workflow audit adds one new current-branch issue that should stay separate from the older file-metadata leak: MCC initial load and paged load are not clearly using one canonical visibility query.
- The highest-risk items remain access control and enrollment-packet public-link safety.
- The clinical workflow gaps are still about honest readiness, not fake persistence: signed intake is not always ready draft POF, and signed POF is not always downstream-clinically-ready.
- Shared Resolver Drift, Idempotency, and the latest available Daily Canonicality Sweep did not add a new must-fix runtime bug beyond the issues above.
