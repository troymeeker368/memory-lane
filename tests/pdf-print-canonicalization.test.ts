import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function readWorkspaceFile(relativePath: string) {
  return readFileSync(relativePath, "utf8");
}

test("PDF-backed print buttons use generated PDF helpers instead of printing the page HTML", () => {
  const assessmentActions = readWorkspaceFile("components/assessment/assessment-pdf-actions.tsx");
  const carePlanActions = readWorkspaceFile("components/care-plans/care-plan-pdf-actions.tsx");
  const incidentActions = readWorkspaceFile("components/incidents/incident-pdf-actions.tsx");
  const pofActions = readWorkspaceFile("components/physician-orders/pof-pdf-actions.tsx");
  const faceSheetActions = readWorkspaceFile("components/face-sheet/face-sheet-actions.tsx");
  const dietCardActions = readWorkspaceFile("components/diet-card/diet-card-actions.tsx");

  for (const source of [
    assessmentActions,
    carePlanActions,
    incidentActions,
    pofActions,
    faceSheetActions,
    dietCardActions
  ]) {
    assert.equal(source.includes('import { triggerPdfDownload, triggerPdfPrint } from "@/components/documents/pdf-client";'), true);
    assert.equal(source.includes("window.print()"), false);
  }
});

test("print-only health document actions can render PDFs without saving extra member-file artifacts", () => {
  const assessmentActionSource = readWorkspaceFile("app/(portal)/health/assessment/[assessmentId]/actions.ts");
  const carePlanActionSource = readWorkspaceFile("app/(portal)/health/care-plans/[carePlanId]/actions.ts");
  const pofActionSource = readWorkspaceFile("app/(portal)/health/physician-orders/actions.ts");

  assert.equal(assessmentActionSource.includes("persistToMemberFiles?: boolean"), true);
  assert.equal(assessmentActionSource.includes("const persistToMemberFiles = input.persistToMemberFiles !== false;"), true);
  assert.equal(assessmentActionSource.includes("if (!persistToMemberFiles) {"), true);

  assert.equal(carePlanActionSource.includes("persistToMemberFiles?: boolean"), true);
  assert.equal(carePlanActionSource.includes("const persistToMemberFiles = input.persistToMemberFiles !== false;"), true);
  assert.equal(carePlanActionSource.includes("if (persistToMemberFiles) {"), true);

  assert.equal(pofActionSource.includes("persistToMemberFiles?: boolean"), true);
  assert.equal(pofActionSource.includes("const persistToMemberFiles = input.persistToMemberFiles !== false;"), true);
  assert.equal(pofActionSource.includes("if (persistToMemberFiles) {"), true);
});
