import type { EnrollmentPacketIntakePayload } from "@/lib/services/enrollment-packet-intake-payload";

import type { EnrollmentPacketFieldDefinition } from "@/lib/services/enrollment-packet-public-schema";

export type EnrollmentPacketCompletionValidationResult = {
  isComplete: boolean;
  missingItems: string[];
};

function clean(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function hasValue(value: string | null | undefined) {
  return clean(value) != null;
}

function hasAcknowledged(value: string | null | undefined) {
  const normalized = clean(value)?.toLowerCase();
  if (!normalized) return false;
  return ["acknowledged", "yes", "true", "1", "checked"].includes(normalized);
}

function isYes(value: string | null | undefined) {
  const normalized = clean(value)?.toLowerCase();
  return normalized === "yes" || normalized === "true" || normalized === "1";
}

function isSelectedCreditCard(value: string | null | undefined) {
  return clean(value)?.toLowerCase() === "credit card";
}

function isSelectedAch(value: string | null | undefined) {
  return clean(value)?.toLowerCase() === "ach";
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

  if (isSelectedAch(payload.paymentMethodSelection)) {
    if (!hasValue(payload.bankName)) missingItems.push("Bank name");
    if (!hasValue(payload.bankAba)) missingItems.push("Routing number");
    if (!hasValue(payload.bankAccountNumber)) missingItems.push("Account number");
  }

  if (isSelectedCreditCard(payload.paymentMethodSelection)) {
    if (!hasValue(payload.cardNumber)) missingItems.push("Card number");
    if (!hasValue(payload.cardExpiration)) missingItems.push("Card expiration");
    if (!hasValue(payload.cardCvv)) missingItems.push("Card CVV");
    if (!hasValue(payload.cardBillingAddressLine1)) missingItems.push("Card billing street address");
    if (!hasValue(payload.cardBillingCity)) missingItems.push("Card billing city/town");
    if (!hasValue(payload.cardBillingState)) missingItems.push("Card billing state");
    if (!hasValue(payload.cardBillingZip)) missingItems.push("Card billing ZIP code");
  }

  if (!hasValue(payload.membershipMemberSignatureName)) missingItems.push("Membership member signature name");
  if (!hasValue(payload.membershipMemberSignatureDate)) missingItems.push("Membership member signature date");
  if (!hasValue(payload.membershipGuarantorSignatureName)) {
    missingItems.push("Membership responsible party / guarantor signature name");
  }
  if (!hasValue(payload.exhibitAGuarantorSignatureName)) {
    missingItems.push("Exhibit A responsible party / guarantor acknowledgement name");
  }

  if (!hasAcknowledged(payload.privacyPracticesAcknowledged)) {
    missingItems.push("Privacy Practices acknowledgement");
  }
  if (!hasAcknowledged(payload.statementOfRightsAcknowledged)) {
    missingItems.push("Statement of Rights acknowledgement");
  }
  if (!hasAcknowledged(payload.photoConsentAcknowledged)) {
    missingItems.push("Photo Consent acknowledgement");
  }
  if (!hasAcknowledged(payload.ancillaryChargesAcknowledged)) {
    missingItems.push("Ancillary Charges acknowledgement");
  }

  if (!hasValue(payload.photoConsentChoice)) {
    missingItems.push("Photo consent selection");
  }

  return {
    isComplete: missingItems.length === 0,
    missingItems
  };
}

export function formatEnrollmentPacketValue(value: string | string[] | null | undefined) {
  if (Array.isArray(value)) {
    return value.length > 0 ? value.join(", ") : "-";
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
