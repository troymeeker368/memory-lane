# Audit Output Contract

- Local canonical audit output directory: `D:\Memory Lane App\docs\audits`
- New audit writers must resolve paths through `lib/config/audit-paths.ts`
- Use `getAuditOutputDir()`, `ensureAuditOutputDir()`, and `buildAuditOutputPath(filename)` instead of hardcoding output folders
- Do not write audit markdown, json, txt, csv, or html outputs to `docs/reports`, `reports`, `tmp`, `temp`, `artifacts`, `output`, `generated`, `logs`, or repo-root ad hoc files
- If an audit run is blocked, save the blocked report in this folder instead of inventing an alternate location
