export type CanonicalPersonSourceType = "lead" | "member";

export type CanonicalSafeWorkflowType = "lead-only" | "member-only" | "hybrid";

export type CanonicalEnrollmentStatus = "not-enrolled" | "enrolled-active" | "enrolled-inactive";

export type CanonicalExpectedIdentity = "lead" | "member" | "any";

export type LeadRef = {
  sourceType: "lead";
  leadId: string;
  memberId?: string | null;
};

export type MemberRef = {
  sourceType: "member";
  memberId: string;
  leadId?: string | null;
};

export type CanonicalPersonRef = {
  sourceType: CanonicalPersonSourceType;
  leadId: string | null;
  memberId: string | null;
  displayName: string;
  memberStatus: "active" | "inactive" | null;
  leadStage: string | null;
  leadStatus: string | null;
  enrollmentStatus: CanonicalEnrollmentStatus;
  safeWorkflowType: CanonicalSafeWorkflowType;
};

export type CanonicalPersonRefInput = {
  sourceType?: CanonicalPersonSourceType | null;
  selectedId?: string | null;
  leadId?: string | null;
  memberId?: string | null;
  externalId?: string | null;
  legacyId?: string | null;
  displayName?: string | null;
};

