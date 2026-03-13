"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isRedirectError } from "next/dist/client/components/redirect-error";

import { getCurrentProfile } from "@/lib/auth";
import {
  assignLockerToMemberSupabase,
  clearLockerForMemberSupabase
} from "@/lib/services/locker-assignments-supabase";

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

    const assigned = await assignLockerToMemberSupabase({
      memberId,
      lockerNumber,
      actionLabel: "assignLockerAction"
    });

    revalidateLockerViews(assigned.memberId);
    redirectWith({
      success: `Locker ${assigned.lockerNumber} assigned to ${assigned.memberName}.`,
      locker: assigned.lockerNumber,
      memberId: assigned.memberId
    });
  } catch (error) {
    if (isRedirectError(error)) {
      throw error;
    }
    const qs = redirectParamsFromForm(formData);
    const message = error instanceof Error ? error.message : "Unable to save locker assignment.";
    qs.set("error", message);
    console.error("[Locker] assignLockerAction failed", {
      message,
      memberId: asString(formData, "memberId"),
      lockerNumber: asString(formData, "lockerNumber")
    });
    redirect(`/operations/locker-assignments?${qs.toString()}`);
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

    const cleared = await clearLockerForMemberSupabase({
      memberId,
      actionLabel: "clearLockerAction"
    });

    revalidateLockerViews(cleared.memberId);
    redirectWith({ success: `Locker cleared for ${cleared.memberName}.` });
  } catch (error) {
    if (isRedirectError(error)) {
      throw error;
    }
    const qs = redirectParamsFromForm(formData);
    const message = error instanceof Error ? error.message : "Unable to clear locker.";
    qs.set("error", message);
    console.error("[Locker] clearLockerAction failed", {
      message,
      memberId: asString(formData, "memberId")
    });
    redirect(`/operations/locker-assignments?${qs.toString()}`);
  }
}
