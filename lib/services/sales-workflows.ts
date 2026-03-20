import { isOpenLeadStatus, resolveCanonicalLeadState } from "@/lib/canonical";
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

const PIPELINE_STAGE_ORDER = [
  "Inquiry",
  "Tour",
  "Enrollment in Progress",
  "Nurture",
  "Referrals Only",
  "Closed - Won",
  "Closed - Lost"
] as const;

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

export async function getSalesOpenLeadSummary() {
  const supabase = await createClient();
  const { data: leads, error } = await supabase.from("leads").select("stage, status");
  if (error) {
    throw new Error(`Unable to load sales lead summary: ${error.message}`);
  }
  const unresolvedLeads = summarizeLeadPipeline(leads ?? []).open;
  const unresolvedInquiryLeads = (leads ?? []).reduce((count, lead) => {
    const { stage, status } = resolveCanonicalLeadStageStatus(lead);
    return isOpenLeadStatus(status) && stage === "Inquiry" ? count + 1 : count;
  }, 0);

  return {
    unresolvedLeads,
    unresolvedInquiryLeads
  };
}

