import type { Buffer } from "node:buffer";

import type { EnrollmentPacketIntakePayload } from "@/lib/services/enrollment-packet-intake-payload";
import type { EnrollmentPacketOperationalReadinessStatus } from "@/lib/services/enrollment-packet-readiness";
import type { SendWorkflowDeliveryStatus } from "@/lib/services/send-workflow-state";

export const STAFF_TRANSPORTATION_OPTIONS = ["None", "Door to Door", "Bus Stop", "Mixed"] as const;
export type StaffTransportationOption = (typeof STAFF_TRANSPORTATION_OPTIONS)[number];

export const ENROLLMENT_PACKET_STATUS_VALUES = [
  "draft",
  "sent",
  "in_progress",
  "expired",
  "completed",
  "voided"
] as const;

export type EnrollmentPacketStatus = (typeof ENROLLMENT_PACKET_STATUS_VALUES)[number];

export type EnrollmentPacketRequestSummary = {
  id: string;
  memberId: string;
  leadId: string | null;
  senderUserId: string;
  caregiverEmail: string;
  status: EnrollmentPacketStatus;
  deliveryStatus: SendWorkflowDeliveryStatus;
  deliveryError: string | null;
  lastDeliveryAttemptAt: string | null;
  deliveryFailedAt: string | null;
  tokenExpiresAt: string;
  createdAt: string;
  sentAt: string | null;
  openedAt: string | null;
  completedAt: string | null;
  lastFamilyActivityAt: string | null;
  updatedAt: string;
  voidedAt: string | null;
  voidedByUserId: string | null;
  voidReason: string | null;
};

export type CompletedEnrollmentPacketListItem = EnrollmentPacketRequestSummary & {
  memberName: string;
  leadMemberName: string | null;
  senderName: string | null;
  mappingSyncStatus: "not_started" | "pending" | "completed" | "failed";
  operationalReadinessStatus: EnrollmentPacketOperationalReadinessStatus;
  operationallyReady: boolean;
  mappingSyncError: string | null;
};

export type CompletedEnrollmentPacketFilters = {
  limit?: number;
  status?: "completed" | "filed" | "all";
  operationalReadiness?: EnrollmentPacketOperationalReadinessStatus | "all";
  fromDate?: string | null;
  toDate?: string | null;
  search?: string | null;
};

export type EnrollmentPacketRequestRow = {
  id: string;
  member_id: string;
  lead_id: string | null;
  sender_user_id: string;
  caregiver_email: string;
  status: string;
  delivery_status: string | null;
  last_delivery_attempt_at: string | null;
  delivery_failed_at: string | null;
  delivery_error: string | null;
  token: string;
  last_consumed_submission_token_hash: string | null;
  token_expires_at: string;
  created_at: string;
  sent_at: string | null;
  opened_at: string | null;
  completed_at: string | null;
  last_family_activity_at: string | null;
  voided_at: string | null;
  voided_by_user_id: string | null;
  void_reason: string | null;
  updated_at: string;
  mapping_sync_status: string | null;
  mapping_sync_error: string | null;
  mapping_sync_attempted_at: string | null;
  latest_mapping_run_id: string | null;
};

export type EnrollmentPacketFieldsRow = {
  id: string;
  packet_id: string;
  requested_days: string[] | null;
  transportation: string | null;
  community_fee: number | null;
  daily_rate: number | null;
  pricing_community_fee_id: string | null;
  pricing_daily_rate_id: string | null;
  pricing_snapshot: Record<string, unknown> | null;
  caregiver_name: string | null;
  caregiver_phone: string | null;
  caregiver_email: string | null;
  caregiver_address_line1: string | null;
  caregiver_address_line2: string | null;
  caregiver_city: string | null;
  caregiver_state: string | null;
  caregiver_zip: string | null;
  secondary_contact_name: string | null;
  secondary_contact_phone: string | null;
  secondary_contact_email: string | null;
  secondary_contact_relationship: string | null;
  notes: string | null;
  intake_payload: Record<string, unknown> | null;
};

export type MemberRow = {
  id: string;
  display_name: string;
  enrollment_date: string | null;
};

export type LeadRow = {
  id: string;
  stage: string | null;
  status: string | null;
  member_name: string | null;
  member_dob: string | null;
  member_start_date: string | null;
  referral_name: string | null;
  caregiver_email: string | null;
  caregiver_name: string | null;
  caregiver_relationship: string | null;
  caregiver_phone: string | null;
};

export type SenderProfileRow = {
  user_id: string;
  signature_name: string;
  signature_blob: string;
  created_at: string;
  updated_at: string;
};

export type PacketFileUpload = {
  fileName: string;
  contentType: string;
  bytes: Buffer;
  category:
    | "insurance"
    | "poa"
    | "supporting"
    | "medicare_card"
    | "private_insurance"
    | "supplemental_insurance"
    | "poa_guardianship"
    | "dnr_dni_advance_directive"
    | "signed_membership_agreement"
    | "signed_exhibit_a_payment_authorization";
};

export type EnrollmentPacketUploadCategory = PacketFileUpload["category"] | "completed_packet" | "signature_artifact";

export type EnrollmentPacketTokenMatch = {
  request: EnrollmentPacketRequestRow;
  tokenMatch: "active" | "consumed";
};

export type FinalizedEnrollmentPacketSubmissionRpcRow = {
  packet_id: string;
  status: string;
  mapping_sync_status: string;
  was_already_filed: boolean;
};

export type EnrollmentPacketAuditEvent = {
  id: string;
  packetId: string;
  eventType: string;
  actorName?: string | null;
  actorUserId: string | null;
  actorEmail: string | null;
  timestamp: string;
  metadata: Record<string, unknown>;
};

export type OperationalEnrollmentPacketListItem = EnrollmentPacketRequestSummary & {
  memberName: string;
  leadMemberName: string | null;
  senderName: string | null;
  mappingSyncStatus: "not_started" | "pending" | "completed" | "failed";
  operationalReadinessStatus: EnrollmentPacketOperationalReadinessStatus;
  operationallyReady: boolean;
  mappingSyncError: string | null;
};

export type OperationalEnrollmentPacketFilters = {
  limit?: number;
  status?: EnrollmentPacketStatus | "active" | "all";
  leadId?: string | null;
  search?: string | null;
  includeCompleted?: boolean;
};

export type PublicEnrollmentPacketContext =
  | { state: "invalid" }
  | { state: "expired" }
  | { state: "voided" }
  | {
      state: "completed";
      request: EnrollmentPacketRequestSummary;
      mappingSyncStatus: "not_started" | "pending" | "completed" | "failed";
      operationalReadinessStatus: EnrollmentPacketOperationalReadinessStatus;
      actionNeeded: boolean;
      actionNeededMessage: string | null;
    }
  | {
      state: "ready";
      request: EnrollmentPacketRequestSummary;
      fields: {
        requestedDays: string[];
        transportation: string | null;
        communityFee: number;
        dailyRate: number;
        caregiverName: string | null;
        caregiverPhone: string | null;
        caregiverEmail: string | null;
        caregiverAddressLine1: string | null;
        caregiverAddressLine2: string | null;
        caregiverCity: string | null;
        caregiverState: string | null;
        caregiverZip: string | null;
        secondaryContactName: string | null;
        secondaryContactPhone: string | null;
        secondaryContactEmail: string | null;
        secondaryContactRelationship: string | null;
        notes: string | null;
        intakePayload: EnrollmentPacketIntakePayload;
      };
      memberName: string;
    };
