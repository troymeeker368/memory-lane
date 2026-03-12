import { redirect } from "next/navigation";

import { requireNavItemAccess } from "@/lib/auth";
import { normalizeRoleKey } from "@/lib/permissions";
import { getManagedUserSignatureName } from "@/lib/services/user-management";

export const CARE_PLAN_AUTHORIZED_ROLES = ["admin", "nurse"] as const;
export type CarePlanAuthorizedRole = (typeof CARE_PLAN_AUTHORIZED_ROLES)[number];

export type CarePlanAuthorizedUser = {
  userId: string;
  fullName: string;
  role: CarePlanAuthorizedRole;
  signatureName: string;
};

export function isCarePlanAuthorizedRole(role: string | null | undefined): role is CarePlanAuthorizedRole {
  if (!role) return false;
  const normalized = normalizeRoleKey(role);
  return normalized === "admin" || normalized === "nurse";
}

export function canAccessCarePlansForRole(role: string | null | undefined) {
  return isCarePlanAuthorizedRole(role);
}

export async function requireCarePlanAuthorizedUser(): Promise<CarePlanAuthorizedUser> {
  const profile = await requireNavItemAccess("/health/care-plans");
  if (!isCarePlanAuthorizedRole(profile.role)) {
    redirect("/unauthorized?module=health&action=care-plans");
  }
  return {
    userId: profile.id,
    fullName: profile.full_name,
    role: normalizeRoleKey(profile.role) as CarePlanAuthorizedRole,
    signatureName: await getManagedUserSignatureName(profile.id, profile.full_name)
  };
}
