import type { CaregiverSignatureStatus } from "@/lib/services/care-plans";

function isExpired(expiresAt: string | null | undefined) {
  if (!expiresAt) return false;
  const expiryMs = Date.parse(expiresAt);
  if (Number.isNaN(expiryMs)) return false;
  return Date.now() > expiryMs;
}

export function resolvePublicCaregiverLinkState(input: {
  status: CaregiverSignatureStatus;
  expiresAt: string | null;
}) {
  if (input.status === "signed") return "completed" as const;
  if (input.status === "expired" || isExpired(input.expiresAt)) return "expired" as const;
  if (input.status === "sent" || input.status === "viewed") return "ready" as const;
  return "invalid" as const;
}

export function canSendCaregiverSignatureByNurseSignedAt(nurseSignedAt: string | null) {
  return canSendCaregiverSignatureByNurseSignatureState({
    nurseSignatureStatus: nurseSignedAt ? "signed" : "unsigned",
    nurseSignedAt
  });
}

export function canSendCaregiverSignatureByNurseSignatureState(input: {
  nurseSignatureStatus: string | null | undefined;
  nurseSignedAt: string | null;
}) {
  if (input.nurseSignatureStatus !== "signed" || !input.nurseSignedAt) {
    return { allowed: false, reason: "Care plan must be signed by Nurse/Admin before caregiver send." } as const;
  }
  return { allowed: true } as const;
}

export function getCaregiverSignatureStatusLabel(status: CaregiverSignatureStatus) {
  switch (status) {
    case "not_requested":
      return "Nurse/Admin signature required";
    case "ready_to_send":
      return "Nurse/Admin signed - ready to send";
    case "send_failed":
      return "Email delivery failed";
    case "sent":
      return "Email sent - awaiting responsible party";
    case "viewed":
      return "Opened by responsible party - awaiting signature";
    case "signed":
      return "Responsible party signed - completed";
    case "expired":
      return "Signature request expired";
    default:
      return status;
  }
}

export function hasCanonicalNurseSignature(input: {
  nurseSignatureStatus: string | null | undefined;
  nurseSignedByUserId: string | null;
  nurseSignedAt: string | null;
}) {
  return input.nurseSignatureStatus === "signed" && Boolean(input.nurseSignedByUserId) && Boolean(input.nurseSignedAt);
}
