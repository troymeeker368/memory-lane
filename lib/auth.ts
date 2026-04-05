import { redirect } from "next/navigation";
import { cache } from "react";

import { resolveCurrentUserAuthState } from "@/lib/current-user-auth-state";
import type { AppRole, ModuleKey, UserProfile } from "@/types/app";
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
  normalizeRoleKey
} from "@/lib/permissions/core";
import { canAccessNavItem, getNavItemByHref } from "@/lib/permissions/nav";
import { logServerTiming, timingNowMs } from "@/lib/server-timing";
import { createClient } from "@/lib/supabase/server";

type ProfileTimingOptions = {
  traceLabel?: string;
  skipCache?: boolean;
};

const getCurrentProfileCached = cache(async (): Promise<UserProfile> => {
  return getCurrentProfile({ skipCache: true });
});

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
  const totalStartedAt = timingNowMs();
  const resolution = await resolveCurrentUserAuthState({
    traceLabel: options?.traceLabel,
    includeRequestedPathForLogin: true
  });

  if (resolution.status !== "authenticated") {
    redirect(resolution.defaultPath);
  }

  logServerTiming(options?.traceLabel, "profile-total", totalStartedAt, {
    role: resolution.profile.role,
    hasCustomPermissions: resolution.profile.has_custom_permissions ?? false
  });

  return resolution.profile;
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
