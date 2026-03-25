import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function readWorkspaceFile(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("lead conversion service repairs member shell rows after RPC conversion", () => {
  const serviceSource = readWorkspaceFile("lib/services/sales-lead-conversion-supabase.ts");
  const shellSource = readWorkspaceFile("lib/services/member-operational-shell.ts");

  assert.equal(serviceSource.includes("ensureLeadConversionMemberShellRows"), true);
  assert.equal(serviceSource.includes('import("@/lib/services/member-operational-shell")'), true);
  assert.equal(serviceSource.includes("await ensureLeadConversionMemberShellRows(result.memberId);"), true);
  assert.equal(shellSource.includes("ensureCanonicalMemberOperationalShellRows"), true);
  assert.equal(shellSource.includes("backfillMissingMemberCommandCenterRows"), true);
  assert.equal(shellSource.includes("backfillMissingMemberHealthProfiles"), true);
});

test("lead conversion migration restores MHP creation and backfills missing member shells", () => {
  const migrationSource = readWorkspaceFile(
    "supabase/migrations/0148_restore_lead_conversion_mhp_and_member_shell_backfill.sql"
  );

  assert.equal(
    migrationSource.includes("create or replace function public.apply_lead_stage_transition_with_member_upsert("),
    true
  );
  assert.equal(migrationSource.includes("insert into public.member_health_profiles ("), true);
  assert.equal(migrationSource.includes("left join public.member_command_centers mcc"), true);
  assert.equal(migrationSource.includes("left join public.member_attendance_schedules mas"), true);
  assert.equal(migrationSource.includes("left join public.member_health_profiles mhp"), true);
});
