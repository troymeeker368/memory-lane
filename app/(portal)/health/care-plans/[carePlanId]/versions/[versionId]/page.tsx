import Link from "next/link";
import { notFound } from "next/navigation";

import { Card, CardTitle } from "@/components/ui/card";
import { requireNavItemAccess } from "@/lib/auth";
import { CARE_PLAN_LONG_TERM_LABEL, CARE_PLAN_SHORT_TERM_LABEL, getCarePlanVersionById, getGoalListItems } from "@/lib/services/care-plans";
import { formatDate } from "@/lib/utils";

function GoalList({ value }: { value: string }) {
  const items = getGoalListItems(value);
  return (
    <ol className="list-decimal space-y-1 pl-5">
      {items.map((item, idx) => (
        <li key={`${idx}-${item}`}>{item}</li>
      ))}
    </ol>
  );
}

export default async function CarePlanVersionDetailPage({
  params
}: {
  params: Promise<{ carePlanId: string; versionId: string }>;
}) {
  await requireNavItemAccess("/health/care-plans");
  const { carePlanId, versionId } = await params;
  const detail = getCarePlanVersionById(carePlanId, versionId);
  if (!detail) notFound();

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>Care Plan Version Snapshot</CardTitle>
        <div className="mt-3 grid gap-3 md:grid-cols-4">
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs text-muted">Member</p>
            <p className="font-semibold">{detail.carePlan.memberName}</p>
          </div>
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs text-muted">Version</p>
            <p className="font-semibold">v{detail.version.versionNumber}</p>
          </div>
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs text-muted">Snapshot Date</p>
            <p className="font-semibold">{formatDate(detail.version.snapshotDate)}</p>
          </div>
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs text-muted">Type</p>
            <p className="font-semibold">{detail.version.snapshotType === "review" ? "Review" : "Initial"}</p>
          </div>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs text-muted">Reviewed By</p>
            <p className="font-semibold">{detail.version.reviewedBy || "-"}</p>
          </div>
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs text-muted">Status</p>
            <p className="font-semibold">{detail.version.status}</p>
          </div>
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs text-muted">Next Due Date</p>
            <p className="font-semibold">{formatDate(detail.version.nextDueDate)}</p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-3 text-sm">
          <Link href={`/health/care-plans/${detail.carePlan.id}`} className="font-semibold text-brand">
            Open Current Care Plan
          </Link>
          <Link href={`/health/care-plans/list?memberId=${detail.carePlan.memberId}`} className="font-semibold text-brand">
            Open Member Care Plan History
          </Link>
        </div>
      </Card>

      <Card className="table-wrap">
        <CardTitle>Section Goals at This Version</CardTitle>
        <table>
          <thead>
            <tr>
              <th>Section</th>
              <th>{CARE_PLAN_SHORT_TERM_LABEL}</th>
              <th>{CARE_PLAN_LONG_TERM_LABEL}</th>
            </tr>
          </thead>
          <tbody>
            {detail.version.sections.map((section) => (
              <tr key={`${detail.version.id}-${section.sectionType}`}>
                <td>{section.sectionType}</td>
                <td>
                  <GoalList value={section.shortTermGoals} />
                </td>
                <td>
                  <GoalList value={section.longTermGoals} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
