import {
  getFounderWorkflowReadinessLabel,
  type FounderWorkflowReadinessStage
} from "@/lib/services/committed-workflow-state";
import type { IntakePostSignFollowUpTaskType } from "@/lib/services/intake-post-sign-follow-up";
import { resolveIntakeDraftPofReadiness, type IntakeDraftPofReadinessStatus } from "@/lib/services/intake-draft-pof-readiness";

export type IntakePostSignReadinessStatus =
  | "not_signed"
  | "signed_pending_draft_pof"
  | "signed_pending_draft_pof_readback"
  | "draft_pof_failed"
  | "signed_pending_member_file_pdf"
  | "post_sign_ready";

export function resolveIntakePostSignReadiness(input: {
  signatureStatus: string | null | undefined;
  draftPofStatus: string | null | undefined;
  openFollowUpTaskTypes?: IntakePostSignFollowUpTaskType[];
}): IntakePostSignReadinessStatus {
  const draftPofReadiness = resolveIntakeDraftPofReadiness({
    signatureStatus: input.signatureStatus,
    draftPofStatus: input.draftPofStatus
  });

  if (draftPofReadiness === "not_signed") return "not_signed";
  if (draftPofReadiness === "signed_pending_draft_pof") return "signed_pending_draft_pof";
  if (draftPofReadiness === "draft_pof_failed") return "draft_pof_failed";

  const openFollowUpTaskTypes = new Set(input.openFollowUpTaskTypes ?? []);
  if (openFollowUpTaskTypes.has("draft_pof_creation")) {
    return "signed_pending_draft_pof_readback";
  }
  if (openFollowUpTaskTypes.has("member_file_pdf_persistence")) {
    return "signed_pending_member_file_pdf";
  }

  return "post_sign_ready";
}

export function resolveIntakePostSignWorkflowReadinessStage(input: {
  signatureStatus: string | null | undefined;
  draftPofStatus: string | null | undefined;
  openFollowUpTaskTypes?: IntakePostSignFollowUpTaskType[];
}): FounderWorkflowReadinessStage {
  const status = resolveIntakePostSignReadiness(input);
  if (status === "post_sign_ready") return "ready";
  if (status === "draft_pof_failed") return "follow_up_required";
  if (status === "not_signed") return "committed";
  return "queued_degraded";
}

export function getIntakePostSignReadinessLabel(status: IntakePostSignReadinessStatus) {
  const stage = resolveIntakePostSignWorkflowReadinessStage({
    signatureStatus: status === "not_signed" ? "unsigned" : "signed",
    draftPofStatus:
      status === "draft_pof_failed"
        ? "failed"
        : status === "post_sign_ready" ||
            status === "signed_pending_draft_pof_readback" ||
            status === "signed_pending_member_file_pdf"
          ? "created"
          : "pending",
    openFollowUpTaskTypes:
      status === "signed_pending_draft_pof_readback"
        ? ["draft_pof_creation"]
        : status === "signed_pending_member_file_pdf"
          ? ["member_file_pdf_persistence"]
          : []
  });

  if (status === "post_sign_ready") return `${getFounderWorkflowReadinessLabel(stage)} - Intake Follow-up Complete`;
  if (status === "signed_pending_draft_pof_readback") {
    return `${getFounderWorkflowReadinessLabel(stage)} - Draft POF Verification`;
  }
  if (status === "signed_pending_member_file_pdf") {
    return `${getFounderWorkflowReadinessLabel(stage)} - Member File PDF`;
  }
  if (status === "draft_pof_failed") return `${getFounderWorkflowReadinessLabel(stage)} - Draft POF Failed`;
  if (status === "signed_pending_draft_pof") return `${getFounderWorkflowReadinessLabel(stage)} - Draft POF Pending`;
  return getFounderWorkflowReadinessLabel(stage);
}

export function getIntakePostSignReadinessDetail(status: IntakePostSignReadinessStatus) {
  if (status === "signed_pending_draft_pof") {
    return "Intake signature is durable, but draft POF creation is still queued. Do not treat intake follow-up as ready yet.";
  }
  if (status === "signed_pending_draft_pof_readback") {
    return "Intake signature is durable and the draft POF was committed, but readback verification still needs follow-up before staff should treat the workflow as ready.";
  }
  if (status === "signed_pending_member_file_pdf") {
    return "Intake signature and draft POF are committed, but the branded assessment PDF still needs verified Member Files persistence before the workflow is ready.";
  }
  if (status === "draft_pof_failed") {
    return "Intake signature is durable, but draft POF creation failed and staff follow-up is required before the workflow is ready.";
  }
  return null;
}

export function isIntakePostSignReady(input: {
  signatureStatus: string | null | undefined;
  draftPofStatus: string | null | undefined;
  openFollowUpTaskTypes?: IntakePostSignFollowUpTaskType[];
}) {
  return resolveIntakePostSignReadiness(input) === "post_sign_ready";
}

export function mapDraftPofReadinessToPostSignReadiness(
  status: IntakeDraftPofReadinessStatus
): IntakePostSignReadinessStatus {
  if (status === "not_signed") return "not_signed";
  if (status === "signed_pending_draft_pof") return "signed_pending_draft_pof";
  if (status === "draft_pof_failed") return "draft_pof_failed";
  return "post_sign_ready";
}
