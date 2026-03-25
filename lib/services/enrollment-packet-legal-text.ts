import {
  buildRenderedMembershipAgreementParagraphs,
  buildRenderedMembershipAgreementExecutionLines,
  buildRenderedMembershipExhibitAContent,
  FIRST_DAY_WELCOME_LETTER_TEMPLATE
} from "@/lib/services/enrollment-packet-membership-document";
import {
  buildRenderedAncillaryChargesNotice,
  buildRenderedPhotoConsentNotice,
  buildRenderedPrivacyPracticesNotice,
  buildRenderedStatementOfRightsNotice
} from "@/lib/services/enrollment-packet-notices";

export function buildEnrollmentPacketLegalText(input?: {
  caregiverName?: string | null;
  memberName?: string | null;
  membershipSignatureName?: string | null;
  membershipSignatureDate?: string | null;
  paymentMethodSelection?: string | null;
  communityFee?: string | null;
  totalInitialEnrollmentAmount?: string | null;
  photoConsentChoice?: string | null;
}) {
  const exhibitAContent = buildRenderedMembershipExhibitAContent({
    paymentMethodSelection: input?.paymentMethodSelection,
    communityFee: input?.communityFee,
    totalInitialEnrollmentAmount: input?.totalInitialEnrollmentAmount
  });

  return {
    membershipAgreement: buildRenderedMembershipAgreementParagraphs(
      input?.caregiverName,
      input?.memberName
    ),
    membershipAgreementExecution: buildRenderedMembershipAgreementExecutionLines({
      signatureName: input?.membershipSignatureName,
      signatureDate: input?.membershipSignatureDate
    }),
    exhibitAPaymentAuthorization: [...exhibitAContent.allParagraphs],
    exhibitAPaymentAuthorizationCommon: [...exhibitAContent.commonParagraphs],
    exhibitAPaymentAuthorizationSelected: [...exhibitAContent.authorizationParagraphs],
    privacyPractices: buildRenderedPrivacyPracticesNotice(),
    statementOfRights: buildRenderedStatementOfRightsNotice(),
    photoConsent: buildRenderedPhotoConsentNotice({
      photoConsentChoice: input?.photoConsentChoice
    }),
    ancillaryCharges: buildRenderedAncillaryChargesNotice(),
    firstDayWelcome: [...FIRST_DAY_WELCOME_LETTER_TEMPLATE]
  } as const;
}

export const ENROLLMENT_PACKET_LEGAL_TEXT = buildEnrollmentPacketLegalText();
