import { createClient } from "@/lib/supabase/server";
import { invokeSupabaseRpcOrThrow } from "@/lib/supabase/rpc";
import { fetchSalesPipelineSummaryCountsSupabase } from "@/lib/services/sales-workflows";

type ReportsHomeStaffProductivityRow = {
  staff_name: string;
  activity_logs: number | string | null;
  toilet_logs: number | string | null;
  shower_logs: number | string | null;
  transportation_logs: number | string | null;
};

type ReportsHomeTimeSummaryRow = {
  staff_name: string;
  punches: number | string | null;
  outside_fence: number | string | null;
};

type ReportsHomeAggregatesRpcRow = {
  staff_productivity: unknown;
  time_summary: unknown;
};

const REPORTS_HOME_AGGREGATES_RPC = "rpc_get_reports_home_staff_aggregates";
const REPORTS_HOME_AGGREGATES_MIGRATION = "0145_reports_and_member_files_read_rpcs.sql";

function toNumber(value: number | string | null | undefined) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function parseStaffProductivityRows(payload: unknown) {
  const rows = Array.isArray(payload) ? (payload as ReportsHomeStaffProductivityRow[]) : [];
  return rows.map((row) => ({
    staff_name: String(row.staff_name ?? "Unknown Staff"),
    activity_logs: toNumber(row.activity_logs),
    toilet_logs: toNumber(row.toilet_logs),
    shower_logs: toNumber(row.shower_logs),
    transportation_logs: toNumber(row.transportation_logs)
  }));
}

function parseTimeSummaryRows(payload: unknown) {
  const rows = Array.isArray(payload) ? (payload as ReportsHomeTimeSummaryRow[]) : [];
  return rows.map((row) => ({
    staff_name: String(row.staff_name ?? "Unknown Staff"),
    punches: toNumber(row.punches),
    outside_fence: toNumber(row.outside_fence)
  }));
}

export async function getOperationsReports() {
  const supabase = await createClient();
  const [
    aggregateRows,
    { data: ancillaryRows, error: ancillaryError },
    pipelineSummary
  ] = await Promise.all([
    invokeSupabaseRpcOrThrow<ReportsHomeAggregatesRpcRow[]>(supabase, REPORTS_HOME_AGGREGATES_RPC, {}).catch((error) => {
      const message = error instanceof Error ? error.message : "Unable to load reports home aggregates.";
      if (message.includes(REPORTS_HOME_AGGREGATES_RPC)) {
        throw new Error(
          `Reports home aggregates RPC is not available. Apply Supabase migration ${REPORTS_HOME_AGGREGATES_MIGRATION} and refresh PostgREST schema cache.`
        );
      }
      throw error;
    }),
    supabase.from("v_monthly_ancillary_summary").select("month_label, total_amount_cents"),
    fetchSalesPipelineSummaryCountsSupabase(supabase)
  ]);
  if (ancillaryError) throw new Error(`Unable to load v_monthly_ancillary_summary: ${ancillaryError.message}`);
  const aggregateRow = aggregateRows?.[0];
  if (!aggregateRow) {
    throw new Error("Reports home aggregates RPC returned no rows.");
  }

  const pipeline = {
    open: pipelineSummary.openLeadCount,
    won: pipelineSummary.wonLeadCount,
    lost: pipelineSummary.lostLeadCount
  };

  const ancillaryByMonth = new Map<string, number>();
  (ancillaryRows ?? []).forEach((row) => {
    ancillaryByMonth.set(row.month_label, (ancillaryByMonth.get(row.month_label) ?? 0) + Number(row.total_amount_cents ?? 0));
  });
  const ancillaryMonthlyRows = Array.from(ancillaryByMonth.entries()).map(([month, total_cents]) => ({ month, total_cents }));

  return {
    staffProductivity: parseStaffProductivityRows(aggregateRow.staff_productivity),
    timeSummary: parseTimeSummaryRows(aggregateRow.time_summary),
    pipeline,
    ancillaryMonthlyRows
  };
}
