import type { IntakePostSignFollowUpTaskType } from "@/lib/services/intake-post-sign-follow-up";
import { resolveIntakeDraftPofReadiness, type IntakeDraftPofReadinessStatus } from "@/lib/services/intake-draft-pof-readiness";

export type IntakePostSignReadinessStatus =
  | "not_signed"
  | "signed_pending_draft_pof"
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
  if (openFollowUpTaskTypes.has("member_file_pdf_persistence")) {
    return "signed_pending_member_file_pdf";
  }

  return "post_sign_ready";
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
