import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function readWorkspaceFile(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("schedule change action delegates permanent attendance sync to one RPC-backed service", () => {
  const actionSource = readWorkspaceFile("app/(portal)/operations/schedule-changes/actions.ts");
  const serviceSource = readWorkspaceFile("lib/services/schedule-changes-supabase.ts");

  assert.equal(actionSource.includes("saveScheduleChangeWithAttendanceSyncSupabase"), true);
  assert.equal(actionSource.includes("updateScheduleChangeStatusWithAttendanceSyncSupabase"), true);
  assert.equal(actionSource.includes("updateMemberAttendanceScheduleSupabase"), false);
  assert.equal(actionSource.includes("applyAttendanceScheduleDays"), false);
  assert.equal(serviceSource.includes('const SAVE_SCHEDULE_CHANGE_WITH_ATTENDANCE_SYNC_RPC = "rpc_save_schedule_change_with_attendance_sync"'), true);
  assert.equal(
    serviceSource.includes('const UPDATE_SCHEDULE_CHANGE_STATUS_WITH_ATTENDANCE_SYNC_RPC = "rpc_update_schedule_change_status_with_attendance_sync"'),
    true
  );
  assert.equal(serviceSource.includes("invokeSupabaseRpcOrThrow<unknown>(supabase, SAVE_SCHEDULE_CHANGE_WITH_ATTENDANCE_SYNC_RPC"), true);
  assert.equal(
    serviceSource.includes("invokeSupabaseRpcOrThrow<unknown>(supabase, UPDATE_SCHEDULE_CHANGE_STATUS_WITH_ATTENDANCE_SYNC_RPC"),
    true
  );
});

test("schedule change migration atomically saves the row and applies or reverts MCC attendance days", () => {
  const migrationSource = readWorkspaceFile("supabase/migrations/0157_schedule_change_attendance_sync_rpc.sql");

  assert.equal(
    migrationSource.includes("create or replace function public.rpc_save_schedule_change_with_attendance_sync("),
    true
  );
  assert.equal(
    migrationSource.includes("create or replace function public.rpc_update_schedule_change_status_with_attendance_sync("),
    true
  );
  assert.equal(migrationSource.includes("insert into public.schedule_changes ("), true);
  assert.equal(migrationSource.includes("update public.schedule_changes as schedule_changes"), true);
  assert.equal(migrationSource.includes("insert into public.member_attendance_schedules ("), true);
  assert.equal(migrationSource.includes("if v_saved.change_type = 'Permanent Schedule Change' then"), true);
  assert.equal(migrationSource.includes("elsif v_previous.id is not null and v_previous.change_type = 'Permanent Schedule Change' then"), true);
  assert.equal(migrationSource.includes("update public.member_attendance_schedules as member_attendance_schedules"), true);
  assert.equal(migrationSource.includes("if p_status = 'cancelled' then"), true);
  assert.equal(migrationSource.includes("elsif p_status in ('active', 'completed') then"), true);
});
