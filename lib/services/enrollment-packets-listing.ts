import "server-only";

import { resolveCanonicalLeadRef, resolveCanonicalMemberId } from "@/lib/services/canonical-person-ref";
import {
  clean,
  isExpired,
  toDeliveryStatus,
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
import type {
  CompletedEnrollmentPacketFilters,
  CompletedEnrollmentPacketListItem,
  EnrollmentPacketRequestRow
} from "@/lib/services/enrollment-packet-types";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

function applyCompletedPacketOperationalReadinessFilter(
  query: any,
  operationalReadiness: CompletedEnrollmentPacketFilters["operationalReadiness"]
) {
  if (operationalReadiness === "operationally_ready") {
    return query
      .eq("mapping_sync_status", "completed")
      .eq("completion_follow_up_status", "completed");
  }
  if (operationalReadiness === "mapping_failed") {
    return query.eq("mapping_sync_status", "failed");
  }
  if (operationalReadiness === "filed_pending_mapping") {
    return query.or(
      "mapping_sync_status.is.null,mapping_sync_status.eq.pending,mapping_sync_status.eq.not_started,and(mapping_sync_status.eq.completed,completion_follow_up_status.neq.completed)"
    );
  }
  return query;
}

export async function listEnrollmentPacketRequestsForMember(memberId: string) {
  const normalizedMemberId = clean(memberId);
  if (!normalizedMemberId) throw new Error("Member ID is required.");
  const canonicalMemberId = await resolveCanonicalMemberId(normalizedMemberId, {
    actionLabel: "listEnrollmentPacketRequestsForMember",
    serviceRole: true
  });
  const admin = createSupabaseAdminClient("enrollment_packet_workflow");
  const { data, error } = await admin
    .from("enrollment_packet_requests")
    .select(ENROLLMENT_PACKET_REQUEST_LIST_SELECT)
    .eq("member_id", canonicalMemberId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as EnrollmentPacketRequestRow[]).map((row) => toSummary(row));
}

export async function listActivePacketRows(memberId: string) {
  const admin = createSupabaseAdminClient("enrollment_packet_workflow");
  const { data, error } = await admin
    .from("enrollment_packet_requests")
    .select(ENROLLMENT_PACKET_REQUEST_LIST_SELECT)
    .eq("member_id", memberId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as EnrollmentPacketRequestRow[];
  return rows.filter((row) => {
    if (isExpired(row.token_expires_at)) return false;
    const status = toStatus(row.status);
    return status === "draft" || status === "sent" || status === "in_progress";
  });
}

export async function listActivePacketRowsForLead(leadId: string) {
  const normalizedLeadId = clean(leadId);
  if (!normalizedLeadId) return [];
  const admin = createSupabaseAdminClient("enrollment_packet_workflow");
  const { data, error } = await admin
    .from("enrollment_packet_requests")
    .select(ENROLLMENT_PACKET_REQUEST_LIST_SELECT)
    .eq("lead_id", normalizedLeadId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as EnrollmentPacketRequestRow[];
  return rows.filter((row) => {
    if (isExpired(row.token_expires_at)) return false;
    const status = toStatus(row.status);
    return status === "draft" || status === "sent" || status === "in_progress";
  });
}

export function isReusableDraftEnrollmentPacket(row: EnrollmentPacketRequestRow) {
  const status = toStatus(row.status);
  const deliveryStatus = toDeliveryStatus(row);
  return status === "draft" && (deliveryStatus === "ready_to_send" || deliveryStatus === "send_failed");
}

export async function listEnrollmentPacketRequestsForLead(leadId: string) {
  const normalizedLeadId = clean(leadId);
  if (!normalizedLeadId) throw new Error("Lead ID is required.");
  const canonical = await resolveCanonicalLeadRef(
    {
      sourceType: "lead",
      leadId: normalizedLeadId,
      selectedId: normalizedLeadId
    },
    {
      actionLabel: "listEnrollmentPacketRequestsForLead",
      serviceRole: true
    }
  );
  if (!canonical.leadId) {
    throw new Error("listEnrollmentPacketRequestsForLead expected lead.id but canonical lead resolution returned empty leadId.");
  }
  const admin = createSupabaseAdminClient("enrollment_packet_workflow");
  const { data, error } = await admin
    .from("enrollment_packet_requests")
    .select(ENROLLMENT_PACKET_REQUEST_LIST_SELECT)
    .eq("lead_id", canonical.leadId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as EnrollmentPacketRequestRow[]).map((row) => toSummary(row));
}

export async function listCompletedEnrollmentPacketRequests(
  filters: CompletedEnrollmentPacketFilters = {}
): Promise<CompletedEnrollmentPacketListItem[]> {
  const safeLimit = Math.max(1, Math.min(500, Math.trunc(filters.limit ?? 200)));
  const normalizedStatus = filters.status === "completed" ? filters.status : "all";
  const normalizedOperationalReadiness =
    filters.operationalReadiness === "operationally_ready" ||
    filters.operationalReadiness === "filed_pending_mapping" ||
    filters.operationalReadiness === "mapping_failed" ||
    filters.operationalReadiness === "not_filed"
      ? filters.operationalReadiness
      : "all";
  const fromDate = clean(filters.fromDate);
  const toDate = clean(filters.toDate);
  const searchNeedle = clean(filters.search)?.toLowerCase() ?? null;

  const admin = createSupabaseAdminClient("enrollment_packet_workflow");
  let query = admin
    .from("enrollment_packet_requests")
    .select(ENROLLMENT_PACKET_REQUEST_LIST_SELECT)
    .order("completed_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(safeLimit);

  query = query.eq("status", "completed");

  if (fromDate) {
    query = query.gte("completed_at", `${fromDate}T00:00:00`);
  }
  if (toDate) {
    query = query.lte("completed_at", `${toDate}T23:59:59`);
  }

  if (normalizedOperationalReadiness === "not_filed") {
    return [];
  }

  query = applyCompletedPacketOperationalReadinessFilter(query, normalizedOperationalReadiness);

  const searchClauses = searchNeedle ? await buildEnrollmentPacketSearchClauses(searchNeedle) : [];
  if (searchClauses.length > 0) {
    query = query.or(searchClauses.join(","));
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as unknown as EnrollmentPacketRequestRow[];
  if (rows.length === 0) return [];

  const names = await resolveEnrollmentPacketRelatedNames(rows);
  const items = rows.map((row) => buildEnrollmentPacketListPresentation(row, names));

  if (!searchNeedle) return items;

  return items.filter((item) => matchesEnrollmentPacketListSearch(item, searchNeedle));
}
