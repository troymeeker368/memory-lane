import type { AppRole, UserProfile } from "@/types/app";
import { getCurrentPayPeriod } from "@/lib/pay-period";
import { toEasternDate, toEasternISO } from "@/lib/timezone";
import { getPermissionSource, normalizeRoleKey, resolveEffectivePermissionSet } from "@/lib/permissions";

function defaultProfile(roleOverride?: AppRole): UserProfile {
  const role = normalizeRoleKey(roleOverride ?? "program-assistant");
  return {
    id: "legacy-mock-profile",
    email: "legacy-mock-profile@memorylane.local",
    full_name: "Legacy Mock Profile",
    role,
    active: true,
    staff_id: "legacy",
    permissions: resolveEffectivePermissionSet({ role }),
    has_custom_permissions: false,
    permission_source: getPermissionSource(false)
  };
}

export function getMockProfile(roleOverride?: AppRole, _selectedUserId?: string | null): UserProfile {
  return defaultProfile(roleOverride);
}

export function getMockUsersByRole(role?: AppRole) {
  const normalizedRole = normalizeRoleKey(role ?? "program-assistant");
  return [
    {
      id: "legacy-mock-profile",
      full_name: "Legacy Mock Profile",
      role: normalizedRole
    }
  ];
}

export function getMockMembers() {
  return [];
}

export function getMockDashboardStats(_userId?: string) {
  return {
    todaysLogs: 0,
    missingDocs: 0,
    latestPunches: []
  };
}

export function getMockDashboardAlerts() {
  return [] as { id: string; severity: "warning" | "critical"; message: string; actionLabel: string; actionHref: string }[];
}

export function getMockTimeCardOverview(_userId?: string) {
  return {
    periodStart: getCurrentPayPeriod().startAtIso,
    currentStatus: "Clocked Out",
    punches: [],
    exceptions: []
  };
}

export function getMockManagerTimeReview() {
  return [];
}

export function getMockDocumentationSummary() {
  return {
    today: [],
    timely: []
  };
}

export function getMockDocumentationTracker() {
  return [];
}

export function getMockClinicalOverview() {
  return {
    marToday: [],
    bloodSugarHistory: [],
    memberActions: []
  };
}

export function getMockAncillarySummary(_monthKey?: string, _options?: { staffUserId?: string | null }) {
  return {
    monthKey: toEasternDate(),
    categories: [],
    totals: [],
    logs: [],
    stats: {
      totalCharges: 0,
      totalAmountCents: 0
    }
  };
}

export function getMockLeadsSnapshot() {
  return {
    byStage: [],
    byStatus: []
  };
}

export function getMockReferralSources() {
  return [];
}

export function getMockReportingSnapshot() {
  return {
    generatedAt: toEasternISO(),
    dashboardStats: getMockDashboardStats(),
    dashboardAlerts: getMockDashboardAlerts(),
    timeCard: getMockTimeCardOverview(),
    managerTimeReview: getMockManagerTimeReview(),
    documentationSummary: getMockDocumentationSummary(),
    documentationTracker: getMockDocumentationTracker(),
    clinicalOverview: getMockClinicalOverview(),
    ancillarySummary: getMockAncillarySummary(),
    leadsSnapshot: getMockLeadsSnapshot(),
    referralSources: getMockReferralSources()
  };
}
