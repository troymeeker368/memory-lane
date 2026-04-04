import { createClient } from "@/lib/supabase/server";
import {
  PERMISSION_MODULES,
  normalizeRoleKey
} from "@/lib/permissions/core";
import {
  resolveHomeLandingPathForRole,
  resolveHomeLandingPathFromModuleKeys,
  type HomeLandingResolution
} from "@/lib/services/home-landing";
import type { AppRole, PermissionModuleKey } from "@/types/app";

type LandingResolutionOptions = {
  traceLabel?: string;
};

type LandingResolutionResult = HomeLandingResolution & {
  role: AppRole;
};

function timingNow() {
  return Number(process.hrtime.bigint()) / 1_000_000;
}

function logTiming(traceLabel: string | undefined, step: string, startedAtMs: number, details?: Record<string, unknown>) {
  if (!traceLabel) return;
  const elapsedMs = (timingNow() - startedAtMs).toFixed(1);
  const detailsText = details
    ? Object.entries(details)
        .map(([key, value]) => `${key}=${String(value)}`)
        .join(" ")
    : "";
  const suffix = detailsText ? ` ${detailsText}` : "";
  console.info(`[timing] ${traceLabel} ${step} ${elapsedMs}ms${suffix}`);
}

function extractPostgrestErrorText(error: unknown) {
  if (!error || typeof error !== "object") return "";
  const err = error as { message?: string; details?: string; hint?: string };
  return [err.message, err.details, err.hint].filter(Boolean).join(" ").toLowerCase();
}

function getErrorMessage(error: unknown): string {
  if (!error || typeof error !== "object") return "Unknown error";
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" && message.length > 0 ? message : "Unknown error";
}

function isMissingSchemaObjectError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = String((error as { code?: string }).code ?? "");
  const text = extractPostgrestErrorText(error);
  return (
    code === "PGRST205" ||
    code === "PGRST116" ||
    code === "42P01" ||
    code === "42703" ||
    text.includes("schema cache") ||
    text.includes("does not exist") ||
    text.includes("could not find the table")
  );
}

export async function resolveCurrentHomeLanding(
  options?: LandingResolutionOptions
): Promise<LandingResolutionResult> {
  const traceLabel = options?.traceLabel;
  const totalStartedAt = timingNow();

  const userClientStartedAt = timingNow();
  const supabase = await createClient();
  logTiming(traceLabel, "create-user-client", userClientStartedAt);

  const authStartedAt = timingNow();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  logTiming(traceLabel, "session-auth-resolution", authStartedAt);

  if (!user) {
    return { path: "/login?reason=no-auth-user", reason: "no-auth-user", role: "program-assistant" };
  }

  const baseSelect =
    "id, email, full_name, role, active, is_active, status, password_set_at, has_custom_permissions";
  const legacySelect = "id, email, full_name, role, active";

  const profileLookupStartedAt = timingNow();
  const profileLookup = await supabase.from("profiles").select(baseSelect).eq("id", user.id).maybeSingle();
  logTiming(traceLabel, "profile-role-lookup", profileLookupStartedAt);

  const { data: enrichedData, error: enrichedError } = profileLookup;

  let data = enrichedData as
    | {
        id: string;
        email: string;
        full_name: string;
        role: AppRole;
        active: boolean;
        is_active?: boolean | null;
        status?: string | null;
        password_set_at?: string | null;
      }
    | null;
  let error = enrichedError;
  let shouldLookupCustomPermissions = true;

  if (error) {
    const legacyLookupStartedAt = timingNow();
    const fallback = await supabase.from("profiles").select(legacySelect).eq("id", user.id).maybeSingle();
    logTiming(traceLabel, "profile-legacy-lookup", legacyLookupStartedAt);
    if (fallback.error) {
      throw new Error(`Failed to load profile row for authenticated user: ${getErrorMessage(error)}`);
    }
    data = fallback.data as typeof data;
    error = null;
    shouldLookupCustomPermissions = true;
  } else {
    shouldLookupCustomPermissions = Boolean((data as { has_custom_permissions?: boolean | null }).has_custom_permissions);
  }

  if (!data) {
    return { path: "/login?reason=no-linked-profile", reason: "no-linked-profile", role: "program-assistant" };
  }

  const normalizedStatus = String((data as { status?: string | null }).status ?? "").toLowerCase();
  const isActive = (data as { is_active?: boolean | null }).is_active !== false;

  if (!data.active || !isActive) {
    return { path: "/login?reason=inactive-profile", reason: "inactive-profile", role: data.role };
  }

  if (normalizedStatus === "disabled") {
    return { path: "/login?reason=disabled-profile", reason: "disabled-profile", role: data.role };
  }

  const passwordSetAt = (data as { password_set_at?: string | null }).password_set_at;
  if (normalizedStatus === "invited" && !passwordSetAt) {
    return { path: "/auth/set-password", reason: "invited-password-setup", role: data.role };
  }

  const role = normalizeRoleKey(data.role as AppRole) as AppRole;
  const hasProfileLevelCustomPermissions = shouldLookupCustomPermissions;
  let hasCustomPermissions = false;
  const allowedModules = new Set<PermissionModuleKey>();
  let permissionRows: Array<{ module_key: string; can_view: boolean }> = [];
  let permissionsError: unknown = null;

  if (hasProfileLevelCustomPermissions) {
    const permissionsLookupStartedAt = timingNow();
    const result = await supabase
      .from("user_permissions")
      .select("module_key, can_view")
      .eq("user_id", data.id);
    logTiming(traceLabel, "permission-row-lookup", permissionsLookupStartedAt);
    permissionRows = result.data as typeof permissionRows;
    permissionsError = result.error;
  }

  if (permissionsError) {
    if (isMissingSchemaObjectError(permissionsError)) {
      throw new Error(
        "Missing Supabase schema object public.user_permissions. Apply migration 0002_rbac_roles_permissions.sql (and any earlier unapplied migrations), then restart Supabase/PostgREST to refresh schema cache."
      );
    }
    throw new Error(`Failed to load user permissions: ${getErrorMessage(permissionsError)}`);
  }

  if (Array.isArray(permissionRows) && permissionRows.length > 0) {
    hasCustomPermissions = true;
    for (const row of permissionRows) {
      const moduleKey = String(row.module_key) as PermissionModuleKey;
      if (!PERMISSION_MODULES.includes(moduleKey) || !row.can_view) {
        continue;
      }
      allowedModules.add(moduleKey);
    }
  }

  const landing = hasCustomPermissions
    ? resolveHomeLandingPathFromModuleKeys({ role, modules: allowedModules })
    : resolveHomeLandingPathForRole(role);

  logTiming(traceLabel, "landing-resolution-complete", totalStartedAt, {
    role,
    hasCustomPermissions,
    destination: landing.path,
    reason: landing.reason
  });

  return {
    ...landing,
    role
  };
}
