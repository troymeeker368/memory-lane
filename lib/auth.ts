import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import type { AppRole, ModuleKey, UserProfile } from "@/types/app";
import { canAccessModule, getDefaultPermissionSet } from "@/lib/permissions";
import { getMockProfile } from "@/lib/mock-data";
import { isMockMode, MOCK_ROLE_COOKIE_KEY, MOCK_USER_COOKIE_KEY, resolveMockRole } from "@/lib/runtime";
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

  const role = data.role as AppRole;
  return {
    ...(data as Omit<UserProfile, "permissions">),
    role,
    permissions: getDefaultPermissionSet(role)
  };
}

export async function requireModuleAccess(module: ModuleKey): Promise<UserProfile> {
  const profile = await getCurrentProfile();
  if (!canAccessModule(profile.role as AppRole, module, profile.permissions)) {
    redirect("/");
  }
  return profile;
}

export async function requireRoles(roles: AppRole[]): Promise<UserProfile> {
  const profile = await getCurrentProfile();
  if (!roles.includes(profile.role)) {
    redirect("/");
  }
  return profile;
}
