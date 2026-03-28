import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  normalizeLeadFormFollowUpType,
  normalizeLeadFormLeadSource,
  normalizeLeadFormLikelihood,
  normalizeLeadFormStage,
  normalizeLeadFormStatus,
  normalizeLeadFormSummary,
  splitLeadFormLostReason
} from "@/lib/services/lead-form-normalization";

function readWorkspaceFile(relativePath: string) {
  return readFileSync(relativePath, "utf8");
}

test("legacy lead values normalize into the current lead edit form model", () => {
  const normalized = normalizeLeadFormSummary({
    stage: "EIP",
    status: "open",
    leadSource: "Legacy source",
    likelihood: "very warm",
    nextFollowUpType: "fax",
    lostReason: "Budget",
    closedDate: " 2025-03-01 "
  });

  assert.equal(normalizeLeadFormStage("Closed - Enrolled"), "Closed - Won");
  assert.equal(normalizeLeadFormStatus("EIP", "open"), "Open");
  assert.equal(normalizeLeadFormLeadSource("Legacy source"), "Other");
  assert.equal(normalizeLeadFormLikelihood("very warm"), "Warm");
  assert.equal(normalizeLeadFormFollowUpType("fax"), "Call");
  assert.equal(normalizeLeadFormLikelihood(undefined, ""), "");
  assert.equal(normalizeLeadFormFollowUpType(undefined, ""), "");
  assert.deepEqual(splitLeadFormLostReason("Budget"), {
    lostReason: "Other",
    lostReasonOther: "Budget"
  });
  assert.deepEqual(normalized, {
    stage: "Enrollment in Progress",
    status: "Open",
    leadSource: "Other",
    leadSourceOther: "",
    likelihood: "Warm",
    nextFollowUpType: "Call",
    tourCompleted: "",
    lostReason: "Other",
    lostReasonOther: "Budget",
    closedDate: "2025-03-01"
  });
});

test("lead save action has separate validation messaging for edit mode", () => {
  const source = readWorkspaceFile("app/sales-lead-actions.ts");

  assert.equal(source.includes('submissionMode: z.enum(["create", "edit"]).optional()'), true);
  assert.equal(source.includes('submissionMode === "edit" ? "Invalid lead update." : "Invalid inquiry submission."'), true);
});

test("legacy app actions reuse shared lead normalization helpers", () => {
  const source = readWorkspaceFile("app/actions.ts");
  const canonicalSource = readWorkspaceFile("lib/canonical.ts");
  const crmSource = readWorkspaceFile("lib/services/sales-crm-read-model.ts");

  assert.equal(source.includes('from "@/lib/services/lead-form-normalization"'), true);
  assert.equal(source.includes("normalizeLegacyLeadSourceOption"), false);
  assert.equal(source.includes("normalizeLegacyLikelihoodOption"), false);
  assert.equal(source.includes("normalizeLegacyFollowUpTypeOption"), false);
  assert.equal(source.includes("splitLegacyLostReasonParts"), false);
  assert.equal(canonicalSource.includes("getEnrollmentPacketEligibleLeadQueryStages"), true);
  assert.equal(crmSource.includes("getEnrollmentPacketEligibleLeadQueryStages"), true);
});
