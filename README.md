# Memory Lane

Memory Lane is an operations and clinical management platform for Adult Day Centers.

## Production Architecture Standard (Required)

This repository is governed by a strict production standard.
The only supported runtime architecture is Supabase-backed, canonical, migration-defined, and anti-drift.

## Supabase Source of Truth

- Supabase is the only supported runtime persistence backend.
- All persisted runtime reads and writes must target migration-defined Supabase objects.
- Runtime mock persistence, local JSON persistence, file-backed persistence, and in-memory persistence are forbidden.
- A write is successful only when persisted in Supabase.
- Synthetic fallback records are forbidden.

## Canonical Entity Identity

- Every entity has one canonical identity and one canonical persistence path.
- Mixed lead/member identity submission is forbidden unless translation is handled by shared canonical resolver logic.
- Ambiguous identity inference without canonical resolver mediation is forbidden.
- Identity mismatches must fail explicitly.

## Shared Resolver / Service Boundaries

Required write path:

`UI -> Server Action -> Service Layer -> Supabase`

Rules:
- UI components must not write directly to Supabase.
- Server actions/route handlers must not bypass canonical services for business writes.
- Shared business rules, identity translation, workflow transitions, and cross-module invariants must be centralized.
- Duplicate business-rule logic across pages/actions/reports/exports is forbidden.

## Schema Drift Prevention

- Supabase migrations are the schema contract.
- New runtime schema dependencies require forward-only migrations.
- Introducing new tables or runtime flows without migrations is forbidden.
- Missing schema objects must produce explicit failures.
- Runtime fallback logic that masks schema drift is forbidden.

## Mock Data Boundaries

- Mock data is allowed only for isolated UI development and tests.
- Mock data is forbidden in canonical runtime flows.
- Production code paths must not import runtime data from `lib/mock*`.

## Workflow State Integrity

- Workflow status is system-driven and event-backed.
- Manual editing of system workflow states is forbidden.
- `sent/opened/signed/completed/declined/expired` states must come from persisted events.
- If delivery, persistence, or downstream artifact save fails, the workflow must not be marked successful.

## Canonical Clinical Cascade

`Intake Assessment -> Physician Orders (POF) -> Member Health Profile (MHP) -> Member Command Center (MCC)`

## Production Readiness Checklist (Merge Gate)

Every change must pass all checks:
- `Supabase-backed?`
- `migration added?`
- `canonical identity path defined?`
- `shared resolver/service used where logically required?`
- `UI and backend contracts aligned?`
- `downstream artifacts saved?`
- `audit trail present?`
- `no mock/runtime split-brain?`

Any `No` blocks merge.

## Architecture Guardrail Rules

Memory Lane follows several architectural guardrails:
- Supabase is the only runtime database.
- All database writes occur through canonical services.
- UI components and server actions never perform direct Supabase writes.
- Shared RPC is used for transactional workflows.
- Lifecycle events are logged through the system event log.

## Production Assurance Pipeline

Memory Lane runs nightly automated audits to maintain architectural integrity.

The nightly safety pipeline performs:
1. Supabase RLS & Security Audit
2. Production Readiness Audit
3. Canonicality Sweep
4. Schema Migration Safety Audit
5. Shared Resolver Drift Check
6. Shared RPC Architecture Audit
7. ACID Transaction Safety Audit
8. Idempotency & Duplicate Submission Audit
9. Workflow Lifecycle Simulation Audit
10. Referential Integrity & Cascade Audit
11. Query Performance Audit
12. Safe Auto-Fix Pass
13. Codex Fix Prompt Generator

These automated audits detect architectural drift and maintain system integrity.

## System Event Logging

Memory Lane records lifecycle events in the `system_events` table.

This enables:
- debugging of workflow cascades
- operational analytics
- clinical audit trails
- system integrity monitoring

Events are written from canonical services.

## Local Development Rules

- Run app on `http://localhost:3001`.
- If port `3001` is occupied, stop the occupying process before starting.
- Before edits: `git status`
- After edits: `npm run typecheck`
- After significant edits: `npm run build`
- After major stabilization: `npm run quality:gates`

Helpers:
- `npm run dev`
- `npm run dev:clean`
- `netstat -ano | findstr :3001`
- `taskkill /PID <PID> /F`

## Canonical Seed Data

Single entry point:
- `npm run seed`
- Optional clean reseed: `npm run reseed`

What gets seeded:
- exactly 15 leads across mixed pipeline states (`Inquiry`, `Tour`, `Enrollment in Progress`, `Nurture`, `Closed - Lost`, `Closed - Won`)
- exactly 15 enrolled members (mixed active/inactive status)
- lead activity timelines and stage-history events for every lead
- downstream canonical records for intake, POF/MHP, care plans, diagnoses, medications, allergies, attendance, transportation, billing, files, command center, and documentation timelines

Lead conversion representation:
- converted leads are linked canonically through `members.source_lead_id`
- converted member intake rows also carry `intake_assessments.lead_id` when applicable
- conversion visibility is therefore resolver/UI-safe and does not depend on name matching

Idempotency:
- deterministic seed identifiers are generated for leads, members, activities, stage history, and downstream rows
- seed writes are upserts on canonical ids, so reruns update existing seeded records instead of creating duplicate chains
- seed output prints a validation summary including lead/member totals, lead-stage distribution, converted lead count, downstream row counts, and missing relationship checks

## Auth Environment Variables

- `NEXT_PUBLIC_SUPABASE_URL` (required, preferred): public Supabase project URL used by browser and server runtimes.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` (required, preferred): public anon key used by browser and server runtimes.
- `SUPABASE_URL` (legacy server fallback only): accepted by server/runtime helpers if older deploy environments still use this name.
- `SUPABASE_ANON_KEY` (legacy server fallback only): accepted by server/runtime helpers if older deploy environments still use this name.
- `SUPABASE_SERVICE_ROLE_KEY` (required for service-role workflows): canonical server-only key for RPCs, sync jobs, and privileged writes.
- `SUPABASE_SERVICE_KEY` (legacy fallback only): accepted as a fallback for older environments.
- `NEXT_PUBLIC_APP_URL` (required): canonical public app URL used in invite/reset links.
- `RESEND_API_KEY` (required for invite/reset delivery): API key for branded staff auth emails.
- `CLINICAL_SENDER_EMAIL` (required for invite/reset delivery): sender mailbox used for branded staff auth emails.
- `ENABLE_DEV_AUTH_BYPASS` (optional, default `false`): enables `/dev/auth` bootstrap only when `NODE_ENV` is not `production`.
- `DEV_AUTH_BOOTSTRAP_PASSWORD` (optional, default `SeedDataOnly!123`): password used by `/dev/auth` when per-user values are not configured.
- `DEV_AUTH_BOOTSTRAP_USERS_JSON` (optional): JSON array of `{ "email", "password", "role", "label" }` bootstrap accounts for `/dev/auth`.

Production safety rules:
- Production deployments should set the canonical `NEXT_PUBLIC_*` Supabase variables even if legacy server fallbacks are available.
- `/dev/auth` is hard-disabled when `NODE_ENV=production` even if `ENABLE_DEV_AUTH_BYPASS=true`.
- Staff invite/reset/set-password flows always use real Supabase auth sessions and preserve canonical role/permission enforcement.

## Supabase Migration And Type Sync

When runtime code starts referencing a new column or RPC, apply migrations before testing the UI.

- Canonical linked sync: `npm run db:sync`
- Linked/remote project push only: `npm run db:push`
- Generate canonical types from the linked project: `npm run db:types`
- Local Supabase stack push only: `npm run db:push:local`
- Generate canonical types from local Supabase: `npm run db:types:local`
- Pre-push validation: `npm run prepush`
- If PostgREST still serves stale schema after pushing migrations, restart the local Supabase stack before retrying the UI save flow.

The canonical generated Supabase types file is checked in at `types/supabase.ts`. Pre-push now validates that the linked database is up to date and that this file matches the linked schema.

### Troubleshooting

- Run `npm run db:sync` whenever you pull schema changes, add/edit a migration, switch to a branch with Supabase changes, or see a schema-dependent UI failure in local dev.
- After any migration change, run `npm run db:sync`, commit the updated `types/supabase.ts`, and rerun `npm run typecheck`.
- Clear `.next` and restart the dev server when generated types changed but the app still behaves like the old schema, or after branch switches that changed migrations, RPCs, or server actions. Use `npm run clean:next` and then `npm run dev`.

