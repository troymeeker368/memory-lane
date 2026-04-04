import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import type { AppRole, ModuleKey, PermissionModuleKey, UserProfile } from "@/types/app";
import type { PermissionAction } from "@/lib/permissions/core";
import {
  canAccessMar,
  canAccessMemberCommandCenter,
  canAccessMemberHealthProfiles,
  canAccessPhysicianOrders,
  canAccessModule,
  canPerformModuleAction,
  canDocumentMar,
  canEditMemberCommandCenter,
  canEditMemberCommandCenterAttendanceBilling,
  canManageMemberHealthProfiles,
  canManagePhysicianOrders,
  canManagePofSignatureWorkflow,
  getPermissionSource,
  normalizeRoleKey,
  PERMISSION_MODULES,
  resolveEffectivePermissionSet
} from "@/lib/permissions/core";
import { canAccessNavItem, getNavItemByHref } from "@/lib/permissions/nav";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

type ProfileTimingOptions = {
  traceLabel?: string;
  skipCache?: boolean;
};

const getCurrentProfileCached = cache(async (): Promise<UserProfile> => {
  return getCurrentProfile({ skipCache: true });
});

async function getRequestedPathForLoginRedirect() {
  const headerStore = await headers();
  const requestedPath = String(headerStore.get("x-memory-lane-requested-path") ?? "").trim();
  if (!requestedPath || requestedPath === "/" || !requestedPath.startsWith("/") || requestedPath.startsWith("//")) {
    return null;
  }
  return requestedPath;
}

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

export async function getSession() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  return user;
}

export async function getCurrentProfile(options?: ProfileTimingOptions): Promise<UserProfile> {
  if (!options?.traceLabel && !options?.skipCache) {
    return getCurrentProfileCached();
  }
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
    const requestedPath = await getRequestedPathForLoginRedirect();
    const params = new URLSearchParams({ reason: "no-auth-user" });
    if (requestedPath) {
      params.set("next", requestedPath);
    }
    redirect(`/login?${params.toString()}`);
  }

  const baseSelect =
    "id, email, full_name, role, active, is_active, status, invited_at, password_set_at, last_sign_in_at, disabled_at, staff_id, has_custom_permissions";
  const legacySelect = "id, email, full_name, role, active, staff_id";

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
        invited_at?: string | null;
        password_set_at?: string | null;
        last_sign_in_at?: string | null;
        disabled_at?: string | null;
        staff_id: string | null;
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
    redirect("/login?reason=no-linked-profile");
  }

  const normalizedStatus = String((data as { status?: string | null }).status ?? "").toLowerCase();
  const isActive = (data as { is_active?: boolean | null }).is_active !== false;

  if (!data.active || !isActive) {
    redirect("/login?reason=inactive-profile");
  }

  if (normalizedStatus === "disabled") {
    redirect("/login?reason=disabled-profile");
  }

  const passwordSetAt = (data as { password_set_at?: string | null }).password_set_at;
  if (normalizedStatus === "invited" && !passwordSetAt) {
    redirect("/auth/set-password");
  }

  const role = normalizeRoleKey(data.role as AppRole);
  let hasCustomPermissions = false;
  let customPermissions = null;
  let permissionsRows: Array<{
    module_key: string;
    can_view: boolean;
    can_create: boolean;
    can_edit: boolean;
    can_admin: boolean;
  }> = [];
  let permissionsError: unknown = null;

  const hasProfileLevelCustomPermissions = shouldLookupCustomPermissions;

  if (hasProfileLevelCustomPermissions) {
    const permissionsSupabase =
      role === "admin"
        ? supabase
        : (() => {
            // Non-admin custom permission rows are intentionally not broadly readable via RLS.
            const serviceClientStartedAt = timingNow();
            const client = createServiceRoleClient("auth_custom_permissions_read");
            logTiming(traceLabel, "create-service-client", serviceClientStartedAt, {
              useCase: "auth_custom_permissions_read"
            });
            return client;
          })();
    const permissionsStartedAt = timingNow();
    const permissionsLookup = await permissionsSupabase
      .from("user_permissions")
      .select("module_key, can_view, can_create, can_edit, can_admin")
      .eq("user_id", user.id);
    logTiming(traceLabel, "permission-row-lookup", permissionsStartedAt);
    permissionsRows = permissionsLookup.data as typeof permissionsRows;
    permissionsError = permissionsLookup.error;
  }

  const rows = permissionsRows;
  if (permissionsError) {
    if (isMissingSchemaObjectError(permissionsError)) {
      throw new Error(
        "Missing Supabase schema object public.user_permissions. Apply migration 0002_rbac_roles_permissions.sql (and any earlier unapplied migrations), then restart Supabase/PostgREST to refresh schema cache."
      );
    }
    throw new Error(`Failed to load user permissions: ${getErrorMessage(permissionsError)}`);
  }

  if (Array.isArray(rows) && rows.length > 0) {
    hasCustomPermissions = true;
    customPermissions = rows.reduce((acc, row) => {
      const moduleKey = String(row.module_key) as PermissionModuleKey;
      if (!PERMISSION_MODULES.includes(moduleKey)) {
        return acc;
      }
      acc[moduleKey] = {
        canView: Boolean(row.can_view),
        canCreate: Boolean(row.can_create),
        canEdit: Boolean(row.can_edit),
        canAdmin: Boolean(row.can_admin)
      };
      return acc;
    }, {} as UserProfile["permissions"]);
  }

  const permissions = resolveEffectivePermissionSet({
    role,
    hasCustomPermissions,
    customPermissions
  });

  logTiming(traceLabel, "profile-total", totalStartedAt, {
    role,
    hasCustomPermissions
  });

  return {
    ...(data as Omit<UserProfile, "permissions">),
    status: normalizedStatus === "disabled" ? "disabled" : normalizedStatus === "invited" ? "invited" : "active",
    is_active: isActive,
    invited_at: (data as { invited_at?: string | null }).invited_at ?? null,
    password_set_at: passwordSetAt ?? null,
    last_sign_in_at: (data as { last_sign_in_at?: string | null }).last_sign_in_at ?? null,
    disabled_at: (data as { disabled_at?: string | null }).disabled_at ?? null,
    role,
    permissions,
    has_custom_permissions: hasCustomPermissions,
    permission_source: getPermissionSource(hasCustomPermissions)
  };
}

export async function requireModuleAccess(module: ModuleKey): Promise<UserProfile> {
  const profile = await getCurrentProfile();
  if (!canAccessModule(profile.role as AppRole, module, profile.permissions)) {
    redirect(`/unauthorized?module=${encodeURIComponent(module)}`);
  }
  return profile;
}

export async function requireModuleAction(
  module: ModuleKey,
  action: "canView" | "canCreate" | "canEdit" | "canAdmin"
): Promise<UserProfile> {
  const profile = await getCurrentProfile();
  if (!canPerformModuleAction(profile.role as AppRole, module, action, profile.permissions)) {
    redirect(`/unauthorized?module=${encodeURIComponent(module)}&action=${encodeURIComponent(action)}`);
  }
  return profile;
}

export async function requireNavItemAccess(
  href: string,
  action: PermissionAction = "canView"
): Promise<UserProfile> {
  const profile = await getCurrentProfile();

  if (!canAccessNavItem(profile.role as AppRole, href, profile.permissions, action)) {
    const navItem = getNavItemByHref(href);
    if (navItem) {
      redirect(
        `/unauthorized?module=${encodeURIComponent(navItem.module)}&action=${encodeURIComponent(action)}`
      );
    }
    redirect("/unauthorized");
  }
  return profile;
}

type CapabilityAccessOptions = {
  unauthorizedPath: string;
};

async function requireProfileCapability(
  check: (profile: UserProfile) => boolean,
  options: CapabilityAccessOptions
): Promise<UserProfile> {
  const profile = await getCurrentProfile();
  if (!check(profile)) {
    redirect(options.unauthorizedPath);
  }
  return profile;
}

export async function requireMemberHealthProfilesAccess() {
  return requireProfileCapability(canAccessMemberHealthProfiles, {
    unauthorizedPath: "/unauthorized?module=health&resource=member-health-profiles"
  });
}

export async function requireMemberHealthProfilesManagement() {
  return requireProfileCapability(canManageMemberHealthProfiles, {
    unauthorizedPath: "/unauthorized?module=health&resource=member-health-profiles&action=canEdit"
  });
}

export async function requirePhysicianOrdersAccess() {
  return requireProfileCapability(canAccessPhysicianOrders, {
    unauthorizedPath: "/unauthorized?module=health&resource=physician-orders"
  });
}

export async function requirePhysicianOrdersManagement() {
  return requireProfileCapability(canManagePhysicianOrders, {
    unauthorizedPath: "/unauthorized?module=health&resource=physician-orders&action=canEdit"
  });
}

export async function requirePofSignatureWorkflowManagement() {
  return requireProfileCapability(canManagePofSignatureWorkflow, {
    unauthorizedPath: "/unauthorized?module=health&resource=physician-orders-signature&action=canEdit"
  });
}

export async function requireMemberCommandCenterAccess() {
  return requireProfileCapability(canAccessMemberCommandCenter, {
    unauthorizedPath: "/unauthorized?module=operations&resource=member-command-center"
  });
}

export async function requireMemberCommandCenterEdit() {
  return requireProfileCapability(canEditMemberCommandCenter, {
    unauthorizedPath: "/unauthorized?module=operations&resource=member-command-center&action=canEdit"
  });
}

export async function requireMemberCommandCenterAttendanceBillingEdit() {
  return requireProfileCapability(canEditMemberCommandCenterAttendanceBilling, {
    unauthorizedPath: "/unauthorized?module=operations&resource=member-command-center-attendance&action=canEdit"
  });
}

export async function requireMarAccess() {
  return requireProfileCapability(canAccessMar, {
    unauthorizedPath: "/unauthorized?module=health&resource=mar"
  });
}

export async function requireMarDocumentation() {
  return requireProfileCapability(canDocumentMar, {
    unauthorizedPath: "/unauthorized?module=health&resource=mar&action=canEdit"
  });
}

export async function requireRoles(roles: AppRole[]): Promise<UserProfile> {
  const profile = await getCurrentProfile();
  if (!hasAnyRole(profile.role, roles)) {
    redirect("/unauthorized");
  }
  return profile;
}

export function hasAnyRole(role: string | null | undefined, roles: AppRole[]) {
  const normalizedAllowedRoles = roles.map((allowedRole) => normalizeRoleKey(allowedRole));
  return normalizedAllowedRoles.includes(normalizeRoleKey(role ?? ""));
}

export async function getCurrentProfileForRolesOrError(roles: AppRole[], errorMessage: string) {
  const profile = await getCurrentProfile();
  if (!hasAnyRole(profile.role, roles)) {
    return { error: errorMessage } as const;
  }
  return profile;
}
