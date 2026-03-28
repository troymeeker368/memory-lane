import { LeadsPipelineTable } from "@/components/sales/leads-pipeline-table";
import { Card, CardTitle } from "@/components/ui/card";
import { requireModuleAccess } from "@/lib/auth";
import { resolveCanonicalLeadState } from "@/lib/canonical";
import { getLeadList } from "@/lib/services/leads-read";

function firstString(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0];
  return value;
}

function parsePage(value: string | undefined) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.floor(parsed);
}

export default async function LeadsPipelineTablePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireModuleAccess("sales");
  const params = await searchParams;
  const q = firstString(params.q) ?? "";
  const stage = firstString(params.stage) ?? "";
  const status = firstString(params.status) ?? "";
  const leadSource = firstString(params.lead_source) ?? firstString(params.leadSource) ?? "";
  const likelihood = firstString(params.likelihood) ?? "";
  const sort = (firstString(params.sort) as
    | "member_name"
    | "stage"
    | "status"
    | "inquiry_date"
    | "caregiver_name"
    | "caregiver_relationship"
    | "lead_source"
    | "referral_name"
    | "likelihood"
    | "next_follow_up"
    | undefined) ?? "inquiry_date";
  const dir = (firstString(params.dir) as "asc" | "desc" | undefined) ?? "desc";
  const page = parsePage(firstString(params.page));
  const { dbStatus } = resolveCanonicalLeadState({
    requestedStage: "Inquiry",
    requestedStatus: status || "Open"
  });
  const result = await getLeadList({
    status: dbStatus,
    q: q || undefined,
    stage: (stage || undefined) as "Inquiry" | "Tour" | "Enrollment in Progress" | "Nurture" | undefined,
    leadSource: leadSource || undefined,
    likelihood: likelihood || undefined,
    sort,
    dir,
    page,
    pageSize: 25
  });

  return (
    <Card className="table-wrap">
      <CardTitle>Leads Pipeline Table</CardTitle>
      <LeadsPipelineTable
        leads={result.rows}
        initialFilters={{
          q,
          stage,
          status,
          lead_source: leadSource,
          likelihood,
          sort,
          dir
        }}
        page={result.page}
        totalRows={result.totalRows}
        totalPages={result.totalPages}
      />
    </Card>
  );
}
