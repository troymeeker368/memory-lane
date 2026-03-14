# Memory Lane Domain Map

This document defines canonical ownership boundaries by domain so implementation work stays production-safe, Supabase-backed, and audit-friendly.

## Major Domains

1. Leads
2. Enrollment Packets
3. Members
4. Intake Assessments
5. Physician Orders / POF
6. Member Health Profiles (MHP)
7. Member Command Center (MCC)
8. Care Plans
9. MAR
10. Member Files
11. Notifications
12. Billing / Pricing
13. Permissions / Profiles
14. System Events

## Shared Resolver Ownership

- `lib/services/canonical-person-ref.ts`
  - Canonical lead/member identity translation.
  - Required boundary for mixed lead/member inputs.
- `lib/services/sales-lead-stage-supabase.ts`
  - Canonical lead stage/status transition normalization.
- `lib/services/intake-pof-shared.ts`
  - Shared intake-to-POF normalization helpers.
- `lib/services/pof-mhp-field-mapping.ts`
  - Source-of-truth ownership map for POF -> MHP field propagation.
- `lib/services/care-plan-esign-rules.ts`
  - Canonical caregiver-link state rules (`ready/sent/viewed/signed/expired`).
- `lib/services/intake-assessment-esign-core.ts`
  - Canonical intake signature persistence rules and signer authorization rules.
- `lib/services/care-plan-nurse-esign-core.ts`
  - Canonical nurse signature normalization + persistence shaping.
- `lib/services/mar-shared.ts`
  - Shared MAR enums/types for administration status integrity.
- `lib/services/member-profile-sync.ts`
  - Cross-profile sync boundary for MHP <-> MCC synchronization and POF-driven profile cascade orchestration.

## Domain Ownership

### 1) Leads

- Purpose: sales pipeline and pre-enrollment lifecycle.
- Canonical tables:
  - `public.leads`
  - `public.lead_activities`
  - `public.lead_stage_history`
- Canonical services:
  - `lib/services/sales.ts`
  - `lib/services/sales-lead-stage-supabase.ts`
  - `lib/services/sales-lead-conversion-supabase.ts`
  - `lib/services/sales-workflows.ts`
- Key workflows:
  - lead create/update
  - lead stage transitions
  - lead -> member conversion
- Upstream dependencies:
  - `profiles` (actor identity, role checks)
- Downstream consumers:
  - Enrollment Packets
  - Members
  - Intake context
- RPC expectations:
  - lead -> member conversion must use shared RPC (`rpc_convert_lead_to_member`, `rpc_create_lead_with_member_conversion`)
- Common drift risks:
  - direct UI lead/member conversion
  - stage logic duplicated outside shared stage resolver
  - bypassing canonical identity translation

### 2) Enrollment Packets

- Purpose: packet send, public completion, filed artifacts, downstream intake/clinical prefill staging.
- Canonical tables:
  - `public.enrollment_packet_requests`
  - `public.enrollment_packet_fields`
  - `public.enrollment_packet_events`
  - `public.enrollment_packet_signatures`
  - `public.enrollment_packet_sender_signatures`
  - `public.enrollment_packet_uploads`
  - `public.enrollment_packet_pof_staging`
  - `public.enrollment_packet_mapping_runs`
  - `public.enrollment_packet_mapping_records`
  - `public.enrollment_packet_field_conflicts`
- Canonical services:
  - `lib/services/enrollment-packets.ts`
  - `lib/services/enrollment-packet-intake-mapping.ts`
  - `lib/services/enrollment-packet-intake-staging.ts`
  - `lib/services/enrollment-packet-intake-payload.ts`
  - `lib/services/enrollment-packet-public-schema.ts`
- Key workflows:
  - staff send packet
  - caregiver public progress save
  - caregiver signature submit
  - packet filing + downstream mapping
  - staging review queue for downstream POF/MHP/MCC prefill
- Upstream dependencies:
  - Leads
  - Members
  - Enrollment Pricing
  - Sender signature profile
- Downstream consumers:
  - Member Files
  - MCC/MHP/POF staging
  - Notifications
  - Lead activity timeline
- RPC expectations:
  - completion + filing + downstream mapping is cross-domain/multi-write and should be on shared RPC or equivalent transaction boundary.
- Common drift risks:
  - public routes writing directly to many tables without single transactional boundary
  - status updates not aligned to persisted artifacts
  - duplicate token or completion replay paths

### 3) Members

- Purpose: canonical member identity root for operational/clinical domains.
- Canonical tables:
  - `public.members`
- Canonical services:
  - `lib/services/canonical-person-ref.ts`
  - `lib/services/member-command-center-supabase.ts` (member reads/updates, ensure patterns)
- Key workflows:
  - member identity resolution
  - member baseline updates (DOB, enrollment date, status)
- Upstream dependencies:
  - Leads (for `source_lead_id` linkage)
- Downstream consumers:
  - Intake, POF, MHP, MCC, Care Plans, MAR, Member Files, Billing
- RPC expectations:
  - any member lifecycle transitions coupled to lead state should use conversion RPC boundary, not ad hoc dual writes.
- Common drift risks:
  - name-based matching instead of canonical `members.id`
  - bypassing `canonical-person-ref` for mixed lead/member payloads

### 4) Intake Assessments

- Purpose: canonical intake clinical capture + signature state for downstream POF.
- Canonical tables:
  - `public.intake_assessments`
  - `public.assessment_responses`
  - `public.intake_assessment_signatures`
- Canonical services:
  - `lib/services/intake-pof-mhp-cascade.ts`
  - `lib/services/intake-assessment-esign.ts`
  - `lib/services/intake-assessment-esign-core.ts`
- Key workflows:
  - intake create
  - intake response persistence
  - nurse/admin sign-off
  - signed-intake guard before POF draft creation
- Upstream dependencies:
  - Members
  - Leads (optional)
- Downstream consumers:
  - Physician Orders draft prefill
  - MHP/MCC derived fields
- RPC expectations:
  - intake + response multi-write should use shared RPC/transaction boundary to avoid partial persistence.
- Common drift risks:
  - unsigned intake accepted as downstream clinical source
  - partial assessment writes without durable response rows
  - duplicated score/track derivation logic

### 5) Physician Orders / POF

- Purpose: physician authorization lifecycle and signed-order cascade trigger.
- Canonical tables:
  - `public.physician_orders`
  - `public.pof_requests`
  - `public.pof_signatures`
  - `public.document_events`
  - `public.pof_post_sign_sync_queue`
- Canonical services:
  - `lib/services/physician-orders-supabase.ts`
  - `lib/services/physician-orders.ts`
  - `lib/services/pof-esign.ts`
  - `lib/services/pof-document-content.ts`
  - `lib/services/pof-document-pdf.ts`
- Key workflows:
  - draft create/update
  - send signature request
  - public provider sign
  - signed-order post-sign queue processing
- Upstream dependencies:
  - signed Intake
  - Members
- Downstream consumers:
  - MHP sync
  - MCC sync fields
  - MAR medication/schedule generation
  - Member Files
- RPC expectations:
  - sign/finalize must use shared RPC (`rpc_sign_physician_order`, `rpc_finalize_pof_signature`)
- Common drift risks:
  - parallel sign flows bypassing RPC
  - unsigned/expired request being treated as signed
  - unqueued post-sign sync after successful signature

### 6) Member Health Profiles (MHP)

- Purpose: normalized member clinical profile (diagnoses, medications, allergies, providers, notes).
- Canonical tables:
  - `public.member_health_profiles`
  - `public.member_diagnoses`
  - `public.member_medications`
  - `public.member_allergies`
  - `public.member_providers`
  - `public.member_equipment`
  - `public.member_notes`
  - `public.provider_directory`
  - `public.hospital_preference_directory`
- Canonical services:
  - `lib/services/member-health-profiles-supabase.ts`
  - `lib/services/member-health-profiles-write-supabase.ts`
  - `lib/services/member-health-profiles.ts`
  - `lib/services/pof-mhp-field-mapping.ts`
- Key workflows:
  - profile read/write
  - POF-signed sync into MHP
  - provider/hospital directory maintenance
- Upstream dependencies:
  - Physician Orders
  - Intake-derived fields
- Downstream consumers:
  - MCC
  - MAR
  - Care planning context
- RPC expectations:
  - large replacement writes triggered by signed POF should remain in queued transactional sync path.
- Common drift risks:
  - duplicated POF->MHP field mapping in UI/action code
  - partial replacement of diagnosis/medication/allergy sets
  - directionality confusion (POF-authored vs MHP-authored fields)

### 7) Member Command Center (MCC)

- Purpose: operational member profile (attendance, contacts, transportation, billing-adjacent settings).
- Canonical tables:
  - `public.member_command_centers`
  - `public.member_attendance_schedules`
  - `public.member_contacts`
  - `public.bus_stop_directory`
  - `public.transportation_manifest_adjustments`
  - `public.locker_assignment_history`
- Canonical services:
  - `lib/services/member-command-center-supabase.ts`
  - `lib/services/member-command-center.ts`
  - `lib/services/member-profile-sync.ts`
- Key workflows:
  - ensure MCC profile/schedule rows
  - attendance and transportation profile updates
  - contact and bus stop management
- Upstream dependencies:
  - Members
  - MHP for selected sync fields
  - Intake-derived metadata
  - Enrollment packet intake staging alerts
- Downstream consumers:
  - Attendance / Transportation operations
  - Billing calculations
  - Member-facing dashboards
- RPC expectations:
  - cross-domain profile sync should use shared transactional boundary when multiple domains are updated together.
- Common drift risks:
  - MCC business rules reimplemented in page/action components
  - ad hoc sync logic bypassing shared profile sync module
  - stale assumptions about required canonical row existence

### 8) Care Plans

- Purpose: care plan authoring/review + nurse and caregiver signature lifecycle.
- Canonical tables:
  - `public.care_plans`
  - `public.care_plan_sections`
  - `public.care_plan_versions`
  - `public.care_plan_review_history`
  - `public.care_plan_nurse_signatures`
  - `public.care_plan_signature_events`
- Canonical services:
  - `lib/services/care-plans-supabase.ts`
  - `lib/services/care-plan-esign.ts`
  - `lib/services/care-plan-nurse-esign.ts`
  - `lib/services/care-plan-esign-rules.ts`
  - `lib/services/care-plan-nurse-esign-core.ts`
- Key workflows:
  - create/review/versioning
  - nurse sign-off
  - public caregiver signature
  - final signed artifact filing to Member Files
- Upstream dependencies:
  - Members
  - nurse permissions and profile identity
- Downstream consumers:
  - Member Files
  - clinical timeline and audits
- RPC expectations:
  - caregiver-sign completion + final file persistence is multi-step and should use shared RPC/transaction boundary for strict ACID guarantees.
- Common drift risks:
  - marking signed before final artifact persistence
  - signature state transitions set manually
  - bypassing shared caregiver-link status rules

### 9) MAR

- Purpose: medication administration scheduling and execution from signed physician orders.
- Canonical tables:
  - `public.pof_medications`
  - `public.mar_schedules`
  - `public.mar_administrations`
  - views: `v_mar_today`, `v_mar_overdue_today`, `v_mar_not_given_today`, `v_mar_administration_history`, `v_mar_prn_*`
- Canonical services:
  - `lib/services/mar-workflow.ts`
  - `lib/services/mar-shared.ts`
- Key workflows:
  - sync medications from signed POF
  - generate/update schedules
  - document scheduled administration
  - PRN administration + outcome assessment
- Upstream dependencies:
  - signed POF
  - MHP medication data
  - Members
- Downstream consumers:
  - daily clinical operations dashboards
  - monthly MAR reporting
- RPC expectations:
  - schedule generation and multi-row updates should run behind shared RPC/transaction boundaries (especially regeneration/deactivate/reactivate paths).
- Common drift risks:
  - non-idempotent schedule generation
  - status updates without administration record integrity checks
  - PRN outcome logic duplicated outside shared workflow module

### 10) Member Files

- Purpose: canonical document repository linkage for members.
- Canonical tables:
  - `public.member_files`
- Canonical services:
  - `lib/services/member-files.ts`
  - `lib/services/member-command-center-supabase.ts` (list/add/delete helpers)
  - domain writers from Enrollment/POF/CarePlan services (must still persist here)
- Key workflows:
  - generated document save/upsert
  - signed artifact persistence
  - linked source tracking (`pof_request_id`, `care_plan_id`, `enrollment_packet_request_id`)
- Upstream dependencies:
  - Enrollment Packets
  - POF
  - Care Plans
- Downstream consumers:
  - member command center file views
  - compliance and audit exports
- RPC expectations:
  - any workflow claiming “completed/signed/filed” must include member file persistence in same transaction boundary.
- Common drift risks:
  - storage upload success but missing `member_files` row
  - synthetic completion status before file row write
  - duplicate source artifacts without idempotent upsert rules

### 11) Notifications

- Purpose: in-app notification queue for operational awareness.
- Canonical tables:
  - `public.user_notifications`
- Canonical services:
  - `lib/services/notifications.ts`
- Key workflows:
  - create notification
  - unread count/list
  - mark read/mark all read
- Upstream dependencies:
  - domain workflow events (enrollment, signatures, etc.)
- Downstream consumers:
  - user inbox/toast surfaces
- RPC expectations:
  - typically simple CRUD; include in transaction boundary when required for lifecycle guarantee.
- Common drift risks:
  - workflow “success” that claims notification sent without durable row
  - direct writes bypassing notification service

### 12) Billing / Pricing

- Purpose: billing policy, fee/rate definitions, invoice/batch generation, exports.
- Canonical tables:
  - Pricing:
    - `public.enrollment_pricing_community_fees`
    - `public.enrollment_pricing_daily_rates`
  - Billing config:
    - `public.center_billing_settings`
    - `public.member_billing_settings`
    - `public.billing_schedule_templates`
    - `public.payors`
    - `public.center_closures`
    - `public.closure_rules`
  - Billing execution:
    - `public.billing_batches`
    - `public.billing_invoices`
    - `public.billing_invoice_lines`
    - `public.billing_adjustments`
    - `public.billing_coverages`
    - `public.billing_export_jobs`
- Canonical services:
  - `lib/services/billing-supabase.ts`
  - `lib/services/billing.ts`
  - `lib/services/enrollment-pricing.ts`
  - `lib/services/enrollment-packet-proration.ts`
- Key workflows:
  - pricing resolution for enrollment packet
  - billing batch generation/finalization/reopen
  - invoice generation and export
- Upstream dependencies:
  - Members/MCC attendance
  - Transportation logs
  - Ancillary charges
- Downstream consumers:
  - finance exports
  - invoice dashboards
- RPC expectations:
  - batch/invoice multi-table generation and reopen/finalize paths should use shared RPC/transaction boundaries.
- Common drift risks:
  - recalculations outside canonical billing service
  - overlap rules bypassed
  - disconnected pricing snapshot vs runtime tables

### 13) Permissions / Profiles

- Purpose: auth identity, role/permission policy, module-level guards.
- Canonical tables:
  - `public.profiles`
  - `public.roles`
  - `public.role_permissions`
  - `public.user_permissions`
  - `public.staff_auth_events`
- Canonical services/modules:
  - `lib/auth.ts`
  - `lib/permissions.ts`
  - `lib/services/staff-auth.ts`
  - `lib/services/user-management.ts`
- Key workflows:
  - profile/session resolution
  - role + permission evaluation
  - staff invite/reset/auth lifecycle event capture
- Upstream dependencies:
  - Supabase auth users
- Downstream consumers:
  - all guarded actions/routes
  - sensitive RLS policies
- RPC expectations:
  - simple policy-backed writes are acceptable; avoid scattered permission logic and enforce canonical guard helpers.
- Common drift risks:
  - bypassing `requireModuleAccess` / `requireRoles`
  - role string checks duplicated in UI
  - profile/auth identity mismatch (`id` vs `auth_user_id`)

### 14) System Events

- Purpose: global lifecycle audit event stream.
- Canonical tables:
  - `public.system_events`
- Canonical services:
  - `lib/services/system-event-service.ts`
- Key workflows:
  - append significant lifecycle events from service layer only
- Upstream dependencies:
  - all lifecycle-critical service modules
- Downstream consumers:
  - audits
  - operational debugging
  - compliance traceability
- RPC expectations:
  - for critical workflows, event write should be included in transaction boundary or equivalent durable post-commit policy.
- Common drift risks:
  - sparse event coverage across domains
  - UI/action-level event writes
  - silent event write failures masking audit gaps

## Cross-Domain Workflows

- Lead -> Member conversion
  - Leads + Members + System Events
- Enrollment Packet completion/finalization
  - Enrollment Packets + Member Files + MCC/MHP/POF staging + Notifications + Lead Activities
- Enrollment Packet staging review and prefill consumption
  - Enrollment Packets + POF draft creation + MCC awareness surfaces + System Events
- Intake completion/sign
  - Intake + Member Files (signature artifacts) + POF draft creation path
- POF signing
  - POF + Member Files + MHP + MCC + MAR + document events/queue
- Care Plan signing
  - Care Plans + Member Files + signature events + Notifications
- Billing batch generation
  - Billing + Attendance + Transportation + Ancillary + Members/Payors

## Workflows That Should Use Shared RPC

- Already shared RPC-backed:
  - lead conversion (`rpc_convert_lead_to_member`, `rpc_create_lead_with_member_conversion`)
  - physician order signing/finalization (`rpc_sign_physician_order`, `rpc_finalize_pof_signature`)
- Should be shared RPC-backed (or equivalent explicit transaction boundary):
  - enrollment packet submission -> completed -> filed + downstream mapping
  - intake assessment + assessment_responses durable create
  - care plan caregiver signature finalization + final member file persistence
  - MAR schedule generation/regeneration for signed medication sets
  - billing batch generation/finalization/reopen cascades

## Public-Token / Public-Sign Boundaries

- Public token routes:
  - `/sign/enrollment-packet/[token]` -> `enrollment_packet_requests.token`
  - `/sign/pof/[token]` -> `pof_requests.signature_request_token`
  - `/sign/care-plan/[token]` -> `care_plans.caregiver_signature_request_token`
- Boundary rules:
  - tokens must be hashed at rest and validated only in canonical service modules
  - token expiry/status checks must occur before any write
  - public handlers call service layer only; no direct Supabase domain writes in route/action
  - completion must rotate/invalidate token and persist signed artifacts before success is returned
  - public flows only mutate their owned workflow tables plus required downstream artifacts

## Clinical vs Operational vs Public Separation

- Clinical domains:
  - Intake Assessments
  - Physician Orders / POF
  - MHP
  - Care Plans
  - MAR
- Operational domains:
  - Leads
  - Enrollment Packets (staff side)
  - Members / MCC
  - Member Files
  - Notifications
  - Billing / Pricing
  - Permissions / Profiles
- Public workflows:
  - Enrollment packet caregiver submit
  - POF provider sign
  - Care plan caregiver sign
- Separation rule:
  - public flows are narrow, token-scoped completion surfaces
  - clinical state changes must be service-mediated and auditable
  - operational dashboards consume canonical persisted clinical outputs, never inferred UI state

## Cross-Domain Lifecycle Map

Lead  
-> Enrollment Packet  
-> Member  
-> Intake  
-> POF  
-> MHP  
-> MCC  
-> Care Plans  
-> MAR  
-> Member Files / Notifications

Lifecycle notes:

- Lead -> Enrollment Packet
  - identity bridge must be canonical (`lead.id` -> `members.source_lead_id` via shared resolver/RPC conversion).
- Enrollment Packet -> Member/Clinical Staging
  - completed packet writes artifacts and mapping/staging rows.
- Member -> Intake
  - intake binds to canonical `member_id` (optional `lead_id` for provenance).
- Intake -> POF
  - signed intake is gate for draft POF generation.
- POF -> MHP/MCC/MAR
  - signed POF triggers queued downstream sync and medication schedule propagation.
- Care Plans -> Member Files/Notifications
  - completion/signature outcomes must persist final file artifacts and notify stakeholders.

## Architecture Guardrails by Domain

- Leads
  - never convert lead/member outside canonical conversion service + RPC.
- Enrollment Packets
  - never mark completed/filed unless signature + packet artifacts + required downstream persistence succeed.
- Members
  - never infer identity from name/text; always resolve canonical ids.
- Intake
  - never treat unsigned intake as finalized clinical source.
- POF
  - never bypass RPC finalize/sign path for provider signatures.
- MHP
  - never duplicate POF->MHP mapping rules outside shared mapping owner.
- MCC
  - never duplicate cross-profile sync rules in UI code.
- Care Plans
  - never mark signed/completed before final artifact persistence.
- MAR
  - never document administration without schedule/source integrity checks.
- Member Files
  - never claim document completion without `member_files` persistence.
- Notifications
  - never rely on UI-only notification state for workflow outcomes.
- Billing / Pricing
  - never compute invoices from ad hoc local logic outside canonical billing service.
- Permissions / Profiles
  - never bypass canonical guard helpers at action boundaries.
- System Events
  - never write lifecycle events from UI/routes; service layer only.

## Forbidden Patterns That Cause Architecture Drift

- UI direct Supabase writes for business workflows.
- Server action/route business writes that bypass canonical services.
- Parallel write paths for the same business concept.
- Mixed lead/member identity payloads without canonical resolver translation.
- Runtime fallback records or synthetic success when persistence fails.
- Manual edits of system-driven workflow states (`sent/opened/signed/completed/declined/expired`).
- Cross-domain cascades implemented as scattered ad hoc writes.
- Public token flow logic outside canonical service boundaries.
- New schema dependencies without forward-only migrations.
- Runtime mock/in-memory/file-backed persistence in production paths.
