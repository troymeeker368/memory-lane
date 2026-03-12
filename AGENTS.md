# Memory Lane Development Rules

- Always run the local app on `http://localhost:3001`.
- Do not switch to another port just because `3001` is busy.
- If `3001` is occupied, identify the process using it and stop that process before starting the app.
- Before edits, run `git status`.
- After edits, run `npm run typecheck`.
- After significant edits, run `npm run build`.
- Summarize changed files and any remaining issues at the end.

## Port Utilities (Windows)

- Optional helper: `npm run dev:clean`
  - Frees port `3001` and then starts the app on `3001`.
  - Use this when a stuck Next.js dev server is blocking startup.
- If PowerShell blocks `npx` scripts:
  - Run `npm run dev:clean` from Command Prompt.
  - Or manually clear the port:
    - `netstat -ano | findstr :3001`
    - `taskkill /PID <PID> /F`


AGENTS.md — Memory Lane Development Guidelines for Codex

Memory Lane is an operations and clinical management platform for an Adult Day Center.
The system supports daily operations including member management, clinical documentation,
transportation coordination, staffing workflows, billing, and reporting.

1. Core Development Principles

Always:
- Inspect existing code before writing new code
- Reuse existing architecture patterns
- Centralize business logic in shared services
- Preserve audit trails for operational records
- Use consistent naming conventions
- Enforce role-based permissions in code
- Verify routes resolve to working pages
- Confirm operational workflows remain intact

Never:
- Duplicate business logic across components
- Implement permissions using UI hiding only
- Assume functionality exists because a page exists
- Leave dead navigation links
- Hardcode operational rules inside UI components
- Silently overwrite operational records

2. Required Development Workflow

Step 1 — Inspect
Identify routes, models, services, permissions, and data flow before coding.

Step 2 — Plan
Define files to change, schema updates, routes, services, and permission impacts.

Step 3 — Implement
Keep UI components presentation‑focused and move logic into shared services.

Step 4 — Verify
Confirm routing, permissions, persistence, exports, and workflow functionality.

Step 5 — Audit
Check for stale state, duplicate logic, broken navigation, missing permissions,
and mobile layout issues.

3. Architecture Rules

Business logic must live in shared services such as:
/services/timecardService.ts
/services/attendanceService.ts
/services/billingService.ts
/services/reportingService.ts

Operational calculations must be centralized:
- attendance totals
- staff hours
- meal deductions
- overtime calculations
- billing totals
- transportation totals

4. Roles and Permissions

Roles:
staff
coordinator
nurse
manager
director
admin
sales

Sensitive operations requiring elevated roles:
- payroll exports
- timecard approvals
- PTO approvals
- billing adjustments
- editing member records
- correcting punches

5. Data Integrity Requirements

Standard fields:
createdBy
createdAt
updatedBy
updatedAt

Approval fields:
approvedBy
approvedAt

Clinical review fields:
reviewedBy
reviewedAt

Never silently overwrite operational records.

6. Operational Modules

Members
The central entity linking attendance, activities, transportation, health records,
and billing.

Health / Nursing Unit
Supports medication tracking, vital signs, oxygen monitoring, insulin administration,
nursing notes, behavior monitoring, fall tracking, incident reports, and alerts.

Attendance / Census
Daily attendance tracking, census views, attendance reporting, and billing integration.

Time Clock
Punch in/out, meal deduction, daily timecards, director approvals, PTO tracking,
forgotten punch requests, and payroll exports.

Billing / Revenue
Ancillary charge tracking, attendance‑driven billing, transport billing,
monthly summaries, invoices, and revenue dashboards.

Transportation
Route assignments, driver logs, pickup/drop tracking, and daily manifests.

Member Intake & Assessments
Intake forms, demographic capture, health history, dietary needs,
transportation requirements, and assistance level documentation.

Sales
Lead tracking, pipeline management, referral sources, community partners,
and outreach activity logging.

Reporting & Analytics
Census reports, payroll summaries, billing summaries, transportation reports,
sales dashboards, and operational exception reporting.

7. Cross‑Module Integration Rules

Modules interact with each other. Examples:
attendance → billing
transportation → billing
intake → member records
health alerts → member summary
PTO → payroll summaries

Avoid creating disconnected systems.

8. State and Synchronization Rules

Operational modules must stay synchronized.

Examples:
attendance changes affect billing
forgotten punches affect timecards
PTO affects payroll summaries
transportation updates affect manifests

Use shared services instead of local component state.

9. Navigation Rules

Each menu item must map to:
menu → route → page → data source

Never leave dead links.

10. Mobile vs Desktop Design

Mobile‑first:
time clock
attendance logging
activity logs
transport logs
nursing documentation

Desktop‑first:
payroll
billing dashboards
sales pipeline
analytics and reporting

11. Export Requirements

Exports should support:
CSV
printable reports
PDF where appropriate

Exports must include timestamps, staff identifiers, and approval data when relevant.

12. Code Quality Expectations

When finishing work report:
files changed
new files created
schema changes
routes added
permissions affected
tests or validations performed
known limitations
recommended improvements

13. Codebase Auditing

Audits must identify:
missing features
partial implementations
duplicate logic
dead routes
permission weaknesses

Provide prioritized remediation recommendations.

14. Repository State

If the working tree contains uncommitted files:
include them in analysis and mark them as in‑progress.

15. Completion Criteria

A feature is complete only when:
UI exists
route works
data persists
permissions enforced
exports function
workflows operate end‑to‑end


## Sprint 7 Safety Additions
- Run `npm run quality:gates` after major stabilization edits and before merge readiness checks.
- Keep migration filenames unique and ordered using ####_description.sql; do not reuse numeric prefixes.
- Do not commit temporary capture artifacts (.tmp-*, screenshots, html dumps, test-results, tsbuildinfo).

## Canonicality Enforcement Rules

When modifying Memory Lane, always preserve or improve canonicality.

Definitions:
- A canonical source of truth is the single authoritative table/service/write path for a business concept.
- A canonicality gap exists when multiple modules compute or persist the same concept differently.

Required behavior:
1. Before editing, identify the canonical:
   - table(s)
   - read/resolution service
   - write action/service
   - downstream consumers
2. Do not add a new parallel resolver if one already exists.
3. Do not patch only the UI if the business rule belongs in a shared service.
4. Do not allow downstream modules to reimplement shared business logic.
5. If multiple modules calculate the same rule differently, consolidate them into one shared canonical resolver.
6. Runtime code must not use mock-era repositories, seed-only objects, or file-backed persistence.
7. If code and database disagree, repair the schema/code relationship with forward-only migrations and aligned services.
8. Derived operational outputs must be computed from canonical facts, not from duplicated derived state unless explicitly architected.

Priority order for fixes:
1. schema correctness
2. canonical service/resolver correctness
3. write path correctness
4. downstream consumer alignment
5. UI wiring

Refusal rules:
- Do not introduce new duplicate business logic.
- Do not keep mixed mock + Supabase runtime behavior.
- Do not add temporary fallback logic that bypasses the canonical path in production.

## Supabase-Only Runtime Rule

All runtime application behavior must be fully Supabase-backed.

The following are forbidden in production/runtime code:
- mock-repo imports
- getMockDb usage
- file-backed persistence
- synthetic default records returned when writes fail
- fallback objects returned when tables/columns are missing
- silent catch branches that mask failed persistence
- schema-masking empty results used as if they were persisted state

A write is only successful if the record is actually persisted in Supabase.
If a required schema object is missing, the correct fix is a migration or service repair, not a fallback branch.

## Shared Resolver Rule

All derived business logic must be implemented through shared resolvers/services and reused across the codebase.

A shared resolver is the single canonical implementation of a domain rule.  
Pages, server actions, reports, dashboards, and downstream services must not independently reimplement the same rule.

Requirements:
- If a rule is derived from multiple tables or conditions, it must live in a shared resolver.
- If multiple modules need the same answer, they must call the same resolver.
- Raw table reads are allowed only for simple persistence access, not for recomputing shared business rules.
- When a shared resolver exists, new code must use it rather than duplicating logic.
- If duplicate logic is discovered, it must be consolidated into the shared resolver and removed from consumers.

# Memory Lane Engineering Rules

## Production Readiness Goal
All runtime behavior must be production-ready, fully Supabase-backed, migration-defined, and canonically resolved through shared business-rule resolvers.

## Supabase-Only Runtime Rule
Production/runtime code must not use:
- mock-repo
- getMockDb
- file-backed persistence
- fabricated fallback records
- synthetic default records returned after failed writes
- schema-masking fallbacks when tables/columns are missing

A write is only successful if it actually persisted in Supabase.

If schema is missing, the correct fix is:
1. migration repair
2. service/repository alignment
3. validation

Not fallback logic.

## Canonical Source of Truth Rule
Every business concept must have:
- canonical Supabase table(s)
- canonical write path
- canonical shared resolver/service for derived rules
- downstream consumers that use the canonical resolver/service

No feature may introduce:
- parallel persistence
- parallel rule resolution
- mixed runtime data sources
- competing implementations of the same business rule

## Shared Resolver Rule
All derived business logic must be implemented through shared canonical resolvers and reused across the codebase.

Required shared-resolver domains include:
- expected attendance
- effective member schedule
- billing eligibility
- member command center state
- current care plan resolution
- lead/pipeline state resolution
- admin/reporting rollups where business rules are derived

Pages, actions, reports, and dashboards must not independently recompute those rules.

## Schema Drift Rule
Assume schema drift is possible whenever:
- code references tables/columns/views/functions
- triggers/functions assume columns like created_at or updated_at
- seed scripts insert into operational tables
- migrations have evolved recently

Fix schema drift with forward-only migrations and aligned code.
Do not patch over drift with try/catch skips or fabricated return objects.

## Required Workflow For Any Task
1. Identify the business domain.
2. Identify the canonical tables.
3. Identify the canonical write path.
4. Identify the canonical shared resolver.
5. Identify downstream consumers.
6. Audit for:
   - Supabase backing gaps
   - schema drift
   - mock-era runtime paths
   - duplicate business-rule logic
   - fallback branches masking failed persistence
7. Fix the canonical layer first.
8. Update downstream consumers to use the canonical layer.
9. Validate with:
   - build
   - reseed
   - banned-pattern search
10. Report:
   - root cause
   - files changed
   - migrations added
   - remaining blockers
   - whether the feature is now canonical and Supabase-backed

## Banned Patterns
Do not leave or introduce:
- mock runtime imports
- fabricated fallback records
- default object returns after failed writes
- duplicate attendance logic
- duplicate billing eligibility logic
- duplicate care plan current-version logic
- reporting logic that bypasses canonical domain resolvers
- UI-only patches for shared business rules

