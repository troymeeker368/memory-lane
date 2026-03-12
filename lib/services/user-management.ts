import { randomBytes } from "node:crypto";

import type { AppRole, ManagedUser, PermissionModuleKey, PermissionSet, UserStatus } from "@/types/app";
import {
  CANONICAL_ROLE_ORDER,
  getDefaultPermissionSet,
  normalizePermissionSet,
  normalizeRoleKey,
  PERMISSION_MODULES,
  resolveEffectivePermissionSet
} from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { toEasternDate, toEasternISO } from "@/lib/timezone";

export interface ManagedUserFilters {
  search?: string;
  role?: AppRole | "all";
  status?: UserStatus | "all";
}

export interface ManagedUserInput {
  firstName: string;
  lastName: string;
  displayName: string;
  credentials?: string | null;
  email: string;
  role: AppRole;
  status: UserStatus;
  phone?: string | null;
  title?: string | null;
  department?: string | null;
  defaultLanding?: string;
}

export interface ManagedUserRecentActivityItem {
  id: string;
  occurredAt: string;
  activityType: string;
  context: string;
  details: string;
  href: string;
}

export interface ManagedUserRecentActivityResult {
  from: string;
  to: string;
  total: number;
  items: ManagedUserRecentActivityItem[];
  counts: Array<{ activityType: string; count: number }>;
}

const DEFAULT_LANDING = "/";

const ROLE_DEFAULT_DEPARTMENT: Record<Exclude<AppRole, "staff">, string> = {
  "program-assistant": "Frontline Operations",
  coordinator: "Center Coordination",
  sales: "Sales Activities",
  director: "Executive Leadership",
  admin: "Administration",
  manager: "Operations",
  nurse: "Health Unit"
};

function normalizeString(value?: string | null) {
  const cleaned = (value ?? "").trim();
  return cleaned.length > 0 ? cleaned : null;
}

function splitName(fullName: string) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return { firstName: "User", lastName: "" };
  }
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: "" };
  }
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

function formatNameWithCredentialsCore(name: string, credentials?: string | null) {
  const baseName = String(name ?? "").trim();
  const normalizedCredentials = normalizeString(credentials);
  if (!normalizedCredentials) return baseName;
  if (!baseName) return normalizedCredentials;
  if (baseName.toLowerCase().endsWith(normalizedCredentials.toLowerCase())) {
    return baseName;
  }
  return `${baseName}, ${normalizedCredentials}`;
}

function defaultDepartmentForRole(role: AppRole) {
  return ROLE_DEFAULT_DEPARTMENT[normalizeRoleKey(role)] ?? "Operations";
}

function parseDateInput(raw?: string | null, endOfDay = false) {
  if (!raw) return null;
  const suffix = endOfDay ? "T23:59:59.999" : "T00:00:00.000";
  const parsed = new Date(`${raw}${suffix}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function resolveActivityRange(rawFrom?: string, rawTo?: string, fallbackDays = 30) {
  const now = new Date();
  const toDate = parseDateInput(rawTo, true) ?? now;
  const fallbackFrom = new Date(toDate.getTime());
  fallbackFrom.setDate(fallbackFrom.getDate() - (fallbackDays - 1));
  fallbackFrom.setHours(0, 0, 0, 0);
  const fromDate = parseDateInput(rawFrom, false) ?? fallbackFrom;
  const safeFrom = fromDate <= toDate ? fromDate : toDate;
  const safeTo = fromDate <= toDate ? toDate : fromDate;
  return {
    fromDate: safeFrom,
    toDate: safeTo,
    fromLabel: toEasternDate(safeFrom),
    toLabel: toEasternDate(safeTo)
  };
}

function mapPermissionRowsToSet(role: AppRole, rows: any[]): { permissions: PermissionSet; hasCustomPermissions: boolean } {
  if (!rows || rows.length === 0) {
    return {
      permissions: getDefaultPermissionSet(role),
      hasCustomPermissions: false
    };
  }
  const custom = rows.reduce((acc, row) => {
    const moduleKey = String(row.module_key) as PermissionModuleKey;
    if (!PERMISSION_MODULES.includes(moduleKey)) return acc;
    acc[moduleKey] = {
      canView: Boolean(row.can_view),
      canCreate: Boolean(row.can_create),
      canEdit: Boolean(row.can_edit),
      canAdmin: Boolean(row.can_admin)
    };
    return acc;
  }, {} as PermissionSet);
  return {
    permissions: resolveEffectivePermissionSet({
      role,
      hasCustomPermissions: true,
      customPermissions: normalizePermissionSet(custom)
    }),
    hasCustomPermissions: true
  };
}

async function loadManagedUsers() {
  const supabase = await createClient();
  const [{ data: profileRows, error: profileError }, { data: permissionRows, error: permissionError }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, email, full_name, role, active, created_at, updated_at")
      .order("full_name", { ascending: true }),
    supabase
      .from("user_permissions")
      .select("user_id, module_key, can_view, can_create, can_edit, can_admin")
  ]);

  if (profileError) throw new Error(profileError.message);
  if (permissionError) throw new Error(permissionError.message);

  const permissionsByUser = new Map<string, any[]>();
  (permissionRows ?? []).forEach((row: any) => {
    const key = String(row.user_id);
    const list = permissionsByUser.get(key) ?? [];
    list.push(row);
    permissionsByUser.set(key, list);
  });

  return (profileRows ?? []).map((row: any) => {
    const role = normalizeRoleKey(row.role as AppRole);
    const names = splitName(String(row.full_name ?? ""));
    const permissionState = mapPermissionRowsToSet(role, permissionsByUser.get(String(row.id)) ?? []);

    return {
      id: String(row.id),
      firstName: names.firstName,
      lastName: names.lastName,
      displayName: String(row.full_name ?? "").trim(),
      credentials: null,
      email: String(row.email ?? ""),
      role,
      status: row.active ? "active" : "inactive",
      phone: null,
      title: null,
      department: defaultDepartmentForRole(role),
      defaultLanding: DEFAULT_LANDING,
      permissions: permissionState.permissions,
      hasCustomPermissions: permissionState.hasCustomPermissions,
      customPermissions: permissionState.hasCustomPermissions ? permissionState.permissions : null,
      permissionSource: permissionState.hasCustomPermissions ? "custom-override" : "role-template",
      lastLogin: null,
      createdAt: String(row.created_at ?? toEasternISO()),
      updatedAt: String(row.updated_at ?? toEasternISO())
    } satisfies ManagedUser;
  });
}

function sanitizeManagedUserInput(input: ManagedUserInput): ManagedUserInput {
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  const displayName = input.displayName.trim() || `${firstName} ${lastName}`.trim();
  const normalizedRole = normalizeRoleKey(input.role);
  return {
    firstName: firstName || "User",
    lastName,
    displayName,
    credentials: normalizeString(input.credentials),
    email: input.email.trim().toLowerCase(),
    role: normalizedRole,
    status: input.status,
    phone: normalizeString(input.phone),
    title: normalizeString(input.title),
    department: normalizeString(input.department) ?? defaultDepartmentForRole(normalizedRole),
    defaultLanding: normalizeString(input.defaultLanding) ?? DEFAULT_LANDING
  };
}

async function replaceUserPermissions(userId: string, permissions: PermissionSet | null) {
  const supabase = await createClient();
  const { error: deleteError } = await supabase.from("user_permissions").delete().eq("user_id", userId);
  if (deleteError) throw new Error(deleteError.message);
  if (!permissions) return;

  const rows = PERMISSION_MODULES.map((module) => ({
    user_id: userId,
    module_key: module,
    can_view: Boolean(permissions[module].canView),
    can_create: Boolean(permissions[module].canCreate),
    can_edit: Boolean(permissions[module].canEdit),
    can_admin: Boolean(permissions[module].canAdmin),
    created_at: toEasternISO(),
    updated_at: toEasternISO()
  }));
  const { error: insertError } = await supabase.from("user_permissions").insert(rows);
  if (insertError) throw new Error(insertError.message);
}

export async function listManagedUsers(filters?: ManagedUserFilters): Promise<ManagedUser[]> {
  const rows = await loadManagedUsers();
  const search = (filters?.search ?? "").trim().toLowerCase();

  return rows
    .filter((row) => {
      if (filters?.role && filters.role !== "all" && normalizeRoleKey(row.role) !== normalizeRoleKey(filters.role)) return false;
      if (filters?.status && filters.status !== "all" && row.status !== filters.status) return false;
      if (!search) return true;
      const haystack = [row.displayName, row.credentials ?? "", row.email, row.role, row.department ?? ""]
        .join(" ")
        .toLowerCase();
      return haystack.includes(search);
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export async function getManagedUserById(userId: string): Promise<ManagedUser | null> {
  const rows = await loadManagedUsers();
  return rows.find((row) => row.id === userId) ?? null;
}

export function formatNameWithCredentials(name: string, credentials?: string | null) {
  return formatNameWithCredentialsCore(name, credentials);
}

export async function getManagedUserSignatureName(userId: string, fallbackName: string) {
  const managedUser = await getManagedUserById(userId);
  return formatNameWithCredentialsCore(fallbackName, managedUser?.credentials ?? null);
}

export async function getManagedUserSignoffLabel(userId: string, fallbackName: string) {
  const managedUser = await getManagedUserById(userId);
  const signatureName = formatNameWithCredentialsCore(fallbackName, managedUser?.credentials ?? null);
  const title = normalizeString(managedUser?.title ?? null);
  return title ? `${signatureName} (${title})` : signatureName;
}

export async function createManagedUser(input: ManagedUserInput): Promise<ManagedUser> {
  const cleaned = sanitizeManagedUserInput(input);
  const role = normalizeRoleKey(cleaned.role);
  const now = toEasternISO();

  const admin = createSupabaseAdminClient();
  const tempPassword = randomBytes(18).toString("base64url");
  const { data: createdAuthUser, error: authError } = await admin.auth.admin.createUser({
    email: cleaned.email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { full_name: cleaned.displayName }
  });
  if (authError || !createdAuthUser?.user?.id) {
    throw new Error(authError?.message ?? "Unable to create auth user.");
  }
  const userId = createdAuthUser.user.id;

  const supabase = await createClient();
  const { error: profileError } = await supabase.from("profiles").insert({
    id: userId,
    email: cleaned.email,
    full_name: cleaned.displayName,
    role,
    active: cleaned.status === "active",
    created_at: now,
    updated_at: now
  });
  if (profileError) {
    throw new Error(profileError.message);
  }

  await replaceUserPermissions(userId, null);

  return {
    id: userId,
    firstName: cleaned.firstName,
    lastName: cleaned.lastName,
    displayName: cleaned.displayName,
    credentials: cleaned.credentials ?? null,
    email: cleaned.email,
    role,
    status: cleaned.status,
    phone: cleaned.phone ?? null,
    title: cleaned.title ?? null,
    department: cleaned.department ?? null,
    defaultLanding: cleaned.defaultLanding ?? DEFAULT_LANDING,
    permissions: getDefaultPermissionSet(role),
    hasCustomPermissions: false,
    customPermissions: null,
    permissionSource: "role-template",
    lastLogin: null,
    createdAt: now,
    updatedAt: now
  };
}

export async function updateManagedUser(userId: string, patch: ManagedUserInput): Promise<ManagedUser | null> {
  const current = await getManagedUserById(userId);
  if (!current) return null;

  const cleaned = sanitizeManagedUserInput(patch);
  const role = normalizeRoleKey(cleaned.role);
  const now = toEasternISO();

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({
      email: cleaned.email,
      full_name: cleaned.displayName,
      role,
      active: cleaned.status === "active",
      updated_at: now
    })
    .eq("id", userId);
  if (error) throw new Error(error.message);

  const roleDefaults = getDefaultPermissionSet(role);
  const permissions = current.hasCustomPermissions ? current.permissions : roleDefaults;

  return {
    ...current,
    firstName: cleaned.firstName,
    lastName: cleaned.lastName,
    displayName: cleaned.displayName,
    credentials: cleaned.credentials ?? null,
    email: cleaned.email,
    role,
    status: cleaned.status,
    phone: cleaned.phone ?? null,
    title: cleaned.title ?? null,
    department: cleaned.department ?? null,
    defaultLanding: cleaned.defaultLanding ?? DEFAULT_LANDING,
    permissions,
    hasCustomPermissions: current.hasCustomPermissions,
    customPermissions: current.hasCustomPermissions ? permissions : null,
    permissionSource: current.hasCustomPermissions ? "custom-override" : "role-template",
    updatedAt: now
  };
}

export async function setManagedUserStatus(userId: string, status: UserStatus): Promise<ManagedUser | null> {
  const current = await getManagedUserById(userId);
  if (!current) return null;
  const now = toEasternISO();
  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ active: status === "active", updated_at: now })
    .eq("id", userId);
  if (error) throw new Error(error.message);

  return {
    ...current,
    status,
    updatedAt: now
  };
}

export async function updateManagedUserPermissions(userId: string, permissions: PermissionSet): Promise<ManagedUser | null> {
  const current = await getManagedUserById(userId);
  if (!current) return null;
  const normalized = normalizePermissionSet(permissions);
  await replaceUserPermissions(userId, normalized);
  return {
    ...current,
    permissions: normalized,
    hasCustomPermissions: true,
    customPermissions: normalized,
    permissionSource: "custom-override",
    updatedAt: toEasternISO()
  };
}

export async function resetManagedUserPermissionsToRoleDefaults(userId: string): Promise<ManagedUser | null> {
  const current = await getManagedUserById(userId);
  if (!current) return null;
  await replaceUserPermissions(userId, null);
  const roleDefaults = getDefaultPermissionSet(current.role);
  return {
    ...current,
    permissions: roleDefaults,
    hasCustomPermissions: false,
    customPermissions: null,
    permissionSource: "role-template",
    updatedAt: toEasternISO()
  };
}

export function getRoleOptions(): AppRole[] {
  return [...CANONICAL_ROLE_ORDER];
}

export function getPermissionModules(): PermissionModuleKey[] {
  return [...PERMISSION_MODULES];
}

export function summarizePermissionSet(permissions: PermissionSet) {
  return PERMISSION_MODULES.map((module) => ({
    module,
    ...permissions[module]
  }));
}

export async function getUserManagementMetrics() {
  const rows = await loadManagedUsers();
  const byRole = CANONICAL_ROLE_ORDER.reduce((acc, role) => {
    acc[role] = 0;
    return acc;
  }, {} as Record<string, number>);

  let active = 0;
  rows.forEach((row) => {
    if (row.status === "active") active += 1;
    const role = normalizeRoleKey(row.role);
    byRole[role] = (byRole[role] ?? 0) + 1;
  });

  return {
    total: rows.length,
    active,
    inactive: rows.length - active,
    byRole
  };
}

export async function getManagedUserRecentActivity(
  userId: string,
  options?: { from?: string; to?: string; limit?: number }
): Promise<ManagedUserRecentActivityResult> {
  const range = resolveActivityRange(options?.from, options?.to, 30);
  const limit = Math.max(1, Math.min(options?.limit ?? 100, 500));
  const user = await getManagedUserById(userId);
  if (!user) {
    return {
      from: range.fromLabel,
      to: range.toLabel,
      total: 0,
      items: [],
      counts: []
    };
  }

  const supabase = await createClient();
  const { data: rows, error } = await supabase
    .from("audit_logs")
    .select("id, action, entity_type, entity_id, details, created_at")
    .eq("actor_user_id", userId)
    .gte("created_at", range.fromDate.toISOString())
    .lte("created_at", range.toDate.toISOString())
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);

  const items: ManagedUserRecentActivityItem[] = (rows ?? []).map((row: any) => ({
    id: String(row.id),
    occurredAt: String(row.created_at),
    activityType: String(row.entity_type ?? row.action ?? "Activity"),
    context: String(row.entity_id ?? "n/a"),
    details: String(row.action ?? "activity"),
    href: "/reports/activity-audit"
  }));

  const countsMap = new Map<string, number>();
  items.forEach((item) => {
    countsMap.set(item.activityType, (countsMap.get(item.activityType) ?? 0) + 1);
  });

  return {
    from: range.fromLabel,
    to: range.toLabel,
    total: items.length,
    items,
    counts: Array.from(countsMap.entries())
      .map(([activityType, count]) => ({ activityType, count }))
      .sort((a, b) => (a.activityType > b.activityType ? 1 : -1))
  };
}
