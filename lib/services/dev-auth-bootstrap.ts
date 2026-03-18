import { normalizeRoleKey } from "@/lib/permissions/core";
import { getDevAuthBootstrapPassword, getDevAuthBootstrapUsersJson, isDevAuthBypassEnabled } from "@/lib/runtime";
import { createClient } from "@/lib/supabase/server";
import type { AppRole } from "@/types/app";

export interface DevAuthBootstrapAccount {
  email: string;
  role: AppRole;
  label: string;
}

type ParsedConfiguredDevAccount = DevAuthBootstrapAccount & {
  password: string;
};

const DEV_AUTH_ROLE_PRIORITY: AppRole[] = [
  "admin",
  "nurse",
  "sales",
  "manager",
  "coordinator",
  "program-assistant",
  "director"
];

function clean(value: string | null | undefined) {
  const normalized = (value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeEmail(value: string | null | undefined) {
  return clean(value)?.toLowerCase() ?? null;
}

function isEmail(value: string | null | undefined) {
  const normalized = normalizeEmail(value);
  return Boolean(normalized && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized));
}

function dedupeByEmail<T extends { email: string }>(rows: T[]) {
  const seen = new Set<string>();
  const result: T[] = [];
  rows.forEach((row) => {
    const key = row.email.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    result.push(row);
  });
  return result;
}

function parseConfiguredDevAccounts(): ParsedConfiguredDevAccount[] {
  const raw = getDevAuthBootstrapUsersJson();
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("DEV_AUTH_BOOTSTRAP_USERS_JSON must be valid JSON.");
  }

  if (!Array.isArray(parsed)) {
    throw new Error("DEV_AUTH_BOOTSTRAP_USERS_JSON must be a JSON array.");
  }

  const result: ParsedConfiguredDevAccount[] = [];
  parsed.forEach((item) => {
    const row = item as Record<string, unknown>;
    const email = normalizeEmail(String(row.email ?? ""));
    const password = clean(String(row.password ?? ""));
    if (!email || !password || !isEmail(email)) return;
    const role = normalizeRoleKey(String(row.role ?? "program-assistant") as AppRole);
    const label = clean(String(row.label ?? "")) ?? `${role}: ${email}`;
    result.push({ email, role, label, password });
  });
  return result;
}

export async function listDevAuthBootstrapAccounts(): Promise<DevAuthBootstrapAccount[]> {
  if (!isDevAuthBypassEnabled()) {
    return [];
  }

  const configured = parseConfiguredDevAccounts();
  if (configured.length > 0) {
    return dedupeByEmail(
      configured.map((row) => ({
        email: row.email,
        role: row.role,
        label: row.label
      }))
    );
  }

  const supabase = await createClient({ serviceRole: true });
  const { data, error } = await supabase
    .from("profiles")
    .select("email, full_name, role, active, is_active, status")
    .eq("active", true)
    .order("full_name");

  if (error) {
    throw new Error(`Unable to load dev bootstrap staff accounts: ${error.message}`);
  }

  const rows = (data ?? []).map((row: any) => ({
    email: normalizeEmail(String(row?.email ?? "")) ?? "",
    fullName: clean(String(row?.full_name ?? "")) ?? "",
    role: normalizeRoleKey(String(row?.role ?? "program-assistant") as AppRole),
    isActive: row?.is_active !== false,
    status: (clean(String(row?.status ?? "")) ?? "").toLowerCase()
  }));

  const selected: DevAuthBootstrapAccount[] = [];
  const seenRoles = new Set<AppRole>();

  DEV_AUTH_ROLE_PRIORITY.forEach((role) => {
    const staff = rows.find((row) => row.role === role && row.isActive && row.status !== "disabled" && isEmail(row.email));
    if (!staff || seenRoles.has(role)) return;
    seenRoles.add(role);
    selected.push({
      email: staff.email,
      role,
      label: `${role} - ${staff.fullName || staff.email}`
    });
  });

  return dedupeByEmail(selected);
}

export function resolveDevAuthBootstrapPasswordForEmail(email: string) {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    return getDevAuthBootstrapPassword();
  }

  const configured = parseConfiguredDevAccounts();
  const configuredMatch = configured.find((row) => row.email === normalized);
  return configuredMatch?.password ?? getDevAuthBootstrapPassword();
}
