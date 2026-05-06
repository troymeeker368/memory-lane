import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function readWorkspaceFile(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("Member Command Center detail reads use the privileged canonical read path after app authorization", () => {
  const detailReadModelSource = readWorkspaceFile("lib/services/member-command-center-detail-read-model.ts");
  const runtimeSource = readWorkspaceFile("lib/services/member-command-center-runtime.ts");
  const serviceRoleSource = readWorkspaceFile("lib/supabase/service-role.ts");

  assert.equal(
    detailReadModelSource.includes('getMemberCommandCenterDetailSupabase(input.memberId, { serviceRole: true })'),
    true
  );
  assert.equal(runtimeSource.includes("getMemberCommandCenterProfileReadOnlySupabase"), true);
  assert.equal(runtimeSource.includes("const supabase = await getMccClient(options);"), true);
  assert.equal(serviceRoleSource.includes("member_command_center_read"), true);
});
