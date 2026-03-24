import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function readWorkspaceFile(relativePath: string) {
  return readFileSync(relativePath, "utf8");
}

test("lead conversion hardening migration creates the canonical member shell inside the conversion transaction", () => {
  const migrationSource = readWorkspaceFile("supabase/migrations/0135_lead_conversion_member_shell_backfill.sql");

  assert.equal(
    migrationSource.includes("create or replace function public.apply_lead_stage_transition_with_member_upsert("),
    true
  );
  assert.equal(migrationSource.includes("insert into public.member_command_centers ("), true);
  assert.equal(migrationSource.includes("on conflict on constraint member_command_centers_member_id_key do nothing;"), true);
  assert.equal(migrationSource.includes("insert into public.member_attendance_schedules ("), true);
  assert.equal(
    migrationSource.includes("on conflict on constraint member_attendance_schedules_member_id_key do nothing;"),
    true
  );
  assert.equal(migrationSource.includes("insert into public.member_health_profiles ("), true);
  assert.equal(migrationSource.includes("on conflict on constraint member_health_profiles_member_id_key do nothing;"), true);
  assert.equal(migrationSource.includes("'mcc-' || v_member_id::text"), true);
  assert.equal(migrationSource.includes("'attendance-' || v_member_id::text"), true);
});
