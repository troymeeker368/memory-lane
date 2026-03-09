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
  "program assistant": "program-assistant"
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
  { label: "Documentation Home", href: "/documentation", group: "Documentation", module: "documentation" },
  { label: "Members", href: "/members", group: "Documentation", module: "documentation" },
  { label: "Participation Log", href: "/documentation/activity", group: "Documentation", module: "documentation" },
  { label: "Toilet Log", href: "/documentation/toilet", group: "Documentation", module: "documentation" },
  { label: "Shower Log", href: "/documentation/shower", group: "Documentation", module: "documentation" },
  { label: "Transportation", href: "/documentation/transportation", group: "Documentation", module: "documentation" },
  { label: "Photo Upload", href: "/documentation/photo-upload", group: "Documentation", module: "documentation" },
  { label: "Ancillary Charges", href: "/ancillary", group: "Documentation", module: "ancillary" },

  { label: "Operations Home", href: "/operations", group: "Operations", module: "operations" },
  { label: "Attendance", href: "/operations/attendance", group: "Operations", module: "operations" },
  { label: "Member Command Center", href: "/operations/member-command-center", group: "Operations", module: "operations" },
  { label: "Additional Charges", href: "/operations/additional-charges", group: "Operations", module: "operations" },
  { label: "Holds", href: "/operations/holds", group: "Operations", module: "operations" },
  { label: "Payor", href: "/operations/payor", group: "Operations", module: "operations" },
  { label: "Locker Assignments", href: "/operations/locker-assignments", group: "Operations", module: "operations" },
  { label: "Transportation Station", href: "/operations/transportation-station", group: "Operations", module: "operations" },

  { label: "Reports", href: "/reports", group: "Reports", module: "reports" },
  { label: "Monthly Ancillary Charges", href: "/reports/monthly-ancillary", group: "Reports", module: "reports", roles: ["manager", "director", "admin"] },
  { label: "Member Documentation Summary", href: "/reports/member-summary", group: "Reports", module: "reports", roles: ["manager", "director", "admin"] },
  { label: "Admin Reports", href: "/admin-reports", group: "Reports", module: "admin-reports" },

  { label: "Time Clock", href: "/time-card", group: "Time & HR", module: "time-card" },
  { label: "Punch History", href: "/time-card/punch-history", group: "Time & HR", module: "time-card" },
  { label: "PTO Request", href: PTO_EXTERNAL_URL, group: "Time & HR", module: "pto", external: true },
  { label: "User Management", href: "/time-hr/user-management", group: "Time & HR", module: "user-management" },

  { label: "Pipeline", href: "/sales/pipeline", group: "Sales Activities", module: "sales" },
  { label: "New Entries", href: "/sales/new-entries", group: "Sales Activities", module: "sales" },
  { label: "Community Partners", href: "/sales/community-partners", group: "Sales Activities", module: "sales" },
  { label: "Recent Lead Activity", href: "/sales/activities", group: "Sales Activities", module: "sales" },

  { label: "Nursing Dashboard", href: "/health", group: "Health Unit", module: "health" },
  { label: "Member Health Profiles", href: "/health/member-health-profiles", group: "Health Unit", module: "health", roles: ["admin", "nurse"] },
  { label: "Blood Sugar", href: "/documentation/blood-sugar", group: "Health Unit", module: "health" },
  { label: "New Intake Assessment", href: "/health/assessment", group: "Health Unit", module: "health" },
  { label: "Physician Orders", href: "/health/physician-orders", group: "Health Unit", module: "health", roles: ["admin", "nurse"] },
  { label: "Care Plans", href: "/health/care-plans", group: "Health Unit", module: "health" }
];

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

  return NAV_ITEMS.filter((item) => {
    if (item.roles?.length) {
      const allowedRoles = item.roles.map((allowed) => normalizeRoleKey(allowed));
      if (!allowedRoles.includes(normalizedRole)) {
        return false;
      }
    }
    return hasModulePermission(permissions, item.module, "canView");
  });
}
