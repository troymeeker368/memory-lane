import {
  getEnrollmentPacketPaymentMethod,
  type EnrollmentPacketPaymentMethod
} from "@/lib/services/enrollment-packet-payment-consent";

function clean(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

const MEMBERSHIP_AGREEMENT_RENDER_TRUNCATION_MARKER = "RESPONSIBLE PARTY/GUARANTOR INFORMATION:";
const MEMBERSHIP_AGREEMENT_MEMBER_PLACEHOLDER = "__________________";

const MEMBERSHIP_AGREEMENT_INTRO_TEMPLATE =
  "This Membership Agreement (the “Agreement’) is entered into by and between Town Square Fort Mill (“Town Square”) located at 368 Fort Mill Parkway, Suite 106, Fort Mill, SC 29715 and __________________ (Member) and {{caregiverName}} (Responsible Party).";

export const CANONICAL_MEMBERSHIP_AGREEMENT_TEMPLATE = [
  "MEMBERSHIP AGREEMENT",
  MEMBERSHIP_AGREEMENT_INTRO_TEMPLATE,
  "Services: Town Square shall provide adult day care and support services to Member at its Town Square facility at the address above (the “Center”). The adult day care and support services that are available to the Member include, assistance with activities of daily living, education programs, physical activities, health monitoring, social activities, preparation of meals/snacks, and coordination of transportation services.",
  "Extra Services are available outside the basic daily charge. To take advantage of either of these services, please contact the Town Square Director.",
  "A working barber/ hair salon offers several ancillary services for an additional fee.",
  "Shower Assistance: Town Square also understands that showers may become harder to manage at home, and we can help provide shower assistance for an additional $25 fee.",
  "Fees: Member shall pay the applicable fees as provided on Exhibit A, which is attached and incorporated by reference, at the time of enrollment and then thereafter on a monthly basis. This is payable by the first of the month. Fees shall be paid by ACH direct debit of Member’s assigned bank account. Accounts not paid within terms are subject to a 1.5% per invoice finance charge plus attorney’s fees and costs of collection. The first payment will include the non-refundable center fee and the daily rate for the upcoming month of attendance. Moving forward, the member will be billed on the first business day of the month for all scheduled attendance days for the upcoming month. Any additional days attended will be added to the next month's invoice. Invoices will be issued on/about the 25th of every month for the following month. Accounts will be auto drafted on/about the 1st of every month for the present month. Payment made by credit card for the initial charges are subject to a 3% fee, otherwise a check will be accepted for this payment. The member will be unable to attend the Town Square Center until all past balances are collected. Should any fee need to change the center will provide a 30-day written notice.",
  "Scheduling: Member or their representative shall schedule the dates and times that they will be attending the Center. The schedule shall be selected on the Enrollment Form. If Member is unable to attend a scheduled day for a foreseeable absence, the Member or their representative must notify the Center 2 days in advance. If less notice is given, the center will bill for the day (up to a scheduled week) but allow make-up days to be used within that same month. The make-up day can be used on not regularly scheduled days. The Member or Responsible Party shall notify the center of all absences and the reason.",
  "Please refer to the Welcome Guide regarding holiday closings and weather closings. Should the center close due to inclement weather, the member shall not be billed for that day.",
  "Services Provided: Included in the daily charge and during operating hours:",
  "An activity program as outlined on monthly activity calendar, nursing service (medication administering, health education, health monitoring), supervision or assistance with activities of daily living, meal service (continental breakfast, hot lunch, snack).",
  "Services available outside the basic daily charge include extended hours: These hours include 8:00am-8:30am and 4:30pm-5:00pm. The charges for this service are outlined in the Welcome Guide.",
  "Emergencies: In the event of an emergency, personnel of the Center are authorized to take such measures for the Member’s welfare as may be professionally appropriate, including transfer to an emergency center. The Center will make all efforts to honor hospital preference but not guarantee. Member hereby grants Center personnel with access to Member’s medical records for purposes of providing Member with appropriate care and to fulfill Town Square’s obligations under this Agreement.",
  "Members’ Responsibilities: Member will remain under the care of a Healthcare Practitioner while enrolled in Town Square. Should a member change their Healthcare Practitioner the Center will be notified of the change, within 7 days. The Member or Responsible Party will also report to the Center Nurse any changes in medication, treatments, surgery, hospitalizations, ER visits, urgent medical care, falls, etc. If the member is hospitalized, discharge paperwork is required to resume attendance.",
  "Member Property: Member assumes full responsibility for any valuables that Member brings to the Center and Member shall respect the rights and personal property of others while at the Center.",
  "Termination of Membership: Town Square, in its sole discretion, may terminate a member’s membership if a member is deemed medically or behaviorally inappropriate. Town Square will formulate a discharge plan, including at least a 30-day written notice to the Member or the Member’s Responsible Party. The Center will assist the Member in obtaining the resources needed to implement the plan. The role of the center staff in these matters is solely to advise, refer, and recommend. Town Square does not have to give a 30-day written notice of discharge when the health or safety of the Member or other individuals in the center would be endangered by the continued presence of the Member, the Member has urgent medical needs, or there is an emergency requiring less than 30-days’ notice. Town Square will require the Member or the Responsible Party to provide at minimum a written 30- day notification to terminate services.",
  "Notice of Privacy Practices: The Notice of Privacy Practices provides information about how Town Square may use and disclose protected health information about the Member. The Member has the right to review this notice before signing this Agreement. As provided in the Notice, the terms of the Notice may change, however, the Member will be notified of any such change and will receive a copy of the new Notice. By signing this Agreement, the Member consents to Town Square’s use and disclosure of protected health information about Member for purposes of treatment, payment and health care operations. Member has the right to revoke this consent, in writing, except where Town Square has previously made a disclosure in reliance upon Member’s consent.",
  "Release: The Member hereby waives, releases, covenants not to sue and agrees to hold harmless Town Square, its officers, directors, shareholders, members, managers, agents, and employees, (collectively referred to herein as “Releasees”) from any claims (including, but not limited to claims arising as a result of Releasees’ negligence), suits, judgments, costs, and expenses for death, personal injury or property damage which may accrue as a result of or in relation to Town Square’s services or Member’s attendance of the Center. This release does not extend to claims for gross negligence, intentional or reckless misconduct or any other liabilities that the law does not permit to be excluded by agreement.",
  "Use of Photography/Video: Member permits and authorizes Town Square to use photographs or video of themselves while in attendance of the Center for publicity, marketing, training, and promotion of Town Square.",
  "Town Square’s Services Without Compensation: Member understands a photograph or video recording of them may be copied and distributed by means of various media, including, but not limited to, publications, video, television broadcasts/rebroadcasts, news releases, websites, brochures, social media, billboards or signs. Member acknowledges that Town Square has the right to take one or more photographs, videotape or disk presentations, or other electronic reproductions of Member in accordance with this provision.",
  "Security: Cameras may be used or installed by the Center in certain locations. These cameras may or may not be monitored by the Center. Any use of cameras or surveillance equipment by the Center should not be viewed as an absolute guarantee of safety or an absolute deterrent to theft. Nor shall the use of cameras create or infer any heightened duty by the Center to monitor, detect or predict incidents or conditions related to security of safety. Members (or their Responsible Party(ies) are encouraged to inquire with the Executive Director if you have any questions concerning the monitoring equipment in use; the locations of the equipment; and which components are enabled (video, audio, etc..).",
  "Member Rights: The Center has provided the Member and the Responsible Party with the State Member Rights. The Member and the Responsible Party acknowledge that they have received a copy of the description of Member Rights as set forth by the State of South Carolina and that they have had the opportunity to receive an explanation of these rights.",
  "Advance Directives: The Member may wish to execute advance directives which may include a durable power of attorney, health care power of attorney, living will, or other document recognized under State law to specify the Member's wishes about life sustaining treatment or other health care decisions should the Member become incapacitated and unable to communicate his or her desires.",
  "If the Member has executed such documents, or executes any such documents in the future, the Member and Responsible Party agree to provide the Center with a written and duly executed copy of the document to become part of the Member's record.",
  "Third Party Vendors/Services: Member acknowledges that any costs incurred by the Member for services provided by persons and providers other than the Center, or those contracted by the Center, are the responsibility of the Member and not the Center. The Member and/or the Payor are solely responsible for costs related to the Member's medical care.",
  "Off Premises Activities/Trips: The Center may occasionally plan outings off premises. Should this happen, the Member and Responsible Party will be notified of such an event.",
  "Binding Arbitration: Member agrees to binding arbitration pursuant to the commercial arbitration rules of the American Arbitration Association as the exclusive means to resolve all disputes arising from or related to this Agreement, with the exception of a Member’s failure to pay fees or other amounts owed to Town Square for which Town Square may file an action in an applicable court of law to recover. The arbitration shall be conducted in the county, city or state where the Town Square Center is located. In agreeing to binding arbitration, Member understands and acknowledges that they are waiving their right to have such claims decided in a court of law before a judge/jury.",
  "General Provisions: This Agreement constitutes and contains the entire agreement between the parties with respect to the subject matter hereof and supersedes any and all prior oral or written agreements. Each party acknowledges and agrees that the other party has not made any representation, warranties or agreements of any kind, except as expressly set forth herein. Town Square, without Member’s consent, may assign or transfer its rights and/or obligations under this Agreement to a purchaser of substantially all of Town Square’s business or assets. In no event will Town Square, its affiliates or any of its owners, managers, directors, officers, employees, or agents be liable for any indirect, punitive, special, incidental, and/or consequential damages in connection with the services provided hereunder. This Agreement shall be construed, interpreted and governed by the laws of the state where the Town Square Center is located without regard to its conflict of laws principles.",
  "RESPONSIBLE PARTY/GUARANTOR INFORMATION:",
  "First Name: ________________________________ Last Name: ______________________________________",
  "Date of Birth: __________________________ SSN: ________________________",
  "MEMBER INFORMATION:",
  "First Name: ________________________________ Last Name: ______________________________________",
  "Date of Birth: __________________________ SSN: ________________________",
  "TOWN SQUARE:",
  "Sign: ____________________________________",
  "Date: ________________________",
  "RESPONSIBLE PARTY/GUARANTOR:",
  "Sign: ____________________________________",
  "Date: ________________________",
  "NUMBER OF DAYS: _____________DAILY AMOUNT: $_______________",
  "REQUESTED SCHEDULED DAYS:",
  "Monday _______ Tuesday _______ Wednesday _______ Thursday _______ Friday _______"
] as const;

export const CANONICAL_MEMBERSHIP_EXHIBIT_A_TEMPLATE = [
  "Exhibit A: Payment Authorization & Fee Schedule",
  "FEES",
  "Daily Center Fee: • 1 day per week: $205 per day • 2–3 days per week: $180 per day • 4–5 days per week: $170 per day",
  "Community Fee: $_____________ due before the member's first day",
  "Total Amount Due for Initial Enrollment: $____________________",
  "We are a membership-based program. Billing is processed at the beginning of each month for the upcoming month of services.",
  "PAYMENT METHOD SELECTION",
  "Please select one payment option below:",
  "☐ ACH (Bank Draft)   ☐ Credit Card (Auto Charge)",
  "ACH AUTHORIZATION",
  "☐ I hereby authorize payments for all invoices to be debited using the checking/savings account listed below. I understand that my account will be drafted on or about the 1st day of each month. If for any reason a bank draft is returned by my bank, a $25 return fee will be applied to the account plus a 2% late fee. The undersigned guarantor hereby authorizes Town Square to initiate debit entries and/or credit correction entries to the undersigned’s checking and/or savings account(s) indicated below and the depository designated below (“Bank”) to debit or credit such account(s) pursuant to Town Square’s instructions.",
  "Bank Information",
  "Bank Name: _______________________________________ Attach a VOIDED check here. City, State, Zip: ____________________________________ Bank Transit/ABA #: ________________________________ Account #: ________________________________________",
  "CREDIT CARD AUTHORIZATION",
  "☐ I authorize Town Square to charge the credit card listed below for all membership fees and authorized services.",
  "I understand that a 3% processing surcharge will be added to all credit card transactions. My card will be charged on or about the 1st day of each month for the upcoming month of services, including the 3% surcharge. If a charge is declined, a $25 fee plus a 2% late fee may be applied. I authorize Town Square to retain this information on file and to charge the card for all recurring monthly membership fees and any additional authorized charges in accordance with the Membership Agreement.",
  "Credit Card Information",
  "Cardholder Name (as it appears on card): ______________________________________________ Card Type: ☐ Visa ☐ MasterCard ☐ Amex ☐ Discover Card Number: ___________________________________ Expiration Date (MM/YY): ___________",
  "CVV: ___________ Billing Address: ____________________________________________________________________________________________",
  "Guarantor Signature: _______________________________ Date: ___________________"
] as const;

export const FIRST_DAY_WELCOME_LETTER_TEMPLATE = [
  "Welcome to Town Square Fort Mill!",
  "We are delighted to welcome you to the Town Square Fort Mill family! Our vibrant, nostalgic center is designed to provide compassionate care, engaging programs, and meaningful connections for your loved one. We can’t wait for you to experience everything from our vintage storefronts and lively activities to the support and peace of mind our center brings to families.",
  "As we prepare for your first day, here’s a helpful checklist to ensure everything goes smoothly.",
  "Items to Submit Before the First Day",
  "Please make sure the following documents are completed and submitted to the Enrollment Manager or Center Nurse:",
  "Completed Enrollment Packet (including Member Biography, Membership Agreement, and more)",
  "Copy of Insurance Cards (these can be uploaded via DocuSign)",
  "Copy of POA or Guardianship documentation (if applicable, may also be uploaded via DocuSign)",
  "Copy of South Carolina DNR form (if applicable)",
  "What to Bring on Your First Day",
  "To help us provide the best care possible, please send the following items:",
  "A full change of clothes (labeled with the member’s name)",
  "Medications in clearly labeled prescription bottles (if applicable)",
  "Personal care products, such as incontinence items, wipes, or toiletries (if needed)",
  "Comfort items, such as a favorite sweater",
  "Hours of Operation:",
  "Monday–Friday, 8:30 AM to 4:30 PM We observe the following holidays: New Year’s Day, Memorial Day, Independence Day (July 4), Labor Day, Thanksgiving Day, and Christmas Day.",
  "If you have any questions before your first day, our team is here to help. Just give us a call at 803-591-9898.",
  "We are honored to be part of your care journey and look forward to providing a safe, engaging, and joyful experience at Town Square Fort Mill.",
  "Warmly, The Town Square Fort Mill Team"
] as const;

type RenderedExhibitAContent = {
  commonParagraphs: string[];
  authorizationParagraphs: string[];
  allParagraphs: string[];
};

function resolveSelectionMarker(selected: boolean) {
  return selected ? "\u2611" : "\u2610";
}

function formatCurrencyValue(value: string | null | undefined, fallback: string) {
  const normalized = clean(value);
  if (!normalized) return fallback;

  const numeric = Number(normalized.replace(/[$,\s]/g, ""));
  if (Number.isFinite(numeric)) {
    return `$${numeric.toFixed(2)}`;
  }

  return normalized.startsWith("$") ? normalized : `$${normalized}`;
}

function buildPaymentMethodSelectionLine(paymentMethod: EnrollmentPacketPaymentMethod | null) {
  return `${resolveSelectionMarker(paymentMethod === "ACH")} ACH (Bank Draft)   ${resolveSelectionMarker(paymentMethod === "Credit Card")} Credit Card (Auto Charge)`;
}

function buildAuthorizationLine(input: {
  paragraph: string;
  checked: boolean;
}) {
  const trimmed = input.paragraph.trimStart();
  const withoutMarker = trimmed.startsWith("\u2610") || trimmed.startsWith("\u2611")
    ? trimmed.slice(1).trimStart()
    : trimmed;
  return `${resolveSelectionMarker(input.checked)} ${withoutMarker}`;
}

function renderMembershipAgreementIntro(input: {
  paragraph: string;
  caregiverName: string | null | undefined;
  memberName?: string | null | undefined;
}) {
  const safeCaregiverName = clean(input.caregiverName) ?? MEMBERSHIP_AGREEMENT_MEMBER_PLACEHOLDER;
  const safeMemberName = clean(input.memberName) ?? MEMBERSHIP_AGREEMENT_MEMBER_PLACEHOLDER;
  return input.paragraph
    .replace(MEMBERSHIP_AGREEMENT_MEMBER_PLACEHOLDER, safeMemberName)
    .replace("{{caregiverName}}", safeCaregiverName);
}

export function buildCanonicalMembershipAgreementParagraphs(
  caregiverName: string | null | undefined,
  memberName?: string | null | undefined
) {
  const safeCaregiverName = clean(caregiverName) ?? "_________________";
  return CANONICAL_MEMBERSHIP_AGREEMENT_TEMPLATE.map((paragraph, index) => {
    if (index === 1) {
      return renderMembershipAgreementIntro({
        paragraph,
        caregiverName: safeCaregiverName,
        memberName
      });
    }
    return paragraph.replace("{{caregiverName}}", safeCaregiverName);
  });
}

export function buildRenderedMembershipAgreementParagraphs(
  caregiverName: string | null | undefined,
  memberName?: string | null | undefined
) {
  const canonicalParagraphs = buildCanonicalMembershipAgreementParagraphs(caregiverName, memberName);
  const truncationIndex = canonicalParagraphs.indexOf(MEMBERSHIP_AGREEMENT_RENDER_TRUNCATION_MARKER);
  if (truncationIndex < 0) return canonicalParagraphs;
  return canonicalParagraphs.slice(0, truncationIndex);
}

export function buildRenderedMembershipExhibitAContent(input?: {
  paymentMethodSelection?: string | null;
  communityFee?: string | null;
  totalInitialEnrollmentAmount?: string | null;
  authorizationAcknowledged?: boolean;
}) : RenderedExhibitAContent {
  const paymentMethod = getEnrollmentPacketPaymentMethod(input?.paymentMethodSelection);
  const commonParagraphs = [
    CANONICAL_MEMBERSHIP_EXHIBIT_A_TEMPLATE[0],
    CANONICAL_MEMBERSHIP_EXHIBIT_A_TEMPLATE[1],
    CANONICAL_MEMBERSHIP_EXHIBIT_A_TEMPLATE[2],
    CANONICAL_MEMBERSHIP_EXHIBIT_A_TEMPLATE[3].replace(
      "$_____________",
      formatCurrencyValue(input?.communityFee, "$_____________")
    ),
    CANONICAL_MEMBERSHIP_EXHIBIT_A_TEMPLATE[4].replace(
      "$____________________",
      formatCurrencyValue(input?.totalInitialEnrollmentAmount, "$____________________")
    ),
    CANONICAL_MEMBERSHIP_EXHIBIT_A_TEMPLATE[5],
    CANONICAL_MEMBERSHIP_EXHIBIT_A_TEMPLATE[6],
    CANONICAL_MEMBERSHIP_EXHIBIT_A_TEMPLATE[7],
    buildPaymentMethodSelectionLine(paymentMethod)
  ];

  if (paymentMethod === "ACH") {
    const authorizationParagraphs = [
      CANONICAL_MEMBERSHIP_EXHIBIT_A_TEMPLATE[9],
      buildAuthorizationLine({
        paragraph: CANONICAL_MEMBERSHIP_EXHIBIT_A_TEMPLATE[10],
        checked: Boolean(input?.authorizationAcknowledged)
      }),
      CANONICAL_MEMBERSHIP_EXHIBIT_A_TEMPLATE[11],
      CANONICAL_MEMBERSHIP_EXHIBIT_A_TEMPLATE[12]
    ];
    return {
      commonParagraphs,
      authorizationParagraphs,
      allParagraphs: [...commonParagraphs, ...authorizationParagraphs]
    };
  }

  if (paymentMethod === "Credit Card") {
    const authorizationParagraphs = [
      CANONICAL_MEMBERSHIP_EXHIBIT_A_TEMPLATE[13],
      buildAuthorizationLine({
        paragraph: CANONICAL_MEMBERSHIP_EXHIBIT_A_TEMPLATE[14],
        checked: Boolean(input?.authorizationAcknowledged)
      }),
      CANONICAL_MEMBERSHIP_EXHIBIT_A_TEMPLATE[15],
      CANONICAL_MEMBERSHIP_EXHIBIT_A_TEMPLATE[16],
      CANONICAL_MEMBERSHIP_EXHIBIT_A_TEMPLATE[17],
      CANONICAL_MEMBERSHIP_EXHIBIT_A_TEMPLATE[18],
      CANONICAL_MEMBERSHIP_EXHIBIT_A_TEMPLATE[19]
    ];
    return {
      commonParagraphs,
      authorizationParagraphs,
      allParagraphs: [...commonParagraphs, ...authorizationParagraphs]
    };
  }

  return {
    commonParagraphs,
    authorizationParagraphs: [],
    allParagraphs: commonParagraphs
  };
}
