import Link from "next/link";

import { Card, CardTitle } from "@/components/ui/card";
import { requireModuleAccess } from "@/lib/auth";

const pipelineLinks = [
  { label: "Pipeline by Stage", href: "/sales/pipeline/by-stage" },
  { label: "Leads Pipeline Table", href: "/sales/pipeline/leads-table" },
  { label: "Follow Up Dashboard", href: "/sales/pipeline/follow-up-dashboard" },
  { label: "Enrollment Packets", href: "/sales/pipeline/enrollment-packets" },
  { label: "Leads - Inquiry", href: "/sales/pipeline/inquiry" },
  { label: "Leads - Tour", href: "/sales/pipeline/tour" },
  { label: "Leads - Enrollment in Progress", href: "/sales/pipeline/eip" },
  { label: "Leads - Nurture", href: "/sales/pipeline/nurture" },
  { label: "Leads - Referrals Only", href: "/sales/pipeline/referrals-only" },
  { label: "Closed - Won", href: "/sales/pipeline/closed-won" },
  { label: "Closed - Lost", href: "/sales/pipeline/closed-lost" }
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
