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
import {
  ENROLLMENT_PACKET_INTAKE_TEXT_KEYS,
  normalizeEnrollmentPacketIntakePayload,
  type EnrollmentPacketIntakePayload
} from "@/lib/services/enrollment-packet-intake-payload";
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
    bankAba: "123456789",
    bankAccountNumber: "1234567890",
    membershipGuarantorSignatureName: "Jane Caregiver",
    membershipGuarantorSignatureDate: "2026-03-25",
    exhibitAGuarantorSignatureName: "Jane Caregiver",
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

test("enrollment packet intake normalization preserves internal spaces for human-readable text fields", () => {
  const payload = normalizeEnrollmentPacketIntakePayload({
    pcpName: "  Dr. Jane Smith  ",
    pharmacy: "  Town Square Pharmacy  ",
    pharmacyAddress: "  321 Pharmacy Blvd, Suite A  ",
    bankName: "  First National Bank  "
  });

  assert.equal(payload.pcpName, "Dr. Jane Smith");
  assert.equal(payload.pharmacy, "Town Square Pharmacy");
  assert.equal(payload.pharmacyAddress, "321 Pharmacy Blvd, Suite A");
  assert.equal(payload.bankName, "First National Bank");
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

test("member signature fields are removed from the canonical enrollment packet payload model", () => {
  const intakeKeys = new Set<string>(ENROLLMENT_PACKET_INTAKE_TEXT_KEYS);

  assert.equal(intakeKeys.has("membershipMemberSignatureName"), false);
  assert.equal(intakeKeys.has("membershipMemberSignatureDate"), false);
  assert.equal(intakeKeys.has("exhibitAMemberSignatureName"), false);
  assert.equal(intakeKeys.has("exhibitAMemberSignatureDate"), false);
});

test("public enrollment packet submission redirects to confirmation where the welcome letter is rendered", () => {
  const actionSource = readWorkspaceFile("app/sign/enrollment-packet/[token]/actions.ts");
  const confirmationSource = readWorkspaceFile(
    "app/sign/enrollment-packet/[token]/confirmation/page.tsx"
  );

  assert.equal(
    actionSource.includes("redirectUrl: `/sign/enrollment-packet/${encodeURIComponent(token)}/confirmation`"),
    true
  );
  assert.equal(confirmationSource.includes("First Day Welcome Letter"), true);
  assert.equal(confirmationSource.includes("legalText.firstDayWelcome.map"), true);
});
