# Reporting Smoke Test (Memory Lane)

Use this checklist after report read-model changes or database rollout.

## Pre-conditions
- You are logged in with a user who can access **Reports**.
- You have a known active staff user with recent activity.
- You have a known member with recent activity.
- Local app is running with the current DB migrations and synced types.

## Staff Snapshot (`/reports/staff`)
1. Open `/reports/staff`.
2. Select one staff member and set a short date range (for example last 7 days).
3. Confirm the summary cards render with non-negative counts.
4. Confirm these sections can load rows (or show explicit empty-state):
   - Participation Log
   - Toilet Log
   - Shower Log
   - Transportation Logs
   - Blood Sugar Logs
   - Photo Upload Logs
   - Assessment Logs
   - Time Punch Logs
   - Lead Activity Logs
   - Partner Activity Logs
5. Click a few **Open** links from each section and confirm each destination page loads.
6. Compare totals for a known week/day to previous behavior; totals should be stable in magnitude, not missing major categories.

## Member Summary (`/reports/member-summary`)
1. Open `/reports/member-summary`.
2. Pick a member and a short date range.
3. Confirm summary cards render for:
   - Total Entries
   - Documentation
   - Clinical
   - Ancillary
4. Confirm the timeline list renders rows, or a clear “No member activity found” message.
5. Click a few **Open** links and confirm each destination page is valid.
6. Change to a different range preset (today / last 30 days / custom) and confirm filtering updates counts and timeline.

## Regressions to flag immediately
- “No rows found” everywhere when data is known to exist.
- Broken or empty **Open** links.
- Sudden large drops in any count for a known date window.
- Errors in page rendering or 404s from report detail links.
