import type { CaregiverSignatureStatus } from "@/lib/services/care-plans";
import { toEasternDate } from "@/lib/timezone";

export const CARE_PLAN_CAREGIVER_SIGNATURE_EXPIRY_DAYS = 14;

export function getDefaultCaregiverSignatureExpiresOnDate(baseDate: string = toEasternDate()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(baseDate)) {
    throw new Error("Base date must be a valid YYYY-MM-DD value.");
  }

  const date = new Date(`${baseDate}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Base date is invalid.");
  }
  date.setUTCDate(date.getUTCDate() + CARE_PLAN_CAREGIVER_SIGNATURE_EXPIRY_DAYS);
  return date.toISOString().slice(0, 10);
}

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
  if (input.status === "ready_to_send" || input.status === "sent" || input.status === "viewed") return "ready" as const;
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
