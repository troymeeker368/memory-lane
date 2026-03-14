# Memory Lane Architecture Standard

This document defines the production runtime architecture contract for Memory Lane.
All code paths must comply.

## Supabase Source of Truth

- Supabase is the only supported runtime persistence backend.
- Persisted runtime reads and writes must use migration-defined Supabase objects.
- Runtime mock persistence, file-backed persistence, local JSON stores, and in-memory persistence as source of truth are forbidden.
- A write is successful only when it is durably persisted in Supabase.
- Fallback records and synthetic success states are forbidden.

## Canonical Entity Identity

- Each business entity has one canonical identity.
- Each business entity has one canonical persistence path.
- Mixed lead/member identity submission is forbidden unless a shared canonical resolver performs translation.
- Identity translation must fail explicitly on mismatches.
- Ambiguous identity inference without shared resolver mediation is forbidden.

Canonical identity rule:
- member workflows operate on canonical `members.id`
- lead workflows operate on canonical `leads.id`
- cross-domain handoff must go through shared identity resolver/service

## Shared Resolver / Service Boundaries

Shared logic must be centralized in canonical resolver/service modules when logic is:
- reused
- workflow-critical
- identity-sensitive
- invariant-enforcing
- drift-prone

Mandatory boundary:
- UI renders and collects input
- Server Actions validate input and call canonical services
- Service layer executes business logic and persistence
- Supabase stores canonical state

Required write path:

`UI -> Server Action -> Service Layer -> Supabase`

Forbidden:
- UI direct Supabase writes
- business writes in actions/routes that bypass service layer
- duplicate business-rule logic across modules
- parallel write paths for the same business concept

## Schema Drift Prevention

- Supabase migrations are authoritative schema.
- Runtime code must not assume missing tables/columns/relationships/functions.
- New runtime dependencies require forward-only migrations.
- Introducing new tables/flows without migrations is forbidden.
- Drift must be fixed by migrations and service alignment, never by runtime fallbacks.

Migration contract:
- migration filenames use ordered format `####_description.sql`
- migrations remain forward-only
- services, actions, and UI contracts must remain migration-aligned

## Mock Data Boundaries

- Mock data is allowed only for isolated UI/test development.
- Mock data is forbidden in canonical production runtime flows.
- Importing `lib/mock*` runtime data into production code paths is forbidden.
- Compatibility assets with `mock` naming are not valid runtime backends.

## Workflow State Integrity

- Workflow states are system-driven event outcomes.
- Manual editing of system workflow states is forbidden.
- States such as `sent`, `opened`, `signed`, `completed`, `declined`, and `expired` must be derived from persisted events.
- Success flags must not be emitted when persistence, delivery, or downstream artifact creation fails.

Required integrity examples:
- if email delivery fails, do not mark as sent
- if artifact save fails, do not mark as completed
- if canonical downstream sync fails, surface explicit error

## Shared RPC Standard

Memory Lane distinguishes between simple service CRUD and transactional workflows.

Use canonical services for:
- single-table writes
- simple updates
- read operations

Use shared RPC or transactional service operations for:
- multi-table writes
- lifecycle transitions
- downstream synchronization
- signature completion workflows
- workflows requiring atomic execution

This ensures transactional integrity across clinical workflows.

## ACID Transaction Safety

Multi-step workflows must preserve ACID guarantees.

Examples of workflows requiring atomic behavior:
- enrollment packet completion
- physician order signing
- medication propagation to MHP
- MAR schedule generation
- care plan finalization

Partial completion is forbidden.

If downstream persistence fails, the entire workflow must fail.

## Idempotency and Replay Safety

Public token workflows and asynchronous operations must be replay-safe.

Duplicate submissions must not produce duplicate canonical records.

Examples:
- enrollment packet submissions
- caregiver e-signature completion
- POF signing links
- document upload flows

Idempotency may be enforced through:
- unique constraints
- lifecycle state guards
- idempotency tokens

## Referential Integrity and Lifecycle Cascades

Memory Lane uses strict lifecycle cascades.

Canonical workflow chain:

Lead
-> Enrollment Packet
-> Member
-> Intake Assessment
-> Physician Orders (POF)
-> Member Health Profile
-> Member Command Center
-> Care Plans
-> MAR / Clinical Activity

The system must guarantee:
- no orphan records
- correct downstream propagation
- no duplicate active canonical records
- valid lifecycle state transitions

## System Event Logging

All lifecycle events are recorded in the `system_events` table.

Event logs provide:
- debugging traceability
- operational analytics
- compliance audit trails
- cascade verification

Events must be written only from canonical services.

Key workflow events that must be logged:
- lead -> member conversion
- enrollment packet sent and completed
- intake assessment created
- physician orders (POF) signed
- medication propagation to MHP
- MAR schedule generation
- care plan creation and signature
- caregiver e-signature events
- member archival or deletion

Canonical service owners for event writes:
- `member-service`
- `lead-service`
- `intake-service`
- `physician-orders-service`
- `care-plan-service`
- `mar-service`

Service-layer usage example:

```ts
import { logSystemEvent } from "@/lib/services/system-event-service";

await logSystemEvent({
  event_type: "lead_member_conversion_completed",
  entity_type: "lead",
  entity_id: leadId,
  actor_type: "user",
  actor_id: actorUserId,
  metadata: { member_id: memberId, source: "sales-workflow" },
  request_id: requestId,
  correlation_id: correlationId
});
```

## Canonical Shared Domains

The following domains require shared resolver/service ownership:
- member and cross-module identity/detail resolution
- physician orders
- intake assessment signature state
- member health profiles
- member command center
- attendance
- transportation
- billing

## Permission and Access Architecture

Canonical role keys:
- `program-assistant`
- `coordinator`
- `nurse`
- `sales`
- `manager`
- `director`
- `admin`

Canonical auth/permission modules:
- `lib/auth.ts`
- `lib/permissions.ts`

Required guards:
- `requireModuleAccess`
- `requireModuleAction`
- `requireNavItemAccess`
- `requireRoles`

Sensitive operations must enforce canonical permissions at action boundary and data-write boundary.

## Canonical Clinical Cascade

Canonical lifecycle:

`Intake Assessment -> Physician Orders (POF) -> Member Health Profile (MHP) -> Member Command Center (MCC)`

Rules:
- Intake Assessment is root clinical source.
- POF is canonical physician authorization.
- MHP is normalized clinical state derived from intake plus active signed orders.
- MCC is aggregated operational state derived from canonical upstream records.

## E-Sign Architecture Contract

Canonical e-sign tables:
- `pof_requests`
- `pof_signatures`
- `document_events`
- `intake_assessment_signatures`

Operational dependencies:
- migrations `0019_pof_esign_workflow.sql`, `0020_intake_assessment_esign.sql`
- storage bucket `member-documents`
- provider config `RESEND_API_KEY`
- sender config `CLINICAL_SENDER_EMAIL` fallback chain
- canonical app base URL for public links

A second persistence flow for e-sign state outside canonical tables/services is forbidden.

## Production Readiness Checklist

All checklist items are required before merge:
- `Supabase-backed?`
- `migration added?`
- `canonical identity path defined?`
- `shared resolver/service used where logically required?`
- `UI and backend contracts aligned?`
- `downstream artifacts saved?`
- `audit trail present?`
- `no mock/runtime split-brain?`

Any `No` blocks merge.

## Definition of Done

A feature is complete only when all are true:
- end-to-end route and workflow behavior is functional
- writes persist in Supabase through canonical services
- permissions are enforced with canonical guards
- canonical identity resolution is enforced where needed
- schema dependencies are migration-defined
- downstream consumers use canonical records
- `npm run typecheck` passes
- `npm run build` passes

## Architecture Violations (Forbidden)

- mock fallback persistence in runtime flows
- duplicate resolver/business-rule implementations for shared workflows
- mixed lead/member identity handling outside canonical resolver paths
- manual editing of system workflow states
- silent fallback records after failed writes
- schema-dependent code without migrations

