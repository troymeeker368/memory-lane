import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function readWorkspaceFile(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("auth and landing permission reads stay user-scoped and target canonical profile ids", () => {
  const authSource = readWorkspaceFile("lib/auth.ts");
  const landingSource = readWorkspaceFile("lib/home-landing-auth.ts");

  assert.equal(authSource.includes('.from("user_permissions")'), true);
  assert.equal(authSource.includes('.eq("user_id", data.id);'), true);
  assert.equal(authSource.includes('.eq("user_id", user.id);'), false);
  assert.equal(authSource.includes("createServiceRoleClient("), false);

  assert.equal(landingSource.includes('.from("user_permissions")'), true);
  assert.equal(landingSource.includes('.eq("user_id", data.id);'), true);
  assert.equal(landingSource.includes('.eq("user_id", user.id);'), false);
  assert.equal(landingSource.includes("createServiceRoleClient("), false);
});

test("operational security hardening migration locks RLS and privileged RPC boundaries", () => {
  const migrationSource = readWorkspaceFile("supabase/migrations/0192_operational_rls_and_privileged_read_hardening.sql");

  assert.equal(migrationSource.includes("create or replace function public.current_profile_id()"), true);
  assert.equal(migrationSource.includes("create or replace function public.current_profile_has_permission("), true);
  assert.equal(migrationSource.includes('create policy "user_permissions_read_self"'), true);
  assert.equal(migrationSource.includes('create policy "member_command_centers_select"'), true);
  assert.equal(migrationSource.includes('create policy "member_attendance_schedules_select"'), true);
  assert.equal(migrationSource.includes('create policy "schedule_changes_select"'), true);
  assert.equal(migrationSource.includes('create policy "provider_directory_select"'), true);
  assert.equal(migrationSource.includes('create policy "hospital_preference_directory_select"'), true);
  assert.equal(migrationSource.includes("rpc_update_member_command_center_bundle_internal"), true);
  assert.equal(migrationSource.includes("rpc_save_member_command_center_attendance_billing_internal"), true);
  assert.equal(migrationSource.includes("rpc_save_member_command_center_transportation_internal"), true);
  assert.equal(migrationSource.includes("rpc_save_schedule_change_with_attendance_sync_internal"), true);
  assert.equal(migrationSource.includes("rpc_update_schedule_change_status_with_attendance_sync_internal"), true);
  assert.equal(migrationSource.includes("rpc_lookup_provider_directory_normalized requires authorized health-unit access."), true);
  assert.equal(migrationSource.includes("rpc_lookup_hospital_preference_directory_normalized requires authorized health-unit access."), true);
});

test("canonical member/detail reads fail explicitly instead of silently escalating to service role", () => {
  const canonicalSource = readWorkspaceFile("lib/services/canonical-person-ref.ts");
  const detailSource = readWorkspaceFile("lib/services/member-detail-read-model.ts");
  const timeSource = readWorkspaceFile("lib/services/time.ts");

  assert.equal(canonicalSource.includes('createServiceRoleClient("canonical_identity_resolution_read")'), true);
  assert.equal(canonicalSource.includes("isRlsRecursionOrTimeoutError"), false);
  assert.equal(detailSource.includes("retrying with service_role"), false);
  assert.equal(detailSource.includes("Fix the underlying Supabase policy/current_role boundary"), true);
  assert.equal(timeSource.includes("retrying with service_role"), false);
  assert.equal(timeSource.includes("Fix the underlying RLS/read model path instead of retrying with service_role."), true);
});
