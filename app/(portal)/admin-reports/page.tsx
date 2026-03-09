import Link from "next/link";

import { Card, CardTitle } from "@/components/ui/card";

export default function AdminReportsHomePage() {
  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>Admin Oversight</CardTitle>
        <p className="mt-1 text-sm text-muted">Use the linked operational reports for documentation timeliness, ancillary billing review, payroll/time oversight, and care plan due tracking.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link href="/reports" className="rounded-lg border border-border bg-brandSoft px-3 py-2 text-sm font-semibold text-brand">Open Reports</Link>
          <Link href="/reports/monthly-ancillary" className="rounded-lg border border-border bg-brandSoft px-3 py-2 text-sm font-semibold text-brand">Monthly Ancillary</Link>
          <Link href="/health/care-plans/due-report" className="rounded-lg border border-border bg-brandSoft px-3 py-2 text-sm font-semibold text-brand">Care Plan Due Report</Link>
          <Link href="/reports/staff" className="rounded-lg border border-border bg-brandSoft px-3 py-2 text-sm font-semibold text-brand">Staff Activity</Link>
          <Link href="/admin-reports/audit-trail" className="rounded-lg border border-border bg-brandSoft px-3 py-2 text-sm font-semibold text-brand">Audit Trail</Link>
        </div>
      </Card>
    </div>
  );
}

