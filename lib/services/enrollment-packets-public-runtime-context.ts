import "server-only";

import {
  buildPublicEnrollmentPacketSubmitResult,
  insertPacketEvent
} from "@/lib/services/enrollment-packet-public-helpers";
import {
  clean,
  hashToken,
  isExpired,
  normalizeStoredIntakePayload,
  payloadMemberDisplayName,
  safeNumber,
  toDeliveryStatus,
  toStatus,
  toSummary
} from "@/lib/services/enrollment-packet-core";
import {
  getMemberById,
  loadPacketFields,
  loadRequestById
} from "@/lib/services/enrollment-packet-mapping-runtime";
import { markEnrollmentPacketDeliveryState } from "@/lib/services/enrollment-packet-delivery-runtime";
import { recordWorkflowMilestone } from "@/lib/services/lifecycle-milestones";
import {
  recordWorkflowEvent
} from "@/lib/services/workflow-observability";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { toEasternISO } from "@/lib/timezone";
import type {
  EnrollmentPacketFieldsRow,
  EnrollmentPacketRequestRow,
  EnrollmentPacketTokenMatch,
  PublicEnrollmentPacketContext
} from "@/lib/services/enrollment-packet-types";

function toPublicContext(
  request: EnrollmentPacketRequestRow,
  fields: EnrollmentPacketFieldsRow,
  memberName: string
): PublicEnrollmentPacketContext {
  const intakePayload = normalizeStoredIntakePayload(fields);
  const prefilledMemberName = payloadMemberDisplayName(intakePayload);
  return {
    state: "ready",
    request: toSummary(request),
    memberName: prefilledMemberName ?? memberName,
    fields: {
      requestedDays: fields.requested_days ?? [],
      transportation: fields.transportation,
      communityFee: safeNumber(fields.community_fee),
      dailyRate: safeNumber(fields.daily_rate),
      caregiverName: fields.caregiver_name,
      caregiverPhone: fields.caregiver_phone,
      caregiverEmail: fields.caregiver_email,
      caregiverAddressLine1: fields.caregiver_address_line1,
      caregiverAddressLine2: fields.caregiver_address_line2,
      caregiverCity: fields.caregiver_city,
      caregiverState: fields.caregiver_state,
      caregiverZip: fields.caregiver_zip,
      secondaryContactName: fields.secondary_contact_name,
      secondaryContactPhone: fields.secondary_contact_phone,
      secondaryContactEmail: fields.secondary_contact_email,
      secondaryContactRelationship: fields.secondary_contact_relationship,
      notes: fields.notes,
      intakePayload
    }
  };
}

export async function loadRequestByToken(rawToken: string): Promise<EnrollmentPacketTokenMatch | null> {
  const hashed = hashToken(rawToken);
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("enrollment_packet_requests")
    .select("*")
    .eq("token", hashed)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (data) {
    return {
      request: data as EnrollmentPacketRequestRow,
      tokenMatch: "active"
    };
  }

  const { data: consumedData, error: consumedError } = await admin
    .from("enrollment_packet_requests")
    .select("*")
    .eq("last_consumed_submission_token_hash", hashed)
    .maybeSingle();
  if (consumedError) throw new Error(consumedError.message);
  if (!consumedData) return null;
  return {
    request: consumedData as EnrollmentPacketRequestRow,
    tokenMatch: "consumed"
  };
}

async function markEnrollmentPacketOpened(input: {
  request: EnrollmentPacketRequestRow;
  metadata?: { ip?: string | null; userAgent?: string | null };
}) {
  if (input.request.opened_at) return false;
  const now = toEasternISO();
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("enrollment_packet_requests")
    .update({
      opened_at: now,
      last_family_activity_at: now,
      updated_at: now
    })
    .eq("id", input.request.id)
    .eq("status", input.request.status)
    .is("opened_at", null)
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("[enrollment-packets] unable to persist opened timestamp", error);
    return false;
  }
  if (!data?.id) return false;

  await insertPacketEvent({
    packetId: input.request.id,
    eventType: "opened",
    actorEmail: input.request.caregiver_email,
    metadata: {
      ip: clean(input.metadata?.ip),
      userAgent: clean(input.metadata?.userAgent)
    }
  });
  return true;
}

export async function recordEnrollmentPacketExpiredIfNeeded(request: EnrollmentPacketRequestRow) {
  const requestStatus = toStatus(request.status);
  const shouldExpireStatus =
    requestStatus === "draft" ||
    requestStatus === "sent" ||
    requestStatus === "in_progress";

  if (shouldExpireStatus) {
    try {
      await markEnrollmentPacketDeliveryState({
        packetId: request.id,
        status: "expired",
        deliveryStatus: toDeliveryStatus(request),
        attemptAt: toEasternISO(),
        expectedCurrentStatus: requestStatus
      });
    } catch (error) {
      console.error("[enrollment-packets] unable to persist expired packet status", error);
    }
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("system_events")
    .select("id")
    .eq("event_type", "enrollment_packet_expired")
    .eq("entity_type", "enrollment_packet_request")
    .eq("entity_id", request.id)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("[enrollment-packets] unable to check existing expiration event", error);
    return;
  }
  if (data?.id) return;

  await recordWorkflowEvent({
    eventType: "enrollment_packet_expired",
    entityType: "enrollment_packet_request",
    entityId: request.id,
    actorType: "system",
    actorUserId: request.sender_user_id,
    status: "expired",
    severity: "medium",
    metadata: {
      member_id: request.member_id,
      lead_id: request.lead_id,
      expired_at: request.token_expires_at
    }
  });
  await recordWorkflowMilestone({
    event: {
      eventType: "enrollment_packet_expired",
      entityType: "enrollment_packet_request",
      entityId: request.id,
      actorType: "system",
      actorUserId: request.sender_user_id,
      status: "expired",
      severity: "medium",
      metadata: {
        member_id: request.member_id,
        lead_id: request.lead_id,
        expired_at: request.token_expires_at
      }
    }
  });
}

export async function getPublicEnrollmentPacketContext(
  token: string,
  metadata?: { ip?: string | null; userAgent?: string | null }
): Promise<PublicEnrollmentPacketContext> {
  const normalizedToken = clean(token);
  if (!normalizedToken) return { state: "invalid" };
  const matched = await loadRequestByToken(normalizedToken);
  if (!matched) return { state: "invalid" };
  const request = matched.request;

  if (toStatus(request.status) === "voided") {
    return { state: "voided" };
  }
  if (toStatus(request.status) === "completed") {
    const completedRequest = (await loadRequestById(request.id)) ?? request;
    const completedResult = buildPublicEnrollmentPacketSubmitResult({
      packetId: completedRequest.id,
      memberId: completedRequest.member_id,
      mappingSyncStatus: completedRequest.mapping_sync_status ?? "pending",
      completionFollowUpStatus: completedRequest.completion_follow_up_status ?? "pending",
      completionFollowUpError: completedRequest.completion_follow_up_error,
      wasAlreadyFiled: true
    });
    return {
      state: "completed",
      request: toSummary(completedRequest),
      mappingSyncStatus: completedResult.mappingSyncStatus,
      completionFollowUpStatus: completedResult.completionFollowUpStatus,
      readinessStage: completedResult.readinessStage,
      readinessLabel: completedResult.readinessLabel,
      operationalReadinessStatus: completedResult.operationalReadinessStatus,
      actionNeeded: completedResult.actionNeeded,
      actionNeededMessage: completedResult.actionNeededMessage
    };
  }
  if (isExpired(request.token_expires_at)) {
    await recordEnrollmentPacketExpiredIfNeeded(request);
    return { state: "expired" };
  }

  if (toStatus(request.status) === "sent") {
    await markEnrollmentPacketOpened({ request, metadata });
  }

  const [reloaded, fields, member] = await Promise.all([
    loadRequestById(request.id),
    loadPacketFields(request.id),
    getMemberById(request.member_id)
  ]);
  if (!reloaded || !fields || !member) return { state: "invalid" };
  return toPublicContext(reloaded, fields, member.display_name);
}
