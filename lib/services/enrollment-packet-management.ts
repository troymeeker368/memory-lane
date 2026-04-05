import "server-only";

import { sendEnrollmentPacketRequest } from "@/lib/services/enrollment-packets-send-runtime";
import {
  clean,
  normalizeStaffTransportation,
  toStatus,
  toSummary
} from "@/lib/services/enrollment-packet-core";
import {
  buildEnrollmentPacketListPresentation,
  buildEnrollmentPacketSearchClauses,
  ENROLLMENT_PACKET_REQUEST_LIST_SELECT,
  matchesEnrollmentPacketListSearch,
  resolveEnrollmentPacketRelatedNames
} from "@/lib/services/enrollment-packet-list-support";
import {
  getLeadById,
  getMemberById,
  loadPacketFields,
  loadRequestById
} from "@/lib/services/enrollment-packet-mapping-runtime";
import type {
  EnrollmentPacketAuditEvent,
  EnrollmentPacketFieldsRow,
  EnrollmentPacketRequestRow,
  EnrollmentPacketStatus,
  OperationalEnrollmentPacketListItem
} from "@/lib/services/enrollment-packet-types";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { invokeSupabaseRpcOrThrow } from "@/lib/supabase/rpc";
import { toEasternDate, toEasternISO } from "@/lib/timezone";

const VOID_ENROLLMENT_PACKET_RPC = "rpc_void_enrollment_packet_request";

type StaffStatusFilter = EnrollmentPacketStatus | "active" | "all";

function rawStatusesForOperationalFilter(filter: StaffStatusFilter) {
  if (filter === "all") return null;
  if (filter === "active") return ["draft", "sent", "opened", "partially_completed", "in_progress"];
  if (filter === "in_progress") return ["opened", "partially_completed", "in_progress"];
  if (filter === "completed") return ["completed", "filed"];
  return [filter];
}

export type EnrollmentPacketStaffDetail = {
  request: OperationalEnrollmentPacketListItem;
  memberName: string;
  leadMemberName: string | null;
  senderName: string | null;
  fields: EnrollmentPacketFieldsRow | null;
  events: EnrollmentPacketAuditEvent[];
};

function normalizeStatusFilter(input?: {
  status?: StaffStatusFilter;
  includeCompleted?: boolean;
}) {
  if (input?.status) return input.status;
  return input?.includeCompleted ? "all" : "active";
}

function buildResendRequestedStartDate(fields: EnrollmentPacketFieldsRow | null, leadStartDate: string | null | undefined) {
  const intakePayload = fields?.intake_payload ?? null;
  const fromPayload =
    intakePayload && typeof intakePayload.requestedStartDate === "string"
      ? clean(intakePayload.requestedStartDate)
      : null;
  const fromPricing =
    intakePayload &&
    typeof intakePayload.membershipRequestedStartDate === "string"
      ? clean(intakePayload.membershipRequestedStartDate)
      : null;
  return fromPayload ?? fromPricing ?? clean(leadStartDate) ?? toEasternDate();
}

export async function listOperationalEnrollmentPackets(input?: {
  status?: StaffStatusFilter;
  search?: string | null;
  leadId?: string | null;
  limit?: number;
  includeCompleted?: boolean;
}) {
  const admin = createSupabaseAdminClient("enrollment_packet_workflow");
  const normalizedStatus = normalizeStatusFilter(input);
  const searchNeedle = clean(input?.search)?.toLowerCase() ?? null;
  const normalizedLeadId = clean(input?.leadId);
  const safeLimit = Math.max(1, Math.min(500, Math.trunc(input?.limit ?? 200)));

  let query = admin
    .from("enrollment_packet_requests")
    .select(ENROLLMENT_PACKET_REQUEST_LIST_SELECT)
    .order("updated_at", { ascending: false })
    .limit(safeLimit);

  if (normalizedLeadId) {
    query = query.eq("lead_id", normalizedLeadId);
  }

  const rawStatuses = rawStatusesForOperationalFilter(normalizedStatus);
  if (rawStatuses?.length === 1) {
    query = query.eq("status", rawStatuses[0]);
  } else if (rawStatuses && rawStatuses.length > 1) {
    query = query.in("status", rawStatuses);
  }

  const searchClauses = searchNeedle ? await buildEnrollmentPacketSearchClauses(searchNeedle) : [];
  if (searchClauses.length > 0) {
    query = query.or(searchClauses.join(","));
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as unknown as EnrollmentPacketRequestRow[];
  if (rows.length === 0) return [] satisfies OperationalEnrollmentPacketListItem[];

  const names = await resolveEnrollmentPacketRelatedNames(rows);
  const items = rows.map((row) => buildEnrollmentPacketListPresentation(row, names));

  if (!searchNeedle) return items;

  return items.filter((item) => matchesEnrollmentPacketListSearch(item, searchNeedle));
}

export const listOperationalEnrollmentPacketRequests = listOperationalEnrollmentPackets;

export async function getOperationalEnrollmentPacketById(packetId: string): Promise<OperationalEnrollmentPacketListItem | null> {
  const normalizedPacketId = clean(packetId);
  if (!normalizedPacketId) return null;

  const request = await loadRequestById(normalizedPacketId);
  if (!request) return null;

  const names = await resolveEnrollmentPacketRelatedNames([request]);
  return buildEnrollmentPacketListPresentation(request, names);
}

export async function listEnrollmentPacketAuditEvents(packetId: string): Promise<EnrollmentPacketAuditEvent[]> {
  const normalizedPacketId = clean(packetId);
  if (!normalizedPacketId) return [];

  const admin = createSupabaseAdminClient("enrollment_packet_workflow");
  const { data, error } = await admin
    .from("enrollment_packet_events")
    .select("id, packet_id, event_type, actor_user_id, actor_email, timestamp, metadata")
    .eq("packet_id", normalizedPacketId)
    .order("timestamp", { ascending: false });
  if (error) throw new Error(error.message);

  const eventRows = (data ?? []) as Array<{
    id: string;
    packet_id: string;
    event_type: string;
    actor_user_id: string | null;
    actor_email: string | null;
    timestamp: string;
    metadata: Record<string, unknown> | null;
  }>;

  const actorIds = Array.from(
    new Set(
      eventRows
        .map((row) => clean(row.actor_user_id))
        .filter((value): value is string => Boolean(value))
    )
  );
  const actorNames = new Map<string, string>();
  if (actorIds.length > 0) {
    const { data: actors, error: actorError } = await admin.from("profiles").select("id, full_name").in("id", actorIds);
    if (actorError) throw new Error(actorError.message);
    for (const row of (actors ?? []) as Array<{ id: string; full_name: string | null }>) {
      actorNames.set(String(row.id), clean(row.full_name) ?? "Unknown staff");
    }
  }

  return eventRows.map((row) => ({
    id: row.id,
    packetId: row.packet_id,
    eventType: row.event_type,
    actorName: clean(row.actor_user_id) ? actorNames.get(String(row.actor_user_id)) ?? null : null,
    actorUserId: clean(row.actor_user_id),
    actorEmail: clean(row.actor_email),
    timestamp: row.timestamp,
    metadata: row.metadata ?? {}
  }));
}

export async function getEnrollmentPacketStaffDetail(packetId: string): Promise<EnrollmentPacketStaffDetail | null> {
  const normalizedPacketId = clean(packetId);
  if (!normalizedPacketId) return null;

  const [request, fields, events] = await Promise.all([
    getOperationalEnrollmentPacketById(normalizedPacketId),
    loadPacketFields(normalizedPacketId),
    listEnrollmentPacketAuditEvents(normalizedPacketId)
  ]);
  if (!request) return null;

  return {
    request,
    memberName: request.memberName,
    leadMemberName: request.leadMemberName,
    senderName: request.senderName,
    fields,
    events
  };
}

export async function voidEnrollmentPacketRequest(input: {
  packetId: string;
  actorUserId: string;
  actorEmail?: string | null;
  reason: string;
}) {
  const packetId = clean(input.packetId);
  const actorUserId = clean(input.actorUserId);
  const reason = clean(input.reason);
  if (!packetId) throw new Error("Packet id is required.");
  if (!actorUserId) throw new Error("Actor user is required.");
  if (!reason) throw new Error("A void reason is required.");

  const admin = createSupabaseAdminClient("enrollment_packet_workflow");
  await invokeSupabaseRpcOrThrow<unknown>(admin, VOID_ENROLLMENT_PACKET_RPC, {
    p_packet_id: packetId,
    p_actor_user_id: actorUserId,
    p_actor_email: clean(input.actorEmail),
    p_void_reason: reason,
    p_voided_at: toEasternISO()
  });

  const refreshed = await loadRequestById(packetId);
  if (!refreshed) {
    throw new Error("Voided enrollment packet could not be reloaded.");
  }
  return toSummary(refreshed);
}

export async function resendEnrollmentPacketRequest(input: {
  packetId: string;
  senderUserId: string;
  senderFullName: string;
  appBaseUrl?: string | null;
}) {
  const packetId = clean(input.packetId);
  if (!packetId) throw new Error("Packet id is required.");

  const [request, fields] = await Promise.all([loadRequestById(packetId), loadPacketFields(packetId)]);
  if (!request || !fields) {
    throw new Error("Enrollment packet could not be loaded for resend.");
  }
  if (toStatus(request.status) === "completed") {
    throw new Error("Completed enrollment packets cannot be resent.");
  }
  if (toStatus(request.status) === "voided") {
    throw new Error("Voided enrollment packets cannot be resent.");
  }
  if (toStatus(request.status) === "expired") {
    throw new Error("Expired enrollment packets must be reissued from the lead.");
  }

  const lead = request.lead_id ? await getLeadById(request.lead_id) : null;
  const requestedStartDate = buildResendRequestedStartDate(fields, lead?.member_start_date);

  return sendEnrollmentPacketRequest({
    memberId: request.member_id,
    leadId: request.lead_id ?? "",
    senderUserId: input.senderUserId,
    senderFullName: input.senderFullName,
    caregiverEmail: fields.caregiver_email ?? request.caregiver_email,
    requestedStartDate,
    requestedDays: fields.requested_days ?? [],
    transportation: normalizeStaffTransportation(fields.transportation),
    communityFeeOverride: fields.community_fee,
    dailyRateOverride: fields.daily_rate,
    totalInitialEnrollmentAmountOverride:
      fields.pricing_snapshot &&
      typeof fields.pricing_snapshot === "object" &&
      fields.pricing_snapshot.selectedValues &&
      typeof fields.pricing_snapshot.selectedValues === "object" &&
      typeof (fields.pricing_snapshot.selectedValues as Record<string, unknown>).totalInitialEnrollmentAmount === "number"
        ? Number((fields.pricing_snapshot.selectedValues as Record<string, unknown>).totalInitialEnrollmentAmount)
        : null,
    optionalMessage: null,
    appBaseUrl: input.appBaseUrl ?? null,
    existingPacketId: request.id
  });
}
