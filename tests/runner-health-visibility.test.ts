import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("health dashboard loads runner health in read-only mode and surfaces it in the workspace", () => {
  const dashboardSource = readFileSync("lib/services/health-dashboard.ts", "utf8");
  const workspaceSource = readFileSync("app/(portal)/health/_components/nursing-dashboard-workspace.tsx", "utf8");

  assert.equal(dashboardSource.includes("getPofPostSignSyncRunnerHealth({ emitSignals: false })"), true);
  assert.equal(dashboardSource.includes("getEnrollmentPacketMappingRunnerHealth({ emitSignals: false })"), true);
  assert.equal(dashboardSource.includes("runnerHealth:"), true);
  assert.equal(dashboardSource.includes("pofPostSignSync: pofRunnerHealth"), true);
  assert.equal(dashboardSource.includes("enrollmentPacketMapping: enrollmentRunnerHealth"), true);

  assert.equal(workspaceSource.includes("function RunnerHealthPanel"), true);
  assert.equal(workspaceSource.includes("Workflow Runner Health"), true);
  assert.equal(workspaceSource.includes("dashboard.runnerHealth.pofPostSignSync"), true);
  assert.equal(workspaceSource.includes("dashboard.runnerHealth.enrollmentPacketMapping"), true);
});
