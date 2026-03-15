import "server-only";

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
