import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function readWorkspaceFile(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("required MCC shell accessors fail explicitly instead of inserting runtime shell rows", () => {
  const source = readWorkspaceFile("lib/services/member-command-center-supabase.ts");
  const profileSection = source.slice(
    source.indexOf("export async function getRequiredMemberCommandCenterProfileSupabase"),
    source.indexOf("export async function getRequiredMemberAttendanceScheduleSupabase")
  );
  const scheduleSection = source.slice(
    source.indexOf("export async function getRequiredMemberAttendanceScheduleSupabase"),
    source.indexOf("export async function updateMemberCommandCenterProfileSupabase")
  );

  assert.equal(profileSection.includes('.insert('), false);
  assert.equal(profileSection.includes('table: "member_command_centers"'), true);
  assert.equal(scheduleSection.includes('.insert('), false);
  assert.equal(scheduleSection.includes('table: "member_attendance_schedules"'), true);
});

test("runtime MCC and attendance service entry points require canonical shells before writes", () => {
  const memberCommandCenterSource = readWorkspaceFile("lib/services/member-command-center.ts");
  const scheduleChangesSource = readWorkspaceFile("lib/services/schedule-changes-supabase.ts");
  const profileSyncSource = readWorkspaceFile("lib/services/member-profile-sync.ts");

  assert.equal(
    memberCommandCenterSource.includes("await getRequiredMemberCommandCenterProfileSupabase(input.memberId);"),
    true
  );
  assert.equal(
    memberCommandCenterSource.includes("await getRequiredMemberAttendanceScheduleSupabase(input.memberId);"),
    true
  );
  assert.equal(
    scheduleChangesSource.includes("await getRequiredMemberAttendanceScheduleSupabase(canonicalMemberId, { canonicalInput: true });"),
    true
  );
  assert.equal(
    profileSyncSource.includes("await getRequiredMemberCommandCenterProfileSupabase(memberId);"),
    true
  );
});

test("MCC write-path hardening migration removes shell inserts from live runtime RPCs", () => {
  const runtimeAssertionSource = readWorkspaceFile(
    "supabase/migrations/0193_member_command_center_shell_runtime_assertions.sql"
  );
  const writeHardeningSource = readWorkspaceFile(
    "supabase/migrations/0194_member_command_center_shell_write_path_hardening.sql"
  );

  assert.equal(
    runtimeAssertionSource.includes("create or replace function public.rpc_update_member_command_center_bundle("),
    true
  );
  assert.equal(
    runtimeAssertionSource.includes("create or replace function public.rpc_save_member_command_center_attendance_billing("),
    true
  );
  assert.equal(
    runtimeAssertionSource.includes("create or replace function public.rpc_save_member_command_center_transportation("),
    true
  );
  assert.equal(
    runtimeAssertionSource.includes("create or replace function public.rpc_prefill_member_command_center_from_assessment("),
    true
  );
  assert.equal(
    runtimeAssertionSource.includes("create or replace function public.rpc_save_schedule_change_with_attendance_sync("),
    true
  );
  assert.equal(
    runtimeAssertionSource.includes("create or replace function public.rpc_update_schedule_change_status_with_attendance_sync("),
    true
  );
  assert.equal(writeHardeningSource.includes("rpc_update_member_command_center_bundle_internal("), true);
  assert.equal(writeHardeningSource.includes("rpc_save_member_command_center_attendance_billing_internal("), true);
  assert.equal(writeHardeningSource.includes("rpc_save_member_command_center_transportation_internal("), true);
  assert.equal(writeHardeningSource.includes("rpc_save_schedule_change_with_attendance_sync_internal("), true);
  assert.equal(writeHardeningSource.includes("rpc_update_schedule_change_status_with_attendance_sync_internal("), true);
  assert.equal(runtimeAssertionSource.includes("Missing canonical member_command_centers row"), true);
  assert.equal(runtimeAssertionSource.includes("Missing canonical member_attendance_schedules row"), true);
});
