import Link from "next/link";

import { MarWorkflowBoard } from "@/components/forms/mar-workflow-board";
import { Card, CardTitle } from "@/components/ui/card";
import { requireModuleAccess } from "@/lib/auth";
import { getMarWorkflowSnapshot } from "@/lib/services/mar-workflow";

export const dynamic = "force-dynamic";

export default async function MarWorkflowPage() {
  const profile = await requireModuleAccess("health");
  const canDocument =
    profile.role === "admin" || profile.role === "nurse" || profile.role === "manager" || profile.role === "director";
  let snapshot: Awaited<ReturnType<typeof getMarWorkflowSnapshot>> | null = null;
  let loadError: string | null = null;
  try {
    snapshot = await getMarWorkflowSnapshot({ historyLimit: 250, prnLimit: 250 });
  } catch (error) {
    loadError = error instanceof Error ? error.message : "Unable to load MAR workflow.";
  }

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

      {loadError ? (
        <Card>
          <CardTitle>MAR Schema Dependency Missing</CardTitle>
          <p className="mt-1 text-sm text-danger">{loadError}</p>
        </Card>
      ) : snapshot ? (
        <MarWorkflowBoard
          canDocument={canDocument}
          todayRows={snapshot.today}
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
