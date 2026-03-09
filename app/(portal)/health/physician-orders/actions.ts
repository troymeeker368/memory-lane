"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getCurrentProfile, requireRoles } from "@/lib/auth";
import { saveGeneratedMemberPdfToFiles } from "@/lib/services/member-files";
import { syncPhysicianOrderToMemberProfiles } from "@/lib/services/member-profile-sync";
import {
  POF_LEVEL_OF_CARE_OPTIONS,
  buildPhysicianOrderPdfDataUrl,
  savePhysicianOrderForm,
  type PhysicianOrderCareInformation,
  type PhysicianOrderMedication,
  type PhysicianOrderOperationalFlags,
  type PhysicianOrderStatus
} from "@/lib/services/physician-orders";
import { toEasternISO } from "@/lib/timezone";

function asString(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function asNullableString(formData: FormData, key: string) {
  const value = asString(formData, key);
  return value.length > 0 ? value : null;
}

function asCheckbox(formData: FormData, key: string) {
  return formData.get(key) === "on" || formData.get(key) === "true";
}

function parseSex(value: string) {
  if (value === "M" || value === "F") return value;
  return null;
}

function parseLevelOfCare(value: string) {
  return POF_LEVEL_OF_CARE_OPTIONS.includes(value as (typeof POF_LEVEL_OF_CARE_OPTIONS)[number])
    ? (value as (typeof POF_LEVEL_OF_CARE_OPTIONS)[number])
    : null;
}

function parseStatusFromIntent(intent: string): PhysicianOrderStatus {
  if (intent === "signed") return "Signed";
  if (intent === "completed") return "Completed";
  return "Draft";
}

function splitTextareaLines(value: string | null) {
  return (value ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseMedicationRows(formData: FormData): PhysicianOrderMedication[] {
  const names = formData.getAll("medicationName").map((value) => String(value ?? "").trim());
  const doses = formData.getAll("medicationDose").map((value) => String(value ?? "").trim());
  const routes = formData.getAll("medicationRoute").map((value) => String(value ?? "").trim());
  const frequencies = formData.getAll("medicationFrequency").map((value) => String(value ?? "").trim());

  const max = Math.max(names.length, doses.length, routes.length, frequencies.length);
  const rows: PhysicianOrderMedication[] = [];
  for (let idx = 0; idx < max; idx += 1) {
    const name = names[idx] ?? "";
    if (!name) continue;
    rows.push({
      id: `med-input-${idx + 1}`,
      name,
      dose: doses[idx] ? doses[idx] : null,
      route: routes[idx] ? routes[idx] : null,
      frequency: frequencies[idx] ? frequencies[idx] : null
    });
  }

  return rows;
}

function parseCareInformation(formData: FormData): PhysicianOrderCareInformation {
  const nutritionDiets = formData.getAll("nutritionDiet").map((value) => String(value ?? "").trim()).filter(Boolean);

  return {
    disorientedConstantly: asCheckbox(formData, "disorientedConstantly"),
    disorientedIntermittently: asCheckbox(formData, "disorientedIntermittently"),
    inappropriateBehaviorWanderer: asCheckbox(formData, "inappropriateBehaviorWanderer"),
    inappropriateBehaviorVerbalAggression: asCheckbox(formData, "inappropriateBehaviorVerbalAggression"),
    inappropriateBehaviorAggression: asCheckbox(formData, "inappropriateBehaviorAggression"),
    personalCareBathing: asCheckbox(formData, "personalCareBathing"),
    personalCareFeeding: asCheckbox(formData, "personalCareFeeding"),
    personalCareDressing: asCheckbox(formData, "personalCareDressing"),
    personalCareMedication: asCheckbox(formData, "personalCareMedication"),
    personalCareToileting: asCheckbox(formData, "personalCareToileting"),
    ambulatoryStatus: ((): "Full" | "Semi" | "Non" | null => {
      const value = asString(formData, "ambulatoryStatus");
      if (value === "Full" || value === "Semi" || value === "Non") return value;
      return null;
    })(),
    mobilityIndependent: asCheckbox(formData, "mobilityIndependent"),
    mobilityWalker: asCheckbox(formData, "mobilityWalker"),
    mobilityWheelchair: asCheckbox(formData, "mobilityWheelchair"),
    mobilityScooter: asCheckbox(formData, "mobilityScooter"),
    mobilityOther: asCheckbox(formData, "mobilityOther"),
    mobilityOtherText: asNullableString(formData, "mobilityOtherText"),
    functionalLimitationSight: asCheckbox(formData, "functionalLimitationSight"),
    functionalLimitationHearing: asCheckbox(formData, "functionalLimitationHearing"),
    functionalLimitationSpeech: asCheckbox(formData, "functionalLimitationSpeech"),
    activitiesPassive: asCheckbox(formData, "activitiesPassive"),
    activitiesActive: asCheckbox(formData, "activitiesActive"),
    activitiesGroupParticipation: asCheckbox(formData, "activitiesGroupParticipation"),
    activitiesPrefersAlone: asCheckbox(formData, "activitiesPrefersAlone"),
    neurologicalConvulsionsSeizures: asCheckbox(formData, "neurologicalConvulsionsSeizures"),
    stimulationAfraidLoudNoises: asCheckbox(formData, "stimulationAfraidLoudNoises"),
    stimulationEasilyOverwhelmed: asCheckbox(formData, "stimulationEasilyOverwhelmed"),
    stimulationAdaptsEasily: asCheckbox(formData, "stimulationAdaptsEasily"),
    medAdministrationSelf: asCheckbox(formData, "medAdministrationSelf"),
    medAdministrationNurse: asCheckbox(formData, "medAdministrationNurse"),
    bladderContinent: asCheckbox(formData, "bladderContinent"),
    bladderIncontinent: asCheckbox(formData, "bladderIncontinent"),
    bowelContinent: asCheckbox(formData, "bowelContinent"),
    bowelIncontinent: asCheckbox(formData, "bowelIncontinent"),
    skinNormal: asCheckbox(formData, "skinNormal"),
    skinOther: asNullableString(formData, "skinOther"),
    breathingRoomAir: asCheckbox(formData, "breathingRoomAir"),
    breathingOxygenTank: asCheckbox(formData, "breathingOxygenTank"),
    breathingOxygenLiters: asNullableString(formData, "breathingOxygenLiters"),
    nutritionDiets,
    nutritionDietOther: asNullableString(formData, "nutritionDietOther"),
    joySparksNotes: asNullableString(formData, "joySparksNotes")
  };
}

function parseOperationalFlags(formData: FormData): PhysicianOrderOperationalFlags {
  return {
    nutAllergy: asCheckbox(formData, "flagNutAllergy"),
    shellfishAllergy: asCheckbox(formData, "flagShellfishAllergy"),
    fishAllergy: asCheckbox(formData, "flagFishAllergy"),
    diabeticRestrictedSweets: asCheckbox(formData, "flagDiabeticRestrictedSweets"),
    oxygenRequirement: asCheckbox(formData, "flagOxygenRequirement"),
    dnr: asCheckbox(formData, "flagDnr"),
    noPhotos: asCheckbox(formData, "flagNoPhotos"),
    bathroomAssistance: asCheckbox(formData, "flagBathroomAssistance")
  };
}

function revalidatePofRoutes(memberId: string, pofId?: string | null) {
  revalidatePath("/health");
  revalidatePath("/health/physician-orders");
  if (pofId) {
    revalidatePath(`/health/physician-orders/${pofId}`);
    revalidatePath(`/health/physician-orders/${pofId}/print`);
  }
  revalidatePath(`/operations/member-command-center/${memberId}`);
  revalidatePath(`/health/member-health-profiles/${memberId}`);
  revalidatePath(`/members/${memberId}`);
}

async function savePofPdfToMemberFiles(input: {
  memberId: string;
  memberName: string;
  dataUrl: string;
  uploadedBy: { id: string; name: string };
}) {
  saveGeneratedMemberPdfToFiles({
    memberId: input.memberId,
    memberName: input.memberName,
    documentLabel: "POF",
    documentSource: "Physician Order Form",
    category: "Orders / POF",
    dataUrl: input.dataUrl,
    uploadedBy: {
      id: input.uploadedBy.id,
      name: input.uploadedBy.name
    },
    generatedAtIso: toEasternISO()
  });
}

export async function savePhysicianOrderFormAction(formData: FormData) {
  const profile = await requireRoles(["admin", "nurse"]);
  const memberId = asString(formData, "memberId");
  if (!memberId) throw new Error("Member is required.");

  const saveIntent = asString(formData, "saveIntent");
  const status = parseStatusFromIntent(saveIntent);

  const providerNameFromForm = asNullableString(formData, "providerName");
  const providerNameResolved = providerNameFromForm ?? (status === "Signed" ? profile.full_name : null);
  const providerSignatureDate = asNullableString(formData, "providerSignatureDate");
  const providerSignature = asNullableString(formData, "providerSignature");

  const saved = savePhysicianOrderForm({
    id: asNullableString(formData, "pofId"),
    memberId,
    sex: parseSex(asString(formData, "sex")),
    levelOfCare: parseLevelOfCare(asString(formData, "levelOfCare")),
    dnrSelected: asCheckbox(formData, "dnrSelected"),
    vitalsBloodPressure: asNullableString(formData, "vitalsBloodPressure"),
    vitalsPulse: asNullableString(formData, "vitalsPulse"),
    vitalsOxygenSaturation:
      asNullableString(formData, "vitalsOxygenSaturation") ??
      asNullableString(formData, "vitalsTemperature"),
    vitalsRespiration: asNullableString(formData, "vitalsRespiration"),
    diagnoses: splitTextareaLines(asNullableString(formData, "diagnosesText")),
    allergies: splitTextareaLines(asNullableString(formData, "allergiesText")),
    medications: parseMedicationRows(formData),
    careInformation: parseCareInformation(formData),
    operationalFlags: parseOperationalFlags(formData),
    providerName: providerNameResolved,
    providerSignature,
    providerSignatureDate,
    status,
    actor: {
      id: profile.id,
      fullName: profile.full_name
    }
  });

  syncPhysicianOrderToMemberProfiles({
    memberId: saved.memberId,
    pof: {
      id: saved.id,
      dnrSelected: saved.dnrSelected,
      status: saved.status,
      diagnoses: saved.diagnoses,
      allergies: saved.allergies,
      medications: saved.medications.map((row) => ({
        name: row.name,
        dose: row.dose,
        route: row.route,
        frequency: row.frequency
      })),
      careInformation: {
        nutritionDiets: saved.careInformation.nutritionDiets,
        nutritionDietOther: saved.careInformation.nutritionDietOther,
        medAdministrationSelf: saved.careInformation.medAdministrationSelf,
        medAdministrationNurse: saved.careInformation.medAdministrationNurse,
        personalCareToileting: saved.careInformation.personalCareToileting,
        breathingOxygenTank: saved.careInformation.breathingOxygenTank,
        breathingOxygenLiters: saved.careInformation.breathingOxygenLiters,
        joySparksNotes: saved.careInformation.joySparksNotes
      },
      operationalFlags: {
        nutAllergy: saved.operationalFlags.nutAllergy,
        shellfishAllergy: saved.operationalFlags.shellfishAllergy,
        fishAllergy: saved.operationalFlags.fishAllergy,
        diabeticRestrictedSweets: saved.operationalFlags.diabeticRestrictedSweets,
        oxygenRequirement: saved.operationalFlags.oxygenRequirement,
        dnr: saved.operationalFlags.dnr,
        noPhotos: saved.operationalFlags.noPhotos,
        bathroomAssistance: saved.operationalFlags.bathroomAssistance
      }
    },
    actor: {
      id: profile.id,
      fullName: profile.full_name
    },
    at: saved.updatedAt
  });

  if (status === "Completed" || status === "Signed") {
    const generated = await buildPhysicianOrderPdfDataUrl(saved.id);
    await savePofPdfToMemberFiles({
      memberId: saved.memberId,
      memberName: saved.memberNameSnapshot,
      dataUrl: generated.dataUrl,
      uploadedBy: {
        id: profile.id,
        name: profile.full_name
      }
    });
  }

  revalidatePofRoutes(saved.memberId, saved.id);
  redirect(`/health/physician-orders/${saved.id}`);
}

export async function generatePhysicianOrderPdfAction(input: { pofId: string }) {
  const profile = await getCurrentProfile();
  if (profile.role !== "admin" && profile.role !== "nurse") {
    return { ok: false, error: "You do not have access to generate POF PDFs." } as const;
  }

  const pofId = String(input.pofId ?? "").trim();
  if (!pofId) return { ok: false, error: "POF is required." } as const;

  try {
    const generated = await buildPhysicianOrderPdfDataUrl(pofId);
    await savePofPdfToMemberFiles({
      memberId: generated.form.memberId,
      memberName: generated.form.memberNameSnapshot,
      dataUrl: generated.dataUrl,
      uploadedBy: {
        id: profile.id,
        name: profile.full_name
      }
    });
    revalidatePofRoutes(generated.form.memberId, generated.form.id);
    return {
      ok: true,
      fileName: generated.fileName,
      dataUrl: generated.dataUrl
    } as const;
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to generate POF PDF."
    } as const;
  }
}
