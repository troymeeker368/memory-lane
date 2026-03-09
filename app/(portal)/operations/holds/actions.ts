"use server";

import { revalidatePath } from "next/cache";

import { getCurrentProfile } from "@/lib/auth";
import { MEMBER_HOLD_REASON_OPTIONS } from "@/lib/canonical";
import { createMemberHold, endMemberHold } from "@/lib/services/holds";
import { normalizeOperationalDateOnly } from "@/lib/services/operations-calendar";

function asString(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function asNullableString(formData: FormData, key: string) {
  const value = asString(formData, key);
  return value.length > 0 ? value : null;
}

async function requireHoldEditor() {
  const profile = await getCurrentProfile();
  if (profile.role !== "admin" && profile.role !== "manager") {
    throw new Error("Only Admin/Manager can update holds.");
  }
  return profile;
}

function revalidateHoldsWorkflows() {
  revalidatePath("/operations/holds");
  revalidatePath("/operations/attendance");
  revalidatePath("/operations/transportation-station");
  revalidatePath("/operations/transportation-station/print");
}

export async function createMemberHoldAction(formData: FormData) {
  const actor = await requireHoldEditor();
  const memberId = asString(formData, "memberId");
  const startDate = normalizeOperationalDateOnly(asString(formData, "startDate"));
  const endDateRaw = asNullableString(formData, "endDate");
  const endDate = endDateRaw ? normalizeOperationalDateOnly(endDateRaw) : null;
  const reason = asString(formData, "reason");
  const reasonOther = asNullableString(formData, "reasonOther");
  const notes = asNullableString(formData, "notes");

  if (!memberId) {
    throw new Error("Member is required.");
  }
  if (!reason || !MEMBER_HOLD_REASON_OPTIONS.includes(reason as (typeof MEMBER_HOLD_REASON_OPTIONS)[number])) {
    throw new Error("Hold reason is required.");
  }
  if (reason === "Other" && !reasonOther) {
    throw new Error("Custom reason is required when reason is Other.");
  }
  if (endDate && endDate < startDate) {
    throw new Error("End date cannot be earlier than start date.");
  }

  createMemberHold({
    memberId,
    startDate,
    endDate,
    reason,
    reasonOther,
    notes,
    actorUserId: actor.id,
    actorName: actor.full_name
  });

  revalidateHoldsWorkflows();
}

export async function endMemberHoldAction(formData: FormData) {
  const actor = await requireHoldEditor();
  const holdId = asString(formData, "holdId");
  if (!holdId) {
    throw new Error("Hold reference is required.");
  }

  const ended = endMemberHold({
    holdId,
    actorUserId: actor.id,
    actorName: actor.full_name
  });
  if (!ended) {
    throw new Error("Hold not found.");
  }

  revalidateHoldsWorkflows();
}

