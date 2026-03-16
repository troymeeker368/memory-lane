import type {
  AppNavItem,
  AppRole,
  CanonicalAppRole,
  ModuleKey,
  ModulePermission,
  PermissionModuleKey,
  PermissionSet
} from "@/types/app";

export const PTO_EXTERNAL_URL = "https://infhsg-ep.prismhr.com/uex/#/login?lang=en";

export const CANONICAL_ROLE_ORDER: CanonicalAppRole[] = [
  "program-assistant",
  "coordinator",
  "nurse",
  "sales",
  "manager",
  "director",
  "admin"
];

const LEGACY_ROLE_ALIASES: Record<string, CanonicalAppRole> = {
  staff: "program-assistant",
  programassistant: "program-assistant",
  "program assistant": "program-assistant",
  owner: "admin",
  "admin-owner": "admin",
  superadmin: "admin"
};

export const ROLE_LABELS: Record<CanonicalAppRole, string> = {
  "program-assistant": "Program Assistant",
  coordinator: "Coordinator",
  nurse: "Nurse",
  sales: "Sales",
  manager: "Manager",
  director: "Director",
  admin: "Admin"
};

export const ROLE_RANKS: Record<CanonicalAppRole, number> = {
  "program-assistant": 1,
  coordinator: 2,
  nurse: 3,
  sales: 4,
  manager: 5,
  director: 6,
  admin: 7
};

export const INCIDENT_ALLOWED_ROLES: CanonicalAppRole[] = ["nurse", "manager", "director", "admin"];

export const PERMISSION_MODULES: PermissionModuleKey[] = [
  "documentation",
  "operations",
  "reports",
  "time-hr",
  "sales-activities",
  "health-unit",
  "admin-reports",
  "user-management"
];

export type PermissionAction = keyof ModulePermission;

function permission(canView: boolean, canCreate: boolean, canEdit: boolean, canAdmin: boolean): ModulePermission {
  return { canView, canCreate, canEdit, canAdmin };
}

function emptyPermissionSet(): PermissionSet {
  return PERMISSION_MODULES.reduce((acc, module) => {
    acc[module] = permission(false, false, false, false);
    return acc;
  }, {} as PermissionSet);
}

function clonePermissionSet(set: PermissionSet): PermissionSet {
  return PERMISSION_MODULES.reduce((acc, module) => {
    const row = set[module] ?? permission(false, false, false, false);
    acc[module] = { ...row };
    return acc;
  }, {} as PermissionSet);
}

const ROLE_PERMISSION_DEFAULTS: Record<CanonicalAppRole, PermissionSet> = {
  admin: {
    documentation: permission(true, true, true, true),
    operations: permission(true, true, true, true),
    reports: permission(true, true, true, true),
    "time-hr": permission(true, true, true, true),
    "sales-activities": permission(true, true, true, true),
    "health-unit": permission(true, true, true, true),
    "admin-reports": permission(true, true, true, true),
    "user-management": permission(true, true, true, true)
  },
  director: {
    documentation: permission(true, true, true, false),
    operations: permission(true, true, true, false),
    reports: permission(true, true, true, false),
    "time-hr": permission(true, true, true, false),
    "sales-activities": permission(true, true, true, false),
    "health-unit": permission(true, true, true, false),
    "admin-reports": permission(true, true, true, false),
    "user-management": permission(false, false, false, false)
  },
  manager: {
    documentation: permission(true, true, true, false),
    operations: permission(true, true, true, false),
    reports: permission(true, true, true, false),
    "time-hr": permission(true, true, true, false),
    "sales-activities": permission(true, false, false, false),
    "health-unit": permission(true, false, false, false),
    "admin-reports": permission(true, false, false, false),
    "user-management": permission(false, false, false, false)
  },
  sales: {
    documentation: permission(false, false, false, false),
    operations: permission(false, false, false, false),
    reports: permission(true, false, false, false),
    "time-hr": permission(true, true, true, false),
    "sales-activities": permission(true, true, true, false),
    "health-unit": permission(false, false, false, false),
    "admin-reports": permission(false, false, false, false),
    "user-management": permission(false, false, false, false)
  },
  nurse: {
    documentation: permission(true, true, true, false),
    operations: permission(true, false, true, false),
    reports: permission(true, false, false, false),
    "time-hr": permission(true, true, true, false),
    "sales-activities": permission(false, false, false, false),
    "health-unit": permission(true, true, true, false),
    "admin-reports": permission(false, false, false, false),
    "user-management": permission(false, false, false, false)
  },
  coordinator: {
    documentation: permission(true, true, true, false),
    operations: permission(true, true, true, false),
    reports: permission(true, false, false, false),
    "time-hr": permission(true, true, true, false),
    "sales-activities": permission(false, false, false, false),
    "health-unit": permission(true, false, false, false),
    "admin-reports": permission(false, false, false, false),
    "user-management": permission(false, false, false, false)
  },
  "program-assistant": {
    documentation: permission(true, true, true, false),
    operations: permission(false, false, false, false),
    reports: permission(false, false, false, false),
    "time-hr": permission(true, true, true, false),
    "sales-activities": permission(false, false, false, false),
    "health-unit": permission(false, false, false, false),
    "admin-reports": permission(false, false, false, false),
    "user-management": permission(false, false, false, false)
  }
};

const MODULE_PERMISSION_MAP: Record<ModuleKey, PermissionModuleKey> = {
  dashboard: "reports",
  "time-card": "time-hr",
  documentation: "documentation",
  operations: "operations",
  health: "health-unit",
  ancillary: "documentation",
  sales: "sales-activities",
  reports: "reports",
  pto: "time-hr",
  "admin-reports": "admin-reports",
  "user-management": "user-management"
};

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
  { label: "Attendance", href: "/operations/attendance", group: "Operations", module: "operations", icon: "CalendarCheck2" },
  { label: "Member Command Center", href: "/operations/member-command-center", group: "Operations", module: "operations", icon: "MonitorCog" },
  { label: "Schedule Changes", href: "/operations/schedule-changes", group: "Operations", module: "operations", icon: "CalendarClock" },
  { label: "Pricing", href: "/operations/pricing", group: "Operations", module: "operations", icon: "CircleDollarSign", roles: ["admin", "director"] },
  { label: "Additional Charges", href: "/operations/additional-charges", group: "Operations", module: "operations", icon: "HandCoins" },
  { label: "Holds", href: "/operations/holds", group: "Operations", module: "operations", icon: "CirclePause" },
  { label: "Billing", href: "/operations/payor", group: "Operations", module: "operations", icon: "CreditCard", roles: ["admin", "manager", "director", "coordinator"] },
  { label: "Locker Assignments", href: "/operations/locker-assignments", group: "Operations", module: "operations", icon: "Lock" },
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
  { label: "MAR Workflow", href: "/health/mar", group: "Health Unit", module: "health", icon: "PillBottle", roles: ["admin", "manager", "director", "nurse"] },
  { label: "Member Health Profiles", href: "/health/member-health-profiles", group: "Health Unit", module: "health", icon: "BookUser", roles: ["admin", "nurse"] },
  { label: "Incident Reports", href: "/documentation/incidents", group: "Health Unit", module: "health", icon: "TriangleAlert", roles: INCIDENT_ALLOWED_ROLES },
  { label: "Blood Sugar", href: "/documentation/blood-sugar", group: "Health Unit", module: "health", icon: "Activity" },
  { label: "New Intake Assessment", href: "/health/assessment", group: "Health Unit", module: "health", icon: "ClipboardCheck" },
  { label: "Physician Orders", href: "/health/physician-orders", group: "Health Unit", module: "health", icon: "FilePenLine", roles: ["admin", "nurse"] },
  { label: "Care Plans", href: "/health/care-plans", group: "Health Unit", module: "health", icon: "FileHeart", roles: ["admin", "nurse"] }
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

export function normalizeRoleKey(value: string | AppRole | null | undefined): CanonicalAppRole {
  if (!value) return "program-assistant";
  const raw = String(value).trim().toLowerCase();
  if (raw in LEGACY_ROLE_ALIASES) {
    return LEGACY_ROLE_ALIASES[raw];
  }
  return (CANONICAL_ROLE_ORDER.find((role) => role === raw) ?? "program-assistant") as CanonicalAppRole;
}

export function isAppRole(value: string | null | undefined): value is AppRole {
  if (!value) return false;
  const raw = String(value).trim().toLowerCase();
  return Boolean(raw in LEGACY_ROLE_ALIASES || CANONICAL_ROLE_ORDER.includes(raw as CanonicalAppRole));
}

export function getRoleLabel(role: string | AppRole): string {
  return ROLE_LABELS[normalizeRoleKey(role)];
}

export function getRoleRank(role: string | AppRole): number {
  return ROLE_RANKS[normalizeRoleKey(role)];
}

export function isRoleAtLeast(role: string | AppRole, minimumRole: string | AppRole): boolean {
  return getRoleRank(role) >= getRoleRank(minimumRole);
}

export function canAccessIncidentReportsForRole(role: string | AppRole | null | undefined) {
  const normalizedRole = normalizeRoleKey(role);
  return INCIDENT_ALLOWED_ROLES.includes(normalizedRole);
}

export function getDefaultPermissionSet(role: string | AppRole): PermissionSet {
  return clonePermissionSet(ROLE_PERMISSION_DEFAULTS[normalizeRoleKey(role)]);
}

export function normalizePermissionSet(input: PermissionSet): PermissionSet {
  const normalized = clonePermissionSet(input);

  PERMISSION_MODULES.forEach((module) => {
    const row = normalized[module];
    if (row.canAdmin) {
      row.canView = true;
      row.canCreate = true;
      row.canEdit = true;
    }
    if (row.canEdit) row.canView = true;
    if (row.canCreate) row.canView = true;
  });

  return normalized;
}

export function resolveEffectivePermissionSet(input: {
  role: string | AppRole;
  hasCustomPermissions?: boolean | null;
  customPermissions?: PermissionSet | null;
  permissions?: PermissionSet | null;
}): PermissionSet {
  // Role template is the default source of truth; custom rows replace it only when explicitly enabled.
  if (input.hasCustomPermissions) {
    const custom = input.customPermissions ?? input.permissions ?? emptyPermissionSet();
    return normalizePermissionSet(custom);
  }
  return getDefaultPermissionSet(input.role);
}

export function getPermissionSource(hasCustomPermissions: boolean | null | undefined): "role-template" | "custom-override" {
  return hasCustomPermissions ? "custom-override" : "role-template";
}

export function mapModuleToPermissionModule(module: ModuleKey): PermissionModuleKey {
  return MODULE_PERMISSION_MAP[module];
}

export function hasModulePermission(
  permissions: PermissionSet,
  module: ModuleKey | PermissionModuleKey,
  action: PermissionAction = "canView"
): boolean {
  const resolvedModule = (module in MODULE_PERMISSION_MAP ? MODULE_PERMISSION_MAP[module as ModuleKey] : module) as PermissionModuleKey;
  return Boolean(permissions[resolvedModule]?.[action]);
}

export function canAccessModule(role: string | AppRole, module: ModuleKey, permissionsOverride?: PermissionSet): boolean {
  const permissions = permissionsOverride ?? getDefaultPermissionSet(role);
  return hasModulePermission(permissions, module, "canView");
}

export function canPerformModuleAction(
  role: string | AppRole,
  module: ModuleKey | PermissionModuleKey,
  action: PermissionAction,
  permissionsOverride?: PermissionSet
): boolean {
  const permissions = permissionsOverride ?? getDefaultPermissionSet(role);
  return hasModulePermission(permissions, module, action);
}

export function canView(permissions: PermissionSet, module: ModuleKey | PermissionModuleKey): boolean {
  return hasModulePermission(permissions, module, "canView");
}

export function canCreate(permissions: PermissionSet, module: ModuleKey | PermissionModuleKey): boolean {
  return hasModulePermission(permissions, module, "canCreate");
}

export function canEdit(permissions: PermissionSet, module: ModuleKey | PermissionModuleKey): boolean {
  return hasModulePermission(permissions, module, "canEdit");
}

export function canAdmin(permissions: PermissionSet, module: ModuleKey | PermissionModuleKey): boolean {
  return hasModulePermission(permissions, module, "canAdmin");
}

export function navForRole(role: string | AppRole, permissionsOverride?: PermissionSet): AppNavItem[] {
  const normalizedRole = normalizeRoleKey(role);
  const permissions = permissionsOverride ?? getDefaultPermissionSet(normalizedRole);

  return NAV_ITEMS.filter((item) => canAccessNavItemDefinition(normalizedRole, item, permissions, "canView"));
}
