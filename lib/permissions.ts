import type {
  AppNavItem,
  AppRole,
  ModuleKey,
  ModulePermission,
  PermissionModuleKey,
  PermissionSet
} from "@/types/app";

export const PTO_EXTERNAL_URL = "https://infhsg-ep.prismhr.com/uex/#/login?lang=en";

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

type PermissionAction = keyof ModulePermission;

function permission(canView: boolean, canCreate: boolean, canEdit: boolean, canAdmin: boolean): ModulePermission {
  return { canView, canCreate, canEdit, canAdmin };
}

function clonePermissionSet(set: PermissionSet): PermissionSet {
  return PERMISSION_MODULES.reduce((acc, module) => {
    const row = set[module] ?? permission(false, false, false, false);
    acc[module] = { ...row };
    return acc;
  }, {} as PermissionSet);
}

const ROLE_PERMISSION_DEFAULTS: Record<AppRole, PermissionSet> = {
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
  manager: {
    documentation: permission(true, true, true, false),
    operations: permission(true, true, true, false),
    reports: permission(true, true, true, false),
    "time-hr": permission(true, true, true, false),
    "sales-activities": permission(false, false, false, false),
    "health-unit": permission(true, true, false, false),
    "admin-reports": permission(false, false, false, false),
    "user-management": permission(false, false, false, false)
  },
  nurse: {
    documentation: permission(true, true, false, false),
    operations: permission(true, false, false, false),
    reports: permission(true, false, false, false),
    "time-hr": permission(true, true, false, false),
    "sales-activities": permission(false, false, false, false),
    "health-unit": permission(true, true, true, false),
    "admin-reports": permission(false, false, false, false),
    "user-management": permission(false, false, false, false)
  },
  staff: {
    documentation: permission(true, true, false, false),
    operations: permission(false, false, false, false),
    reports: permission(false, false, false, false),
    "time-hr": permission(true, true, false, false),
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

const ROLE_LOCKED_MODULE_DENIES: Partial<Record<AppRole, PermissionModuleKey[]>> = {
  staff: ["operations"]
};

export const NAV_ITEMS: AppNavItem[] = [
  { label: "Documentation Home", href: "/documentation", group: "Documentation", module: "documentation" },
  { label: "Members", href: "/members", group: "Documentation", module: "documentation" },
  { label: "Participation Log", href: "/documentation/activity", group: "Documentation", module: "documentation" },
  { label: "Toilet Log", href: "/documentation/toilet", group: "Documentation", module: "documentation" },
  { label: "Shower Log", href: "/documentation/shower", group: "Documentation", module: "documentation" },
  { label: "Transportation", href: "/documentation/transportation", group: "Documentation", module: "documentation" },
  { label: "Photo Upload", href: "/documentation/photo-upload", group: "Documentation", module: "documentation" },
  { label: "Ancillary Charges", href: "/ancillary", group: "Documentation", module: "ancillary" },

  { label: "Operations Home", href: "/operations", group: "Operations", module: "operations", roles: ["admin", "manager", "nurse"] },
  { label: "Attendance", href: "/operations/attendance", group: "Operations", module: "operations", roles: ["admin", "manager", "nurse"] },
  { label: "Member Command Center", href: "/operations/member-command-center", group: "Operations", module: "operations", roles: ["admin", "manager", "nurse"] },
  { label: "Additional Charges", href: "/operations/additional-charges", group: "Operations", module: "operations", roles: ["admin", "manager", "nurse"] },
  { label: "Holds", href: "/operations/holds", group: "Operations", module: "operations", roles: ["admin", "manager", "nurse"] },
  { label: "Payor", href: "/operations/payor", group: "Operations", module: "operations", roles: ["admin", "manager", "nurse"] },
  { label: "Locker Assignments", href: "/operations/locker-assignments", group: "Operations", module: "operations", roles: ["admin", "manager", "nurse"] },
  { label: "Transportation Station", href: "/operations/transportation-station", group: "Operations", module: "operations", roles: ["admin", "manager", "nurse"] },

  { label: "Reports", href: "/reports", group: "Reports", module: "reports", roles: ["admin", "manager", "nurse"] },
  { label: "Monthly Ancillary Charges", href: "/reports/monthly-ancillary", group: "Reports", module: "reports", roles: ["admin", "manager"] },
  { label: "Member Documentation Summary", href: "/reports/member-summary", group: "Reports", module: "reports", roles: ["admin", "manager"] },
  { label: "Admin Reports", href: "/admin-reports", group: "Reports", module: "admin-reports", roles: ["admin"] },

  { label: "Time Clock", href: "/time-card", group: "Time & HR", module: "time-card" },
  { label: "Punch History", href: "/time-card/punch-history", group: "Time & HR", module: "time-card" },
  { label: "PTO Request", href: PTO_EXTERNAL_URL, group: "Time & HR", module: "pto", external: true },
  { label: "User Management", href: "/time-hr/user-management", group: "Time & HR", module: "user-management", roles: ["admin"] },

  { label: "Pipeline", href: "/sales/pipeline", group: "Sales Activities", module: "sales", roles: ["admin"] },
  { label: "New Entries", href: "/sales/new-entries", group: "Sales Activities", module: "sales", roles: ["admin"] },
  { label: "Community Partners", href: "/sales/community-partners", group: "Sales Activities", module: "sales", roles: ["admin"] },
  { label: "Recent Lead Activity", href: "/sales/activities", group: "Sales Activities", module: "sales", roles: ["admin"] },

  { label: "Nursing Dashboard", href: "/health", group: "Health Unit", module: "health", roles: ["admin", "manager", "nurse"] },
  { label: "Member Health Profiles", href: "/health/member-health-profiles", group: "Health Unit", module: "health", roles: ["admin", "nurse"] },
  { label: "Blood Sugar", href: "/documentation/blood-sugar", group: "Health Unit", module: "health", roles: ["admin", "manager", "nurse"] },
  { label: "New Intake Assessment", href: "/health/assessment", group: "Health Unit", module: "health", roles: ["admin", "manager", "nurse"] },
  { label: "Physician Orders", href: "/health/physician-orders", group: "Health Unit", module: "health", roles: ["admin", "nurse"] },
  { label: "Care Plans", href: "/health/care-plans", group: "Health Unit", module: "health", roles: ["admin", "manager", "nurse"] }
];

export function getDefaultPermissionSet(role: AppRole): PermissionSet {
  return clonePermissionSet(ROLE_PERMISSION_DEFAULTS[role]);
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
    if (row.canEdit) {
      row.canView = true;
    }
    if (row.canCreate) {
      row.canView = true;
    }
  });

  return normalized;
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

export function canAccessModule(role: AppRole, module: ModuleKey, permissionsOverride?: PermissionSet): boolean {
  const permissionModule = mapModuleToPermissionModule(module);
  if (ROLE_LOCKED_MODULE_DENIES[role]?.includes(permissionModule)) {
    return false;
  }
  const permissions = permissionsOverride ?? getDefaultPermissionSet(role);
  return hasModulePermission(permissions, module, "canView");
}

export function canPerformModuleAction(
  role: AppRole,
  module: ModuleKey | PermissionModuleKey,
  action: PermissionAction,
  permissionsOverride?: PermissionSet
): boolean {
  const permissionModule =
    module in MODULE_PERMISSION_MAP
      ? MODULE_PERMISSION_MAP[module as ModuleKey]
      : (module as PermissionModuleKey);
  if (ROLE_LOCKED_MODULE_DENIES[role]?.includes(permissionModule)) {
    return false;
  }
  const permissions = permissionsOverride ?? getDefaultPermissionSet(role);
  return hasModulePermission(permissions, module, action);
}

export function navForRole(role: AppRole, permissionsOverride?: PermissionSet): AppNavItem[] {
  const permissions = permissionsOverride ?? getDefaultPermissionSet(role);
  return NAV_ITEMS.filter((item) => {
    const allowedByRole = item.roles ? item.roles.includes(role) : true;
    if (!allowedByRole) return false;
    return hasModulePermission(permissions, item.module, "canView");
  });
}




