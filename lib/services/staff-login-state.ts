import { createClient } from "@/lib/supabase/server";
import { normalizeRoleKey } from "@/lib/permissions";
import { toEasternISO } from "@/lib/timezone";
import type { AppRole } from "@/types/app";
import type { Database } from "@/types/supabase";

type StaffAuthStatus = "invited" | "active" | "disabled";
type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];

type StaffAuthProfile = {
  id: string;
  role: AppRole;
  active: boolean;
  isActive: boolean;
  status: StaffAuthStatus;
  passwordSetAt: string | null;
};

function clean(value: string | null | undefined) {
  const normalized = (value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeStatus(value: string | null | undefined, active: boolean): StaffAuthStatus {
  const normalized = clean(value)?.toLowerCase();
  if (normalized === "invited" || normalized === "active" || normalized === "disabled") {
    return normalized;
  }
  return active ? "active" : "disabled";
}

function toStaffAuthProfile(row: ProfileRow): StaffAuthProfile {
  const active = row.active !== false;
  return {
    id: String(row.id ?? ""),
    role: normalizeRoleKey(String(row.role ?? "program-assistant") as AppRole),
    active,
    isActive: row.is_active !== false,
    status: normalizeStatus(row.status, active),
    passwordSetAt: clean(row.password_set_at) ?? null
  };
}

async function getServiceClient() {
  return await createClient({ serviceRole: true });
}

async function getStaffAuthProfileById(staffUserId: string): Promise<StaffAuthProfile> {
  const supabase = await getServiceClient();
  const { data, error } = await supabase.from("profiles").select("*").eq("id", staffUserId).maybeSingle();

  if (error) {
    throw new Error(`Unable to load staff auth profile ${staffUserId}: ${error.message}`);
  }
  if (!data) {
    throw new Error(`Staff profile ${staffUserId} was not found.`);
  }

  return toStaffAuthProfile(data);
}

async function patchStaffAuthProfile(
  staffUserId: string,
  patch: Partial<{
    status: StaffAuthStatus;
    last_sign_in_at: string | null;
  }>
) {
  const supabase = await getServiceClient();
  const { error } = await supabase
    .from("profiles")
    .update({
      ...patch,
      updated_at: toEasternISO()
    })
    .eq("id", staffUserId);

  if (error) {
    throw new Error(`Unable to update staff auth profile ${staffUserId}: ${error.message}`);
  }
}

export async function evaluateStaffLoginEligibility(userId: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  let staff: StaffAuthProfile;
  try {
    staff = await getStaffAuthProfileById(userId);
  } catch {
    return { ok: false, reason: "no-linked-profile" };
  }

  if (!staff.active || !staff.isActive) {
    return { ok: false, reason: "inactive-profile" };
  }

  if (staff.status === "disabled") {
    return { ok: false, reason: "disabled-profile" };
  }

  if (staff.status === "invited" && !staff.passwordSetAt) {
    return { ok: false, reason: "password-setup-required" };
  }

  return { ok: true };
}

export async function markStaffLoginSuccess(userId: string) {
  const staff = await getStaffAuthProfileById(userId);
  const patch: Parameters<typeof patchStaffAuthProfile>[1] = {
    last_sign_in_at: toEasternISO()
  };

  if (staff.status === "invited" && staff.passwordSetAt) {
    patch.status = "active";
  }

  await patchStaffAuthProfile(userId, patch);
}
