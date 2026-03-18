export type PhysicianOrderClinicalSyncStatus = "not_signed" | "pending" | "queued" | "failed" | "synced";
export type PhysicianOrderPostSignQueueStatus = "queued" | "completed";

export function resolvePhysicianOrderClinicalSyncStatus(input: {
  status: string | null | undefined;
  queueStatus?: PhysicianOrderPostSignQueueStatus | null;
  lastError?: string | null | undefined;
  lastFailedStep?: string | null | undefined;
}): PhysicianOrderClinicalSyncStatus {
  if (String(input.status ?? "").trim() !== "Signed") return "not_signed";
  if (input.queueStatus === "completed") return "synced";
  if (input.queueStatus === "queued") {
    if (String(input.lastError ?? "").trim() || String(input.lastFailedStep ?? "").trim()) {
      return "failed";
    }
    return "queued";
  }
  return "pending";
}
