import { createClient } from "@/lib/supabase/server";
import { isDevAuthBypassEnabled } from "@/lib/runtime";
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

const DEV_FORCE_ADMIN_EMAILS = new Set([
  "tmeeker@townsquare.net",
  "troy.meeker.bsn.rn.cdp@memorylane.local"
]);

const DEV_FORCE_ADMIN_PROFILE_IDS = new Set([
  "b042eae4-d478-4adf-ac53-55c942a82c03",
  "569f46e5-c97e-493a-8221-f8131bbd5b17"
]);

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

  const serviceClientStartedAt = timingNow();
  const serviceSupabase = await createClient({ serviceRole: true });
  logTiming(traceLabel, "create-service-client", serviceClientStartedAt);

  const authStartedAt = timingNow();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  logTiming(traceLabel, "session-auth-resolution", authStartedAt);

  if (!user) {
    return { path: "/login?reason=no-auth-user", reason: "no-auth-user", role: "program-assistant" };
  }

  const baseSelect = "id, email, full_name, role, active, is_active, status, password_set_at";
  const legacySelect = "id, email, full_name, role, active";

  const profileLookupStartedAt = timingNow();
  const permissionsLookupStartedAt = timingNow();
  const [profileLookup, permissionsLookup] = await Promise.all([
    serviceSupabase.from("profiles").select(baseSelect).eq("id", user.id).maybeSingle(),
    serviceSupabase
      .from("user_permissions")
      .select("module_key, can_view")
      .eq("user_id", user.id)
  ]);
  logTiming(traceLabel, "profile-role-lookup", profileLookupStartedAt);
  logTiming(traceLabel, "permission-row-lookup", permissionsLookupStartedAt);

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

  if (error) {
    const legacyLookupStartedAt = timingNow();
    const fallback = await serviceSupabase.from("profiles").select(legacySelect).eq("id", user.id).maybeSingle();
    logTiming(traceLabel, "profile-legacy-lookup", legacyLookupStartedAt);
    if (fallback.error) {
      throw new Error(`Failed to load profile row for authenticated user: ${error.message}`);
    }
    data = fallback.data as typeof data;
    error = null;
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

  const fullName = String((data as { full_name?: string | null }).full_name ?? "").trim().toLowerCase();
  const email = String((data as { email?: string | null }).email ?? "").trim().toLowerCase();
  const profileId = String((data as { id?: string | null }).id ?? "").trim().toLowerCase();
  const authUserId = String(user.id ?? "").trim().toLowerCase();
  const isNonProductionRuntime = process.env.NODE_ENV !== "production";
  const forceDevAdminView =
    (isDevAuthBypassEnabled() || isNonProductionRuntime) &&
    (
      DEV_FORCE_ADMIN_EMAILS.has(email) ||
      DEV_FORCE_ADMIN_PROFILE_IDS.has(profileId) ||
      DEV_FORCE_ADMIN_PROFILE_IDS.has(authUserId) ||
      fullName === "troy meeker" ||
      fullName.includes("troy meeker")
    );

  const role = (forceDevAdminView ? "admin" : normalizeRoleKey(data.role as AppRole)) as AppRole;
  const { data: permissionRows, error: permissionsError } = permissionsLookup;

  if (permissionsError) {
    if (isMissingSchemaObjectError(permissionsError)) {
      throw new Error(
        "Missing Supabase schema object public.user_permissions. Apply migration 0002_rbac_roles_permissions.sql (and any earlier unapplied migrations), then restart Supabase/PostgREST to refresh schema cache."
      );
    }
    throw new Error(`Failed to load user permissions: ${permissionsError.message}`);
  }

  const allowedModules = new Set<PermissionModuleKey>();
  let hasCustomPermissions = false;

  if (!forceDevAdminView && Array.isArray(permissionRows) && permissionRows.length > 0) {
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
