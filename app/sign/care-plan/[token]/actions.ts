"use server";

import { headers } from "next/headers";

async function loadPublicCarePlanSignatureService() {
  return import("@/lib/services/care-plan-esign-public");
}

function asString(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

export async function submitPublicCarePlanSignatureAction(formData: FormData) {
  try {
    const token = asString(formData, "token");
    const caregiverTypedName = asString(formData, "caregiverTypedName");
    const signatureImageDataUrl = asString(formData, "signatureImageDataUrl");
    const attested = asString(formData, "attested") === "true";
    const headersList = await headers();
    const forwardedFor = headersList.get("x-forwarded-for");
    const caregiverIp = forwardedFor ? forwardedFor.split(",")[0].trim() : null;
    const caregiverUserAgent = headersList.get("user-agent");
    const { submitPublicCarePlanSignature } = await loadPublicCarePlanSignatureService();

    const signed = await submitPublicCarePlanSignature({
      token,
      caregiverTypedName,
      signatureImageDataUrl,
      attested,
      caregiverIp,
      caregiverUserAgent
    });
    return {
      ok: true,
      finalMemberFileId: signed.finalMemberFileId,
      actionNeeded: signed.actionNeeded,
      actionNeededMessage: signed.actionNeededMessage
    } as const;
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to complete signature."
    } as const;
  }
}
