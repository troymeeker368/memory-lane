import Link from "next/link";

import { QuickEditAncillary } from "@/components/forms/record-actions";
import { AncillaryChargeForm } from "@/components/forms/ancillary-charge-form";
import { Card, CardTitle } from "@/components/ui/card";
import { MobileList } from "@/components/ui/mobile-list";
import { requireModuleAccess } from "@/lib/auth";
import { normalizeRoleKey } from "@/lib/permissions";
import { getAncillarySummary } from "@/lib/services/ancillary";
import { getMembers } from "@/lib/services/documentation";
import { formatDate } from "@/lib/utils";

type AncillarySummaryRow = Awaited<ReturnType<typeof getAncillarySummary>>["logs"][number];

export default async function AncillaryPage() {
  const profile = await requireModuleAccess("ancillary");
  const normalizedRole = normalizeRoleKey(profile.role);
  const canManageEntries = normalizedRole === "admin" || normalizedRole === "manager" || normalizedRole === "director";
  const showStaffColumn = normalizedRole !== "program-assistant";
  const [summary, members] = await Promise.all([getAncillarySummary(undefined, { role: profile.role, staffUserId: profile.id }), getMembers()]);

  const currentMonthRows = summary.logs.filter((row: AncillarySummaryRow) => {
    const d = new Date(row.service_date);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    return key === summary.selectedMonth;
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>Ancillary Charge Entry</CardTitle>
        <div className="mt-3">
          <AncillaryChargeForm members={members} categories={summary.categories} />
        </div>
      </Card>

      <MobileList items={summary.logs.map((row: AncillarySummaryRow) => ({ id: row.id, title: row.member_name, fields: [{ label: "Date", value: formatDate(row.service_date) }, { label: "Category", value: row.category_name }, { label: "Qty", value: String(row.quantity ?? 1) }, { label: "Amount", value: `$${(row.amount_cents / 100).toFixed(2)}` }, ...(showStaffColumn ? [{ label: "Staff", value: row.staff_name }] : [])] }))} />

      <Card className="table-wrap hidden md:block">
        <CardTitle>Recent Ancillary Charges</CardTitle>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Member</th>
              <th>Category</th>
              <th>Qty</th>
              <th>Amount</th>
              <th>Source</th>
              {showStaffColumn ? <th>Staff</th> : null}
              {canManageEntries ? <th>Edit</th> : null}
            </tr>
          </thead>
          <tbody>
            {summary.logs.map((row: AncillarySummaryRow) => (
              <tr key={row.id}>
                <td>{formatDate(row.service_date)}</td>
                <td>{row.member_name}</td>
                <td>{row.category_name}</td>
                <td>{row.quantity ?? 1}</td>
                <td>${(row.amount_cents / 100).toFixed(2)}</td>
                <td>{row.source_entity ?? "Manual"}</td>
                {showStaffColumn ? <td>{row.staff_name}</td> : null}
                {canManageEntries ? <td><QuickEditAncillary id={row.id} notes={row.notes ?? null} /></td> : null}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card className="table-wrap">
        <div className="flex items-center justify-between gap-3">
          <CardTitle>Monthly Ancillary Charges</CardTitle>
          {canManageEntries ? <Link href="/reports/monthly-ancillary" className="text-sm font-semibold text-brand">Open Member Breakdown</Link> : null}
        </div>
        <table>
          <thead><tr><th>Selected Month</th><th>Entries</th><th>Total</th></tr></thead>
          <tbody>
            <tr>
              <td>{summary.selectedMonth}</td>
              <td>{currentMonthRows.length}</td>
              <td>${(currentMonthRows.reduce((sum: number, row) => sum + row.amount_cents, 0) / 100).toFixed(2)}</td>
            </tr>
          </tbody>
        </table>
      </Card>
    </div>
  );
}

