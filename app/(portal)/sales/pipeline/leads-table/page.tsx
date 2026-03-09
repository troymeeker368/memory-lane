import { LeadsPipelineTable } from "@/components/sales/leads-pipeline-table";
import { Card, CardTitle } from "@/components/ui/card";
import { requireRoles } from "@/lib/auth";
import { getSalesWorkflows } from "@/lib/services/sales-workflows";

export default async function LeadsPipelineTablePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireRoles(["admin"]);
  const params = await searchParams;
  const { openLeads } = await getSalesWorkflows();

  const stageFilter = typeof params.stage === "string" ? params.stage : "";
  const sourceFilter = typeof params.leadSource === "string" ? params.leadSource : "";

  return (
    <Card className="table-wrap">
      <CardTitle>Leads Pipeline Table</CardTitle>
      <LeadsPipelineTable
        leads={openLeads as any[]}
        initialFilters={{
          stage: stageFilter,
          lead_source: sourceFilter
        }}
      />
    </Card>
  );
}
