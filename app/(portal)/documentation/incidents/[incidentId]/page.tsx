import { notFound } from "next/navigation";

import { IncidentFormShell } from "@/components/incidents/incident-form-shell";
import { Card, CardTitle } from "@/components/ui/card";
import { requireModuleAccess, requireRoles } from "@/lib/auth";
import { normalizeRoleKey } from "@/lib/permissions";
import { getIncidentDetail, listIncidentLookups } from "@/lib/services/incidents";

export default async function IncidentDetailPage({
  params
}: {
  params: Promise<{ incidentId: string }>;
}) {
  await requireRoles(["nurse", "manager", "director", "admin"]);
  const profile = await requireModuleAccess("documentation");
  const role = normalizeRoleKey(profile.role);
  const { incidentId } = await params;
  const [detail, lookups] = await Promise.all([getIncidentDetail(incidentId), listIncidentLookups()]);
  if (!detail) notFound();

  const canReview = role === "director" || role === "admin";
  const canAmend = role === "admin";
  const canEditInitial =
    detail.status === "draft" ||
    detail.status === "returned"
      ? detail.reporterUserId === profile.id || role === "admin"
      : false;

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>{detail.incidentNumber}</CardTitle>
        <p className="mt-1 text-sm text-muted">
          {detail.status === "submitted"
            ? "Pending director review."
            : detail.status === "returned"
              ? "Returned for correction."
              : detail.status === "approved"
                ? "Approved and locked for state recordkeeping."
                : detail.status === "closed"
                  ? "Closed incident record."
                  : "Working draft incident report."}
        </p>
      </Card>

      <IncidentFormShell
        detail={detail}
        lookups={lookups}
        actorId={profile.id}
        actorName={profile.full_name}
        canReview={canReview}
        canAmend={canAmend}
        canEditInitial={canEditInitial}
      />
    </div>
  );
}
