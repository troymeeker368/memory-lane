import { getMockDb } from "@/lib/mock-repo";
import { isMockMode } from "@/lib/runtime";
import type { AppRole } from "@/types/app";

interface DocumentationWorkflowScope {
  role?: AppRole;
  staffUserId?: string | null;
}

function isStaffScoped(scope?: DocumentationWorkflowScope) {
  return scope?.role === "staff" && !!scope.staffUserId;
}

export async function getDocumentationWorkflows(scope?: DocumentationWorkflowScope) {
  const db = getMockDb();
  const staffUserId = scope?.staffUserId ?? null;

  if (isMockMode()) {
    // TODO(backend): replace with query composition from persistent storage.
    const dailyActivities = [...db.dailyActivities]
      .filter((row) => (isStaffScoped(scope) ? row.staff_user_id === staffUserId : true))
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      .slice(0, 50);
    const toilets = [...db.toiletLogs]
      .filter((row) => (isStaffScoped(scope) ? row.staff_user_id === staffUserId : true))
      .sort((a, b) => (a.event_at < b.event_at ? 1 : -1))
      .slice(0, 50);
    const showers = [...db.showerLogs]
      .filter((row) => (isStaffScoped(scope) ? row.staff_user_id === staffUserId : true))
      .sort((a, b) => (a.event_at < b.event_at ? 1 : -1))
      .slice(0, 50);
    const transportation = [...db.transportationLogs]
      .filter((row) => (isStaffScoped(scope) ? row.staff_user_id === staffUserId : true))
      .sort((a, b) => (a.service_date < b.service_date ? 1 : -1))
      .slice(0, 50);
    const photos = [...db.photoUploads]
      .filter((row) => (isStaffScoped(scope) ? row.uploaded_by === staffUserId : true))
      .sort((a, b) => (a.uploaded_at < b.uploaded_at ? 1 : -1))
      .slice(0, 50);
    const ancillary = [...db.ancillaryLogs]
      .filter((row) => (isStaffScoped(scope) ? row.staff_user_id === staffUserId : true))
      .sort((a, b) => (a.service_date < b.service_date ? 1 : -1))
      .slice(0, 50);
    const assessments = [...db.assessments]
      .filter((row) => (isStaffScoped(scope) ? row.created_by_user_id === staffUserId : true))
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      .slice(0, 50);

    return {
      dailyActivities,
      toilets,
      showers,
      transportation,
      photos,
      ancillary,
      assessments
    };
  }

  // TODO(backend): apply role-aware staff scoping to Supabase queries (staff sees only self-authored entries).
  return {
    dailyActivities: [],
    toilets: [],
    showers: [],
    transportation: [],
    photos: [],
    ancillary: [],
    assessments: []
  };
}
