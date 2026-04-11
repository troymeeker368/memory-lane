import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveEnrollmentPacketOperationalReadiness,
  resolveEnrollmentPacketWorkflowReadinessStage,
  toEnrollmentPacketMappingSyncStatus
} from "@/lib/services/enrollment-packet-readiness";
import { resolveIntakeDraftPofReadiness } from "@/lib/services/intake-draft-pof-readiness";
import {
  getIntakePostSignWorkflowReadinessLabel,
  getIntakePostSignWorkflowReadinessMeaning,
  resolveIntakePostSignReadiness,
  resolveIntakePostSignReadinessStage
} from "@/lib/services/intake-post-sign-readiness";
import { resolvePhysicianOrderClinicalSyncStatus } from "@/lib/services/physician-order-clinical-sync";

test("enrollment packet readiness distinguishes completed from operationally ready", () => {
  assert.equal(toEnrollmentPacketMappingSyncStatus("not_started"), "not_started");
  assert.equal(
    resolveEnrollmentPacketOperationalReadiness({
      status: "completed",
      mappingSyncStatus: "pending"
    }),
    "filed_pending_mapping"
  );
  assert.equal(
    resolveEnrollmentPacketOperationalReadiness({
      status: "completed",
      mappingSyncStatus: "failed"
    }),
    "mapping_failed"
  );
  assert.equal(
    resolveEnrollmentPacketOperationalReadiness({
      status: "completed",
      mappingSyncStatus: "completed"
    }),
    "operationally_ready"
  );
});

test("enrollment packet readiness keeps pending and failed mapping out of operationally ready state", () => {
  const pendingReadiness = resolveEnrollmentPacketOperationalReadiness({
    status: "completed",
    mappingSyncStatus: "pending"
  });
  const failedReadiness = resolveEnrollmentPacketOperationalReadiness({
    status: "completed",
    mappingSyncStatus: "failed"
  });

  assert.notEqual(pendingReadiness, "operationally_ready");
  assert.equal(pendingReadiness, "filed_pending_mapping");
  assert.notEqual(failedReadiness, "operationally_ready");
  assert.equal(failedReadiness, "mapping_failed");
});

test("enrollment packet workflow readiness requires follow-up completion before ready", () => {
  assert.equal(
    resolveEnrollmentPacketWorkflowReadinessStage({
      status: "completed",
      mappingSyncStatus: "completed",
      completionFollowUpStatus: "pending"
    }),
    "queued_degraded"
  );
  assert.equal(
    resolveEnrollmentPacketWorkflowReadinessStage({
      status: "completed",
      mappingSyncStatus: "completed",
      completionFollowUpStatus: "completed"
    }),
    "ready"
  );
});

test("intake readiness keeps signed and draft-pof readiness separate", () => {
  assert.equal(
    resolveIntakeDraftPofReadiness({
      signatureStatus: "unsigned",
      draftPofStatus: "created"
    }),
    "not_signed"
  );
  assert.equal(
    resolveIntakeDraftPofReadiness({
      signatureStatus: "signed",
      draftPofStatus: "pending"
    }),
    "signed_pending_draft_pof"
  );
  assert.equal(
    resolveIntakeDraftPofReadiness({
      signatureStatus: "signed",
      draftPofStatus: "failed"
    }),
    "draft_pof_failed"
  );
  assert.equal(
    resolveIntakeDraftPofReadiness({
      signatureStatus: "signed",
      draftPofStatus: "created"
    }),
    "draft_pof_ready"
  );
});

test("intake post-sign readiness requires member-file follow-up completion too", () => {
  assert.equal(
    resolveIntakePostSignReadiness({
      signatureStatus: "signed",
      draftPofStatus: "created",
      openFollowUpTaskTypes: ["draft_pof_creation"]
    }),
    "signed_pending_draft_pof_readback"
  );
  assert.equal(
    resolveIntakePostSignReadiness({
      signatureStatus: "signed",
      draftPofStatus: "created",
      openFollowUpTaskTypes: ["member_file_pdf_persistence"]
    }),
    "signed_pending_member_file_pdf"
  );
  assert.equal(
    resolveIntakePostSignReadiness({
      signatureStatus: "signed",
      draftPofStatus: "created",
      openFollowUpTaskTypes: []
    }),
    "post_sign_ready"
  );
  assert.equal(
    resolveIntakePostSignReadiness({
      signatureStatus: "signed",
      draftPofStatus: "failed",
      openFollowUpTaskTypes: ["member_file_pdf_persistence"]
    }),
    "draft_pof_failed"
  );
});

test("intake workflow readiness exposes shared founder-stage label and meaning", () => {
  assert.equal(getIntakePostSignWorkflowReadinessLabel("signed_pending_draft_pof_readback"), "Queued / Degraded");
  assert.equal(resolveIntakePostSignReadinessStage("draft_pof_failed"), "follow_up_required");
  assert.match(
    getIntakePostSignWorkflowReadinessMeaning("draft_pof_failed"),
    /staff intervention is still required/i
  );
});

test("physician order clinical sync distinguishes queued, failed, and synced post-sign states", () => {
  assert.equal(
    resolvePhysicianOrderClinicalSyncStatus({
      status: "Draft"
    }),
    "not_signed"
  );
  assert.equal(
    resolvePhysicianOrderClinicalSyncStatus({
      status: "Signed"
    }),
    "pending"
  );
  assert.equal(
    resolvePhysicianOrderClinicalSyncStatus({
      status: "Signed",
      queueStatus: "queued"
    }),
    "queued"
  );
  assert.equal(
    resolvePhysicianOrderClinicalSyncStatus({
      status: "Signed",
      queueStatus: "queued",
      lastError: "Sync failed"
    }),
    "failed"
  );
  assert.equal(
    resolvePhysicianOrderClinicalSyncStatus({
      status: "Signed",
      queueStatus: "completed"
    }),
    "synced"
  );
});
