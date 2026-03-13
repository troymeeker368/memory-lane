# Memory Lane Architecture

## Architecture Contract

Memory Lane is a Supabase-backed production system.
Supabase migrations define the runtime schema contract.

Runtime storage alternatives are not allowed:
- no runtime mock repository
- no local JSON store
- no file-backed runtime persistence
- no in-memory persistence as source of truth

## Canonical Layers

Only these layers are valid for business writes:

1. UI
2. Server Action
3. Service Layer (`lib/services/*`)
4. Supabase

Canonical write path:

`UI -> Server Action -> Service Layer -> Supabase`

## Layer Responsibilities

### UI

- Collect input and render output.
- Call server actions.
- Never write directly to Supabase.
- Never host canonical derived-rule logic.

### Server Actions

- Validate request context and role/permission access.
- Call canonical service functions.
- Revalidate paths and return user-safe outcomes.
- Must not bypass canonical service-layer write paths.

### Service Layer

- Canonical location for domain writes and derived business rules.
- Canonical resolver location for cross-module shared state.
- Canonical place for schema-aware error handling and integrity checks.
- Must not fabricate non-persistent fallback records.

### Supabase

- Canonical persistence for operational entities.
- Migration-defined tables/views/functions only.
- RLS/policies/triggers and constraints are part of architecture contract.

## Canonical Source Of Truth

Rules:
- Every business entity has one canonical table.
- Every derived business rule has one canonical shared resolver/service.
- Views/aggregates support read use cases but are not source of truth.
- Duplicated rule calculations across pages/actions/reports are architectural violations.

## Shared Resolver/Service Requirements

Shared canonical services must be reused for:
- member detail and cross-domain relation resolution
- physician orders and health profile derivation
- intake assessment signature state
- member command center aggregate state
- attendance-derived operational state
- transportation-derived operational state
- billing eligibility and execution state

When duplicate logic is discovered, consolidate into the shared service and migrate all consumers.

## Canonical Clinical Data Cascade

Canonical lifecycle:

`Intake Assessment -> Physician Orders (POF) -> Member Health Profile (MHP) -> Member Command Center (MCC)`

Interpretation:
- Intake Assessment is the clinical root source.
- POF is canonical physician authorization.
- MHP is normalized clinical state from intake + active signed physician orders.
- MCC is operational aggregate state derived from upstream canonical clinical/operational records.

## Role And Permission Architecture

Canonical role keys:
- `program-assistant`
- `coordinator`
- `nurse`
- `sales`
- `manager`
- `director`
- `admin`

Canonical permission/auth services:
- `lib/permissions.ts`
- `lib/auth.ts`

Required enforcement entry points:
- `requireModuleAccess`
- `requireModuleAction`
- `requireNavItemAccess`
- `requireRoles`

Permissions must be enforced both:
- at route/module access boundaries
- at sensitive business action/write boundaries

## Public E-Sign Architecture

Status:
- implemented for public POF signing and intake-assessment signed-state persistence

Canonical POF e-sign flow:

1. staff user creates request in canonical service
2. hashed token persisted in `pof_requests`
3. email sent with public link `/sign/pof/[token]`
4. provider opens link; request transitions (`sent -> opened`)
5. provider signs with attestation
6. canonical services persist signature, signed PDF, and audit events
7. physician order canonical signed state and downstream sync are updated

Canonical POF e-sign tables:
- `pof_requests`
- `pof_signatures`
- `document_events`
- `member_files` linkage (`pof_request_id`, storage path fields)

Canonical intake signature tables:
- `intake_assessment_signatures`
- mirrored signed-state fields on `intake_assessments`

Operational dependencies:
- migration `0019_pof_esign_workflow.sql`
- migration `0020_intake_assessment_esign.sql`
- Supabase storage bucket `member-documents`
- email provider API key `RESEND_API_KEY`
- configured sender email (`CLINICAL_SENDER_EMAIL` fallback chain)
- application base URL for public signature links

Security/integrity expectations:
- tokens are stored hashed and rotated after use
- expiration state is enforced in persistence
- IP/user-agent metadata is captured in canonical event records
- signed artifacts must link to canonical member file records

## Schema Governance

Required:
- forward-only migrations
- unique ordered migration names (`####_description.sql`)
- migration-defined schema usage only
- explicit failures when required schema objects are missing

Forbidden:
- assuming schema objects that are absent from migrations
- patching schema drift with runtime fallback behavior
- introducing table/column dependencies without migration updates

## Definition Of Done For New Modules

A module is complete only when all are true:
- route/UI works end-to-end
- writes persist through canonical services into Supabase
- permission enforcement is present in code
- shared resolver/service usage is canonical
- migration updates are applied for new schema requirements
- downstream reports/exports/integrations consume canonical records
- `npm run typecheck` passes
- `npm run build` passes

## Architecture Do-Not Rules

- Do not add direct Supabase writes in UI components.
- Do not bypass canonical service-layer writes from actions/routes.
- Do not add parallel resolver implementations for the same rule.
- Do not fabricate fallback records after failed persistence.
- Do not import `lib/mock*` in runtime production paths.
- Do not rely on compatibility APIs containing `mock` naming as runtime architecture.

No workflow may infer entity identity from mixed fields like linked_member_id without first passing through the shared canonical person resolver. Member workflows must operate on canonical member.id; lead workflows must operate on canonical lead.id.
