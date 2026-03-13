import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function readWorkspaceFile(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("nurse POF editor does not render legacy manual signature fields or legacy save buttons", () => {
  const source = readWorkspaceFile("app/(portal)/health/physician-orders/new/page.tsx");

  assert.equal(source.includes("Provider Signature"), false);
  assert.equal(source.includes("Provider Signature Date"), false);
  assert.equal(source.includes("Save Sent"), false);
  assert.equal(source.includes("Save Signed"), false);
});

test("nurse POF workflow exposes save draft and send-for-signature path", () => {
  const pageSource = readWorkspaceFile("app/(portal)/health/physician-orders/new/page.tsx");
  const workflowCardSource = readWorkspaceFile("components/physician-orders/pof-esign-workflow-card.tsx");

  assert.equal(pageSource.includes("Save Draft"), true);
  assert.equal(pageSource.includes("Provider E-Sign Workflow"), true);
  assert.equal(workflowCardSource.includes("Send POF for Signature"), true);
  assert.equal(workflowCardSource.includes("Provider Email"), true);
  assert.equal(workflowCardSource.includes("Nurse Name"), true);
  assert.equal(workflowCardSource.includes("From Email"), true);
  assert.equal(workflowCardSource.includes("Optional Message"), true);
});

test("signed workflow renders read-only summary panel", () => {
  const source = readWorkspaceFile("components/physician-orders/pof-esign-workflow-card.tsx");

  assert.equal(source.includes("Signed Summary (Read-only)"), true);
  assert.equal(source.includes("Provider Typed Name"), true);
  assert.equal(source.includes("Signed Date"), true);
  assert.equal(source.includes("Signed Status"), true);
});

test("send button has explicit disabled-state guidance", () => {
  const source = readWorkspaceFile("components/physician-orders/pof-esign-workflow-card.tsx");

  assert.equal(source.includes("Save draft first before sending for provider signature."), true);
  assert.equal(source.includes("A signature request is already active. Use Resend to deliver it again."), true);
});
