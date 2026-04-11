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
const MAR_FIRST_LOAD_TODAY_LIMIT = 150;
const MAR_FIRST_LOAD_OVERDUE_LIMIT = 150;

export default async function MarWorkflowPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const queueParam = Array.isArray(resolvedSearchParams?.queue) ? resolvedSearchParams?.queue[0] : resolvedSearchParams?.queue;
  const isFullQueueMode = queueParam === "full";
  const profile = await requireMarAccess();
  const canDocument = canDocumentMar(profile);
  const canViewPhysicianOrders = canAccessPhysicianOrders(profile);
  const memberOptionSetsPromise = getMarMemberOptionSets({ serviceRole: false });
  const snapshotPromise = getMarWorkflowSnapshot({
    todayLimit: isFullQueueMode ? 500 : MAR_FIRST_LOAD_TODAY_LIMIT,
    overdueLimit: isFullQueueMode ? 500 : MAR_FIRST_LOAD_OVERDUE_LIMIT,
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
        <>
          {snapshot.todayLimited || snapshot.overdueTodayLimited || isFullQueueMode ? (
            <Card>
              <CardTitle>{isFullQueueMode ? "Full Queue Mode" : "Contained First Load"}</CardTitle>
              <p className="mt-1 text-sm text-muted">
                {isFullQueueMode
                  ? "This mode loads a larger center-wide Today and Overdue queue when staff need the full board in one pass."
                  : `Default first load is intentionally contained to the first ${MAR_FIRST_LOAD_TODAY_LIMIT} Today rows and ${MAR_FIRST_LOAD_OVERDUE_LIMIT} Overdue rows so MAR does not pull the full center-wide live queues on every visit.`}
              </p>
              <p className="mt-2 text-xs text-muted">
                Today loaded: {snapshot.today.length} of {snapshot.todayTotalCount}. Overdue loaded: {snapshot.overdueToday.length} of {snapshot.overdueTodayTotalCount}.
              </p>
              <div className="mt-3 flex flex-wrap gap-2 text-sm">
                {isFullQueueMode ? (
                  <Link href="/health/mar" className="font-semibold text-brand">
                    Return to Contained Mode
                  </Link>
                ) : (
                  <Link href="/health/mar?queue=full" className="font-semibold text-brand">
                    Load Full Center-wide Queues
                  </Link>
                )}
              </div>
            </Card>
          ) : null}
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
        </>
      ) : null}
    </div>
  );
}
