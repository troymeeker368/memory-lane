import { getMockAncillarySummary } from "@/lib/mock-data";
import { getMockDb } from "@/lib/mock-repo";
import { isMockMode } from "@/lib/runtime";
import { createClient } from "@/lib/supabase/server";
import type { AppRole } from "@/types/app";

interface AncillaryScope {
  role?: AppRole;
  staffUserId?: string | null;
}

export async function getAncillarySummary(monthKey?: string, scope?: AncillaryScope) {
  if (isMockMode()) {
    // TODO(backend): Remove mock branch when ancillary data is loaded from Supabase in local/dev.
    return getMockAncillarySummary(monthKey, {
      staffUserId: scope?.role === "staff" ? scope.staffUserId ?? null : null
    });
  }

  const supabase = await createClient();

  let logsQuery = supabase
    .from("v_ancillary_charge_logs_detailed")
    .select("id, service_date, member_name, category_name, amount_cents, staff_name, quantity, source_entity, source_entity_id, reconciliation_status, reconciled_by, reconciled_at, reconciliation_note")
    .order("service_date", { ascending: false })
    .limit(100);

  // TODO(backend): ensure staff_user_id is exposed in view for strict staff-level filtering in real backend mode.
  if (scope?.role === "staff" && scope.staffUserId) {
    logsQuery = logsQuery.eq("staff_user_id", scope.staffUserId);
  }

  let logsResult: { data: any[] | null; error?: unknown } | null = null;
  try {
    const result = await logsQuery;
    logsResult = { data: (result.data as any[] | null) ?? null, error: result.error };
  } catch {
    logsResult = null;
  }

  // Fallback for backend views that do not yet expose reconciliation columns.
  if (!logsResult || logsResult.error) {
    let fallbackLogsQuery = supabase
      .from("v_ancillary_charge_logs_detailed")
      .select("id, service_date, member_name, category_name, amount_cents, staff_name, quantity, source_entity, source_entity_id")
      .order("service_date", { ascending: false })
      .limit(100);

    if (scope?.role === "staff" && scope.staffUserId) {
      fallbackLogsQuery = fallbackLogsQuery.eq("staff_user_id", scope.staffUserId);
    }

    const fallbackResult = await fallbackLogsQuery;
    logsResult = {
      ...fallbackResult,
      data:
        fallbackResult.data?.map((row) => ({
          ...row,
          reconciliation_status: "open",
          reconciled_by: null,
          reconciled_at: null,
          reconciliation_note: null
        })) ?? null
    };
  }

  const [{ data: categories }, { data: monthly }] = await Promise.all([
    supabase.from("ancillary_charge_categories").select("id, name, price_cents").order("name"),
    supabase
      .from("v_monthly_ancillary_summary")
      .select("month_label, category_name, total_count, total_amount_cents")
      .order("month_label", { ascending: false })
      .limit(100)
  ]);

  return {
    categories: categories ?? [],
    logs: logsResult?.data ?? [],
    monthly: monthly ?? [],
    availableMonths: [],
    selectedMonth: monthKey ?? "",
    monthlyByMember: [],
    monthlyGrandTotalCents: 0
  };
}

export async function getAncillaryEntryCountLastDays(days = 30) {
  if (isMockMode()) {
    const db = getMockDb();
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    start.setDate(start.getDate() - (days - 1));
    return db.ancillaryLogs.filter((row) => new Date(`${row.service_date}T12:00:00.000`) >= start).length;
  }

  const supabase = await createClient();
  const since = new Date();
  since.setDate(since.getDate() - (days - 1));
  const sinceDate = since.toISOString().slice(0, 10);

  const { count } = await supabase
    .from("v_ancillary_charge_logs_detailed")
    .select("id", { head: true, count: "exact" })
    .gte("service_date", sinceDate);

  return count ?? 0;
}
