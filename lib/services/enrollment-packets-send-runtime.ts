import "server-only";

import { isEnrollmentPacketEligibleLeadState } from "@/lib/canonical";
import {
  ensureCanonicalMemberForLead,
  resolveCanonicalLeadRef,
  resolveCanonicalMemberId
} from "@/lib/services/canonical-person-ref";
import {
  normalizeEnrollmentPacketIntakePayload,
  type EnrollmentPacketIntakePayload
} from "@/lib/services/enrollment-packet-intake-payload";
import {
  buildAppBaseUrl,
  clean,
  cleanEmail,
  generateSigningToken,
  hashToken,
  isActiveEnrollmentPacketUniqueViolation,
  isEmail,
  normalizeStaffTransportation,
  safeNumber,
  splitMemberName,
  toStatus,
  toSummary
} from "@/lib/services/enrollment-packet-core";
import {
  getEnrollmentPacketSenderSignatureProfile,
  getLeadById,
  getMemberById,
  loadRequestById,
  recordEnrollmentPacketActionRequired,
  syncEnrollmentPacketLeadActivityOrQueue
} from "@/lib/services/enrollment-packet-mapping-runtime";
import {
  calculateInitialEnrollmentAmount,
  normalizeEnrollmentDateOnly
} from "@/lib/services/enrollment-packet-proration";
import { markEnrollmentPacketDeliveryState } from "@/lib/services/enrollment-packet-delivery-runtime";
import {
  isReusableDraftEnrollmentPacket,
  listActivePacketRows,
  listActivePacketRowsForLead
} from "@/lib/services/enrollment-packets-listing";
import {
  type EnrollmentPacketRequestRow,
  type SenderProfileRow,
  type StaffTransportationOption
} from "@/lib/services/enrollment-packet-types";
import { recordWorkflowMilestone } from "@/lib/services/lifecycle-milestones";
import { resolveEnrollmentPricingForRequestedDays } from "@/lib/services/enrollment-pricing";
import { parseDataUrlPayload } from "@/lib/services/member-files";
import {
  maybeRecordRepeatedFailureAlert,
  recordWorkflowEvent
} from "@/lib/services/workflow-observability";
import {
  buildRetryableWorkflowDeliveryError,
  throwDeliveryStateFinalizeFailure
} from "@/lib/services/send-workflow-state";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { invokeSupabaseRpcOrThrow } from "@/lib/supabase/rpc";
import { toEasternDate, toEasternISO } from "@/lib/timezone";
import { insertPacketEvent } from "@/lib/services/enrollment-packet-public-helpers";

const PREPARE_ENROLLMENT_PACKET_REQUEST_RPC = "rpc_prepare_enrollment_packet_request";
const ENROLLMENT_PACKET_DELIVERY_RPC_MIGRATION = "0073_delivery_and_member_file_rpc_hardening.sql";

export class ActiveEnrollmentPacketConflictError extends Error {
  code = "active_enrollment_packet_exists" as const;
  activePacket: ReturnType<typeof toSummary>;

  constructor(request: EnrollmentPacketRequestRow) {
    super("An active enrollment packet already exists for this lead.");
    this.activePacket = toSummary(request);
  }
}

async function loadEnrollmentPacketTemplateBuilder() {
  const { buildEnrollmentPacketTemplate } = await import("@/lib/email/templates/enrollment-packet");
  return buildEnrollmentPacketTemplate;
}

export async function upsertEnrollmentPacketSenderSignatureProfile(input: {
  userId: string;
  signatureName: string;
  signatureImageDataUrl: string;
}) {
  const userId = clean(input.userId);
  const signatureName = clean(input.signatureName);
  if (!userId) throw new Error("User ID is required.");
  if (!signatureName) throw new Error("Signature name is required.");
  const signature = parseDataUrlPayload(input.signatureImageDataUrl);
  if (!signature.contentType.startsWith("image/")) {
    throw new Error("Sender signature image must be a valid image.");
  }
  const now = toEasternISO();
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("enrollment_packet_sender_signatures")
    .upsert(
      {
        user_id: userId,
        signature_name: signatureName,
        signature_blob: input.signatureImageDataUrl.trim(),
        updated_at: now
      },
      { onConflict: "user_id" }
    )
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as SenderProfileRow;
}

async function sendEnrollmentPacketEmail(input: {
  caregiverEmail: string;
  caregiverName: string | null;
  memberName: string;
  optionalMessage?: string | null;
  requestUrl: string;
}) {
  const apiKey = clean(process.env.RESEND_API_KEY);
  if (!apiKey) throw new Error("Enrollment packet email delivery is not configured. Set RESEND_API_KEY.");
  const clinicalSenderEmail = resolveClinicalSenderEmail();
  const buildEnrollmentPacketTemplate = await loadEnrollmentPacketTemplateBuilder();
  const template = buildEnrollmentPacketTemplate({
    recipientName: clean(input.caregiverName) ?? "Family Member",
    memberName: input.memberName,
    requestUrl: input.requestUrl,
    optionalMessage: input.optionalMessage ?? null
  });

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: `${template.fromDisplayName} <${clinicalSenderEmail}>`,
      to: [input.caregiverEmail],
      subject: template.subject,
      html: template.html,
      text: template.text
    })
  });

  if (!response.ok) {
    let detail = "";
    try {
      detail = await response.text();
    } catch {
      detail = "";
    }
    throw new Error(`Unable to deliver enrollment packet email (${response.status}). ${detail}`.trim());
  }
}

async function prepareEnrollmentPacketRequestForDelivery(input: {
  existingRequest: EnrollmentPacketRequestRow | null;
  memberId: string;
  leadId: string | null;
  senderUserId: string;
  caregiverEmail: string;
  expiresAt: string;
  hashedToken: string;
  requestedDays: string[];
  transportation: StaffTransportationOption;
  communityFee: number;
  dailyRate: number;
  pricingCommunityFeeId: string | null;
  pricingDailyRateId: string | null;
  pricingSnapshot: Record<string, unknown>;
  caregiverName: string | null;
  caregiverPhone: string | null;
  intakePayload: EnrollmentPacketIntakePayload;
  signatureProfile: SenderProfileRow;
  senderEmail: string;
  eventMetadata: Record<string, unknown>;
  preparedAt: string;
}) {
  const admin = createSupabaseAdminClient();
  const packetId = input.existingRequest?.id ?? null;
  let preparedPacketId = packetId;

  try {
    type PrepareEnrollmentPacketResultRow = {
      packet_id: string;
      was_created: boolean;
    };
    const data = await invokeSupabaseRpcOrThrow<unknown>(admin, PREPARE_ENROLLMENT_PACKET_REQUEST_RPC, {
      p_packet_id: packetId,
      p_member_id: input.memberId,
      p_lead_id: input.leadId,
      p_sender_user_id: input.senderUserId,
      p_caregiver_email: input.caregiverEmail,
      p_token: input.hashedToken,
      p_token_expires_at: input.expiresAt,
      p_requested_days: input.requestedDays,
      p_transportation: input.transportation,
      p_community_fee: input.communityFee,
      p_daily_rate: input.dailyRate,
      p_pricing_community_fee_id: input.pricingCommunityFeeId,
      p_pricing_daily_rate_id: input.pricingDailyRateId,
      p_pricing_snapshot: input.pricingSnapshot,
      p_caregiver_name: input.caregiverName,
      p_caregiver_phone: input.caregiverPhone,
      p_intake_payload: input.intakePayload,
      p_signature_name: input.signatureProfile.signature_name,
      p_signature_blob: input.signatureProfile.signature_blob,
      p_sender_email: input.senderEmail,
      p_prepared_at: input.preparedAt
    });
    const row = (Array.isArray(data) ? data[0] : null) as PrepareEnrollmentPacketResultRow | null;
    preparedPacketId = clean(row?.packet_id) ?? packetId;
    if (!preparedPacketId) {
      throw new Error("Enrollment packet request preparation RPC did not return a packet id.");
    }
  } catch (error) {
    if (
      isActiveEnrollmentPacketUniqueViolation(
        error as { code?: string | null; message?: string | null; details?: string | null } | null | undefined
      )
    ) {
      throw new Error("An active enrollment packet already exists for this member.");
    }
    const message = error instanceof Error ? error.message : "Unable to prepare enrollment packet request.";
    if (message.includes(PREPARE_ENROLLMENT_PACKET_REQUEST_RPC)) {
      throw new Error(
        `Enrollment packet request preparation RPC is not available yet. Apply Supabase migration ${ENROLLMENT_PACKET_DELIVERY_RPC_MIGRATION} first.`
      );
    }
    throw error;
  }

  await insertPacketEvent({
    packetId: preparedPacketId,
    eventType: "prepared",
    actorUserId: input.senderUserId,
    actorEmail: input.senderEmail,
    metadata: input.eventMetadata
  });

  return preparedPacketId;
}

function resolveClinicalSenderEmail() {
  const sender = clean(process.env.CLINICAL_SENDER_EMAIL);
  if (!sender || !isEmail(sender)) {
    throw new Error("CLINICAL_SENDER_EMAIL is missing or invalid.");
  }
  return sender;
}

async function resolveSendContext(input: {
  memberId?: string | null;
  leadId?: string | null;
}) {
  const leadId = clean(input.leadId);
  if (!leadId) {
    throw new Error("sendEnrollmentPacketRequest requires lead.id. Enrollment packet sending is lead-driven.");
  }

  const canonicalLead = await resolveCanonicalLeadRef(
    {
      sourceType: "lead",
      leadId,
      selectedId: leadId
    },
    {
      actionLabel: "sendEnrollmentPacketRequest",
      serviceRole: true
    }
  );
  if (!canonicalLead.leadId) {
    throw new Error("sendEnrollmentPacketRequest expected lead.id but canonical lead resolution returned empty leadId.");
  }

  const member = await ensureCanonicalMemberForLead({
    leadId: canonicalLead.leadId,
    actionLabel: "sendEnrollmentPacketRequest.ensureCanonicalMemberForLead",
    serviceRole: true
  });
  if (!member) {
    throw new Error("Enrollment packet requires canonical member linkage for the selected lead.");
  }

  const memberIdFromInput = clean(input.memberId);
  if (memberIdFromInput) {
    const memberCanonicalId = await resolveCanonicalMemberId(memberIdFromInput, {
      actionLabel: "sendEnrollmentPacketRequest.strictLinkCheck",
      serviceRole: true
    });
    if (memberCanonicalId !== member.id) {
      throw new Error(
        `sendEnrollmentPacketRequest expected canonical member linked to lead.id ${canonicalLead.leadId}, but member.id ${memberIdFromInput} is not linked to that lead.`
      );
    }
  }

  const lead = await getLeadById(canonicalLead.leadId);
  if (!lead) throw new Error("Lead was not found.");
  if (
    !isEnrollmentPacketEligibleLeadState({
      requestedStage: String(lead.stage ?? ""),
      requestedStatus: String(lead.status ?? "")
    })
  ) {
    throw new Error("Enrollment packet can only be sent for leads in Tour, Enrollment in Progress, or Nurture.");
  }
  const refreshedMember = await getMemberById(member.id);
  if (!refreshedMember) throw new Error("Member was not found.");

  return { member: refreshedMember, lead };
}

async function loadEditableExistingPacket(input: {
  packetId: string;
  memberId: string;
  leadId: string | null;
}) {
  const request = await loadRequestById(input.packetId);
  if (!request) {
    throw new Error("Enrollment packet was not found.");
  }
  if (request.member_id !== input.memberId) {
    throw new Error("Enrollment packet/member mismatch.");
  }
  if ((request.lead_id ?? null) !== (input.leadId ?? null)) {
    throw new Error("Enrollment packet/lead mismatch.");
  }
  const status = toStatus(request.status);
  if (status === "completed" || status === "expired" || status === "voided") {
    throw new Error("Only active enrollment packets can be resent.");
  }
  return request;
}

export async function sendEnrollmentPacketRequest(input: {
  memberId?: string | null;
  leadId: string;
  senderUserId: string;
  senderFullName: string;
  senderEmail?: string | null;
  caregiverEmail?: string | null;
  requestedStartDate?: string | null;
  requestedDays: string[];
  transportation: string;
  communityFeeOverride?: number | null;
  dailyRateOverride?: number | null;
  totalInitialEnrollmentAmountOverride?: number | null;
  optionalMessage?: string | null;
  appBaseUrl?: string | null;
  existingPacketId?: string | null;
}) {
  const senderUserId = clean(input.senderUserId);
  const senderFullName = clean(input.senderFullName);
  const senderEmail = resolveClinicalSenderEmail();
  if (!senderUserId) throw new Error("Sender user is required.");
  if (!senderFullName) throw new Error("Sender name is required.");
  if (!isEmail(senderEmail)) throw new Error("Sender email is invalid.");

  const signatureProfile = await getEnrollmentPacketSenderSignatureProfile(senderUserId);
  if (!signatureProfile) {
    const err = new Error("Sender signature is not configured.");
    (err as Error & { code?: string }).code = "signature_setup_required";
    throw err;
  }

  const { member, lead } = await resolveSendContext({
    memberId: input.memberId,
    leadId: input.leadId
  });
  const staffTransportation = normalizeStaffTransportation(input.transportation);
  const requestedStartDate = normalizeEnrollmentDateOnly(
    clean(input.requestedStartDate) ?? clean(lead?.member_start_date) ?? toEasternDate()
  );
  const resolvedPricing = await resolveEnrollmentPricingForRequestedDays({
    requestedDays: input.requestedDays,
    effectiveDate: requestedStartDate
  });
  const communityFeeOverride =
    typeof input.communityFeeOverride === "number" && Number.isFinite(input.communityFeeOverride)
      ? safeNumber(input.communityFeeOverride, resolvedPricing.communityFeeAmount)
      : null;
  const dailyRateOverride =
    typeof input.dailyRateOverride === "number" && Number.isFinite(input.dailyRateOverride)
      ? safeNumber(input.dailyRateOverride, resolvedPricing.dailyRateAmount)
      : null;
  const effectiveCommunityFee = communityFeeOverride ?? safeNumber(resolvedPricing.communityFeeAmount);
  const effectiveDailyRate = dailyRateOverride ?? safeNumber(resolvedPricing.dailyRateAmount);
  const calculatedInitialEnrollmentAmount = calculateInitialEnrollmentAmount({
    requestedStartDate,
    requestedDays: resolvedPricing.requestedDays,
    dailyRate: effectiveDailyRate,
    communityFee: effectiveCommunityFee
  });
  const totalInitialEnrollmentAmountOverride =
    typeof input.totalInitialEnrollmentAmountOverride === "number" &&
    Number.isFinite(input.totalInitialEnrollmentAmountOverride)
      ? safeNumber(input.totalInitialEnrollmentAmountOverride, calculatedInitialEnrollmentAmount)
      : null;
  const effectiveInitialEnrollmentAmount = totalInitialEnrollmentAmountOverride ?? calculatedInitialEnrollmentAmount;
  const pricingSnapshot = {
    ...(resolvedPricing.snapshot ?? {}),
    selectedValues: {
      communityFee: effectiveCommunityFee,
      dailyRate: effectiveDailyRate,
      totalInitialEnrollmentAmount: effectiveInitialEnrollmentAmount,
      requestedStartDate
    },
    overrides: {
      communityFee: communityFeeOverride,
      dailyRate: dailyRateOverride,
      totalInitialEnrollmentAmount: totalInitialEnrollmentAmountOverride
    }
  };
  const caregiverEmail = cleanEmail(input.caregiverEmail) ?? cleanEmail(lead?.caregiver_email);
  if (!caregiverEmail || !isEmail(caregiverEmail)) throw new Error("Caregiver email is required.");
  const requiredCaregiverEmail = caregiverEmail;
  const memberNameParts = splitMemberName(lead?.member_name ?? member.display_name);
  const requestedExistingPacketId = clean(input.existingPacketId);

  const [memberActive, leadActive] = await Promise.all([
    listActivePacketRows(member.id),
    lead?.id ? listActivePacketRowsForLead(lead.id) : Promise.resolve([])
  ]);
  const active = [...memberActive, ...leadActive].filter(
    (row, index, rows) => rows.findIndex((candidate) => candidate.id === row.id) === index
  );
  const explicitExistingRequest = requestedExistingPacketId
    ? await loadEditableExistingPacket({
        packetId: requestedExistingPacketId,
        memberId: member.id,
        leadId: lead?.id ?? null
      })
    : null;
  const reusablePreparedActive =
    explicitExistingRequest ?? active.find((row) => isReusableDraftEnrollmentPacket(row)) ?? null;
  const blockingActive = active.find((row) => {
    if (reusablePreparedActive && row.id === reusablePreparedActive.id) return false;
    const status = toStatus(row.status);
    return status === "draft" || status === "sent" || status === "in_progress";
  });
  if (blockingActive) {
    throw new ActiveEnrollmentPacketConflictError(blockingActive);
  }

  const now = toEasternISO();
  const token = generateSigningToken();
  const hashedToken = hashToken(token);
  const expiresAtDate = new Date();
  expiresAtDate.setDate(expiresAtDate.getDate() + 14);
  const expiresAt = expiresAtDate.toISOString();
  const requestUrl = `${buildAppBaseUrl(input.appBaseUrl)}/sign/enrollment-packet/${token}`;
  const intakePayload = normalizeEnrollmentPacketIntakePayload({
    memberLegalFirstName: memberNameParts.firstName,
    memberLegalLastName: memberNameParts.lastName,
    memberDob: clean(lead?.member_dob),
    requestedAttendanceDays: resolvedPricing.requestedDays,
    requestedStartDate,
    transportationPreference: staffTransportation,
    transportationQuestionEnabled: "No",
    referredBy: clean(lead?.referral_name),
    primaryContactName: clean(lead?.caregiver_name),
    primaryContactRelationship: clean(lead?.caregiver_relationship),
    primaryContactPhone: clean(lead?.caregiver_phone),
    primaryContactEmail: requiredCaregiverEmail,
    responsiblePartyGuarantorFirstName: clean(lead?.caregiver_name)?.split(" ")[0] ?? null,
    responsiblePartyGuarantorLastName: clean(lead?.caregiver_name)?.split(" ").slice(1).join(" ") || null,
    membershipNumberOfDays: String(resolvedPricing.requestedDays.length),
    membershipDailyAmount: effectiveDailyRate.toFixed(2),
    communityFee: effectiveCommunityFee.toFixed(2),
    totalInitialEnrollmentAmount: effectiveInitialEnrollmentAmount.toFixed(2)
  });

  const requestId = await prepareEnrollmentPacketRequestForDelivery({
    existingRequest: reusablePreparedActive,
    memberId: member.id,
    leadId: lead?.id ?? null,
    senderUserId,
    caregiverEmail: requiredCaregiverEmail,
    expiresAt,
    hashedToken,
    requestedDays: resolvedPricing.requestedDays,
    transportation: staffTransportation,
    communityFee: effectiveCommunityFee,
    dailyRate: effectiveDailyRate,
    pricingCommunityFeeId: resolvedPricing.communityFeeId,
    pricingDailyRateId: resolvedPricing.dailyRateId,
    pricingSnapshot,
    caregiverName: clean(lead?.caregiver_name),
    caregiverPhone: clean(lead?.caregiver_phone),
    intakePayload,
    signatureProfile,
    senderEmail,
    preparedAt: now,
    eventMetadata: {
      memberId: member.id,
      leadId: lead?.id ?? null,
      pricingCommunityFeeId: resolvedPricing.communityFeeId,
      pricingDailyRateId: resolvedPricing.dailyRateId,
      pricingDaysPerWeek: resolvedPricing.daysPerWeek,
      communityFee: effectiveCommunityFee,
      dailyRate: effectiveDailyRate,
      requestedStartDate,
      totalInitialEnrollmentAmount: effectiveInitialEnrollmentAmount,
      communityFeeOverride,
      dailyRateOverride,
      totalInitialEnrollmentAmountOverride,
      retryAttempt: Boolean(reusablePreparedActive),
      reusedPreparedRequest: Boolean(reusablePreparedActive && isReusableDraftEnrollmentPacket(reusablePreparedActive)),
      resendAttempt: Boolean(explicitExistingRequest)
    }
  });

  try {
    await sendEnrollmentPacketEmail({
      caregiverEmail: requiredCaregiverEmail,
      caregiverName: lead?.caregiver_name ?? null,
      memberName: member.display_name,
      optionalMessage: input.optionalMessage ?? null,
      requestUrl
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unable to deliver enrollment packet email.";
    const failedAt = toEasternISO();
    await markEnrollmentPacketDeliveryState({
      packetId: requestId,
      status: "draft",
      deliveryStatus: "send_failed",
      deliveryError: reason,
      sentAt: null,
      attemptAt: failedAt
    });
    await insertPacketEvent({
      packetId: requestId,
      eventType: "send_failed",
      actorUserId: senderUserId,
      actorEmail: senderEmail,
      metadata: {
        memberId: member.id,
        leadId: lead?.id ?? null,
        retryAvailable: true,
        error: reason
      }
    });
    await recordWorkflowEvent({
      eventType: "enrollment_packet_failed",
      entityType: "enrollment_packet_request",
      entityId: requestId,
      actorType: "user",
      actorUserId: senderUserId,
      status: "failed",
      severity: "medium",
      metadata: {
        member_id: member.id,
        lead_id: lead?.id ?? null,
        phase: "delivery",
        delivery_status: "send_failed",
        retry_available: true,
        error: reason
      }
    });
    await recordWorkflowMilestone({
      event: {
        eventType: "enrollment_packet_failed",
        entityType: "enrollment_packet_request",
        entityId: requestId,
        actorType: "user",
        actorUserId: senderUserId,
        status: "failed",
        severity: "high",
        metadata: {
          member_id: member.id,
          lead_id: lead?.id ?? null,
          phase: "delivery",
          error: reason
        }
      }
    });
    await maybeRecordRepeatedFailureAlert({
      workflowEventType: "enrollment_packet_failed",
      entityType: "enrollment_packet_request",
      entityId: requestId,
      actorUserId: senderUserId,
      threshold: 2,
      metadata: {
        member_id: member.id,
        lead_id: lead?.id ?? null,
        phase: "delivery"
      }
    });
    throw buildRetryableWorkflowDeliveryError({
      requestId,
      requestUrl,
      reason,
      workflowLabel: "Enrollment packet",
      retryLabel: "Retry sending the same packet once delivery settings are corrected."
    });
  }

  const sentAt = toEasternISO();
  try {
    await markEnrollmentPacketDeliveryState({
      packetId: requestId,
      status: "sent",
      deliveryStatus: "sent",
      deliveryError: null,
      sentAt,
      attemptAt: sentAt
    });
  } catch (error) {
    await throwDeliveryStateFinalizeFailure({
      entityType: "enrollment_packet_request",
      entityId: requestId,
      actorUserId: senderUserId,
      alertKey: "enrollment_packet_delivery_state_finalize_failed",
      metadata: {
        member_id: member.id,
        lead_id: lead?.id ?? null,
        caregiver_email: requiredCaregiverEmail,
        email_delivery_state: "email_sent_but_sent_state_not_persisted",
        prepared_delivery_status: "ready_to_send",
        error: error instanceof Error ? error.message : "Unable to finalize enrollment packet sent state."
      },
      message:
        "Enrollment packet email was delivered, but the sent state could not be finalized. The link remains active in Ready to Send state. Review operational alerts before retrying."
    });
  }

  await insertPacketEvent({
    packetId: requestId,
    eventType: "Enrollment Packet Sent",
    actorUserId: senderUserId,
    actorEmail: senderEmail
  });
  await recordWorkflowEvent({
    eventType: "enrollment_packet_sent",
    entityType: "enrollment_packet_request",
    entityId: requestId,
    actorType: "user",
    actorUserId: senderUserId,
    status: "sent",
    severity: "low",
    metadata: {
      member_id: member.id,
      lead_id: lead?.id ?? null,
      caregiver_email: requiredCaregiverEmail,
      sent_at: sentAt
    }
  });
  try {
    await recordWorkflowMilestone({
      event: {
        event_type: "enrollment_packet_sent",
        entity_type: "enrollment_packet_request",
        entity_id: requestId,
        actor_type: "user",
        actor_id: senderUserId,
        actor_user_id: senderUserId,
        status: "sent",
        severity: "low",
        metadata: {
          member_id: member.id,
          lead_id: lead?.id ?? null,
          caregiver_email: requiredCaregiverEmail,
          sent_at: sentAt
        }
      }
    });
  } catch (error) {
    console.error("[enrollment-packets] unable to emit post-send workflow milestone", error);
  }

  let leadActivitySyncError: string | null = null;

  if (lead?.id) {
    try {
      const synced = await syncEnrollmentPacketLeadActivityOrQueue({
        packetId: requestId,
        memberId: member.id,
        leadId: lead.id,
        memberName: lead.member_name,
        activityType: "Email",
        outcome: "Enrollment Packet Sent",
        notes: `Enrollment packet request ${requestId} sent to ${caregiverEmail}.`,
        completedByUserId: senderUserId,
        completedByName: senderFullName,
        actionUrl: `/sales/leads/${lead.id}`
      });
      if (!synced) {
        leadActivitySyncError = "Lead activity sync did not persist; follow-up task was queued.";
      }
    } catch (error) {
      leadActivitySyncError =
        error instanceof Error
          ? error.message
          : "Enrollment packet lead activity sync threw an unexpected error.";
      console.error("[enrollment-packets] lead activity sync failed after packet sent", {
        packetId: requestId,
        leadId: lead.id,
        message: leadActivitySyncError
      });
    }
  }

  if (leadActivitySyncError && lead?.id) {
    try {
      await recordEnrollmentPacketActionRequired({
        packetId: requestId,
        memberId: member.id,
        leadId: lead.id,
        actorUserId: senderUserId,
        title: "Enrollment Packet Lead Activity Sync Failed",
        message:
          "The enrollment packet was sent, but lead activity could not be synced immediately. Complete this workflow after the lead activity is recorded.",
        actionUrl: `/sales/leads/${lead.id}`,
        eventKeySuffix: "lead-activity-sync-failed"
      });
    } catch (actionRequiredError) {
      console.error("[enrollment-packets] unable to create lead activity sync warning action required", {
        packetId: requestId,
        leadId: lead.id,
        message: actionRequiredError instanceof Error ? actionRequiredError.message : "Unknown error"
      });
    }
  }

  if (leadActivitySyncError) {
    try {
      await insertPacketEvent({
        packetId: requestId,
        eventType: "Enrollment Packet Lead Activity Sync Warning",
        actorUserId: senderUserId,
        actorEmail: senderEmail,
        metadata: {
          member_id: member.id,
          lead_id: lead?.id ?? null,
          lead_activity_sync_error: leadActivitySyncError
        }
      });
    } catch (eventError) {
      console.error("[enrollment-packets] unable to persist lead activity sync warning event", {
        packetId: requestId,
        leadId: lead?.id ?? null,
        message: eventError instanceof Error ? eventError.message : "Unknown error"
      });
    }
  }

  const actionNeededMessage = leadActivitySyncError
    ? "Enrollment packet was sent, but sales activity still needs follow-up. Open the lead and confirm the packet activity appears before relying on sales workflow history."
    : null;

  return {
    request: toSummary({
      id: requestId,
      member_id: member.id,
      lead_id: lead?.id ?? null,
      sender_user_id: senderUserId,
      caregiver_email: requiredCaregiverEmail,
      status: "sent",
      delivery_status: "sent",
      last_delivery_attempt_at: sentAt,
      delivery_failed_at: null,
      delivery_error: null,
      token: hashedToken,
      last_consumed_submission_token_hash: reusablePreparedActive?.last_consumed_submission_token_hash ?? null,
      token_expires_at: expiresAt,
      created_at: reusablePreparedActive?.created_at ?? now,
      sent_at: sentAt,
      opened_at: reusablePreparedActive?.opened_at ?? null,
      completed_at: reusablePreparedActive?.completed_at ?? null,
      last_family_activity_at: reusablePreparedActive?.last_family_activity_at ?? reusablePreparedActive?.updated_at ?? null,
      voided_at: null,
      voided_by_user_id: null,
      void_reason: null,
      updated_at: sentAt,
      mapping_sync_status: reusablePreparedActive?.mapping_sync_status ?? null,
      mapping_sync_error: reusablePreparedActive?.mapping_sync_error ?? null,
      mapping_sync_attempted_at: reusablePreparedActive?.mapping_sync_attempted_at ?? null,
      latest_mapping_run_id: reusablePreparedActive?.latest_mapping_run_id ?? null
    }),
    requestUrl,
    actionNeeded: Boolean(leadActivitySyncError),
    actionNeededMessage
  };
}
