import "server-only";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";

import { requireModuleAction } from "@/lib/auth";
import { normalizePhoneForStorage } from "@/lib/phone";
import { resolveCanonicalLeadRef } from "@/lib/services/canonical-person-ref";
import { applyLeadStageTransitionWithMemberUpsertSupabase } from "@/lib/services/sales-lead-conversion-supabase";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export const optionalString = z.string().optional().or(z.literal(""));

export async function requireSalesRoles() {
  await requireModuleAction("sales", "canEdit");
}

export function revalidateSalesLeadViews(leadId?: string) {
  const basePaths = [
    "/sales",
    "/sales/activities",
    "/sales/pipeline",
    "/sales/pipeline/leads-table",
    "/sales/pipeline/by-stage",
    "/sales/pipeline/follow-up-dashboard",
    "/sales/pipeline/inquiry",
    "/sales/pipeline/tour",
    "/sales/pipeline/eip",
    "/sales/pipeline/nurture",
    "/sales/pipeline/closed-won",
    "/sales/pipeline/closed-lost",
    "/sales/pipeline-table",
    "/sales/pipeline-by-stage",
    "/sales/summary"
  ];

  basePaths.forEach((path) => revalidatePath(path));

  if (leadId) {
    revalidatePath(`/sales/leads/${leadId}`);
    revalidatePath(`/sales/leads/${leadId}/edit`);
  }
}

export function normalizePhone(phone: string | undefined) {
  return normalizePhoneForStorage(phone) ?? "";
}

export async function resolveSalesLeadId(rawLeadId: string, actionLabel: string) {
  const leadId = rawLeadId.trim();
  const canonical = await resolveCanonicalLeadRef(
    {
      sourceType: "lead",
      leadId,
      selectedId: leadId
    },
    { actionLabel }
  );
  if (!canonical.leadId) {
    throw new Error(`${actionLabel} expected lead.id but canonical lead resolution returned empty leadId.`);
  }
  return {
    leadId: canonical.leadId,
    memberId: canonical.memberId
  };
}

export async function resolveRequestAppBaseUrl() {
  const headerMap = await headers();
  const origin = (headerMap.get("origin") ?? "").trim();
  if (origin) return origin;

  const forwardedHost = (headerMap.get("x-forwarded-host") ?? "").trim();
  const host = forwardedHost || (headerMap.get("host") ?? "").trim();
  if (!host) return null;
  const forwardedProto = (headerMap.get("x-forwarded-proto") ?? "").trim();
  const proto =
    forwardedProto.split(",")[0]?.trim() ||
    (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  return `${proto}://${host}`;
}

export function resolveLostReason(lostReason?: string, lostReasonOther?: string) {
  const reason = (lostReason ?? "").trim();
  if (!reason) return null;
  if (reason === "Other") {
    const other = (lostReasonOther ?? "").trim();
    return other || null;
  }
  return reason;
}

export async function applyClosedWonLeadConversion(input: {
  leadId: string;
  actorUserId: string;
  actorName: string;
  source: string;
  reason: string;
  memberDisplayName: string;
  memberDob?: string | null;
  memberEnrollmentDate: string;
  existingMemberId?: string | null;
  additionalLeadPatch?: Record<string, JsonValue>;
}) {
  return applyLeadStageTransitionWithMemberUpsertSupabase({
    leadId: input.leadId,
    requestedStage: "Closed - Won",
    requestedStatus: "Won",
    actorUserId: input.actorUserId,
    actorName: input.actorName,
    source: input.source,
    reason: input.reason,
    memberDisplayName: input.memberDisplayName,
    memberDob: input.memberDob ?? null,
    memberEnrollmentDate: input.memberEnrollmentDate,
    existingMemberId: input.existingMemberId ?? null,
    additionalLeadPatch: input.additionalLeadPatch ?? undefined
  });
}
