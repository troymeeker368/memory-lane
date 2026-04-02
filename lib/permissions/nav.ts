import type { AppNavItem, AppRole, CanonicalAppRole, PermissionSet } from "@/types/app";

import {
  canAccessMar,
  canAccessMemberCommandCenter,
  canAccessMemberHealthProfiles,
  canAccessPhysicianOrders,
  INCIDENT_ALLOWED_ROLES,
  MAR_MODULE_ROLES,
  MEMBER_HEALTH_PROFILE_MODULE_ROLES,
  PHYSICIAN_ORDER_MODULE_ROLES,
  PTO_EXTERNAL_URL,
  type PermissionAction,
  getDefaultPermissionSet,
  hasModulePermission,
  normalizeRoleKey
} from "@/lib/permissions/core";

export const NAV_ITEMS: AppNavItem[] = [
  { label: "Documentation Home", href: "/documentation", group: "Documentation", module: "documentation", icon: "NotebookText" },
  { label: "Members", href: "/members", group: "Documentation", module: "documentation", icon: "Users" },
  { label: "Participation Log", href: "/documentation/activity", group: "Documentation", module: "documentation", icon: "ClipboardList" },
  { label: "Toilet Log", href: "/documentation/toilet", group: "Documentation", module: "documentation", icon: "Bath" },
  { label: "Shower Log", href: "/documentation/shower", group: "Documentation", module: "documentation", icon: "ShowerHead" },
  { label: "Transportation", href: "/documentation/transportation", group: "Documentation", module: "documentation", icon: "Car" },
  { label: "Incident Reports", href: "/documentation/incidents", group: "Documentation", module: "documentation", icon: "TriangleAlert", roles: INCIDENT_ALLOWED_ROLES },
  { label: "Photo Upload", href: "/documentation/photo-upload", group: "Documentation", module: "documentation", icon: "ImageUp" },
  { label: "Ancillary Charges", href: "/ancillary", group: "Documentation", module: "ancillary", icon: "ReceiptText" },

  { label: "Operations Home", href: "/operations", group: "Operations", module: "operations", icon: "LayoutDashboard" },
  { label: "Attendance Board", href: "/operations/attendance", group: "Operations", module: "operations", icon: "CalendarCheck2" },
  { label: "Member Command Center", href: "/operations/member-command-center", group: "Operations", module: "operations", icon: "MonitorCog" },
  { label: "Pricing Defaults", href: "/operations/pricing", group: "Operations", module: "operations", icon: "CircleDollarSign", roles: ["admin", "director"] },
  { label: "Billing", href: "/operations/payor", group: "Operations", module: "operations", icon: "CreditCard", roles: ["admin", "manager", "director", "coordinator"] },
  { label: "Transportation Station", href: "/operations/transportation-station", group: "Operations", module: "operations", icon: "BusFront" },

  { label: "Reports", href: "/reports", group: "Reports", module: "reports", icon: "BarChart3" },
  { label: "Monthly Ancillary Charges", href: "/reports/monthly-ancillary", group: "Reports", module: "reports", icon: "FileSpreadsheet", roles: ["manager", "director", "admin"] },
  { label: "Member Documentation Summary", href: "/reports/member-summary", group: "Reports", module: "reports", icon: "FolderSearch", roles: ["manager", "director", "admin"] },
  { label: "Admin Reports", href: "/admin-reports", group: "Reports", module: "admin-reports", icon: "FileSpreadsheet" },

  { label: "Time Clock", href: "/time-card", group: "Time & HR", module: "time-card", icon: "AlarmClockCheck" },
  { label: "Punch History", href: "/time-card/punch-history", group: "Time & HR", module: "time-card", icon: "Clock3" },
  { label: "Forgotten Punch", href: "/time-card/forgotten-punch", group: "Time & HR", module: "time-card", icon: "BadgeAlert" },
  { label: "Director Timecards", href: "/time-card/director", group: "Time & HR", module: "time-card", icon: "WalletCards", roles: ["manager", "director", "admin"] },
  { label: "PTO Request", href: PTO_EXTERNAL_URL, group: "Time & HR", module: "pto", icon: "CalendarDays", external: true },
  { label: "Notifications", href: "/notifications", group: "Time & HR", module: "time-card", icon: "Bell" },
  { label: "User Management", href: "/time-hr/user-management", group: "Time & HR", module: "user-management", icon: "UserRoundCog" },

  { label: "Pipeline", href: "/sales/pipeline", group: "Sales Activities", module: "sales", icon: "GitBranch" },
  { label: "New Entries", href: "/sales/new-entries", group: "Sales Activities", module: "sales", icon: "ClipboardPlus" },
  { label: "Community Partners", href: "/sales/community-partners", group: "Sales Activities", module: "sales", icon: "Building2" },
  { label: "Recent Lead Activity", href: "/sales/activities", group: "Sales Activities", module: "sales", icon: "TrendingUp" },

  { label: "Nursing Dashboard", href: "/health", group: "Health Unit", module: "health", icon: "HeartPulse" },
  { label: "MAR Workflow", href: "/health/mar", group: "Health Unit", module: "health", icon: "PillBottle", roles: MAR_MODULE_ROLES },
  { label: "Member Health Profiles", href: "/health/member-health-profiles", group: "Health Unit", module: "health", icon: "BookUser", roles: MEMBER_HEALTH_PROFILE_MODULE_ROLES },
  { label: "Incident Reports", href: "/documentation/incidents", group: "Health Unit", module: "health", icon: "TriangleAlert", roles: INCIDENT_ALLOWED_ROLES },
  { label: "Blood Sugar", href: "/documentation/blood-sugar", group: "Health Unit", module: "health", icon: "Activity" },
  { label: "New Intake Assessment", href: "/health/assessment", group: "Health Unit", module: "health", icon: "ClipboardCheck" },
  { label: "Physician Orders", href: "/health/physician-orders", group: "Health Unit", module: "health", icon: "FilePenLine", roles: PHYSICIAN_ORDER_MODULE_ROLES },
  { label: "Care Plans", href: "/health/care-plans", group: "Health Unit", module: "health", icon: "FileHeart", roles: ["admin", "nurse"] },
  { label: "Progress Notes", href: "/health/progress-notes", group: "Health Unit", module: "health", icon: "NotebookText", roles: ["admin", "nurse"] }
];

function normalizeNavHref(href: string): string {
  const withoutHash = href.split("#", 1)[0] ?? href;
  const withoutQuery = withoutHash.split("?", 1)[0] ?? withoutHash;
  if (withoutQuery === "/") return "/";
  return withoutQuery.endsWith("/") ? withoutQuery.slice(0, -1) : withoutQuery;
}

function isRoleAllowedForNavItem(role: CanonicalAppRole, item: AppNavItem): boolean {
  if (!item.roles?.length) {
    return true;
  }

  const allowedRoles = item.roles.map((allowed) => normalizeRoleKey(allowed));
  return allowedRoles.includes(role);
}

function canAccessNavItemDefinition(
  role: CanonicalAppRole,
  item: AppNavItem,
  permissions: PermissionSet,
  action: PermissionAction
): boolean {
  const capabilityProfile = { role, permissions };
  if (action === "canView") {
    if (item.href === "/operations/member-command-center") {
      return canAccessMemberCommandCenter(capabilityProfile);
    }
    if (item.href === "/health/member-health-profiles") {
      return canAccessMemberHealthProfiles(capabilityProfile);
    }
    if (item.href === "/health/physician-orders") {
      return canAccessPhysicianOrders(capabilityProfile);
    }
    if (item.href === "/health/mar") {
      return canAccessMar(capabilityProfile);
    }
  }

  if (!isRoleAllowedForNavItem(role, item)) {
    return false;
  }

  return hasModulePermission(permissions, item.module, action);
}

export function getNavItemByHref(href: string): AppNavItem | null {
  const normalizedHref = normalizeNavHref(href);
  return NAV_ITEMS.find((item) => normalizeNavHref(item.href) === normalizedHref) ?? null;
}

export function canAccessNavItem(
  role: string | AppRole,
  href: string,
  permissionsOverride?: PermissionSet,
  action: PermissionAction = "canView"
): boolean {
  const item = getNavItemByHref(href);
  if (!item) return false;

  const normalizedRole = normalizeRoleKey(role);
  const permissions = permissionsOverride ?? getDefaultPermissionSet(normalizedRole);
  return canAccessNavItemDefinition(normalizedRole, item, permissions, action);
}

export function navForRole(role: string | AppRole, permissionsOverride?: PermissionSet): AppNavItem[] {
  const normalizedRole = normalizeRoleKey(role);
  const permissions = permissionsOverride ?? getDefaultPermissionSet(normalizedRole);

  return NAV_ITEMS.filter((item) => canAccessNavItemDefinition(normalizedRole, item, permissions, "canView"));
}
