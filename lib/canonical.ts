// Canonical lists sourced from uploaded AppSheet workbooks.
// Operations Warehouse (3).xlsx
export const PARTICIPATION_MISSING_REASONS = [
  "Therapy Session",
  "Medical Appointment",
  "Resting",
  "Refused",
  "Left Early",
  "Fell Asleep",
  "Arrives Late",
  "Other",
  "Could not see properly"
] as const;

export const PARTICIPATION_LEVEL_OPTIONS = [100, 75, 50, 25, 0] as const;

export const TOILET_USE_TYPE_OPTIONS = ["Bladder", "Bowel", "No Output", "Refused", "Unknown (independent)"] as const;
export const TOILET_BRIEFS_VALUES = ["No", "Yes", "Yes (member supplied)", "Yes (member supplied - no charge)"] as const;

export const TRANSPORT_PERIOD_OPTIONS = ["AM", "PM"] as const;
export const TRANSPORT_TYPE_OPTIONS = ["Door to door", "Bus stop", "Refused/no show"] as const;
export const ATTENDANCE_ABSENCE_REASON_OPTIONS = [
  "Sick",
  "MD Appointment",
  "Vacation",
  "Family/Personal",
  "Transportation Issue",
  "No Show",
  "Other"
] as const;

export const MEMBER_DISCHARGE_REASON_OPTIONS = [
  "Care needs exceed program scope",
  "Transferred to higher level of care",
  "Moved out of service area",
  "Financial / coverage change",
  "Family choice",
  "Hospitalized / medical decline",
  "Behavioral / safety concerns",
  "Deceased",
  "Other"
] as const;

export const MEMBER_DISPOSITION_OPTIONS = [
  "Home with family support",
  "Home with home health",
  "Assisted living",
  "Memory care unit",
  "Skilled nursing facility",
  "Hospital",
  "Hospice",
  "Another adult day program",
  "Other"
] as const;

export const MEMBER_HOLD_REASON_OPTIONS = [
  "Medical Leave",
  "Hospitalization",
  "Family Request",
  "Vacation",
  "Administrative Hold",
  "Behavioral Observation",
  "Transportation Pause",
  "Other"
] as const;

export const MEMBER_CONTACT_CATEGORY_OPTIONS = [
  "Care Provider",
  "Payor",
  "Spouse",
  "Child",
  "Emergency Contact",
  "Responsible Party",
  "Other"
] as const;

export const MEMBER_MARITAL_STATUS_OPTIONS = [
  "Single",
  "Married",
  "Widowed",
  "Divorced",
  "Separated",
  "Partnered",
  "Other"
] as const;

export const MEMBER_ETHNICITY_OPTIONS = [
  "White",
  "Black or African American",
  "Hispanic or Latino",
  "Asian",
  "Native American or Alaska Native",
  "Native Hawaiian or Pacific Islander",
  "Two or More Races",
  "Other",
  "Prefer not to say"
] as const;

export const MEMBER_STATE_OPTIONS = [
  "AL",
  "AK",
  "AZ",
  "AR",
  "CA",
  "CO",
  "CT",
  "DE",
  "FL",
  "GA",
  "HI",
  "ID",
  "IL",
  "IN",
  "IA",
  "KS",
  "KY",
  "LA",
  "ME",
  "MD",
  "MA",
  "MI",
  "MN",
  "MS",
  "MO",
  "MT",
  "NE",
  "NV",
  "NH",
  "NJ",
  "NM",
  "NY",
  "NC",
  "ND",
  "OH",
  "OK",
  "OR",
  "PA",
  "RI",
  "SC",
  "SD",
  "TN",
  "TX",
  "UT",
  "VT",
  "VA",
  "WA",
  "WV",
  "WI",
  "WY"
] as const;

export const VETERAN_BRANCH_OPTIONS = [
  "Army",
  "Navy",
  "Air Force",
  "Marine Corps",
  "Coast Guard",
  "Space Force",
  "National Guard",
  "Reserves",
  "Other"
] as const;

export const MEMBER_FILE_CATEGORY_OPTIONS = [
  "Health Unit",
  "Legal",
  "Admin",
  "Assessment",
  "Care Plan",
  "Orders / POF",
  "Billing",
  "Name Badge",
  "Other"
] as const;

export const MEMBER_TRANSPORTATION_SERVICE_OPTIONS = ["Door to Door", "Bus Stop"] as const;
export const MEMBER_BUS_NUMBER_OPTIONS = ["1", "2", "3"] as const;

export const ANCILLARY_CHARGE_CATALOG = [
  { name: "Laundry", price_cents: 500 },
  { name: "Briefs", price_cents: 500 },
  { name: "Insulin Supplies", price_cents: 500 },
  { name: "Shower", price_cents: 2500 },
  { name: "Transport - Door to Door", price_cents: 2000 },
  { name: "Transport - Bus Stop", price_cents: 1000 },
  { name: "Transport - Refused/No Show", price_cents: 1000 },
  { name: "Late Pick-Up (first 15 min)", price_cents: 2500 },
  { name: "Late Pick-Up (next 15 min)", price_cents: 3000 }
] as const;

// Leads Pipeline (1).xlsx - Lists tab
export const LEAD_STAGE_OPTIONS = ["Inquiry", "Tour", "Enrollment in Progress", "Nurture", "Closed - Won", "Closed - Lost"] as const;
export const LEAD_STATUS_OPTIONS = ["Open", "Won", "Lost", "Nurture"] as const;
export const ENROLLMENT_PACKET_ELIGIBLE_LEAD_STAGES = ["Tour", "Enrollment in Progress", "Nurture"] as const;
export const LEAD_FOLLOW_UP_TYPES = ["Call", "Text", "Email", "Tour", "Discovery", "Other"] as const;
export const LEAD_ACTIVITY_TYPES = ["Call", "Text", "Email", "Tour", "Discovery", "Voicemail", "Follow-up", "Other"] as const;
export const LEAD_ACTIVITY_OUTCOMES = [
  "No answer",
  "Left voicemail",
  "Spoke with caregiver",
  "Sent info/packet",
  "Scheduled tour",
  "Completed tour",
  "Scheduled discovery",
  "Completed discovery",
  "Enrollment started",
  "Enrollment completed",
  "Member start confirmed",
  "Not a fit",
  "Other"
] as const;
export const LEAD_SOURCE_OPTIONS = [
  "Referral",
  "Website",
  "Walk-in",
  "Phone",
  "Hospital/Provider",
  "Community Event",
  "Facebook/Instagram",
  "Google",
  "Other"
] as const;
export const COMMUNITY_PARTNER_CATEGORY_OPTIONS = ["Hospital", "Community Organization", "Referral"] as const;
export const LEAD_LIKELIHOOD_OPTIONS = ["Hot", "Warm", "Cold"] as const;
export const LEAD_LOST_REASON_OPTIONS = [
  "Price",
  "Schedule/Availability",
  "Chose competitor",
  "No longer needed",
  "Not eligible",
  "Could not reach",
  "Other"
] as const;

export type LeadStatus = (typeof LEAD_STATUS_OPTIONS)[number];
export type LeadStage = (typeof LEAD_STAGE_OPTIONS)[number];
export type EnrollmentPacketEligibleLeadStage = (typeof ENROLLMENT_PACKET_ELIGIBLE_LEAD_STAGES)[number];
export type LeadDbStatus = "open" | "won" | "lost";
export type TransportType = (typeof TRANSPORT_TYPE_OPTIONS)[number];
export type ToiletUseType = (typeof TOILET_USE_TYPE_OPTIONS)[number];

export function canonicalLeadStage(stage: string): string {
  const normalized = stage.trim().toLowerCase();
  if (normalized === "eip") return "Enrollment in Progress";
  if (normalized === "closed - enrolled") return "Closed - Won";
  return stage;
}

export function canonicalLeadStatus(status: string, stage?: string): LeadStatus {
  const statusNorm = status.trim().toLowerCase();
  const stageNorm = (stage ?? "").trim().toLowerCase();

  if (stageNorm.includes("closed - won") || stageNorm.includes("closed - enrolled")) return "Won";
  if (stageNorm.includes("closed - lost")) return "Lost";
  if (stageNorm.includes("nurture")) return "Nurture";

  if (statusNorm === "won") return "Won";
  if (statusNorm === "lost") return "Lost";
  if (statusNorm === "nurture") return "Nurture";
  return "Open";
}

function toLeadDbStatus(status: LeadStatus): LeadDbStatus {
  if (status === "Won") return "won";
  if (status === "Lost") return "lost";
  return "open";
}

export function resolveCanonicalLeadState(input: {
  requestedStage: string;
  requestedStatus: string;
}) {
  let stage = canonicalLeadStage(input.requestedStage);
  if (!LEAD_STAGE_OPTIONS.includes(stage as LeadStage)) {
    stage = "Inquiry";
  }

  let status = canonicalLeadStatus(input.requestedStatus, stage);

  if (stage === "Closed - Lost") status = "Lost";
  if (status === "Lost") stage = "Closed - Lost";
  if (status === "Won") stage = "Closed - Won";
  if (status === "Nurture" && stage !== "Nurture") stage = "Nurture";

  const canonicalStage = stage as LeadStage;
  const canonicalStatus = canonicalLeadStatus(status, canonicalStage);

  return {
    stage: canonicalStage,
    status: canonicalStatus,
    dbStatus: toLeadDbStatus(canonicalStatus)
  };
}

export function isOpenLeadStatus(status: string): boolean {
  const canonical = canonicalLeadStatus(status);
  return canonical === "Open" || canonical === "Nurture";
}

export function isEnrollmentPacketEligibleLeadState(input: {
  requestedStage: string;
  requestedStatus: string;
}): boolean {
  const resolved = resolveCanonicalLeadState(input);
  return ENROLLMENT_PACKET_ELIGIBLE_LEAD_STAGES.includes(resolved.stage as EnrollmentPacketEligibleLeadStage);
}

export function getEnrollmentPacketEligibleLeadQueryStages() {
  return [...ENROLLMENT_PACKET_ELIGIBLE_LEAD_STAGES, "EIP"] as const;
}
