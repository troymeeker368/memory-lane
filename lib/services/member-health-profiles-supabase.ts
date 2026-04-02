import { createClient } from "@/lib/supabase/server";
import { buildSupabaseIlikePattern } from "@/lib/services/supabase-ilike";
import { invokeSupabaseRpcOrThrow } from "@/lib/supabase/rpc";
import { resolveCanonicalMemberId } from "@/lib/services/canonical-person-ref";
import { toIntakeDraftPofStatus } from "@/lib/services/intake-draft-pof-readiness";
import {
  listIntakePostSignFollowUpTasksByAssessmentIds,
  type IntakePostSignFollowUpTask
} from "@/lib/services/intake-post-sign-follow-up";
import { resolveIntakePostSignReadiness, type IntakePostSignReadinessStatus } from "@/lib/services/intake-post-sign-readiness";
import { toEasternISO } from "@/lib/timezone";

export const MHP_TABS = [
  "overview",
  "medical",
  "functional",
  "cognitive-behavioral",
  "equipment",
  "legal",
  "notes"
] as const;

const MHP_SUMMARY_COUNTS_RPC = "rpc_get_member_health_profile_summary_counts";
const MHP_SUMMARY_COUNTS_RPC_MIGRATION = "0102_mhp_summary_counts_rpc.sql";
const MEMBER_HEALTH_PROFILE_SELECT = [
  "id",
  "member_id",
  "gender",
  "payor",
  "original_referral_source",
  "photo_consent",
  "profile_image_url",
  "primary_caregiver_name",
  "primary_caregiver_phone",
  "responsible_party_name",
  "responsible_party_phone",
  "provider_name",
  "provider_phone",
  "important_alerts",
  "diet_type",
  "dietary_restrictions",
  "swallowing_difficulty",
  "diet_texture",
  "supplements",
  "foods_to_omit",
  "ambulation",
  "transferring",
  "bathing",
  "dressing",
  "eating",
  "bladder_continence",
  "bowel_continence",
  "toileting",
  "toileting_needs",
  "toileting_comments",
  "hearing",
  "vision",
  "dental",
  "speech_verbal_status",
  "speech_comments",
  "personal_appearance_hygiene_grooming",
  "may_self_medicate",
  "medication_manager_name",
  "orientation_dob",
  "orientation_city",
  "orientation_current_year",
  "orientation_former_occupation",
  "memory_impairment",
  "memory_severity",
  "wandering",
  "combative_disruptive",
  "sleep_issues",
  "self_harm_unsafe",
  "impaired_judgement",
  "delirium",
  "disorientation",
  "agitation_resistive",
  "screaming_loud_noises",
  "exhibitionism_disrobing",
  "exit_seeking",
  "cognitive_behavior_comments",
  "code_status",
  "dnr",
  "dni",
  "polst_molst_colst",
  "hospice",
  "advanced_directives_obtained",
  "power_of_attorney",
  "hospital_preference",
  "legal_comments",
  "source_assessment_id",
  "source_assessment_at",
  "updated_by_user_id",
  "updated_by_name",
  "created_at",
  "updated_at"
].join(", ");
const MEMBER_DIAGNOSIS_SELECT =
  "id, member_id, diagnosis_type, diagnosis_name, diagnosis_code, date_added, comments, created_by_name, updated_at";
const MEMBER_MEDICATION_SELECT =
  "id, member_id, medication_name, date_started, medication_status, inactivated_at, dose, quantity, form, frequency, route, route_laterality, given_at_center, prn, prn_instructions, scheduled_times, comments, created_by_name, updated_at";
const MEMBER_ALLERGY_SELECT =
  "id, member_id, allergy_group, allergy_name, severity, comments, created_by_name, updated_at";
const MEMBER_PROVIDER_SELECT =
  "id, member_id, provider_name, specialty, specialty_other, practice_name, provider_phone, created_by_name, updated_at";
const PROVIDER_DIRECTORY_SELECT =
  "id, provider_name, specialty, specialty_other, practice_name, provider_phone, updated_at";
const HOSPITAL_PREFERENCE_DIRECTORY_SELECT = "id, hospital_name, updated_at";
const MEMBER_EQUIPMENT_SELECT =
  "id, member_id, equipment_type, provider_source, status, comments, created_by_name, updated_at";
const MEMBER_NOTE_SELECT =
  "id, member_id, note_type, note_text, created_by_name, created_at, updated_at";

export type MhpTab = (typeof MHP_TABS)[number];

type MemberHealthProfileDetailOptions = {
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

type MemberHealthProfileAssessmentOptions = {
  includeAll?: boolean;
  supabase?: Awaited<ReturnType<typeof createClient>>;
};

type MemberRow = {
  id: string;
  display_name: string;
  status: "active" | "inactive";
  dob: string | null;
  enrollment_date: string | null;
  city: string | null;
  code_status: string | null;
  latest_assessment_track: string | null;
};

export interface MemberHealthProfileIndexResult {
  rows: Array<{
    member: MemberRow;
    profile: MemberHealthProfileRow;
    latestAssessment: IntakeAssessmentRow | null;
    age: number | null;
    alerts: string[];
    profileNeedsBackfill: boolean;
  }>;
  page: number;
  pageSize: number;
  totalRows: number;
  totalPages: number;
  activeCount: number;
  withAlertsCount: number;
}

export type MemberHealthProfileRow = {
  id: string;
  member_id: string;
  gender: string | null;
  payor: string | null;
  original_referral_source: string | null;
  photo_consent: boolean | null;
  profile_image_url: string | null;
  primary_caregiver_name: string | null;
  primary_caregiver_phone: string | null;
  responsible_party_name: string | null;
  responsible_party_phone: string | null;
  provider_name: string | null;
  provider_phone: string | null;
  important_alerts: string | null;
  diet_type: string | null;
  dietary_restrictions: string | null;
  swallowing_difficulty: string | null;
  diet_texture: string | null;
  supplements: string | null;
  foods_to_omit: string | null;
  ambulation: string | null;
  transferring: string | null;
  bathing: string | null;
  dressing: string | null;
  eating: string | null;
  bladder_continence: string | null;
  bowel_continence: string | null;
  toileting: string | null;
  toileting_needs: string | null;
  toileting_comments: string | null;
  hearing: string | null;
  vision: string | null;
  dental: string | null;
  speech_verbal_status: string | null;
  speech_comments: string | null;
  personal_appearance_hygiene_grooming: string | null;
  may_self_medicate: boolean | null;
  medication_manager_name: string | null;
  orientation_dob: string | null;
  orientation_city: string | null;
  orientation_current_year: string | null;
  orientation_former_occupation: string | null;
  memory_impairment: string | null;
  memory_severity: string | null;
  wandering: boolean | null;
  combative_disruptive: boolean | null;
  sleep_issues: boolean | null;
  self_harm_unsafe: boolean | null;
  impaired_judgement: boolean | null;
  delirium: boolean | null;
  disorientation: boolean | null;
  agitation_resistive: boolean | null;
  screaming_loud_noises: boolean | null;
  exhibitionism_disrobing: boolean | null;
  exit_seeking: boolean | null;
  cognitive_behavior_comments: string | null;
  code_status: string | null;
  dnr: boolean | null;
  dni: boolean | null;
  polst_molst_colst: string | null;
  hospice: boolean | null;
  advanced_directives_obtained: boolean | null;
  power_of_attorney: string | null;
  hospital_preference: string | null;
  legal_comments: string | null;
  source_assessment_id: string | null;
  source_assessment_at: string | null;
  updated_by_user_id: string | null;
  updated_by_name: string | null;
  created_at: string;
  updated_at: string;
};

type MemberDiagnosisRow = {
  id: string;
  member_id: string;
  diagnosis_type: "primary" | "secondary";
  diagnosis_name: string;
  diagnosis_code: string | null;
  date_added: string;
  comments: string | null;
  created_by_name: string | null;
  updated_at: string;
};

type MemberMedicationRow = {
  id: string;
  member_id: string;
  medication_name: string;
  date_started: string | null;
  medication_status: "active" | "inactive";
  inactivated_at: string | null;
  dose: string | null;
  quantity: string | null;
  form: string | null;
  frequency: string | null;
  route: string | null;
  route_laterality: string | null;
  given_at_center: boolean;
  prn: boolean;
  prn_instructions: string | null;
  scheduled_times: string[];
  comments: string | null;
  created_by_name: string | null;
  updated_at: string;
};

type MemberAllergyRow = {
  id: string;
  member_id: string;
  allergy_group: "food" | "medication" | "environmental";
  allergy_name: string;
  severity: string | null;
  comments: string | null;
  created_by_name: string | null;
  updated_at: string;
};

type MemberProviderRow = {
  id: string;
  member_id: string;
  provider_name: string;
  specialty: string | null;
  specialty_other: string | null;
  practice_name: string | null;
  provider_phone: string | null;
  created_by_name: string | null;
  updated_at: string;
};

type ProviderDirectoryRow = {
  id: string;
  provider_name: string;
  specialty: string | null;
  specialty_other: string | null;
  practice_name: string | null;
  provider_phone: string | null;
  updated_at: string;
};

type HospitalPreferenceDirectoryRow = {
  id: string;
  hospital_name: string;
  updated_at: string;
};

type MemberEquipmentRow = {
  id: string;
  member_id: string;
  equipment_type: string;
  provider_source: string | null;
  status: string | null;
  comments: string | null;
  created_by_name: string | null;
  updated_at: string;
};

type MemberNoteRow = {
  id: string;
  member_id: string;
  note_type: string;
  note_text: string;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
};

type IntakeAssessmentRow = {
  id: string;
  member_id: string;
  assessment_date: string;
  total_score: number | null;
  recommended_track: string | null;
  completed_by: string | null;
  signature_status: "unsigned" | "signed" | "voided" | null;
  draft_pof_status: string | null;
  post_sign_readiness_status?: IntakePostSignReadinessStatus;
  admission_review_required: boolean | null;
  created_at: string;
};

const EMPTY_MEMBER_HEALTH_PROFILE_TEMPLATE: Omit<MemberHealthProfileRow, "id" | "member_id"> = {
  gender: null,
  payor: null,
  original_referral_source: null,
  photo_consent: null,
  profile_image_url: null,
  primary_caregiver_name: null,
  primary_caregiver_phone: null,
  responsible_party_name: null,
  responsible_party_phone: null,
  provider_name: null,
  provider_phone: null,
  important_alerts: null,
  diet_type: null,
  dietary_restrictions: null,
  swallowing_difficulty: null,
  diet_texture: null,
  supplements: null,
  foods_to_omit: null,
  ambulation: null,
  transferring: null,
  bathing: null,
  dressing: null,
  eating: null,
  bladder_continence: null,
  bowel_continence: null,
  toileting: null,
  toileting_needs: null,
  toileting_comments: null,
  hearing: null,
  vision: null,
  dental: null,
  speech_verbal_status: null,
  speech_comments: null,
  personal_appearance_hygiene_grooming: null,
  may_self_medicate: null,
  medication_manager_name: null,
  orientation_dob: null,
  orientation_city: null,
  orientation_current_year: null,
  orientation_former_occupation: null,
  memory_impairment: null,
  memory_severity: null,
  wandering: null,
  combative_disruptive: null,
  sleep_issues: null,
  self_harm_unsafe: null,
  impaired_judgement: null,
  delirium: null,
  disorientation: null,
  agitation_resistive: null,
  screaming_loud_noises: null,
  exhibitionism_disrobing: null,
  exit_seeking: null,
  cognitive_behavior_comments: null,
  code_status: null,
  dnr: null,
  dni: null,
  polst_molst_colst: null,
  hospice: null,
  advanced_directives_obtained: null,
  power_of_attorney: null,
  hospital_preference: null,
  legal_comments: null,
  source_assessment_id: null,
  source_assessment_at: null,
  updated_by_user_id: null,
  updated_by_name: null,
  created_at: "",
  updated_at: ""
};

function buildEmptyMemberHealthProfileRow(memberId: string): MemberHealthProfileRow {
  return {
    id: `missing-member-health-profile:${memberId}`,
    member_id: memberId,
    ...EMPTY_MEMBER_HEALTH_PROFILE_TEMPLATE
  };
}

function sortDesc<T>(rows: T[], getValue: (row: T) => string | null | undefined) {
  return [...rows].sort((a, b) => {
    const left = getValue(a) ?? "";
    const right = getValue(b) ?? "";
    if (left === right) return 0;
    return left < right ? 1 : -1;
  });
}

function calculateAge(dob: string | null) {
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

function newestTimestamp(values: Array<string | null | undefined>) {
  const valid = values.filter((value): value is string => Boolean(value));
  if (valid.length === 0) return null;
  return valid.reduce((latest, current) => {
    const latestMs = Number.isNaN(Date.parse(latest)) ? 0 : Date.parse(latest);
    const currentMs = Number.isNaN(Date.parse(current)) ? 0 : Date.parse(current);
    return currentMs > latestMs ? current : latest;
  });
}

function newestUpdate(values: Array<{ at: string | null | undefined; by?: string | null | undefined }>) {
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

function sortByLastName(a: string, b: string) {
  const toKey = (fullName: string) => {
    const parts = fullName.trim().split(/\s+/).filter(Boolean);
    if (parts.length <= 1) return fullName.toLowerCase();
    const last = parts[parts.length - 1];
    const first = parts.slice(0, -1).join(" ");
    return `${last}, ${first}`.toLowerCase();
  };
  return toKey(a).localeCompare(toKey(b));
}

function resolveMemberHealthProfileDetailReadPlan(options?: MemberHealthProfileDetailOptions) {
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

export async function ensureMemberHealthProfileSupabase(memberId: string, options?: { serviceRole?: boolean }) {
  const canonicalMemberId = await resolveCanonicalMemberId(memberId, { actionLabel: "ensureMemberHealthProfileSupabase" });
  const supabase = await createClient();
  const { data: existing, error: existingError } = await supabase
    .from("member_health_profiles")
    .select(MEMBER_HEALTH_PROFILE_SELECT)
    .eq("member_id", canonicalMemberId)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (existing) {
    return (existing as unknown) as MemberHealthProfileRow;
  }

  const now = toEasternISO();
  const writeSupabase = await createClient({ serviceRole: options?.serviceRole ?? true });
  const { data, error } = await writeSupabase
    .from("member_health_profiles")
    .insert({ member_id: canonicalMemberId, created_at: now, updated_at: now })
    .select(MEMBER_HEALTH_PROFILE_SELECT)
    .single();
  if (error) throw new Error(error.message);
  return (data as unknown) as MemberHealthProfileRow;
}

export async function getMemberHealthProfileIndexSupabase(filters?: {
  q?: string;
  status?: "all" | "active" | "inactive";
  page?: number;
  pageSize?: number;
}): Promise<MemberHealthProfileIndexResult> {
  const supabase = await createClient();
  const queryText = filters?.q?.trim() ?? "";
  const status = filters?.status ?? "all";
  const page = Number.isFinite(filters?.page) && Number(filters?.page) > 0 ? Math.floor(Number(filters?.page)) : 1;
  const pageSize =
    Number.isFinite(filters?.pageSize) && Number(filters?.pageSize) > 0 ? Math.floor(Number(filters?.pageSize)) : 25;

  let membersQuery = supabase
    .from("members")
    .select("id, display_name, status, dob, enrollment_date, city, code_status, latest_assessment_track", { count: "exact" })
    .order("display_name", { ascending: true })
    .range((page - 1) * pageSize, page * pageSize - 1);
  if (status !== "all") {
    membersQuery = membersQuery.eq("status", status);
  }
  if (queryText) {
    membersQuery = membersQuery.ilike("display_name", buildSupabaseIlikePattern(queryText));
  }

  const { data: membersData, error: membersError, count: totalRows } = await membersQuery;
  if (membersError) throw new Error(membersError.message);
  const members = (membersData ?? []) as MemberRow[];

  type MhpSummaryCountsRpcRow = {
    active_count: number | string | null;
    with_alerts_count: number | string | null;
  };
  let summaryCounts = {
    activeCount: 0,
    withAlertsCount: 0
  };
  try {
    const data = await invokeSupabaseRpcOrThrow<unknown>(supabase, MHP_SUMMARY_COUNTS_RPC, {
      p_status: status !== "all" ? status : null,
      p_query: queryText || null
    });
    const row = (Array.isArray(data) ? data[0] : null) as MhpSummaryCountsRpcRow | null;
    summaryCounts = {
      activeCount: Number(row?.active_count ?? 0),
      withAlertsCount: Number(row?.with_alerts_count ?? 0)
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load member health profile summary counts.";
    if (message.includes(MHP_SUMMARY_COUNTS_RPC)) {
      throw new Error(
        `MHP summary counts RPC is not available. Apply Supabase migration ${MHP_SUMMARY_COUNTS_RPC_MIGRATION} and refresh PostgREST schema cache.`
      );
    }
    throw error;
  }

  if (members.length === 0) {
    return {
      rows: [],
      page,
      pageSize,
      totalRows: totalRows ?? 0,
      totalPages: Math.max(1, Math.ceil((totalRows ?? 0) / pageSize)),
      activeCount: summaryCounts.activeCount,
      withAlertsCount: summaryCounts.withAlertsCount
    };
  }
  const memberIds = members.map((member) => member.id);

  const [profilesResult, mccResult, assessmentsResult] = await Promise.all([
    supabase
      .from("member_health_profiles")
      .select("member_id, profile_image_url, important_alerts, code_status")
      .in("member_id", memberIds),
    supabase.from("member_command_centers").select("member_id, profile_image_url").in("member_id", memberIds),
    supabase
      .from("intake_assessments")
      .select("id, member_id, assessment_date, admission_review_required, recommended_track, created_at")
      .in("member_id", memberIds)
      .order("assessment_date", { ascending: false })
      .order("created_at", { ascending: false })
  ]);

  if (profilesResult.error) throw new Error(profilesResult.error.message);
  if (mccResult.error) throw new Error(mccResult.error.message);
  if (assessmentsResult.error) throw new Error(assessmentsResult.error.message);

  const profileByMemberId = new Map((profilesResult.data ?? []).map((row) => [String(row.member_id), row as Partial<MemberHealthProfileRow>] as const));
  const mccPhotoByMemberId = new Map((mccResult.data ?? []).map((row) => [String(row.member_id), (row.profile_image_url as string | null) ?? null] as const));

  const latestAssessmentByMemberId = new Map<string, IntakeAssessmentRow>();
  ((assessmentsResult.data ?? []) as IntakeAssessmentRow[]).forEach((row) => {
    if (!latestAssessmentByMemberId.has(row.member_id)) {
      latestAssessmentByMemberId.set(row.member_id, row);
    }
  });

  const rows = members
    .map((member) => {
      const storedProfile = profileByMemberId.get(member.id);
      const latestAssessment = latestAssessmentByMemberId.get(member.id) ?? null;
      const profileNeedsBackfill = !storedProfile;
      const profile = {
        ...buildEmptyMemberHealthProfileRow(member.id),
        ...(storedProfile ?? {})
      } satisfies MemberHealthProfileRow;
      const effectiveProfile = {
        ...profile,
        profile_image_url: profile.profile_image_url ?? mccPhotoByMemberId.get(member.id) ?? null
      };

      return {
        member,
        profile: effectiveProfile,
        latestAssessment,
        age: calculateAge(member.dob),
        alerts: [
          profileNeedsBackfill ? "MHP profile row missing" : null,
          latestAssessment?.admission_review_required ? "Assessment review required" : null,
          effectiveProfile.important_alerts
        ].filter((alert): alert is string => Boolean(alert)),
        profileNeedsBackfill
      };
    })
    .sort((a, b) => sortByLastName(a.member.display_name, b.member.display_name));
  return {
    rows,
    page,
    pageSize,
    totalRows: totalRows ?? rows.length,
    totalPages: Math.max(1, Math.ceil((totalRows ?? rows.length) / pageSize)),
    activeCount: summaryCounts.activeCount,
    withAlertsCount: summaryCounts.withAlertsCount
  };
}

async function loadMemberHealthProfileAssessments(
  canonicalMemberId: string,
  options?: MemberHealthProfileAssessmentOptions
) {
  const supabase = options?.supabase ?? (await createClient());
  const query = supabase
    .from("intake_assessments")
    .select("id, member_id, assessment_date, total_score, recommended_track, completed_by, signature_status, draft_pof_status, created_at")
    .eq("member_id", canonicalMemberId)
    .order("assessment_date", { ascending: false })
    .order("created_at", { ascending: false });
  const { data, error } = await (options?.includeAll ? query : query.limit(1));
  if (error) throw new Error(error.message);

  const rawAssessments = sortDesc((data ?? []) as IntakeAssessmentRow[], (row) => row.created_at);
  const openFollowUpTasksByAssessmentId: Map<string, IntakePostSignFollowUpTask[]> = options?.includeAll
    ? await listIntakePostSignFollowUpTasksByAssessmentIds({
        assessmentIds: rawAssessments.map((row) => row.id)
      })
    : new Map<string, IntakePostSignFollowUpTask[]>();

  return options?.includeAll
    ? rawAssessments.map((row) => {
        const openFollowUpTaskTypes = (openFollowUpTasksByAssessmentId.get(row.id) ?? [])
          .filter((task: IntakePostSignFollowUpTask) => task.status === "action_required")
          .map((task: IntakePostSignFollowUpTask) => task.taskType);
        return {
          ...row,
          post_sign_readiness_status: resolveIntakePostSignReadiness({
            signatureStatus: row.signature_status,
            draftPofStatus: toIntakeDraftPofStatus(row.draft_pof_status),
            openFollowUpTaskTypes
          })
        };
      })
    : rawAssessments;
}

export async function getMemberHealthProfileDetailSupabase(
  memberId: string,
  options?: MemberHealthProfileDetailOptions
) {
  const canonicalMemberId = await resolveCanonicalMemberId(memberId, { actionLabel: "getMemberHealthProfileDetailSupabase" });
  const supabase = await createClient();
  const readPlan = resolveMemberHealthProfileDetailReadPlan(options);
  const { data: memberData, error: memberError } = await supabase
    .from("members")
    .select("id, display_name, status, dob, enrollment_date, city, code_status, latest_assessment_track")
    .eq("id", canonicalMemberId)
    .maybeSingle();
  if (memberError) throw new Error(memberError.message);
  if (!memberData) return null;

  const member = memberData as MemberRow;

  const [
    profileResult,
    diagnosesResult,
    medicationsResult,
    allergiesResult,
    providersResult,
    providerDirectoryResult,
    hospitalPreferenceDirectoryResult,
    equipmentResult,
    notesResult,
    assessmentsResult,
    mccResult
  ] = await Promise.all([
    supabase.from("member_health_profiles").select(MEMBER_HEALTH_PROFILE_SELECT).eq("member_id", canonicalMemberId).maybeSingle(),
    readPlan.includeDiagnoses
      ? supabase.from("member_diagnoses").select(MEMBER_DIAGNOSIS_SELECT).eq("member_id", canonicalMemberId)
      : Promise.resolve({ data: [], error: null }),
    readPlan.includeMedications
      ? supabase.from("member_medications").select(MEMBER_MEDICATION_SELECT).eq("member_id", canonicalMemberId)
      : Promise.resolve({ data: [], error: null }),
    readPlan.includeAllergies
      ? supabase.from("member_allergies").select(MEMBER_ALLERGY_SELECT).eq("member_id", canonicalMemberId)
      : Promise.resolve({ data: [], error: null }),
    readPlan.includeProviders
      ? supabase.from("member_providers").select(MEMBER_PROVIDER_SELECT).eq("member_id", canonicalMemberId)
      : Promise.resolve({ data: [], error: null }),
    readPlan.includeProviderDirectory
      ? supabase.from("provider_directory").select(PROVIDER_DIRECTORY_SELECT).order("updated_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    readPlan.includeHospitalPreferenceDirectory
      ? supabase
          .from("hospital_preference_directory")
          .select(HOSPITAL_PREFERENCE_DIRECTORY_SELECT)
          .order("updated_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    readPlan.includeEquipment
      ? supabase.from("member_equipment").select(MEMBER_EQUIPMENT_SELECT).eq("member_id", canonicalMemberId)
      : Promise.resolve({ data: [], error: null }),
    readPlan.includeNotes
      ? supabase.from("member_notes").select(MEMBER_NOTE_SELECT).eq("member_id", canonicalMemberId)
      : Promise.resolve({ data: [], error: null }),
    loadMemberHealthProfileAssessments(canonicalMemberId, {
      includeAll: readPlan.includeAssessments,
      supabase
    }),
    supabase.from("member_command_centers").select("member_id, profile_image_url").eq("member_id", canonicalMemberId).maybeSingle()
  ]);

  if (profileResult.error) throw new Error(profileResult.error.message);
  if (diagnosesResult.error) throw new Error(diagnosesResult.error.message);
  if (medicationsResult.error) throw new Error(medicationsResult.error.message);
  if (allergiesResult.error) throw new Error(allergiesResult.error.message);
  if (providersResult.error) throw new Error(providersResult.error.message);
  if (providerDirectoryResult.error) throw new Error(providerDirectoryResult.error.message);
  if (hospitalPreferenceDirectoryResult.error) throw new Error(hospitalPreferenceDirectoryResult.error.message);
  if (equipmentResult.error) throw new Error(equipmentResult.error.message);
  if (notesResult.error) throw new Error(notesResult.error.message);
  if (mccResult.error) throw new Error(mccResult.error.message);

  const diagnoses = sortDesc((diagnosesResult.data ?? []) as MemberDiagnosisRow[], (row) => row.date_added);
  const medications = sortDesc((medicationsResult.data ?? []) as MemberMedicationRow[], (row) => row.updated_at);
  const allergies = sortDesc((allergiesResult.data ?? []) as MemberAllergyRow[], (row) => row.updated_at);
  const providers = sortDesc((providersResult.data ?? []) as MemberProviderRow[], (row) => row.updated_at);
  const providerDirectory = sortDesc(
    ((providerDirectoryResult.data ?? []) as ProviderDirectoryRow[]).filter((row) => row.provider_name.trim().length > 0),
    (row) => row.updated_at
  );
  const hospitalPreferenceDirectory = sortDesc(
    ((hospitalPreferenceDirectoryResult.data ?? []) as HospitalPreferenceDirectoryRow[]).filter((row) => row.hospital_name.trim().length > 0),
    (row) => row.updated_at
  );
  const equipment = sortDesc((equipmentResult.data ?? []) as MemberEquipmentRow[], (row) => row.updated_at);
  const notes = sortDesc((notesResult.data ?? []) as MemberNoteRow[], (row) => row.created_at);
  const assessments = assessmentsResult;
  const storedProfile = (profileResult.data as MemberHealthProfileRow | null) ?? null;
  const profileNeedsBackfill = !storedProfile;
  const profile = storedProfile ?? buildEmptyMemberHealthProfileRow(canonicalMemberId);

  const effectiveProfile = {
    ...profile,
    profile_image_url: profile.profile_image_url ?? ((mccResult.data as { profile_image_url: string | null } | null)?.profile_image_url ?? null)
  };

  const lastUpdatedAt =
    newestTimestamp([
      effectiveProfile.updated_at,
      ...diagnoses.map((row) => row.updated_at),
      ...medications.map((row) => row.updated_at),
      ...allergies.map((row) => row.updated_at),
      ...providers.map((row) => row.updated_at),
      ...equipment.map((row) => row.updated_at),
      ...notes.map((row) => row.updated_at)
    ]) ?? effectiveProfile.updated_at;

  const newest = newestUpdate([
    { at: effectiveProfile.updated_at, by: effectiveProfile.updated_by_name ?? null },
    ...diagnoses.map((row) => ({ at: row.updated_at, by: row.created_by_name })),
    ...medications.map((row) => ({ at: row.updated_at, by: row.created_by_name })),
    ...allergies.map((row) => ({ at: row.updated_at, by: row.created_by_name })),
    ...providers.map((row) => ({ at: row.updated_at, by: row.created_by_name })),
    ...equipment.map((row) => ({ at: row.updated_at, by: row.created_by_name })),
    ...notes.map((row) => ({ at: row.updated_at, by: row.created_by_name }))
  ]);

  return {
    member,
    profile: effectiveProfile,
    profileNeedsBackfill,
    diagnoses,
    medications,
    allergies,
    providers,
    providerDirectory,
    hospitalPreferenceDirectory,
    equipment,
    notes,
    assessments,
    lastUpdatedAt,
    lastUpdatedBy: newest.by ?? null,
    overview: {
      age: calculateAge(member.dob),
      codeStatus: effectiveProfile.code_status ?? member.code_status ?? null,
      primaryCaregiver: effectiveProfile.primary_caregiver_name,
      provider: providers[0]?.provider_name ?? effectiveProfile.provider_name
    }
  };
}

export async function getMemberHealthProfileAssessmentsSupabase(memberId: string) {
  const canonicalMemberId = await resolveCanonicalMemberId(memberId, {
    actionLabel: "getMemberHealthProfileAssessmentsSupabase"
  });
  return loadMemberHealthProfileAssessments(canonicalMemberId, {
    includeAll: true
  });
}

export async function backfillMissingMemberHealthProfilesSupabase(memberIds: Array<string | null | undefined>) {
  const normalizedMemberIds = Array.from(
    new Set(
      memberIds
        .map((value) => String(value ?? "").trim())
        .filter(Boolean)
    )
  );
  if (normalizedMemberIds.length === 0) return { inserted: 0 };

  const now = toEasternISO();
  const supabase = await createClient({ serviceRole: true });
  const { data: existingRows, error: existingError } = await supabase
    .from("member_health_profiles")
    .select("member_id")
    .in("member_id", normalizedMemberIds);
  if (existingError) throw new Error(existingError.message);

  const existingMemberIds = new Set(((existingRows ?? []) as Array<{ member_id: string }>).map((row) => row.member_id));
  const missingMemberIds = normalizedMemberIds.filter((memberId) => !existingMemberIds.has(memberId));
  if (missingMemberIds.length === 0) return { inserted: 0 };

  const { error: insertError } = await supabase.from("member_health_profiles").insert(
    missingMemberIds.map((missingMemberId) => ({
      member_id: missingMemberId,
      created_at: now,
      updated_at: now
    }))
  );
  if (insertError) throw new Error(insertError.message);

  return { inserted: missingMemberIds.length };
}
