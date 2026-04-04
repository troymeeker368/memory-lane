import Link from "next/link";

import { Card, CardTitle } from "@/components/ui/card";
import { requireModuleAccess } from "@/lib/auth";
import { salesRoutes } from "@/lib/routes";
import { getLeadSummarySnapshot } from "@/lib/services/leads-read";

function stageHref(stage: string) {
  if (stage === "Inquiry") return `${salesRoutes.pipelineLeadsTable}?stage=Inquiry`;
  if (stage === "Tour") return `${salesRoutes.pipelineLeadsTable}?stage=Tour`;
  if (stage === "Enrollment in Progress") return `${salesRoutes.pipelineLeadsTable}?stage=Enrollment%20in%20Progress`;
  if (stage === "Nurture") return `${salesRoutes.pipelineLeadsTable}?stage=Nurture`;
  if (stage === "Referrals Only") return `${salesRoutes.pipelineLeadsTable}?lead_source=Referral`;
  if (stage === "Closed - Won") return salesRoutes.pipelineClosedWon;
  if (stage === "Closed - Lost") return salesRoutes.pipelineClosedLost;
  return salesRoutes.pipelineLeadsTable;
}

export default async function PipelineByStagePage() {
  await requireModuleAccess("sales");
  const { stageCounts } = await getLeadSummarySnapshot();

  return (
    <Card>
      <CardTitle>Pipeline by Stage</CardTitle>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {stageCounts.map((item) => (
          <Link key={item.stage} href={stageHref(item.stage)} className="rounded-lg border border-border bg-white p-3 transition hover:bg-brandSoft">
            <p className="text-xs uppercase tracking-wide text-muted">{item.stage}</p>
            <p className="mt-1 text-2xl font-bold">{item.count}</p>
            <p className="mt-1 text-xs font-semibold text-brand">View Leads</p>
          </Link>
        ))}
      </div>
    </Card>
  );
}
