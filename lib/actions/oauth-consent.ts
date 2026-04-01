"use server";

import { redirect } from "next/navigation";

import { submitOAuthConsentDecision, type OAuthConsentDecision } from "@/lib/services/oauth-consent";

export type OAuthConsentActionState = {
  error?: string;
};

function normalizeDecision(value: FormDataEntryValue | null): OAuthConsentDecision | null {
  return value === "approve" || value === "deny" ? value : null;
}

export async function submitOAuthConsentAction(
  _previousState: OAuthConsentActionState,
  formData: FormData
): Promise<OAuthConsentActionState> {
  const authorizationId = String(formData.get("authorizationId") ?? "").trim();
  const decision = normalizeDecision(formData.get("decision"));

  if (!authorizationId) {
    return {
      error: "Missing authorization request id."
    };
  }

  if (!decision) {
    return {
      error: "Choose whether to approve or deny this request."
    };
  }

  try {
    const redirectUrl = await submitOAuthConsentDecision({
      authorizationId,
      decision
    });
    redirect(redirectUrl);
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Unable to process the OAuth consent request."
    };
  }
}
