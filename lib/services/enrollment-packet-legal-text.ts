import {
  buildRenderedMembershipAgreementParagraphs,
  CANONICAL_MEMBERSHIP_EXHIBIT_A_TEMPLATE,
  FIRST_DAY_WELCOME_LETTER_TEMPLATE
} from "@/lib/services/enrollment-packet-membership-document";
import {
  CANONICAL_ANCILLARY_CHARGES_NOTICE,
  CANONICAL_PHOTO_CONSENT_NOTICE,
  CANONICAL_PRIVACY_PRACTICES_NOTICE,
  CANONICAL_STATEMENT_OF_RIGHTS_NOTICE
} from "@/lib/services/enrollment-packet-notices";

export function buildEnrollmentPacketLegalText(input?: {
  caregiverName?: string | null;
  memberName?: string | null;
}) {
  return {
    membershipAgreement: buildRenderedMembershipAgreementParagraphs(
      input?.caregiverName,
      input?.memberName
    ),
    exhibitAPaymentAuthorization: [...CANONICAL_MEMBERSHIP_EXHIBIT_A_TEMPLATE],
    privacyPractices: [...CANONICAL_PRIVACY_PRACTICES_NOTICE],
    statementOfRights: [...CANONICAL_STATEMENT_OF_RIGHTS_NOTICE],
    photoConsent: [...CANONICAL_PHOTO_CONSENT_NOTICE],
    ancillaryCharges: [...CANONICAL_ANCILLARY_CHARGES_NOTICE],
    firstDayWelcome: [...FIRST_DAY_WELCOME_LETTER_TEMPLATE]
  } as const;
}

export const ENROLLMENT_PACKET_LEGAL_TEXT = buildEnrollmentPacketLegalText();
