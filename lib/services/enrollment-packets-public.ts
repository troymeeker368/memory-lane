import "server-only";

import type {
  getPublicEnrollmentPacketContext as getPublicEnrollmentPacketContextImpl,
  savePublicEnrollmentPacketProgress as savePublicEnrollmentPacketProgressImpl,
  submitPublicEnrollmentPacket as submitPublicEnrollmentPacketImpl
} from "@/lib/services/enrollment-packets";

type GetPublicEnrollmentPacketContextInput = Parameters<typeof getPublicEnrollmentPacketContextImpl>;
type SavePublicEnrollmentPacketProgressInput = Parameters<typeof savePublicEnrollmentPacketProgressImpl>[0];
type SubmitPublicEnrollmentPacketInput = Parameters<typeof submitPublicEnrollmentPacketImpl>[0];

export async function getPublicEnrollmentPacketContext(...args: GetPublicEnrollmentPacketContextInput) {
  const { getPublicEnrollmentPacketContext } = await import("@/lib/services/enrollment-packets");
  return getPublicEnrollmentPacketContext(...args);
}

export async function savePublicEnrollmentPacketProgress(input: SavePublicEnrollmentPacketProgressInput) {
  const { savePublicEnrollmentPacketProgress } = await import("@/lib/services/enrollment-packets");
  return savePublicEnrollmentPacketProgress(input);
}

export async function submitPublicEnrollmentPacket(input: SubmitPublicEnrollmentPacketInput) {
  const { submitPublicEnrollmentPacket } = await import("@/lib/services/enrollment-packets");
  return submitPublicEnrollmentPacket(input);
}
