import "server-only";

import { resendEnrollmentPacketRequest as resendEnrollmentPacketRequestImpl, voidEnrollmentPacketRequest as voidEnrollmentPacketRequestImpl } from "@/lib/services/enrollment-packet-management";
import { sendEnrollmentPacketRequest } from "@/lib/services/enrollment-packets-sender";

type VoidEnrollmentPacketRequestInput = {
  packetId: string;
  actorUserId: string;
  reason?: string | null;
};

type ResendEnrollmentPacketRequestInput = {
  packetId: string;
  actorUserId: string;
  actorFullName: string;
  appBaseUrl?: string | null;
};

type ReplaceEnrollmentPacketRequestInput = {
  packetId: string;
  actorUserId: string;
  actorFullName: string;
  leadId: string;
  caregiverEmail?: string | null;
  requestedStartDate: string;
  requestedDays: string[];
  transportation: "None" | "Door to Door" | "Bus Stop" | "Mixed";
  communityFeeOverride?: number | null;
  dailyRateOverride?: number | null;
  totalInitialEnrollmentAmountOverride?: number | null;
  optionalMessage?: string | null;
  appBaseUrl?: string | null;
  voidReason?: string | null;
};

export async function voidEnrollmentPacketRequest(input: VoidEnrollmentPacketRequestInput) {
  return voidEnrollmentPacketRequestImpl({
    packetId: input.packetId,
    actorUserId: input.actorUserId,
    reason: input.reason ?? "Packet terms changed. Void and reissue required."
  });
}

export async function resendEnrollmentPacketRequest(input: ResendEnrollmentPacketRequestInput) {
  return resendEnrollmentPacketRequestImpl({
    packetId: input.packetId,
    senderUserId: input.actorUserId,
    senderFullName: input.actorFullName,
    appBaseUrl: input.appBaseUrl ?? null
  });
}

export async function replaceEnrollmentPacketRequest(input: ReplaceEnrollmentPacketRequestInput) {
  const voided = await voidEnrollmentPacketRequestImpl({
    packetId: input.packetId,
    actorUserId: input.actorUserId,
    reason: input.voidReason ?? "Packet terms changed. Reissuing corrected enrollment packet."
  });

  const sent = await sendEnrollmentPacketRequest({
    leadId: input.leadId,
    senderUserId: input.actorUserId,
    senderFullName: input.actorFullName,
    caregiverEmail: input.caregiverEmail ?? null,
    requestedStartDate: input.requestedStartDate,
    requestedDays: input.requestedDays,
    transportation: input.transportation,
    communityFeeOverride: input.communityFeeOverride ?? null,
    dailyRateOverride: input.dailyRateOverride ?? null,
    totalInitialEnrollmentAmountOverride: input.totalInitialEnrollmentAmountOverride ?? null,
    optionalMessage: input.optionalMessage ?? null,
    appBaseUrl: input.appBaseUrl ?? null
  });

  return {
    ...sent,
    voidedRequestId: voided.id
  };
}
