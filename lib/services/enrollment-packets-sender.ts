import "server-only";

import type {
  getEnrollmentPacketSenderSignatureProfile as getEnrollmentPacketSenderSignatureProfileImpl
} from "@/lib/services/enrollment-packet-mapping-runtime";
import type {
  sendEnrollmentPacketRequest as sendEnrollmentPacketRequestImpl,
  upsertEnrollmentPacketSenderSignatureProfile as upsertEnrollmentPacketSenderSignatureProfileImpl
} from "@/lib/services/enrollment-packets-send-runtime";

type GetEnrollmentPacketSenderSignatureProfileInput = Parameters<typeof getEnrollmentPacketSenderSignatureProfileImpl>[0];
type SendEnrollmentPacketRequestInput = Parameters<typeof sendEnrollmentPacketRequestImpl>[0];
type UpsertEnrollmentPacketSenderSignatureProfileInput =
  Parameters<typeof upsertEnrollmentPacketSenderSignatureProfileImpl>[0];

export async function getEnrollmentPacketSenderSignatureProfile(
  userId: GetEnrollmentPacketSenderSignatureProfileInput
) {
  const { getEnrollmentPacketSenderSignatureProfile } = await import("@/lib/services/enrollment-packet-mapping-runtime");
  return getEnrollmentPacketSenderSignatureProfile(userId);
}

export async function upsertEnrollmentPacketSenderSignatureProfile(
  input: UpsertEnrollmentPacketSenderSignatureProfileInput
) {
  const { upsertEnrollmentPacketSenderSignatureProfile } = await import("@/lib/services/enrollment-packets-send-runtime");
  return upsertEnrollmentPacketSenderSignatureProfile(input);
}

export async function sendEnrollmentPacketRequest(input: SendEnrollmentPacketRequestInput) {
  const { sendEnrollmentPacketRequest } = await import("@/lib/services/enrollment-packets-send-runtime");
  return sendEnrollmentPacketRequest(input);
}
