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

const ADMIN_AUDIT_AREA_SQL_TERMS = [
  { label: "Time & Attendance", entityTypeTerms: ["time"] },
  { label: "Sales", entityTypeTerms: ["lead"] },
  { label: "Documentation", entityTypeTerms: ["photo"] },
  { label: "Transportation", entityTypeTerms: ["transport"] },
  { label: "Member", entityTypeTerms: ["member"] },
  { label: "Charges", entityTypeTerms: ["charge", "ancillary"] }
] as const;

export function resolveAdminAuditArea(entityType: string) {
  const normalized = String(entityType ?? "").toLowerCase();
  if (normalized.includes("time")) return "Time & Attendance";
  if (normalized.includes("lead")) return "Sales";
  if (normalized.includes("photo")) return "Documentation";
  if (normalized.includes("transport")) return "Transportation";
  if (normalized.includes("member")) return "Member";
  if (normalized.includes("charge") || normalized.includes("ancillary")) return "Charges";
  return "General";
}

function resolveAdminAuditAreaSqlFilter(areaFilter: string) {
  if (!areaFilter) return null;
  const terms = ADMIN_AUDIT_AREA_SQL_TERMS.filter(({ label }) => label.toLowerCase().includes(areaFilter)).flatMap(
    ({ entityTypeTerms }) => entityTypeTerms
  );
  if (terms.length === 0) return null;
  return Array.from(new Set(terms)).map((term) => `entity_type.ilike.%${term}%`).join(",");
}

export async function listAdminAuditTrailRows(input?: {
  actionFilter?: string | null;
  areaFilter?: string | null;
  limit?: number;
}) {
  const actionFilter = String(input?.actionFilter ?? "").trim();
  const areaFilter = String(input?.areaFilter ?? "").trim().toLowerCase();
  const limit = Number.isFinite(input?.limit) ? Math.max(1, Number(input?.limit)) : 1000;

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
  const { data: auditRows, error } = await query.limit(limit);
  if (error) {
    throw new Error(error.message);
  }

  const actorIds = Array.from(
    new Set(
      (auditRows ?? [])
        .map((row: any) => row.actor_user_id)
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
    (profiles ?? []).forEach((profile: any) => {
      profileNameById.set(String(profile.id), String(profile.full_name ?? ""));
    });
  }

  return ((auditRows ?? []) as Omit<AdminAuditTrailRow, "actor_name">[])
    .map((row) => ({
      ...row,
      actor_name: row.actor_user_id ? profileNameById.get(row.actor_user_id) ?? null : null
    }))
    .filter((row) => (areaFilter ? resolveAdminAuditArea(row.entity_type).toLowerCase().includes(areaFilter) : true));
}
