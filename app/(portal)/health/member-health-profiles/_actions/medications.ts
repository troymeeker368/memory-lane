import "server-only";

import { redirect } from "next/navigation";

import { mutateMemberMedicationWorkflow } from "@/lib/services/member-health-profiles";
import { toEasternDate, toEasternISO } from "@/lib/timezone";

import {
  addDaysDateOnly,
  asNullableString,
  asString,
  parseMedicationMarInput,
  parseRouteLaterality,
  requireNurseAdmin,
  revalidateMhp,
  toServiceActor
} from "./shared";

function buildMedicationPayload(formData: FormData, startDate: string) {
  const route = asNullableString(formData, "route");
  const parsedLaterality = parseRouteLaterality(route, formData);
  if (!parsedLaterality.ok) return parsedLaterality;

  const marInput = parseMedicationMarInput(formData);
  if (!marInput.ok) return marInput;

  return {
    ok: true as const,
    payload: {
      medication_name: asString(formData, "medicationName"),
      date_started: asString(formData, "dateStarted") || startDate,
      dose: asNullableString(formData, "dose"),
      quantity: asNullableString(formData, "quantity"),
      form: asNullableString(formData, "medicationForm"),
      frequency: asNullableString(formData, "frequency"),
      route,
      route_laterality: parsedLaterality.value,
      given_at_center: marInput.givenAtCenter,
      prn: marInput.prn,
      prn_instructions: marInput.prnInstructions,
      scheduled_times: marInput.scheduledTimes,
      comments: asNullableString(formData, "medicationComments")
    }
  };
}

function getMarWindow() {
  const startDate = toEasternDate();
  return {
    startDate,
    endDate: addDaysDateOnly(startDate, 30)
  };
}

export async function addMhpMedicationAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  if (!memberId) return;

  const now = toEasternISO();
  const { startDate, endDate } = getMarWindow();
  const medicationPayload = buildMedicationPayload(formData, startDate);
  if (!medicationPayload.ok) {
    throw new Error(medicationPayload.error);
  }

  await mutateMemberMedicationWorkflow({
    memberId,
    operation: "create",
    payload: {
      ...medicationPayload.payload,
      medication_status: "active",
      inactivated_at: null
    },
    actor: toServiceActor(actor),
    now,
    marStartDate: startDate,
    marEndDate: endDate
  });

  revalidateMhp(memberId, { mar: true });
  redirect(`/health/member-health-profiles/${memberId}?tab=medical`);
}

export async function updateMhpMedicationAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  const medicationId = asString(formData, "medicationId");
  if (!memberId || !medicationId) return;

  const now = toEasternISO();
  const { startDate, endDate } = getMarWindow();
  const medicationPayload = buildMedicationPayload(formData, startDate);
  if (!medicationPayload.ok) {
    throw new Error(medicationPayload.error);
  }

  await mutateMemberMedicationWorkflow({
    memberId,
    medicationId,
    operation: "update",
    payload: medicationPayload.payload,
    actor: toServiceActor(actor),
    now,
    marStartDate: startDate,
    marEndDate: endDate
  });

  revalidateMhp(memberId, { mar: true });
  redirect(`/health/member-health-profiles/${memberId}?tab=medical`);
}

export async function deleteMhpMedicationAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  const medicationId = asString(formData, "medicationId");
  if (!memberId || !medicationId) return;

  const now = toEasternISO();
  const { startDate, endDate } = getMarWindow();
  const deleted = await mutateMemberMedicationWorkflow({
    memberId,
    medicationId,
    operation: "delete",
    actor: toServiceActor(actor),
    now,
    marStartDate: startDate,
    marEndDate: endDate
  });
  if (!deleted.changed) return;

  revalidateMhp(memberId, { mar: true });
  redirect(`/health/member-health-profiles/${memberId}?tab=medical`);
}

export async function addMhpMedicationInlineAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  if (!memberId) return { ok: false, error: "Member is required." };

  const medicationName = asString(formData, "medicationName");
  if (!medicationName) return { ok: false, error: "Medication is required." };

  const now = toEasternISO();
  const { startDate, endDate } = getMarWindow();
  const medicationPayload = buildMedicationPayload(formData, startDate);
  if (!medicationPayload.ok) return { ok: false, error: medicationPayload.error };

  const created = await mutateMemberMedicationWorkflow({
    memberId,
    operation: "create",
    payload: {
      ...medicationPayload.payload,
      medication_name: medicationName,
      medication_status: "active",
      inactivated_at: null
    },
    actor: toServiceActor(actor),
    now,
    marStartDate: startDate,
    marEndDate: endDate
  });
  if (!created.changed || !created.entity_row) return { ok: false, error: "Unable to create medication." };

  revalidateMhp(memberId, { mar: true });
  return { ok: true, row: created.entity_row };
}

export async function updateMhpMedicationInlineAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  const medicationId = asString(formData, "medicationId");
  if (!memberId || !medicationId) return { ok: false, error: "Missing medication reference." };

  const medicationName = asString(formData, "medicationName");
  if (!medicationName) return { ok: false, error: "Medication is required." };

  const now = toEasternISO();
  const { startDate, endDate } = getMarWindow();
  const medicationPayload = buildMedicationPayload(formData, startDate);
  if (!medicationPayload.ok) return { ok: false, error: medicationPayload.error };

  const updated = await mutateMemberMedicationWorkflow({
    memberId,
    medicationId,
    operation: "update",
    payload: {
      ...medicationPayload.payload,
      medication_name: medicationName
    },
    actor: toServiceActor(actor),
    now,
    marStartDate: startDate,
    marEndDate: endDate
  });
  if (!updated.changed || !updated.entity_row) return { ok: false, error: "Medication not found." };

  revalidateMhp(memberId, { mar: true });
  return { ok: true, row: updated.entity_row };
}

export async function deleteMhpMedicationInlineAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  const medicationId = asString(formData, "medicationId");
  if (!memberId || !medicationId) return { ok: false, error: "Missing medication reference." };

  const now = toEasternISO();
  const { startDate, endDate } = getMarWindow();
  const deleted = await mutateMemberMedicationWorkflow({
    memberId,
    medicationId,
    operation: "delete",
    actor: toServiceActor(actor),
    now,
    marStartDate: startDate,
    marEndDate: endDate
  });
  if (!deleted.changed) return { ok: false, error: "Medication not found." };

  revalidateMhp(memberId, { mar: true });
  return { ok: true };
}

export async function inactivateMhpMedicationInlineAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  const medicationId = asString(formData, "medicationId");
  if (!memberId || !medicationId) return { ok: false, error: "Missing medication reference." };

  const now = toEasternISO();
  const today = toEasternDate();
  const { startDate, endDate } = getMarWindow();
  const updated = await mutateMemberMedicationWorkflow({
    memberId,
    medicationId,
    operation: "inactivate",
    payload: {
      inactivated_at: today
    },
    actor: toServiceActor(actor),
    now,
    marStartDate: startDate,
    marEndDate: endDate
  });
  if (!updated.changed || !updated.entity_row) return { ok: false, error: "Medication not found." };

  revalidateMhp(memberId, { mar: true });
  return { ok: true, row: updated.entity_row };
}

export async function reactivateMhpMedicationInlineAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  const medicationId = asString(formData, "medicationId");
  if (!memberId || !medicationId) return { ok: false, error: "Missing medication reference." };

  const now = toEasternISO();
  const today = toEasternDate();
  const { startDate, endDate } = getMarWindow();
  const updated = await mutateMemberMedicationWorkflow({
    memberId,
    medicationId,
    operation: "reactivate",
    payload: {
      date_started: today
    },
    actor: toServiceActor(actor),
    now,
    marStartDate: startDate,
    marEndDate: endDate
  });
  if (!updated.changed || !updated.entity_row) return { ok: false, error: "Medication not found." };

  revalidateMhp(memberId, { mar: true });
  return { ok: true, row: updated.entity_row };
}
