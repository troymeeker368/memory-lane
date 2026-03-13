import type { PhysicianOrderForm } from "@/lib/services/physician-orders-supabase";

export type PofDocumentRow = {
  label: string;
  value: string;
};

export type PofDocumentSection = {
  title: string;
  rows: PofDocumentRow[];
};

function valueOrDash(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : "-";
}

function yesNo(value: boolean | null | undefined) {
  if (value == null) return "-";
  return value ? "Yes" : "No";
}

function selectedList(entries: Array<{ label: string; value: boolean }>) {
  const selected = entries.filter((entry) => entry.value).map((entry) => entry.label);
  return selected.length > 0 ? selected.join(", ") : "-";
}

function joinedOrDash(values: string[] | null | undefined) {
  const normalized = (values ?? []).map((value) => value.trim()).filter(Boolean);
  return normalized.length > 0 ? normalized.join(", ") : "-";
}

function normalizeNutritionDiets(values: string[] | null | undefined) {
  const normalized = (values ?? []).map((value) => value.trim()).filter(Boolean);
  const hasNonRegular = normalized.some((value) => value.toLowerCase() !== "regular");
  if (!hasNonRegular) return normalized;
  return normalized.filter((value) => value.toLowerCase() !== "regular");
}

export function buildPofDocumentSections(form: PhysicianOrderForm): PofDocumentSection[] {
  const care = form.careInformation;
  const adl = care.adlProfile;
  const orientation = care.orientationProfile;

  return [
    {
      title: "Identification / Medical Orders",
      rows: [
        { label: "Member", value: valueOrDash(form.memberNameSnapshot) },
        { label: "DOB", value: valueOrDash(form.memberDobSnapshot) },
        { label: "Sex", value: valueOrDash(form.sex) },
        { label: "Level of Care", value: valueOrDash(form.levelOfCare) },
        { label: "DNR Selected", value: yesNo(form.dnrSelected) },
        { label: "Status", value: valueOrDash(form.status) },
        { label: "Provider Signature Status", value: valueOrDash(form.providerSignatureStatus) },
        { label: "Sent Date", value: valueOrDash(form.completedDate) },
        { label: "Next Renewal Due", value: valueOrDash(form.nextRenewalDueDate) },
        { label: "BP", value: valueOrDash(form.vitalsBloodPressure) },
        { label: "Pulse", value: valueOrDash(form.vitalsPulse) },
        { label: "O2 %", value: valueOrDash(form.vitalsOxygenSaturation) },
        { label: "Respiration", value: valueOrDash(form.vitalsRespiration) }
      ]
    },
    {
      title: "Diagnoses",
      rows:
        form.diagnosisRows.length > 0
          ? form.diagnosisRows.flatMap((row, index) => [
              { label: `Diagnosis ${index + 1} Type`, value: valueOrDash(row.diagnosisType) },
              { label: `Diagnosis ${index + 1} Name`, value: valueOrDash(row.diagnosisName) }
            ])
          : [{ label: "Diagnoses", value: "-" }]
    },
    {
      title: "Allergies",
      rows:
        form.allergyRows.length > 0
          ? form.allergyRows.flatMap((row, index) => [
              { label: `Allergy ${index + 1} Group`, value: valueOrDash(row.allergyGroup) },
              { label: `Allergy ${index + 1} Name`, value: valueOrDash(row.allergyName) },
              { label: `Allergy ${index + 1} Severity`, value: valueOrDash(row.severity) },
              { label: `Allergy ${index + 1} Comments`, value: valueOrDash(row.comments) }
            ])
          : [{ label: "Allergies", value: "-" }]
    },
    {
      title: "Medications",
      rows:
        form.medications.length > 0
          ? form.medications.flatMap((row, index) => [
              { label: `Medication ${index + 1} Name`, value: valueOrDash(row.name) },
              { label: `Medication ${index + 1} Dose`, value: valueOrDash(row.dose) },
              { label: `Medication ${index + 1} Quantity`, value: valueOrDash(row.quantity) },
              { label: `Medication ${index + 1} Form`, value: valueOrDash(row.form) },
              {
                label: `Medication ${index + 1} Route`,
                value: row.routeLaterality ? `${valueOrDash(row.route)} (${row.routeLaterality})` : valueOrDash(row.route)
              },
              { label: `Medication ${index + 1} Frequency`, value: valueOrDash(row.frequency) },
              { label: `Medication ${index + 1} Given at Center`, value: row.givenAtCenter ? "Yes" : "No" },
              { label: `Medication ${index + 1} Given Time (24h)`, value: valueOrDash(row.givenAtCenterTime24h) },
              { label: `Medication ${index + 1} Comments`, value: valueOrDash(row.comments) }
            ])
          : [{ label: "Medications", value: "-" }]
    },
    {
      title: "Standing Orders",
      rows: [{ label: "Standing Orders", value: joinedOrDash(form.standingOrders) }]
    },
    {
      title: "Behavior & Orientation",
      rows: [
        { label: "Disoriented Constantly", value: yesNo(care.disorientedConstantly) },
        { label: "Disoriented Intermittently", value: yesNo(care.disorientedIntermittently) },
        { label: "Inappropriate Behavior - Wanderer", value: yesNo(care.inappropriateBehaviorWanderer) },
        { label: "Inappropriate Behavior - Verbal Aggression", value: yesNo(care.inappropriateBehaviorVerbalAggression) },
        { label: "Inappropriate Behavior - Aggression", value: yesNo(care.inappropriateBehaviorAggression) },
        { label: "Activities / Social", value: selectedList([{ label: "Passive", value: care.activitiesPassive }, { label: "Active", value: care.activitiesActive }, { label: "Group Participation", value: care.activitiesGroupParticipation }, { label: "Prefers Alone", value: care.activitiesPrefersAlone }]) },
        { label: "Stimulation", value: selectedList([{ label: "Afraid Loud Noises", value: care.stimulationAfraidLoudNoises }, { label: "Easily Overwhelmed", value: care.stimulationEasilyOverwhelmed }, { label: "Adapts Easily", value: care.stimulationAdaptsEasily }]) },
        { label: "Orientation DOB", value: valueOrDash(orientation.orientationDob) },
        { label: "Orientation City", value: valueOrDash(orientation.orientationCity) },
        { label: "Orientation Current Year", value: valueOrDash(orientation.orientationCurrentYear) },
        { label: "Orientation Former Occupation", value: valueOrDash(orientation.orientationFormerOccupation) },
        { label: "Disorientation", value: yesNo(orientation.disorientation) },
        { label: "Memory Impairment", value: valueOrDash(orientation.memoryImpairment) },
        { label: "Memory Severity", value: valueOrDash(orientation.memorySeverity) },
        { label: "Cognitive / Behavior Comments", value: valueOrDash(orientation.cognitiveBehaviorComments) }
      ]
    },
    {
      title: "ADLs & Mobility",
      rows: [
        { label: "Personal Care - Bathing", value: yesNo(care.personalCareBathing) },
        { label: "Personal Care - Feeding", value: yesNo(care.personalCareFeeding) },
        { label: "Personal Care - Dressing", value: yesNo(care.personalCareDressing) },
        { label: "Personal Care - Medication", value: yesNo(care.personalCareMedication) },
        { label: "Personal Care - Toileting", value: yesNo(care.personalCareToileting) },
        { label: "Ambulatory Status", value: valueOrDash(care.ambulatoryStatus) },
        { label: "Mobility - Independent", value: yesNo(care.mobilityIndependent) },
        { label: "Mobility - Walker", value: yesNo(care.mobilityWalker) },
        { label: "Mobility - Wheelchair", value: yesNo(care.mobilityWheelchair) },
        { label: "Mobility - Scooter", value: yesNo(care.mobilityScooter) },
        { label: "Mobility - Other", value: yesNo(care.mobilityOther) },
        ...(care.mobilityOther
          ? [{ label: "Mobility Other Detail", value: valueOrDash(care.mobilityOtherText) }]
          : []),
        { label: "Functional Limitation - Sight", value: yesNo(care.functionalLimitationSight) },
        { label: "Functional Limitation - Hearing", value: yesNo(care.functionalLimitationHearing) },
        { label: "Functional Limitation - Speech", value: yesNo(care.functionalLimitationSpeech) },
        { label: "ADL Ambulation", value: valueOrDash(adl.ambulation) },
        { label: "ADL Transferring", value: valueOrDash(adl.transferring) },
        { label: "ADL Bathing", value: valueOrDash(adl.bathing) },
        { label: "ADL Dressing", value: valueOrDash(adl.dressing) },
        { label: "ADL Eating", value: valueOrDash(adl.eating) },
        { label: "ADL Bladder Continence", value: valueOrDash(adl.bladderContinence) },
        { label: "ADL Bowel Continence", value: valueOrDash(adl.bowelContinence) },
        { label: "ADL Toileting", value: valueOrDash(adl.toileting) },
        { label: "ADL Toileting Needs", value: valueOrDash(adl.toiletingNeeds) },
        { label: "ADL Toileting Comments", value: valueOrDash(adl.toiletingComments) },
        { label: "ADL Hearing", value: valueOrDash(adl.hearing) },
        { label: "ADL Vision", value: valueOrDash(adl.vision) },
        { label: "ADL Dental", value: valueOrDash(adl.dental) },
        { label: "ADL Speech / Verbal Status", value: valueOrDash(adl.speechVerbalStatus) },
        { label: "ADL Speech Comments", value: valueOrDash(adl.speechComments) },
        { label: "ADL Hygiene / Grooming", value: valueOrDash(adl.hygieneGrooming) },
        { label: "ADL May Self-Medicate", value: yesNo(adl.maySelfMedicate) }
      ]
    },
    {
      title: "Clinical Support",
      rows: [
        { label: "Breathing - Room Air", value: yesNo(care.breathingRoomAir) },
        { label: "Breathing - O2 Needs", value: yesNo(care.breathingOxygenTank) },
        ...(care.breathingOxygenTank
          ? [{ label: "Breathing O2 Liters", value: valueOrDash(care.breathingOxygenLiters) }]
          : [])
      ]
    },
    {
      title: "Nutrition & Joy Sparks",
      rows: [
        { label: "Nutrition / Diet", value: joinedOrDash(normalizeNutritionDiets(care.nutritionDiets)) },
        { label: "Nutrition Diet Other", value: valueOrDash(care.nutritionDietOther) },
        { label: "Additional Information to Help Spark Joy", value: valueOrDash(care.joySparksNotes) }
      ]
    }
  ];
}
