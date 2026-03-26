import "server-only";

import { createClient } from "@/lib/supabase/server";
import { resolveCanonicalMemberId } from "@/lib/services/canonical-person-ref";
import { listAllActiveMemberLookupSupabase, listMemberLookupSupabase } from "@/lib/services/shared-lookups-supabase";
import { buildSupabaseIlikePattern } from "@/lib/services/supabase-ilike";
import {
  PHYSICIAN_ORDER_INDEX_SELECT,
  PHYSICIAN_ORDER_MEMBER_HISTORY_SELECT,
  PHYSICIAN_ORDER_WITH_MEMBER_SELECT
} from "@/lib/services/physician-orders-selects";
import {
  buildPhysicianOrderClinicalSyncDetail,
  resolvePhysicianOrderClinicalSyncStatus,
  type PhysicianOrderClinicalSyncStatus,
  type PhysicianOrderPostSignQueueStatus
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
  PhysicianOrderIndexResult,
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

const DEFAULT_PHYSICIAN_ORDER_PAGE_SIZE = 50;
const MAX_PHYSICIAN_ORDER_SEARCH_MEMBER_MATCHES = 500;

type PhysicianOrderIndexFilters = {
  memberId?: string | null;
  status?: PhysicianOrderStatus | "all";
  q?: string;
  canonicalInput?: boolean;
  serviceRole?: boolean;
};

type PhysicianOrderQueueStatusRow = {
  status: PhysicianOrderPostSignQueueStatus;
  attemptCount: number | null;
  nextRetryAt: string | null;
  lastError: string | null;
  lastFailedStep: string | null;
};

function normalizePage(value?: number | null) {
  if (!Number.isFinite(value) || !value || value < 1) return 1;
  return Math.floor(value);
}

function normalizePageSize(value?: number | null) {
  if (!Number.isFinite(value) || !value || value < 1) return DEFAULT_PHYSICIAN_ORDER_PAGE_SIZE;
  return Math.floor(value);
}

async function buildPhysicianOrderSearchClauses(filters?: PhysicianOrderIndexFilters) {
  const queryText = clean(filters?.q);
  if (!queryText) return [];

  const pattern = buildSupabaseIlikePattern(queryText);
  const searchClauses = [`provider_name.ilike.${pattern}`, `status.ilike.${pattern}`];

  if (!filters?.memberId) {
    const matchingMembers = await listMemberLookupSupabase({
      q: queryText,
      status: "all",
      limit: MAX_PHYSICIAN_ORDER_SEARCH_MEMBER_MATCHES
    });
    const matchingMemberIds = Array.from(new Set(matchingMembers.map((member) => member.id).filter(Boolean)));
    if (matchingMemberIds.length > 0) {
      searchClauses.push(`member_id.in.(${matchingMemberIds.join(",")})`);
    }
  }

  return searchClauses;
}

function mapPhysicianOrderIndexRows(
  rows: PhysicianOrderIndexSelectRow[],
  queueStatuses: Map<string, PhysicianOrderQueueStatusRow>
) {
  return rows.map((row) => {
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
    } satisfies PhysicianOrderIndexRow;
  });
}

export async function listPhysicianOrderMemberLookup() {
  return listAllActiveMemberLookupSupabase();
}

export async function listPhysicianOrdersPage(
  filters?: PhysicianOrderIndexFilters & {
    page?: number;
    pageSize?: number;
  }
): Promise<PhysicianOrderIndexResult> {
  const supabase = await createClient({ serviceRole: Boolean(filters?.serviceRole) });
  const page = normalizePage(filters?.page);
  const pageSize = normalizePageSize(filters?.pageSize);
  let query = supabase
    .from("physician_orders")
    .select(PHYSICIAN_ORDER_INDEX_SELECT, { count: "exact" })
    .order("updated_at", { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);

  if (filters?.memberId) {
    const canonicalMemberId = await resolvePhysicianOrderMemberId(filters.memberId, "listPhysicianOrdersPage", {
      canonicalInput: filters.canonicalInput,
      serviceRole: filters.serviceRole
    });
    query = query.eq("member_id", canonicalMemberId);
  }
  if (filters?.status && filters.status !== "all") query = query.eq("status", fromStatus(filters.status));
  const searchClauses = await buildPhysicianOrderSearchClauses(filters);
  if (searchClauses.length > 0) {
    query = query.or(searchClauses.join(","));
  }

  const { data, error, count } = await query;
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
  const rows = mapPhysicianOrderIndexRows((data ?? []) as unknown as PhysicianOrderIndexSelectRow[], queueStatuses);
  const totalRows = count ?? rows.length;

  return {
    rows,
    page,
    pageSize,
    totalRows,
    totalPages: Math.max(1, Math.ceil(totalRows / pageSize))
  };
}

export async function getPhysicianOrders(filters?: PhysicianOrderIndexFilters): Promise<PhysicianOrderIndexRow[]> {
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
  const searchClauses = await buildPhysicianOrderSearchClauses(filters);
  if (searchClauses.length > 0) {
    query = query.or(searchClauses.join(","));
  }

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

  return mapPhysicianOrderIndexRows((data ?? []) as unknown as PhysicianOrderIndexSelectRow[], queueStatuses);
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
