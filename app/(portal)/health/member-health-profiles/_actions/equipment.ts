import "server-only";

import { redirect } from "next/navigation";

import { mutateMemberEquipmentWorkflow } from "@/lib/services/member-health-profiles";
import { toEasternISO } from "@/lib/timezone";

import { asNullableString, asString, requireNurseAdmin, revalidateMhp, toServiceActor } from "./shared";

function buildEquipmentPayload(formData: FormData) {
  return {
    equipment_type: asString(formData, "equipmentType"),
    provider_source: null,
    status: asNullableString(formData, "equipmentStatus") ?? "Active",
    comments: asNullableString(formData, "equipmentComments")
  };
}

export async function addMhpEquipmentAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  if (!memberId) return;

  const now = toEasternISO();
  await mutateMemberEquipmentWorkflow({
    memberId,
    operation: "create",
    payload: buildEquipmentPayload(formData),
    actor: toServiceActor(actor),
    now
  });

  revalidateMhp(memberId);
  redirect(`/health/member-health-profiles/${memberId}?tab=equipment`);
}

export async function updateMhpEquipmentAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  const equipmentId = asString(formData, "equipmentId");
  if (!memberId || !equipmentId) return;

  const now = toEasternISO();
  await mutateMemberEquipmentWorkflow({
    memberId,
    equipmentId,
    operation: "update",
    payload: buildEquipmentPayload(formData),
    actor: toServiceActor(actor),
    now
  });

  revalidateMhp(memberId);
  redirect(`/health/member-health-profiles/${memberId}?tab=equipment`);
}

export async function addMhpEquipmentInlineAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  if (!memberId) return { ok: false, error: "Member is required." };

  const equipmentType = asString(formData, "equipmentType");
  if (!equipmentType) return { ok: false, error: "Equipment type is required." };

  const now = toEasternISO();
  const created = await mutateMemberEquipmentWorkflow({
    memberId,
    operation: "create",
    payload: buildEquipmentPayload(formData),
    actor: toServiceActor(actor),
    now
  });
  if (!created.changed || !created.entity_row) return { ok: false, error: "Unable to create equipment." };

  revalidateMhp(memberId);
  return { ok: true, row: created.entity_row };
}

export async function updateMhpEquipmentInlineAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  const equipmentId = asString(formData, "equipmentId");
  if (!memberId || !equipmentId) return { ok: false, error: "Missing equipment reference." };

  const now = toEasternISO();
  const updated = await mutateMemberEquipmentWorkflow({
    memberId,
    equipmentId,
    operation: "update",
    payload: buildEquipmentPayload(formData),
    actor: toServiceActor(actor),
    now
  });
  if (!updated.changed || !updated.entity_row) return { ok: false, error: "Equipment not found." };

  revalidateMhp(memberId);
  return { ok: true, row: updated.entity_row };
}

export async function deleteMhpEquipmentInlineAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  const equipmentId = asString(formData, "equipmentId");
  if (!memberId || !equipmentId) return { ok: false, error: "Missing equipment reference." };

  const now = toEasternISO();
  const deleted = await mutateMemberEquipmentWorkflow({
    memberId,
    equipmentId,
    operation: "delete",
    actor: toServiceActor(actor),
    now
  });
  if (!deleted.changed) return { ok: false, error: "Equipment not found." };

  revalidateMhp(memberId);
  return { ok: true };
}
