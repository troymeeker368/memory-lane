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
  assert.equal(marPageSource.includes("historyLimit: MAR_FIRST_LOAD_HISTORY_LIMIT"), true);
  assert.equal(marPageSource.includes("notGivenLimit: MAR_FIRST_LOAD_NOT_GIVEN_LIMIT"), true);
  assert.equal(marPageSource.includes("prnLimit: MAR_FIRST_LOAD_PRN_LIMIT"), true);

  assert.equal(marReadSource.includes("notGivenLimit?: number;"), true);
  assert.equal(marReadSource.includes("const notGivenLimit = Math.max(10, Math.min(options?.notGivenLimit ?? 100, 250));"), true);
  assert.equal(marReadSource.includes('.from("v_mar_today").select(MAR_TODAY_SELECT).order("scheduled_time", { ascending: true })'), true);
  assert.equal(marReadSource.includes('.from("v_mar_overdue_today").select(MAR_TODAY_SELECT).order("scheduled_time", { ascending: true })'), true);
  assert.equal(marReadSource.includes('.from("v_mar_not_given_today")'), true);
  assert.equal(marReadSource.includes(".limit(notGivenLimit),"), true);
  assert.equal(marReconcileSource.includes("export async function reconcileMarSchedulesForMember"), true);
  assert.equal(marReadSource.includes('import { reconcileMarSchedulesForMember } from "@/lib/services/mar-reconcile";'), true);
  assert.equal(marReadSource.includes("reconcileMarSchedulesForMember({"), true);
  assert.equal(marWriteSource.includes('import { reconcileMarSchedulesForMember } from "@/lib/services/mar-reconcile";'), true);
  assert.equal(marWriteSource.includes("return reconcileMarSchedulesForMember({"), true);
});
