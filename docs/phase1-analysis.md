# Phase 1 Analysis

## Understanding
Build a production-ready staff operations portal to replace AppSheet, optimized for quick smartphone entry and desktop oversight, with secure role-based access and auditable workflows.

## Inferred Entities and Relationships

- `profiles` (staff users) -> roles (`admin`, `manager`, `nurse`, `staff`)
- `members` -> used across all care logs (`daily_activity_logs`, `toilet_logs`, `shower_logs`, `transportation_logs`, `blood_sugar_logs`, `member_photo_uploads`, `documentation_tracker`, `mar_entries`, `ancillary_charge_logs`)
- `sites` -> `time_punches` (geofence-ready site punch validation)
- `time_punches` -> `time_punch_exceptions` (manager review)
- `documentation_tracker` mirrors care-plan/progress-note due-cycle model from workbook
- `documentation_events` aggregates all documentation logs for timeliness and at-a-glance dashboards
- `ancillary_charge_categories` -> `ancillary_charge_logs`
- `leads` -> `lead_activities`
- `community_partner_organizations` -> `referral_sources` -> `partner_activities`
- `email_logs` linked to leads for outbound communication tracking
- `audit_logs` for high-risk operational actions

## Workbook Signals Used

- `Operations Warehouse.xlsx`
  - Core operational logs and nav model (`HomeNav`, `Master Staff`, `Master Members`, `TimeClock`, documentation logs, ancillary logs, timeliness summaries)
- `Documentation Tracker.xlsx`
  - Care plan/progress note cadence (+180 and +90 day cycle formulas)
- `Leads Pipeline.xlsx`
  - Sales pipeline entities, activity logging, referral/partner structures, lead list values

## Pain Points Inferred from Source Data

- Repeated `System.Xml.XmlElement` placeholder fields indicate brittle AppSheet/export coupling.
- Key identity fields are spread across text labels instead of normalized IDs.
- Several sheets store computed dashboard rows rather than source-of-truth events.
- Header offsets/formula-filled columns make integrity fragile for long-term maintenance.
- Workflow logic depends on workbook conventions, not explicit database constraints or policies.

## Improvements Over Current Structure

- Normalize data model around stable IDs and typed relations.
- Add RLS policies and maintainable role mapping in code.
- Replace spreadsheet-formula dependencies with SQL views and triggers.
- Keep dashboard rows computed from event logs.
- Centralize audit and email logs for compliance and troubleshooting.
- Add explicit exception table for time clock corrections/review.
- Implement module-level access gating (`requireModuleAccess`) and simple permission maps.

## Architecture Proposal

- Frontend: Next.js App Router + TypeScript + Tailwind
- Auth: Supabase email/password auth
- Data: Supabase Postgres with SQL migrations, RLS, views, and triggers
- API pattern: Server Components + Server Actions for low-latency form submits
- Deployment: Vercel (frontend) + Supabase project (database/auth/storage)
- Logging: `audit_logs` table for privileged actions and critical workflow writes

## Build Plan

1. Scaffold app shell, auth flow, route protections, role-aware navigation.
2. Implement core schema/migrations and seed data from inferred entities.
3. Build module pages: Dashboard, Time Card, Documentation, Health, Ancillary, Sales, Reports, PTO.
4. Add fast-entry forms for high-frequency tasks (time punch, daily activity, ancillary, lead intake).
5. Implement computed views for timeliness, at-a-glance counts, biweekly totals, lead pipeline, ancillary monthly summaries.
6. Harden with RLS, validations, and audit logging hooks.
7. Finalize deployment docs, env docs, and admin management docs.
