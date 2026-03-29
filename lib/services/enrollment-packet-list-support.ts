import "server-only";

import { clean, toSummary } from "@/lib/services/enrollment-packet-core";
import {
  isEnrollmentPacketOperationallyReady,
  resolveEnrollmentPacketOperationalReadiness,
  toEnrollmentPacketMappingSyncStatus
} from "@/lib/services/enrollment-packet-readiness";
import { buildSupabaseIlikePattern } from "@/lib/services/supabase-ilike";
import type { EnrollmentPacketRequestRow } from "@/lib/services/enrollment-packet-types";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const ENROLLMENT_PACKET_SEARCH_MATCH_LIMIT = 100;

export const ENROLLMENT_PACKET_REQUEST_LIST_SELECT = [
  "id",
  "member_id",
  "lead_id",
  "sender_user_id",
  "caregiver_email",
  "status",
  "delivery_status",
  "last_delivery_attempt_at",
  "delivery_failed_at",
  "delivery_error",
  "token",
  "last_consumed_submission_token_hash",
  "token_expires_at",
  "created_at",
  "sent_at",
  "opened_at",
  "completed_at",
  "last_family_activity_at",
  "voided_at",
  "voided_by_user_id",
  "void_reason",
  "updated_at",
  "mapping_sync_status",
  "mapping_sync_error",
  "mapping_sync_attempted_at",
  "latest_mapping_run_id"
].join(", ");

type EnrollmentPacketRelatedNames = {
  memberNames: Map<string, string>;
  leadNames: Map<string, string>;
  senderNames: Map<string, string>;
};

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function canUsePacketSqlSearch(searchText: string) {
  return !/[(),]/.test(searchText);
}

async function lookupEnrollmentPacketSearchIds(input: {
  table: "members" | "leads" | "profiles";
  searchColumn: "display_name" | "member_name" | "full_name";
  searchText: string;
  admin: ReturnType<typeof createSupabaseAdminClient>;
}) {
  const { data, error } = await input.admin
    .from(input.table)
    .select("id")
    .ilike(input.searchColumn, buildSupabaseIlikePattern(input.searchText))
    .limit(ENROLLMENT_PACKET_SEARCH_MATCH_LIMIT);
  if (error) throw new Error(error.message);
  return Array.from(
    new Set(
      ((data ?? []) as Array<{ id: string | null }>)
        .map((row) => clean(row.id))
        .filter((value): value is string => Boolean(value))
    )
  );
}

export async function buildEnrollmentPacketSearchClauses(searchText: string) {
  const normalizedSearch = clean(searchText);
  if (!normalizedSearch || !canUsePacketSqlSearch(normalizedSearch)) return [];

  const admin = createSupabaseAdminClient();
  const clauses = [`caregiver_email.ilike.${buildSupabaseIlikePattern(normalizedSearch)}`];
  if (isUuid(normalizedSearch)) {
    clauses.push(`member_id.eq.${normalizedSearch}`, `lead_id.eq.${normalizedSearch}`, `sender_user_id.eq.${normalizedSearch}`);
  }

  const [matchingMemberIds, matchingLeadIds, matchingSenderIds] = await Promise.all([
    lookupEnrollmentPacketSearchIds({
      admin,
      table: "members",
      searchColumn: "display_name",
      searchText: normalizedSearch
    }),
    lookupEnrollmentPacketSearchIds({
      admin,
      table: "leads",
      searchColumn: "member_name",
      searchText: normalizedSearch
    }),
    lookupEnrollmentPacketSearchIds({
      admin,
      table: "profiles",
      searchColumn: "full_name",
      searchText: normalizedSearch
    })
  ]);

  if (matchingMemberIds.length > 0) clauses.push(`member_id.in.(${matchingMemberIds.join(",")})`);
  if (matchingLeadIds.length > 0) clauses.push(`lead_id.in.(${matchingLeadIds.join(",")})`);
  if (matchingSenderIds.length > 0) clauses.push(`sender_user_id.in.(${matchingSenderIds.join(",")})`);

  return Array.from(new Set(clauses));
}

export async function resolveEnrollmentPacketRelatedNames(rows: EnrollmentPacketRequestRow[]): Promise<EnrollmentPacketRelatedNames> {
  const admin = createSupabaseAdminClient();
  const memberIds = Array.from(new Set(rows.map((row) => row.member_id).filter(Boolean)));
  const leadIds = Array.from(new Set(rows.map((row) => row.lead_id).filter((value): value is string => Boolean(value))));
  const senderIds = Array.from(new Set(rows.map((row) => row.sender_user_id).filter(Boolean)));

  const memberNames = new Map<string, string>();
  const leadNames = new Map<string, string>();
  const senderNames = new Map<string, string>();

  if (memberIds.length > 0) {
    const { data, error } = await admin.from("members").select("id, display_name").in("id", memberIds);
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as Array<{ id: string; display_name: string | null }>) {
      memberNames.set(String(row.id), clean(row.display_name) ?? "Unknown member");
    }
  }

  if (leadIds.length > 0) {
    const { data, error } = await admin.from("leads").select("id, member_name").in("id", leadIds);
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as Array<{ id: string; member_name: string | null }>) {
      leadNames.set(String(row.id), clean(row.member_name) ?? "Unknown lead");
    }
  }

  if (senderIds.length > 0) {
    const { data, error } = await admin.from("profiles").select("id, full_name").in("id", senderIds);
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as Array<{ id: string; full_name: string | null }>) {
      senderNames.set(String(row.id), clean(row.full_name) ?? "Unknown staff");
    }
  }

  return { memberNames, leadNames, senderNames };
}

export function buildEnrollmentPacketListPresentation(
  row: EnrollmentPacketRequestRow,
  names: EnrollmentPacketRelatedNames
) {
  const summary = toSummary(row);
  const mappingSyncStatus = toEnrollmentPacketMappingSyncStatus(row.mapping_sync_status);

  return {
    ...summary,
    memberName: names.memberNames.get(row.member_id) ?? "Unknown member",
    leadMemberName: row.lead_id ? names.leadNames.get(row.lead_id) ?? null : null,
    senderName: names.senderNames.get(row.sender_user_id) ?? null,
    mappingSyncStatus,
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
}

export function matchesEnrollmentPacketListSearch(
  item: {
    memberName: string;
    leadMemberName: string | null;
    caregiverEmail: string;
    senderName: string | null;
    senderUserId: string;
    memberId: string;
    leadId: string | null;
  },
  searchNeedle: string
) {
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
}
