import type {
  PhysicianOrderForm,
  PhysicianOrderMedication
} from "@/lib/services/physician-orders-supabase";

export type PofDocumentRow = {
  label: string;
  value: string;
  fieldKey?: string;
  alwaysShow?: boolean;
};

export type PofDocumentTableColumn = {
  key: string;
  label: string;
  widthWeight?: number;
};

export type PofDocumentTableRow = {
  id: string;
  cells: Record<string, string>;
};

type PofDocumentSectionBase = {
  title: string;
  sectionKey?: string;
  alwaysShow?: boolean;
};

export type PofDocumentFieldSection = PofDocumentSectionBase & {
  layout: "fields";
  rows: PofDocumentRow[];
};

export type PofDocumentTableSection = PofDocumentSectionBase & {
  layout: "table";
  columns: PofDocumentTableColumn[];
  rows: PofDocumentTableRow[];
};

export type PofDocumentSection = PofDocumentFieldSection | PofDocumentTableSection;

export type PofDocumentFilterConfig = {
  hideNonMeaningfulValues?: boolean;
  nonMeaningfulValues?: string[];
  alwaysShowFields?: string[];
  alwaysShowSections?: string[];
};

const DEFAULT_NON_MEANINGFUL_VALUES = ["", "-", "no", "n/a", "na", "none"];

function clean(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function valueOrDash(value: string | null | undefined) {
  return clean(value) ?? "-";
}

function tableCellOrDash(value: string | null | undefined) {
  return clean(value) ?? "-";
}

function yesNo(value: boolean | null | undefined) {
  if (value == null) return "-";
  return value ? "Yes" : "No";
}

function selectedList(entries: Array<{ label: string; value: boolean }>) {
  const selected = entries.filter((entry) => entry.value).map((entry) => entry.label);
  return selected.length > 0 ? selected.join(", ") : "-";
}

function normalizeNutritionDiets(values: string[] | null | undefined) {
  const normalized = (values ?? []).map((value) => value.trim()).filter(Boolean);
  const hasNonRegular = normalized.some((value) => value.toLowerCase() !== "regular");
  if (!hasNonRegular) return normalized;
  return normalized.filter((value) => value.toLowerCase() !== "regular");
}

function normalizedToken(value: string) {
  return value.trim().toLowerCase();
}

function rowIdentity(section: PofDocumentFieldSection, row: PofDocumentRow) {
  return `${section.sectionKey ?? section.title}::${row.fieldKey ?? row.label}`;
}

function isMeaningfulTableCell(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return false;
  return normalized !== "-";
}

function joinPresent(values: Array<string | null | undefined>, separator = "; ") {
  const normalized = values.map((value) => clean(value)).filter((value): value is string => Boolean(value));
  return normalized.length > 0 ? normalized.join(separator) : null;
}

function titleCase(value: string | null | undefined) {
  const normalized = clean(value);
  if (!normalized) return "-";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function formatMedicationDose(row: PhysicianOrderMedication) {
  return tableCellOrDash(joinPresent([row.dose, row.quantity, row.strength, row.form], " "));
}

function formatMedicationRoute(row: PhysicianOrderMedication) {
  const route = clean(row.route);
  const laterality = clean(row.routeLaterality);
  if (!route && !laterality) return "-";
  if (!laterality) return route!;
  if (!route) return laterality;
  return `${route} (${laterality})`;
}

function formatMedicationFrequency(row: PhysicianOrderMedication) {
  const schedule = (row.scheduledTimes ?? []).map((value) => clean(value)).filter((value): value is string => Boolean(value));
  const parts: string[] = [];
  const frequency = clean(row.frequency);
  if (frequency) parts.push(frequency);
  if (schedule.length > 0) parts.push(`Times: ${schedule.join(", ")}`);
  if (row.prn) parts.push("PRN");
  return parts.length > 0 ? parts.join(" | ") : "-";
}

function formatMedicationNotes(row: PhysicianOrderMedication) {
  return tableCellOrDash(
    joinPresent(
      [
        row.instructions ? `Instructions: ${row.instructions}` : null,
        row.comments ? `Notes: ${row.comments}` : null,
        row.prnInstructions ? `PRN Instructions: ${row.prnInstructions}` : null,
        row.givenAtCenter ? `Administered at center${clean(row.givenAtCenterTime24h) ? ` (${row.givenAtCenterTime24h})` : ""}` : null,
        row.startDate ? `Start: ${row.startDate}` : null,
        row.endDate ? `End: ${row.endDate}` : null,
        row.provider ? `Ordering Provider: ${row.provider}` : null
      ],
      "; "
    )
  );
}

export function isMeaningfulDocumentValue(
  value: string | null | undefined,
  config?: { nonMeaningfulValues?: string[] }
) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return false;
  const blocked = new Set(
    [...DEFAULT_NON_MEANINGFUL_VALUES, ...(config?.nonMeaningfulValues ?? [])].map((entry) => normalizedToken(entry))
  );
  return !blocked.has(normalizedToken(normalized));
}

export function filterPofDocumentSections(sections: PofDocumentSection[], config?: PofDocumentFilterConfig) {
  if (config?.hideNonMeaningfulValues === false) return sections;

  const alwaysShowFields = new Set((config?.alwaysShowFields ?? []).map((entry) => normalizedToken(entry)));
  const alwaysShowSections = new Set((config?.alwaysShowSections ?? []).map((entry) => normalizedToken(entry)));

  const isSectionAlwaysShown = (section: PofDocumentSection) =>
    section.alwaysShow ||
    alwaysShowSections.has(normalizedToken(section.title)) ||
    (section.sectionKey ? alwaysShowSections.has(normalizedToken(section.sectionKey)) : false);

  return sections.flatMap((section) => {
    if (isSectionAlwaysShown(section)) return [section];

    if (section.layout === "table") {
      const rows = section.rows.filter((row) =>
        section.columns.some((column) => isMeaningfulTableCell(row.cells[column.key]))
      );
      if (rows.length === 0) return [];
      return [{ ...section, rows }];
    }

    const rows = section.rows.filter((row) => {
      if (row.alwaysShow) return true;
      const identity = rowIdentity(section, row);
      if (alwaysShowFields.has(normalizedToken(identity))) return true;
      if (alwaysShowFields.has(normalizedToken(row.label))) return true;
      if (row.fieldKey && alwaysShowFields.has(normalizedToken(row.fieldKey))) return true;
      return isMeaningfulDocumentValue(row.value, { nonMeaningfulValues: config?.nonMeaningfulValues });
    });

    if (rows.length === 0) return [];
    return [{ ...section, rows }];
  });
}

export function buildPofDocumentSections(form: PhysicianOrderForm, config?: PofDocumentFilterConfig): PofDocumentSection[] {
  const care = form.careInformation;
  const adl = care.adlProfile;
  const orientation = care.orientationProfile;

  const diagnosisRows: PofDocumentTableRow[] = form.diagnosisRows.map((row, index) => ({
    id: clean(row.id) ?? `diagnosis-${index + 1}`,
    cells: {
      type: titleCase(row.diagnosisType),
      diagnosis: tableCellOrDash(row.diagnosisName),
      code: tableCellOrDash(row.diagnosisCode)
    }
  }));

  const allergyRows: PofDocumentTableRow[] = form.allergyRows.map((row, index) => ({
    id: clean(row.id) ?? `allergy-${index + 1}`,
    cells: {
      allergen: tableCellOrDash(row.allergyName),
      category: tableCellOrDash(titleCase(row.allergyGroup)),
      severity: tableCellOrDash(row.severity),
      notes: tableCellOrDash(row.comments)
    }
  }));

  const medicationRows: PofDocumentTableRow[] = form.medications.map((row, index) => ({
    id: clean(row.id) ?? `medication-${index + 1}`,
    cells: {
      medication: tableCellOrDash(row.name),
      dose: formatMedicationDose(row),
      route: tableCellOrDash(formatMedicationRoute(row)),
      frequency: tableCellOrDash(formatMedicationFrequency(row)),
      notes: formatMedicationNotes(row)
    }
  }));

  const serviceOrderRows: PofDocumentTableRow[] = Array.from(
    new Set((form.standingOrders ?? []).map((value) => value.trim()).filter(Boolean))
  ).map((order, index) => ({
    id: `service-order-${index + 1}`,
    cells: {
      order: order
    }
  }));

  const dietRows: PofDocumentTableRow[] = [
    ...normalizeNutritionDiets(care.nutritionDiets).map((diet, index) => ({
      id: `diet-${index + 1}`,
      cells: {
        diet: diet,
        notes: "-"
      }
    })),
    ...(clean(care.nutritionDietOther)
      ? [
          {
            id: "diet-other",
            cells: {
              diet: "Other",
              notes: clean(care.nutritionDietOther)!
            }
          }
        ]
      : [])
  ];

  const sections: PofDocumentSection[] = [
    {
      layout: "fields",
      sectionKey: "identification-medical-orders",
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
      layout: "table",
      sectionKey: "diagnoses",
      title: "Diagnoses",
      columns: [
        { key: "type", label: "Type", widthWeight: 0.8 },
        { key: "diagnosis", label: "Diagnosis", widthWeight: 2.4 },
        { key: "code", label: "Code", widthWeight: 1 }
      ],
      rows: diagnosisRows
    },
    {
      layout: "table",
      sectionKey: "allergies",
      title: "Allergies",
      columns: [
        { key: "allergen", label: "Allergen", widthWeight: 1.8 },
        { key: "category", label: "Category", widthWeight: 1.1 },
        { key: "severity", label: "Severity", widthWeight: 0.9 },
        { key: "notes", label: "Notes", widthWeight: 2.2 }
      ],
      rows: allergyRows
    },
    {
      layout: "table",
      sectionKey: "medications",
      title: "Medications",
      columns: [
        { key: "medication", label: "Medication", widthWeight: 1.8 },
        { key: "dose", label: "Dose", widthWeight: 1.2 },
        { key: "route", label: "Route", widthWeight: 1.1 },
        { key: "frequency", label: "Frequency", widthWeight: 1.4 },
        { key: "notes", label: "Indication / Notes", widthWeight: 2.8 }
      ],
      rows: medicationRows
    },
    {
      layout: "table",
      sectionKey: "service-orders",
      title: "Treatment / Service Orders",
      columns: [{ key: "order", label: "Order / Service", widthWeight: 1 }],
      rows: serviceOrderRows
    },
    {
      layout: "fields",
      sectionKey: "behavior-orientation",
      title: "Behavior & Orientation",
      rows: [
        { label: "Disoriented Constantly", value: yesNo(care.disorientedConstantly) },
        { label: "Disoriented Intermittently", value: yesNo(care.disorientedIntermittently) },
        { label: "Inappropriate Behavior - Wanderer", value: yesNo(care.inappropriateBehaviorWanderer) },
        { label: "Inappropriate Behavior - Verbal Aggression", value: yesNo(care.inappropriateBehaviorVerbalAggression) },
        { label: "Inappropriate Behavior - Aggression", value: yesNo(care.inappropriateBehaviorAggression) },
        {
          label: "Activities / Social",
          value: selectedList([
            { label: "Passive", value: care.activitiesPassive },
            { label: "Active", value: care.activitiesActive },
            { label: "Group Participation", value: care.activitiesGroupParticipation },
            { label: "Prefers Alone", value: care.activitiesPrefersAlone }
          ])
        },
        {
          label: "Stimulation",
          value: selectedList([
            { label: "Afraid Loud Noises", value: care.stimulationAfraidLoudNoises },
            { label: "Easily Overwhelmed", value: care.stimulationEasilyOverwhelmed },
            { label: "Adapts Easily", value: care.stimulationAdaptsEasily }
          ])
        },
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
      layout: "fields",
      sectionKey: "adls-mobility",
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
        ...(care.mobilityOther ? [{ label: "Mobility Other Detail", value: valueOrDash(care.mobilityOtherText) }] : []),
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
      layout: "fields",
      sectionKey: "clinical-support",
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
      layout: "table",
      sectionKey: "diet-restrictions",
      title: "Diet / Restrictions",
      columns: [
        { key: "diet", label: "Diet / Restriction", widthWeight: 1.4 },
        { key: "notes", label: "Notes", widthWeight: 2.6 }
      ],
      rows: dietRows
    },
    {
      layout: "fields",
      sectionKey: "joy-sparks",
      title: "Joy Sparks",
      rows: [{ label: "Additional Information to Help Spark Joy", value: valueOrDash(care.joySparksNotes) }]
    }
  ];

  return filterPofDocumentSections(sections, config);
}
