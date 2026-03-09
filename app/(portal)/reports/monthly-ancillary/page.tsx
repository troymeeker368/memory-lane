import { MonthlyAncillaryReport } from "@/components/reports/monthly-ancillary-report";
import { requireRoles } from "@/lib/auth";
import { getAncillarySummary } from "@/lib/services/ancillary";

export default async function MonthlyAncillaryPage() {
  await requireRoles(["admin", "manager"]);
  const summary = await getAncillarySummary();

  return (
    <MonthlyAncillaryReport
      availableMonths={summary.availableMonths}
      selectedMonth={summary.selectedMonth}
      logs={summary.logs}
    />
  );
}
