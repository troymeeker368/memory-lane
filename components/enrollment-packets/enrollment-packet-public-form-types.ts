import { ENROLLMENT_PACKET_UPLOAD_FIELDS } from "@/lib/services/enrollment-packet-public-uploads";
import type { EnrollmentPacketIntakePayload } from "@/lib/services/enrollment-packet-intake-payload";

export type PublicEnrollmentPacketFields = {
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

export type UploadKey = (typeof ENROLLMENT_PACKET_UPLOAD_FIELDS)[number]["key"];
export type UploadState = Record<UploadKey, File[]>;

export type EnrollmentPacketCompletionState = {
  isComplete: boolean;
  missingItems: string[];
};
