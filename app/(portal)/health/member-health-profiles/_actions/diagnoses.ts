import "server-only";

import { redirect } from "next/navigation";

import { mutateMemberDiagnosisWorkflow } from "@/lib/services/member-health-profiles";
import { toEasternISO } from "@/lib/timezone";

import { asString, requireNurseAdmin, revalidateMhp, toServiceActor } from "./shared";

export async function addMhpDiagnosisAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  if (!memberId) return;

  const now = toEasternISO();
  await mutateMemberDiagnosisWorkflow({
    memberId,
    operation: "create",
    payload: {
      diagnosis_name: asString(formData, "diagnosisName"),
      diagnosis_code: null,
      date_added: asString(formData, "diagnosisDate") || now.slice(0, 10),
      comments: null
    },
    actor: toServiceActor(actor),
    now
  });

  revalidateMhp(memberId);
  redirect(`/health/member-health-profiles/${memberId}?tab=medical`);
}

export async function updateMhpDiagnosisAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  const diagnosisId = asString(formData, "diagnosisId");
  if (!memberId || !diagnosisId) return;

  const now = toEasternISO();
  await mutateMemberDiagnosisWorkflow({
    memberId,
    diagnosisId,
    operation: "update",
    payload: {
      diagnosis_name: asString(formData, "diagnosisName"),
      diagnosis_code: null,
      date_added: asString(formData, "diagnosisDate"),
      comments: null
    },
    actor: toServiceActor(actor),
    now
  });

  revalidateMhp(memberId);
  redirect(`/health/member-health-profiles/${memberId}?tab=medical`);
}

export async function addMhpDiagnosisInlineAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  if (!memberId) return { ok: false, error: "Member is required." };

  const now = toEasternISO();
  const diagnosisName = asString(formData, "diagnosisName");
  const diagnosisDate = asString(formData, "diagnosisDate") || now.slice(0, 10);
  if (!diagnosisName) return { ok: false, error: "Diagnosis is required." };

  const created = await mutateMemberDiagnosisWorkflow({
    memberId,
    operation: "create",
    payload: {
      diagnosis_name: diagnosisName,
      diagnosis_code: null,
      date_added: diagnosisDate,
      comments: null
    },
    actor: toServiceActor(actor),
    now
  });
  if (!created.changed || !created.entity_row) return { ok: false, error: "Unable to create diagnosis." };

  revalidateMhp(memberId);
  return {
    ok: true,
    diagnosis: {
      id: created.entity_row.id,
      diagnosis_type: created.entity_row.diagnosis_type,
      diagnosis_name: created.entity_row.diagnosis_name,
      date_added: created.entity_row.date_added
    }
  };
}

export async function updateMhpDiagnosisInlineAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  const diagnosisId = asString(formData, "diagnosisId");
  if (!memberId || !diagnosisId) return { ok: false, error: "Missing diagnosis reference." };

  const diagnosisName = asString(formData, "diagnosisName");
  const diagnosisDate = asString(formData, "diagnosisDate");
  if (!diagnosisName || !diagnosisDate) return { ok: false, error: "Diagnosis and date are required." };

  const now = toEasternISO();
  const updated = await mutateMemberDiagnosisWorkflow({
    memberId,
    diagnosisId,
    operation: "update",
    payload: {
      diagnosis_name: diagnosisName,
      diagnosis_code: null,
      date_added: diagnosisDate,
      comments: null
    },
    actor: toServiceActor(actor),
    now
  });
  if (!updated.changed || !updated.entity_row) return { ok: false, error: "Diagnosis not found." };

  revalidateMhp(memberId);
  return {
    ok: true,
    diagnosis: {
      id: updated.entity_row.id,
      diagnosis_type: updated.entity_row.diagnosis_type,
      diagnosis_name: updated.entity_row.diagnosis_name,
      date_added: updated.entity_row.date_added
    }
  };
}

export async function deleteMhpDiagnosisInlineAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  const diagnosisId = asString(formData, "diagnosisId");
  if (!memberId || !diagnosisId) return { ok: false, error: "Missing diagnosis reference." };

  const now = toEasternISO();
  const deleted = await mutateMemberDiagnosisWorkflow({
    memberId,
    diagnosisId,
    operation: "delete",
    actor: toServiceActor(actor),
    now
  });
  if (!deleted.changed) return { ok: false, error: "Diagnosis not found." };

  revalidateMhp(memberId);
  return { ok: true };
}
