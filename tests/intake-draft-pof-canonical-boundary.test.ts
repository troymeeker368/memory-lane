import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("signed intake routes draft POF creation through the canonical shared service and RPC boundary", () => {
  const intakeActionSource = readFileSync("app/intake-actions.ts", "utf8");
  const intakeCascadeSource = readFileSync("lib/services/intake-pof-mhp-cascade.ts", "utf8");
  const physicianOrderSource = readFileSync("lib/services/physician-orders-supabase.ts", "utf8");

  assert.equal(intakeActionSource.includes("completeIntakeAssessmentPostSignWorkflow"), true);
  assert.equal(intakeCascadeSource.includes("autoCreateDraftPhysicianOrderFromIntake"), true);
  assert.equal(intakeCascadeSource.includes("createDraftPhysicianOrderFromAssessment"), true);
  assert.equal(physicianOrderSource.includes('const CREATE_DRAFT_POF_FROM_INTAKE_RPC = "rpc_create_draft_physician_order_from_intake";'), true);
  assert.equal(physicianOrderSource.includes("p_assessment_id: input.assessment.id"), true);
});
