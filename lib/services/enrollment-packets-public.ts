import "server-only";

import type {
  getPublicCompletedEnrollmentPacketArtifact as getPublicCompletedEnrollmentPacketArtifactImpl,
  getPublicEnrollmentPacketContext as getPublicEnrollmentPacketContextImpl,
  recordPublicEnrollmentPacketGuardFailure as recordPublicEnrollmentPacketGuardFailureImpl,
  savePublicEnrollmentPacketProgress as savePublicEnrollmentPacketProgressImpl,
  submitPublicEnrollmentPacket as submitPublicEnrollmentPacketImpl
} from "@/lib/services/enrollment-packets-public-runtime";

type GetPublicCompletedEnrollmentPacketArtifactInput = Parameters<typeof getPublicCompletedEnrollmentPacketArtifactImpl>[0];
type GetPublicEnrollmentPacketContextInput = Parameters<typeof getPublicEnrollmentPacketContextImpl>;
type RecordPublicEnrollmentPacketGuardFailureInput = Parameters<typeof recordPublicEnrollmentPacketGuardFailureImpl>[0];
type SavePublicEnrollmentPacketProgressInput = Parameters<typeof savePublicEnrollmentPacketProgressImpl>[0];
type SubmitPublicEnrollmentPacketInput = Parameters<typeof submitPublicEnrollmentPacketImpl>[0];

export async function getPublicCompletedEnrollmentPacketArtifact(
  input: GetPublicCompletedEnrollmentPacketArtifactInput
) {
  const { getPublicCompletedEnrollmentPacketArtifact } = await import(
    "@/lib/services/enrollment-packets-public-runtime"
  );
  return getPublicCompletedEnrollmentPacketArtifact(input);
}

export async function getPublicEnrollmentPacketContext(...args: GetPublicEnrollmentPacketContextInput) {
  const { getPublicEnrollmentPacketContext } = await import("@/lib/services/enrollment-packets-public-runtime");
  return getPublicEnrollmentPacketContext(...args);
}

export async function savePublicEnrollmentPacketProgress(input: SavePublicEnrollmentPacketProgressInput) {
  const { savePublicEnrollmentPacketProgress } = await import("@/lib/services/enrollment-packets-public-runtime");
  return savePublicEnrollmentPacketProgress(input);
}

export async function recordPublicEnrollmentPacketGuardFailure(input: RecordPublicEnrollmentPacketGuardFailureInput) {
  const { recordPublicEnrollmentPacketGuardFailure } = await import("@/lib/services/enrollment-packets-public-runtime");
  return recordPublicEnrollmentPacketGuardFailure(input);
}

export async function submitPublicEnrollmentPacket(input: SubmitPublicEnrollmentPacketInput) {
  const { submitPublicEnrollmentPacket } = await import("@/lib/services/enrollment-packets-public-runtime");
  return submitPublicEnrollmentPacket(input);
}
