import type { AppRole, ManagedUser, PermissionModuleKey, PermissionSet, UserStatus } from "@/types/app";
import { getDefaultPermissionSet, normalizePermissionSet, PERMISSION_MODULES } from "@/lib/permissions";
import { readMockStateJson, writeMockStateJson } from "@/lib/mock-persistence";
import { getMockDb, replaceMockStaff } from "@/lib/mock-repo";
import { isMockMode } from "@/lib/runtime";
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

interface PersistedManagedUsersState {
  version: 1;
  sequence: number;
  users: ManagedUser[];
}

const DEFAULT_LANDING = "/";
const MANAGED_USERS_FILE = "managed-users.json";

const ROLE_DEFAULT_DEPARTMENT: Record<AppRole, string> = {
  admin: "Administration",
  manager: "Operations",
  nurse: "Health Unit",
  staff: "Frontline Staff"
};

function asDate(value?: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseDateInput(raw?: string | null, endOfDay = false) {
  if (!raw) return null;
  const suffix = endOfDay ? "T23:59:59.999" : "T00:00:00.000";
  return asDate(`${raw}${suffix}`);
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

function isWithinRange(value: string, fromDate: Date, toDate: Date) {
  const parsed = asDate(value);
  if (!parsed) return false;
  return parsed >= fromDate && parsed <= toDate;
}

let managedUsers: ManagedUser[] | null = null;
let sequence = 0;

function createId(prefix: string) {
  sequence += 1;
  return `${prefix}-${String(sequence).padStart(4, "0")}`;
}

function splitName(fullName: string) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return { firstName: "User", lastName: "Account" };
  }

  if (parts.length === 1) {
    return { firstName: parts[0], lastName: "" };
  }

  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" ")
  };
}

function normalizeString(value?: string | null) {
  const cleaned = (value ?? "").trim();
  return cleaned.length > 0 ? cleaned : null;
}

function resolveSequence(rows: ManagedUser[]) {
  const maxFromIds = rows.reduce((max, row) => {
    const match = /-(\d+)$/.exec(row.id);
    if (!match) return max;
    const numeric = Number(match[1]);
    return Number.isFinite(numeric) ? Math.max(max, numeric) : max;
  }, 0);

  return maxFromIds;
}

function normalizePersistedUsersState(candidate: PersistedManagedUsersState | null | undefined): PersistedManagedUsersState | null {
  if (!candidate || candidate.version !== 1 || !Array.isArray(candidate.users)) {
    return null;
  }

  const users = candidate.users.map((user) => ({
    ...user,
    permissions: normalizePermissionSet(user.permissions)
  }));

  const computedSequence = resolveSequence(users);

  return {
    version: 1,
    users,
    sequence: Number.isFinite(candidate.sequence) ? Math.max(candidate.sequence, computedSequence) : computedSequence
  };
}

function toStaffIdFromUser(userId: string) {
  return userId.startsWith("stf_") ? userId : `stf_${userId}`;
}

function syncMockStaff(rows: ManagedUser[]) {
  const db = getMockDb();
  const existingById = new Map(db.staff.map((staff) => [staff.id, staff]));

  const staffRows = rows.map((user) => {
    const existing = existingById.get(user.id);
    const email = user.email || `${user.displayName.toLowerCase().replace(/\s+/g, ".")}@memorylane.local`;

    return {
      id: user.id,
      staff_id: existing?.staff_id ?? toStaffIdFromUser(user.id),
      full_name: user.displayName,
      email,
      email_normalized: email.toLowerCase(),
      role: user.role,
      active: user.status === "active"
    };
  });

  replaceMockStaff(staffRows);
}

function persistManagedUsers() {
  if (!managedUsers) return;

  writeMockStateJson<PersistedManagedUsersState>(MANAGED_USERS_FILE, {
    version: 1,
    sequence,
    users: managedUsers
  });

  syncMockStaff(managedUsers);
}

function seedUsersFromStaff() {
  const db = getMockDb();
  const now = toEasternISO();

  const rows = db.staff.map((staff, index) => {
    const name = splitName(staff.full_name);
    return {
      id: staff.id,
      firstName: name.firstName,
      lastName: name.lastName,
      displayName: staff.full_name,
      email: staff.email || `${staff.full_name.toLowerCase().replace(/\s+/g, ".")}@memorylane.local`,
      role: staff.role,
      status: staff.active ? "active" : "inactive",
      phone: null,
      title: staff.role === "nurse" ? "Center Nurse" : staff.role === "manager" ? "Center Manager" : null,
      department: ROLE_DEFAULT_DEPARTMENT[staff.role],
      defaultLanding: DEFAULT_LANDING,
      permissions: getDefaultPermissionSet(staff.role),
      lastLogin: toEasternISO(new Date(Date.now() - (index + 1) * 3600000)),
      createdAt: now,
      updatedAt: now
    } satisfies ManagedUser;
  });

  managedUsers = rows;
  sequence = resolveSequence(rows);
  persistManagedUsers();

  return rows;
}

function ensureStore() {
  if (managedUsers) {
    return managedUsers;
  }

  const persisted = normalizePersistedUsersState(readMockStateJson<PersistedManagedUsersState | null>(MANAGED_USERS_FILE, null));

  if (persisted && persisted.users.length > 0) {
    managedUsers = persisted.users;
    sequence = persisted.sequence;
    syncMockStaff(managedUsers);
    return managedUsers;
  }

  return seedUsersFromStaff();
}

function sanitizeManagedUserInput(input: ManagedUserInput): ManagedUserInput {
  return {
    firstName: input.firstName.trim(),
    lastName: input.lastName.trim(),
    displayName: input.displayName.trim(),
    email: input.email.trim().toLowerCase(),
    role: input.role,
    status: input.status,
    phone: normalizeString(input.phone),
    title: normalizeString(input.title),
    department: normalizeString(input.department) ?? ROLE_DEFAULT_DEPARTMENT[input.role],
    defaultLanding: normalizeString(input.defaultLanding) ?? DEFAULT_LANDING
  };
}

export function listManagedUsers(filters?: ManagedUserFilters): ManagedUser[] {
  const rows = ensureStore();
  const search = (filters?.search ?? "").trim().toLowerCase();

  return rows
    .filter((row) => {
      if (filters?.role && filters.role !== "all" && row.role !== filters.role) return false;
      if (filters?.status && filters.status !== "all" && row.status !== filters.status) return false;
      if (!search) return true;

      const haystack = [row.displayName, row.email, row.role, row.department ?? ""].join(" ").toLowerCase();
      return haystack.includes(search);
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export function getManagedUserById(userId: string): ManagedUser | null {
  const rows = ensureStore();
  return rows.find((row) => row.id === userId) ?? null;
}

export function createManagedUser(input: ManagedUserInput): ManagedUser {
  const rows = ensureStore();
  const cleaned = sanitizeManagedUserInput(input);
  const now = toEasternISO();

  const next: ManagedUser = {
    id: createId("usr"),
    firstName: cleaned.firstName,
    lastName: cleaned.lastName,
    displayName: cleaned.displayName,
    email: cleaned.email,
    role: cleaned.role,
    status: cleaned.status,
    phone: cleaned.phone ?? null,
    title: cleaned.title ?? null,
    department: cleaned.department ?? null,
    defaultLanding: cleaned.defaultLanding ?? DEFAULT_LANDING,
    permissions: getDefaultPermissionSet(cleaned.role),
    lastLogin: null,
    createdAt: now,
    updatedAt: now
  };

  rows.unshift(next);
  persistManagedUsers();
  return next;
}

export function updateManagedUser(userId: string, patch: ManagedUserInput): ManagedUser | null {
  const rows = ensureStore();
  const index = rows.findIndex((row) => row.id === userId);
  if (index < 0) return null;

  const current = rows[index];
  const cleaned = sanitizeManagedUserInput(patch);
  const now = toEasternISO();

  let permissions = current.permissions;
  if (current.role !== cleaned.role) {
    permissions = getDefaultPermissionSet(cleaned.role);
  }

  const next: ManagedUser = {
    ...current,
    firstName: cleaned.firstName,
    lastName: cleaned.lastName,
    displayName: cleaned.displayName,
    email: cleaned.email,
    role: cleaned.role,
    status: cleaned.status,
    phone: cleaned.phone ?? null,
    title: cleaned.title ?? null,
    department: cleaned.department ?? null,
    defaultLanding: cleaned.defaultLanding ?? DEFAULT_LANDING,
    permissions,
    updatedAt: now
  };

  rows[index] = next;
  persistManagedUsers();
  return next;
}

export function setManagedUserStatus(userId: string, status: UserStatus): ManagedUser | null {
  const rows = ensureStore();
  const index = rows.findIndex((row) => row.id === userId);
  if (index < 0) return null;

  const next: ManagedUser = {
    ...rows[index],
    status,
    updatedAt: toEasternISO()
  };

  rows[index] = next;
  persistManagedUsers();
  return next;
}

export function updateManagedUserPermissions(userId: string, permissions: PermissionSet): ManagedUser | null {
  const rows = ensureStore();
  const index = rows.findIndex((row) => row.id === userId);
  if (index < 0) return null;

  const next: ManagedUser = {
    ...rows[index],
    permissions: normalizePermissionSet(permissions),
    updatedAt: toEasternISO()
  };

  rows[index] = next;
  persistManagedUsers();
  return next;
}

export function getRoleOptions(): AppRole[] {
  return ["staff", "nurse", "manager", "admin"];
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

export function getUserManagementMetrics() {
  const rows = ensureStore();
  const active = rows.filter((row) => row.status === "active").length;
  const inactive = rows.length - active;

  return {
    total: rows.length,
    active,
    inactive,
    admins: rows.filter((row) => row.role === "admin").length,
    managers: rows.filter((row) => row.role === "manager").length,
    nurses: rows.filter((row) => row.role === "nurse").length,
    staff: rows.filter((row) => row.role === "staff").length
  };
}

export function getManagedUserRecentActivity(
  userId: string,
  options?: { from?: string; to?: string; limit?: number }
): ManagedUserRecentActivityResult {
  const range = resolveActivityRange(options?.from, options?.to, 30);
  const limit = Math.max(1, Math.min(options?.limit ?? 100, 500));
  const emptyResult: ManagedUserRecentActivityResult = {
    from: range.fromLabel,
    to: range.toLabel,
    total: 0,
    items: [],
    counts: []
  };

  if (!isMockMode()) {
    // TODO(backend): Replace with joined user-activity feed query from persistent audit/log tables.
    return emptyResult;
  }

  const user = getManagedUserById(userId);
  if (!user) return emptyResult;

  const db = getMockDb();
  const items: ManagedUserRecentActivityItem[] = [];

  db.timePunches
    .filter((row) => row.staff_user_id === user.id)
    .forEach((row) =>
      items.push({
        id: `punch-${row.id}`,
        occurredAt: row.punch_at,
        activityType: "Time Punch",
        context: row.punch_type.toUpperCase(),
        details: `In fence: ${row.within_fence ? "Yes" : "No"}${row.distance_meters !== null ? ` | ${row.distance_meters}m` : ""}`,
        href: "/time-card/punch-history"
      })
    );

  db.dailyActivities
    .filter((row) => row.staff_user_id === user.id)
    .forEach((row) =>
      items.push({
        id: `daily-${row.id}`,
        occurredAt: row.created_at || row.timestamp,
        activityType: "Participation Log",
        context: row.member_name,
        details: `Participation ${row.participation}%`,
        href: "/documentation/activity"
      })
    );

  db.toiletLogs
    .filter((row) => row.staff_user_id === user.id)
    .forEach((row) =>
      items.push({
        id: `toilet-${row.id}`,
        occurredAt: row.event_at,
        activityType: "Toilet Log",
        context: row.member_name,
        details: `${row.use_type}${row.briefs ? " | Briefs changed" : ""}`,
        href: "/documentation/toilet"
      })
    );

  db.showerLogs
    .filter((row) => row.staff_user_id === user.id)
    .forEach((row) =>
      items.push({
        id: `shower-${row.id}`,
        occurredAt: row.event_at,
        activityType: "Shower Log",
        context: row.member_name,
        details: row.laundry ? "Laundry included" : "Shower only",
        href: "/documentation/shower"
      })
    );

  db.transportationLogs
    .filter((row) => row.staff_user_id === user.id)
    .forEach((row) =>
      items.push({
        id: `transport-${row.id}`,
        occurredAt: row.timestamp || `${row.service_date}T12:00:00.000`,
        activityType: "Transportation Log",
        context: row.member_name,
        details: `${row.period} ${row.transport_type}`,
        href: "/documentation/transportation"
      })
    );

  db.photoUploads
    .filter((row) => row.uploaded_by === user.id)
    .forEach((row) =>
      items.push({
        id: `photo-${row.id}`,
        occurredAt: row.uploaded_at,
        activityType: "Photo Upload",
        context: row.file_name,
        details: row.file_type || "image/*",
        href: "/documentation/photo-upload"
      })
    );

  db.bloodSugarLogs
    .filter((row) => row.nurse_user_id === user.id)
    .forEach((row) =>
      items.push({
        id: `blood-${row.id}`,
        occurredAt: row.checked_at,
        activityType: "Blood Sugar",
        context: row.member_name,
        details: `${row.reading_mg_dl} mg/dL`,
        href: "/documentation/blood-sugar"
      })
    );

  db.ancillaryLogs
    .filter((row) => row.staff_user_id === user.id)
    .forEach((row) =>
      items.push({
        id: `ancillary-${row.id}`,
        occurredAt: row.created_at || row.timestamp || `${row.service_date}T12:00:00.000`,
        activityType: "Ancillary Charge",
        context: row.member_name,
        details: `${row.category_name} | $${(row.amount_cents / 100).toFixed(2)}`,
        href: "/ancillary"
      })
    );

  db.assessments
    .filter((row) => row.created_by_user_id === user.id)
    .forEach((row) =>
      items.push({
        id: `assessment-${row.id}`,
        occurredAt: row.created_at,
        activityType: "Intake Assessment",
        context: row.member_name,
        details: `${row.recommended_track} | Score ${row.total_score}`,
        href: `/reports/assessments/${row.id}`
      })
    );

  db.leads
    .filter((row) => row.created_by_user_id === user.id)
    .forEach((row) =>
      items.push({
        id: `lead-${row.id}`,
        occurredAt: row.created_at,
        activityType: "Lead Created",
        context: row.member_name,
        details: `${row.stage} | ${row.status}`,
        href: `/sales/leads/${row.id}`
      })
    );

  db.leadActivities
    .filter((row) => row.completed_by_user_id === user.id)
    .forEach((row) =>
      items.push({
        id: `lead-activity-${row.id}`,
        occurredAt: row.activity_at,
        activityType: "Lead Activity",
        context: row.member_name,
        details: `${row.activity_type} | ${row.outcome}`,
        href: `/sales/leads/${row.lead_id}`
      })
    );

  db.partnerActivities
    .filter((row) => row.completed_by_user_id === user.id || row.completed_by === user.displayName)
    .forEach((row) =>
      items.push({
        id: `partner-activity-${row.id}`,
        occurredAt: row.activity_at,
        activityType: "Partner Activity",
        context: row.organization_name,
        details: `${row.contact_name} | ${row.activity_type}`,
        href: "/sales/activities"
      })
    );

  const filtered = items
    .filter((item) => isWithinRange(item.occurredAt, range.fromDate, range.toDate))
    .sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1));
  const limited = filtered.slice(0, limit);

  const countsMap = new Map<string, number>();
  limited.forEach((item) => {
    countsMap.set(item.activityType, (countsMap.get(item.activityType) ?? 0) + 1);
  });

  return {
    from: range.fromLabel,
    to: range.toLabel,
    total: limited.length,
    items: limited,
    counts: Array.from(countsMap.entries())
      .map(([activityType, count]) => ({ activityType, count }))
      .sort((a, b) => (a.activityType > b.activityType ? 1 : -1))
  };
}
