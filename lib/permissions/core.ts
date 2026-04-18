import type {
  AppRole,
  CanonicalAppRole,
  ModuleKey,
  ModulePermission,
  PermissionModuleKey,
  PermissionSet,
  UserProfile
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
export const MEMBER_HEALTH_PROFILE_MODULE_ROLES: AppRole[] = ["admin", "nurse"];
export const PHYSICIAN_ORDER_MODULE_ROLES: AppRole[] = ["admin", "nurse"];
export const PHYSICIAN_ORDER_SIGNATURE_WORKFLOW_ROLES: AppRole[] = ["admin", "nurse", "manager"];
export const CLINICAL_DOCUMENTATION_ACCESS_ROLES: AppRole[] = ["admin", "manager", "nurse"];
export const MAR_MODULE_ROLES: AppRole[] = ["admin", "manager", "director", "nurse"];
export const MEMBER_COMMAND_CENTER_EDITOR_ROLES: AppRole[] = ["admin", "manager"];
export const MEMBER_COMMAND_CENTER_ATTENDANCE_EDITOR_ROLES: AppRole[] = ["admin", "manager", "coordinator"];

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

function roleMatchesAny(role: string | AppRole | null | undefined, allowedRoles: AppRole[]) {
  const normalizedRole = normalizeRoleKey(role);
  return allowedRoles.map((allowedRole) => normalizeRoleKey(allowedRole)).includes(normalizedRole);
}

function hasRoleScopedModulePermission(input: {
  role: string | AppRole | null | undefined;
  permissions: PermissionSet;
  module: ModuleKey | PermissionModuleKey;
  action: PermissionAction;
  allowedRoles: AppRole[];
}) {
  return roleMatchesAny(input.role, input.allowedRoles) && hasModulePermission(input.permissions, input.module, input.action);
}

export function canGenerateMemberDocumentForRole(role: string | AppRole | null | undefined) {
  const normalizedRole = normalizeRoleKey(role);
  return normalizedRole === "admin" || normalizedRole === "manager" || normalizedRole === "nurse";
}

export function canAccessMemberHealthProfiles(input: Pick<UserProfile, "role" | "permissions">) {
  return hasRoleScopedModulePermission({
    role: input.role,
    permissions: input.permissions,
    module: "health",
    action: "canView",
    allowedRoles: MEMBER_HEALTH_PROFILE_MODULE_ROLES
  });
}

export function canManageMemberHealthProfiles(input: Pick<UserProfile, "role" | "permissions">) {
  return hasRoleScopedModulePermission({
    role: input.role,
    permissions: input.permissions,
    module: "health",
    action: "canEdit",
    allowedRoles: MEMBER_HEALTH_PROFILE_MODULE_ROLES
  });
}

export function canViewPhysicianOrdersModuleForRole(role: string | AppRole | null | undefined) {
  return roleMatchesAny(role, PHYSICIAN_ORDER_MODULE_ROLES);
}

export function canCreatePhysicianOrdersModuleForRole(role: string | AppRole | null | undefined) {
  return roleMatchesAny(role, PHYSICIAN_ORDER_MODULE_ROLES);
}

export function canAccessPhysicianOrders(input: Pick<UserProfile, "role" | "permissions">) {
  return hasRoleScopedModulePermission({
    role: input.role,
    permissions: input.permissions,
    module: "health",
    action: "canView",
    allowedRoles: PHYSICIAN_ORDER_MODULE_ROLES
  });
}

export function canManagePhysicianOrders(input: Pick<UserProfile, "role" | "permissions">) {
  return hasRoleScopedModulePermission({
    role: input.role,
    permissions: input.permissions,
    module: "health",
    action: "canEdit",
    allowedRoles: PHYSICIAN_ORDER_MODULE_ROLES
  });
}

export function canManagePofSignatureWorkflowForRole(role: string | AppRole | null | undefined) {
  return roleMatchesAny(role, PHYSICIAN_ORDER_SIGNATURE_WORKFLOW_ROLES);
}

export function canManagePofSignatureWorkflow(input: Pick<UserProfile, "role" | "permissions">) {
  return hasRoleScopedModulePermission({
    role: input.role,
    permissions: input.permissions,
    module: "health",
    action: "canEdit",
    allowedRoles: PHYSICIAN_ORDER_SIGNATURE_WORKFLOW_ROLES
  });
}

export function canAccessClinicalDocumentationForRole(role: string | AppRole | null | undefined) {
  return roleMatchesAny(role, CLINICAL_DOCUMENTATION_ACCESS_ROLES);
}

export function canAccessMar(input: Pick<UserProfile, "role" | "permissions">) {
  return hasRoleScopedModulePermission({
    role: input.role,
    permissions: input.permissions,
    module: "health",
    action: "canView",
    allowedRoles: MAR_MODULE_ROLES
  });
}

export function canDocumentMar(input: Pick<UserProfile, "role" | "permissions">) {
  return hasRoleScopedModulePermission({
    role: input.role,
    permissions: input.permissions,
    module: "health",
    action: "canEdit",
    allowedRoles: MAR_MODULE_ROLES
  });
}

export function canAccessMemberCommandCenter(input: Pick<UserProfile, "role" | "permissions">) {
  return hasModulePermission(input.permissions, "operations", "canView");
}

export function canEditMemberCommandCenter(input: Pick<UserProfile, "role" | "permissions">) {
  return hasRoleScopedModulePermission({
    role: input.role,
    permissions: input.permissions,
    module: "operations",
    action: "canEdit",
    allowedRoles: MEMBER_COMMAND_CENTER_EDITOR_ROLES
  });
}

export function canEditMemberCommandCenterAttendanceBilling(input: Pick<UserProfile, "role" | "permissions">) {
  return (
    hasRoleScopedModulePermission({
      role: input.role,
      permissions: input.permissions,
      module: "operations",
      action: "canEdit",
      allowedRoles: MEMBER_COMMAND_CENTER_ATTENDANCE_EDITOR_ROLES
    }) || hasModulePermission(input.permissions, "operations", "canEdit")
  );
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
