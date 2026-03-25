import {
  buildRenderedMembershipAgreementParagraphs,
  buildRenderedMembershipExhibitAContent,
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
  paymentMethodSelection?: string | null;
  communityFee?: string | null;
  totalInitialEnrollmentAmount?: string | null;
  exhibitAAuthorizationAcknowledged?: boolean;
}) {
  const exhibitAContent = buildRenderedMembershipExhibitAContent({
    paymentMethodSelection: input?.paymentMethodSelection,
    communityFee: input?.communityFee,
    totalInitialEnrollmentAmount: input?.totalInitialEnrollmentAmount,
    authorizationAcknowledged: input?.exhibitAAuthorizationAcknowledged
  });

  return {
    membershipAgreement: buildRenderedMembershipAgreementParagraphs(
      input?.caregiverName,
      input?.memberName
    ),
    exhibitAPaymentAuthorization: [...exhibitAContent.allParagraphs],
    exhibitAPaymentAuthorizationCommon: [...exhibitAContent.commonParagraphs],
    exhibitAPaymentAuthorizationSelected: [...exhibitAContent.authorizationParagraphs],
    privacyPractices: [...CANONICAL_PRIVACY_PRACTICES_NOTICE],
    statementOfRights: [...CANONICAL_STATEMENT_OF_RIGHTS_NOTICE],
    photoConsent: [...CANONICAL_PHOTO_CONSENT_NOTICE],
    ancillaryCharges: [...CANONICAL_ANCILLARY_CHARGES_NOTICE],
    firstDayWelcome: [...FIRST_DAY_WELCOME_LETTER_TEMPLATE]
  } as const;
}

export const ENROLLMENT_PACKET_LEGAL_TEXT = buildEnrollmentPacketLegalText();
