import {
  normalizeEnrollmentPacketIntakePayload,
  normalizeEnrollmentPacketTextInput,
  type EnrollmentPacketIntakePayload
} from "@/lib/services/enrollment-packet-intake-payload";
import { ENROLLMENT_PACKET_UPLOAD_FIELDS } from "@/lib/services/enrollment-packet-public-uploads";

export const ENROLLMENT_PACKET_PUBLIC_ACTION_PAYLOAD_KEY = "payload";
export const ENROLLMENT_PACKET_PUBLIC_ACTION_TOKEN_KEY = "token";

type PublicEnrollmentPacketBaseActionPayloadInput = {
  token: string;
  intakePayload: EnrollmentPacketIntakePayload;
};

export type PublicEnrollmentPacketProgressActionPayload = {
  token: string;
  intakePayload: EnrollmentPacketIntakePayload;
};

export type PublicEnrollmentPacketSubmitActionPayload = PublicEnrollmentPacketProgressActionPayload & {
  caregiverTypedName: string;
  caregiverSignatureImageDataUrl: string;
  attested: boolean;
};

function clean(value: string | null | undefined) {
  return normalizeEnrollmentPacketTextInput(value) ?? "";
}

export function buildPublicEnrollmentPacketProgressActionPayload(
  input: PublicEnrollmentPacketBaseActionPayloadInput
): PublicEnrollmentPacketProgressActionPayload {
  return {
    token: clean(input.token),
    intakePayload: normalizeEnrollmentPacketIntakePayload(input.intakePayload)
  };
}

export function buildPublicEnrollmentPacketSubmitActionPayload(
  input: PublicEnrollmentPacketBaseActionPayloadInput & {
    caregiverTypedName: string;
    caregiverSignatureImageDataUrl: string;
    attested: boolean;
  }
): PublicEnrollmentPacketSubmitActionPayload {
  return {
    ...buildPublicEnrollmentPacketProgressActionPayload(input),
    caregiverTypedName: clean(input.caregiverTypedName),
    caregiverSignatureImageDataUrl: clean(input.caregiverSignatureImageDataUrl),
    attested: Boolean(input.attested)
  };
}

export function buildPublicEnrollmentPacketActionFormData(
  payload: PublicEnrollmentPacketProgressActionPayload | PublicEnrollmentPacketSubmitActionPayload,
  uploads?: Partial<Record<(typeof ENROLLMENT_PACKET_UPLOAD_FIELDS)[number]["key"], File[]>>
) {
  const formData = new FormData();
  formData.set(ENROLLMENT_PACKET_PUBLIC_ACTION_TOKEN_KEY, payload.token);
  formData.set(ENROLLMENT_PACKET_PUBLIC_ACTION_PAYLOAD_KEY, JSON.stringify(payload));

  if (!uploads) return formData;

  ENROLLMENT_PACKET_UPLOAD_FIELDS.forEach((uploadField) => {
    const files = uploads[uploadField.key] ?? [];
    files.forEach((file) => formData.append(uploadField.key, file));
  });

  return formData;
}
