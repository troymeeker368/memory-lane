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
  isEnrollmentPacketOperationallyReady,
  resolveEnrollmentPacketOperationalReadiness,
  toEnrollmentPacketMappingSyncStatus
} from "@/lib/services/enrollment-packet-readiness";
import type {
  CompletedEnrollmentPacketFilters,
  CompletedEnrollmentPacketListItem,
  EnrollmentPacketRequestRow
} from "@/lib/services/enrollment-packet-types";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function listEnrollmentPacketRequestsForMember(memberId: string) {
  const normalizedMemberId = clean(memberId);
  if (!normalizedMemberId) throw new Error("Member ID is required.");
  const canonicalMemberId = await resolveCanonicalMemberId(normalizedMemberId, {
    actionLabel: "listEnrollmentPacketRequestsForMember",
    serviceRole: true
  });
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("enrollment_packet_requests")
    .select("*")
    .eq("member_id", canonicalMemberId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as EnrollmentPacketRequestRow[]).map((row) => toSummary(row));
}

export async function listActivePacketRows(memberId: string) {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("enrollment_packet_requests")
    .select("*")
    .eq("member_id", memberId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as EnrollmentPacketRequestRow[];
  return rows.filter((row) => {
    if (isExpired(row.token_expires_at)) return false;
    const status = toStatus(row.status);
    return status === "draft" || status === "sent" || status === "in_progress";
  });
}

export async function listActivePacketRowsForLead(leadId: string) {
  const normalizedLeadId = clean(leadId);
  if (!normalizedLeadId) return [];
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("enrollment_packet_requests")
    .select("*")
    .eq("lead_id", normalizedLeadId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as EnrollmentPacketRequestRow[];
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
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("enrollment_packet_requests")
    .select("*")
    .eq("lead_id", canonical.leadId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as EnrollmentPacketRequestRow[]).map((row) => toSummary(row));
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

  const admin = createSupabaseAdminClient();
  let query = admin
    .from("enrollment_packet_requests")
    .select("*")
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

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as EnrollmentPacketRequestRow[];
  if (rows.length === 0) return [];

  const memberIds = Array.from(new Set(rows.map((row) => row.member_id).filter(Boolean)));
  const leadIds = Array.from(new Set(rows.map((row) => row.lead_id).filter((value): value is string => Boolean(value))));
  const senderIds = Array.from(new Set(rows.map((row) => row.sender_user_id).filter(Boolean)));

  const memberNames = new Map<string, string>();
  if (memberIds.length > 0) {
    const { data: members, error: membersError } = await admin.from("members").select("id, display_name").in("id", memberIds);
    if (membersError) throw new Error(membersError.message);
    for (const row of (members ?? []) as Array<{ id: string; display_name: string | null }>) {
      memberNames.set(String(row.id), clean(row.display_name) ?? "Unknown member");
    }
  }

  const leadNames = new Map<string, string>();
  if (leadIds.length > 0) {
    const { data: leads, error: leadsError } = await admin.from("leads").select("id, member_name").in("id", leadIds);
    if (leadsError) throw new Error(leadsError.message);
    for (const row of (leads ?? []) as Array<{ id: string; member_name: string | null }>) {
      leadNames.set(String(row.id), clean(row.member_name) ?? "Unknown lead");
    }
  }

  const senderNames = new Map<string, string>();
  if (senderIds.length > 0) {
    const { data: senders, error: sendersError } = await admin.from("profiles").select("id, full_name").in("id", senderIds);
    if (sendersError) throw new Error(sendersError.message);
    for (const row of (senders ?? []) as Array<{ id: string; full_name: string | null }>) {
      senderNames.set(String(row.id), clean(row.full_name) ?? "Unknown staff");
    }
  }

  const items = rows.map((row) => {
    const summary = toSummary(row);
    return {
      ...summary,
      memberName: memberNames.get(row.member_id) ?? "Unknown member",
      leadMemberName: row.lead_id ? leadNames.get(row.lead_id) ?? null : null,
      senderName: senderNames.get(row.sender_user_id) ?? null,
      mappingSyncStatus: toEnrollmentPacketMappingSyncStatus(row.mapping_sync_status),
      operationalReadinessStatus: resolveEnrollmentPacketOperationalReadiness({
        status: row.status,
        mappingSyncStatus: row.mapping_sync_status
      }),
      operationallyReady: isEnrollmentPacketOperationallyReady({
        status: row.status,
        mappingSyncStatus: row.mapping_sync_status
      }),
      mappingSyncError: clean(row.mapping_sync_error)
    };
  });

  const readinessFilteredItems =
    normalizedOperationalReadiness === "all"
      ? items
      : items.filter((item) => item.operationalReadinessStatus === normalizedOperationalReadiness);

  if (!searchNeedle) return readinessFilteredItems;

  return readinessFilteredItems.filter((item) => {
    const haystack = [
      item.memberName,
      item.leadMemberName,
      item.caregiverEmail,
      item.senderName,
      item.senderUserId,
      item.memberId,
      item.leadId
    ]
      .map((value) => clean(value)?.toLowerCase())
      .filter((value): value is string => Boolean(value));
    return haystack.some((value) => value.includes(searchNeedle));
  });
}
