"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getCurrentProfile } from "@/lib/auth";
import {
  ActiveEnrollmentPacketConflictError,
  sendEnrollmentPacketRequest,
  upsertEnrollmentPacketSenderSignatureProfile
} from "@/lib/services/enrollment-packets-sender";
import {
  replaceEnrollmentPacketRequest,
  resendEnrollmentPacketRequest,
  voidEnrollmentPacketRequest
} from "@/lib/services/enrollment-packets-staff";
import { WorkflowDeliveryError } from "@/lib/services/send-workflow-state";

import {
  optionalString,
  requireSalesRoles,
  resolveSalesLeadId,
  revalidateSalesLeadViews
} from "@/app/sales-action-helpers";

const enrollmentPacketSendSchema = z.object({
  leadId: z.string().uuid(),
  caregiverEmail: optionalString,
  requestedStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  requestedDays: z.array(z.string().min(1)).min(1),
  transportation: z.enum(["None", "Door to Door", "Bus Stop", "Mixed"]),
  communityFee: z.number().finite().nonnegative().optional().nullable(),
  dailyRate: z.number().finite().nonnegative().optional().nullable(),
  totalInitialEnrollmentAmount: z.number().finite().nonnegative().optional().nullable(),
  optionalMessage: optionalString
});

function revalidateEnrollmentPacketRoutes(input: {
  memberId: string;
  leadId?: string | null;
  packetId?: string | null;
}) {
  revalidateSalesLeadViews(input.leadId ?? undefined);
  revalidatePath("/sales/pipeline/enrollment-packets");
  revalidatePath("/sales/new-entries/send-enrollment-packet");
  revalidatePath("/operations/member-command-center");
  revalidatePath(`/operations/member-command-center/${input.memberId}`);
  revalidatePath(`/members/${input.memberId}`);
  if (input.packetId) {
    revalidatePath(`/sales/pipeline/enrollment-packets/${input.packetId}`);
  }
}

export async function sendEnrollmentPacketAction(raw: z.infer<typeof enrollmentPacketSendSchema>) {
  await requireSalesRoles();
  const payload = enrollmentPacketSendSchema.safeParse(raw);
  if (!payload.success) {
    return { ok: false, error: "Invalid enrollment packet request." } as const;
  }

  try {
    const canonicalLead = await resolveSalesLeadId(payload.data.leadId, "sendEnrollmentPacketAction");
    const profile = await getCurrentProfile();
    const sent = await sendEnrollmentPacketRequest({
      leadId: canonicalLead.leadId,
      senderUserId: profile.id,
      senderFullName: profile.full_name,
      caregiverEmail: payload.data.caregiverEmail || null,
      requestedStartDate: payload.data.requestedStartDate,
      requestedDays: payload.data.requestedDays.map((day) => day.trim()).filter(Boolean),
      transportation: payload.data.transportation,
      communityFeeOverride: payload.data.communityFee ?? null,
      dailyRateOverride: payload.data.dailyRate ?? null,
      totalInitialEnrollmentAmountOverride: payload.data.totalInitialEnrollmentAmount ?? null,
      optionalMessage: payload.data.optionalMessage || null
    });

    revalidateEnrollmentPacketRoutes({
      memberId: sent.request.memberId,
      leadId: sent.request.leadId,
      packetId: sent.request.id
    });

    return {
      ok: true,
      requestId: sent.request.id,
      requestUrl: sent.requestUrl,
      actionNeeded: sent.actionNeeded,
      actionNeededMessage: sent.actionNeededMessage
    } as const;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to send enrollment packet.";
    const code = typeof error === "object" && error !== null ? String((error as { code?: string }).code ?? "") : "";
    if (code === "signature_setup_required") {
      return {
        ok: false,
        error: message,
        code,
        redirectTo: "/sales/new-entries/enrollment-signature-setup"
      } as const;
    }
    if (error instanceof ActiveEnrollmentPacketConflictError) {
      return {
        ok: false,
        error: message,
        code: error.code,
        activePacket: error.activePacket
      } as const;
    }
    if (error instanceof WorkflowDeliveryError) {
      return {
        ok: false,
        error: message,
        code: error.code,
        retryable: error.retryable,
        requestId: error.requestId,
        requestUrl: error.requestUrl,
        deliveryStatus: error.deliveryStatus
      } as const;
    }
    return { ok: false, error: message } as const;
  }
}

const packetActionSchema = z.object({
  packetId: z.string().uuid()
});

const voidEnrollmentPacketSchema = packetActionSchema.extend({
  reason: optionalString
});

export async function voidEnrollmentPacketAction(raw: z.infer<typeof voidEnrollmentPacketSchema>) {
  await requireSalesRoles();
  const payload = voidEnrollmentPacketSchema.safeParse(raw);
  if (!payload.success) {
    return { ok: false, error: "Invalid enrollment packet void request." } as const;
  }

  try {
    const profile = await getCurrentProfile();
    const request = await voidEnrollmentPacketRequest({
      packetId: payload.data.packetId,
      actorUserId: profile.id,
      reason: payload.data.reason || null
    });
    revalidateEnrollmentPacketRoutes({
      memberId: request.memberId,
      leadId: request.leadId,
      packetId: request.id
    });
    return {
      ok: true,
      request
    } as const;
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to void enrollment packet."
    } as const;
  }
}

export async function resendEnrollmentPacketAction(raw: z.infer<typeof packetActionSchema>) {
  await requireSalesRoles();
  const payload = packetActionSchema.safeParse(raw);
  if (!payload.success) {
    return { ok: false, error: "Invalid enrollment packet resend request." } as const;
  }

  try {
    const profile = await getCurrentProfile();
    const sent = await resendEnrollmentPacketRequest({
      packetId: payload.data.packetId,
      actorUserId: profile.id,
      actorFullName: profile.full_name
    });
    revalidateEnrollmentPacketRoutes({
      memberId: sent.request.memberId,
      leadId: sent.request.leadId,
      packetId: sent.request.id
    });
    return {
      ok: true,
      requestId: sent.request.id,
      requestUrl: sent.requestUrl,
      actionNeeded: sent.actionNeeded,
      actionNeededMessage: sent.actionNeededMessage
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
        deliveryStatus: error.deliveryStatus
      } as const;
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to resend enrollment packet."
    } as const;
  }
}

const replaceEnrollmentPacketSchema = enrollmentPacketSendSchema.extend({
  packetId: z.string().uuid(),
  voidReason: optionalString
});

export async function replaceEnrollmentPacketAction(raw: z.infer<typeof replaceEnrollmentPacketSchema>) {
  await requireSalesRoles();
  const payload = replaceEnrollmentPacketSchema.safeParse(raw);
  if (!payload.success) {
    return { ok: false, error: "Invalid enrollment packet replacement request." } as const;
  }

  try {
    const profile = await getCurrentProfile();
    const canonicalLead = await resolveSalesLeadId(payload.data.leadId, "replaceEnrollmentPacketAction");
    const sent = await replaceEnrollmentPacketRequest({
      packetId: payload.data.packetId,
      actorUserId: profile.id,
      actorFullName: profile.full_name,
      leadId: canonicalLead.leadId,
      caregiverEmail: payload.data.caregiverEmail || null,
      requestedStartDate: payload.data.requestedStartDate,
      requestedDays: payload.data.requestedDays.map((day) => day.trim()).filter(Boolean),
      transportation: payload.data.transportation,
      communityFeeOverride: payload.data.communityFee ?? null,
      dailyRateOverride: payload.data.dailyRate ?? null,
      totalInitialEnrollmentAmountOverride: payload.data.totalInitialEnrollmentAmount ?? null,
      optionalMessage: payload.data.optionalMessage || null,
      voidReason: payload.data.voidReason || null
    });
    revalidateEnrollmentPacketRoutes({
      memberId: sent.request.memberId,
      leadId: sent.request.leadId,
      packetId: sent.request.id
    });
    return {
      ok: true,
      requestId: sent.request.id,
      requestUrl: sent.requestUrl,
      actionNeeded: sent.actionNeeded,
      actionNeededMessage: sent.actionNeededMessage
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
        deliveryStatus: error.deliveryStatus
      } as const;
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to replace enrollment packet."
    } as const;
  }
}

const enrollmentSignatureSchema = z.object({
  signatureName: z.string().min(1),
  signatureImageDataUrl: z.string().min(1)
});

export async function saveEnrollmentPacketSenderSignatureProfileAction(raw: z.infer<typeof enrollmentSignatureSchema>) {
  await requireSalesRoles();
  const payload = enrollmentSignatureSchema.safeParse(raw);
  if (!payload.success) {
    return { ok: false, error: "Invalid signature setup input." } as const;
  }
  try {
    const profile = await getCurrentProfile();
    const saved = await upsertEnrollmentPacketSenderSignatureProfile({
      userId: profile.id,
      signatureName: payload.data.signatureName,
      signatureImageDataUrl: payload.data.signatureImageDataUrl
    });
    revalidatePath("/sales/new-entries/enrollment-signature-setup");
    return {
      ok: true,
      signatureName: saved.signature_name,
      updatedAt: saved.updated_at
    } as const;
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to save signature setup."
    } as const;
  }
}
