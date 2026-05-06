import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("care-plan write actions require explicit canEdit permission", () => {
  const authorizationSource = read("lib/services/care-plan-authorization.ts");
  const actionsSource = read("app/care-plan-actions.ts");
  const pdfActionSource = read("app/(portal)/health/care-plans/[carePlanId]/actions.ts");

  assert.equal(
    authorizationSource.includes('requireCarePlanAuthorizedUser(action: PermissionAction = "canView")'),
    true
  );
  assert.equal(
    authorizationSource.includes('requireNavItemAccess("/health/care-plans", action)'),
    true
  );

  const editGateMatches = actionsSource.match(/requireCarePlanAuthorizedUser\("canEdit"\)/g) ?? [];
  assert.equal(editGateMatches.length >= 4, true);
  assert.equal(pdfActionSource.includes('requireCarePlanAuthorizedUser("canEdit")'), true);
});