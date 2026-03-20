"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireRoles } from "@/lib/auth";
import { normalizePhoneForStorage } from "@/lib/phone";
import { normalizePermissionSet, PERMISSION_MODULES } from "@/lib/permissions";
import {
  createManagedUser,
  getManagedUserById,
  resetManagedUserPermissionsToRoleDefaults,
  resendManagedUserInvite,
  sendManagedUserInvite,
  sendManagedUserPasswordReset,
  setManagedUserStatus,
  setManagedUserLoginDisabled,
  updateManagedUser,
  updateManagedUserPermissions
} from "@/lib/services/user-management";
import type { AppRole, PermissionSet, UserStatus } from "@/types/app";

const roleSchema = z.enum(["program-assistant", "coordinator", "nurse", "sales", "manager", "director", "admin"]);
const statusSchema = z.enum(["active", "inactive"]);
const permissionModeSchema = z.enum(["template", "custom"]);

const userSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  displayName: z.string().min(1),
  credentials: z.string().optional().or(z.literal("")),
  email: z.string().email(),
  role: roleSchema,
  status: statusSchema,
  phone: z.string().optional().or(z.literal("")),
  title: z.string().optional().or(z.literal("")),
  department: z.string().optional().or(z.literal("")),
  defaultLanding: z.string().optional().or(z.literal(""))
});

async function requireUserManagementAdmin() {
  return await requireRoles(["admin"]);
}

function parseUserFromFormData(formData: FormData) {
  return userSchema.safeParse({
    firstName: String(formData.get("firstName") ?? "").trim(),
    lastName: String(formData.get("lastName") ?? "").trim(),
    displayName: String(formData.get("displayName") ?? "").trim(),
    credentials: String(formData.get("credentials") ?? "").trim(),
    email: String(formData.get("email") ?? "").trim(),
    role: String(formData.get("role") ?? "program-assistant") as AppRole,
    status: String(formData.get("status") ?? "active") as UserStatus,
    phone: normalizePhoneForStorage(String(formData.get("phone") ?? "")) ?? "",
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

async function handleCreateManagedUserForm(formData: FormData) {
  await requireUserManagementAdmin();
  const payload = parseUserFromFormData(formData);
  if (!payload.success) {
    return;
  }

  const created = await createManagedUser(payload.data);

  revalidatePath("/time-hr/user-management");
  revalidatePath(`/time-hr/user-management/${created.id}`);
  redirect(`/time-hr/user-management/${created.id}`);
}

async function handleUpdateManagedUserForm(formData: FormData) {
  await requireUserManagementAdmin();
  const userId = String(formData.get("userId") ?? "").trim();
  if (!userId) {
    return;
  }

  const payload = parseUserFromFormData(formData);
  if (!payload.success) {
    return;
  }

  const updated = await updateManagedUser(userId, payload.data);
  if (!updated) {
    return;
  }

  revalidatePath("/time-hr/user-management");
  revalidatePath(`/time-hr/user-management/${userId}`);
  redirect(`/time-hr/user-management/${userId}`);
}

async function handleUpdateManagedUserStatus(formData: FormData) {
  await requireUserManagementAdmin();
  const userId = String(formData.get("userId") ?? "").trim();
  const nextStatusRaw = String(formData.get("nextStatus") ?? "").trim();

  const nextStatusParsed = statusSchema.safeParse(nextStatusRaw);
  if (!userId || !nextStatusParsed.success) {
    return;
  }

  const updated = await setManagedUserStatus(userId, nextStatusParsed.data);
  if (!updated) {
    return;
  }

  revalidatePath("/time-hr/user-management");
  revalidatePath(`/time-hr/user-management/${userId}`);
}

async function handleUpdateManagedUserPermissions(formData: FormData) {
  await requireUserManagementAdmin();
  const userId = String(formData.get("userId") ?? "").trim();
  if (!userId) {
    return;
  }

  const user = await getManagedUserById(userId);
  if (!user) {
    return;
  }

  const modeResult = permissionModeSchema.safeParse(String(formData.get("permissionMode") ?? "custom"));
  if (!modeResult.success) {
    return;
  }

  const updated =
    modeResult.data === "template"
      ? await resetManagedUserPermissionsToRoleDefaults(userId)
      : await updateManagedUserPermissions(userId, parsePermissionSetFromFormData(formData));

  if (!updated) {
    return;
  }

  revalidatePath("/time-hr/user-management");
  revalidatePath(`/time-hr/user-management/${userId}`);
  redirect(`/time-hr/user-management/${userId}`);
}

async function handleResetManagedUserPermissions(formData: FormData) {
  await requireUserManagementAdmin();
  const userId = String(formData.get("userId") ?? "").trim();
  if (!userId) {
    return;
  }

  const updated = await resetManagedUserPermissionsToRoleDefaults(userId);
  if (!updated) {
    return;
  }

  revalidatePath("/time-hr/user-management");
  revalidatePath(`/time-hr/user-management/${userId}`);
  redirect(`/time-hr/user-management/${userId}/permissions`);
}

async function handleSendManagedUserInvite(formData: FormData) {
  const profile = await requireUserManagementAdmin();
  const userId = String(formData.get("userId") ?? "").trim();
  if (!userId) return;

  await sendManagedUserInvite(userId, profile.id);

  revalidatePath("/time-hr/user-management");
  revalidatePath(`/time-hr/user-management/${userId}`);
}

async function handleResendManagedUserInvite(formData: FormData) {
  const profile = await requireUserManagementAdmin();
  const userId = String(formData.get("userId") ?? "").trim();
  if (!userId) return;

  await resendManagedUserInvite(userId, profile.id);

  revalidatePath("/time-hr/user-management");
  revalidatePath(`/time-hr/user-management/${userId}`);
}

async function handleSendManagedUserReset(formData: FormData) {
  const profile = await requireUserManagementAdmin();
  const userId = String(formData.get("userId") ?? "").trim();
  if (!userId) return;

  await sendManagedUserPasswordReset(userId, profile.id);

  revalidatePath("/time-hr/user-management");
  revalidatePath(`/time-hr/user-management/${userId}`);
}

async function handleToggleManagedUserLoginAccess(formData: FormData) {
  const profile = await requireUserManagementAdmin();
  const userId = String(formData.get("userId") ?? "").trim();
  const disabledRaw = String(formData.get("disabled") ?? "").trim().toLowerCase();
  if (!userId) return;

  const disabled = disabledRaw === "true" || disabledRaw === "1" || disabledRaw === "yes" || disabledRaw === "on";
  await setManagedUserLoginDisabled(userId, profile.id, disabled);

  revalidatePath("/time-hr/user-management");
  revalidatePath(`/time-hr/user-management/${userId}`);
}

const managedUserActionIntentSchema = z.enum([
  "createManagedUserForm",
  "updateManagedUserForm",
  "updateManagedUserStatus",
  "updateManagedUserPermissions",
  "resetManagedUserPermissions",
  "sendManagedUserInvite",
  "resendManagedUserInvite",
  "sendManagedUserReset",
  "toggleManagedUserLoginAccess"
]);

export async function submitManagedUserAction(formData: FormData) {
  const intent = managedUserActionIntentSchema.safeParse(String(formData.get("intent") ?? "").trim());
  if (!intent.success) {
    return;
  }

  switch (intent.data) {
    case "createManagedUserForm":
      return handleCreateManagedUserForm(formData);
    case "updateManagedUserForm":
      return handleUpdateManagedUserForm(formData);
    case "updateManagedUserStatus":
      return handleUpdateManagedUserStatus(formData);
    case "updateManagedUserPermissions":
      return handleUpdateManagedUserPermissions(formData);
    case "resetManagedUserPermissions":
      return handleResetManagedUserPermissions(formData);
    case "sendManagedUserInvite":
      return handleSendManagedUserInvite(formData);
    case "resendManagedUserInvite":
      return handleResendManagedUserInvite(formData);
    case "sendManagedUserReset":
      return handleSendManagedUserReset(formData);
    case "toggleManagedUserLoginAccess":
      return handleToggleManagedUserLoginAccess(formData);
  }
}
