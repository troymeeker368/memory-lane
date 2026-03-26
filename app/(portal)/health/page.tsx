import { NursingDashboardWorkspace } from "@/app/(portal)/health/_components/nursing-dashboard-workspace";
import { requireModuleAccess } from "@/lib/auth";
import { canAccessIncidentReportsForRole } from "@/lib/permissions";
import { canAccessCarePlansForRole } from "@/lib/services/care-plan-authorization";
import { getHealthDashboardData } from "@/lib/services/health-dashboard";
import { canAccessProgressNotesForRole } from "@/lib/services/progress-note-authorization";

export const dynamic = "force-dynamic";

export default async function HealthPage() {
  const profile = await requireModuleAccess("health");
  const canViewCarePlans = canAccessCarePlansForRole(profile.role);
  const canViewProgressNotes = canAccessProgressNotesForRole(profile.role);
  const canViewIncidents = canAccessIncidentReportsForRole(profile.role);
  const dashboard = await getHealthDashboardData({
    includeCarePlans: canViewCarePlans,
    includeIncidents: canViewIncidents,
    includeProgressNotes: canViewProgressNotes
  });

  return (
    <NursingDashboardWorkspace
      capabilities={{
        canViewCarePlans,
        canViewIncidents,
        canViewProgressNotes
      }}
      dashboard={dashboard}
    />
  );
}
