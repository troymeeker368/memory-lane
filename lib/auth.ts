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
import { getManagedUserById } from "@/lib/services/user-management";
import { createClient } from "@/lib/supabase/server";
import { isDevAuthBypassEnabled } from "@/lib/runtime";

const DEV_FORCE_ADMIN_EMAILS = new Set([
  "tmeeker@townsquare.net",
  "troy.meeker.bsn.rn.cdp@memorylane.local"
]);

const DEV_FORCE_ADMIN_PROFILE_IDS = new Set([
  "b042eae4-d478-4adf-ac53-55c942a82c03",
  "569f46e5-c97e-493a-8221-f8131bbd5b17"
]);

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

export async function getCurrentProfile(): Promise<UserProfile> {
  const supabase = await createClient();
  const serviceSupabase = await createClient({ serviceRole: true });
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?reason=no-auth-user");
  }

  const baseSelect =
    "id, email, full_name, role, active, is_active, status, invited_at, password_set_at, last_sign_in_at, disabled_at, staff_id";
  const legacySelect = "id, email, full_name, role, active, staff_id";

  const { data: enrichedData, error: enrichedError } = await serviceSupabase
    .from("profiles")
    .select(baseSelect)
    .eq("id", user.id)
    .maybeSingle();

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

  if (error) {
    const fallback = await serviceSupabase.from("profiles").select(legacySelect).eq("id", user.id).maybeSingle();
    if (fallback.error) {
      throw new Error(`Failed to load profile row for authenticated user: ${error.message}`);
    }
    data = fallback.data as typeof data;
    error = null;
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

  const role = forceDevAdminView ? "admin" : normalizeRoleKey(data.role as AppRole);
  let hasCustomPermissions = false;
  let customPermissions = null;

  const { data: rows, error: permissionsError } = await serviceSupabase
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

  if (!forceDevAdminView && Array.isArray(rows) && rows.length > 0) {
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
