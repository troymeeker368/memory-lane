import type { SendWorkflowDeliveryStatus } from "@/lib/services/send-workflow-state";

export const POF_REQUEST_STATUS_VALUES = ["draft", "sent", "opened", "signed", "declined", "expired"] as const;
export type PofRequestStatus = (typeof POF_REQUEST_STATUS_VALUES)[number];

export type PofRequestSummary = {
  id: string;
  physicianOrderId: string;
  memberId: string;
  providerName: string;
  providerEmail: string;
  nurseName: string;
  fromEmail: string;
  sentByUserId: string;
  status: PofRequestStatus;
  deliveryStatus: SendWorkflowDeliveryStatus;
  deliveryError: string | null;
  lastDeliveryAttemptAt: string | null;
  deliveryFailedAt: string | null;
  optionalMessage: string | null;
  sentAt: string | null;
  openedAt: string | null;
  signedAt: string | null;
  expiresAt: string;
  signatureRequestUrl: string;
  unsignedPdfUrl: string | null;
  signedPdfUrl: string | null;
  memberFileId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PofDocumentEvent = {
  id: string;
  documentId: string;
  memberId: string;
  physicianOrderId: string | null;
  eventType: "created" | "sent" | "send_failed" | "opened" | "signed" | "declined" | "expired" | "resent";
  actorType: "user" | "provider" | "system";
  actorUserId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  actorIp: string | null;
  actorUserAgent: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};
