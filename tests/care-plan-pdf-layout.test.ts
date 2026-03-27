import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function readWorkspaceFile(relativePath: string) {
  return readFileSync(relativePath, "utf8");
}

test("care plan PDF builder uses form-style layout without internal workflow metadata", () => {
  const source = readWorkspaceFile("lib/services/care-plan-pdf.ts");

  assert.equal(source.includes("drawCheckboxRow"), true);
  assert.equal(source.includes("drawSingleFieldRow"), true);
  assert.equal(source.includes("drawSignatureRow"), true);
  assert.equal(source.includes("blueprint.definition.memberInformationLabel"), true);

  assert.equal(source.includes("DOCUMENT_CENTER_NAME"), false);
  assert.equal(source.includes("Generated:"), false);
  assert.equal(source.includes("Nurse/Admin Signer User ID"), false);
  assert.equal(source.includes("Nurse/Admin Signature Artifact Storage Path"), false);
  assert.equal(source.includes("Track:"), false);
  assert.equal(source.includes("Status:"), false);
});
