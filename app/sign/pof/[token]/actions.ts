"use server";

import { headers } from "next/headers";

async function loadPublicPofSignatureService() {
  return import("@/lib/services/pof-esign");
}

function asString(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

export async function submitPublicPofSignatureAction(formData: FormData) {
  try {
    const token = asString(formData, "token");
    const providerTypedName = asString(formData, "providerTypedName");
    const signatureImageDataUrl = asString(formData, "signatureImageDataUrl");
    const attested = asString(formData, "attested") === "true";
    const headersList = await headers();
    const forwardedFor = headersList.get("x-forwarded-for");
    const providerIp = forwardedFor ? forwardedFor.split(",")[0].trim() : null;
    const providerUserAgent = headersList.get("user-agent");
    const { submitPublicPofSignature } = await loadPublicPofSignatureService();

    const signed = await submitPublicPofSignature({
      token,
      providerTypedName,
      signatureImageDataUrl,
      attested,
      providerIp,
      providerUserAgent
    });
    return { ok: true, signedPdfUrl: signed.signedPdfUrl } as const;
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to complete signature."
    } as const;
  }
}
