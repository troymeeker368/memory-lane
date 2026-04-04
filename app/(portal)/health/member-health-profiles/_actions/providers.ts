import "server-only";

import { redirect } from "next/navigation";

import { normalizePhoneForStorage } from "@/lib/phone";
import { mutateMemberProviderWorkflow } from "@/lib/services/member-health-profiles";
import { toEasternISO } from "@/lib/timezone";

import {
  asNullableString,
  asString,
  requireNurseAdmin,
  resolveProviderSpecialty,
  revalidateMhp,
  toServiceActor
} from "./shared";

function buildProviderPayload(formData: FormData, providerName: string) {
  const specialty = resolveProviderSpecialty(formData);
  return {
    provider_name: providerName,
    specialty: specialty.specialty,
    specialty_other: specialty.specialty_other,
    practice_name: asNullableString(formData, "practiceName"),
    provider_phone: normalizePhoneForStorage(asNullableString(formData, "providerPhone"))
  };
}

export async function addMhpProviderAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  if (!memberId) return;

  const now = toEasternISO();
  await mutateMemberProviderWorkflow({
    memberId,
    operation: "create",
    payload: buildProviderPayload(formData, asString(formData, "providerName")),
    actor: toServiceActor(actor),
    now
  });

  revalidateMhp(memberId);
  redirect(`/health/member-health-profiles/${memberId}?tab=medical`);
}

export async function updateMhpProviderAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  const providerId = asString(formData, "providerId");
  if (!memberId || !providerId) return;

  const now = toEasternISO();
  await mutateMemberProviderWorkflow({
    memberId,
    providerId,
    operation: "update",
    payload: buildProviderPayload(formData, asString(formData, "providerName")),
    actor: toServiceActor(actor),
    now
  });

  revalidateMhp(memberId);
  redirect(`/health/member-health-profiles/${memberId}?tab=medical`);
}

export async function deleteMhpProviderAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  const providerId = asString(formData, "providerId");
  if (!memberId || !providerId) return;

  const now = toEasternISO();
  const deleted = await mutateMemberProviderWorkflow({
    memberId,
    providerId,
    operation: "delete",
    actor: toServiceActor(actor),
    now
  });
  if (!deleted.changed) return;

  revalidateMhp(memberId);
  redirect(`/health/member-health-profiles/${memberId}?tab=medical`);
}

export async function addMhpProviderInlineAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  if (!memberId) return { ok: false, error: "Member is required." };

  const providerName = asString(formData, "providerName");
  if (!providerName) return { ok: false, error: "Provider name is required." };

  const now = toEasternISO();
  const created = await mutateMemberProviderWorkflow({
    memberId,
    operation: "create",
    payload: buildProviderPayload(formData, providerName),
    actor: toServiceActor(actor),
    now
  });
  if (!created.changed || !created.entity_row) return { ok: false, error: "Unable to create provider." };

  revalidateMhp(memberId);
  return { ok: true, row: created.entity_row };
}

export async function deleteMhpProviderInlineAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  const providerId = asString(formData, "providerId");
  if (!memberId || !providerId) return { ok: false, error: "Missing provider reference." };

  const now = toEasternISO();
  const deleted = await mutateMemberProviderWorkflow({
    memberId,
    providerId,
    operation: "delete",
    actor: toServiceActor(actor),
    now
  });
  if (!deleted.changed) return { ok: false, error: "Provider not found." };

  revalidateMhp(memberId);
  return { ok: true };
}

export async function updateMhpProviderInlineAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  const providerId = asString(formData, "providerId");
  if (!memberId || !providerId) return { ok: false, error: "Missing provider reference." };

  const providerName = asString(formData, "providerName");
  if (!providerName) return { ok: false, error: "Provider name is required." };

  const now = toEasternISO();
  const updated = await mutateMemberProviderWorkflow({
    memberId,
    providerId,
    operation: "update",
    payload: buildProviderPayload(formData, providerName),
    actor: toServiceActor(actor),
    now
  });
  if (!updated.changed || !updated.entity_row) return { ok: false, error: "Provider not found." };

  revalidateMhp(memberId);
  return { ok: true, row: updated.entity_row };
}
