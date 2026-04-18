import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("health dashboard uses one shared MAR snapshot boundary", () => {
  const readModelSource = readFileSync("lib/services/mar-dashboard-read-model.ts", "utf8");
  const dashboardSource = readFileSync("lib/services/health-dashboard.ts", "utf8");

  assert.equal((readModelSource.match(/\.from\("v_mar_today"\)/g) ?? []).length, 2);
  assert.equal(readModelSource.includes("export async function getHealthDashboardMarSnapshot"), true);
  assert.equal(readModelSource.includes('.neq("status", "Given")'), true);
  assert.equal(readModelSource.includes('.eq("status", "Given")'), true);
  assert.equal(readModelSource.includes('.not("administered_at", "is", null)'), true);
  assert.equal(readModelSource.includes("todayRows"), false);
  assert.equal(dashboardSource.includes("getHealthDashboardMarSnapshot"), true);
  assert.equal(dashboardSource.includes("getHealthDashboardMarActionRows"), false);
  assert.equal(dashboardSource.includes("getHealthDashboardMarRecentRows"), false);
  assert.equal(dashboardSource.includes(".filter((row) => {\r\n      const scheduledTime = parseDate(row.scheduledTime);"), false);
});
