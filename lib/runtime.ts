import type { AppRole } from "../types/app";
import { normalizeRoleKey } from "@/lib/permissions";

const MOCK_ROLE_VALUES: AppRole[] = ["program-assistant", "coordinator", "nurse", "sales", "manager", "director", "admin", "staff"];

export const MOCK_ROLE_COOKIE_KEY = "ml_mock_role";
export const MOCK_USER_COOKIE_KEY = "ml_mock_user_id";

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
  const flag = process.env.NEXT_PUBLIC_USE_MOCK_DATA;

  if (flag === "true") {
    return true;
  }

  if (flag === "false") {
    return false;
  }

  // Default behavior if unset: use mock mode unless Supabase env is configured.
  // TODO(backend): Set NEXT_PUBLIC_USE_MOCK_DATA=false when local Supabase auth/db is wired.
  return !hasSupabaseEnv();
}

export function getSupabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Missing Supabase environment variables. Set NEXT_PUBLIC_USE_MOCK_DATA=true for local mock mode, or set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY for real backend mode."
    );
  }

  return { url, anonKey };
}

export function getMockRole(): AppRole {
  return resolveMockRole(process.env.NEXT_PUBLIC_MOCK_ROLE);
}
