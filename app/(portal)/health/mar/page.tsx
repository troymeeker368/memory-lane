import Link from "next/link";

import { MarMonthlyReportPanelShell, MarWorkflowBoardShell } from "@/components/forms/mar-shells";
import { Card, CardTitle } from "@/components/ui/card";
import { requireModuleAccess } from "@/lib/auth";
import { getMarMonthlyReportMemberOptions } from "@/lib/services/mar-monthly-report";
import { getMarWorkflowSnapshot } from "@/lib/services/mar-workflow";

export const dynamic = "force-dynamic";

export default async function MarWorkflowPage() {
  const profile = await requireModuleAccess("health");
  const canDocument =
    profile.role === "admin" || profile.role === "nurse" || profile.role === "manager" || profile.role === "director";
  let reportMemberOptions: Awaited<ReturnType<typeof getMarMonthlyReportMemberOptions>> = [];
  let reportOptionsLoadError: string | null = null;
  try {
    reportMemberOptions = await getMarMonthlyReportMemberOptions({ serviceRole: true });
  } catch (error) {
    reportOptionsLoadError = error instanceof Error ? error.message : "Unable to load MAR report member options.";
  }
  let snapshot: Awaited<ReturnType<typeof getMarWorkflowSnapshot>> | null = null;
  let loadError: string | null = null;
  try {
    snapshot = await getMarWorkflowSnapshot({ historyLimit: 250, prnLimit: 250, serviceRole: true });
  } catch (error) {
    loadError = error instanceof Error ? error.message : "Unable to load MAR workflow.";
  }
  const isSchemaDependencyError = Boolean(loadError && loadError.toLowerCase().includes("missing supabase schema object"));

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>Medication Administration Record (MAR)</CardTitle>
        <p className="mt-1 text-sm text-muted">
          Nurse workflow seeded from active, center-given Physician Order Form medications with scheduled times.
        </p>
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          <Link href="/health" className="font-semibold text-brand">
            Back to Health Dashboard
          </Link>
          <Link href="/health/physician-orders" className="font-semibold text-brand">
            Open Physician Orders
          </Link>
        </div>
      </Card>

      {reportOptionsLoadError ? (
        <Card>
          <CardTitle>Unable to Load MAR Report Generator</CardTitle>
          <p className="mt-1 text-sm text-danger">{reportOptionsLoadError}</p>
        </Card>
      ) : (
        <MarMonthlyReportPanelShell canGenerate={canDocument} memberOptions={reportMemberOptions} />
      )}

      {loadError ? (
        <Card>
          <CardTitle>{isSchemaDependencyError ? "MAR Schema Dependency Missing" : "Unable to Load MAR Workflow"}</CardTitle>
          <p className="mt-1 text-sm text-danger">{loadError}</p>
        </Card>
      ) : snapshot ? (
        <MarWorkflowBoardShell
          canDocument={canDocument}
          todayRows={snapshot.today}
          overdueRows={snapshot.overdueToday}
          notGivenRows={snapshot.notGivenToday}
          historyRows={snapshot.history}
          prnRows={snapshot.prnLog}
          prnAwaitingOutcomeRows={snapshot.prnAwaitingOutcome}
          prnEffectiveRows={snapshot.prnEffective}
          prnIneffectiveRows={snapshot.prnIneffective}
          prnMedicationOptions={snapshot.prnMedicationOptions}
        />
      ) : null}
    </div>
  );
}
