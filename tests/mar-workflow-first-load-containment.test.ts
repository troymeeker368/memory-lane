import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("MAR workflow first load caps history-style datasets without changing live queues", () => {
  const marPageSource = readFileSync("app/(portal)/health/mar/page.tsx", "utf8");
  const marReadSource = readFileSync("lib/services/mar-workflow-read.ts", "utf8");
  const marWriteSource = readFileSync("lib/services/mar-workflow.ts", "utf8");
  const marReconcileSource = readFileSync("lib/services/mar-reconcile.ts", "utf8");

  assert.equal(marPageSource.includes("const MAR_FIRST_LOAD_HISTORY_LIMIT = 100;"), true);
  assert.equal(marPageSource.includes("const MAR_FIRST_LOAD_NOT_GIVEN_LIMIT = 100;"), true);
  assert.equal(marPageSource.includes("const MAR_FIRST_LOAD_PRN_LIMIT = 100;"), true);
  assert.equal(marPageSource.includes("const MAR_FIRST_LOAD_TODAY_LIMIT = 150;"), true);
  assert.equal(marPageSource.includes("const MAR_FIRST_LOAD_OVERDUE_LIMIT = 150;"), true);
  assert.equal(marPageSource.includes("todayLimit: MAR_FIRST_LOAD_TODAY_LIMIT"), true);
  assert.equal(marPageSource.includes("overdueLimit: MAR_FIRST_LOAD_OVERDUE_LIMIT"), true);
  assert.equal(marPageSource.includes('const queueParam = Array.isArray(resolvedSearchParams?.queue) ? resolvedSearchParams?.queue[0] : resolvedSearchParams?.queue;'), true);
  assert.equal(marPageSource.includes('Link href="/health/mar?queue=full"'), true);
  assert.equal(marPageSource.includes("historyLimit: MAR_FIRST_LOAD_HISTORY_LIMIT"), true);
  assert.equal(marPageSource.includes("notGivenLimit: MAR_FIRST_LOAD_NOT_GIVEN_LIMIT"), true);
  assert.equal(marPageSource.includes("prnLimit: MAR_FIRST_LOAD_PRN_LIMIT"), true);

  assert.equal(marReadSource.includes("todayLimit?: number;"), true);
  assert.equal(marReadSource.includes("overdueLimit?: number;"), true);
  assert.equal(marReadSource.includes("const todayLimit = Math.max(1, Math.min(options?.todayLimit ?? 100, 500));"), true);
  assert.equal(marReadSource.includes("const overdueLimit = Math.max(1, Math.min(options?.overdueLimit ?? 100, 500));"), true);
  assert.equal(marReadSource.includes('supabase.from("v_mar_today").select("mar_schedule_id", { count: "exact", head: true })'), true);
  assert.equal(marReadSource.includes('supabase.from("v_mar_overdue_today").select("mar_schedule_id", { count: "exact", head: true })'), true);
  assert.equal(marReadSource.includes("todayTotalCount: Number(todayTotalCount ?? today.length)"), true);
  assert.equal(marReadSource.includes("overdueTodayTotalCount: Number(overdueTodayTotalCount ?? overdueToday.length)"), true);
  assert.equal(marReadSource.includes("notGivenLimit?: number;"), true);
  assert.equal(marReadSource.includes("const notGivenLimit = Math.max(10, Math.min(options?.notGivenLimit ?? 100, 250));"), true);
  assert.equal(marReadSource.includes('.from("v_mar_today")'), true);
  assert.equal(marReadSource.includes('.limit(todayLimit),'), true);
  assert.equal(marReadSource.includes('.from("v_mar_overdue_today")'), true);
  assert.equal(marReadSource.includes('.limit(overdueLimit),'), true);
  assert.equal(marReadSource.includes('.from("v_mar_not_given_today")'), true);
  assert.equal(marReadSource.includes(".limit(notGivenLimit),"), true);
  assert.equal(marReconcileSource.includes("export async function reconcileMarSchedulesForMember"), true);
  assert.equal(marReadSource.includes('import { reconcileMarSchedulesForMember } from "@/lib/services/mar-reconcile";'), true);
  assert.equal(marReadSource.includes("reconcileMarSchedulesForMember({"), true);
  assert.equal(marWriteSource.includes('import { reconcileMarSchedulesForMember } from "@/lib/services/mar-reconcile";'), true);
  assert.equal(marWriteSource.includes("return reconcileMarSchedulesForMember({"), true);
});
