"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getCurrentProfile } from "@/lib/auth";
import {
  sendEnrollmentPacketRequest,
  upsertEnrollmentPacketSenderSignatureProfile
} from "@/lib/services/enrollment-packets-sender";
import { WorkflowDeliveryError } from "@/lib/services/send-workflow-state";

import {
  optionalString,
  requireSalesRoles,
  resolveRequestAppBaseUrl,
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
      optionalMessage: payload.data.optionalMessage || null,
      appBaseUrl: await resolveRequestAppBaseUrl()
    });

    revalidateSalesLeadViews(sent.request.leadId || undefined);
    revalidatePath("/sales/new-entries/send-enrollment-packet");
    revalidatePath("/operations/member-command-center");
    revalidatePath(`/operations/member-command-center/${sent.request.memberId}`);
    revalidatePath(`/members/${sent.request.memberId}`);

    return {
      ok: true,
      requestId: sent.request.id,
      requestUrl: sent.requestUrl
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
