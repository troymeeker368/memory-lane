# Fix Prompt Generator Report
Generated: 2026-04-23T06:01:11-04:00

## 1. Issues Detected

1. `Public enrollment packet completion can split durable truth`
Architectural rule violated:
- multi-step public workflows must be atomic, durable, replay-safe, and honest about downstream persistence.
Why live:
- `rpc_finalize_enrollment_packet_submission` can commit completion before finalized artifacts, member-file links, and downstream cascade work are durably finished.
- cleanup exists but is not wired into the current post-commit failure path.
Safest fix:
- add a durable post-commit artifact batch owner plus deterministic cleanup/repair, or move more finalization into one transaction-backed boundary.

2. `Enrollment public-link token and throttling gaps`
Architectural rule violated:
- public token workflows must enforce expiration and idempotency at the authoritative service/RPC boundary.
Why live:
- completed packets can still issue a completed-download child token from an expired parent token.
- submit throttling still counts first and writes later, so concurrent submissions can slip through.
Safest fix:
- reject expired parent tokens before token minting and move throttling into an atomic RPC/claim path.

3. `Care plan post-sign false failure`
Architectural rule violated:
- workflow state truth must match persisted Supabase state and must not report failure after a successful commit.
Why live:
- `signed_pending_caregiver_dispatch` is now a legitimate persisted state, but the write-boundary assertion still hard-requires `ready`.
Safest fix:
- update the shared boundary assertion and action handling to return committed pending truth instead of throwing after commit.

4. `Manual member-file upload false success`
Architectural rule violated:
- success is valid only after required Supabase persistence is verified.
Why live:
- `saveCommandCenterMemberFileUpload` can return `verifiedPersisted: false`, while the action/UI still report successful upload.
Safest fix:
- downgrade the action/UI result to follow-up-needed whenever persistence verification fails.

5. `Lead conversion activity ordering and idempotency gap`
Architectural rule violated:
- lifecycle events and canonical conversion writes must share one durable business boundary and replay contract.
Why live:
- `lead_activities` is inserted before lead-to-member conversion, so failed conversion can leave a misleading "Enrollment completed" activity.
- replay protection is app-layer/time-window based instead of DB-enforced.
Safest fix:
- move conversion-completion activity behind the conversion commit boundary or into the conversion RPC, then add a database idempotency key/unique contract.

6. `Intake Assessment clinical authorization mismatch`
Architectural rule violated:
- app-side role boundaries and privileged writes must match explicit clinical permissions.
Why live:
- the Intake Assessment history page is broader than the detail/action boundary.
- `createAssessmentAction` still gates privileged clinical writes by role rather than explicit health-unit edit permission.
Safest fix:
- align history/detail/action access to one clinical boundary and require `canEdit` before privileged service-role writes.

7. `Broad authenticated read policies remain`
Architectural rule violated:
- Supabase RLS must enforce least-privilege read boundaries for clinical, member-support, enrollment, transportation, pricing, and care-plan support tables.
Why live:
- several tables still have broad `authenticated using (true)` read policies.
- `sites`, `lookup_lists`, and `punches_linked_time_punch_review` still lack repo-defined RLS enablement.
Safest fix:
- add forward-only permission-aware policy migrations, starting with intake and member-support tables.

8. `Intake to POF handoff is still not evidenced as canonical`
Architectural rule violated:
- downstream lifecycle handoffs must persist expected canonical records and expose honest readiness.
Why live:
- workflow simulation still marks Intake Assessment -> Physician Orders / POF generation as broken because expected `physician_orders` writes were not evidenced.
Safest fix:
- route the handoff through canonical intake/physician-order services and verify draft POF readback before reporting readiness.

9. `Workflow milestone notifications/files are incomplete`
Architectural rule violated:
- lifecycle completion claims must include required artifacts and service-layer event/notification persistence.
Why live:
- workflow simulation still flags missing completed packet artifact checks, intake PDF member-file persistence checks, and enrollment milestone notifications.
Safest fix:
- add explicit durable file/notification checks in canonical service paths after business persistence succeeds.

10. `High-cost read paths remain`
Architectural rule violated:
- production read models should use canonical bounded queries/RPCs and migration-backed indexes.
Why live:
- sales dashboard RPC still performs broad aggregation.
- billing dashboard still re-reads overlapping facts and `getBillingModuleIndex()` duplicates batch reads.
- audit trail and sales directory sort indexes are still missing.
- completed enrollment-packet reporting still over-reads through search/name-resolution fan-out.
Safest fix:
- add the missing indexes, remove the duplicate billing read, and slim the heaviest canonical read paths without creating parallel query families.

11. `Migration safety is repo-clean but deployment-unverified`
Architectural rule violated:
- schema/runtime alignment must be verified against the linked Supabase project, not only local files.
Why live:
- the latest schema audit found no repo drift, but linked-project migration history/application still needs verification.
Safest fix:
- repair/verify linked project migration history before production signoff.

## 2. Codex Fix Prompts

### Prompt 1 - Public enrollment completion durability
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Public enrollment packet completion can commit the packet before finalized artifacts, member-file links, and downstream cascade work are durably finished.

Scope:
- Domain/workflow: public enrollment packet completion
- Canonical tables/storage: enrollment_packet_requests, enrollment_packet_uploads, enrollment_packet_mapping_runs, member_files, member-documents storage
- Expected write path: public action -> enrollment packet service -> RPC/transaction-backed Supabase boundary

Inspect first:
- docs/audits/acid-transaction-audit-2026-04-23.md
- lib/services/enrollment-packets-public-runtime.ts
- lib/services/enrollment-packets-public-runtime-finalize.ts
- lib/services/enrollment-packets-public-runtime-post-commit.ts
- lib/services/enrollment-packets-public-runtime-artifacts.ts
- supabase/migrations/0180_enrollment_completion_follow_up_state.sql

Required approach:
1) Trace the completion flow from public submit through finalize RPC, artifact creation, member-file persistence, and cascade/follow-up state.
2) Add one durable owner for finalized artifact batches and post-commit repair/cleanup state, or move the required finalization work into a transaction-backed boundary where feasible.
3) Wire cleanupFinalizedPublicEnrollmentPacketArtifacts into the failure path so partial artifacts are not silently left as completed truth.
4) Preserve existing valid completed-packet behavior and current public token service boundaries.
5) Return explicit follow-up-needed/degraded truth when required downstream persistence is not confirmed; do not return synthetic success.

Validation:
- Run npm run typecheck.
- Run npm run build if the change touches the submission flow broadly.
- Add focused regression coverage for finalized-artifact failure after packet commit.
- Report changed files, schema/migration impact, and any remaining repair-runner risk.
```

### Prompt 2 - Public token expiration and atomic throttling
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Completed enrollment packets can mint a new completed-download token from an expired parent token, and public submit throttling is raceable because counting and claim/log writes are not atomic.

Scope:
- Domain/workflow: public enrollment packet token and submission guards
- Canonical tables: enrollment_packet_requests, enrollment_packet_events or current submission attempt table
- Expected boundary: public route/action -> enrollment packet public service -> Supabase RPC/transaction-backed claim

Inspect first:
- docs/audits/supabase-rls-security-audit-2026-04-23.md
- lib/services/enrollment-packets-public-runtime-context.ts
- app/sign/enrollment-packet/[token]/confirmation/page.tsx
- lib/services/enrollment-packets-public-runtime-artifacts.ts
- lib/services/enrollment-packet-public-helpers.ts

Required approach:
1) Reject expired parent tokens before issuing any completed-packet download child token, including completed packet contexts.
2) Preserve valid completed-download behavior for unexpired completed packets.
3) Replace count-first/write-later public submit throttling with an atomic Supabase RPC or transaction-backed claim path.
4) Preserve existing founder-readable error messages and event logging.
5) Add a forward-only migration if a new RPC, constraint, or attempt table/index is required.

Validation:
- Run npm run typecheck.
- Add tests for expired parent-token reuse and concurrent throttling attempts.
- Report whether live Supabase policy/RPC grants need deployment verification.
```

### Prompt 3 - Care plan post-sign false failure
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Care plan create/review can persist successfully but then throw because the write-boundary assertion still requires ready even when signed_pending_caregiver_dispatch is the legitimate committed state.

Scope:
- Domain/workflow: care plan create/review after nurse signature
- Canonical tables: care_plans, care_plan_sections, care_plan_versions, care_plan_review_history, care_plan_signature_events
- Expected write path: UI -> Server Action -> care plan service -> Supabase/RPC boundary

Inspect first:
- docs/audits/acid-transaction-audit-2026-04-23.md
- lib/services/care-plans-supabase.ts
- app/care-plan-actions.ts
- lib/services/care-plan-authorization.ts
- supabase/migrations/0112_care_plan_post_sign_readiness.sql

Required approach:
1) Update assertCarePlanWriteBoundaryAligned so signed_pending_caregiver_dispatch is accepted when caregiver dispatch is intentionally pending.
2) Ensure createCarePlan/reviewCarePlan return persisted truth, including carePlanId, instead of false failure after commit.
3) Preserve ready only for states that are actually complete.
4) Keep permission checks in the canonical care-plan authorization/service path.
5) Do not create a second care-plan write path or UI-only workaround.

Validation:
- Run npm run typecheck.
- Add or update regression coverage for committed pending caregiver dispatch.
- Manually verify create/review reports the saved pending state without inviting duplicate retries.
```

### Prompt 4 - Member-file upload false success
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Manual member-file upload can return ok:true and show "File uploaded" even when Supabase persistence verification explicitly failed.

Scope:
- Domain/workflow: Member Command Center manual member-file upload
- Canonical tables/storage: member_files, member-documents storage
- Expected write path: UI -> server action -> member-files service -> Supabase/storage

Inspect first:
- docs/audits/acid-transaction-audit-2026-04-23.md
- lib/services/member-files.ts
- app/(portal)/operations/member-command-center/_actions/files.ts
- components/forms/member-command-center-file-manager.tsx

Required approach:
1) Preserve the current canonical upload service and storage path.
2) When saveCommandCenterMemberFileUpload returns verifiedPersisted: false, return a follow-up-needed/degraded action result instead of ok:true.
3) Update the UI message so staff do not see "File uploaded" when canonical verification failed.
4) Preserve diagnostic verification details for support/admin review.
5) Do not hide the failed verification with a retry-only UI patch.

Validation:
- Run npm run typecheck.
- Add regression coverage for verifiedPersisted:false.
- Manually verify a failed readback does not display success and does not create duplicate retries.
```

### Prompt 5 - Lead conversion activity atomicity and idempotency
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
The "Enrollment completed" lead activity can be inserted before lead-to-member conversion succeeds, and lead activity replay protection is not database-enforced.

Scope:
- Domain/workflow: sales lead activity -> lead/member conversion
- Canonical tables: leads, members, lead_activities, lead_stage_history
- Expected write path: sales action -> sales service -> conversion RPC/transaction-backed Supabase boundary

Inspect first:
- docs/audits/acid-transaction-audit-2026-04-23.md
- lib/services/sales-lead-activities.ts
- lib/services/sales-lead-conversion-supabase.ts
- lib/services/sales-activity-idempotency.ts
- supabase/migrations/0037_shared_rpc_standardization_lead_pof.sql
- supabase/migrations/0001_initial_schema.sql

Required approach:
1) Move conversion-completion activity creation behind confirmed conversion success, or fold the activity insert into the shared conversion RPC.
2) Add a DB-backed idempotency key or unique constraint for replay-equivalent lead activities, especially conversion-completion outcomes.
3) Preserve existing lead activity behavior for non-conversion activity types unless the same idempotency contract safely applies.
4) Keep one canonical conversion write path; do not add a parallel activity/conversion path.
5) Add a forward-only migration for any new column, generated key, or unique index.

Validation:
- Run npm run typecheck.
- Add regression coverage for failed conversion not leaving completed activity.
- Add replay/double-submit coverage that proves duplicate conversion activities cannot be created.
```

### Prompt 6 - Intake clinical authorization alignment
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Intake Assessment history uses a broader health access boundary than detail/actions, and createAssessmentAction performs privileged clinical writes after role-only gating.

Scope:
- Domain/workflow: Intake Assessment
- Canonical tables: intake_assessments, assessment_responses, intake_assessment_signatures, member_files
- Expected write path: UI -> server action -> intake service/RPC -> Supabase

Inspect first:
- docs/audits/supabase-rls-security-audit-2026-04-23.md
- app/(portal)/health/assessment/page.tsx
- app/(portal)/health/assessment/[assessmentId]/page.tsx
- app/intake-actions.ts
- lib/services/intake-pof-mhp-cascade.ts
- relevant permission helpers in lib/permissions and clinical role constants

Required approach:
1) Align the Intake Assessment history page to the same clinical boundary used by detail/actions.
2) Require explicit health-unit canEdit permission before createAssessmentAction can perform privileged clinical writes.
3) Keep the canonical intake service/RPC path authoritative.
4) Preserve valid nurse/admin clinical workflows.
5) Do not rely on UI hiding alone.

Validation:
- Run npm run typecheck.
- Add or update tests for a view-only/general health user being blocked from privileged intake creation.
- Report permission impact and any RLS migration still needed.
```

### Prompt 7 - Permission-aware RLS hardening
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Several sensitive and operational tables still use broad authenticated read policies or lack repo-defined RLS enablement.

Scope:
- Domain/workflow: Supabase RLS policy hardening
- Tables: intake_assessments, assessment_responses, intake_assessment_signatures, member_providers, member_equipment, member_notes, locker_assignment_history, care_plan_signature_events, care_plan_diagnoses, enrollment_packet_pof_staging, enrollment_packet_mapping_runs, enrollment_packet_mapping_records, enrollment_packet_follow_up_queue, bus_stop_directory, transportation_runs, transportation_run_results, enrollment_pricing_community_fees, enrollment_pricing_daily_rates, sites, lookup_lists, punches_linked_time_punch_review

Inspect first:
- docs/audits/supabase-rls-security-audit-2026-04-23.md
- existing RLS migrations that introduced the current broad policies
- lib/permissions and current database permission helper functions

Required approach:
1) Add forward-only migrations that replace broad authenticated select policies with explicit permission-aware predicates.
2) Start with intake and member-support tables if the full list is too large for one safe patch.
3) Enable RLS on sites, lookup_lists, and punches_linked_time_punch_review only with minimal policies that match intended runtime access.
4) Preserve service-role workflows and existing legitimate staff reads.
5) Do not weaken policies to make tests pass.

Validation:
- Run npm run typecheck.
- Add focused policy regression tests for at least one clinical table and one operational table.
- Report which tables were hardened and which remain deferred.
```

### Prompt 8 - Intake to draft POF canonical handoff
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Workflow simulation still marks Intake Assessment -> Physician Orders / POF generation as broken because expected physician_orders persistence is not evidenced through the canonical handoff.

Scope:
- Domain/workflow: Intake Assessment to draft Physician Order / POF
- Canonical tables: intake_assessments, assessment_responses, intake_assessment_signatures, physician_orders, member_files
- Expected boundary: intake service/RPC -> physician order service/RPC -> canonical physician_orders readback

Inspect first:
- docs/audits/docs/audits/workflow-simulation-audit-2026-04-23.md
- app/intake-actions.ts
- lib/services/intake-pof-mhp-cascade.ts
- lib/services/physician-orders-supabase.ts
- app/(portal)/health/physician-orders/actions.ts

Required approach:
1) Trace the signed intake flow and identify whether draft POF creation is missing, queued, or not visible through canonical readback.
2) Route the handoff through the existing canonical intake and physician-order services/RPCs.
3) Only report ready-for-POF when physician_orders is durably persisted and readable through the canonical service.
4) Preserve explicit follow-up-needed states when draft POF creation is deferred or failed.
5) Do not add duplicate draft POF creation in the UI.

Validation:
- Run npm run typecheck.
- Add regression coverage for signed intake producing a visible draft physician_order or an honest follow-up-needed outcome.
- Manually verify the downstream POF editor opens from the generated canonical order.
```

### Prompt 9 - Lifecycle artifacts and notifications
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Workflow simulation still flags missing durable checks for completed enrollment packet artifacts, intake PDF member-file persistence, and enrollment milestone notifications.

Scope:
- Domain/workflow: lifecycle artifact and notification persistence
- Canonical tables/storage: member_files, user_notifications, enrollment_packet_events, document_events, member-documents storage
- Expected boundary: service layer only; UI/actions must not write lifecycle logs directly

Inspect first:
- docs/audits/docs/audits/workflow-simulation-audit-2026-04-23.md
- lib/services/enrollment-packets-public-runtime-artifacts.ts
- lib/services/enrollment-packet-completion-cascade.ts
- lib/services/member-files.ts
- lib/services/lifecycle-milestones.ts
- lib/services/notifications.ts
- app/intake-actions.ts

Required approach:
1) Identify the canonical service points where enrollment completion, intake signing, and enrollment milestones become durable.
2) Add explicit persistence/readback checks for required member-file artifacts.
3) Create notifications only after the underlying lifecycle event is durably persisted.
4) Return follow-up-needed/degraded status when required artifacts or notifications cannot be confirmed.
5) Keep event/notification writes in the service layer, not actions or UI components.

Validation:
- Run npm run typecheck.
- Add regression coverage for artifact persistence failure and notification creation after durable milestone commit.
- Report downstream screens affected by the changed readiness/status truth.
```

### Prompt 10 - Query performance hardening
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
The highest-cost founder/staff read paths still need hardening: sales dashboard broad aggregation, billing dashboard duplicate raw reads, duplicate billing batch reads, missing sort indexes, and completed enrollment packet over-read.

Scope:
- Domain/workflow: production read performance
- Canonical read paths: sales dashboard RPC, billing dashboard/index services, admin audit trail, sales partner/referral directories, completed enrollment packet reporting

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
- supabase/migrations/0209_sales_dashboard_summary_lead_count_slimming.sql

Required approach:
1) Keep one canonical read-model boundary per screen.
2) Add forward-only indexes for audit_logs(created_at desc), community_partner_organizations(organization_name), and referral_sources(organization_name).
3) Remove the extra getBillingBatches() read from getBillingModuleIndex().
4) Slim the billing dashboard so one request does not re-read overlapping raw billing facts through both preview and queue paths.
5) Slim the sales dashboard RPC without changing founder-facing numbers.
6) Move completed enrollment-packet reporting toward true pagination.
7) Do not add parallel query families or mock caches.

Validation:
- Run npm run typecheck.
- Run npm run build if service/RPC changes are broad.
- Report added indexes, removed duplicate reads, and any query-plan validation that still needs live Supabase access.
```

### Prompt 11 - Linked Supabase migration verification
```text
Fix this Memory Lane issue with the smallest production-safe change.

Issue:
Repo-local schema/runtime alignment is clean, but production signoff is blocked until the linked Supabase project confirms the same ordered migration history and applied state.

Scope:
- Domain/workflow: schema migration safety
- Project ref: dcnyjtfyftamcdsaxrsz
- Canonical type file: types/supabase-types.d.ts

Inspect first:
- docs/audits/schema-migration-safety-audit-2026-04-02.md
- supabase/migrations/0175_fk_covering_indexes_hardening.sql
- supabase/migrations/0176_safe_unused_index_cleanup.sql
- supabase/migrations/0177_enrollment_packet_lead_lookup_index.sql
- supabase/migrations/0178_harden_custom_invoice_rpc_atomicity.sql
- current Supabase migration status for the linked project

Required approach:
1) Verify linked project migration history against committed ordered migrations.
2) Repair any filename/order mismatch using Supabase-supported migration repair steps.
3) Re-run schema safety verification and db type generation if the linked state changes.
4) Do not introduce new runtime schema dependencies as part of this repair.
5) Explicitly report any environment/auth blocker if linked project access is unavailable.

Validation:
- Run the project’s canonical Supabase link/status/check commands as available.
- Run npm run db:types if schema state changes.
- Report exact repaired migrations and remaining pending migrations.
```

## 3. Fix Priority Order

1. Prompt 3 - Care plan post-sign false failure.
2. Prompt 4 - Member-file upload false success.
3. Prompt 5 - Lead conversion activity atomicity and idempotency.
4. Prompt 2 - Public token expiration and atomic throttling.
5. Prompt 1 - Public enrollment completion durability.
6. Prompt 6 - Intake clinical authorization alignment.
7. Prompt 7 - Permission-aware RLS hardening.
8. Prompt 8 - Intake to draft POF canonical handoff.
9. Prompt 9 - Lifecycle artifacts and notifications.
10. Prompt 10 - Query performance hardening.
11. Prompt 11 - Linked Supabase migration verification.

## 4. Founder Summary

- Today’s audit set moved the top fix list from broad review into concrete production-safety work.
- The fastest launch-risk wins are care-plan false failure, member-file false success, and lead conversion activity atomicity/idempotency.
- Public enrollment packet safety remains a major risk because token expiration, throttling, artifact durability, and downstream completion truth still need stronger boundaries.
- Security work is still needed, especially intake authorization and broad authenticated RLS reads.
- Performance hardening is important but should follow the false-success, false-failure, public-link, and permission issues.
- Schema migration safety is locally clean, but production signoff still needs linked Supabase project verification.
