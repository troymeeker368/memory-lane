import { normalizeRoleKey } from "@/lib/permissions";
import { buildMissingSchemaMessage, isMissingSchemaObjectError } from "@/lib/supabase/schema-errors";
import { createClient } from "@/lib/supabase/server";
import type { AppRole } from "@/types/app";

interface AncillaryScope {
  role?: AppRole;
  staffUserId?: string | null;
}

export async function getAncillarySummary(monthKey?: string, scope?: AncillaryScope) {
  const supabase = await createClient();

  let logsQuery = supabase
    .from("v_ancillary_charge_logs_detailed")
    .select("id, service_date, member_name, category_name, amount_cents, staff_name, quantity, source_entity, source_entity_id, reconciliation_status, reconciled_by, reconciled_at, reconciliation_note")
    .order("service_date", { ascending: false })
    .limit(100);

  // TODO(backend): ensure staff_user_id is exposed in view for strict staff-level filtering in real backend mode.
  if (scope?.role && normalizeRoleKey(scope.role) === "program-assistant" && scope.staffUserId) {
    logsQuery = logsQuery.eq("staff_user_id", scope.staffUserId);
  }

  const { data: logsData, error: logsError } = await logsQuery;
  if (logsError) {
    if (isMissingSchemaObjectError(logsError)) {
      throw new Error(
        buildMissingSchemaMessage({
          objectName: "v_ancillary_charge_logs_detailed",
          migration: "0018_runtime_mock_dependency_cleanup.sql"
        })
      );
    }
    throw new Error(logsError.message);
  }

  const [
    { data: categories, error: categoriesError },
    { data: monthly, error: monthlyError }
  ] = await Promise.all([
    supabase.from("ancillary_charge_categories").select("id, name, price_cents").order("name"),
    supabase
      .from("v_monthly_ancillary_summary")
      .select("month_label, category_name, total_count, total_amount_cents")
      .order("month_label", { ascending: false })
      .limit(100)
  ]);
  if (categoriesError) {
    if (isMissingSchemaObjectError(categoriesError)) {
      throw new Error(
        buildMissingSchemaMessage({
          objectName: "ancillary_charge_categories",
          migration: "0001_initial_schema.sql"
        })
      );
    }
    throw new Error(categoriesError.message);
  }
  if (monthlyError) {
    if (isMissingSchemaObjectError(monthlyError)) {
      throw new Error(
        buildMissingSchemaMessage({
          objectName: "v_monthly_ancillary_summary",
          migration: "0001_initial_schema.sql"
        })
      );
    }
    throw new Error(monthlyError.message);
  }

  return {
    categories: categories ?? [],
    logs: logsData ?? [],
    monthly: monthly ?? [],
    availableMonths: [],
    selectedMonth: monthKey ?? "",
    monthlyByMember: [],
    monthlyGrandTotalCents: 0
  };
}

export async function getAncillaryEntryCountLastDays(days = 30) {
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
