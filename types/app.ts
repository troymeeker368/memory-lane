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

export type AppNavIconKey =
  | "Activity"
  | "AlarmClockCheck"
  | "BadgeAlert"
  | "BarChart3"
  | "Bath"
  | "Bell"
  | "BookUser"
  | "Building2"
  | "BusFront"
  | "CalendarCheck2"
  | "CalendarClock"
  | "CalendarDays"
  | "Car"
  | "CircleDollarSign"
  | "CirclePause"
  | "ClipboardCheck"
  | "ClipboardList"
  | "ClipboardPlus"
  | "Clock3"
  | "CreditCard"
  | "FileHeart"
  | "FilePenLine"
  | "FileSpreadsheet"
  | "FolderSearch"
  | "GitBranch"
  | "HandCoins"
  | "HeartPulse"
  | "ImageUp"
  | "LayoutDashboard"
  | "Lock"
  | "MonitorCog"
  | "NotebookText"
  | "PillBottle"
  | "ReceiptText"
  | "ShowerHead"
  | "TriangleAlert"
  | "TrendingUp"
  | "UserRoundCog"
  | "Users"
  | "WalletCards";

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
  icon: AppNavIconKey;
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
  status?: "invited" | "active" | "disabled";
  is_active?: boolean;
  invited_at?: string | null;
  password_set_at?: string | null;
  last_sign_in_at?: string | null;
  disabled_at?: string | null;
  staff_id: string | null;
  permissions: PermissionSet;
  has_custom_permissions?: boolean;
  permission_source?: "role-template" | "custom-override";
}

export type UserStatus = "active" | "inactive";

export interface ManagedUser {
  id: string;
  authUserId: string;
  firstName: string;
  lastName: string;
  displayName: string;
  credentials: string | null;
  email: string;
  role: AppRole;
  status: UserStatus;
  authStatus: "invited" | "active" | "disabled";
  invitedAt: string | null;
  passwordSetAt: string | null;
  lastSignInAt: string | null;
  disabledAt: string | null;
  isActive: boolean;
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
