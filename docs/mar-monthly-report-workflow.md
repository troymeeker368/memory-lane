# MAR Monthly Report Workflow (Canonical)

## Canonical Source-of-Truth Tables
- `public.pof_medications`: canonical medication order snapshot used by MAR
- `public.mar_schedules`: canonical scheduled administration opportunities
- `public.mar_administrations`: canonical administration events (scheduled + PRN + outcomes)
- `public.members`: canonical member demographics used in report headers
- `public.profiles`: canonical staff role attribution for monthly signoff section

## Canonical Read / Write Path
- UI: `components/forms/mar-monthly-report-panel.tsx`
- Server action: `app/(portal)/health/mar/actions.ts` (`generateMonthlyMarReportPdfAction`)
- Aggregation service: `lib/services/mar-monthly-report.ts`
- PDF rendering/export: `lib/services/mar-monthly-report-pdf.ts`
- Optional member-files persistence: `lib/services/member-files.ts`

## Architecture Separation
- Data aggregation is centralized in `assembleMarMonthlyReportData`.
- PDF template/render logic is isolated in `renderMarMonthlyReportPdf` and report-specific section builders.
- Export orchestration (authz, audit, optional member-file save) is in the server action.

## Computation Rules Implemented
- Month boundaries are interpreted in `America/New_York`.
- Expected scheduled doses are counted from canonical `mar_schedules` in the selected month.
- Scheduled given/not-given and exception categories are computed from canonical `mar_administrations` rows where `source='scheduled'`.
- PRN counts/effectiveness/follow-up are computed from canonical `mar_administrations` rows where `source='prn'`.
- Only administrations within the selected month boundary are included in monthly event tables.
- Medication inclusion is month-relevant (overlapping order window and/or month activity).

## Output Types
- `summary`: monthly rollups + exceptions + PRN + staff signoff
- `detail`: chronological administration detail + exception focus
- `exceptions`: exception-focused summary for compliance review

## Security / Permissions
- Generation is role-restricted to `admin`, `manager`, `director`, `nurse`.
- No public report routes were added.
- Report generation is server-backed and writes audit events on generation.

## Empty/Partial Data Handling
- The report panel surfaces:
  - no medication records
  - no MAR data for month
  - partial-records warnings (e.g., schedule/admin mismatch patterns)
- PDF still renders with explicit warning sections to preserve audit transparency.
