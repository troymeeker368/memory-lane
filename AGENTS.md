# Memory Lane Agent Contract

Memory Lane is a production operations and clinical platform.
This repository is governed by a strict production architecture contract.

## Local Execution Rules

- Local app URL is `http://localhost:3001`.
- Port `3001` is required. Running on another port is forbidden.
- If `3001` is occupied, stop the occupying process before starting dev server.
- Before edits, run `git status`.
- After edits, run `npm run typecheck`.
- After significant edits, run `npm run build`.
- After major stabilization edits, run `npm run quality:gates`.
- Completion reports must include changed files and remaining issues.

Windows helpers:
- `npm run dev:clean`
- `netstat -ano | findstr :3001`
- `taskkill /PID <PID> /F`

## Build Performance Guardrails

- Treat webpack cache warnings, including `webpack.cache.PackFileCacheStrategy` big-string warnings, oversized compiled-module warnings, and unusual bundle growth as real regressions to diagnose, not noise to suppress.
- Oversized multi-concern shared service files are forbidden. Canonical services must not become catch-all modules that mix business reads/writes with PDF builders, email templates, legal text, giant mappings, schema-like constants, or other large static payloads.
- Guardrail: if a shared service starts serving as both the hot orchestration layer and the storage location for large templates, document builders, mapping payloads, or static config, split it by concern before adding more behavior. Do not wait for a hard build failure before separating it.
- Keep large templates, legal text, mappings, config payloads, and document builders out of hot top-level service imports. Move them into narrower modules or lazy server-only imports when runtime behavior is unchanged.
- Avoid broad package-root imports when a narrower import or delayed import is available and materially reduces build weight.
- Use `npm run audit:module-sizes` when touching large service or schema files, and investigate the top offenders before accepting new size growth.
- Major refactors that touch already-large service modules must run `npm run audit:module-sizes` and explain any accepted size growth or retained hotspots in the completion report.

## Production Safety Checks

- Typecheck, lint, and build protections are part of production safety and should stay enabled when feasible.
- Temporary ignores or bypasses for type, lint, build, or other release-safety checks must be treated as short-lived debt, not a steady-state solution.
- When a stabilization or refactor pass touches code behind an existing ignore, prefer fixing the underlying issue and re-enabling the protection in the same pass when scope allows.
- If a production-safety check cannot be re-enabled yet, report the exact check, scope, and blocker explicitly instead of leaving the repo in a silent degraded state.

## Supabase Source of Truth

- Supabase is the only supported runtime backend.
- All persisted runtime reads and writes must use Supabase objects defined in migrations.
- Runtime mock persistence, local JSON persistence, file-backed persistence, and in-memory persistence are forbidden.
- Runtime success is valid only when data is persisted in Supabase.
- Silent fallback records are forbidden.

If required data is missing, services must do exactly one of:
- create canonical records in Supabase, or
- throw explicit errors.

## Canonical Entity Identity

- Every business entity must have one canonical identity and one canonical persistence path.
- Mixed lead/member identity submission is forbidden unless a shared canonical resolver translates identities.
- Identity translation must use shared canonical resolver/service code.
- Workflow code must not infer identity from ambiguous fields without resolver mediation.
- Canonical identity mismatches must fail explicitly.

## Shared Resolver / Service Boundaries

- Shared business rules, identity resolution, workflow transitions, and cross-module invariants must live in shared resolver/service layers.
- UI components must not implement canonical business rules.
- Server actions and route handlers must call canonical services for business writes.
- Duplicate business-rule implementations across pages/actions/reports/exports are forbidden.
- Pure presentation logic may remain local only when it does not duplicate business rules or create canonicality risk.

Required write path:

`UI -> Server Action -> Service Layer -> Supabase`

Forbidden write paths:
- UI direct Supabase writes
- route/action direct business writes that bypass canonical service functions
- parallel write paths for the same business concept

## Schema Drift Prevention

- Supabase migrations are the schema contract.
- Code must not depend on schema objects that are missing from migrations.
- New runtime tables, columns, constraints, views, and functions require forward-only migrations.
- Introducing new flows without migrations is forbidden.
- Runtime fallback logic that masks schema drift is forbidden.

Migration rules:
- use ordered migration names: `####_description.sql`
- keep migrations forward-only
- align queries, services, and UI contracts with migration-defined schema

## Mock Data Boundaries

- Mock data is permitted only for isolated UI development and tests.
- Mock data must never participate in canonical runtime flows.
- Production code paths must not import `lib/mock*` runtime data paths.
- Compatibility assets with `mock` naming are not valid production runtime backends.

## Workflow State Integrity

- Workflow state fields are system-driven.
- Manual editing of system workflow states is forbidden.
- `sent/opened/signed/completed/declined/expired` style states must come from persisted events.
- A workflow step is complete only when downstream persistence and required side effects succeed.
- If email delivery fails, the workflow must not be marked sent.
- If artifacts are not saved (for example Member Files), completion claims are forbidden.

## Shared RPC Standard

Memory Lane uses shared RPC-backed services for high-risk workflows.

Simple CRUD operations may use canonical services directly, but the following workflows must use shared RPC or transaction-backed service operations:
- lifecycle transitions
- multi-table writes
- signature completion workflows
- downstream synchronization cascades
- workflows that write to both database and storage

Examples:
- lead -> member conversion
- enrollment packet completion
- physician orders (POF) signing
- medication propagation to MHP
- MAR generation
- care plan finalization

Server actions must call services, and services may internally call RPC where atomic execution is required.

## ACID Transaction Requirements

Multi-step workflows must maintain ACID guarantees.

Requirements:
- Atomicity - workflows that perform multiple writes must complete entirely or fail entirely.
- Consistency - system invariants must remain valid after execution.
- Isolation - concurrent requests must not corrupt lifecycle state.
- Durability - once a workflow returns success, required artifacts and records must be persisted.

Success must never be returned if required downstream persistence fails.

## Idempotency and Replay Safety

All workflows reachable from public links or asynchronous triggers must be idempotent.

Examples:
- enrollment packet completion
- caregiver e-signature links
- POF signature flows
- document uploads
- lead -> member conversion

Repeated submissions must not create duplicate canonical records.

Implement protections using:
- unique constraints
- lifecycle state checks
- idempotency tokens where appropriate

## System Event Logging

All significant lifecycle events must be logged.

Logging must occur only in the service layer.

UI components and server actions must never write directly to the event log.

Events should be recorded for workflows such as:
- lead conversion
- enrollment packet sent/completed
- intake creation
- POF signing
- medication propagation
- MAR generation
- care plan creation and signature
- member archival

## Required Nightly Architecture Audits

The system runs automated architecture audits that enforce these rules.

Audits include:
- Supabase RLS & Security Audit
- Production Readiness Audit
- Canonicality Sweep
- Schema Migration Safety Audit
- Shared Resolver Drift Check
- Shared RPC Architecture Audit
- ACID Transaction Safety Audit
- Idempotency & Duplicate Submission Audit
- Workflow Lifecycle Simulation Audit
- Referential Integrity & Cascade Audit
- Query Performance Audit

Agents must assume these audits will run and enforce architectural rules.

## Required Shared Domains

The following domains require canonical shared resolver/service logic:
- member and cross-module identity/detail resolution
- physician orders
- intake assessment signature state
- member health profiles
- member command center
- attendance
- transportation
- billing

## Production Readiness Checklist

Every merge request must pass all checks:
- `Supabase-backed?`
- `migration added?`
- `canonical identity path defined?`
- `shared resolver/service used where logically required?`
- `UI and backend contracts aligned?`
- `downstream artifacts saved?`
- `audit trail present?`
- `no mock/runtime split-brain?`

If any answer is `No`, merge is blocked.

## Required Agent Workflow

1. Run `git status` and account for in-progress files.
2. Identify canonical entities, canonical tables, and canonical write paths.
3. Identify shared resolvers/services required by scope.
4. Implement/fix canonical service layer first.
5. Align actions/routes/UI consumers to canonical services.
6. Verify permissions, persistence, identity integrity, and downstream effects.
7. Run validations (`typecheck`, `build`, and quality gates when applicable).
8. Report changed files, schema impact, permission impact, tests run, blockers, and technical debt.

## Required Agent Audits

Agents must actively detect and flag:
- schema drift
- non-canonical write paths
- duplicate business-rule logic
- identity ambiguity and mixed lead/member handling
- runtime mock usage in production paths
- fallback branches masking failed persistence
- workflow state spoofing
- permission gaps

## Completion Criteria

A feature is complete only when all are true:
- route/UI works end-to-end
- writes persist in Supabase
- permissions are enforced with canonical guards
- canonical shared resolvers/services are used
- downstream exports/reports/integrations operate on canonical records
- required validations pass

## Do-Not Rules

- Do not add runtime mock fallback persistence.
- Do not add duplicate resolver/business-rule logic for shared workflows.
- Do not submit mixed lead/member identities without canonical resolver translation.
- Do not allow manual edits of system workflow states.
- Do not return synthetic success when persistence or downstream effects fail.
- Do not add tables/flows without migrations.

