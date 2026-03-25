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

export interface SalesPipelineSummaryCounts {
  openLeadCount: number;
  wonLeadCount: number;
  lostLeadCount: number;
  unresolvedInquiryLeadCount: number;
  stageCounts: LeadPipelineStageCountRow[];
}

export type SalesDashboardSummaryRpcRow = {
  open_lead_count: number | string | null;
  won_lead_count: number | string | null;
  lost_lead_count: number | string | null;
  unresolved_inquiry_lead_count: number | string | null;
  eip_lead_count: number | string | null;
  total_lead_count: number | string | null;
  converted_or_enrolled_count: number | string | null;
  recent_inquiry_activity_count: number | string | null;
  lead_activity_count: number | string | null;
  partner_count: number | string | null;
  referral_source_count: number | string | null;
  partner_activity_count: number | string | null;
  stage_counts: unknown;
  recent_inquiries: unknown;
};

type SalesDashboardStageCountRow = {
  stage?: unknown;
  count?: unknown;
};

const PIPELINE_STAGE_ORDER = [
  "Inquiry",
  "Tour",
  "Enrollment in Progress",
  "Nurture",
  "Referrals Only",
  "Closed - Won",
  "Closed - Lost"
] as const;
const SALES_DASHBOARD_SUMMARY_RPC = "rpc_get_sales_dashboard_summary";
const SALES_DASHBOARD_SUMMARY_MIGRATION = "0129_sales_dashboard_rpc_consolidation.sql";

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

export function normalizeSalesPipelineStageCounts(payload: unknown): LeadPipelineStageCountRow[] {
  const rows = Array.isArray(payload) ? (payload as SalesDashboardStageCountRow[]) : [];
  const counts = new Map<string, number>();

  rows.forEach((row) => {
    if (typeof row.stage !== "string") return;
    counts.set(row.stage, Number(row.count ?? 0));
  });

  return PIPELINE_STAGE_ORDER.map((stage) => ({
    stage,
    count: counts.get(stage) ?? 0
  }));
}

export async function fetchSalesDashboardSummarySupabase(
  supabase: Awaited<ReturnType<typeof createClient>>,
  input?: { recentInquiryStartDate?: string | null }
) {
  try {
    const rows = await invokeSupabaseRpcOrThrow<SalesDashboardSummaryRpcRow[]>(supabase, SALES_DASHBOARD_SUMMARY_RPC, {
      p_recent_inquiry_start_date: input?.recentInquiryStartDate ?? null
    });
    return rows?.[0] ?? null;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load sales dashboard summary.";
    if (message.includes(SALES_DASHBOARD_SUMMARY_RPC)) {
      throw new Error(
        `Sales dashboard summary RPC is not available. Apply Supabase migration ${SALES_DASHBOARD_SUMMARY_MIGRATION} and refresh PostgREST schema cache.`
      );
    }
    throw error;
  }
}

export async function fetchSalesPipelineSummaryCountsSupabase(supabase: Awaited<ReturnType<typeof createClient>>) {
  const row = await fetchSalesDashboardSummarySupabase(supabase);
  if (!row) {
    throw new Error("Unable to load sales pipeline summary counts: dashboard RPC returned no rows.");
  }

  return {
    openLeadCount: Number(row.open_lead_count ?? 0),
    wonLeadCount: Number(row.won_lead_count ?? 0),
    lostLeadCount: Number(row.lost_lead_count ?? 0),
    unresolvedInquiryLeadCount: Number(row.unresolved_inquiry_lead_count ?? 0),
    stageCounts: normalizeSalesPipelineStageCounts(row.stage_counts)
  } satisfies SalesPipelineSummaryCounts;
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

