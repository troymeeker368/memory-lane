import "server-only";

import { mutateMemberCommandCenterAllergyWorkflow } from "@/lib/services/member-command-center";
import { toEasternISO } from "@/lib/timezone";

import { asNullableString, asString, requireCommandCenterEditor, revalidateCommandCenter, toServiceActor } from "./shared";

function normalizeAllergyGroup(raw: string) {
  return raw === "food" || raw === "medication" || raw === "environmental" ? raw : null;
}

function buildAllergyPayload(formData: FormData, allergyGroup: "food" | "medication" | "environmental", allergyName: string) {
  return {
    allergy_group: allergyGroup,
    allergy_name: allergyName,
    severity: asNullableString(formData, "allergySeverity"),
    comments: asNullableString(formData, "allergyComments")
  };
}

export async function addMemberCommandCenterAllergyInlineAction(formData: FormData) {
  try {
    const actor = await requireCommandCenterEditor();
    const memberId = asString(formData, "memberId");
    if (!memberId) return { ok: false, error: "Member is required." };

    const allergyGroup = normalizeAllergyGroup(asString(formData, "allergyGroup"));
    const allergyName = asString(formData, "allergyName");
    if (!allergyGroup || !allergyName) return { ok: false, error: "Allergy group and name are required." };

    const now = toEasternISO();
    const created = await mutateMemberCommandCenterAllergyWorkflow({
      memberId,
      operation: "create",
      payload: buildAllergyPayload(formData, allergyGroup, allergyName),
      actor: toServiceActor(actor),
      now
    });

    revalidateCommandCenter(memberId);
    return { ok: true, row: created };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Unable to add allergy." };
  }
}

export async function updateMemberCommandCenterAllergyInlineAction(formData: FormData) {
  try {
    const actor = await requireCommandCenterEditor();
    const memberId = asString(formData, "memberId");
    const allergyId = asString(formData, "allergyId");
    if (!memberId || !allergyId) return { ok: false, error: "Missing allergy reference." };

    const allergyGroup = normalizeAllergyGroup(asString(formData, "allergyGroup"));
    const allergyName = asString(formData, "allergyName");
    if (!allergyGroup || !allergyName) return { ok: false, error: "Allergy group and name are required." };

    const now = toEasternISO();
    const updated = await mutateMemberCommandCenterAllergyWorkflow({
      memberId,
      operation: "update",
      allergyId,
      payload: buildAllergyPayload(formData, allergyGroup, allergyName),
      actor: toServiceActor(actor),
      now
    });
    if (!updated) return { ok: false, error: "Allergy not found." };

    revalidateCommandCenter(memberId);
    return { ok: true, row: updated };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Unable to update allergy." };
  }
}

export async function deleteMemberCommandCenterAllergyInlineAction(formData: FormData) {
  try {
    const actor = await requireCommandCenterEditor();
    const memberId = asString(formData, "memberId");
    const allergyId = asString(formData, "allergyId");
    if (!memberId || !allergyId) return { ok: false, error: "Missing allergy reference." };

    await mutateMemberCommandCenterAllergyWorkflow({
      memberId,
      operation: "delete",
      allergyId,
      actor: toServiceActor(actor)
    });

    revalidateCommandCenter(memberId);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Unable to delete allergy." };
  }
}
