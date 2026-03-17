"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { requireRoles } from "@/lib/auth";
import {
  getPofRequestSummaryById,
  getSignedPofPdfUrlForMember,
  listPofRequestsByPhysicianOrderIds,
  resendPofSignatureRequest,
  sendNewPofSignatureRequest,
  voidPofSignatureRequest
} from "@/lib/services/pof-esign";
import { WorkflowDeliveryError } from "@/lib/services/send-workflow-state";
import { getManagedUserSignoffLabel } from "@/lib/services/user-management";

function asString(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function asOptionalString(formData: FormData, key: string) {
  const value = asString(formData, key);
  return value.length > 0 ? value : null;
}

function clean(value: string | null | undefined) {
  const normalized = (value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

async function resolveRequestAppBaseUrl() {
  const headerMap = await headers();
  const origin = clean(headerMap.get("origin"));
  if (origin) return origin;

  const forwardedHost = clean(headerMap.get("x-forwarded-host"));
  const host = forwardedHost ?? clean(headerMap.get("host"));
  if (!host) return null;
  const forwardedProto = clean(headerMap.get("x-forwarded-proto"));
  const proto =
    forwardedProto?.split(",")[0]?.trim() ??
    (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  return `${proto}://${host}`;
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

function logPofActionDiagnostics(
  action: "send" | "resend",
  input: {
    memberId?: string;
    physicianOrderId?: string;
    requestId?: string;
    providerEmail?: string;
    optionalMessage?: string | null;
  }
) {
  console.info(`[POF action:${action}] request received`, {
    hasMemberId: Boolean(clean(input.memberId)),
    hasPhysicianOrderId: Boolean(clean(input.physicianOrderId)),
    hasRequestId: Boolean(clean(input.requestId)),
    hasProviderEmail: Boolean(clean(input.providerEmail)),
    hasOptionalMessage: Boolean(clean(input.optionalMessage))
  });
}

async function getLatestPofRequestForOrder(memberId: string, physicianOrderId: string) {
  const requests = await listPofRequestsByPhysicianOrderIds(memberId, [physicianOrderId]);
  return requests[0] ?? null;
}

export async function sendPofSignatureRequestAction(formData: FormData) {
  const memberId = asString(formData, "memberId");
  const physicianOrderId = asString(formData, "physicianOrderId");
  try {
    const profile = await requireRoles(["admin", "nurse", "manager"]);
    const actorName = await getManagedUserSignoffLabel(profile.id, profile.full_name);
    logPofActionDiagnostics("send", {
      memberId,
      physicianOrderId,
      providerEmail: asString(formData, "providerEmail"),
      optionalMessage: asOptionalString(formData, "optionalMessage")
    });
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
      appBaseUrl: await resolveRequestAppBaseUrl(),
      optionalMessage: asOptionalString(formData, "optionalMessage"),
      expiresOnDate: asString(formData, "expiresOnDate"),
      actor: {
        id: profile.id,
        fullName: actorName
      }
    });
    revalidatePofRoutes(memberId, physicianOrderId);
    return {
      ok: true,
      request: await getLatestPofRequestForOrder(memberId, physicianOrderId)
    } as const;
  } catch (error) {
    if (error instanceof WorkflowDeliveryError) {
      return {
        ok: false,
        error: error.message,
        code: error.code,
        retryable: error.retryable,
        requestId: error.requestId,
        requestUrl: error.requestUrl,
        deliveryStatus: error.deliveryStatus,
        request: error.requestId ? await getPofRequestSummaryById(error.requestId, memberId) : null
      } as const;
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to send POF signature request."
    } as const;
  }
}

export async function resendPofSignatureRequestAction(formData: FormData) {
  const requestId = asString(formData, "requestId");
  const memberId = asString(formData, "memberId");
  const physicianOrderId = asString(formData, "physicianOrderId");
  try {
    const profile = await requireRoles(["admin", "nurse", "manager"]);
    const actorName = await getManagedUserSignoffLabel(profile.id, profile.full_name);
    logPofActionDiagnostics("resend", {
      requestId,
      memberId,
      physicianOrderId,
      providerEmail: asString(formData, "providerEmail"),
      optionalMessage: asOptionalString(formData, "optionalMessage")
    });
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
      appBaseUrl: await resolveRequestAppBaseUrl(),
      optionalMessage: asOptionalString(formData, "optionalMessage"),
      expiresOnDate: asString(formData, "expiresOnDate"),
      actor: {
        id: profile.id,
        fullName: actorName
      }
    });
    revalidatePofRoutes(memberId, physicianOrderId);
    return {
      ok: true,
      request: await getPofRequestSummaryById(requestId, memberId)
    } as const;
  } catch (error) {
    if (error instanceof WorkflowDeliveryError) {
      return {
        ok: false,
        error: error.message,
        code: error.code,
        retryable: error.retryable,
        requestId: error.requestId,
        requestUrl: error.requestUrl,
        deliveryStatus: error.deliveryStatus,
        request: error.requestId ? await getPofRequestSummaryById(error.requestId, memberId) : null
      } as const;
    }
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
    const profile = await requireRoles(["admin", "nurse", "manager"]);
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
    return {
      ok: true,
      request: await getPofRequestSummaryById(requestId, memberId)
    } as const;
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
