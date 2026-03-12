"use server";

import { revalidatePath } from "next/cache";

import { requireRoles } from "@/lib/auth";
import {
  getSignedPofPdfUrlForMember,
  resendPofSignatureRequest,
  sendNewPofSignatureRequest,
  voidPofSignatureRequest
} from "@/lib/services/pof-esign";
import { getManagedUserSignoffLabel } from "@/lib/services/user-management";

function asString(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function asOptionalString(formData: FormData, key: string) {
  const value = asString(formData, key);
  return value.length > 0 ? value : null;
}

function revalidatePofRoutes(memberId: string, physicianOrderId?: string | null) {
  revalidatePath("/health");
  revalidatePath("/health/physician-orders");
  if (physicianOrderId) {
    revalidatePath(`/health/physician-orders/${physicianOrderId}`);
  }
  revalidatePath(`/operations/member-command-center/${memberId}`);
  revalidatePath(`/members/${memberId}`);
}

export async function sendPofSignatureRequestAction(formData: FormData) {
  try {
    const profile = await requireRoles(["admin", "nurse"]);
    const actorName = await getManagedUserSignoffLabel(profile.id, profile.full_name);
    const memberId = asString(formData, "memberId");
    const physicianOrderId = asString(formData, "physicianOrderId");
    if (!memberId || !physicianOrderId) {
      return { ok: false, error: "Member and POF are required." } as const;
    }

    await sendNewPofSignatureRequest({
      memberId,
      physicianOrderId,
      providerName: asString(formData, "providerName"),
      providerEmail: asString(formData, "providerEmail"),
      nurseName: asString(formData, "nurseName") || actorName,
      fromEmail: asString(formData, "fromEmail"),
      optionalMessage: asOptionalString(formData, "optionalMessage"),
      expiresOnDate: asString(formData, "expiresOnDate"),
      actor: {
        id: profile.id,
        fullName: actorName
      }
    });
    revalidatePofRoutes(memberId, physicianOrderId);
    return { ok: true } as const;
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to send POF signature request."
    } as const;
  }
}

export async function resendPofSignatureRequestAction(formData: FormData) {
  try {
    const profile = await requireRoles(["admin", "nurse"]);
    const actorName = await getManagedUserSignoffLabel(profile.id, profile.full_name);
    const requestId = asString(formData, "requestId");
    const memberId = asString(formData, "memberId");
    const physicianOrderId = asString(formData, "physicianOrderId");
    if (!requestId || !memberId || !physicianOrderId) {
      return { ok: false, error: "Request, member, and POF are required." } as const;
    }

    await resendPofSignatureRequest({
      requestId,
      memberId,
      providerName: asString(formData, "providerName"),
      providerEmail: asString(formData, "providerEmail"),
      nurseName: asString(formData, "nurseName") || actorName,
      fromEmail: asString(formData, "fromEmail"),
      optionalMessage: asOptionalString(formData, "optionalMessage"),
      expiresOnDate: asString(formData, "expiresOnDate"),
      actor: {
        id: profile.id,
        fullName: actorName
      }
    });
    revalidatePofRoutes(memberId, physicianOrderId);
    return { ok: true } as const;
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to resend POF signature request."
    } as const;
  }
}

export async function voidPofSignatureRequestAction(input: {
  requestId: string;
  memberId: string;
  physicianOrderId: string;
  reason?: string | null;
}) {
  try {
    const profile = await requireRoles(["admin", "nurse"]);
    const actorName = await getManagedUserSignoffLabel(profile.id, profile.full_name);
    const requestId = String(input.requestId ?? "").trim();
    const memberId = String(input.memberId ?? "").trim();
    const physicianOrderId = String(input.physicianOrderId ?? "").trim();
    if (!requestId || !memberId || !physicianOrderId) {
      return { ok: false, error: "Request, member, and POF are required." } as const;
    }

    await voidPofSignatureRequest({
      requestId,
      memberId,
      actor: {
        id: profile.id,
        fullName: actorName
      },
      reason: input.reason ?? null
    });
    revalidatePofRoutes(memberId, physicianOrderId);
    return { ok: true } as const;
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to void POF signature request."
    } as const;
  }
}

export async function getSignedPofDownloadUrlAction(input: { requestId: string; memberId: string }) {
  try {
    await requireRoles(["admin", "nurse", "manager"]);
    const requestId = String(input.requestId ?? "").trim();
    const memberId = String(input.memberId ?? "").trim();
    if (!requestId || !memberId) {
      return { ok: false, error: "Request and member are required." } as const;
    }
    const signedUrl = await getSignedPofPdfUrlForMember({ requestId, memberId });
    return { ok: true, signedUrl } as const;
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to fetch signed PDF URL."
    } as const;
  }
}

