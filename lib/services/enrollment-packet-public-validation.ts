import type { EnrollmentPacketIntakePayload } from "@/lib/services/enrollment-packet-intake-payload";
import { ENROLLMENT_PACKET_PHOTO_CONSENT_OPTIONS } from "@/lib/services/enrollment-packet-public-options";
import {
  ENROLLMENT_PACKET_NOTICE_ACKNOWLEDGMENTS,
  isEnrollmentPacketAchPaymentMethod,
  isEnrollmentPacketCreditCardPaymentMethod
} from "@/lib/services/enrollment-packet-payment-consent";
import {
  formatEnrollmentPacketRecreationInterests,
  hasEnrollmentPacketRecreationSelections
} from "@/lib/services/enrollment-packet-recreation";

import type { EnrollmentPacketFieldDefinition } from "@/lib/services/enrollment-packet-public-schema";

export type EnrollmentPacketCompletionValidationResult = {
  isComplete: boolean;
  missingItems: string[];
};

export type EnrollmentPacketSubmissionValidationResult = EnrollmentPacketCompletionValidationResult & {
  signatureErrors: string[];
};

function clean(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function hasValue(value: string | null | undefined) {
  return clean(value) != null;
}

function isYes(value: string | null | undefined) {
  const normalized = clean(value)?.toLowerCase();
  return normalized === "yes" || normalized === "true" || normalized === "1";
}

function isValidPhotoConsentChoice(value: string | null | undefined) {
  const normalized = clean(value);
  return normalized != null && ENROLLMENT_PACKET_PHOTO_CONSENT_OPTIONS.includes(normalized as never);
}

export function validateEnrollmentPacketCompletion(input: {
  payload: EnrollmentPacketIntakePayload;
}): EnrollmentPacketCompletionValidationResult {
  const { payload } = input;
  const missingItems: string[] = [];

  if (!hasValue(payload.memberLegalFirstName) || !hasValue(payload.memberLegalLastName)) {
    missingItems.push("Member name");
  }
  if (!hasValue(payload.memberDob)) missingItems.push("Member DOB");
  if (!hasValue(payload.memberGender)) missingItems.push("Member gender");
  if (!hasValue(payload.memberAddressLine1)) missingItems.push("Member street address");
  if (!hasValue(payload.memberCity)) missingItems.push("Member city/town");
  if (!hasValue(payload.memberState)) missingItems.push("Member state");
  if (!hasValue(payload.memberZip)) missingItems.push("Member ZIP code");

  if (!hasValue(payload.primaryContactName)) missingItems.push("Primary contact name");
  if (!hasValue(payload.primaryContactRelationship)) missingItems.push("Primary contact relationship");
  if (!hasValue(payload.primaryContactPhone)) missingItems.push("Primary contact phone");
  if (!hasValue(payload.primaryContactEmail)) missingItems.push("Primary contact email");
  if (!hasValue(payload.primaryContactAddressLine1)) missingItems.push("Primary contact street address");
  if (!hasValue(payload.primaryContactCity)) missingItems.push("Primary contact city/town");
  if (!hasValue(payload.primaryContactState)) missingItems.push("Primary contact state");
  if (!hasValue(payload.primaryContactZip)) missingItems.push("Primary contact ZIP code");

  if (!hasValue(payload.secondaryContactName)) missingItems.push("Secondary contact name");
  if (!hasValue(payload.secondaryContactRelationship)) missingItems.push("Secondary contact relationship");
  if (!hasValue(payload.secondaryContactPhone)) missingItems.push("Secondary contact phone");
  if (!hasValue(payload.secondaryContactEmail)) missingItems.push("Secondary contact email");
  if (!hasValue(payload.secondaryContactAddressLine1)) missingItems.push("Secondary contact street address");
  if (!hasValue(payload.secondaryContactCity)) missingItems.push("Secondary contact city/town");
  if (!hasValue(payload.secondaryContactState)) missingItems.push("Secondary contact state");
  if (!hasValue(payload.secondaryContactZip)) missingItems.push("Secondary contact ZIP code");

  if (!hasValue(payload.pcpName)) missingItems.push("PCP name");
  if (!hasValue(payload.pcpAddress)) missingItems.push("PCP address");
  if (!hasValue(payload.pcpPhone)) missingItems.push("PCP phone");

  if (!hasValue(payload.pharmacy)) missingItems.push("Pharmacy name");
  if (!hasValue(payload.pharmacyAddress)) missingItems.push("Pharmacy address");
  if (!hasValue(payload.pharmacyPhone)) missingItems.push("Pharmacy phone");

  if (!hasValue(payload.requestedStartDate)) missingItems.push("Requested start date");
  if (!hasValue(payload.totalInitialEnrollmentAmount)) missingItems.push("Total initial enrollment amount");
  if (!hasValue(payload.paymentMethodSelection)) missingItems.push("Payment method selection");

  if (isYes(payload.veteranStatus) && !hasValue(payload.branchOfService)) {
    missingItems.push("Branch of service");
  }

  if (isYes(payload.vaBenefits) && !hasValue(payload.tricareNumber)) {
    missingItems.push("Tricare number");
  }

  if (isYes(payload.medicationNeededDuringDay) && !hasValue(payload.medicationNamesDuringDay)) {
    missingItems.push("Medication names");
  }

  if (isYes(payload.oxygenUse) && !hasValue(payload.oxygenFlowRate)) {
    missingItems.push("Oxygen flow rate");
  }

  if (!hasValue(payload.fallsHistory)) {
    missingItems.push("History of falls");
  } else if (isYes(payload.fallsHistory) && !hasValue(payload.fallsWithinLast3Months)) {
    missingItems.push("Falls within last 3 months");
  }

  if (payload.petTypes.length > 0 && !hasValue(payload.petNames)) {
    missingItems.push("Pet names");
  }

  if (isYes(payload.dentures) && payload.dentureTypes.length === 0) {
    missingItems.push("Dentures selection (upper/lower)");
  }

  if (isEnrollmentPacketAchPaymentMethod(payload.paymentMethodSelection)) {
    if (!hasValue(payload.bankName)) missingItems.push("Bank name");
    if (!hasValue(payload.bankCityStateZip)) missingItems.push("Bank city/state/ZIP");
    if (!hasValue(payload.bankAba)) missingItems.push("Routing number");
    if (!hasValue(payload.bankAccountNumber)) missingItems.push("Account number");
    if (!hasValue(payload.exhibitAGuarantorSignatureName)) {
      missingItems.push("ACH authorization acknowledgement");
    }
  }

  if (isEnrollmentPacketCreditCardPaymentMethod(payload.paymentMethodSelection)) {
    if (!hasValue(payload.cardholderName)) missingItems.push("Cardholder name");
    if (!hasValue(payload.cardType)) missingItems.push("Card type");
    if (!hasValue(payload.cardNumber)) missingItems.push("Card number");
    if (!hasValue(payload.cardExpiration)) missingItems.push("Card expiration");
    if (!hasValue(payload.cardCvv)) missingItems.push("Card CVV");
    if (!hasValue(payload.cardBillingAddressLine1)) missingItems.push("Card billing street address");
    if (!hasValue(payload.cardBillingCity)) missingItems.push("Card billing city/town");
    if (!hasValue(payload.cardBillingState)) missingItems.push("Card billing state");
    if (!hasValue(payload.cardBillingZip)) missingItems.push("Card billing ZIP code");
    if (!hasValue(payload.exhibitAGuarantorSignatureName)) {
      missingItems.push("Credit card authorization acknowledgement");
    }
  }

  if (!hasValue(payload.membershipGuarantorSignatureName)) {
    missingItems.push("Membership Agreement signature");
  }
  if (!hasValue(payload.membershipGuarantorSignatureDate)) {
    missingItems.push("Membership Agreement signature date");
  }

  ENROLLMENT_PACKET_NOTICE_ACKNOWLEDGMENTS.forEach((definition) => {
    if (!hasValue(payload[definition.nameKey]) || !hasValue(payload[definition.dateKey])) {
      missingItems.push(definition.label);
    }
  });

  if (!isValidPhotoConsentChoice(payload.photoConsentChoice)) {
    missingItems.push("Photo consent selection");
  }
  if (!hasEnrollmentPacketRecreationSelections(payload.recreationInterests)) {
    missingItems.push("Recreation interests");
  }

  return {
    isComplete: missingItems.length === 0,
    missingItems
  };
}

export function validateEnrollmentPacketSubmission(input: {
  payload: EnrollmentPacketIntakePayload;
  caregiverTypedName: string | null | undefined;
  hasSignature: boolean;
  attested: boolean;
}): EnrollmentPacketSubmissionValidationResult {
  const completion = validateEnrollmentPacketCompletion({ payload: input.payload });
  const signatureErrors: string[] = [];

  if (!hasValue(input.caregiverTypedName)) {
    signatureErrors.push("Caregiver signature name is required.");
  }
  if (!input.hasSignature) {
    signatureErrors.push("Caregiver signature is required.");
  }
  if (!input.attested) {
    signatureErrors.push("Caregiver signature attestation is required.");
  }

  return {
    isComplete: completion.isComplete && signatureErrors.length === 0,
    missingItems: completion.missingItems,
    signatureErrors
  };
}

export function formatEnrollmentPacketValue(
  value:
    | string
    | string[]
    | EnrollmentPacketIntakePayload["recreationInterests"]
    | null
    | undefined
) {
  if (Array.isArray(value)) {
    return value.length > 0 ? value.join(", ") : "-";
  }
  if (value && typeof value === "object") {
    return formatEnrollmentPacketRecreationInterests(value);
  }
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : "-";
  }
  return "-";
}

export function getEnrollmentPacketFieldDisplayValue(
  payload: EnrollmentPacketIntakePayload,
  field: EnrollmentPacketFieldDefinition
) {
  return formatEnrollmentPacketValue(payload[field.key]);
}
