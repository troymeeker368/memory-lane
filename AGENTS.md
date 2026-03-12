# Memory Lane Development Rules

- Always run local app on `http://localhost:3001`.
- Do not move to another port because `3001` is busy.
- If `3001` is occupied, stop the occupying process before starting.
- Before edits, run `git status`.
- After edits, run `npm run typecheck`.
- After significant edits, run `npm run build`.
- Summarize changed files and remaining issues at completion.

## Port Utilities (Windows)

- Optional helper: `npm run dev:clean`
  - Frees `3001` then starts local app on `3001`.
- Manual cleanup:
  - `netstat -ano | findstr :3001`
  - `taskkill /PID <PID> /F`

# Agent Governance For Memory Lane

Memory Lane is a production operations and clinical management platform.
Runtime behavior must be Supabase-backed, canonical, and migration-defined.

## Non-Negotiable Runtime Rules

1. Supabase is the only runtime data backend.
2. Persisted state must come from Supabase tables defined in migrations.
3. UI components must not write directly to Supabase.
4. Route handlers and server actions must not bypass canonical service-layer writes.
5. Runtime mock stores, mock repositories, local JSON stores, file-backed stores, and in-memory persistence are forbidden.
6. Synthetic fallback records are forbidden.
7. A write is successful only if it is persisted in Supabase.

If required records are missing, services must:
- create canonical records in Supabase, or
- throw explicit errors.

Silent fallback objects are forbidden.

## Canonicality Rules

Canonical Source of Truth (SoT):
- Every business object maps to one canonical Supabase table.
- Every derived rule maps to one canonical shared resolver/service.
- Derived views and aggregates are never SoT.

Do not introduce:
- parallel persistence paths
- parallel resolver logic
- duplicated business-rule calculations in pages/actions/reports/exports

## Required Shared Resolver/Service Domains

Derived resolution in these domains must use shared services:
- members and cross-module detail resolution
- physician orders
- intake assessment signature state
- member health profiles
- member command center
- attendance
- transportation
- billing

No feature module may reimplement these derivations independently.

## Write Path Governance

Required write path:

`UI -> Server Action -> Service Layer -> Supabase`

Forbidden:
- direct Supabase writes from UI components
- business writes in route handlers/server actions that bypass service-layer functions
- UI-only business-rule patches that bypass canonical services

## Canonical Clinical Cascade

The canonical lifecycle is:

`Intake Assessment -> Physician Orders (POF) -> Member Health Profile (MHP) -> Member Command Center (MCC)`

Rules:
- Intake is the root clinical source.
- POF is canonical physician authorization.
- MHP is normalized clinical state derived from intake plus active signed orders.
- MCC is aggregated operational state derived from upstream canonical records.

## Role And Permission Expectations

Canonical role keys:
- `program-assistant`
- `coordinator`
- `nurse`
- `sales`
- `manager`
- `director`
- `admin`

Canonical permission/auth resolution is implemented in:
- `lib/permissions.ts`
- `lib/auth.ts`

Enforce access using canonical guards:
- `requireModuleAccess`
- `requireModuleAction`
- `requireNavItemAccess`
- `requireRoles`

Sensitive operations requiring strict enforcement:
- payroll exports and approvals
- PTO approvals
- billing adjustments
- member record edits
- punch corrections
- clinical authorization and e-sign updates

## Public E-Sign Governance

Implemented e-sign flows:
- POF public e-sign (`/sign/pof/[token]`)
- Intake assessment signed-state persistence

Canonical e-sign tables:
- `pof_requests`
- `pof_signatures`
- `document_events`
- `intake_assessment_signatures`

Operational dependencies:
- migrations `0019_pof_esign_workflow.sql`, `0020_intake_assessment_esign.sql`
- storage bucket `member-documents`
- mail provider API key `RESEND_API_KEY`
- sender config (`CLINICAL_SENDER_EMAIL` fallback chain)
- canonical app URL configuration for public links

Do not introduce a second e-sign persistence flow outside these canonical tables/services.

## Schema Governance

- Supabase migrations are the authoritative schema contract.
- Code must not assume schema objects missing from migrations.
- Every new domain feature requires forward-only migration updates.
- Use unique ordered migration names: `####_description.sql`.
- Fix schema drift with migrations and service alignment, never with fallback logic.

## Required Agent Workflow

1. Inspect repo state with `git status` and account for in-progress files.
2. Identify canonical tables, write path, shared resolver/service, and downstream consumers.
3. Implement in canonical services first.
4. Align downstream consumers to canonical resolvers/services.
5. Verify routing, permissions, persistence, and workflow integrity.
6. Run required validations (`typecheck`, `build`, plus quality gates when applicable).
7. Report files changed, schema changes, permission impacts, tests run, blockers, and technical debt.

## Required Agent Audits

Agents must actively detect and flag:
- schema drift
- duplicate resolver logic
- non-canonical write paths
- mock runtime usage
- fallback branches masking persistence failures
- dead routes and permission gaps

## Completion Criteria

A feature/module is complete only when:
- route/UI works end-to-end
- writes persist in Supabase
- permissions are enforced in code
- canonical resolver/service is used
- exports and downstream workflows work end-to-end
- required validations pass

## Safety And Hygiene

- Run `npm run quality:gates` after major stabilization edits.
- Do not commit temporary artifacts (`.tmp-*`, screenshots, html dumps, test-results, tsbuildinfo).
- Do not introduce mock/runtime fallback behavior for any reason.

## Do-Not Rules

- Do not import runtime data from `lib/mock*` into production code paths.
- Do not add direct Supabase writes in UI components.
- Do not bypass canonical services for business writes.
- Do not add duplicate resolver implementations for the same derived rule.
- Do not treat compatibility aliases with `mock` naming as valid runtime mock mode.
