import { isOpenLeadStatus, resolveCanonicalLeadState } from "@/lib/canonical";
import { invokeSupabaseRpcOrThrow } from "@/lib/supabase/rpc";
import { createClient } from "@/lib/supabase/server";

type LeadSummaryLike = {
  stage: string | null | undefined;
  status: string | null | undefined;
  lead_source?: string | null | undefined;
};

export interface LeadPipelineSummary {
  open: number;
  won: number;
  lost: number;
}

export interface LeadStageOutcomeSummaryRow {
  stage: string;
  total: number;
  won: number;
  lost: number;
}

export interface LeadPipelineStageCountRow {
  stage: string;
  count: number;
}

export interface SalesPipelineSummaryCountsRow {
  ord: number;
  stage: string;
  count: number;
  open_count: number;
  won_count: number;
  lost_count: number;
  unresolved_inquiry_count: number;
}

export interface SalesPipelineSummaryCounts {
  openLeadCount: number;
  wonLeadCount: number;
  lostLeadCount: number;
  unresolvedInquiryLeadCount: number;
  stageCounts: LeadPipelineStageCountRow[];
}

const PIPELINE_STAGE_ORDER = [
  "Inquiry",
  "Tour",
  "Enrollment in Progress",
  "Nurture",
  "Referrals Only",
  "Closed - Won",
  "Closed - Lost"
] as const;
const SALES_PIPELINE_SUMMARY_COUNTS_RPC = "rpc_get_sales_pipeline_summary_counts";

function resolveCanonicalLeadStageStatus(lead: Pick<LeadSummaryLike, "stage" | "status">) {
  return resolveCanonicalLeadState({
    requestedStage: String(lead.stage ?? "Inquiry"),
    requestedStatus: String(lead.status ?? "Open")
  });
}

export function summarizeLeadPipeline(leads: LeadSummaryLike[]): LeadPipelineSummary {
  return leads.reduce<LeadPipelineSummary>(
    (summary, lead) => {
      const { status } = resolveCanonicalLeadStageStatus(lead);
      if (isOpenLeadStatus(status)) {
        summary.open += 1;
      } else if (status === "Won") {
        summary.won += 1;
      } else if (status === "Lost") {
        summary.lost += 1;
      }
      return summary;
    },
    { open: 0, won: 0, lost: 0 }
  );
}

export function buildLeadStageOutcomeSummaryRows(
  leads: Array<Pick<LeadSummaryLike, "stage" | "status">>
): LeadStageOutcomeSummaryRow[] {
  const stageCounts = new Map<string, { total: number; won: number; lost: number }>();
  leads.forEach((lead) => {
    const { stage, status } = resolveCanonicalLeadStageStatus(lead);
    const current = stageCounts.get(stage) ?? { total: 0, won: 0, lost: 0 };
    current.total += 1;
    if (status === "Won") current.won += 1;
    if (status === "Lost") current.lost += 1;
    stageCounts.set(stage, current);
  });

  return Array.from(stageCounts.entries())
    .map(([stage, counts]) => ({
      stage,
      total: counts.total,
      won: counts.won,
      lost: counts.lost
    }))
    .sort((left, right) => left.stage.localeCompare(right.stage));
}

export function buildSalesPipelineStageCounts(
  leads: Array<Pick<LeadSummaryLike, "stage" | "status" | "lead_source">>
): LeadPipelineStageCountRow[] {
  const stageTotals = new Map(
    buildLeadStageOutcomeSummaryRows(leads).map((row) => [row.stage, row.total] as const)
  );
  const referralsOnlyCount = leads.reduce((count, lead) => {
    const { status } = resolveCanonicalLeadStageStatus(lead);
    if (!isOpenLeadStatus(status)) return count;
    return String(lead.lead_source ?? "").toLowerCase().includes("referral") ? count + 1 : count;
  }, 0);

  return PIPELINE_STAGE_ORDER.map((stage) => ({
    stage,
    count: stage === "Referrals Only" ? referralsOnlyCount : stageTotals.get(stage) ?? 0
  }));
}

function parseSalesPipelineSummaryCounts(rows: SalesPipelineSummaryCountsRow[]): SalesPipelineSummaryCounts {
  if (rows.length === 0) {
    throw new Error("Unable to load sales pipeline summary counts: RPC returned no rows.");
  }

  const sortedRows = [...rows].sort((left, right) => left.ord - right.ord);
  const firstRow = sortedRows[0];
  return {
    openLeadCount: Number(firstRow.open_count ?? 0),
    wonLeadCount: Number(firstRow.won_count ?? 0),
    lostLeadCount: Number(firstRow.lost_count ?? 0),
    unresolvedInquiryLeadCount: Number(firstRow.unresolved_inquiry_count ?? 0),
    stageCounts: sortedRows.map((row) => ({
      stage: row.stage,
      count: Number(row.count ?? 0)
    }))
  };
}

export async function fetchSalesPipelineSummaryCountsSupabase(supabase: Awaited<ReturnType<typeof createClient>>) {
  const rows = await invokeSupabaseRpcOrThrow<SalesPipelineSummaryCountsRow[]>(
    supabase,
    SALES_PIPELINE_SUMMARY_COUNTS_RPC
  );
  return parseSalesPipelineSummaryCounts(rows);
}

export async function getSalesPipelineSummaryCountsSupabase() {
  const supabase = await createClient();
  return fetchSalesPipelineSummaryCountsSupabase(supabase);
}

export async function getSalesOpenLeadSummary() {
  const summary = await getSalesPipelineSummaryCountsSupabase();
  return {
    unresolvedLeads: summary.openLeadCount,
    unresolvedInquiryLeads: summary.unresolvedInquiryLeadCount
  };
}

