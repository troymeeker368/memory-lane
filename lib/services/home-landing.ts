import type { AppRole, PermissionModuleKey, UserProfile } from "@/types/app";

import { canView, getDefaultPermissionSet, normalizeRoleKey } from "@/lib/permissions/core";

export type HomeLandingResolution = {
  path: string;
  reason: string;
};

const HOME_LANDING_CANDIDATES: Array<{
  module: PermissionModuleKey;
  path: string;
  reason: string;
}> = [
  { module: "operations", path: "/operations", reason: "operations-permission" },
  { module: "sales-activities", path: "/sales/pipeline", reason: "sales-permission" },
  { module: "health-unit", path: "/health", reason: "health-permission" },
  { module: "documentation", path: "/documentation", reason: "documentation-permission" },
  { module: "reports", path: "/reports", reason: "reports-permission" },
  { module: "time-hr", path: "/time-card", reason: "time-hr-permission" },
  { module: "admin-reports", path: "/admin-reports", reason: "admin-reports-permission" },
  { module: "user-management", path: "/time-hr/user-management", reason: "user-management-permission" }
];

function resolveHomeLandingPathWithAccess(
  roleInput: AppRole | string,
  hasModuleViewAccess: (module: PermissionModuleKey) => boolean
): HomeLandingResolution {
  const role = normalizeRoleKey(roleInput);

  for (const candidate of HOME_LANDING_CANDIDATES) {
    if (!hasModuleViewAccess(candidate.module)) {
      continue;
    }
    if (candidate.module === "sales-activities" && role === "sales") {
      return { path: candidate.path, reason: "sales-role-default" };
    }
    return { path: candidate.path, reason: candidate.reason };
  }

  return { path: "/unauthorized", reason: "no-module-permissions" };
}

export function resolveHomeLandingPath(profile: Pick<UserProfile, "role" | "permissions">): HomeLandingResolution {
  return resolveHomeLandingPathWithAccess(profile.role, (module) => canView(profile.permissions, module));
}

export function resolveHomeLandingPathFromModuleKeys(input: {
  role: AppRole | string;
  modules: Iterable<PermissionModuleKey>;
}): HomeLandingResolution {
  const allowedModules = new Set(input.modules);
  return resolveHomeLandingPathWithAccess(input.role, (module) => allowedModules.has(module));
}

export function resolveHomeLandingPathForRole(role: AppRole | string): HomeLandingResolution {
  const permissions = getDefaultPermissionSet(role);
  return resolveHomeLandingPathWithAccess(role, (module) => canView(permissions, module));
}
