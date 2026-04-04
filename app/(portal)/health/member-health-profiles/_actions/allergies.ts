import "server-only";

import { redirect } from "next/navigation";

import { mutateMemberAllergyWorkflow } from "@/lib/services/member-health-profiles";
import { toEasternISO } from "@/lib/timezone";

import {
  asNullableString,
  asString,
  parseAllergyGroup,
  requireNurseAdmin,
  revalidateMhp,
  toServiceActor
} from "./shared";

function buildAllergyPayload(formData: FormData, allergyName: string) {
  return {
    allergy_group: parseAllergyGroup(formData, "allergyGroup"),
    allergy_name: allergyName,
    severity: asNullableString(formData, "allergySeverity"),
    comments: asNullableString(formData, "allergyComments")
  };
}

export async function addMhpAllergyAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  if (!memberId) return;

  const now = toEasternISO();
  await mutateMemberAllergyWorkflow({
    memberId,
    operation: "create",
    payload: buildAllergyPayload(formData, asString(formData, "allergyName")),
    actor: toServiceActor(actor),
    now
  });

  revalidateMhp(memberId);
  redirect(`/health/member-health-profiles/${memberId}?tab=medical`);
}

export async function updateMhpAllergyAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  const allergyId = asString(formData, "allergyId");
  if (!memberId || !allergyId) return;

  const now = toEasternISO();
  await mutateMemberAllergyWorkflow({
    memberId,
    allergyId,
    operation: "update",
    payload: buildAllergyPayload(formData, asString(formData, "allergyName")),
    actor: toServiceActor(actor),
    now
  });

  revalidateMhp(memberId);
  redirect(`/health/member-health-profiles/${memberId}?tab=medical`);
}

export async function deleteMhpAllergyAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  const allergyId = asString(formData, "allergyId");
  if (!memberId || !allergyId) return;

  const now = toEasternISO();
  const deleted = await mutateMemberAllergyWorkflow({
    memberId,
    allergyId,
    operation: "delete",
    actor: toServiceActor(actor),
    now
  });
  if (!deleted.changed) return;

  revalidateMhp(memberId);
  redirect(`/health/member-health-profiles/${memberId}?tab=medical`);
}

export async function addMhpAllergyInlineAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  if (!memberId) return { ok: false, error: "Member is required." };

  const allergyName = asString(formData, "allergyName");
  if (!allergyName) return { ok: false, error: "Allergy is required." };

  const now = toEasternISO();
  const created = await mutateMemberAllergyWorkflow({
    memberId,
    operation: "create",
    payload: buildAllergyPayload(formData, allergyName),
    actor: toServiceActor(actor),
    now
  });
  if (!created.changed || !created.entity_row) return { ok: false, error: "Unable to create allergy." };

  revalidateMhp(memberId);
  return { ok: true, row: created.entity_row };
}

export async function deleteMhpAllergyInlineAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  const allergyId = asString(formData, "allergyId");
  if (!memberId || !allergyId) return { ok: false, error: "Missing allergy reference." };

  const now = toEasternISO();
  const deleted = await mutateMemberAllergyWorkflow({
    memberId,
    allergyId,
    operation: "delete",
    actor: toServiceActor(actor),
    now
  });
  if (!deleted.changed) return { ok: false, error: "Allergy not found." };

  revalidateMhp(memberId);
  return { ok: true };
}

export async function updateMhpAllergyInlineAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  const allergyId = asString(formData, "allergyId");
  if (!memberId || !allergyId) return { ok: false, error: "Missing allergy reference." };

  const allergyName = asString(formData, "allergyName");
  if (!allergyName) return { ok: false, error: "Allergy is required." };

  const now = toEasternISO();
  const updated = await mutateMemberAllergyWorkflow({
    memberId,
    allergyId,
    operation: "update",
    payload: buildAllergyPayload(formData, allergyName),
    actor: toServiceActor(actor),
    now
  });
  if (!updated.changed || !updated.entity_row) return { ok: false, error: "Allergy not found." };

  revalidateMhp(memberId);
  return { ok: true, row: updated.entity_row };
}
