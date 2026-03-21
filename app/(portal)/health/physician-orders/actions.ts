"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getCurrentProfile, requireRoles } from "@/lib/auth";
import { canCreatePhysicianOrdersModuleForRole } from "@/lib/permissions";
import { resolveCanonicalMemberId } from "@/lib/services/canonical-person-ref";
import { saveGeneratedMemberPdfToFiles } from "@/lib/services/member-files";
import {
  getPofRequestSummaryById,
  resendPofSignatureRequest,
  sendNewPofSignatureRequest
} from "@/lib/services/pof-esign";
import { WorkflowDeliveryError } from "@/lib/services/send-workflow-state";
import {
  OTIC_LATERALITY_OPTIONS,
  OPHTHALMIC_LATERALITY_OPTIONS,
  POF_DEFAULT_MEDICATION_FORM,
  POF_DEFAULT_MEDICATION_QUANTITY,
  POF_DEFAULT_MEDICATION_ROUTE,
  POF_LEVEL_OF_CARE_OPTIONS
} from "@/lib/services/physician-order-config";
import { getManagedUserSignoffLabel } from "@/lib/services/user-management";
import {
  buildPhysicianOrderPdfDataUrl,
  savePhysicianOrderForm
} from "@/lib/services/physician-orders-supabase";
import type {
  PhysicianOrderAllergy,
  PhysicianOrderCareInformation,
  PhysicianOrderDiagnosis,
  PhysicianOrderMedication,
  PhysicianOrderOperationalFlags
} from "@/lib/services/physician-order-model";
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

function asNullableBool(formData: FormData, key: string) {
  const normalized = String(formData.get(key) ?? "").trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "true" || normalized === "yes" || normalized === "1") return true;
  if (normalized === "false" || normalized === "no" || normalized === "0") return false;
  return null;
}

function parseOrientationAnswer(value: string | null | undefined): "Yes" | "No" | null {
  const normalized = (value ?? "").trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "yes" || normalized === "true" || normalized === "1") return "Yes";
  if (normalized === "no" || normalized === "false" || normalized === "0") return "No";
  return null;
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

function isNextRedirectError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const digest = String((error as { digest?: string }).digest ?? "");
  return digest.startsWith("NEXT_REDIRECT");
}

function parseMedicationRows(formData: FormData): PhysicianOrderMedication[] {
  const names = formData.getAll("medicationName").map((value) => String(value ?? "").trim());
  const doses = formData.getAll("medicationDose").map((value) => String(value ?? "").trim());
  const quantities = formData.getAll("medicationQuantity").map((value) => String(value ?? "").trim());
  const forms = formData.getAll("medicationForm").map((value) => String(value ?? "").trim());
  const routes = formData.getAll("medicationRoute").map((value) => String(value ?? "").trim());
  const routeLateralities = formData.getAll("medicationRouteLaterality").map((value) => String(value ?? "").trim());
  const frequencies = formData.getAll("medicationFrequency").map((value) => String(value ?? "").trim());
  const givenAtCenterValues = formData.getAll("medicationGivenAtCenter").map((value) => String(value ?? "").trim());
  const givenAtCenterTimes = formData.getAll("medicationGivenAtCenterTime24h").map((value) => String(value ?? "").trim());
  const comments = formData.getAll("medicationComments").map((value) => String(value ?? "").trim());
  const strengths = formData.getAll("medicationStrength").map((value) => String(value ?? "").trim());
  const scheduledTimesValues = formData.getAll("medicationScheduledTimes").map((value) => String(value ?? "").trim());
  const prnValues = formData.getAll("medicationPrn").map((value) => String(value ?? "").trim());
  const prnInstructionsValues = formData.getAll("medicationPrnInstructions").map((value) => String(value ?? "").trim());
  const startDateValues = formData.getAll("medicationStartDate").map((value) => String(value ?? "").trim());
  const endDateValues = formData.getAll("medicationEndDate").map((value) => String(value ?? "").trim());
  const activeValues = formData.getAll("medicationActive").map((value) => String(value ?? "").trim());
  const providerValues = formData.getAll("medicationProvider").map((value) => String(value ?? "").trim());
  const instructionsValues = formData.getAll("medicationInstructions").map((value) => String(value ?? "").trim());

  const max = Math.max(
    names.length,
    doses.length,
    quantities.length,
    forms.length,
    routes.length,
    routeLateralities.length,
    frequencies.length,
    givenAtCenterValues.length,
    givenAtCenterTimes.length,
    comments.length,
    strengths.length,
    scheduledTimesValues.length,
    prnValues.length,
    prnInstructionsValues.length,
    startDateValues.length,
    endDateValues.length,
    activeValues.length,
    providerValues.length,
    instructionsValues.length
  );
  const rows: PhysicianOrderMedication[] = [];
  for (let idx = 0; idx < max; idx += 1) {
    const name = names[idx] ?? "";
    if (!name) continue;
    const route = routes[idx] ? routes[idx] : POF_DEFAULT_MEDICATION_ROUTE;
    const normalizedRoute = route.trim().toLowerCase();
    const laterality = routeLateralities[idx] ? routeLateralities[idx] : null;
    const validLaterality =
      normalizedRoute === "ophthalmic"
        ? laterality && OPHTHALMIC_LATERALITY_OPTIONS.includes(laterality as (typeof OPHTHALMIC_LATERALITY_OPTIONS)[number])
          ? laterality
          : null
        : normalizedRoute === "otic"
          ? laterality && OTIC_LATERALITY_OPTIONS.includes(laterality as (typeof OTIC_LATERALITY_OPTIONS)[number])
            ? laterality
            : null
          : null;
    const givenAtCenter = givenAtCenterValues[idx] === "true";
    const rawGivenAtCenterTime = givenAtCenterTimes[idx] ?? "";
    const givenAtCenterTime24h = givenAtCenter && /^\d{2}:\d{2}$/.test(rawGivenAtCenterTime) ? rawGivenAtCenterTime : null;
    const frequency = frequencies[idx] ? frequencies[idx] : null;
    const fallbackScheduledTimes =
      givenAtCenterTime24h && /^\d{2}:\d{2}$/.test(givenAtCenterTime24h) ? [givenAtCenterTime24h] : [];
    const scheduledTimesFromInput = (scheduledTimesValues[idx] ?? "")
      .split(/[;,]/g)
      .map((value) => value.trim())
      .filter((value) => /^\d{2}:\d{2}$/.test(value));
    const scheduledTimes = Array.from(new Set(scheduledTimesFromInput.length > 0 ? scheduledTimesFromInput : fallbackScheduledTimes));
    const inferredPrnFromFrequency = /(^|\b)prn(\b|$)/i.test(frequency ?? "");
    const prn = prnValues[idx] === "true" || inferredPrnFromFrequency;
    const activeRaw = activeValues[idx];
    const active = activeRaw === "" ? true : activeRaw !== "false";
    rows.push({
      id: `med-input-${idx + 1}`,
      name,
      strength: strengths[idx] ? strengths[idx] : quantities[idx] ? quantities[idx] : null,
      dose: doses[idx] ? doses[idx] : null,
      quantity: quantities[idx] ? quantities[idx] : POF_DEFAULT_MEDICATION_QUANTITY,
      form: forms[idx] ? forms[idx] : POF_DEFAULT_MEDICATION_FORM,
      route,
      routeLaterality: validLaterality,
      frequency,
      scheduledTimes,
      givenAtCenter,
      givenAtCenterTime24h,
      prn,
      prnInstructions: prnInstructionsValues[idx] ? prnInstructionsValues[idx] : null,
      startDate: /^\d{4}-\d{2}-\d{2}$/.test(startDateValues[idx] ?? "") ? (startDateValues[idx] as string) : null,
      endDate: /^\d{4}-\d{2}-\d{2}$/.test(endDateValues[idx] ?? "") ? (endDateValues[idx] as string) : null,
      active,
      provider: providerValues[idx] ? providerValues[idx] : null,
      instructions: instructionsValues[idx] ? instructionsValues[idx] : comments[idx] ? comments[idx] : null,
      comments: comments[idx] ? comments[idx] : null
    });
  }

  return rows;
}

function parseDiagnosisRows(formData: FormData): PhysicianOrderDiagnosis[] {
  const types = formData.getAll("diagnosisType").map((value) => String(value ?? "").trim());
  const names = formData.getAll("diagnosisName").map((value) => String(value ?? "").trim());
  const max = Math.max(types.length, names.length);
  const rows: PhysicianOrderDiagnosis[] = [];
  for (let idx = 0; idx < max; idx += 1) {
    const diagnosisName = names[idx] ?? "";
    if (!diagnosisName) continue;
    const diagnosisType = idx === 0 || types[idx] === "primary" ? "primary" : "secondary";
    rows.push({
      id: `diagnosis-input-${idx + 1}`,
      diagnosisType,
      diagnosisName,
      diagnosisCode: null
    });
  }
  return rows;
}

function parseAllergyRows(formData: FormData): PhysicianOrderAllergy[] {
  const groups = formData.getAll("allergyGroup").map((value) => String(value ?? "").trim());
  const names = formData.getAll("allergyName").map((value) => String(value ?? "").trim());
  const severities = formData.getAll("allergySeverity").map((value) => String(value ?? "").trim());
  const comments = formData.getAll("allergyComments").map((value) => String(value ?? "").trim());
  const max = Math.max(groups.length, names.length, severities.length, comments.length);
  const rows: PhysicianOrderAllergy[] = [];

  for (let idx = 0; idx < max; idx += 1) {
    const allergyName = names[idx] ?? "";
    if (!allergyName) continue;
    const allergyGroupRaw = groups[idx];
    const allergyGroup =
      allergyGroupRaw === "food" || allergyGroupRaw === "medication" || allergyGroupRaw === "environmental" || allergyGroupRaw === "other"
        ? allergyGroupRaw
        : "medication";
    rows.push({
      id: `allergy-input-${idx + 1}`,
      allergyGroup,
      allergyName,
      severity: severities[idx] ? severities[idx] : null,
      comments: comments[idx] ? comments[idx] : null
    });
  }
  return rows;
}

function parseStandingOrders(formData: FormData) {
  return formData
    .getAll("standingOrder")
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
}

function parseCareInformation(formData: FormData): PhysicianOrderCareInformation {
  const nutritionDietsRaw = formData.getAll("nutritionDiet").map((value) => String(value ?? "").trim()).filter(Boolean);
  const uniqueNutritionDiets = Array.from(new Set(nutritionDietsRaw));
  const nutritionDietsFiltered =
    uniqueNutritionDiets.some((value) => value !== "Regular")
      ? uniqueNutritionDiets.filter((value) => value !== "Regular")
      : uniqueNutritionDiets;
  const nutritionDiets = nutritionDietsFiltered.length > 0 ? nutritionDietsFiltered : ["Regular"];
  const mobilityOther = asCheckbox(formData, "mobilityOther");

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
    mobilityOther,
    mobilityOtherText: mobilityOther ? asNullableString(formData, "mobilityOtherText") : null,
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
    joySparksNotes: asNullableString(formData, "joySparksNotes"),
    adlProfile: {
      ambulation: asNullableString(formData, "adlAmbulation"),
      transferring: asNullableString(formData, "adlTransferring"),
      bathing: asNullableString(formData, "adlBathing"),
      dressing: asNullableString(formData, "adlDressing"),
      eating: asNullableString(formData, "adlEating"),
      bladderContinence: asNullableString(formData, "adlBladderContinence"),
      bowelContinence: asNullableString(formData, "adlBowelContinence"),
      toileting: asNullableString(formData, "adlToileting"),
      toiletingNeeds: asNullableString(formData, "adlToiletingNeeds"),
      toiletingComments: asNullableString(formData, "adlToiletingComments"),
      hearing: asNullableString(formData, "adlHearing"),
      vision: asNullableString(formData, "adlVision"),
      dental: asNullableString(formData, "adlDental"),
      speechVerbalStatus: asNullableString(formData, "adlSpeechVerbalStatus"),
      speechComments: asNullableString(formData, "adlSpeechComments"),
      hygieneGrooming: asNullableString(formData, "adlHygieneGrooming"),
      maySelfMedicate: asNullableBool(formData, "adlMaySelfMedicate"),
      medicationManagerName: asNullableString(formData, "adlMedicationManagerName")
    },
    orientationProfile: {
      orientationDob: parseOrientationAnswer(asNullableString(formData, "orientationDob")),
      orientationCity: parseOrientationAnswer(asNullableString(formData, "orientationCity")),
      orientationCurrentYear: parseOrientationAnswer(asNullableString(formData, "orientationCurrentYear")),
      orientationFormerOccupation: parseOrientationAnswer(asNullableString(formData, "orientationFormerOccupation")),
      disorientation: asNullableBool(formData, "orientationDisorientation"),
      memoryImpairment: asNullableString(formData, "orientationMemoryImpairment"),
      memorySeverity: asNullableString(formData, "orientationMemorySeverity"),
      cognitiveBehaviorComments: asNullableString(formData, "orientationComments")
    }
  };
}

function parseOperationalFlags(formData: FormData): PhysicianOrderOperationalFlags {
  const toiletingAssistance = asString(formData, "adlToileting").toLowerCase();
  const toiletingNeeds = asString(formData, "adlToiletingNeeds").toLowerCase();
  const derivedBathroomAssistance = toiletingAssistance === "yes" || toiletingNeeds === "needs assistance";

  return {
    nutAllergy: asCheckbox(formData, "flagNutAllergy"),
    shellfishAllergy: asCheckbox(formData, "flagShellfishAllergy"),
    fishAllergy: asCheckbox(formData, "flagFishAllergy"),
    diabeticRestrictedSweets: asCheckbox(formData, "flagDiabeticRestrictedSweets"),
    oxygenRequirement: asCheckbox(formData, "flagOxygenRequirement"),
    dnr: asCheckbox(formData, "flagDnr"),
    noPhotos: asCheckbox(formData, "flagNoPhotos"),
    bathroomAssistance: asCheckbox(formData, "flagBathroomAssistance") || derivedBathroomAssistance
  };
}

function revalidatePofRoutes(memberId: string, pofId?: string | null) {
  revalidatePath("/health");
  revalidatePath("/health/mar");
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
  await saveGeneratedMemberPdfToFiles({
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

async function resolvePofMemberId(rawMemberId: string, actionLabel: string) {
  return resolveCanonicalMemberId(rawMemberId, { actionLabel });
}

function clean(value: string | null | undefined) {
  const normalized = (value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

async function resolveRequestAppBaseUrl() {
  const headerMap = await headers();
  const origin = clean(headerMap.get("origin"));
  if (origin) return origin;

  const forwardedHost = clean(headerMap.get("x-forwarded-host"));
  const host = forwardedHost ?? clean(headerMap.get("host"));
  if (!host) return null;
  const forwardedProto = clean(headerMap.get("x-forwarded-proto"));
  const proto =
    forwardedProto?.split(",")[0]?.trim() ??
    (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  return `${proto}://${host}`;
}

async function persistPhysicianOrderDraftFromFormData(formData: FormData, actionLabel: string) {
  const rawMemberId = asString(formData, "memberId");
  if (!rawMemberId) throw new Error("Member is required.");
  const pofId = asNullableString(formData, "pofId");
  const memberId = await resolvePofMemberId(rawMemberId, actionLabel);

  const profile = await requireRoles(["admin", "nurse"]);
  const actorDisplayName = await getManagedUserSignoffLabel(profile.id, profile.full_name);

  const providerNameFromForm = asNullableString(formData, "providerName");
  const providerNameResolved = providerNameFromForm ?? actorDisplayName;
  const diagnosisRows = parseDiagnosisRows(formData);
  const allergyRows = parseAllergyRows(formData);
  const standingOrders = parseStandingOrders(formData);

  const saved = await savePhysicianOrderForm({
    id: pofId,
    memberId,
    intakeAssessmentId: asNullableString(formData, "intakeAssessmentId"),
    memberDobSnapshot: asNullableString(formData, "memberDob"),
    sex: parseSex(asString(formData, "sex")),
    levelOfCare: parseLevelOfCare(asString(formData, "levelOfCare")),
    dnrSelected: asCheckbox(formData, "dnrSelected"),
    vitalsBloodPressure: asNullableString(formData, "vitalsBloodPressure"),
    vitalsPulse: asNullableString(formData, "vitalsPulse"),
    vitalsOxygenSaturation:
      asNullableString(formData, "vitalsOxygenSaturation") ??
      asNullableString(formData, "vitalsTemperature"),
    vitalsRespiration: asNullableString(formData, "vitalsRespiration"),
    diagnosisRows,
    diagnoses: diagnosisRows.map((row) => row.diagnosisName),
    allergyRows,
    allergies: allergyRows.map((row) => row.allergyName),
    medications: parseMedicationRows(formData),
    standingOrders,
    careInformation: parseCareInformation(formData),
    operationalFlags: parseOperationalFlags(formData),
    providerName: providerNameResolved,
    providerSignature: null,
    providerSignatureDate: null,
    status: "Draft",
    actor: {
      id: profile.id,
      fullName: actorDisplayName
    }
  });

  return { saved, profile, actorDisplayName, rawMemberId, pofId } as const;
}

export async function savePhysicianOrderFormAction(formData: FormData) {
  const rawMemberId = asString(formData, "memberId");
  const pofId = asNullableString(formData, "pofId");

  const redirectToFormWithError = (message: string) => {
    const params = new URLSearchParams();
    if (rawMemberId) params.set("memberId", rawMemberId);
    if (pofId) params.set("pofId", pofId);
    params.set("saveError", message.slice(0, 280));
    redirect(`/health/physician-orders/new?${params.toString()}`);
  };

  if (!rawMemberId) {
    redirectToFormWithError("Member is required.");
  }

  let destinationUrl = `/health/physician-orders/new?memberId=${encodeURIComponent(rawMemberId)}`;

  try {
    const { saved } = await persistPhysicianOrderDraftFromFormData(formData, "savePhysicianOrderFormAction");

    revalidatePofRoutes(saved.memberId, saved.id);
    destinationUrl = `/health/physician-orders/${saved.id}`;
  } catch (error) {
    if (isNextRedirectError(error)) {
      throw error;
    }
    const message = error instanceof Error ? error.message : "Unable to save physician order.";
    redirectToFormWithError(message);
  }

  redirect(destinationUrl);
}

export async function saveAndDispatchPofSignatureRequestFromEditorAction(formData: FormData) {
  try {
    const { saved, profile, actorDisplayName } = await persistPhysicianOrderDraftFromFormData(
      formData,
      "saveAndDispatchPofSignatureRequestFromEditorAction"
    );

    const mode = asString(formData, "esignDispatchMode");
    const providerName = asString(formData, "providerName") || saved.providerName || actorDisplayName;
    const providerEmail = asString(formData, "esignProviderEmail");
    const nurseName = asString(formData, "esignNurseName") || profile.full_name;
    const fromEmail = asString(formData, "esignFromEmail");
    const optionalMessage = asNullableString(formData, "esignOptionalMessage");
    const expiresOnDate = asString(formData, "esignExpiresOnDate");

    if (!providerEmail) return { ok: false, error: "Provider Email is required." } as const;
    if (!nurseName.trim()) return { ok: false, error: "Nurse Name is required." } as const;
    if (!fromEmail) return { ok: false, error: "From Email is required." } as const;
    if (!expiresOnDate) return { ok: false, error: "Expiration Date is required." } as const;

    if (mode === "resend") {
      const requestId = asString(formData, "esignRequestId");
      if (!requestId) return { ok: false, error: "Request ID is required for resend." } as const;
      const request = await resendPofSignatureRequest({
        requestId,
        memberId: saved.memberId,
        providerName,
        providerEmail,
        nurseName,
        fromEmail,
        appBaseUrl: await resolveRequestAppBaseUrl(),
        optionalMessage,
        expiresOnDate,
        actor: {
          id: profile.id,
          fullName: actorDisplayName
        }
      });
      revalidatePofRoutes(saved.memberId, saved.id);
      return {
        ok: true,
        pofId: saved.id,
        request
      } as const;
    } else {
      const request = await sendNewPofSignatureRequest({
        memberId: saved.memberId,
        physicianOrderId: saved.id,
        providerName,
        providerEmail,
        nurseName,
        fromEmail,
        appBaseUrl: await resolveRequestAppBaseUrl(),
        optionalMessage,
        expiresOnDate,
        actor: {
          id: profile.id,
          fullName: actorDisplayName
        }
      });
      revalidatePofRoutes(saved.memberId, saved.id);
      return {
        ok: true,
        pofId: saved.id,
        request
      } as const;
    }
  } catch (error) {
    if (error instanceof WorkflowDeliveryError) {
      return {
        ok: false,
        error: error.message,
        code: error.code,
        retryable: error.retryable,
        requestId: error.requestId,
        requestUrl: error.requestUrl,
        deliveryStatus: error.deliveryStatus,
        request: error.requestId ? await getPofRequestSummaryById(error.requestId) : null
      } as const;
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to save and send POF signature request."
    } as const;
  }
}

export async function generatePhysicianOrderPdfAction(input: { pofId: string; persistToMemberFiles?: boolean }) {
  const profile = await getCurrentProfile();
  const actorDisplayName = await getManagedUserSignoffLabel(profile.id, profile.full_name);
  const persistToMemberFiles = input.persistToMemberFiles !== false;
  if (!canCreatePhysicianOrdersModuleForRole(profile.role)) {
    return { ok: false, error: "You do not have access to generate POF PDFs." } as const;
  }

  const pofId = String(input.pofId ?? "").trim();
  if (!pofId) return { ok: false, error: "POF is required." } as const;

  try {
    const generated = await buildPhysicianOrderPdfDataUrl(pofId);
    if (persistToMemberFiles) {
      await savePofPdfToMemberFiles({
        memberId: generated.form.memberId,
        memberName: generated.form.memberNameSnapshot,
        dataUrl: generated.dataUrl,
        uploadedBy: {
          id: profile.id,
          name: actorDisplayName
        }
      });
      revalidatePofRoutes(generated.form.memberId, generated.form.id);
    }
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

