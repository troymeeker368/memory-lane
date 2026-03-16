import { IncidentForm } from "@/components/incidents/incident-form";
import { Card, CardTitle } from "@/components/ui/card";
import { requireModuleAccess } from "@/lib/auth";
import { normalizeRoleKey } from "@/lib/permissions";
import { listIncidentLookups } from "@/lib/services/incidents";

export default async function NewIncidentPage() {
  const profile = await requireModuleAccess("documentation");
  const lookups = await listIncidentLookups();
  const role = normalizeRoleKey(profile.role);

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>New Incident Report</CardTitle>
        <p className="mt-1 text-sm text-muted">
          Enter the core facts first. Save a draft if you need to come back, then submit for director review.
        </p>
      </Card>

      <IncidentForm
        detail={null}
        lookups={lookups}
        actorId={profile.id}
        actorName={profile.full_name}
        canReview={role === "director" || role === "admin"}
        canAmend={role === "admin"}
        canEditInitial
      />
    </div>
  );
}
