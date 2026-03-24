import "server-only";

import { createClient } from "@/lib/supabase/server";
import { resolveCanonicalMemberId } from "@/lib/services/canonical-person-ref";
import { listActiveMemberLookupSupabase } from "@/lib/services/shared-lookups-supabase";
import {
  PHYSICIAN_ORDER_INDEX_SELECT,
  PHYSICIAN_ORDER_MEMBER_HISTORY_SELECT,
  PHYSICIAN_ORDER_WITH_MEMBER_SELECT
} from "@/lib/services/physician-orders-selects";
import {
  buildPhysicianOrderClinicalSyncDetail,
  resolvePhysicianOrderClinicalSyncStatus,
  type PhysicianOrderClinicalSyncStatus
} from "@/lib/services/physician-order-clinical-sync";
import {
  clean,
  fromStatus,
  isMissingPhysicianOrdersTableError,
  physicianOrdersTableRequiredError,
  resolveRenewalStatus,
  rowToForm,
  toStatus
} from "@/lib/services/physician-order-core";
import { loadPostSignQueueStatusByPofIds } from "@/lib/services/physician-order-post-sign-runtime";
import type {
  PhysicianOrderIndexRow,
  PhysicianOrderMemberHistoryRow,
  PhysicianOrderStatus
} from "@/lib/services/physician-order-model";

type ResolvePhysicianOrderMemberOptions = {
  canonicalInput?: boolean;
  serviceRole?: boolean;
};

async function resolvePhysicianOrderMemberId(
  rawMemberId: string,
  actionLabel: string,
  options?: ResolvePhysicianOrderMemberOptions
) {
  if (options?.canonicalInput) return rawMemberId;
  return resolveCanonicalMemberId(rawMemberId, {
    actionLabel,
    serviceRole: options?.serviceRole
  });
}

type PhysicianOrderIndexSelectRow = {
  id: string;
  member_id: string;
  members: Array<{ display_name: string | null }> | { display_name: string | null } | null;
  status: string | null;
  level_of_care: string | null;
  provider_name: string | null;
  sent_at: string | null;
  next_renewal_due_date: string | null;
  signed_at: string | null;
  updated_at: string;
};

type PhysicianOrderMemberHistorySelectRow = {
  id: string;
  member_id: string;
  member_name_snapshot: string | null;
  status: string | null;
  provider_name: string | null;
  sent_at: string | null;
  next_renewal_due_date: string | null;
  signed_at: string | null;
  updated_by_name: string | null;
  updated_at: string;
};

export async function listPhysicianOrderMemberLookup() {
  return listActiveMemberLookupSupabase();
}

export async function getPhysicianOrders(filters?: {
  memberId?: string | null;
  status?: PhysicianOrderStatus | "all";
  q?: string;
  canonicalInput?: boolean;
  serviceRole?: boolean;
}): Promise<PhysicianOrderIndexRow[]> {
  const supabase = await createClient({ serviceRole: Boolean(filters?.serviceRole) });
  let query = supabase
    .from("physician_orders")
    .select(PHYSICIAN_ORDER_INDEX_SELECT)
    .order("updated_at", { ascending: false });

  if (filters?.memberId) {
    const canonicalMemberId = await resolvePhysicianOrderMemberId(filters.memberId, "getPhysicianOrders", {
      canonicalInput: filters.canonicalInput,
      serviceRole: filters.serviceRole
    });
    query = query.eq("member_id", canonicalMemberId);
  }
  if (filters?.status && filters.status !== "all") query = query.eq("status", fromStatus(filters.status));

  const { data, error } = await query;
  if (error) {
    if (isMissingPhysicianOrdersTableError(error)) {
      throw physicianOrdersTableRequiredError();
    }
    throw new Error(error.message);
  }

  const queueStatuses = await loadPostSignQueueStatusByPofIds(
    ((data ?? []) as Array<{ id: string }>).map((row) => String(row.id)),
    { serviceRole: true }
  );

  return ((data ?? []) as unknown as PhysicianOrderIndexSelectRow[])
    .map((row) => {
      const memberRelation = Array.isArray(row.members) ? row.members[0] ?? null : row.members;
      const status = toStatus(row.status);
      const queueStatus = queueStatuses.get(String(row.id)) ?? null;
      const clinicalSyncStatus = resolvePhysicianOrderClinicalSyncStatus({
        status,
        queueStatus: queueStatus?.status ?? null,
        lastError: queueStatus?.lastError ?? null,
        lastFailedStep: queueStatus?.lastFailedStep ?? null
      });
      return {
        id: row.id,
        memberId: row.member_id,
        memberName: memberRelation?.display_name ?? "Unknown Member",
        status,
        levelOfCare: row.level_of_care,
        providerName: row.provider_name,
        completedDate: row.sent_at ? String(row.sent_at).slice(0, 10) : null,
        nextRenewalDueDate: row.next_renewal_due_date,
        renewalStatus: resolveRenewalStatus(row.next_renewal_due_date),
        signedDate: row.signed_at ? String(row.signed_at).slice(0, 10) : null,
        clinicalSyncStatus,
        clinicalSyncDetail: buildPhysicianOrderClinicalSyncDetail({
          status,
          queueStatus: queueStatus?.status ?? null,
          attemptCount: queueStatus?.attemptCount ?? null,
          nextRetryAt: queueStatus?.nextRetryAt ?? null,
          lastError: queueStatus?.lastError ?? null,
          lastFailedStep: queueStatus?.lastFailedStep ?? null
        }),
        updatedAt: row.updated_at
      };
    })
    .filter((row) => {
      const q = (filters?.q ?? "").trim().toLowerCase();
      if (!q) return true;
      return (
        row.memberName.toLowerCase().includes(q) ||
        String(row.providerName ?? "").toLowerCase().includes(q) ||
        row.status.toLowerCase().includes(q)
      );
    });
}

export async function getPhysicianOrdersForMember(
  memberId: string,
  options?: ResolvePhysicianOrderMemberOptions
): Promise<PhysicianOrderMemberHistoryRow[]> {
  const canonicalMemberId = await resolvePhysicianOrderMemberId(memberId, "getPhysicianOrdersForMember", options);
  const supabase = await createClient({ serviceRole: Boolean(options?.serviceRole) });
  const { data, error } = await supabase
    .from("physician_orders")
    .select(PHYSICIAN_ORDER_MEMBER_HISTORY_SELECT)
    .eq("member_id", canonicalMemberId)
    .order("updated_at", { ascending: false });
  if (error) {
    if (isMissingPhysicianOrdersTableError(error)) {
      throw physicianOrdersTableRequiredError();
    }
    throw new Error(error.message);
  }
  const rows = (data ?? []) as unknown as PhysicianOrderMemberHistorySelectRow[];
  const queueStatuses = await loadPostSignQueueStatusByPofIds(
    rows.map((row) => String(row.id)),
    { serviceRole: true }
  );
  return rows.map((row) => {
    const status = toStatus(row.status);
    const queueStatus = queueStatuses.get(String(row.id)) ?? null;
    const clinicalSyncStatus = resolvePhysicianOrderClinicalSyncStatus({
      status,
      queueStatus: queueStatus?.status ?? null,
      lastError: queueStatus?.lastError ?? null,
      lastFailedStep: queueStatus?.lastFailedStep ?? null
    });
    return {
      id: row.id,
      memberId: row.member_id,
      memberNameSnapshot: clean(row.member_name_snapshot) ?? "Unknown Member",
      status,
      providerName: clean(row.provider_name),
      completedDate: row.sent_at ? String(row.sent_at).slice(0, 10) : null,
      nextRenewalDueDate: row.next_renewal_due_date ?? null,
      signedDate: row.signed_at ? String(row.signed_at).slice(0, 10) : null,
      clinicalSyncStatus,
      clinicalSyncDetail: buildPhysicianOrderClinicalSyncDetail({
        status,
        queueStatus: queueStatus?.status ?? null,
        attemptCount: queueStatus?.attemptCount ?? null,
        nextRetryAt: queueStatus?.nextRetryAt ?? null,
        lastError: queueStatus?.lastError ?? null,
        lastFailedStep: queueStatus?.lastFailedStep ?? null
      }),
      updatedByName: clean(row.updated_by_name),
      updatedAt: row.updated_at
    };
  });
}

export async function getActivePhysicianOrderForMember(memberId: string, options?: ResolvePhysicianOrderMemberOptions) {
  const canonicalMemberId = await resolvePhysicianOrderMemberId(memberId, "getActivePhysicianOrderForMember", options);
  const supabase = await createClient({ serviceRole: Boolean(options?.serviceRole) });
  const { data, error } = await supabase
    .from("physician_orders")
    .select(PHYSICIAN_ORDER_WITH_MEMBER_SELECT)
    .eq("member_id", canonicalMemberId)
    .eq("is_active_signed", true)
    .maybeSingle();
  if (error) {
    if (isMissingPhysicianOrdersTableError(error)) throw physicianOrdersTableRequiredError();
    throw new Error(error.message);
  }
  if (!data) return null;
  const queueStatuses = await loadPostSignQueueStatusByPofIds([String((data as { id: string }).id)], {
    serviceRole: true
  });
  const queueStatus = queueStatuses.get(String((data as { id: string }).id)) ?? null;
  const status = toStatus((data as { status: string }).status);
  const clinicalSyncStatus = resolvePhysicianOrderClinicalSyncStatus({
    status,
    queueStatus: queueStatus?.status ?? null,
    lastError: queueStatus?.lastError ?? null,
    lastFailedStep: queueStatus?.lastFailedStep ?? null
  });
  return rowToForm(
    data,
    clinicalSyncStatus,
    buildPhysicianOrderClinicalSyncDetail({
      status,
      queueStatus: queueStatus?.status ?? null,
      attemptCount: queueStatus?.attemptCount ?? null,
      nextRetryAt: queueStatus?.nextRetryAt ?? null,
      lastError: queueStatus?.lastError ?? null,
      lastFailedStep: queueStatus?.lastFailedStep ?? null
    })
  );
}

export async function getPhysicianOrderById(
  pofId: string,
  options?: {
    serviceRole?: boolean;
  }
) {
  const supabase = await createClient({ serviceRole: options?.serviceRole });
  const { data, error } = await supabase
    .from("physician_orders")
    .select(PHYSICIAN_ORDER_WITH_MEMBER_SELECT)
    .eq("id", pofId)
    .maybeSingle();
  if (error) {
    if (isMissingPhysicianOrdersTableError(error)) throw physicianOrdersTableRequiredError();
    throw new Error(error.message);
  }
  if (!data) return null;
  const queueStatuses = await loadPostSignQueueStatusByPofIds([String((data as { id: string }).id)], {
    serviceRole: true
  });
  const queueStatus = queueStatuses.get(String((data as { id: string }).id)) ?? null;
  const status = toStatus((data as { status: string }).status);
  const clinicalSyncStatus = resolvePhysicianOrderClinicalSyncStatus({
    status,
    queueStatus: queueStatus?.status ?? null,
    lastError: queueStatus?.lastError ?? null,
    lastFailedStep: queueStatus?.lastFailedStep ?? null
  });
  return rowToForm(
    data,
    clinicalSyncStatus,
    buildPhysicianOrderClinicalSyncDetail({
      status,
      queueStatus: queueStatus?.status ?? null,
      attemptCount: queueStatus?.attemptCount ?? null,
      nextRetryAt: queueStatus?.nextRetryAt ?? null,
      lastError: queueStatus?.lastError ?? null,
      lastFailedStep: queueStatus?.lastFailedStep ?? null
    })
  );
}

export async function getPhysicianOrderClinicalSyncState(
  pofId: string,
  options?: {
    serviceRole?: boolean;
  }
): Promise<PhysicianOrderClinicalSyncStatus> {
  const form = await getPhysicianOrderById(pofId, { serviceRole: options?.serviceRole });
  return form?.clinicalSyncStatus ?? "not_signed";
}

export async function getMemberHealthProfile(memberId: string, options?: ResolvePhysicianOrderMemberOptions) {
  const canonicalMemberId = await resolvePhysicianOrderMemberId(memberId, "getMemberHealthProfile", options);
  const supabase = await createClient({ serviceRole: Boolean(options?.serviceRole) });
  const { data, error } = await supabase
    .from("member_health_profiles")
    .select("*")
    .eq("member_id", canonicalMemberId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}
