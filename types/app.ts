export type CanonicalAppRole =
  | "program-assistant"
  | "coordinator"
  | "nurse"
  | "sales"
  | "manager"
  | "director"
  | "admin";

// Keep legacy "staff" compatibility for existing persisted role data.
export type AppRole = CanonicalAppRole | "staff";

export type NavGroup = "Documentation" | "Operations" | "Reports" | "Time & HR" | "Sales Activities" | "Health Unit";

export type PermissionModuleKey =
  | "documentation"
  | "operations"
  | "reports"
  | "time-hr"
  | "sales-activities"
  | "health-unit"
  | "admin-reports"
  | "user-management";

export interface ModulePermission {
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canAdmin: boolean;
}

export type PermissionSet = Record<PermissionModuleKey, ModulePermission>;

export type ModuleKey =
  | "dashboard"
  | "time-card"
  | "documentation"
  | "operations"
  | "health"
  | "ancillary"
  | "sales"
  | "reports"
  | "pto"
  | "admin-reports"
  | "user-management";

export type AuditAction =
  | "login"
  | "clock_in"
  | "clock_out"
  | "create_log"
  | "update_log"
  | "create_lead"
  | "update_lead"
  | "send_email"
  | "upload_photo"
  | "manager_review";

export interface AppNavItem {
  label: string;
  href: string;
  group: NavGroup;
  module: ModuleKey;
  roles?: AppRole[];
  external?: boolean;
}

export interface DashboardAlert {
  id: string;
  severity: "info" | "warning" | "critical";
  message: string;
  actionLabel?: string;
  actionHref?: string;
}

export interface UserProfile {
  id: string;
  email: string;
  full_name: string;
  role: AppRole;
  active: boolean;
  staff_id: string | null;
  permissions: PermissionSet;
  has_custom_permissions?: boolean;
  permission_source?: "role-template" | "custom-override";
}

export type UserStatus = "active" | "inactive";

export interface ManagedUser {
  id: string;
  firstName: string;
  lastName: string;
  displayName: string;
  credentials: string | null;
  email: string;
  role: AppRole;
  status: UserStatus;
  phone: string | null;
  title: string | null;
  department: string | null;
  defaultLanding: string;
  permissions: PermissionSet;
  hasCustomPermissions: boolean;
  customPermissions: PermissionSet | null;
  permissionSource: "role-template" | "custom-override";
  lastLogin: string | null;
  createdAt: string;
  updatedAt: string;
}
