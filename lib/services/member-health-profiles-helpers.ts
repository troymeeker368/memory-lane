import type { MhpTab } from "@/lib/services/member-health-profiles-selects";

type MemberAssessmentSummarySource = {
  id: string;
  latest_assessment_id: string | null;
  latest_assessment_date: string | null;
  latest_assessment_track: string | null;
  latest_assessment_admission_review_required: boolean | null;
};

export type LatestMemberAssessmentSummary = {
  id: string;
  member_id: string;
  assessment_date: string;
  total_score: number | null;
  recommended_track: string | null;
  completed_by: string | null;
  signature_status: "unsigned" | "signed" | "voided" | null;
  draft_pof_status: string | null;
  admission_review_required: boolean | null;
  created_at: string | null;
};

type MemberHealthProfileDetailReadPlanOptions = {
  tab?: MhpTab;
  includeProviderDirectory?: boolean;
  includeHospitalPreferenceDirectory?: boolean;
  includeAssessments?: boolean;
  includeDiagnoses?: boolean;
  includeMedications?: boolean;
  includeAllergies?: boolean;
  includeProviders?: boolean;
  includeEquipment?: boolean;
  includeNotes?: boolean;
};

export function toLatestMemberAssessmentSummary(
  member: MemberAssessmentSummarySource
): LatestMemberAssessmentSummary | null {
  if (
    !member.latest_assessment_id &&
    !member.latest_assessment_date &&
    !member.latest_assessment_track &&
    member.latest_assessment_admission_review_required == null
  ) {
    return null;
  }

  return {
    id: member.latest_assessment_id ?? "",
    member_id: member.id,
    assessment_date: member.latest_assessment_date ?? "",
    total_score: null,
    recommended_track: member.latest_assessment_track ?? null,
    completed_by: null,
    signature_status: null,
    draft_pof_status: null,
    admission_review_required: member.latest_assessment_admission_review_required ?? null,
    created_at: null
  };
}

export function sortDesc<T>(rows: T[], getValue: (row: T) => string | null | undefined) {
  return [...rows].sort((a, b) => {
    const left = getValue(a) ?? "";
    const right = getValue(b) ?? "";
    if (left === right) return 0;
    return left < right ? 1 : -1;
  });
}

export function calculateAge(dob: string | null) {
  if (!dob) return null;
  const parsedDob = new Date(`${dob}T00:00:00.000`);
  if (Number.isNaN(parsedDob.getTime())) return null;

  const now = new Date();
  let age = now.getFullYear() - parsedDob.getFullYear();
  const monthDelta = now.getMonth() - parsedDob.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < parsedDob.getDate())) {
    age -= 1;
  }
  return age >= 0 ? age : null;
}

export function newestTimestamp(values: Array<string | null | undefined>) {
  const valid = values.filter((value): value is string => Boolean(value));
  if (valid.length === 0) return null;
  return valid.reduce((latest, current) => {
    const latestMs = Number.isNaN(Date.parse(latest)) ? 0 : Date.parse(latest);
    const currentMs = Number.isNaN(Date.parse(current)) ? 0 : Date.parse(current);
    return currentMs > latestMs ? current : latest;
  });
}

export function newestUpdate(values: Array<{ at: string | null | undefined; by?: string | null | undefined }>) {
  let latestAt: string | null = null;
  let latestBy: string | null = null;
  values.forEach((value) => {
    if (!value.at) return;
    if (!latestAt) {
      latestAt = value.at;
      latestBy = value.by ?? null;
      return;
    }
    const latestMs = Number.isNaN(Date.parse(latestAt)) ? 0 : Date.parse(latestAt);
    const currentMs = Number.isNaN(Date.parse(value.at)) ? 0 : Date.parse(value.at);
    if (currentMs > latestMs) {
      latestAt = value.at;
      latestBy = value.by ?? null;
    }
  });
  return { at: latestAt, by: latestBy };
}

export function sortByLastName(a: string, b: string) {
  const toKey = (fullName: string) => {
    const parts = fullName.trim().split(/\s+/).filter(Boolean);
    if (parts.length <= 1) return fullName.toLowerCase();
    const last = parts[parts.length - 1];
    const first = parts.slice(0, -1).join(" ");
    return `${last}, ${first}`.toLowerCase();
  };
  return toKey(a).localeCompare(toKey(b));
}

export function resolveMemberHealthProfileDetailReadPlan(options?: MemberHealthProfileDetailReadPlanOptions) {
  const tab = options?.tab;

  const defaultPlan = {
    includeProviderDirectory: true,
    includeHospitalPreferenceDirectory: true,
    includeAssessments: true,
    includeDiagnoses: true,
    includeMedications: true,
    includeAllergies: true,
    includeProviders: true,
    includeEquipment: true,
    includeNotes: true
  };

  const tabPlan =
    !tab
      ? defaultPlan
      : {
          includeProviderDirectory: tab === "medical",
          includeHospitalPreferenceDirectory: tab === "legal",
          includeAssessments: false,
          includeDiagnoses: tab === "medical",
          includeMedications: tab === "medical",
          includeAllergies: tab === "medical",
          includeProviders: tab === "medical",
          includeEquipment: tab === "equipment",
          includeNotes: tab === "notes"
        };

  return {
    includeProviderDirectory: options?.includeProviderDirectory ?? tabPlan.includeProviderDirectory,
    includeHospitalPreferenceDirectory:
      options?.includeHospitalPreferenceDirectory ?? tabPlan.includeHospitalPreferenceDirectory,
    includeAssessments: options?.includeAssessments ?? tabPlan.includeAssessments,
    includeDiagnoses: options?.includeDiagnoses ?? tabPlan.includeDiagnoses,
    includeMedications: options?.includeMedications ?? tabPlan.includeMedications,
    includeAllergies: options?.includeAllergies ?? tabPlan.includeAllergies,
    includeProviders: options?.includeProviders ?? tabPlan.includeProviders,
    includeEquipment: options?.includeEquipment ?? tabPlan.includeEquipment,
    includeNotes: options?.includeNotes ?? tabPlan.includeNotes
  };
}

export function buildMissingMemberHealthProfileShellError(memberId: string) {
  return new Error(
    `Missing canonical member_health_profiles row for member ${memberId}. The Member Health Profile shell must be provisioned by the canonical lead conversion or enrollment workflow before reads or edits can succeed. Run \`npm run repair:historical-drift -- --apply\` or another explicit repair workflow for historical drift instead of relying on read-time backfill.`
  );
}
