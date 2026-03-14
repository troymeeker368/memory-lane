import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { buildPofDocumentSections, isMeaningfulDocumentValue } from "../lib/services/pof-document-content";

function readWorkspaceFile(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

function createPofFixture() {
  return {
    memberNameSnapshot: "Clara Maddox",
    memberDobSnapshot: "1940-05-06",
    sex: "Female",
    levelOfCare: "Home",
    dnrSelected: false,
    status: "Draft",
    providerSignatureStatus: "pending",
    completedDate: null,
    nextRenewalDueDate: null,
    vitalsBloodPressure: "",
    vitalsPulse: "",
    vitalsOxygenSaturation: "",
    vitalsRespiration: "",
    diagnosisRows: [],
    allergyRows: [],
    medications: [],
    standingOrders: [],
    careInformation: {
      disorientedConstantly: false,
      disorientedIntermittently: false,
      inappropriateBehaviorWanderer: false,
      inappropriateBehaviorVerbalAggression: false,
      inappropriateBehaviorAggression: false,
      activitiesPassive: false,
      activitiesActive: false,
      activitiesGroupParticipation: false,
      activitiesPrefersAlone: false,
      stimulationAfraidLoudNoises: false,
      stimulationEasilyOverwhelmed: false,
      stimulationAdaptsEasily: false,
      personalCareBathing: false,
      personalCareFeeding: false,
      personalCareDressing: false,
      personalCareMedication: false,
      personalCareToileting: false,
      ambulatoryStatus: "",
      mobilityIndependent: false,
      mobilityWalker: false,
      mobilityWheelchair: false,
      mobilityScooter: false,
      mobilityOther: false,
      mobilityOtherText: "",
      functionalLimitationSight: false,
      functionalLimitationHearing: false,
      functionalLimitationSpeech: false,
      breathingRoomAir: false,
      breathingOxygenTank: false,
      breathingOxygenLiters: "",
      nutritionDiets: [],
      nutritionDietOther: "",
      joySparksNotes: "",
      adlProfile: {
        ambulation: "",
        transferring: "",
        bathing: "",
        dressing: "",
        eating: "",
        bladderContinence: "",
        bowelContinence: "",
        toileting: "",
        toiletingNeeds: "",
        toiletingComments: "",
        hearing: "",
        vision: "",
        dental: "",
        speechVerbalStatus: "",
        speechComments: "",
        hygieneGrooming: "",
        maySelfMedicate: false
      },
      orientationProfile: {
        orientationDob: "",
        orientationCity: "",
        orientationCurrentYear: "",
        orientationFormerOccupation: "",
        disorientation: false,
        memoryImpairment: "",
        memorySeverity: "",
        cognitiveBehaviorComments: ""
      }
    }
  } as any;
}

test("isMeaningfulDocumentValue hides default negative and empty values", () => {
  assert.equal(isMeaningfulDocumentValue("No"), false);
  assert.equal(isMeaningfulDocumentValue("-"), false);
  assert.equal(isMeaningfulDocumentValue(""), false);
  assert.equal(isMeaningfulDocumentValue("N/A"), false);
  assert.equal(isMeaningfulDocumentValue("None"), false);
  assert.equal(isMeaningfulDocumentValue("Yes"), true);
  assert.equal(isMeaningfulDocumentValue("Needs help"), true);
});

test("POF document sections suppress No/- rows while retaining meaningful values", () => {
  const form = createPofFixture();
  form.careInformation.ambulatoryStatus = "Occasionally unsteady";
  form.careInformation.adlProfile.toileting = "Needs help";
  form.careInformation.adlProfile.hearing = "Hard of hearing";
  form.careInformation.adlProfile.dental = "Dentures";
  form.careInformation.adlProfile.speechVerbalStatus = "Limited verbal";
  form.careInformation.nutritionDiets = ["Regular", "Diabetic"];

  const sections = buildPofDocumentSections(form);
  const allRows = sections.flatMap((section) => section.rows);

  assert.equal(allRows.some((row) => row.value === "No"), false);
  assert.equal(allRows.some((row) => row.value === "-"), false);
  assert.equal(sections.some((section) => section.title === "Diagnoses"), false);
  assert.equal(sections.some((section) => section.title === "Allergies"), false);
  assert.equal(allRows.some((row) => row.value === "Needs help"), true);
  assert.equal(allRows.some((row) => row.value === "Occasionally unsteady"), true);
  assert.equal(allRows.some((row) => row.value === "Hard of hearing"), true);
  assert.equal(allRows.some((row) => row.value === "Dentures"), true);
  assert.equal(allRows.some((row) => row.value === "Limited verbal"), true);
  assert.equal(allRows.some((row) => row.value === "Diabetic"), true);
});

test("POF document filtering supports field and section force-show overrides", () => {
  const form = createPofFixture();
  const sections = buildPofDocumentSections(form, {
    alwaysShowFields: ["identification-medical-orders::DNR Selected"],
    alwaysShowSections: ["Diagnoses"]
  });

  const identification = sections.find((section) => section.title === "Identification / Medical Orders");
  const diagnoses = sections.find((section) => section.title === "Diagnoses");

  assert.notEqual(identification, undefined);
  assert.notEqual(diagnoses, undefined);
  assert.equal(identification?.rows.some((row) => row.label === "DNR Selected" && row.value === "No"), true);
});

test("provider signing page and PDF use the shared filtered document section builder", () => {
  const renderSource = readWorkspaceFile("components/physician-orders/pof-document-render.tsx");
  const pdfSource = readWorkspaceFile("lib/services/pof-document-pdf.ts");
  const legacyPdfSource = readWorkspaceFile("lib/services/physician-orders-supabase.ts");
  const signPageSource = readWorkspaceFile("app/sign/pof/[token]/page.tsx");
  const detailPageSource = readWorkspaceFile("app/(portal)/health/physician-orders/[pofId]/page.tsx");
  const printPageSource = readWorkspaceFile("app/(portal)/health/physician-orders/[pofId]/print/page.tsx");

  assert.equal(renderSource.includes("buildPofDocumentSections(form)"), true);
  assert.equal(pdfSource.includes("buildPofDocumentSections(input.form)"), true);
  assert.equal(legacyPdfSource.includes("buildPofDocumentPdfBytes"), true);
  assert.equal(legacyPdfSource.includes("No diagnoses entered."), false);
  assert.equal(signPageSource.includes("PofDocumentRender"), true);
  assert.equal(detailPageSource.includes("PofDocumentRender"), true);
  assert.equal(printPageSource.includes("PofDocumentRender"), true);
});
