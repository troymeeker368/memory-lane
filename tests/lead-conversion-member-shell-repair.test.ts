import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function readWorkspaceFile(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("lead conversion service relies on the canonical RPC boundary instead of post-RPC shell repair", () => {
  const serviceSource = readWorkspaceFile("lib/services/sales-lead-conversion-supabase.ts");

  assert.equal(serviceSource.includes("ensureLeadConversionMemberShellRows"), false);
  assert.equal(serviceSource.includes('import("@/lib/services/member-operational-shell")'), false);
  assert.equal(serviceSource.includes("await ensureLeadConversionMemberShellRows(result.memberId);"), false);
  assert.equal(serviceSource.includes("invokeLeadConversionRpcWithFallback"), true);
});

test("lead conversion wrapper migration refuses success when canonical shell rows are missing", () => {
  const migrationSource = readWorkspaceFile(
    "supabase/migrations/0156_lead_conversion_wrapper_shell_assertions.sql"
  );

  assert.equal(
    migrationSource.includes("create or replace function public.rpc_convert_lead_to_member("),
    true
  );
  assert.equal(migrationSource.includes("create or replace function public.rpc_create_lead_with_member_conversion("), true);
  assert.equal(migrationSource.includes("Lead conversion did not persist member_command_centers"), true);
  assert.equal(migrationSource.includes("Lead conversion did not persist member_attendance_schedules"), true);
  assert.equal(migrationSource.includes("Lead conversion did not persist member_health_profiles"), true);
  assert.equal(migrationSource.includes("Lead creation with conversion did not persist member_health_profiles"), true);
});
