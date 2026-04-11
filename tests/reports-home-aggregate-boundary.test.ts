import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

function readWorkspaceFile(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("reports home aggregates use a bounded recent window instead of full historical scans", () => {
  const migrationSource = readWorkspaceFile("supabase/migrations/0208_reports_home_recent_window.sql");
  const serviceSource = readWorkspaceFile("lib/services/reports-ops.ts");

  assert.equal(migrationSource.includes("interval '180 days'"), true);
  assert.equal(migrationSource.includes("and de.event_at >= rw.from_ts"), true);
  assert.equal(migrationSource.includes("and tp.punch_at >= rw.from_ts"), true);
  assert.equal(serviceSource.includes("REPORTS_HOME_AGGREGATES_WINDOW_DAYS = 180"), true);
  assert.equal(serviceSource.includes("REPORTS_HOME_AGGREGATES_WINDOW_LABEL"), true);
});

test("reports home page labels the rolling snapshot contract", () => {
  const pageSource = readWorkspaceFile("app/(portal)/reports/page.tsx");

  assert.equal(pageSource.includes("Reports Home Snapshot"), true);
  assert.equal(pageSource.includes("rolling"), true);
  assert.equal(pageSource.includes("snapshot"), true);
});
