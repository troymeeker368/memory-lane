import type React from "react";
import Link from "next/link";

import { requireRoles } from "@/lib/auth";

const adminReportLinks = [
  { href: "/admin-reports/attendance-summary", label: "Attendance Summary" },
  { href: "/admin-reports/revenue", label: "Revenue Summary" },
  { href: "/admin-reports/on-demand", label: "On-Demand Reports" },
  { href: "/operations/payor/center-closures", label: "Center Closures" },
  { href: "/sales/summary", label: "Sales Summary" },
  { href: "/reports", label: "Operations Reports" },
  { href: "/reports/monthly-ancillary", label: "Monthly Ancillary Charges" },
  { href: "/health/care-plans/due-report", label: "Care Plan Due Report" },
  { href: "/reports/staff", label: "Staff Activity" }
];

export default async function AdminReportsLayout({ children }: { children: React.ReactNode }) {
  await requireRoles(["admin", "manager", "director", "coordinator"]);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-white p-4">
        <h1 className="text-lg font-bold text-fg">Admin Reports</h1>
        <p className="mt-1 text-sm text-muted">Operational oversight views for revenue, exports, sales, documentation, and care plan due-date management.</p>
        <div className="mt-3 grid gap-2 md:grid-cols-3">
          {adminReportLinks.map((item) => (
            <Link key={item.href} href={item.href} className="rounded-lg border border-border bg-brandSoft px-3 py-2 text-sm font-semibold text-brand">
              {item.label}
            </Link>
          ))}
        </div>
      </div>
      {children}
    </div>
  );
}

