import Link from "next/link";
import type { ReactNode } from "react";

import { Card, CardTitle } from "@/components/ui/card";
import { requireRoles } from "@/lib/auth";

const TABS = [
  { href: "/operations/payor", label: "Billing Hub" },
  { href: "/operations/payor/billing-agreements", label: "Billing Agreements" },
  { href: "/operations/payor/center-closures", label: "Center Closures" },
  { href: "/operations/payor/schedule-templates", label: "Schedule Templates" },
  { href: "/operations/payor/variable-charges", label: "Variable Charges Queue" },
  { href: "/operations/payor/billing-batches", label: "Billing Batches" },
  { href: "/operations/payor/custom-invoices", label: "Custom Invoices" },
  { href: "/operations/payor/invoices/draft", label: "Draft Invoices" },
  { href: "/operations/payor/invoices/finalized", label: "Finalized Invoices" },
  { href: "/operations/payor/exports", label: "Exports" },
  { href: "/operations/payor/revenue-dashboard", label: "Revenue Dashboard" }
] as const;

export default async function BillingLayout({ children }: { children: ReactNode }) {
  await requireRoles(["admin", "manager", "director", "coordinator"]);

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>Billing</CardTitle>
        <p className="mt-1 text-sm text-muted">
          Hybrid monthly billing: next-month base attendance in advance plus prior-month variable charges in arrears.
        </p>
      </Card>

      <Card>
        <div className="flex flex-wrap gap-2">
          {TABS.map((tab) => (
            <Link key={tab.href} href={tab.href} className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-brand">
              {tab.label}
            </Link>
          ))}
        </div>
      </Card>

      {children}
    </div>
  );
}
