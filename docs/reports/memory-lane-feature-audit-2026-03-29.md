# Memory Lane Feature Audit

Date: 2026-03-29
Repository: `D:\Memory Lane App`

## What This Audit Is

This is a repo-derived audit of Memory Lane's feature set and practical usefulness. It is based on the live code structure, route inventory, service/domain boundaries, Supabase migrations, and the latest audit artifacts already checked into the repository.

This is not a live production usage analysis. It does not measure adoption, user satisfaction, or production uptime. It does show what the system is built to do today and where the current repo indicates meaningful operational value or remaining risk.

## Executive Summary

Memory Lane is a substantial adult day center operations platform that blends lightweight EHR-style clinical workflows with day-to-day operational management. The repo is not centered on one narrow feature. It supports the full path from lead intake and enrollment through member operations, clinical documentation, medication workflows, billing, reporting, staff permissions, and audit trails.

At a product level, its biggest strength is continuity across workflows that are usually split across separate tools:

- sales and referral intake
- enrollment packet collection and public caregiver completion
- member identity and operational profile management
- intake assessments, physician orders, care plans, and health profiles
- MAR and medication administration workflows
- daily documentation, incident capture, and ancillary charges
- attendance, transportation, billing, and management reporting
- staff auth, permissions, notifications, and audit logging

That combined scope makes Memory Lane useful because it reduces handoff loss between admissions, operations, nursing, and finance. Instead of separate spreadsheets, paper packets, and disconnected staff notes, the repo is structured to keep those workflows in one Supabase-backed system with role-aware access and auditable lifecycle events.

## Scope Snapshot

Concrete repo signals of product scope:

- 167 Supabase migration files
- 234 service-layer files under `lib/services`
- 129 staff-facing `page.tsx` routes under `app/(portal)`
- 4 public-sign/public-completion route pages under `app/sign`
- 6 major staff navigation groups in the canonical nav model: Documentation, Operations, Reports, Time & HR, Sales Activities, and Health Unit

These numbers do not prove quality by themselves, but they do confirm that Memory Lane is a broad operational platform rather than a landing page or early prototype.

## Major Feature Families

## 1. Sales, Referrals, and Pre-Enrollment Intake

Repo evidence shows a full pre-admission workflow:

- sales pipeline management
- inquiry, tour, nurture, EIP, won, and lost stages
- lead detail pages and activity logging
- community partners and referral sources
- enrollment packet sending and completed packet review
- lead-to-member conversion through canonical services and RPC-backed flows

Why this is useful:

- It gives staff a structured funnel from first contact to enrollment instead of ad hoc spreadsheets.
- It preserves source-of-truth lineage from lead to enrolled member, which matters when tracing how someone entered the program.
- It reduces duplicate intake work because enrollment packet and downstream clinical staging are already connected to the admissions workflow.

Practical value:

- better follow-up discipline
- cleaner admissions handoffs
- more predictable conversion from inquiry to active member

## 2. Enrollment Packets and Public Caregiver Completion

Memory Lane includes a dedicated enrollment packet system with both staff and public-facing flows:

- packet request creation and sending
- caregiver-facing public completion routes
- signatures, uploads, and packet events
- filing and downstream staging for intake, POF, MHP, and MCC workflows
- packet follow-up queues and readiness tracking

Why this is useful:

- It replaces paper-heavy intake packets with a structured digital process.
- It allows families or caregivers to complete work externally without staff re-entering everything by hand.
- It creates a traceable bridge from admissions paperwork into actual operational and clinical setup.

Practical value:

- less front-desk rekeying
- faster onboarding
- fewer dropped handoffs between sales and care delivery

## 3. Member Operations and the Member Command Center

The repo contains a strong operational member-management layer centered on the Member Command Center:

- demographics
- attendance views
- transportation settings
- contact management
- holds
- locker assignments
- pricing and billing-adjacent settings
- files and document access
- schedule changes

Why this is useful:

- It gives staff one operational home for a participant instead of forcing them to jump across unrelated tools.
- It ties together the details that actually drive day-center operations: attendance patterns, transport, contacts, holds, and documents.
- It supports downstream consumers like attendance boards, billing, transportation manifests, and reporting.

Practical value:

- faster front-line staff lookup
- fewer operational mistakes caused by stale or scattered records
- clearer accountability when member status changes

## 4. Clinical Intake, Physician Orders, and Ongoing Health Records

Memory Lane is not only an operations platform. It also includes meaningful clinical workflows:

- intake assessments
- physician orders / POF
- member health profiles
- care plans
- progress notes
- blood sugar logging
- incident reporting

The domain map and service structure show a canonical clinical cascade:

- Intake Assessment -> Physician Orders (POF) -> Member Health Profile (MHP) -> Member Command Center (MCC)

Why this is useful:

- It creates a structured clinical onboarding path rather than disconnected forms.
- It keeps physician-authorized instructions connected to actual member profiles and operational views.
- It supports care planning and longitudinal documentation in one place.

Practical value:

- better intake-to-care continuity
- more reliable handoff from assessment to physician authorization
- clearer clinical traceability for audits and care reviews

## 5. Medication Administration Record (MAR) and Medication Workflows

The health module includes a real medication workflow surface:

- MAR dashboard and workflow pages
- medication schedule generation
- scheduled administration documentation
- PRN medication handling
- monthly MAR reporting
- POF-driven medication propagation into downstream systems

Why this is useful:

- It moves medication documentation out of improvised paper or spreadsheet tracking.
- It links medication truth back to signed physician orders.
- It supports both daily execution and reporting, which is important for compliance and operational oversight.

Practical value:

- safer daily med pass operations
- stronger survey/compliance readiness
- less risk of medication instructions drifting away from authorized orders

## 6. Daily Documentation and Operational Logs

The Documentation area covers routine day-center workflow capture:

- participation log
- toilet log
- shower log
- transportation documentation
- incident reports
- photo upload
- ancillary charges

Why this is useful:

- These are exactly the kinds of workflows that often live on paper and then become hard to audit later.
- Bringing them into a shared system makes daily care activity easier to supervise and easier to summarize later.
- It creates operational evidence that can support billing, incident review, and quality oversight.

Practical value:

- less missing documentation
- easier daily supervisor review
- better defensibility when reconstructing care events

## 7. Attendance, Transportation, Pricing, and Billing Operations

The Operations area is broad and practical:

- attendance board
- schedule changes
- member holds
- transportation station
- pricing defaults
- payor and billing operations
- billing agreements
- billing batches
- custom invoices
- exports
- revenue dashboard
- center closures
- variable charges and schedule templates

Why this is useful:

- It connects attendance and operational status to actual financial workflows.
- It supports the work adult day centers have to do beyond care delivery: closures, transportation logistics, payor settings, invoice generation, and billing adjustments.
- It helps leadership see whether the operational picture and billing picture match.

Practical value:

- more reliable revenue capture
- fewer attendance-to-billing mismatches
- stronger operational control over transportation and schedule-driven services

## 8. Reporting, Admin Oversight, and Auditability

The repo includes dedicated reporting and admin-reporting surfaces:

- attendance summary
- revenue reporting
- member documentation summary
- on-demand admin reporting
- audit trail views
- monthly ancillary reporting
- staff reports

The architecture also requires `system_events`, audit logs, document events, and staff auth events.

Why this is useful:

- Leadership can monitor operations without manually consolidating many exports.
- Audit trails matter in healthcare-adjacent environments because "what happened, when, and by whom" is not optional.
- Reporting tied to canonical runtime data is far more useful than static spreadsheets that drift from reality.

Practical value:

- better operational visibility
- stronger compliance posture
- faster investigation of workflow failures or missed steps

## 9. Staff Access, Role Restrictions, and HR/Time Functions

Memory Lane includes role-based platform access plus HR-adjacent operational tools:

- user management
- role and permission enforcement
- notifications
- time clock
- punch history
- forgotten punch workflows
- director timecards
- payroll export surfaces
- PTO link integration

Why this is useful:

- It supports the reality that different staff should not see or edit everything.
- It keeps workforce workflow closer to the operational system instead of forcing parallel manual timekeeping.
- It gives supervisors a direct path from staffing activity to review and payroll export.

Practical value:

- cleaner staff access control
- simpler workforce administration
- less dependence on separate time-tracking workarounds

## Why Memory Lane Is Useful Overall

The strongest usefulness case is not any one screen. It is the combination of linked workflows:

- sales can become enrollment
- enrollment can become member setup
- member setup can feed intake and clinical workflows
- signed clinical workflows can drive profiles, care plans, MAR, and member files
- attendance and transportation can feed billing and reporting
- audit trails and role controls can follow the whole chain

That is what makes the platform materially useful for an adult day center. It is trying to behave like an operating system for the center, not just a documentation add-on.

In plain English, Memory Lane is useful because it can reduce these real operational problems:

- duplicate data entry
- dropped handoffs between departments
- paper packet bottlenecks
- missing documentation
- uncertainty about the current source of truth
- weak auditability when something goes wrong

## Current Production-Readiness Takeaways

Based on the latest checked-in audit documents, the repo currently shows several strong signs:

- strong Supabase-first architecture discipline
- deep migration-backed schema coverage
- explicit domain ownership and canonical service boundaries
- nightly architecture audits for security, canonicality, ACID safety, idempotency, workflow simulation, and query performance
- recent cleanup of competing write paths and resolver drift in audited areas

Those are meaningful strengths because they reduce the chance that the app looks correct in the UI while persisting inconsistent or non-canonical state underneath.

At the same time, the latest audit documents still flag real risks:

- public care plan caregiver signing still has a high-severity post-commit cleanup/readiness bug and is described as launch-blocking in the latest ACID audit
- signed POF downstream sync still depends on the retry runner being healthy and monitored
- enrollment packet completion and intake signing are intentionally staged, so raw status alone is not always the same as operational readiness
- some full validation gates in recent audits were blocked by host-level `EPERM` subprocess restrictions, which means not every final check completed cleanly in that environment

What that means in practice:

- Memory Lane is clearly useful and fairly mature in scope.
- It is also clearly still an actively hardened production system, not a finished and risk-free one.
- The broad platform design is strong, but a few lifecycle-critical workflows still need careful stabilization.

## Bottom-Line Assessment

Product usefulness rating: High

Why:

- broad coverage of the adult day center lifecycle
- meaningful linkage between admissions, operations, clinical care, billing, and reporting
- role-aware workflow separation
- strong auditability mindset
- clear attempt to centralize source-of-truth behavior in shared services and Supabase

Current caution rating: Moderate

Why:

- some high-risk workflows still depend on staged follow-up or queue health
- at least one care-plan signature path is still flagged as a serious ACID bug in the latest audit artifacts
- final production signoff should still be based on successful validation runs and remediation of the known launch-blocking flow

## Recommendation

Memory Lane is already useful enough to be described as a lightweight EHR plus operations platform for adult day centers, especially because it connects admissions, care workflows, attendance, transportation, billing, reporting, and audit trails in one system.

The best near-term product strategy is not a broad refactor. It is continued hardening of the few lifecycle-critical workflows that can still produce misleading success or partial completion, especially:

- public care plan signing finalization
- signed POF downstream sync operations
- staff-facing readiness truth for staged packet and intake workflows

If those areas are stabilized, the platform's usefulness becomes much easier to trust operationally.

## Repo Evidence Used

- `README.md`
- `ARCHITECTURE.md`
- `DOMAIN_MAP.md`
- `lib/permissions/nav.ts`
- `docs/admin-guide.md`
- `docs/audits/production-readiness-audit-2026-03-29.md`
- `docs/audits/acid-transaction-audit-2026-03-29.md`
- `docs/audits/shared-resolver-drift-check-2026-03-29.md`
- `docs/audits/idempotency-duplicate-submission-audit-2026-03-29.md`
- route inventory under `app/(portal)` and `app/sign`
- service and migration inventory under `lib/services` and `supabase/migrations`
