import Link from "next/link";

import { refreshMarWorkflowAction } from "@/app/(portal)/health/mar/administration-actions";
import { MarMonthlyReportPanelShell, MarWorkflowBoardShell } from "@/components/forms/mar-shells";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { requireMarAccess } from "@/lib/auth";
import { canAccessPhysicianOrders, canDocumentMar } from "@/lib/permissions";
import { getMarMemberOptionSets } from "@/lib/services/mar-member-options";
import { getMarWorkflowSnapshot } from "@/lib/services/mar-workflow-read";

// MAR is session-scoped and time-sensitive; today's/overdue views depend on current time.
export const dynamic = "force-dynamic";

const MAR_FIRST_LOAD_HISTORY_LIMIT = 100;
const MAR_FIRST_LOAD_NOT_GIVEN_LIMIT = 100;
const MAR_FIRST_LOAD_PRN_LIMIT = 100;

export default async function MarWorkflowPage() {
  const profile = await requireMarAccess();
  const canDocument = canDocumentMar(profile);
  const canViewPhysicianOrders = canAccessPhysicianOrders(profile);
  const memberOptionSetsPromise = getMarMemberOptionSets({ serviceRole: false });
  const snapshotPromise = getMarWorkflowSnapshot({
    historyLimit: MAR_FIRST_LOAD_HISTORY_LIMIT,
    notGivenLimit: MAR_FIRST_LOAD_NOT_GIVEN_LIMIT,
    prnLimit: MAR_FIRST_LOAD_PRN_LIMIT,
    serviceRole: false,
    memberOptionsFallback: []
  });
  const [memberOptionSetsResult, snapshotResult] = await Promise.allSettled([
    memberOptionSetsPromise,
    snapshotPromise
  ]);
  let reportMemberOptions: Awaited<ReturnType<typeof getMarMemberOptionSets>>["reportOptions"] = [];
  let reportOptionsLoadError: string | null = null;
  if (memberOptionSetsResult.status === "fulfilled") {
    reportMemberOptions = memberOptionSetsResult.value.reportOptions;
  } else {
    reportOptionsLoadError =
      memberOptionSetsResult.reason instanceof Error
        ? memberOptionSetsResult.reason.message
        : "Unable to load MAR report member options.";
  }
  let snapshot: Awaited<ReturnType<typeof getMarWorkflowSnapshot>> | null = null;
  let loadError: string | null = null;
  if (snapshotResult.status === "fulfilled") {
    snapshot = snapshotResult.value;
  } else {
    loadError = snapshotResult.reason instanceof Error ? snapshotResult.reason.message : "Unable to load MAR workflow.";
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
          {canViewPhysicianOrders ? (
            <Link href="/health/physician-orders" className="font-semibold text-brand">
              Open Physician Orders
            </Link>
          ) : null}
          <form action={refreshMarWorkflowAction}>
            <Button type="submit" className="h-auto px-3 py-2 text-sm">
              Refresh MAR schedules and PRN sync
            </Button>
          </form>
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
          memberOptions={snapshot.memberOptions}
        />
      ) : null}
    </div>
  );
}
