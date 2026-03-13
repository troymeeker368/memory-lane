"use server";

import { Buffer } from "node:buffer";

import { headers } from "next/headers";

import {
  savePublicEnrollmentPacketProgress,
  submitPublicEnrollmentPacket
} from "@/lib/services/enrollment-packets";

function asString(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

async function parseFileUploads(
  formData: FormData,
  key: string,
  category: "insurance" | "poa" | "supporting"
) {
  const entries = formData.getAll(key);
  const uploads: Array<{ fileName: string; contentType: string; bytes: Buffer; category: "insurance" | "poa" | "supporting" }> = [];
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
      notes: asString(formData, "notes")
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

    const [insuranceUploads, poaUploads, supportingUploads] = await Promise.all([
      parseFileUploads(formData, "insuranceUploads", "insurance"),
      parseFileUploads(formData, "poaUploads", "poa"),
      parseFileUploads(formData, "supportingUploads", "supporting")
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
      uploads: [...insuranceUploads, ...poaUploads, ...supportingUploads]
    });
    return { ok: true } as const;
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to complete enrollment packet."
    } as const;
  }
}

