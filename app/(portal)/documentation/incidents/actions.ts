"use server";

import { revalidatePath } from "next/cache";

import { requireModuleAccess } from "@/lib/auth";
import { canAccessIncidentReportsForRole } from "@/lib/permissions";
import {
  amendApprovedIncident,
  closeIncident,
  reviewIncident,
  saveIncidentDraft,
  submitIncident
} from "@/lib/services/incidents";
import { buildIncidentPdfDataUrl } from "@/lib/services/incident-pdf";
import { easternDateTimeLocalToISO } from "@/lib/timezone";

function asString(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function asNullableString(formData: FormData, key: string) {
  const value = asString(formData, key);
  return value.length > 0 ? value : null;
}

function asBoolean(formData: FormData, key: string) {
  const normalized = asString(formData, key).toLowerCase();
  return normalized === "true" || normalized === "yes" || normalized === "on" || normalized === "1";
}

function asDateTimeIso(formData: FormData, key: string) {
  const localValue = asString(formData, key);
  if (!localValue) throw new Error(`${key} is required.`);
  return easternDateTimeLocalToISO(localValue);
}

function mapDraftInput(formData: FormData) {
  return {
    incidentId: asNullableString(formData, "incidentId"),
    incidentCategory: asString(formData, "incidentCategory"),
    reportable: asBoolean(formData, "reportable"),
    participantId: asNullableString(formData, "participantId"),
    staffMemberId: asNullableString(formData, "staffMemberId"),
    additionalParties: asNullableString(formData, "additionalParties"),
    incidentDateTime: asDateTimeIso(formData, "incidentDateTime"),
    reportedDateTime: asDateTimeIso(formData, "reportedDateTime"),
    location: asString(formData, "location"),
    exactLocationDetails: asNullableString(formData, "exactLocationDetails"),
    description: asString(formData, "description"),
    unsafeConditionsPresent: asBoolean(formData, "unsafeConditionsPresent"),
    unsafeConditionsDescription: asNullableString(formData, "unsafeConditionsDescription"),
    injuredBy: asNullableString(formData, "injuredBy"),
    injuryType: asNullableString(formData, "injuryType"),
    bodyPart: asNullableString(formData, "bodyPart"),
    generalNotes: asNullableString(formData, "generalNotes"),
    followUpNote: asNullableString(formData, "followUpNote"),
    submitterSignatureName: asNullableString(formData, "submitterSignatureName")
  };
}

function revalidateIncidentRoutes(incidentId: string) {
  revalidatePath("/documentation");
  revalidatePath("/documentation/incidents");
  revalidatePath("/health");
  revalidatePath(`/documentation/incidents/${incidentId}`);
}

async function getActor() {
  const profile = await requireModuleAccess("documentation");
  if (!canAccessIncidentReportsForRole(profile.role)) {
    throw new Error("Only nurses, managers, directors, and admins can access incident reports.");
  }
  return {
    id: profile.id,
    fullName: profile.full_name,
    role: profile.role,
    permissions: profile.permissions
  };
}

export async function saveIncidentDraftAction(formData: FormData) {
  try {
    const actor = await getActor();
    const detail = await saveIncidentDraft(mapDraftInput(formData), actor);
    if (!detail) throw new Error("Incident was saved but the record could not be reloaded.");
    revalidateIncidentRoutes(detail.id);
    return { ok: true, incidentId: detail.id, status: detail.status } as const;
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to save incident draft."
    } as const;
  }
}

export async function submitIncidentAction(formData: FormData) {
  try {
    const actor = await getActor();
    const detail = await submitIncident(mapDraftInput(formData), actor);
    if (!detail) throw new Error("Incident was submitted but the record could not be reloaded.");
    revalidateIncidentRoutes(detail.id);
    return { ok: true, incidentId: detail.id, status: detail.status } as const;
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to submit incident."
    } as const;
  }
}

export async function reviewIncidentAction(formData: FormData) {
  try {
    const actor = await getActor();
    const incidentId = asString(formData, "incidentId");
    const decision = asString(formData, "decision");
    const reviewNotes = asNullableString(formData, "reviewNotes");
    const detail = await reviewIncident({ incidentId, decision, reviewNotes }, actor);
    if (!detail) throw new Error("Incident review saved but the record could not be reloaded.");
    revalidateIncidentRoutes(detail.id);
    return { ok: true, incidentId: detail.id, status: detail.status } as const;
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to record the director review."
    } as const;
  }
}

export async function closeIncidentAction(formData: FormData) {
  try {
    const actor = await getActor();
    const incidentId = asString(formData, "incidentId");
    const notes = asNullableString(formData, "closeNotes");
    const detail = await closeIncident(incidentId, actor, notes);
    if (!detail) throw new Error("Incident closed but the record could not be reloaded.");
    revalidateIncidentRoutes(detail.id);
    return { ok: true, incidentId: detail.id, status: detail.status } as const;
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to close the incident."
    } as const;
  }
}

export async function amendIncidentAction(formData: FormData) {
  try {
    const actor = await getActor();
    const detail = await amendApprovedIncident(
      {
        ...mapDraftInput(formData),
        incidentId: asString(formData, "incidentId"),
        amendmentNote: asString(formData, "amendmentNote")
      },
      actor
    );
    if (!detail) throw new Error("Incident amended but the record could not be reloaded.");
    revalidateIncidentRoutes(detail.id);
    return { ok: true, incidentId: detail.id, status: detail.status } as const;
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to amend the incident."
    } as const;
  }
}

export async function generateIncidentPdfAction(input: { incidentId: string }) {
  try {
    await getActor();
    const generated = await buildIncidentPdfDataUrl(input.incidentId);
    return {
      ok: true,
      fileName: generated.fileName,
      dataUrl: generated.dataUrl
    } as const;
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to generate incident PDF."
    } as const;
  }
}
