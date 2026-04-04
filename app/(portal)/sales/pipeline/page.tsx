import Link from "next/link";

import { Card, CardTitle } from "@/components/ui/card";
import { requireModuleAccess } from "@/lib/auth";
import { salesRoutes } from "@/lib/routes";

const pipelineLinks = [
  { label: "Pipeline by Stage", href: salesRoutes.pipelineByStage },
  { label: "Leads Pipeline Table", href: salesRoutes.pipelineLeadsTable },
  { label: "Follow Up Dashboard", href: salesRoutes.pipelineFollowUpDashboard },
  { label: "Enrollment Packets", href: salesRoutes.pipelineEnrollmentPackets },
  { label: "Leads - Inquiry", href: salesRoutes.pipelineInquiry },
  { label: "Leads - Tour", href: salesRoutes.pipelineTour },
  { label: "Leads - Enrollment in Progress", href: salesRoutes.pipelineEip },
  { label: "Leads - Nurture", href: salesRoutes.pipelineNurture },
  { label: "Leads - Referrals Only", href: salesRoutes.pipelineReferralsOnly },
  { label: "Closed - Won", href: salesRoutes.pipelineClosedWon },
  { label: "Closed - Lost", href: salesRoutes.pipelineClosedLost }
];

export default async function SalesPipelineMenuPage() {
  await requireModuleAccess("sales");

  return (
    <Card>
      <CardTitle>Pipeline</CardTitle>
      <div className="mt-3 divide-y divide-border rounded-lg border border-border bg-white">
        {pipelineLinks.map((item) => (
          <Link key={item.href} href={item.href} className="block px-4 py-3 text-base font-medium hover:bg-slate-50">
            {item.label}
          </Link>
        ))}
      </div>
    </Card>
  );
}
