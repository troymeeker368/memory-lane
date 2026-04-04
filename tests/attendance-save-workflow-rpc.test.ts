import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function readWorkspaceFile(relativePath: string) {
  return readFileSync(relativePath, "utf8");
}

test("attendance actions delegate attendance mutations to one RPC-backed service workflow", () => {
  const actionSource = readWorkspaceFile("app/(portal)/operations/attendance/actions.ts");
  const serviceSource = readWorkspaceFile("lib/services/attendance-workflow-supabase.ts");

  assert.equal(actionSource.includes("saveAttendanceStatusWorkflowSupabase"), true);
  assert.equal(actionSource.includes("saveUnscheduledAttendanceWorkflowSupabase"), true);
  assert.equal(actionSource.includes("syncAttendanceBillingForDate"), false);
  assert.equal(actionSource.includes("syncAttendanceLatePickupAncillaryChargeSupabase"), false);
  assert.equal(actionSource.includes("applyMakeupBalanceDeltaWithAuditSupabase"), false);
  assert.equal(actionSource.includes("deleteAttendanceRecordSupabase"), false);
  assert.equal(actionSource.includes("setBillingAdjustmentExcludedSupabase"), false);
  assert.equal(actionSource.includes("upsertAttendanceRecordSupabase"), false);

  assert.equal(serviceSource.includes('const SAVE_ATTENDANCE_WORKFLOW_RPC = "rpc_save_attendance_workflow";'), true);
  assert.equal(serviceSource.includes("invokeSupabaseRpcOrThrow<SaveAttendanceWorkflowRpcRow[] | null>("), true);
  assert.equal(serviceSource.includes("resolveAttendanceBillingSyncPlan"), true);
  assert.equal(serviceSource.includes("resolveAttendanceLatePickupChargePlanSupabase"), true);
});

test("attendance workflow migration keeps attendance, makeup, billing, late pickup, and event logging inside one RPC boundary", () => {
  const migrationSource = readWorkspaceFile("supabase/migrations/0193_attendance_workflow_atomic_rpc.sql");

  assert.equal(migrationSource.includes("create or replace function public.rpc_save_attendance_workflow_internal("), true);
  assert.equal(migrationSource.includes("create or replace function public.rpc_save_attendance_workflow("), true);
  assert.equal(migrationSource.includes("pg_advisory_xact_lock"), true);
  assert.equal(migrationSource.includes("from public.attendance_records"), true);
  assert.equal(migrationSource.includes("insert into public.billing_adjustments"), true);
  assert.equal(migrationSource.includes("update public.billing_adjustments"), true);
  assert.equal(migrationSource.includes("from public.ancillary_charge_logs"), true);
  assert.equal(migrationSource.includes("insert into public.audit_logs"), true);
  assert.equal(migrationSource.includes("insert into public.system_events"), true);
  assert.equal(migrationSource.includes("Late pick-up charge has already been billed and cannot be removed automatically."), true);
  assert.equal(migrationSource.includes("Attendance no longer requires extra-day billing."), true);
});
