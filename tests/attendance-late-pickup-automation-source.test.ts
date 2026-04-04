import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function readWorkspaceFile(relativePath: string) {
  return readFileSync(relativePath, "utf8");
}

test("attendance save path keeps late pickup rules in shared services and out of the server action", () => {
  const attendanceActionsSource = readWorkspaceFile("app/(portal)/operations/attendance/actions.ts");
  const attendanceWorkflowSource = readWorkspaceFile("lib/services/attendance-workflow-supabase.ts");
  const ancillaryWriteSource = readWorkspaceFile("lib/services/ancillary-write-supabase.ts");

  assert.equal(attendanceActionsSource.includes("saveAttendanceStatusWorkflowSupabase"), true);
  assert.equal(attendanceActionsSource.includes("saveUnscheduledAttendanceWorkflowSupabase"), true);
  assert.equal(ancillaryWriteSource.includes("export async function syncAttendanceLatePickupAncillaryChargeSupabase"), true);
  assert.equal(ancillaryWriteSource.includes("export async function resolveAttendanceLatePickupChargePlanSupabase"), true);
  assert.equal(ancillaryWriteSource.includes('sourceEntity: "attendanceRecords"'), true);
  assert.equal(attendanceWorkflowSource.includes("resolveAttendanceLatePickupChargePlanSupabase"), true);
  assert.equal(attendanceActionsSource.includes("syncAttendanceLatePickupAncillaryChargeSupabase"), false);
  assert.equal(attendanceActionsSource.includes('from("ancillary_charge_logs")'), false);
});
