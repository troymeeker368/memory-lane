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

