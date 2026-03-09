"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireRoles } from "@/lib/auth";
import { normalizePermissionSet, PERMISSION_MODULES } from "@/lib/permissions";
import {
  createManagedUser,
  getManagedUserById,
  setManagedUserStatus,
  updateManagedUser,
  updateManagedUserPermissions
} from "@/lib/services/user-management";
import type { AppRole, PermissionSet, UserStatus } from "@/types/app";

const roleSchema = z.enum(["admin", "manager", "nurse", "staff"]);
const statusSchema = z.enum(["active", "inactive"]);

const userSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  displayName: z.string().min(1),
  email: z.string().email(),
  role: roleSchema,
  status: statusSchema,
  phone: z.string().optional().or(z.literal("")),
  title: z.string().optional().or(z.literal("")),
  department: z.string().optional().or(z.literal("")),
  defaultLanding: z.string().optional().or(z.literal(""))
});

async function requireUserManagementAdmin() {
  await requireRoles(["admin"]);
}

function parseUserFromFormData(formData: FormData) {
  return userSchema.safeParse({
    firstName: String(formData.get("firstName") ?? "").trim(),
    lastName: String(formData.get("lastName") ?? "").trim(),
    displayName: String(formData.get("displayName") ?? "").trim(),
    email: String(formData.get("email") ?? "").trim(),
    role: String(formData.get("role") ?? "staff") as AppRole,
    status: String(formData.get("status") ?? "active") as UserStatus,
    phone: String(formData.get("phone") ?? "").trim(),
    title: String(formData.get("title") ?? "").trim(),
    department: String(formData.get("department") ?? "").trim(),
    defaultLanding: String(formData.get("defaultLanding") ?? "").trim()
  });
}

function parsePermissionSetFromFormData(formData: FormData): PermissionSet {
  const base = PERMISSION_MODULES.reduce((acc, module) => {
    acc[module] = {
      canView: formData.get(`${module}.canView`) === "on",
      canCreate: formData.get(`${module}.canCreate`) === "on",
      canEdit: formData.get(`${module}.canEdit`) === "on",
      canAdmin: formData.get(`${module}.canAdmin`) === "on"
    };
    return acc;
  }, {} as PermissionSet);

  return normalizePermissionSet(base);
}

export async function createManagedUserFormAction(formData: FormData) {
  await requireUserManagementAdmin();
  const payload = parseUserFromFormData(formData);
  if (!payload.success) {
    return { error: "Invalid user fields." };
  }

  const created = createManagedUser(payload.data);

  revalidatePath("/time-hr/user-management");
  revalidatePath(`/time-hr/user-management/${created.id}`);
  redirect(`/time-hr/user-management/${created.id}`);
}

export async function updateManagedUserFormAction(formData: FormData) {
  await requireUserManagementAdmin();
  const userId = String(formData.get("userId") ?? "").trim();
  if (!userId) {
    return { error: "Missing user id." };
  }

  const payload = parseUserFromFormData(formData);
  if (!payload.success) {
    return { error: "Invalid user fields." };
  }

  const updated = updateManagedUser(userId, payload.data);
  if (!updated) {
    return { error: "User not found." };
  }

  revalidatePath("/time-hr/user-management");
  revalidatePath(`/time-hr/user-management/${userId}`);
  redirect(`/time-hr/user-management/${userId}`);
}

export async function updateManagedUserStatusAction(formData: FormData) {
  await requireUserManagementAdmin();
  const userId = String(formData.get("userId") ?? "").trim();
  const nextStatusRaw = String(formData.get("nextStatus") ?? "").trim();

  const nextStatusParsed = statusSchema.safeParse(nextStatusRaw);
  if (!userId || !nextStatusParsed.success) {
    return { error: "Invalid status update." };
  }

  const updated = setManagedUserStatus(userId, nextStatusParsed.data);
  if (!updated) {
    return { error: "User not found." };
  }

  revalidatePath("/time-hr/user-management");
  revalidatePath(`/time-hr/user-management/${userId}`);
  return { ok: true };
}

export async function updateManagedUserPermissionsAction(formData: FormData) {
  await requireUserManagementAdmin();
  const userId = String(formData.get("userId") ?? "").trim();
  if (!userId) {
    return { error: "Missing user id." };
  }

  const user = getManagedUserById(userId);
  if (!user) {
    return { error: "User not found." };
  }

  const permissions = parsePermissionSetFromFormData(formData);
  const updated = updateManagedUserPermissions(userId, permissions);
  if (!updated) {
    return { error: "Unable to update permissions." };
  }

  revalidatePath("/time-hr/user-management");
  revalidatePath(`/time-hr/user-management/${userId}`);
  redirect(`/time-hr/user-management/${userId}`);
}
