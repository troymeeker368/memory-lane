import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import type { AppRole, ModuleKey, PermissionModuleKey, UserProfile } from "@/types/app";
import type { PermissionAction } from "@/lib/permissions";
import {
  canAccessModule,
  canAccessNavItem,
  canPerformModuleAction,
  getNavItemByHref,
  getPermissionSource,
  normalizeRoleKey,
  PERMISSION_MODULES,
  resolveEffectivePermissionSet
} from "@/lib/permissions";
import {
  DEV_ROLE_COOKIE_KEY,
  LEGACY_DEV_ROLE_COOKIE_KEY,
  getAuthBypassRole,
  getDevRoleOverrideFromEnv,
  isAuthBypassEnabled,
  isDevelopmentMode,
  resolveDevRoleOverride
} from "@/lib/runtime";
import { getManagedUserById } from "@/lib/services/user-management";
import { createClient } from "@/lib/supabase/server";

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

export async function getSession() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  return user;
}

async function getDevRoleOverride(): Promise<AppRole | null> {
  const envRoleOverride = getDevRoleOverrideFromEnv();
  if (envRoleOverride) {
    return envRoleOverride;
  }

  if (!isDevelopmentMode()) {
    return null;
  }

  const cookieStore = await cookies();
  const cookieRoleValue =
    cookieStore.get(DEV_ROLE_COOKIE_KEY)?.value ??
    cookieStore.get(LEGACY_DEV_ROLE_COOKIE_KEY)?.value ??
    null;

  return resolveDevRoleOverride(cookieRoleValue);
}

export async function getCurrentProfile(): Promise<UserProfile> {
  if (isAuthBypassEnabled()) {
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
    if (!serviceRoleKey) {
      throw new Error(
        "Auth bypass mode is enabled, but SUPABASE_SERVICE_ROLE_KEY is missing. Set it before using bypass mode."
      );
    }

    const bypassClient = await createClient({ serviceRole: true });
    const { data: profileRows, error: profileLookupError } = await bypassClient
      .from("profiles")
      .select("id, email, full_name, role, active, staff_id")
      .eq("active", true)
      .limit(1);

    if (profileLookupError) {
      throw new Error(
        `Auth bypass mode is enabled, but profile lookup failed: ${profileLookupError.message}`
      );
    }

    const devRoleOverride = await getDevRoleOverride();
    const effectiveRole = devRoleOverride ?? getAuthBypassRole();
    const permissions = resolveEffectivePermissionSet({
      role: effectiveRole,
      hasCustomPermissions: false,
      customPermissions: null
    });

    if (Array.isArray(profileRows) && profileRows.length > 0) {
      const profile = profileRows[0];
      return {
        ...(profile as Omit<UserProfile, "permissions">),
        role: effectiveRole,
        permissions,
        has_custom_permissions: false,
        permission_source: getPermissionSource(false)
      };
    }

    throw new Error(
      "Auth bypass mode is enabled, but no active profile rows were found in public.profiles. Seed/create an active profile row or disable bypass."
    );
  }

  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?reason=no-auth-user");
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, full_name, role, active, staff_id")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load profile row for authenticated user: ${error.message}`);
  }

  if (!data) {
    redirect("/login?reason=no-linked-profile");
  }

  if (!data.active) {
    redirect("/login?reason=inactive-profile");
  }

  const role = normalizeRoleKey(data.role as AppRole);
  const devRoleOverride = await getDevRoleOverride();
  const effectiveRole = devRoleOverride ?? role;
  let hasCustomPermissions = false;
  let customPermissions = null;

  const { data: rows, error: permissionsError } = await supabase
    .from("user_permissions")
    .select("module_key, can_view, can_create, can_edit, can_admin")
    .eq("user_id", user.id);
  if (permissionsError) {
    if (isMissingSchemaObjectError(permissionsError)) {
      throw new Error(
        "Missing Supabase schema object public.user_permissions. Apply migration 0002_rbac_roles_permissions.sql (and any earlier unapplied migrations), then restart Supabase/PostgREST to refresh schema cache."
      );
    }
    throw new Error(`Failed to load user permissions: ${permissionsError.message}`);
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

  const effectiveHasCustomPermissions = devRoleOverride ? false : hasCustomPermissions;
  const effectiveCustomPermissions = devRoleOverride ? null : customPermissions;
  const permissions = resolveEffectivePermissionSet({
    role: effectiveRole,
    hasCustomPermissions: effectiveHasCustomPermissions,
    customPermissions: effectiveCustomPermissions
  });

  return {
    ...(data as Omit<UserProfile, "permissions">),
    role: effectiveRole,
    permissions,
    has_custom_permissions: effectiveHasCustomPermissions,
    permission_source: getPermissionSource(effectiveHasCustomPermissions)
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

export async function requireRoles(roles: AppRole[]): Promise<UserProfile> {
  const profile = await getCurrentProfile();
  const normalizedAllowedRoles = roles.map((role) => normalizeRoleKey(role));
  if (!normalizedAllowedRoles.includes(normalizeRoleKey(profile.role))) {
    redirect("/unauthorized");
  }
  return profile;
}

export async function getCurrentManagedUser() {
  const profile = await getCurrentProfile();
  return await getManagedUserById(profile.id);
}
