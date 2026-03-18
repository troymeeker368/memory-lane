export type IntakeDraftPofStatus = "pending" | "created" | "failed";
export type IntakeSignatureStatus = "unsigned" | "signed" | "voided";
export type IntakeDraftPofReadinessStatus =
  | "not_signed"
  | "signed_pending_draft_pof"
  | "draft_pof_failed"
  | "draft_pof_ready";

export function toIntakeDraftPofStatus(value: string | null | undefined): IntakeDraftPofStatus {
  if (value === "created" || value === "failed") return value;
  return "pending";
}

export function toIntakeSignatureStatus(value: string | null | undefined): IntakeSignatureStatus {
  if (value === "signed" || value === "voided") return value;
  return "unsigned";
}

export function resolveIntakeDraftPofReadiness(input: {
  signatureStatus: string | null | undefined;
  draftPofStatus: string | null | undefined;
}): IntakeDraftPofReadinessStatus {
  const signatureStatus = toIntakeSignatureStatus(input.signatureStatus);
  if (signatureStatus !== "signed") return "not_signed";

  const draftPofStatus = toIntakeDraftPofStatus(input.draftPofStatus);
  if (draftPofStatus === "created") return "draft_pof_ready";
  if (draftPofStatus === "failed") return "draft_pof_failed";
  return "signed_pending_draft_pof";
}

export function isIntakeDraftPofReady(input: {
  signatureStatus: string | null | undefined;
  draftPofStatus: string | null | undefined;
}) {
  return resolveIntakeDraftPofReadiness(input) === "draft_pof_ready";
}
