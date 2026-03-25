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

test("public enrollment packet submission redirects to confirmation where the welcome letter is rendered", () => {
  const actionSource = readWorkspaceFile("app/sign/enrollment-packet/[token]/actions.ts");
  const confirmationSource = readWorkspaceFile(
    "app/sign/enrollment-packet/[token]/confirmation/page.tsx"
  );
  const formSource = readWorkspaceFile("components/enrollment-packets/enrollment-packet-public-form.tsx");

  assert.equal(
    actionSource.includes("redirect(`/sign/enrollment-packet/${encodeURIComponent(token)}/confirmation`);"),
    true
  );
  assert.equal(formSource.includes("window.location.assign(result.redirectUrl);"), false);
  assert.equal(formSource.includes("router.replace(result.redirectUrl);"), false);
  assert.equal(confirmationSource.includes("First Day Welcome Letter"), true);
  assert.equal(confirmationSource.includes("legalText.firstDayWelcome.map"), true);
});

test("already-filed public enrollment packet submissions use the replay-safe confirmation path", () => {
  const runtimeSource = readWorkspaceFile("lib/services/enrollment-packets-public-runtime.ts");

  assert.equal(
    runtimeSource.includes('throw new Error("This enrollment packet has already been submitted.");'),
    false
  );
  assert.equal(
    runtimeSource.includes("return buildCommittedEnrollmentPacketReplayResult({ request });"),
    true
  );
  assert.equal(
    runtimeSource.includes('submitResult.operationalReadinessStatus !== "operationally_ready"'),
    true
  );
});

test("completion cascade centralizes submitted notification and downstream repair-safe sync", () => {
  const cascadeSource = readWorkspaceFile("lib/services/enrollment-packet-completion-cascade.ts");
  const runtimeSource = readWorkspaceFile("lib/services/enrollment-packets-public-runtime.ts");
  const mappingRuntimeSource = readWorkspaceFile("lib/services/enrollment-packet-mapping-runtime.ts");

  assert.equal(cascadeSource.includes("repairCommittedEnrollmentPacketCompletions"), true);
  assert.equal(cascadeSource.includes("runEnrollmentPacketDownstreamMapping({"), true);
  assert.equal(cascadeSource.includes("recordEnrollmentPacketSubmittedMilestone({"), true);
  assert.equal(cascadeSource.includes("syncEnrollmentPacketLeadActivityOrQueue({"), true);
  assert.equal(runtimeSource.includes("runEnrollmentPacketCompletionCascade({"), true);
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
    pdfSource.includes('drawTitle(`${DOCUMENT_CENTER_NAME} Enrollment Packet`);'),
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

test("canonical enrollment packet submit path emits the submitted workflow milestone and lead conversion repairs shell rows", () => {
  const publicRuntimeSource = readWorkspaceFile("lib/services/enrollment-packets-public-runtime.ts");
  const completionCascadeSource = readWorkspaceFile("lib/services/enrollment-packet-completion-cascade.ts");
  const leadConversionSource = readWorkspaceFile("lib/services/sales-lead-conversion-supabase.ts");
  const mappingRuntimeSource = readWorkspaceFile("lib/services/enrollment-packet-mapping-runtime.ts");

  assert.equal(publicRuntimeSource.includes("runEnrollmentPacketCompletionCascade"), true);
  assert.equal(completionCascadeSource.includes("recordEnrollmentPacketSubmittedMilestone"), true);
  assert.equal(mappingRuntimeSource.includes('eventType: "enrollment_packet_submitted"'), true);
  assert.equal(leadConversionSource.includes("ensureLeadConversionMemberShellRows"), true);
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
    publicRuntimeSource.includes("repairEnrollmentPacketCompletionCascade"),
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
