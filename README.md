# Memory Lane

Memory Lane is a production operations and clinical platform for Adult Day Centers.

## Production Runtime Contract

Memory Lane runtime is Supabase-only.

Non-negotiable rules:
- Supabase is the only operational backend.
- All persisted state must read/write through Supabase tables defined by migrations.
- UI components must not write directly to Supabase.
- Route handlers and server actions must not bypass canonical service-layer writes.
- Runtime mock stores, local JSON stores, file-backed stores, and in-memory persistence are forbidden.
- Synthetic fallback records are forbidden.
- A write is successful only when persisted in Supabase.

If required data is missing, canonical services must either:
- create the missing row in Supabase, or
- throw an explicit error.

## Canonical Write Path

`UI -> Server Action -> Service Layer -> Supabase`

Canonical business writes belong in `lib/services/*`.

## Canonical Clinical Cascade

Canonical lifecycle:

`Intake Assessment -> Physician Orders (POF) -> Member Health Profile (MHP) -> Member Command Center (MCC)`

Enforcement:
- Intake assessment is the root clinical intake source.
- POF is the canonical physician authorization.
- MHP is normalized clinical state derived from intake + active signed POF.
- MCC is aggregated operational state derived from upstream canonical records.

## Shared Resolver and Service Rules

Derived state and cross-module resolution must be centralized in shared services.

Required shared resolver/service domains:
- members and cross-module detail resolution (`lib/services/relations.ts`)
- physician orders and MHP sync (`lib/services/physician-orders-supabase.ts`)
- intake-to-POF cascade (`lib/services/intake-pof-mhp-cascade.ts`)
- intake e-sign state (`lib/services/intake-assessment-esign.ts`)
- member command center aggregate state (`lib/services/member-command-center-supabase.ts`)
- billing and payor execution flows (`lib/services/billing-supabase.ts`)

Do not duplicate derived rule logic in pages, actions, reports, or exports.

## Role and Permission Enforcement

Canonical role keys:
- `program-assistant`
- `coordinator`
- `nurse`
- `sales`
- `manager`
- `director`
- `admin`

Permission and role resolution are canonical in:
- `lib/permissions.ts`
- `lib/auth.ts`

Route/module enforcement must use:
- `requireModuleAccess`
- `requireModuleAction`
- `requireNavItemAccess`
- `requireRoles`

Do not introduce ad hoc permission maps outside canonical auth/permission utilities.

## Public E-Sign Architecture

Implemented e-sign flows:
- POF public e-sign route: `/sign/pof/[token]`
- Intake assessment signed-state persistence (internal authenticated workflow)

Canonical Supabase objects:
- `pof_requests`
- `pof_signatures`
- `document_events`
- `intake_assessment_signatures`
- `member_files` (`pof_request_id`, `storage_object_path`)

Operational dependencies:
- migrations: `0019_pof_esign_workflow.sql`, `0020_intake_assessment_esign.sql`
- storage bucket: `member-documents`
- email provider API key: `RESEND_API_KEY`
- sender config: `CLINICAL_SENDER_EMAIL` (fallbacks: `DEFAULT_CLINICAL_SENDER_EMAIL`, `RESEND_FROM_EMAIL`)
- app URL for signed links: `NEXT_PUBLIC_APP_URL` (fallback chain handled in service)

Security and integrity guarantees:
- public tokens are stored hashed (`sha256`) and rotated after signing
- link lifecycle is persisted (`draft/sent/opened/signed/declined/expired`)
- signing events are written to `document_events`
- signed artifacts are stored and linked to canonical member files

## Migration Discipline and Drift Prevention

Supabase migrations are the schema contract.

Required:
- add forward-only migrations in `supabase/migrations`
- use unique ordered filenames: `####_description.sql`
- never patch schema drift with runtime fallback branches
- align services/actions with migration-defined objects
- fail explicitly when schema objects are missing

Legacy note:
- mock-named migration/seed compatibility assets remain for historical transition tooling only
- they are not valid runtime data paths

## Development Rules

- Run local app on `http://localhost:3001`.
- If port `3001` is occupied, free it before starting.
- Before edits: `git status`
- After edits: `npm run typecheck`
- After significant edits: `npm run build`
- After major stabilization: `npm run quality:gates`

Helpful scripts:
- `npm run dev`
- `npm run dev:clean`

## Definition Of Done (New Modules)

A module is done only when all are true:
- UI route works end-to-end.
- Writes persist in Supabase through canonical services.
- Permissions are enforced in code with canonical auth/permission utilities.
- Shared resolver/service usage is canonical (no duplicated derived logic).
- Required migrations are added and applied cleanly.
- Downstream workflows (reports/exports/integrations) run against canonical records.
- `npm run typecheck` and `npm run build` pass.

## Do-Not Rules

- Do not import runtime data from `lib/mock*` in production code paths.
- Do not add direct Supabase writes in UI components.
- Do not bypass canonical services for business writes.
- Do not fabricate fallback entities after failed reads/writes.
- Do not add parallel resolver implementations for the same business rule.
