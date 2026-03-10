Memory Lane System Architecture
1. Application Overview
Memory Lane is an operations and clinical management platform designed for Adult Day Centers.
The application supports daily operational workflows including member management, attendance tracking,
clinical documentation, staff management, transportation coordination, billing, and operational reporting.
2. User Roles
Primary roles in the system include:
- Staff
- Coordinator
- Nurse
- Manager
- Director
- Admin
- Sales

Each role has different levels of access to operational modules and permissions.
Sensitive operations such as payroll approval, billing exports, and clinical edits require elevated roles.
3. Core Operational Modules
The system is organized into operational modules:

Members
Central participant records used by all modules.

Health / Nursing
Clinical documentation such as medication tracking, vitals, incidents, behavior monitoring, and nursing notes.

Attendance / Census
Daily attendance tracking and census views.

Time Clock
Staff punch in/out system with meal deductions, timecard approvals, PTO, and payroll exports.

Billing / Revenue
Ancillary charge tracking, attendance-driven billing, invoices, and revenue reporting.

Transportation
Route management, driver logs, pickup/drop tracking, and transport manifests.

Member Intake & Assessments
Onboarding workflows, demographic capture, health history, dietary needs, and care needs.

Sales / Marketing
Lead tracking, referral sources, community partners, and pipeline management.

Reporting & Analytics
Operational dashboards, census reports, payroll summaries, billing reports, and exception monitoring.
4. Data Model Overview
Primary data entities include:

Members
Staff
Attendance Records
Punches
Daily Timecards
PTO Entries
Transportation Logs
Ancillary Charges
Leads
Community Partners
Assessments

Most operational data references either Members or Staff.
5. Shared Services
Business logic should be centralized in shared services such as:

attendanceService
timecardService
billingService
reportingService
transportService
permissionsService

UI components should not contain operational calculations.
6. Cross Module Workflows
Modules interact with each other through operational workflows.

Examples:
Attendance affects billing totals.
Transportation logs affect billing and attendance verification.
PTO affects payroll summaries.
Forgotten punches affect daily timecards.
Intake updates affect member summaries.
Health alerts surface in member summary views.
7. Navigation Structure
Navigation follows a hierarchy:

Menu → Route → Page → Data Source

Examples:
/members
/members/[id]
/attendance
/time-clock
/director/timecards
/billing
/sales/pipeline
8. Mobile vs Desktop Design
Mobile-first modules:
Time clock
Attendance logging
Activity logs
Transportation logs
Nursing documentation

Desktop-first modules:
Payroll dashboards
Billing reports
Sales pipelines
Operational analytics
9. Export and Reporting
Exports supported by the system include:

CSV exports
Printable reports
PDF generation where required

Examples:
Payroll summaries
Transportation manifests
Billing summaries
Attendance reports
Member summaries
10. System Constraints
Important architectural constraints:

Do not duplicate calculations across modules.
Do not hide permission restrictions only in UI.
Maintain audit trails for operational and clinical records.
Avoid dead routes or navigation links.
Use shared services for calculations and data transformations.
