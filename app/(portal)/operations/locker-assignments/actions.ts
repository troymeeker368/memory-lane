"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isRedirectError } from "next/dist/client/components/redirect-error";

import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { toEasternISO } from "@/lib/timezone";

function asString(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function normalizeLockerInput(raw: string) {
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

async function requireLockerEditor() {
  const profile = await getCurrentProfile();
  if (profile.role !== "admin" && profile.role !== "manager") {
    throw new Error("Only Admin/Manager can edit locker assignments.");
  }
  return profile;
}

function revalidateLockerViews(memberId?: string | null) {
  revalidatePath("/operations/locker-assignments");
  revalidatePath("/operations/member-command-center");
  if (memberId) {
    revalidatePath(`/operations/member-command-center/${memberId}`);
    revalidatePath(`/members/${memberId}`);
  }
}

function redirectParamsFromForm(formData: FormData) {
  const params = new URLSearchParams();
  const query = asString(formData, "q");
  const status = asString(formData, "status");
  const page = asString(formData, "page");
  const locker = normalizeLockerInput(asString(formData, "locker"));
  const memberId = asString(formData, "memberId");

  if (query) params.set("q", query);
  if (status && status !== "all") params.set("status", status);
  if (page && Number.isFinite(Number(page)) && Number(page) > 1) {
    params.set("page", String(Math.floor(Number(page))));
  }
  if (locker) params.set("locker", locker);
  if (memberId) params.set("memberId", memberId);
  return params;
}

export async function assignLockerAction(formData: FormData) {
  try {
    await requireLockerEditor();
    const memberId = asString(formData, "memberId");
    const lockerNumber = normalizeLockerInput(asString(formData, "lockerNumber"));
    const redirectWith = (params: Record<string, string>) => {
      const qs = redirectParamsFromForm(formData);
      Object.entries(params).forEach(([key, value]) => {
        qs.set(key, value);
      });
      redirect(`/operations/locker-assignments?${qs.toString()}`);
    };
    if (!memberId) {
      redirectWith({ error: "Member is required." });
      return;
    }
    if (!lockerNumber) {
      redirectWith({ error: "Locker # is required." });
      return;
    }

    const supabase = await createClient();
    const { data: member, error: memberError } = await supabase
      .from("members")
      .select("id, display_name, status, locker_number")
      .eq("id", memberId)
      .maybeSingle();
    if (memberError) {
      throw new Error(memberError.message);
    }
    if (!member) {
      redirectWith({ error: "Member not found." });
      return;
    }
    if (member.status !== "active") {
      redirectWith({ error: "Only active members can be assigned a locker." });
      return;
    }

    const { data: conflictRows, error: conflictError } = await supabase
      .from("members")
      .select("id, display_name")
      .neq("id", memberId)
      .eq("status", "active")
      .eq("locker_number", lockerNumber)
      .limit(1);
    if (conflictError) {
      throw new Error(conflictError.message);
    }
    const conflict = conflictRows?.[0] ?? null;
    if (conflict) {
      redirectWith({
        error: `Locker ${lockerNumber} is already assigned to ${conflict.display_name}.`,
        locker: lockerNumber,
        memberId
      });
      return;
    }

    const assignedAt = toEasternISO();
    const { error: updateError } = await supabase
      .from("members")
      .update({
        locker_number: lockerNumber,
        updated_at: assignedAt
      })
      .eq("id", memberId);
    if (updateError) {
      redirectWith({ error: "Unable to save locker assignment." });
      return;
    }

    revalidateLockerViews(memberId);
    redirectWith({
      success: `Locker ${lockerNumber} assigned to ${member.display_name}.`,
      locker: lockerNumber,
      memberId
    });
  } catch (error) {
    if (isRedirectError(error)) {
      throw error;
    }
    console.error("[Locker] assignLockerAction failed", {
      message: error instanceof Error ? error.message : "Unknown error",
      memberId: asString(formData, "memberId"),
      lockerNumber: asString(formData, "lockerNumber")
    });
    redirect("/operations/locker-assignments?error=Unable%20to%20save%20locker%20assignment.");
  }
}

export async function clearLockerAction(formData: FormData) {
  try {
    await requireLockerEditor();
    const memberId = asString(formData, "memberId");
    const redirectWith = (params: Record<string, string>) => {
      const qs = redirectParamsFromForm(formData);
      Object.entries(params).forEach(([key, value]) => {
        qs.set(key, value);
      });
      redirect(`/operations/locker-assignments?${qs.toString()}`);
    };
    if (!memberId) {
      redirectWith({ error: "Member is required." });
      return;
    }

    const supabase = await createClient();
    const { data: member, error: memberError } = await supabase
      .from("members")
      .select("id, display_name, locker_number")
      .eq("id", memberId)
      .maybeSingle();
    if (memberError) {
      throw new Error(memberError.message);
    }
    if (!member) {
      redirectWith({ error: "Member not found." });
      return;
    }

    const clearedAt = toEasternISO();
    const { error: clearError } = await supabase
      .from("members")
      .update({
        locker_number: null,
        updated_at: clearedAt
      })
      .eq("id", memberId);
    if (clearError) {
      redirectWith({ error: "Unable to clear locker." });
      return;
    }

    revalidateLockerViews(memberId);
    redirectWith({ success: `Locker cleared for ${member.display_name}.` });
  } catch (error) {
    if (isRedirectError(error)) {
      throw error;
    }
    console.error("[Locker] clearLockerAction failed", {
      message: error instanceof Error ? error.message : "Unknown error",
      memberId: asString(formData, "memberId")
    });
    redirect("/operations/locker-assignments?error=Unable%20to%20clear%20locker.");
  }
}
