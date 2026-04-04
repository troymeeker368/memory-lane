import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  CANONICAL_MEMBERSHIP_AGREEMENT_TEMPLATE,
  buildCanonicalMembershipAgreementParagraphs,
  buildRenderedMembershipAgreementParagraphs
} from "@/lib/services/enrollment-packet-membership-document";
import { buildEnrollmentPacketLegalText } from "@/lib/services/enrollment-packet-legal-text";
import {
  ENROLLMENT_PACKET_INTAKE_TEXT_KEYS,
  normalizeEnrollmentPacketIntakePayload,
  normalizeEnrollmentPacketTextInput,
  type EnrollmentPacketIntakePayload
} from "@/lib/services/enrollment-packet-intake-payload";
import {
  ENROLLMENT_PACKET_PAYMENT_METHOD_OPTIONS,
  ENROLLMENT_PACKET_NOTICE_ACKNOWLEDGMENTS
} from "@/lib/services/enrollment-packet-payment-consent";
import { ENROLLMENT_PACKET_PHOTO_CONSENT_OPTIONS } from "@/lib/services/enrollment-packet-public-options";
import { ENROLLMENT_PACKET_SECTIONS } from "@/lib/services/enrollment-packet-public-sections";
import { validateEnrollmentPacketCompletion } from "@/lib/services/enrollment-packet-public-validation";

function readWorkspaceFile(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

function buildValidPayload(
  overrides: Partial<EnrollmentPacketIntakePayload> = {}
): EnrollmentPacketIntakePayload {
  return normalizeEnrollmentPacketIntakePayload({
    memberLegalFirstName: "James",
    memberLegalLastName: "Walker",
    memberDob: "1940-01-01",
    memberGender: "Male",
    memberAddressLine1: "123 Main St",
    memberCity: "Fort Mill",
    memberState: "SC",
    memberZip: "29715",
    primaryContactName: "Jane Caregiver",
    primaryContactRelationship: "Daughter",
    primaryContactPhone: "(803) 555-1111",
    primaryContactEmail: "jane@example.com",
    primaryContactAddressLine1: "123 Main St",
    primaryContactCity: "Fort Mill",
    primaryContactState: "SC",
    primaryContactZip: "29715",
    secondaryContactName: "John Backup",
    secondaryContactRelationship: "Son",
    secondaryContactPhone: "(803) 555-2222",
    secondaryContactEmail: "john@example.com",
    secondaryContactAddressLine1: "456 Oak Ave",
    secondaryContactCity: "Fort Mill",
    secondaryContactState: "SC",
    secondaryContactZip: "29715",
    pcpName: "Dr. Jane Smith",
    pcpAddress: "789 Clinic Rd",
    pcpPhone: "(803) 555-3333",
    pharmacy: "Town Square Pharmacy",
    pharmacyAddress: "321 Pharmacy Blvd, Suite A",
    pharmacyPhone: "(803) 555-4444",
    requestedStartDate: "2026-04-01",
    totalInitialEnrollmentAmount: "1000.00",
    paymentMethodSelection: "ACH",
    fallsHistory: "No",
    bankName: "First National Bank",
    bankCityStateZip: "Fort Mill, SC 29715",
    bankAba: "123456789",
    bankAccountNumber: "1234567890",
    membershipGuarantorSignatureName: "Jane Caregiver",
    membershipGuarantorSignatureDate: "2026-03-25",
    exhibitAGuarantorSignatureName: "Jane Caregiver",
    privacyAcknowledgmentSignatureName: "Jane Caregiver",
    privacyAcknowledgmentSignatureDate: "2026-03-25",
    rightsAcknowledgmentSignatureName: "Jane Caregiver",
    rightsAcknowledgmentSignatureDate: "2026-03-25",
    ancillaryChargesAcknowledgmentSignatureName: "Jane Caregiver",
    ancillaryChargesAcknowledgmentSignatureDate: "2026-03-25",
    photoConsentChoice: "Do Permit",
    recreationInterests: {
      Social: ["Current Events"],
      Cognitive: [],
      Physical: [],
      Creative: [],
      Sensory: [],
      Spiritual: []
    },
    ...overrides
  });
}

test("enrollment packet free-text normalization trims edges while preserving internal spaces across text fields", () => {
  assert.equal(
    normalizeEnrollmentPacketTextInput("  Keeps  internal   spacing  "),
    "Keeps  internal   spacing"
  );

  const explicitFreeTextCases = [
    { key: "pcpName", input: "  Dr.  Jane   Smith  ", expected: "Dr.  Jane   Smith" },
    { key: "pharmacy", input: "  Town   Square Pharmacy  ", expected: "Town   Square Pharmacy" },
    {
      key: "pharmacyAddress",
      input: "  321  Pharmacy Blvd,  Suite A  ",
      expected: "321  Pharmacy Blvd,  Suite A"
    },
    { key: "bankName", input: "  First   National  Bank  ", expected: "First   National  Bank" },
    { key: "memberAddressLine1", input: "  123  Main   St  ", expected: "123  Main   St" },
    {
      key: "additionalNotes",
      input: "  Daughter notes:  eats   slowly  ",
      expected: "Daughter notes:  eats   slowly"
    }
  ] as const;

  explicitFreeTextCases.forEach((entry) => {
    const payload = normalizeEnrollmentPacketIntakePayload({
      [entry.key]: entry.input
    });
    assert.equal(payload[entry.key], entry.expected);
  });

  const phoneTextKeys = new Set([
    "primaryContactPhone",
    "secondaryContactPhone",
    "pcpPhone",
    "physicianPhone",
    "pcpFax",
    "physicianFax",
    "pharmacyPhone"
  ]);
  const bulkPayload: Record<string, string> = {};

  ENROLLMENT_PACKET_INTAKE_TEXT_KEYS.forEach((key) => {
    if (phoneTextKeys.has(key)) return;
    bulkPayload[key] = `  ${key}  value   with   spacing  `;
  });

  const normalizedPayload = normalizeEnrollmentPacketIntakePayload(bulkPayload);
  ENROLLMENT_PACKET_INTAKE_TEXT_KEYS.forEach((key) => {
    if (phoneTextKeys.has(key)) return;

    assert.equal(
      normalizedPayload[key],
      `${key}  value   with   spacing`
    );
  });
});

test("canonical text normalize path preserves spaces in common identity fields used in enrollment packet intake", () => {
  const normalized = normalizeEnrollmentPacketIntakePayload({
    pcpName: "  Dr.  Bob   Smith  ",
    pharmacy: "  CVS   Pharmacy  ",
    pharmacyAddress: "  123  Main   Street  ",
    primaryContactAddressLine1: "  456  Oak   Ave  ",
    additionalNotes: "  Keeps   internal   spaces  ",
    membershipGuarantorSignatureName: "  Jane   Doe  "
  });

  assert.equal(normalized.pcpName, "Dr.  Bob   Smith");
  assert.equal(normalized.pharmacy, "CVS   Pharmacy");
  assert.equal(normalized.pharmacyAddress, "123  Main   Street");
  assert.equal(normalized.primaryContactAddressLine1, "456  Oak   Ave");
  assert.equal(normalized.additionalNotes, "Keeps   internal   spaces");
  assert.equal(normalized.membershipGuarantorSignatureName, "Jane   Doe");
});

test("enrollment packet DOCX row wrapping helper keeps internal spacing in free-text fields", () => {
  const docxSource = readWorkspaceFile("lib/services/enrollment-packet-docx.ts");
  assert.equal(docxSource.includes(".replace(/\\s+/g, \" \")"), false);
  assert.equal(docxSource.includes("function splitEnrollmentPacketFieldValueRows"), true);
  assert.equal(docxSource.includes("const normalized = inputText.trim();"), true);
});

test("enrollment packet progress merge and public action parsing trim edges without collapsing internal spaces", () => {
  const coreSource = readWorkspaceFile("lib/services/enrollment-packet-core.ts");
  const actionSource = readWorkspaceFile("app/sign/enrollment-packet/[token]/actions.ts");

  assert.equal(
    coreSource.includes("const normalized = (value ?? \"\").trim();"),
    true
  );
  assert.equal(
    actionSource.includes("return normalizeEnrollmentPacketTextInput(formData.get(key)) ?? \"\";"),
    true
  );
  assert.equal(
    actionSource.includes(".replace(/\\s+/g"),
    false
  );
});

test("public enrollment packet submit keeps committed follow-up-required results on the success path", () => {
  const runtimeSource = readWorkspaceFile("lib/services/enrollment-packets-public-runtime.ts");
  const actionSource = readWorkspaceFile("app/sign/enrollment-packet/[token]/actions.ts");
  const confirmationSource = readWorkspaceFile("app/sign/enrollment-packet/[token]/confirmation/page.tsx");

  assert.equal(
    runtimeSource.includes('if (submitResult.operationalReadinessStatus !== "operationally_ready") {\n    throw new Error('),
    false
  );
  assert.equal(
    actionSource.includes('redirectParams.set("status", "follow-up-required")'),
    true
  );
  assert.equal(
    confirmationSource.includes("Memory Lane received the enrollment packet."),
    true
  );
});

test("public enrollment packet submit success path navigates to confirmation route", () => {
  const actionSource = readWorkspaceFile("app/sign/enrollment-packet/[token]/actions.ts");
  const formSource = readWorkspaceFile("components/enrollment-packets/enrollment-packet-public-form.tsx");
  const pageSource = readWorkspaceFile("app/sign/enrollment-packet/[token]/page.tsx");
  const confirmationSource = readWorkspaceFile("app/sign/enrollment-packet/[token]/confirmation/page.tsx");

  assert.equal(
    actionSource.includes("redirectUrl: `/sign/enrollment-packet/${encodeURIComponent(token)}/confirmation"),
    true
  );
  assert.equal(formSource.includes("const result = await submitPublicEnrollmentPacketAction(formData);"), true);
  assert.equal(formSource.includes("if (!result.ok) {"), true);
  assert.equal(formSource.includes("navigateToConfirmation(result.redirectUrl);"), true);
  assert.equal(formSource.includes("window.location.href = redirectUrl;"), true);
  assert.equal(pageSource.includes("redirect(`/sign/enrollment-packet/${encodeURIComponent(token)}/confirmation`);"), true);
  assert.equal(confirmationSource.includes("First Day Welcome Letter"), true);
});

test("completed enrollment packet pdf mirrors the current packet document structure instead of a flat data export", () => {
  const pdfSource = readWorkspaceFile("lib/services/enrollment-packet-docx.ts");

  assert.equal(pdfSource.includes('"1. Welcome Checklist"'), true);
  assert.equal(pdfSource.includes('"2. New Member Face Sheet & Biography"'), true);
  assert.equal(pdfSource.includes('"3. Membership Agreement"'), true);
  assert.equal(pdfSource.includes('"3A. Membership Agreement Exhibit A"'), true);
  assert.equal(pdfSource.includes('"8. Insurance and POA Upload"'), true);
  assert.equal(pdfSource.includes('"9. Memory Lane Completion Summary"'), true);
  assert.equal(pdfSource.includes("Enrollment Form Data Record"), false);
  assert.equal(pdfSource.includes("Additional Captured Fields"), false);
});

test("legacy flat recreation interests normalize into canonical structured categories", () => {
  const payload = normalizeEnrollmentPacketIntakePayload({
    recreationalInterests: [
      "Social - Current Events",
      "Expressive - Painting",
      "Meditation",
      "Board Games"
    ]
  });

  assert.deepEqual(payload.recreationInterests, {
    Social: ["Current Events", "Board Games"],
    Cognitive: [],
    Physical: [],
    Creative: ["Painting"],
    Sensory: [],
    Spiritual: ["Meditation"]
  });

  const recreationField = ENROLLMENT_PACKET_SECTIONS.flatMap((section) => section.fields).find(
    (field) => field.key === "recreationInterests"
  );
  assert.equal(recreationField?.type, "categorized-checkbox-group");
});

test("photo consent stays canonical, required, and mutually exclusive", () => {
  const missingConsent = validateEnrollmentPacketCompletion({
    payload: buildValidPayload({ photoConsentChoice: null })
  });
  assert.equal(missingConsent.missingItems.includes("Photo consent selection"), true);

  const invalidConsent = validateEnrollmentPacketCompletion({
    payload: buildValidPayload({ photoConsentChoice: "Maybe" })
  });
  assert.equal(invalidConsent.missingItems.includes("Photo consent selection"), true);

  const photoConsentField = ENROLLMENT_PACKET_SECTIONS.flatMap((section) => section.fields).find(
    (field) => field.key === "photoConsentChoice"
  );
  assert.equal(photoConsentField?.type, "radio");
  assert.deepEqual(photoConsentField?.options, [...ENROLLMENT_PACKET_PHOTO_CONSENT_OPTIONS]);
  assert.equal(ENROLLMENT_PACKET_PHOTO_CONSENT_OPTIONS.length, 2);
});

test("payment authorization renders one canonical method block at a time with staff-set amounts", () => {
  const achText = buildEnrollmentPacketLegalText({
    caregiverName: "Jane Caregiver",
    memberName: "James Walker",
    paymentMethodSelection: "ACH",
    communityFee: "250",
    totalInitialEnrollmentAmount: "1450"
  });
  const creditText = buildEnrollmentPacketLegalText({
    caregiverName: "Jane Caregiver",
    memberName: "James Walker",
    paymentMethodSelection: "Credit Card",
    communityFee: "250",
    totalInitialEnrollmentAmount: "1450"
  });

  assert.equal(
    achText.exhibitAPaymentAuthorization.some((paragraph) => paragraph.includes("Community Fee: $250.00")),
    true
  );
  assert.equal(
    achText.exhibitAPaymentAuthorization.some((paragraph) => paragraph.includes("Total Amount Due for Initial Enrollment: $1450.00")),
    true
  );
  assert.equal(
    achText.exhibitAPaymentAuthorization.some((paragraph) => paragraph.includes("ACH AUTHORIZATION")),
    true
  );
  assert.equal(
    achText.exhibitAPaymentAuthorization.some((paragraph) => paragraph.includes("☐ ACH (Bank Draft)")),
    false
  );
  assert.equal(
    achText.exhibitAPaymentAuthorization.some((paragraph) => paragraph.includes("Bank Information")),
    false
  );
  assert.equal(
    achText.exhibitAPaymentAuthorization.some((paragraph) => paragraph.includes("CREDIT CARD AUTHORIZATION")),
    false
  );
  assert.equal(
    creditText.exhibitAPaymentAuthorization.some((paragraph) => paragraph.includes("CREDIT CARD AUTHORIZATION")),
    true
  );
  assert.equal(
    creditText.exhibitAPaymentAuthorization.some((paragraph) => paragraph.includes("ACH AUTHORIZATION")),
    false
  );
  assert.equal(
    creditText.exhibitAPaymentAuthorization.some((paragraph) => paragraph.includes("Credit Card Information")),
    false
  );
});

test("photo consent notice sentence updates from the selected radio option", () => {
  const permitText = buildEnrollmentPacketLegalText({
    caregiverName: "Jane Caregiver",
    memberName: "James Walker",
    photoConsentChoice: "Do Permit"
  });
  const denyText = buildEnrollmentPacketLegalText({
    caregiverName: "Jane Caregiver",
    memberName: "James Walker",
    photoConsentChoice: "Do Not Permit"
  });

  assert.equal(
    permitText.photoConsent.some((paragraph) => paragraph.includes("I do permit and authorize")),
    true
  );
  assert.equal(
    denyText.photoConsent.some((paragraph) => paragraph.includes("I do not permit and authorize")),
    true
  );
  assert.equal(
    permitText.photoConsent.some((paragraph) => paragraph.includes("Responsible Party/Guarantor: __________________")),
    false
  );
});

test("payment method requirements and notice acknowledgements are enforced canonically", () => {
  const achMissing = validateEnrollmentPacketCompletion({
    payload: buildValidPayload({
      bankName: null,
      bankCityStateZip: null,
      bankAba: null,
      bankAccountNumber: null,
      exhibitAGuarantorSignatureName: null
    })
  });
  assert.equal(achMissing.missingItems.includes("Bank name"), true);
  assert.equal(achMissing.missingItems.includes("Bank city/state/ZIP"), true);
  assert.equal(achMissing.missingItems.includes("Routing number"), true);
  assert.equal(achMissing.missingItems.includes("Account number"), true);
  assert.equal(achMissing.missingItems.includes("ACH authorization acknowledgement"), true);

  const creditMissing = validateEnrollmentPacketCompletion({
    payload: buildValidPayload({
      paymentMethodSelection: "Credit Card",
      bankName: null,
      bankCityStateZip: null,
      bankAba: null,
      bankAccountNumber: null,
      exhibitAGuarantorSignatureName: null,
      cardholderName: null,
      cardType: null,
      cardNumber: null,
      cardExpiration: null,
      cardCvv: null,
      cardBillingAddressLine1: null,
      cardBillingCity: null,
      cardBillingState: null,
      cardBillingZip: null
    })
  });
  assert.equal(creditMissing.missingItems.includes("Bank name"), false);
  assert.equal(creditMissing.missingItems.includes("Bank city/state/ZIP"), false);
  assert.equal(creditMissing.missingItems.includes("Cardholder name"), true);
  assert.equal(creditMissing.missingItems.includes("Card type"), true);
  assert.equal(creditMissing.missingItems.includes("Credit card authorization acknowledgement"), true);

  const noticeMissing = validateEnrollmentPacketCompletion({
    payload: buildValidPayload({
      privacyAcknowledgmentSignatureName: null,
      privacyAcknowledgmentSignatureDate: null,
      rightsAcknowledgmentSignatureName: null,
      rightsAcknowledgmentSignatureDate: null,
      ancillaryChargesAcknowledgmentSignatureName: null,
      ancillaryChargesAcknowledgmentSignatureDate: null
    })
  });
  ENROLLMENT_PACKET_NOTICE_ACKNOWLEDGMENTS.forEach((definition) => {
    assert.equal(noticeMissing.missingItems.includes(definition.label), true);
  });
});

test("membership agreement template stays locked and injects caregiver name into the canonical intro", () => {
  const templateHash = crypto
    .createHash("sha256")
    .update(CANONICAL_MEMBERSHIP_AGREEMENT_TEMPLATE.join("\n\n"))
    .digest("hex");

  assert.equal(
    templateHash,
    "c86982161f02806988a092ba1931594d15c75dd9f2fc9a0dff98ea9bf170e5a5"
  );

  const paragraphs = buildCanonicalMembershipAgreementParagraphs("Jane Caregiver", "James Walker");
  assert.equal(paragraphs[1]?.includes("Jane Caregiver (Responsible Party)."), true);
  assert.equal(paragraphs[1]?.includes("James Walker (Member)"), true);
  assert.equal(paragraphs.some((paragraph) => paragraph.includes("{{caregiverName}}")), false);
});

test("rendered membership agreement hides the trailing fill-in boilerplate block", () => {
  const renderedParagraphs = buildRenderedMembershipAgreementParagraphs("Jane Caregiver", "James Walker");

  assert.equal(renderedParagraphs.includes("RESPONSIBLE PARTY/GUARANTOR INFORMATION:"), false);
  assert.equal(renderedParagraphs.includes("REQUESTED SCHEDULED DAYS:"), false);
});

test("membership agreement execution lines come only from the canonical agreement signature fields", () => {
  const unsignedText = buildEnrollmentPacketLegalText({
    caregiverName: "Jane Caregiver",
    memberName: "James Walker"
  });
  const signedText = buildEnrollmentPacketLegalText({
    caregiverName: "Jane Caregiver",
    memberName: "James Walker",
    membershipSignatureName: "Jane Caregiver",
    membershipSignatureDate: "2026-03-25"
  });

  assert.deepEqual(unsignedText.membershipAgreementExecution, []);
  assert.deepEqual(signedText.membershipAgreementExecution, [
    "Responsible Party / Guarantor Signature: Jane Caregiver",
    "Signature Date: 2026-03-25"
  ]);
});

test("member signature fields are removed from the canonical enrollment packet payload model", () => {
  const intakeKeys = new Set<string>(ENROLLMENT_PACKET_INTAKE_TEXT_KEYS);

  assert.equal(intakeKeys.has("membershipMemberSignatureName"), false);
  assert.equal(intakeKeys.has("membershipMemberSignatureDate"), false);
  assert.equal(intakeKeys.has("exhibitAMemberSignatureName"), false);
  assert.equal(intakeKeys.has("exhibitAMemberSignatureDate"), false);
});

test("canonical section schema removes final review and keeps payment/notice inputs aligned", () => {
  assert.equal(ENROLLMENT_PACKET_SECTIONS.some((section) => section.id === "final-review"), false);

  const paymentMethodField = ENROLLMENT_PACKET_SECTIONS.flatMap((section) => section.fields).find(
    (field) => field.key === "paymentMethodSelection"
  );
  assert.equal(paymentMethodField?.type, "radio");
  assert.deepEqual(paymentMethodField?.options, [...ENROLLMENT_PACKET_PAYMENT_METHOD_OPTIONS]);

  const privacySection = ENROLLMENT_PACKET_SECTIONS.find((section) => section.id === "privacy-practices");
  const rightsSection = ENROLLMENT_PACKET_SECTIONS.find((section) => section.id === "statement-of-rights");
  const ancillarySection = ENROLLMENT_PACKET_SECTIONS.find((section) => section.id === "ancillary-charges");
  assert.equal((privacySection?.fields.length ?? 0) > 0, true);
  assert.equal((rightsSection?.fields.length ?? 0) > 0, true);
  assert.equal((ancillarySection?.fields.length ?? 0) > 0, true);
});

test("membership agreement signature is not auto-prefilled from the primary contact anymore", () => {
  const formSource = readWorkspaceFile("components/enrollment-packets/enrollment-packet-public-form.tsx");

  assert.equal(
    formSource.includes("membershipGuarantorSignatureName: defaultResponsiblePartyName ?? null"),
    false
  );
  assert.equal(
    formSource.includes("fields.intakePayload.membershipGuarantorSignatureDate ?? todayDateString()"),
    false
  );
});

test("successful public sign submit redirects to the welcome/thank-you confirmation experience", () => {
  const actionSource = readWorkspaceFile("app/sign/enrollment-packet/[token]/actions.ts");
  const confirmationSource = readWorkspaceFile(
    "app/sign/enrollment-packet/[token]/confirmation/page.tsx"
  );
  const downloadRouteSource = readWorkspaceFile(
    "app/sign/enrollment-packet/[token]/completed-packet/route.ts"
  );
  const formSource = readWorkspaceFile("components/enrollment-packets/enrollment-packet-public-form.tsx");

  assert.equal(actionSource.includes("redirect("), false);
  assert.equal(actionSource.includes("redirectUrl:"), true);
  assert.equal(formSource.includes("const router = useRouter();"), false);
  assert.equal(formSource.includes("window.location.href = redirectUrl;"), true);
  assert.equal(formSource.includes("const navigateToConfirmation = (rawRedirectUrl: string) =>"), true);
  assert.equal(formSource.includes("const result = await submitPublicEnrollmentPacketAction(formData);"), true);
  assert.equal(confirmationSource.includes("Enrollment Packet Submitted"), true);
  assert.equal(confirmationSource.includes("First Day Welcome Letter"), true);
  assert.equal(confirmationSource.includes("renderFirstDayWelcomeLetter(legalText.firstDayWelcome)"), true);
  assert.equal(confirmationSource.includes('className="list-disc space-y-2 pl-5"'), true);
  assert.equal(
    confirmationSource.includes("EnrollmentPacketConfirmationActions downloadHref={completedPacketDownloadHref}"),
    true
  );
  assert.equal(downloadRouteSource.includes("getPublicCompletedEnrollmentPacketArtifact"), true);
  assert.equal(downloadRouteSource.includes("\"Content-Disposition\""), true);
  assert.equal(
    actionSource.includes("redirectUrl: `/sign/enrollment-packet/${encodeURIComponent(token)}/confirmation"),
    true
  );
});

test("sign/submit client flow includes a hard confirmation redirect fallback", () => {
  const formSource = readWorkspaceFile("components/enrollment-packets/enrollment-packet-public-form.tsx");
  const actionSource = readWorkspaceFile("app/sign/enrollment-packet/[token]/actions.ts");

  assert.equal(formSource.includes('const result = await submitPublicEnrollmentPacketAction(formData);'), true);
  assert.equal(formSource.includes("setStatus(result.error);"), true);
  assert.equal(formSource.includes("window.location.href = redirectUrl;"), true);
  assert.equal(formSource.includes("setIsPending(true);"), true);
  assert.equal(actionSource.includes("redirectUrl:"), true);
});

test("successful public submit redirects with absolute URL normalization", () => {
  const formSource = readWorkspaceFile("components/enrollment-packets/enrollment-packet-public-form.tsx");

  assert.equal(formSource.includes("function resolveRedirectUrl(rawRedirectUrl: string)"), true);
  assert.equal(formSource.includes("new URL(rawRedirectUrl, window.location.origin).toString()"), true);
  assert.equal(formSource.includes('setStatus("Submission complete. Redirecting to confirmation page...")'), true);
});

test("already-filed public enrollment packet submissions use the replay-safe confirmation path", () => {
  const runtimeSource = readWorkspaceFile("lib/services/enrollment-packets-public-runtime.ts");
  const finalizeSource = readWorkspaceFile("lib/services/enrollment-packets-public-runtime-finalize.ts");

  assert.equal(
    runtimeSource.includes('throw new Error("This enrollment packet has already been submitted.");'),
    false
  );
  assert.equal(
    finalizeSource.includes("export async function buildCommittedEnrollmentPacketReplayResult"),
    true
  );
  assert.equal(
    runtimeSource.includes("return buildCommittedEnrollmentPacketReplayResult({"),
    true
  );
});

test("public submit guard uses a uuid-safe entity id for ip-scoped system events", () => {
  const helperSource = readWorkspaceFile("lib/services/enrollment-packet-public-helpers.ts");

  assert.equal(helperSource.includes("function buildDeterministicUuidFromHash("), true);
  assert.equal(helperSource.includes('characters[12] = "5";'), true);
  assert.equal(helperSource.includes("function buildEnrollmentPacketPublicIpEntityId("), true);
  assert.equal(helperSource.includes("entityId: ipEntityId"), true);
  assert.equal(helperSource.includes("entityId: ipFingerprint"), false);
});

test("completed enrollment packet artifact can be downloaded from the public confirmation flow", () => {
  const publicServiceSource = readWorkspaceFile("lib/services/enrollment-packets-public.ts");
  const runtimeSource = readWorkspaceFile("lib/services/enrollment-packets-public-runtime.ts");
  const artifactRuntimeSource = readWorkspaceFile("lib/services/enrollment-packets-public-runtime-artifacts.ts");
  const routeSource = readWorkspaceFile("app/sign/enrollment-packet/[token]/completed-packet/route.ts");

  assert.equal(publicServiceSource.includes("getPublicCompletedEnrollmentPacketArtifact"), true);
  assert.equal(runtimeSource.includes("getPublicCompletedEnrollmentPacketArtifact"), true);
  assert.equal(artifactRuntimeSource.includes("export async function getPublicCompletedEnrollmentPacketArtifact"), true);
  assert.equal(artifactRuntimeSource.includes('.eq("upload_category", "completed_packet")'), true);
  assert.equal(routeSource.includes(".download(artifact.objectPath)"), true);
  assert.equal(routeSource.includes("attachment; filename="), true);
});

test("completion cascade centralizes submitted notification and downstream repair-safe sync", () => {
  const cascadeSource = readWorkspaceFile("lib/services/enrollment-packet-completion-cascade.ts");
  const cascadeRuntimeSource = readWorkspaceFile("lib/services/enrollment-packets-public-runtime-cascade.ts");
  const mappingRuntimeSource = readWorkspaceFile("lib/services/enrollment-packet-mapping-runtime.ts");

  assert.equal(cascadeSource.includes("repairCommittedEnrollmentPacketCompletions"), true);
  assert.equal(cascadeSource.includes("runEnrollmentPacketDownstreamMapping({"), true);
  assert.equal(cascadeSource.includes("recordEnrollmentPacketSubmittedMilestone({"), true);
  assert.equal(cascadeSource.includes("syncEnrollmentPacketLeadActivityOrQueue({"), true);
  assert.equal(cascadeRuntimeSource.includes("runEnrollmentPacketCompletionCascade({"), true);
  assert.equal(
    mappingRuntimeSource.includes('.eq("event_type", "enrollment_packet_submitted")'),
    true
  );
});

test("completed enrollment packet pdf uses the shared branded document header", () => {
  const pdfSource = readWorkspaceFile("lib/services/enrollment-packet-docx.ts");

  assert.equal(
    pdfSource.includes('DOCUMENT_CENTER_LOGO_PUBLIC_PATH'),
    true
  );
  assert.equal(
    pdfSource.includes("async function loadCenterLogoImage(pdf: PDFDocument)"),
    true
  );
  assert.equal(
    pdfSource.includes("drawDocumentHeader({"),
    true
  );
  assert.equal(
    pdfSource.includes("page.drawText(DOCUMENT_CENTER_NAME.toUpperCase()"),
    true
  );
  assert.equal(
    pdfSource.includes('page.drawText("Fort Mill"'),
    true
  );
  assert.equal(
    pdfSource.includes("const centerDetailLine ="),
    true
  );
});

test("lead conversion canonical SQL restores member health profile shell creation", () => {
  const migrationSource = readWorkspaceFile(
    "supabase/migrations/0148_restore_lead_conversion_mhp_and_member_shell_backfill.sql"
  );

  assert.equal(migrationSource.includes("insert into public.member_health_profiles"), true);
  assert.equal(
    migrationSource.includes("on conflict on constraint member_health_profiles_member_id_key do nothing;"),
    true
  );
});

test("canonical enrollment packet submit path emits the submitted workflow milestone and relies on strict lead conversion RPC shells", () => {
  const publicRuntimeSource = readWorkspaceFile("lib/services/enrollment-packets-public-runtime.ts");
  const postCommitSource = readWorkspaceFile("lib/services/enrollment-packets-public-runtime-post-commit.ts");
  const cascadeRuntimeSource = readWorkspaceFile("lib/services/enrollment-packets-public-runtime-cascade.ts");
  const completionCascadeSource = readWorkspaceFile("lib/services/enrollment-packet-completion-cascade.ts");
  const leadConversionSource = readWorkspaceFile("lib/services/sales-lead-conversion-supabase.ts");
  const mappingRuntimeSource = readWorkspaceFile("lib/services/enrollment-packet-mapping-runtime.ts");

  assert.equal(publicRuntimeSource.includes("completeCommittedPublicEnrollmentPacketPostCommitWork"), true);
  assert.equal(postCommitSource.includes("runEnrollmentPacketCascadeAndBuildResult"), true);
  assert.equal(cascadeRuntimeSource.includes("runEnrollmentPacketCompletionCascade"), true);
  assert.equal(completionCascadeSource.includes("recordEnrollmentPacketSubmittedMilestone"), true);
  assert.equal(mappingRuntimeSource.includes('eventType: "enrollment_packet_submitted"'), true);
  assert.equal(leadConversionSource.includes("ensureLeadConversionMemberShellRows"), false);
  assert.equal(leadConversionSource.includes("invokeLeadConversionRpcWithFallback"), true);
});

test("canonical submit runtime emits enrollment packet submitted workflow notifications", () => {
  const completionCascadeSource = readWorkspaceFile("lib/services/enrollment-packet-completion-cascade.ts");
  const mappingRuntimeSource = readWorkspaceFile("lib/services/enrollment-packet-mapping-runtime.ts");

  assert.equal(completionCascadeSource.includes("recordEnrollmentPacketSubmittedMilestone"), true);
  assert.equal(mappingRuntimeSource.includes('eventType: "enrollment_packet_submitted"'), true);
  assert.equal(mappingRuntimeSource.includes('eventKeySuffix: "submitted"'), true);
  assert.equal(mappingRuntimeSource.includes("requireRecipients: true"), true);
});

test("historical enrollment packet repair is exposed only through the canonical service and safe CLI runner", () => {
  const completionCascadeSource = readWorkspaceFile("lib/services/enrollment-packet-completion-cascade.ts");
  const artifactSource = readWorkspaceFile("lib/services/enrollment-packet-artifacts.ts");
  const memberFileSource = readWorkspaceFile("lib/services/member-files.ts");
  const scriptSource = readWorkspaceFile("scripts/repair-enrollment-packet-completions.ts");
  const publicRuntimeSource = readWorkspaceFile("lib/services/enrollment-packets-public-runtime.ts");
  const finalizeSource = readWorkspaceFile("lib/services/enrollment-packets-public-runtime-finalize.ts");
  const packageSource = readWorkspaceFile("package.json");
  const replayMigrationSource = readWorkspaceFile(
    "supabase/migrations/0149_enrollment_packet_contact_replay_idempotency.sql"
  );
  const refreshMigrationSource = readWorkspaceFile(
    "supabase/migrations/0151_refresh_enrollment_packet_conversion_rpc_contact_replay_fix.sql"
  );

  assert.equal(
    completionCascadeSource.includes("listCommittedEnrollmentPacketCompletionRepairCandidates"),
    true
  );
  assert.equal(
    completionCascadeSource.includes('.eq("event_type", "enrollment_packet_submitted")'),
    true
  );
  assert.equal(
    completionCascadeSource.includes('.eq("event_type", "enrollment_packet_submitted")\n    .in("entity_id", normalizedPacketIds)'),
    true
  );
  assert.equal(
    completionCascadeSource.includes('.eq("outcome", "Enrollment Packet Completed")'),
    true
  );
  assert.equal(
    completionCascadeSource.includes('.eq("upload_category", "completed_packet")'),
    true
  );
  assert.equal(
    completionCascadeSource.includes('select("id, enrollment_packet_request_id")'),
    true
  );
  assert.equal(
    completionCascadeSource.includes('admin.from("member_command_centers").select("member_id").in("member_id", normalizedMemberIds)'),
    true
  );
  assert.equal(
    completionCascadeSource.includes('admin.from("member_attendance_schedules").select("member_id").in("member_id", normalizedMemberIds)'),
    true
  );
  assert.equal(
    completionCascadeSource.includes('admin.from("member_health_profiles").select("member_id").in("member_id", normalizedMemberIds)'),
    true
  );
  assert.equal(scriptSource.includes("Use --apply to replay the canonical enrollment packet completion cascade."), true);
  assert.equal(
    scriptSource.includes("ALLOW_REMOTE_ENROLLMENT_PACKET_REPAIR"),
    true
  );
  assert.equal(
    scriptSource.includes("listCommittedEnrollmentPacketCompletionRepairCandidates"),
    true
  );
  assert.equal(scriptSource.includes("repairCommittedEnrollmentPacketCompletions"), true);
  assert.equal(
    publicRuntimeSource.includes("buildCommittedEnrollmentPacketReplayResult"),
    true
  );
  assert.equal(
    finalizeSource.includes("buildCommittedEnrollmentPacketReplayResult"),
    true
  );
  assert.equal(
    artifactSource.includes('return `enrollment-packet:${input.packetId}:completed`;'),
    true
  );
  assert.equal(
    artifactSource.includes('if (uploadCategory === "completed_packet") return "Enrollment Packet";'),
    true
  );
  assert.equal(
    artifactSource.includes("repairEnrollmentPacketUploadMemberFileLinks"),
    true
  );
  assert.equal(
    memberFileSource.includes('| \"Enrollment Packet\"'),
    true
  );
  assert.equal(
    packageSource.includes("\"repair:enrollment-packet-completions\""),
    true
  );
  assert.equal(
    replayMigrationSource.includes("and mc.id = nullif(trim(coalesce(v_contact ->> 'id', '')), '')"),
    true
  );
  assert.equal(
    refreshMigrationSource.includes("mc.id = nullif(trim(coalesce(v_contact ->> 'id', '')), '')"),
    true
  );
});
