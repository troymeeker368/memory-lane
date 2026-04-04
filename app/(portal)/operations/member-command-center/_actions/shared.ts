import "server-only";

import { revalidatePath } from "next/cache";

import {
  requireMemberCommandCenterAccess,
  requireMemberCommandCenterAttendanceBillingEdit,
  requireMemberCommandCenterEdit
} from "@/lib/auth";
import { normalizePhoneForStorage } from "@/lib/phone";

export type CommandCenterEditor = Awaited<ReturnType<typeof requireMemberCommandCenterEdit>>;
export type CommandCenterViewer = Awaited<ReturnType<typeof requireMemberCommandCenterAccess>>;

export function asString(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

export function asNullableString(formData: FormData, key: string) {
  const value = asString(formData, key);
  return value.length > 0 ? value : null;
}

export function asNullableBoolSelect(formData: FormData, key: string) {
  const value = asString(formData, key).toLowerCase();
  if (!value) return null;
  if (value === "true" || value === "yes" || value === "1") return true;
  if (value === "false" || value === "no" || value === "0") return false;
  return null;
}

export function asCheckbox(formData: FormData, key: string) {
  return formData.get(key) === "on" || formData.get(key) === "true";
}

export function asDateOnly(formData: FormData, key: string, fallback: string) {
  const value = asString(formData, key).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback;
}

export function asOptionalPositiveNumber(formData: FormData, key: string) {
  const raw = asString(formData, key);
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Number(parsed.toFixed(2));
}

export function normalizePhone(value: string | null | undefined) {
  return normalizePhoneForStorage(value);
}

export function normalizeLockerInput(raw: string) {
  const normalized = raw.trim();
  if (!normalized) return null;
  if (/^\d+$/.test(normalized)) {
    const parsed = Number(normalized);
    if (Number.isFinite(parsed) && parsed > 0) {
      return String(parsed);
    }
  }
  return normalized.toUpperCase();
}

export async function requireCommandCenterEditor() {
  return requireMemberCommandCenterEdit();
}

export async function requireCommandCenterViewer() {
  return requireMemberCommandCenterAccess();
}

export async function requireAttendanceBillingEditor() {
  return requireMemberCommandCenterAttendanceBillingEdit();
}

export function toServiceActor(actor: Pick<CommandCenterEditor, "id" | "full_name">) {
  return {
    id: actor.id,
    fullName: actor.full_name
  };
}

export function toAuthorizedActor<T extends { id: string; full_name: string; role: string; permissions: unknown }>(actor: T) {
  return {
    id: actor.id,
    fullName: actor.full_name,
    role: actor.role,
    permissions: actor.permissions
  };
}

export function revalidateCommandCenter(memberId: string) {
  revalidatePath("/operations/member-command-center");
  revalidatePath(`/operations/member-command-center/${memberId}`);
  revalidatePath("/operations/payor");
  revalidatePath("/operations/payor/billing-agreements");
  revalidatePath("/operations/payor/schedule-templates");
  revalidatePath("/operations/payor/variable-charges");
  revalidatePath("/operations/payor/revenue-dashboard");
  revalidatePath("/operations/attendance");
  revalidatePath("/operations/transportation-station");
  revalidatePath("/operations/transportation-station/print");
  revalidatePath("/operations/locker-assignments");
  revalidatePath("/health/member-health-profiles");
  revalidatePath(`/health/member-health-profiles/${memberId}`);
  revalidatePath(`/members/${memberId}`);
}
