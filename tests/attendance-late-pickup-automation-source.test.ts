import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function readWorkspaceFile(relativePath: string) {
  return readFileSync(relativePath, "utf8");
}

test("attendance checkout delegates automated late pickup ancillary sync to a shared service", () => {
  const attendanceActionsSource = readWorkspaceFile("app/(portal)/operations/attendance/actions.ts");
  const ancillaryWriteSource = readWorkspaceFile("lib/services/ancillary-write-supabase.ts");

  assert.equal(ancillaryWriteSource.includes("export async function syncAttendanceLatePickupAncillaryChargeSupabase"), true);
  assert.equal(ancillaryWriteSource.includes('sourceEntity: "attendanceRecords"'), true);
  assert.equal(attendanceActionsSource.includes("syncAttendanceLatePickupAncillaryChargeSupabase"), true);
  assert.equal(attendanceActionsSource.includes('from("ancillary_charge_logs")'), false);
});
