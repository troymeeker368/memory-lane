import { redirect } from "next/navigation";

import { requireNavItemAccess } from "@/lib/auth";
import { normalizeRoleKey } from "@/lib/permissions";
import { getManagedUserSignatureName } from "@/lib/services/user-management";

export const PROGRESS_NOTE_AUTHORIZED_ROLES = ["admin", "nurse"] as const;
export type ProgressNoteAuthorizedRole = (typeof PROGRESS_NOTE_AUTHORIZED_ROLES)[number];

export type ProgressNoteAuthorizedUser = {
  userId: string;
  fullName: string;
  role: ProgressNoteAuthorizedRole;
  signatureName: string;
};

export function isProgressNoteAuthorizedRole(role: string | null | undefined): role is ProgressNoteAuthorizedRole {
  if (!role) return false;
  const normalized = normalizeRoleKey(role);
  return normalized === "admin" || normalized === "nurse";
}

export function canAccessProgressNotesForRole(role: string | null | undefined) {
  return isProgressNoteAuthorizedRole(role);
}

export async function requireProgressNoteAuthorizedUser(): Promise<ProgressNoteAuthorizedUser> {
  const profile = await requireNavItemAccess("/health/progress-notes");
  if (!isProgressNoteAuthorizedRole(profile.role)) {
    redirect("/unauthorized?module=health&action=progress-notes");
  }
  return {
    userId: profile.id,
    fullName: profile.full_name,
    role: normalizeRoleKey(profile.role) as ProgressNoteAuthorizedRole,
    signatureName: await getManagedUserSignatureName(profile.id, profile.full_name)
  };
}
