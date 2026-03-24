import { createClient } from "@/lib/supabase/server";

export interface AdminAuditTrailRow {
  id: string;
  actor_user_id: string | null;
  actor_role: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details: unknown;
  created_at: string;
  actor_name: string | null;
}

export interface AdminAuditTrailListResult {
  rows: AdminAuditTrailRow[];
  page: number;
  pageSize: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
}

const DEFAULT_AUDIT_TRAIL_PAGE_SIZE = 50;
const MAX_AUDIT_TRAIL_PAGE_SIZE = 200;

const ADMIN_AUDIT_AREA_SQL_TERMS = [
  { label: "Time & Attendance", entityTypeTerms: ["time", "attendance", "punch"] },
  { label: "Sales", entityTypeTerms: ["lead", "partner", "referral"] },
  { label: "Documentation", entityTypeTerms: ["documentation", "photo", "daily_activity", "toilet", "shower", "blood_sugar", "incident"] },
  { label: "Transportation", entityTypeTerms: ["transport"] },
  { label: "Member", entityTypeTerms: ["member", "care_plan", "physician_order", "pof", "intake"] },
  { label: "Charges", entityTypeTerms: ["charge", "ancillary", "pricing"] }
] as const;

export function resolveAdminAuditArea(entityType: string) {
  const normalized = String(entityType ?? "").toLowerCase();
  const matchedArea = ADMIN_AUDIT_AREA_SQL_TERMS.find(({ entityTypeTerms }) =>
    entityTypeTerms.some((term) => normalized.includes(term))
  );
  if (matchedArea) {
    return matchedArea.label;
  }
  return "General";
}

function resolveAdminAuditAreaSqlFilter(areaFilter: string) {
  if (!areaFilter) return null;
  const matchingAreas = ADMIN_AUDIT_AREA_SQL_TERMS.filter(({ label, entityTypeTerms }) => {
    const normalizedLabel = label.toLowerCase();
    return normalizedLabel.includes(areaFilter) || entityTypeTerms.some((term) => term.includes(areaFilter));
  });
  const terms: string[] = matchingAreas.flatMap(({ entityTypeTerms }) => entityTypeTerms);
  if (terms.length === 0) {
    terms.push(areaFilter);
  }
  if (terms.length === 0) return null;
  return Array.from(new Set(terms)).map((term) => `entity_type.ilike.%${term}%`).join(",");
}

export async function listAdminAuditTrailRows(input?: {
  actionFilter?: string | null;
  areaFilter?: string | null;
  page?: number;
  pageSize?: number;
}): Promise<AdminAuditTrailListResult> {
  const actionFilter = String(input?.actionFilter ?? "").trim();
  const areaFilter = String(input?.areaFilter ?? "").trim().toLowerCase();
  const page = Number.isFinite(input?.page) ? Math.max(1, Math.floor(Number(input?.page))) : 1;
  const pageSize = Number.isFinite(input?.pageSize)
    ? Math.min(MAX_AUDIT_TRAIL_PAGE_SIZE, Math.max(1, Math.floor(Number(input?.pageSize))))
    : DEFAULT_AUDIT_TRAIL_PAGE_SIZE;
  const rangeStart = (page - 1) * pageSize;
  const rangeEnd = rangeStart + pageSize;

  const supabase = await createClient();
  let query = supabase
    .from("audit_logs")
    .select("id, actor_user_id, actor_role, action, entity_type, entity_id, details, created_at")
    .order("created_at", { ascending: false });
  if (actionFilter) {
    query = query.eq("action", actionFilter);
  }
  const areaSqlFilter = resolveAdminAuditAreaSqlFilter(areaFilter);
  if (areaSqlFilter) {
    query = query.or(areaSqlFilter);
  }
  const { data: auditRows, error } = await query.range(rangeStart, rangeEnd);
  if (error) {
    throw new Error(error.message);
  }
  const pageRows = (auditRows ?? []).slice(0, pageSize);
  const hasNextPage = (auditRows?.length ?? 0) > pageSize;

  const actorIds = Array.from(
    new Set(
      pageRows
    .map((row) => row.actor_user_id)
        .filter((value: string | null): value is string => Boolean(value))
    )
  );
  const profileNameById = new Map<string, string>();
  if (actorIds.length > 0) {
    const { data: profiles, error: profilesError } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", actorIds);
    if (profilesError) {
      throw new Error(profilesError.message);
    }
  (profiles ?? []).forEach((profile) => {
      profileNameById.set(String(profile.id), String(profile.full_name ?? ""));
    });
  }

  return {
    rows: (pageRows as Omit<AdminAuditTrailRow, "actor_name">[]).map((row) => ({
      ...row,
      actor_name: row.actor_user_id ? profileNameById.get(row.actor_user_id) ?? null : null
    })),
    page,
    pageSize,
    hasPreviousPage: page > 1,
    hasNextPage
  };
}
