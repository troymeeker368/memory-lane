export type PhysicianOrderClinicalSyncStatus = "not_signed" | "pending" | "queued" | "failed" | "synced";
export type PhysicianOrderPostSignQueueStatus = "queued" | "processing" | "completed";
export type PhysicianOrderClinicalSyncDetail = {
  label: string;
  message: string | null;
  actionNeeded: boolean;
  attemptCount: number | null;
  nextRetryAt: string | null;
  lastFailedStep: string | null;
  lastError: string | null;
};

function formatFailedStep(step: string | null | undefined) {
  const normalized = String(step ?? "").trim().toLowerCase();
  if (normalized === "mhp_mcc") return "MHP/MCC sync";
  if (normalized === "mar_medications") return "MAR medication sync";
  if (normalized === "mar_schedules") return "MAR schedule sync";
  return "clinical sync";
}

export function resolvePhysicianOrderClinicalSyncStatus(input: {
  status: string | null | undefined;
  queueStatus?: PhysicianOrderPostSignQueueStatus | null;
  lastError?: string | null | undefined;
  lastFailedStep?: string | null | undefined;
}): PhysicianOrderClinicalSyncStatus {
  if (String(input.status ?? "").trim() !== "Signed") return "not_signed";
  if (input.queueStatus === "completed") return "synced";
  if (input.queueStatus === "queued" || input.queueStatus === "processing") {
    if (String(input.lastError ?? "").trim() || String(input.lastFailedStep ?? "").trim()) {
      return "failed";
    }
    return "queued";
  }
  return "pending";
}

export function buildPhysicianOrderClinicalSyncDetail(input: {
  status: string | null | undefined;
  queueStatus?: PhysicianOrderPostSignQueueStatus | null;
  lastError?: string | null | undefined;
  lastFailedStep?: string | null | undefined;
  attemptCount?: number | null | undefined;
  nextRetryAt?: string | null | undefined;
}): PhysicianOrderClinicalSyncDetail | null {
  const resolvedStatus = resolvePhysicianOrderClinicalSyncStatus(input);
  if (resolvedStatus === "not_signed") return null;
  if (resolvedStatus === "synced") {
    return {
      label: "Synced",
      message: "Clinical sync completed. MHP and MAR should be current.",
      actionNeeded: false,
      attemptCount: input.attemptCount ?? null,
      nextRetryAt: input.nextRetryAt ?? null,
      lastFailedStep: input.lastFailedStep ?? null,
      lastError: input.lastError ?? null
    };
  }

  if (resolvedStatus === "failed") {
    const failedStepLabel = formatFailedStep(input.lastFailedStep);
    const retryText = input.nextRetryAt ? " Retry is queued." : " Retry timing is not available yet.";
    return {
      label: "Retry queued after failure",
      message: `${failedStepLabel} failed after signing.${retryText}`,
      actionNeeded: true,
      attemptCount: input.attemptCount ?? null,
      nextRetryAt: input.nextRetryAt ?? null,
      lastFailedStep: input.lastFailedStep ?? null,
      lastError: input.lastError ?? null
    };
  }

  if (resolvedStatus === "queued") {
    return {
      label: "Queued",
      message: "Signed order is queued for downstream clinical sync.",
      actionNeeded: false,
      attemptCount: input.attemptCount ?? null,
      nextRetryAt: input.nextRetryAt ?? null,
      lastFailedStep: input.lastFailedStep ?? null,
      lastError: input.lastError ?? null
    };
  }

  return {
    label: "Pending clinical sync",
    message: "Signed order is waiting for downstream clinical sync to start.",
    actionNeeded: false,
    attemptCount: input.attemptCount ?? null,
    nextRetryAt: input.nextRetryAt ?? null,
    lastFailedStep: input.lastFailedStep ?? null,
    lastError: input.lastError ?? null
  };
}
