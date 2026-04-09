import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  getIntakePostSignReadinessDetail,
  resolveIntakePostSignReadiness,
  resolveIntakePostSignWorkflowReadinessStage
} from "../lib/services/intake-post-sign-readiness";
import { buildPhysicianOrderClinicalSyncDetail } from "../lib/services/physician-order-clinical-sync";

function readWorkspaceFile(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("intake readiness stays queued degraded when draft POF verification follow-up is still open", () => {
  const status = resolveIntakePostSignReadiness({
    signatureStatus: "signed",
    draftPofStatus: "created",
    openFollowUpTaskTypes: ["draft_pof_creation"]
  });

  assert.equal(status, "signed_pending_draft_pof_readback");
  assert.equal(
    resolveIntakePostSignWorkflowReadinessStage({
      signatureStatus: "signed",
      draftPofStatus: "created",
      openFollowUpTaskTypes: ["draft_pof_creation"]
    }),
    "queued_degraded"
  );
  assert.match(
    getIntakePostSignReadinessDetail(status) ?? "",
    /readback verification still needs follow-up/i
  );
});

test("intake readiness requires follow-up when draft POF creation fails", () => {
  const status = resolveIntakePostSignReadiness({
    signatureStatus: "signed",
    draftPofStatus: "failed",
    openFollowUpTaskTypes: ["draft_pof_creation"]
  });

  assert.equal(status, "draft_pof_failed");
  assert.equal(
    resolveIntakePostSignWorkflowReadinessStage({
      signatureStatus: "signed",
      draftPofStatus: "failed",
      openFollowUpTaskTypes: ["draft_pof_creation"]
    }),
    "follow_up_required"
  );
  assert.match(
    getIntakePostSignReadinessDetail(status) ?? "",
    /draft pof creation failed/i
  );
});

test("assessment form keeps degraded intake outcomes out of the clean success path", () => {
  const source = readWorkspaceFile("components/forms/assessment-form.tsx");

  assert.equal(source.includes("if (res.actionNeeded)"), true);
  assert.equal(source.includes("Assessment was committed, but workflow readiness is"), true);
});

test("signed physician orders stay queued degraded until downstream clinical sync completes", () => {
  const detail = buildPhysicianOrderClinicalSyncDetail({
    status: "Signed",
    queueStatus: "queued"
  });

  assert.ok(detail);
  assert.equal(detail.readinessStage, "queued_degraded");
  assert.equal(detail.actionNeeded, true);
  assert.match(detail.message ?? "", /not treat this order as operationally ready yet/i);
});

test("signed physician orders escalate to follow-up required when the retry queue carries a failure", () => {
  const detail = buildPhysicianOrderClinicalSyncDetail({
    status: "Signed",
    queueStatus: "queued",
    lastFailedStep: "mhp_mcc",
    lastError: "profile sync failed",
    nextRetryAt: "2026-04-09T10:00:00.000Z"
  });

  assert.ok(detail);
  assert.equal(detail.readinessStage, "follow_up_required");
  assert.equal(detail.actionNeeded, true);
  assert.match(detail.message ?? "", /MHP\/MCC sync failed/i);
});

test("public POF signing UI surfaces readiness instead of implying fully live downstream state", () => {
  const source = readWorkspaceFile("components/physician-orders/pof-public-sign-form.tsx");

  assert.equal(source.includes("Signature Recorded - ${submittedOutcome.readinessLabel}"), true);
  assert.equal(source.includes("Downstream status:"), true);
  assert.equal(source.includes("actionNeededMessage ??"), true);
});
