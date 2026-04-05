import "server-only";

import { z } from "zod";

import {
  ENROLLMENT_PACKET_PUBLIC_ACTION_PAYLOAD_KEY,
  ENROLLMENT_PACKET_PUBLIC_ACTION_TOKEN_KEY,
  type PublicEnrollmentPacketProgressActionPayload,
  type PublicEnrollmentPacketSubmitActionPayload
} from "@/lib/services/enrollment-packet-public-action-payload";
import {
  normalizeEnrollmentPacketIntakePayload,
  normalizeEnrollmentPacketTextInput
} from "@/lib/services/enrollment-packet-intake-payload";

const INVALID_PUBLIC_ENROLLMENT_PACKET_PAYLOAD_MESSAGE =
  "Enrollment packet answers are invalid. Refresh the form and try again.";

const intakePayloadSchema = z
  .record(z.string(), z.unknown())
  .transform((value) => normalizeEnrollmentPacketIntakePayload(value));

const requiredTextSchema = z
  .string()
  .transform((value) => normalizeEnrollmentPacketTextInput(value))
  .refine((value): value is string => Boolean(value), INVALID_PUBLIC_ENROLLMENT_PACKET_PAYLOAD_MESSAGE);

const progressPayloadSchema = z.object({
  intakePayload: intakePayloadSchema
});

const submitPayloadSchema = progressPayloadSchema.extend({
  caregiverTypedName: requiredTextSchema,
  caregiverSignatureImageDataUrl: requiredTextSchema,
  attested: z.boolean()
});

export class InvalidEnrollmentPacketActionPayloadError extends Error {
  constructor(message = INVALID_PUBLIC_ENROLLMENT_PACKET_PAYLOAD_MESSAGE) {
    super(message);
    this.name = "InvalidEnrollmentPacketActionPayloadError";
  }
}

function parseToken(formData: FormData) {
  const token = normalizeEnrollmentPacketTextInput(formData.get(ENROLLMENT_PACKET_PUBLIC_ACTION_TOKEN_KEY));
  if (!token) {
    throw new InvalidEnrollmentPacketActionPayloadError();
  }
  return token;
}

function parsePayloadJson(formData: FormData): Record<string, unknown> {
  const raw = normalizeEnrollmentPacketTextInput(formData.get(ENROLLMENT_PACKET_PUBLIC_ACTION_PAYLOAD_KEY));
  if (!raw) {
    throw new InvalidEnrollmentPacketActionPayloadError();
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown> | null;
    if (!parsed || Array.isArray(parsed)) {
      throw new InvalidEnrollmentPacketActionPayloadError();
    }
    return parsed;
  } catch {
    throw new InvalidEnrollmentPacketActionPayloadError();
  }
}

export function extractPublicEnrollmentPacketActionToken(formData: FormData) {
  try {
    return parseToken(formData);
  } catch {
    return "";
  }
}

function parseWithSchema<T>(schema: z.ZodSchema<T>, formData: FormData): T {
  const result = schema.safeParse(parsePayloadJson(formData));
  if (!result.success) {
    throw new InvalidEnrollmentPacketActionPayloadError();
  }
  return result.data;
}

export function parsePublicEnrollmentPacketProgressActionPayload(
  formData: FormData
): PublicEnrollmentPacketProgressActionPayload {
  return {
    token: parseToken(formData),
    ...(parseWithSchema(progressPayloadSchema, formData) as Omit<
      PublicEnrollmentPacketProgressActionPayload,
      "token"
    >)
  };
}

export function parsePublicEnrollmentPacketSubmitActionPayload(
  formData: FormData
): PublicEnrollmentPacketSubmitActionPayload {
  return {
    token: parseToken(formData),
    ...(parseWithSchema(submitPayloadSchema, formData) as Omit<
      PublicEnrollmentPacketSubmitActionPayload,
      "token"
    >)
  };
}
