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

