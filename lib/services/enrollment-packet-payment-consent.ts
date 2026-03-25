import {
  normalizeEnrollmentPacketIntakePayload,
  type EnrollmentPacketIntakePayload,
  type EnrollmentPacketIntakeTextKey
} from "@/lib/services/enrollment-packet-intake-payload";

export const ENROLLMENT_PACKET_PAYMENT_METHOD_OPTIONS = ["ACH", "Credit Card"] as const;
export type EnrollmentPacketPaymentMethod =
  (typeof ENROLLMENT_PACKET_PAYMENT_METHOD_OPTIONS)[number];

export const ENROLLMENT_PACKET_CARD_TYPE_OPTIONS = [
  "Visa",
  "MasterCard",
  "Amex",
  "Discover"
] as const;

export type EnrollmentPacketNoticeAcknowledgmentDefinition = {
  id: "privacy" | "rights" | "ancillary";
  label: string;
  nameKey: EnrollmentPacketIntakeTextKey;
  dateKey: EnrollmentPacketIntakeTextKey;
};

export const ENROLLMENT_PACKET_NOTICE_ACKNOWLEDGMENTS: readonly EnrollmentPacketNoticeAcknowledgmentDefinition[] =
  [
    {
      id: "privacy",
      label: "Privacy practices acknowledgement",
      nameKey: "privacyAcknowledgmentSignatureName",
      dateKey: "privacyAcknowledgmentSignatureDate"
    },
    {
      id: "rights",
      label: "Statement of rights acknowledgement",
      nameKey: "rightsAcknowledgmentSignatureName",
      dateKey: "rightsAcknowledgmentSignatureDate"
    },
    {
      id: "ancillary",
      label: "Ancillary charges acknowledgement",
      nameKey: "ancillaryChargesAcknowledgmentSignatureName",
      dateKey: "ancillaryChargesAcknowledgmentSignatureDate"
    }
  ] as const;

const ACH_ONLY_TEXT_KEYS: readonly EnrollmentPacketIntakeTextKey[] = [
  "bankName",
  "bankCityStateZip",
  "bankAba",
  "bankAccountNumber"
] as const;

const CREDIT_CARD_ONLY_TEXT_KEYS: readonly EnrollmentPacketIntakeTextKey[] = [
  "cardholderName",
  "cardType",
  "cardNumber",
  "cardExpiration",
  "cardCvv",
  "cardBillingAddress",
  "cardBillingAddressLine1",
  "cardBillingCity",
  "cardBillingState",
  "cardBillingZip",
  "cardUsePrimaryContactAddress"
] as const;

function clean(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

export function getEnrollmentPacketPaymentMethod(
  value: string | null | undefined
): EnrollmentPacketPaymentMethod | null {
  const normalized = clean(value);
  if (!normalized) return null;
  const match = ENROLLMENT_PACKET_PAYMENT_METHOD_OPTIONS.find((option) => option === normalized);
  return match ?? null;
}

export function isEnrollmentPacketAchPaymentMethod(value: string | null | undefined) {
  return getEnrollmentPacketPaymentMethod(value) === "ACH";
}

export function isEnrollmentPacketCreditCardPaymentMethod(value: string | null | undefined) {
  return getEnrollmentPacketPaymentMethod(value) === "Credit Card";
}

export function getEnrollmentPacketDefaultSignerName(
  payload: Pick<
    EnrollmentPacketIntakePayload,
    "membershipGuarantorSignatureName" | "primaryContactName"
  >
) {
  return clean(payload.membershipGuarantorSignatureName) ?? clean(payload.primaryContactName);
}

export function hasEnrollmentPacketAcknowledgment(
  payload: EnrollmentPacketIntakePayload,
  definition: EnrollmentPacketNoticeAcknowledgmentDefinition
) {
  return clean(payload[definition.nameKey]) != null && clean(payload[definition.dateKey]) != null;
}

export function setEnrollmentPacketAcknowledgment(
  payload: EnrollmentPacketIntakePayload,
  definition: EnrollmentPacketNoticeAcknowledgmentDefinition,
  checked: boolean,
  signerName: string | null | undefined,
  signedDate: string
) {
  return normalizeEnrollmentPacketIntakePayload({
    ...payload,
    [definition.nameKey]: checked ? clean(signerName) : null,
    [definition.dateKey]: checked ? clean(signedDate) : null
  });
}

export function hasEnrollmentPacketPaymentAuthorizationAcknowledgment(
  payload: EnrollmentPacketIntakePayload
) {
  return clean(payload.exhibitAGuarantorSignatureName) != null;
}

export function setEnrollmentPacketPaymentAuthorizationAcknowledgment(
  payload: EnrollmentPacketIntakePayload,
  checked: boolean,
  signerName: string | null | undefined
) {
  return normalizeEnrollmentPacketIntakePayload({
    ...payload,
    exhibitAGuarantorSignatureName: checked ? clean(signerName) : null
  });
}

export function setEnrollmentPacketPaymentMethod(
  payload: EnrollmentPacketIntakePayload,
  value: string | null | undefined
) {
  const paymentMethod = getEnrollmentPacketPaymentMethod(value);
  const patch: Partial<Record<EnrollmentPacketIntakeTextKey, string | null>> = {
    paymentMethodSelection: paymentMethod
  };

  if (paymentMethod === "ACH") {
    CREDIT_CARD_ONLY_TEXT_KEYS.forEach((key) => {
      patch[key] = null;
    });
    patch.exhibitAGuarantorSignatureName = null;
  } else if (paymentMethod === "Credit Card") {
    ACH_ONLY_TEXT_KEYS.forEach((key) => {
      patch[key] = null;
    });
    patch.exhibitAGuarantorSignatureName = null;
  } else {
    ACH_ONLY_TEXT_KEYS.forEach((key) => {
      patch[key] = null;
    });
    CREDIT_CARD_ONLY_TEXT_KEYS.forEach((key) => {
      patch[key] = null;
    });
    patch.exhibitAGuarantorSignatureName = null;
  }

  return normalizeEnrollmentPacketIntakePayload({
    ...payload,
    ...patch
  });
}
