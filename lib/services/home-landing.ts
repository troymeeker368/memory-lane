import type { UserProfile } from "@/types/app";
import { canView, normalizeRoleKey } from "@/lib/permissions";

export type HomeLandingResolution = {
  path: string;
  reason: string;
};

export function resolveHomeLandingPath(profile: Pick<UserProfile, "role" | "permissions">): HomeLandingResolution {
  const role = normalizeRoleKey(profile.role);

  if (canView(profile.permissions, "operations")) {
    return { path: "/operations", reason: "operations-permission" };
  }

  if (canView(profile.permissions, "sales-activities")) {
    return {
      path: "/sales/pipeline",
      reason: role === "sales" ? "sales-role-default" : "sales-permission"
    };
  }

  if (canView(profile.permissions, "health-unit")) {
    return { path: "/health", reason: "health-permission" };
  }

  if (canView(profile.permissions, "documentation")) {
    return { path: "/documentation", reason: "documentation-permission" };
  }

  if (canView(profile.permissions, "reports")) {
    return { path: "/reports", reason: "reports-permission" };
  }

  if (canView(profile.permissions, "time-hr")) {
    return { path: "/time-card", reason: "time-hr-permission" };
  }

  if (canView(profile.permissions, "admin-reports")) {
    return { path: "/admin-reports", reason: "admin-reports-permission" };
  }

  if (canView(profile.permissions, "user-management")) {
    return { path: "/time-hr/user-management", reason: "user-management-permission" };
  }

  return { path: "/unauthorized", reason: "no-module-permissions" };
}
