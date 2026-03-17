import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { buildPofDocumentSections, isMeaningfulDocumentValue } from "../lib/services/pof-document-content";
import { buildPofDocumentPdfBytes } from "../lib/services/pof-document-pdf";

function readWorkspaceFile(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

function createPofFixture() {
  return {
    id: "pof-1",
    memberId: "member-1",
    memberNameSnapshot: "Clara Maddox",
    memberDobSnapshot: "1940-05-06",
    sex: "F",
    levelOfCare: "Home",
    dnrSelected: false,
    status: "Draft",
    providerSignatureStatus: "Pending",
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
    },
    operationalFlags: {}
  } as any;
}

function flattenFieldRows(sections: ReturnType<typeof buildPofDocumentSections>) {
  return sections.flatMap((section) => (section.layout === "fields" ? section.rows : []));
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

test("POF non-table sections suppress No/- rows while retaining meaningful values", () => {
  const form = createPofFixture();
  form.careInformation.ambulatoryStatus = "Occasionally unsteady";
  form.careInformation.adlProfile.toileting = "Needs help";
  form.careInformation.adlProfile.hearing = "Hard of hearing";
  form.careInformation.adlProfile.dental = "Dentures";
  form.careInformation.adlProfile.speechVerbalStatus = "Limited verbal";
  form.careInformation.nutritionDiets = ["Regular", "Diabetic"];

  const sections = buildPofDocumentSections(form);
  const allRows = flattenFieldRows(sections);

  assert.equal(allRows.some((row) => row.value === "No"), false);
  assert.equal(allRows.some((row) => row.value === "-"), false);
  assert.equal(sections.some((section) => section.title === "Diagnoses"), false);
  assert.equal(sections.some((section) => section.title === "Allergies"), false);
  assert.equal(allRows.some((row) => row.value === "Needs help"), true);
  assert.equal(allRows.some((row) => row.value === "Occasionally unsteady"), true);
  assert.equal(allRows.some((row) => row.value === "Hard of hearing"), true);
  assert.equal(allRows.some((row) => row.value === "Dentures"), true);
  assert.equal(allRows.some((row) => row.value === "Limited verbal"), true);
});

test("allergies render as a table when structured rows exist", () => {
  const form = createPofFixture();
  form.allergyRows = [
    {
      id: "allergy-1",
      allergyGroup: "medication",
      allergyName: "Penicillin",
      severity: "Severe",
      comments: "Hives and shortness of breath"
    }
  ];

  const sections = buildPofDocumentSections(form);
  const allergySection = sections.find((section) => section.sectionKey === "allergies");

  assert.notEqual(allergySection, undefined);
  assert.equal(allergySection?.layout, "table");
  assert.deepEqual(
    allergySection?.layout === "table" ? allergySection.columns.map((column) => column.label) : [],
    ["Allergen", "Category", "Severity", "Notes"]
  );
  assert.equal(allergySection?.layout === "table" ? allergySection.rows.length : 0, 1);
});

test("medications render as a table when structured rows exist", () => {
  const form = createPofFixture();
  form.medications = [
    {
      id: "med-1",
      name: "Metformin",
      strength: "500 mg",
      dose: "1 tablet",
      quantity: "1",
      form: "tablet",
      route: "oral",
      routeLaterality: null,
      frequency: "BID",
      scheduledTimes: ["08:00", "20:00"],
      givenAtCenter: true,
      givenAtCenterTime24h: "08:00",
      prn: false,
      prnInstructions: null,
      startDate: "2026-03-01",
      endDate: null,
      active: true,
      provider: "Dr. Hart",
      instructions: "Take with meals",
      comments: "Monitor glucose"
    }
  ];

  const sections = buildPofDocumentSections(form);
  const meds = sections.find((section) => section.sectionKey === "medications");

  assert.notEqual(meds, undefined);
  assert.equal(meds?.layout, "table");
  assert.equal(meds?.layout === "table" ? meds.rows.length : 0, 1);
  assert.equal(
    meds?.layout === "table" ? String(meds.rows[0].cells.notes).includes("Take with meals") : false,
    true
  );
  assert.equal(
    meds?.layout === "table" ? String(meds.rows[0].cells.notes).includes("Start:") : false,
    false
  );
  assert.equal(
    meds?.layout === "table" ? String(meds.rows[0].cells.notes).includes("End:") : false,
    false
  );
});

test("empty structured sections do not render", () => {
  const form = createPofFixture();
  const sections = buildPofDocumentSections(form);
  const hiddenSectionKeys = new Set(["diagnoses", "allergies", "medications", "service-orders", "diet-restrictions"]);

  hiddenSectionKeys.forEach((key) => {
    assert.equal(sections.some((section) => section.sectionKey === key), false);
  });
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
  assert.equal(
    identification?.layout === "fields"
      ? identification.rows.some((row) => row.label === "DNR Selected" && row.value === "No")
      : false,
    true
  );
});

test("signed PDF includes signature section title, signed timestamp, and embedded image object", async () => {
  const form = createPofFixture();
  const tinyPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j8W8AAAAASUVORK5CYII=",
    "base64"
  );

  const bytes = await buildPofDocumentPdfBytes({
    form,
    title: "Physician Order Form",
    signature: {
      providerTypedName: "Jordan Doe",
      providerCredentials: "MD",
      signedAt: "2026-03-14T11:45:00-04:00",
      signatureImageBytes: tinyPng,
      signatureContentType: "image/png"
    }
  });
  const pdfSource = readWorkspaceFile("lib/services/pof-document-pdf.ts");

  assert.equal(bytes.byteLength > 0, true);
  assert.equal(bytes.toString("latin1").startsWith("%PDF"), true);
  assert.equal(pdfSource.includes("Provider Electronic Signature"), true);
  assert.equal(pdfSource.includes("Signed at:"), true);
  assert.equal(pdfSource.includes("page.drawImage(signatureImage"), true);
});

test("signed PDF generation fails loudly when signature image bytes are missing", async () => {
  const form = createPofFixture();
  await assert.rejects(
    () =>
      buildPofDocumentPdfBytes({
        form,
        title: "Physician Order Form",
        signature: {
          providerTypedName: "Jordan Doe",
          signedAt: "2026-03-14T11:45:00-04:00",
          signatureImageBytes: Buffer.alloc(0),
          signatureContentType: "image/png"
        }
      }),
    /provider signature image asset is missing/i
  );
});

test("provider signing page and PDF use shared sections, and signed flow resolves stored signature artifact", () => {
  const renderSource = readWorkspaceFile("components/physician-orders/pof-document-render.tsx");
  const pdfSource = readWorkspaceFile("lib/services/pof-document-pdf.ts");
  const legacyPdfSource = readWorkspaceFile("lib/services/physician-orders-supabase.ts");
  const signPageSource = readWorkspaceFile("app/sign/pof/[token]/page.tsx");
  const detailPageSource = readWorkspaceFile("app/(portal)/health/physician-orders/[pofId]/page.tsx");
  const printPageSource = readWorkspaceFile("app/(portal)/health/physician-orders/[pofId]/print/page.tsx");
  const esignSource = readWorkspaceFile("lib/services/pof-esign.ts");

  assert.equal(renderSource.includes("buildPofDocumentSections(form)"), true);
  assert.equal(pdfSource.includes("buildPofDocumentSections(input.form)"), true);
  assert.equal(legacyPdfSource.includes("buildPofDocumentPdfBytes"), true);
  assert.equal(legacyPdfSource.includes("No diagnoses entered."), false);
  assert.equal(signPageSource.includes("PofDocumentRender"), true);
  assert.equal(detailPageSource.includes("PofDocumentRender"), true);
  assert.equal(printPageSource.includes("PofDocumentRender"), true);
  assert.equal(
    esignSource.includes('downloadStorageAssetOrThrow(signatureUri, "Provider signature image artifact")'),
    true
  );
  assert.equal(esignSource.includes("is missing in storage. Unable to generate signed PDF artifact."), true);
});
