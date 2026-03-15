import Link from "next/link";

import { Card, CardTitle } from "@/components/ui/card";
import { requireModuleAccess } from "@/lib/auth";
import { getSalesSummarySnapshotSupabase } from "@/lib/services/sales-crm-supabase";

function stageHref(stage: string) {
  if (stage === "Inquiry") return "/sales/pipeline/leads-table?stage=Inquiry";
  if (stage === "Tour") return "/sales/pipeline/leads-table?stage=Tour";
  if (stage === "Enrollment in Progress") return "/sales/pipeline/leads-table?stage=Enrollment%20in%20Progress";
  if (stage === "Nurture") return "/sales/pipeline/leads-table?stage=Nurture";
  if (stage === "Referrals Only") return "/sales/pipeline/leads-table?lead_source=Referral";
  if (stage === "Closed - Won") return "/sales/pipeline/closed-won";
  if (stage === "Closed - Lost") return "/sales/pipeline/closed-lost";
  return "/sales/pipeline/leads-table";
}

export default async function PipelineByStagePage() {
  await requireModuleAccess("sales");
  const { stageCounts } = await getSalesSummarySnapshotSupabase();

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
