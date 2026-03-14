"use server";

import { Buffer } from "node:buffer";

import { headers } from "next/headers";

import { normalizeEnrollmentPacketIntakePayload } from "@/lib/services/enrollment-packet-intake-payload";
import {
  savePublicEnrollmentPacketProgress,
  submitPublicEnrollmentPacket
} from "@/lib/services/enrollment-packets";

function asString(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function parseIntakePayload(formData: FormData) {
  const raw = asString(formData, "intakePayload");
  if (!raw) return normalizeEnrollmentPacketIntakePayload({});
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return normalizeEnrollmentPacketIntakePayload(parsed);
  } catch {
    return normalizeEnrollmentPacketIntakePayload({});
  }
}

async function parseFileUploads(
  formData: FormData,
  key: string,
  category:
    | "insurance"
    | "poa"
    | "supporting"
    | "medicare_card"
    | "private_insurance"
    | "supplemental_insurance"
    | "poa_guardianship"
    | "dnr_dni_advance_directive"
) {
  const entries = formData.getAll(key);
  const uploads: Array<{
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
      | "dnr_dni_advance_directive";
  }> = [];
  for (const entry of entries) {
    if (!(entry instanceof File)) continue;
    if (entry.size <= 0) continue;
    const bytes = Buffer.from(await entry.arrayBuffer());
    uploads.push({
      fileName: entry.name || `${category}-${Date.now()}`,
      contentType: entry.type || "application/octet-stream",
      bytes,
      category
    });
  }
  return uploads;
}

export async function savePublicEnrollmentPacketProgressAction(formData: FormData) {
  try {
    const intakePayload = parseIntakePayload(formData);
    await savePublicEnrollmentPacketProgress({
      token: asString(formData, "token"),
      caregiverName: asString(formData, "caregiverName"),
      caregiverPhone: asString(formData, "caregiverPhone"),
      caregiverEmail: asString(formData, "caregiverEmail"),
      caregiverAddressLine1: asString(formData, "caregiverAddressLine1"),
      caregiverAddressLine2: asString(formData, "caregiverAddressLine2"),
      caregiverCity: asString(formData, "caregiverCity"),
      caregiverState: asString(formData, "caregiverState"),
      caregiverZip: asString(formData, "caregiverZip"),
      secondaryContactName: asString(formData, "secondaryContactName"),
      secondaryContactPhone: asString(formData, "secondaryContactPhone"),
      secondaryContactEmail: asString(formData, "secondaryContactEmail"),
      secondaryContactRelationship: asString(formData, "secondaryContactRelationship"),
      notes: asString(formData, "notes"),
      intakePayload
    });
    return { ok: true } as const;
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to save enrollment packet progress."
    } as const;
  }
}

export async function submitPublicEnrollmentPacketAction(formData: FormData) {
  try {
    const headerMap = await headers();
    const forwardedFor = headerMap.get("x-forwarded-for");
    const caregiverIp = forwardedFor ? forwardedFor.split(",")[0].trim() : null;
    const caregiverUserAgent = headerMap.get("user-agent");
    const intakePayload = parseIntakePayload(formData);

    const [
      insuranceUploads,
      poaUploads,
      supportingUploads,
      medicareCardUploads,
      privateInsuranceUploads,
      supplementalInsuranceUploads,
      poaGuardianshipUploads,
      advanceDirectiveUploads
    ] = await Promise.all([
      parseFileUploads(formData, "insuranceUploads", "insurance"),
      parseFileUploads(formData, "poaUploads", "poa"),
      parseFileUploads(formData, "supportingUploads", "supporting"),
      parseFileUploads(formData, "medicareCardUploads", "medicare_card"),
      parseFileUploads(formData, "privateInsuranceCardUploads", "private_insurance"),
      parseFileUploads(formData, "supplementalInsuranceCardUploads", "supplemental_insurance"),
      parseFileUploads(formData, "poaGuardianshipUploads", "poa_guardianship"),
      parseFileUploads(formData, "advanceDirectiveUploads", "dnr_dni_advance_directive")
    ]);

    await submitPublicEnrollmentPacket({
      token: asString(formData, "token"),
      caregiverTypedName: asString(formData, "caregiverTypedName"),
      caregiverSignatureImageDataUrl: asString(formData, "caregiverSignatureImageDataUrl"),
      attested: asString(formData, "attested") === "true",
      caregiverIp,
      caregiverUserAgent,
      caregiverName: asString(formData, "caregiverName"),
      caregiverPhone: asString(formData, "caregiverPhone"),
      caregiverEmail: asString(formData, "caregiverEmail"),
      caregiverAddressLine1: asString(formData, "caregiverAddressLine1"),
      caregiverAddressLine2: asString(formData, "caregiverAddressLine2"),
      caregiverCity: asString(formData, "caregiverCity"),
      caregiverState: asString(formData, "caregiverState"),
      caregiverZip: asString(formData, "caregiverZip"),
      secondaryContactName: asString(formData, "secondaryContactName"),
      secondaryContactPhone: asString(formData, "secondaryContactPhone"),
      secondaryContactEmail: asString(formData, "secondaryContactEmail"),
      secondaryContactRelationship: asString(formData, "secondaryContactRelationship"),
      notes: asString(formData, "notes"),
      intakePayload,
      uploads: [
        ...insuranceUploads,
        ...poaUploads,
        ...supportingUploads,
        ...medicareCardUploads,
        ...privateInsuranceUploads,
        ...supplementalInsuranceUploads,
        ...poaGuardianshipUploads,
        ...advanceDirectiveUploads
      ]
    });
    return { ok: true } as const;
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to complete enrollment packet."
    } as const;
  }
}
