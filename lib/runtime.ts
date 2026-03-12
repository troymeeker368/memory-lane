import type { AppRole } from "../types/app";
import { normalizeRoleKey } from "./permissions";

const MOCK_ROLE_VALUES: AppRole[] = ["program-assistant", "coordinator", "nurse", "sales", "manager", "director", "admin", "staff"];
const DEV_OVERRIDE_ROLE_VALUES: AppRole[] = [
  "program-assistant",
  "coordinator",
  "nurse",
  "manager",
  "director",
  "admin"
];

export const MOCK_ROLE_COOKIE_KEY = "ml_mock_role";
export const MOCK_USER_COOKIE_KEY = "ml_mock_user_id";
export const DEV_ROLE_COOKIE_KEY = "ml_dev_role";
export const DEV_ROLE_STORAGE_KEY = "memory_lane_dev_role";
export const LEGACY_DEV_ROLE_COOKIE_KEY = MOCK_ROLE_COOKIE_KEY;

export function isAppRole(value: string | null | undefined): value is AppRole {
  return Boolean(value && MOCK_ROLE_VALUES.includes(value as AppRole));
}

export function resolveMockRole(value: string | null | undefined): AppRole {
  if (isAppRole(value)) return normalizeRoleKey(value);

  const envRole = process.env.NEXT_PUBLIC_MOCK_ROLE as AppRole | undefined;
  // Use least-privilege default to avoid accidental elevated permissions
  // when dev role cookies are missing/expired.
  return isAppRole(envRole) ? normalizeRoleKey(envRole) : "program-assistant";
}

export function hasSupabaseEnv() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

export function isMockMode() {
  return false;
}

export function isDevelopmentMode() {
  return process.env.NODE_ENV !== "production";
}

export function resolveDevRoleOverride(value: string | null | undefined): AppRole | null {
  if (!value) return null;
  const normalizedRole = normalizeRoleKey(value);
  return DEV_OVERRIDE_ROLE_VALUES.includes(normalizedRole) ? normalizedRole : null;
}

export function getDevRoleOverrideFromEnv(): AppRole | null {
  if (!isDevelopmentMode()) return null;
  return resolveDevRoleOverride(process.env.DEV_ROLE_OVERRIDE);
}

function isExplicitlyTrue(value: string | undefined) {
  return value?.trim().toLowerCase() === "true";
}

function isExplicitlyFalse(value: string | undefined) {
  return value?.trim().toLowerCase() === "false";
}

export function isAuthBypassEnabled() {
  const bypassEnv = process.env.NEXT_PUBLIC_ENABLE_AUTH_BYPASS;
  if (typeof bypassEnv === "string") {
    return isExplicitlyTrue(bypassEnv);
  }

  // Backwards compatibility:
  // historically NEXT_PUBLIC_ENABLE_AUTH=false implied bypass mode.
  const legacyAuthEnv = process.env.NEXT_PUBLIC_ENABLE_AUTH;
  if (isExplicitlyFalse(legacyAuthEnv)) {
    return true;
  }

  return false;
}

export function isAuthEnforced() {
  return !isAuthBypassEnabled();
}

export function getAuthBypassRole(): AppRole {
  const envRole = process.env.NEXT_PUBLIC_AUTH_BYPASS_ROLE as AppRole | undefined;
  return isAppRole(envRole) ? normalizeRoleKey(envRole) : "admin";
}

export function getSupabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error("Missing Supabase environment variables. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  }

  return { url, anonKey };
}

export function getMockRole(): AppRole {
  return resolveMockRole(process.env.NEXT_PUBLIC_MOCK_ROLE);
}
