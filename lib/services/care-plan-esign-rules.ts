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
  if (!nurseSignedAt) {
    return { allowed: false, reason: "Care plan must be signed by Nurse/Admin before caregiver send." } as const;
  }
  return { allowed: true } as const;
}
