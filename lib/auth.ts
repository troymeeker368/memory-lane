import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import type { AppRole, ModuleKey, PermissionModuleKey, UserProfile } from "@/types/app";
import { canAccessModule, canPerformModuleAction, getPermissionSource, normalizeRoleKey, PERMISSION_MODULES, resolveEffectivePermissionSet } from "@/lib/permissions";
import { getMockProfile } from "@/lib/mock-data";
import { isMockMode, MOCK_ROLE_COOKIE_KEY, MOCK_USER_COOKIE_KEY, resolveMockRole } from "@/lib/runtime";
import { getManagedUserById } from "@/lib/services/user-management";
import { createClient } from "@/lib/supabase/server";

async function getRequestMockContext(): Promise<{ role: AppRole; selectedUserId: string | null }> {
  const cookieStore = await cookies();
  const cookieRole = cookieStore.get(MOCK_ROLE_COOKIE_KEY)?.value;
  const selectedUserId = cookieStore.get(MOCK_USER_COOKIE_KEY)?.value?.trim() || null;

  return {
    role: resolveMockRole(cookieRole),
    selectedUserId
  };
}

export async function getSession() {
  if (isMockMode()) {
    const { role, selectedUserId } = await getRequestMockContext();
    const profile = getMockProfile(role, selectedUserId);
    // TODO(backend): Replace mock session with Supabase user session once auth is enabled locally.
    return { id: profile.id, email: profile.email } as { id: string; email: string };
  }

  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  return user;
}

export async function getCurrentProfile(): Promise<UserProfile> {
  if (isMockMode()) {
    const { role, selectedUserId } = await getRequestMockContext();
    // TODO(backend): Remove this branch after local auth/profile table wiring is complete.
    return getMockProfile(role, selectedUserId);
  }

  const user = await getSession();
  if (!user) {
    redirect("/login");
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, full_name, role, active, staff_id")
    .eq("id", user.id)
    .single();

  if (error || !data || !data.active) {
    redirect("/login");
  }

  const role = normalizeRoleKey(data.role as AppRole);
  let hasCustomPermissions = false;
  let customPermissions = null;

  try {
    const { data: rows, error: permissionsError } = await supabase
      .from("user_permissions")
      .select("module_key, can_view, can_create, can_edit, can_admin")
      .eq("user_id", user.id);

    if (!permissionsError && Array.isArray(rows) && rows.length > 0) {
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
  } catch {
    // Non-fatal fallback until RBAC schema is available in all environments.
  }

  const permissions = resolveEffectivePermissionSet({
    role,
    hasCustomPermissions,
    customPermissions
  });

  return {
    ...(data as Omit<UserProfile, "permissions">),
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
  return getManagedUserById(profile.id);
}
