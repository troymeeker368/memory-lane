import {
  getFounderWorkflowReadinessLabel,
  type FounderWorkflowReadinessStage
} from "@/lib/services/committed-workflow-state";

export type EnrollmentPacketMappingSyncStatus = "not_started" | "pending" | "completed" | "failed";
export type EnrollmentPacketCompletionFollowUpStatus =
  | "not_started"
  | "pending"
  | "completed"
  | "action_required";
export type EnrollmentPacketOperationalReadinessStatus =
  | "not_filed"
  | "filed_pending_mapping"
  | "mapping_failed"
  | "operationally_ready";

function normalizeEnrollmentPacketStatus(value: string | null | undefined) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "completed" || normalized === "filed") return "completed";
  return "not_filed";
}

export function toEnrollmentPacketMappingSyncStatus(
  value: string | null | undefined
): EnrollmentPacketMappingSyncStatus {
  if (value === "completed" || value === "failed" || value === "not_started") return value;
  return "pending";
}

export function toEnrollmentPacketCompletionFollowUpStatus(
  value: string | null | undefined
): EnrollmentPacketCompletionFollowUpStatus {
  if (value === "completed" || value === "action_required" || value === "not_started") return value;
  return "pending";
}

export function resolveEnrollmentPacketOperationalReadiness(input: {
  status: string | null | undefined;
  mappingSyncStatus: string | null | undefined;
}): EnrollmentPacketOperationalReadinessStatus {
  const packetStatus = normalizeEnrollmentPacketStatus(input.status);
  if (packetStatus === "not_filed") return "not_filed";

  const mappingSyncStatus = toEnrollmentPacketMappingSyncStatus(input.mappingSyncStatus);
  if (mappingSyncStatus === "completed") return "operationally_ready";
  if (mappingSyncStatus === "failed") return "mapping_failed";
  return "filed_pending_mapping";
}

export function isEnrollmentPacketOperationallyReady(input: {
  status: string | null | undefined;
  mappingSyncStatus: string | null | undefined;
}) {
  return resolveEnrollmentPacketOperationalReadiness(input) === "operationally_ready";
}

export function resolveEnrollmentPacketWorkflowReadinessStage(input: {
  status: string | null | undefined;
  mappingSyncStatus: string | null | undefined;
  completionFollowUpStatus?: string | null | undefined;
}) : FounderWorkflowReadinessStage {
  const completionFollowUpStatus = toEnrollmentPacketCompletionFollowUpStatus(input.completionFollowUpStatus);
  if (completionFollowUpStatus === "action_required") return "follow_up_required";

  const operationalReadinessStatus = resolveEnrollmentPacketOperationalReadiness(input);
  if (operationalReadinessStatus === "operationally_ready" && completionFollowUpStatus === "completed") return "ready";
  if (operationalReadinessStatus === "mapping_failed") return "follow_up_required";
  if (normalizeEnrollmentPacketStatus(input.status) === "completed") return "queued_degraded";
  return "committed";
}

export function getEnrollmentPacketWorkflowReadinessLabel(stage: FounderWorkflowReadinessStage) {
  return getFounderWorkflowReadinessLabel(stage);
}
