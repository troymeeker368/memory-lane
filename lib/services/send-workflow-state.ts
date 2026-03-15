import "server-only";

import type { WorkflowEventSeverity } from "@/lib/services/workflow-observability";
import { recordImmediateSystemAlert } from "@/lib/services/workflow-observability";

export const SEND_WORKFLOW_DELIVERY_STATUS_VALUES = [
  "pending_preparation",
  "ready_to_send",
  "retry_pending",
  "send_failed",
  "sent"
] as const;

export type SendWorkflowDeliveryStatus = (typeof SEND_WORKFLOW_DELIVERY_STATUS_VALUES)[number];

export function toSendWorkflowDeliveryStatus(
  value: string | null | undefined,
  fallback: SendWorkflowDeliveryStatus = "pending_preparation"
) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (
    normalized === "pending_preparation" ||
    normalized === "ready_to_send" ||
    normalized === "retry_pending" ||
    normalized === "send_failed" ||
    normalized === "sent"
  ) {
    return normalized as SendWorkflowDeliveryStatus;
  }
  return fallback;
}

export class WorkflowDeliveryError extends Error {
  code: string;
  requestId: string;
  requestUrl: string;
  deliveryStatus: SendWorkflowDeliveryStatus;
  retryable: boolean;

  constructor(input: {
    message: string;
    code: string;
    requestId: string;
    requestUrl: string;
    deliveryStatus: SendWorkflowDeliveryStatus;
    retryable?: boolean;
  }) {
    super(input.message);
    this.name = "WorkflowDeliveryError";
    this.code = input.code;
    this.requestId = input.requestId;
    this.requestUrl = input.requestUrl;
    this.deliveryStatus = input.deliveryStatus;
    this.retryable = input.retryable ?? true;
  }
}

export function buildRetryableWorkflowDeliveryError(input: {
  requestId: string;
  requestUrl: string;
  reason: string;
  workflowLabel: string;
  retryLabel: string;
  deliveryStatus?: SendWorkflowDeliveryStatus;
  code?: string;
}) {
  return new WorkflowDeliveryError({
    message: `${input.workflowLabel} preparation succeeded, but delivery failed. ${input.reason} ${input.retryLabel}`.trim(),
    code: input.code ?? "delivery_send_failed",
    requestId: input.requestId,
    requestUrl: input.requestUrl,
    deliveryStatus: input.deliveryStatus ?? "send_failed",
    retryable: true
  });
}

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export async function throwDeliveryStateFinalizeFailure(input: {
  entityType: string;
  entityId: string;
  actorUserId?: string | null;
  severity?: WorkflowEventSeverity;
  alertKey: string;
  metadata?: Record<string, JsonValue> | null;
  message: string;
}): Promise<never> {
  await recordImmediateSystemAlert({
    entityType: input.entityType,
    entityId: input.entityId,
    actorUserId: input.actorUserId ?? null,
    severity: input.severity ?? "high",
    alertKey: input.alertKey,
    metadata: input.metadata ?? null
  });
  throw new Error(input.message);
}
